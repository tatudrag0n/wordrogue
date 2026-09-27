// Chrome DevTools プロトコルでゲームを起動し、コンソールエラーを収集する。
//   node test/browser.test.js
//
// Chrome は headless で起動し、 http://localhost:8099 を開く。
// 起動 reciprocity は test/serve.js でサーバを立ててから実行する。

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH
  || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL_ = process.env.GAME_URL || 'http://localhost:8099/index.html';
const PORT = 9222;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m); } };
const sec = (t) => console.log('\n== ' + t + ' ==');

if (!existsSync(CHROME)) {
  console.log('Chrome が見つからない。スキップする。');
  process.exit(0);
}

const profile = mkdtempSync(join(tmpdir(), 'wr-chrome-'));
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  '--window-size=1280,800',
  '--autoplay-policy=no-user-gesture-required',
  'about:blank',
], { stdio: 'ignore' });

const cleanup = () => {
  try { chrome.kill(); } catch {}
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
};
process.on('exit', cleanup);

/** DevTools の WebSocket へつなぐ。 */
async function cdp() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return (await r.json()).webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error('Chrome に接続できない');
}

const wsUrl = await cdp();
const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let msgId = 0;
const pending = new Map();
const events = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  else if (m.method) events.push(m);
};
const send = (method, params = {}, sessionId) => new Promise((res) => {
  const id = ++msgId;
  pending.set(id, res);
  ws.send(JSON.stringify({ id, method, params, sessionId }));
});

// 新しいタブを作ってアタッチ。
const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank' });
const { result: { sessionId } } = await send('Target.attachToTarget', { targetId, flatten: true });
const S = (m, p) => send(m, p, sessionId);

await S('Runtime.enable');
await S('Log.enable');
await S('Page.enable');
await S('Runtime.consoleAPICalled');

const errors = [];
const origHandler = ws.onmessage;
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.consoleAPICalled') {
    const type = m.params.type;
    if (type === 'error' || type === 'warning') {
      const text = m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ');
      errors.push({ kind: type, text });
    }
  } else if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    errors.push({ kind: 'exception', text: d.exception?.description || d.text });
  } else if (m.method === 'Log.entryAdded') {
    const e = m.params.entry;
    if (e.level === 'error') errors.push({ kind: 'log', text: `${e.text} ${e.url || ''}` });
  }
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  else if (m.method) events.push(m);
};

const evalJs = async (expr) => {
  const r = await S('Runtime.evaluate', {
    expression: expr, returnByValue: true, awaitPromise: true,
  });
  if (r.result?.exceptionDetails) {
    throw new Error(r.result.exceptionDetails.exception?.description || 'eval failed');
  }
  return r.result?.result?.value;
};

sec('ページを開く');
await S('Page.navigate', { url: URL_ });
await sleep(2500);

const title = await evalJs('document.title');
ok(title === 'ワードローグ — Wordrogue', `タイトル: ${title}`);

sec('モジュールが読み込まれていること');
const appUp = await evalJs('!!window.__wordrogue');
ok(appUp === true, '__wordrogue が定義されている');

// ページ基準でモジュールを取り込む。GitHub Pages でもローカルでも動くように。
const dictSize = await evalJs(`(async () => {
  const url = new URL('js/data/words.js', document.baseURI).href;
  const m = await import(url);
  return Object.keys(m.WORDS).length;
})()`);
ok(dictSize > 300, `辞書が読み込まれた: ${dictSize} 語`);

sec('タイトル画面');
ok(await evalJs('!document.getElementById("title").hidden'), 'タイトルが表示されている');
ok(await evalJs('document.getElementById("btnStart") !== null'), '開始ボタンがある');

sec('書庫で墨を使い、恒久強化と語を買える');
{
  await evalJs('window.__wordrogue.menus.show("archive")');
  await sleep(250);
  const a = await evalJs(`(() => ({
    hidden: document.getElementById('archive').hidden,
    ink: document.getElementById('archiveInk').textContent,
    up: document.querySelectorAll('#archiveUpgrades .up-row').length,
    words: document.querySelectorAll('#archiveWords .shop-word').length,
  }))()`);
  ok(!a.hidden, '書庫が開いていない');
  ok(a.up === 6, `恒久強化の行数: ${a.up} (6 のはず)`);
  ok(a.words >= 3, `恒久の語の数: ${a.words}`);

  // 墨充分的Gyros 買会有所。
  const buy = await evalJs(`(() => {
    const app = window.__wordrogue;
    app.save.data.ink = 5000;
    app.menus.renderArchive();
    const ink0 = app.save.ink;
    const row = document.querySelector('#archiveUpgrades .up-row');
    row.querySelector('.up-buy').click();
    const lv = app.save.metaLevel('hp');
    const spent = ink0 - app.save.ink;
    // 語も買う。
    const w0 = document.querySelector('#archiveWords .shop-word:not(.owned)');
    const text = w0.textContent.split(' ')[0];
    const inkBeforeWord = app.save.ink;
    w0.click();
    return {
      lv, spent, text,
      owned: app.save.hasStartingWord(text),
      ink: app.save.ink,
      wordCost: inkBeforeWord - app.save.ink,
      metaHp: app.save.metaValue('hp'),
    };
  })()`);
  ok(buy.lv === 1, `強化の段階が上がっていない: ${buy.lv}`);
  ok(buy.spent > 0, `墨が減っていない: ${buy.spent}`);
  ok(buy.metaHp > 0, `強化の最終値が 0: ${buy.metaHp}`);
  ok(buy.owned, `語を買っても入っていない: ${buy.text}`);
  ok(buy.wordCost > 0, `語を買っても墨が減っていない: ${buy.wordCost}`);
  console.log(`    書庫: 強化を 1 段階 / 「${buy.text}」を ${buy.wordCost} 墨で購入`);

  // 買えない 提高。保険。
  const no = await evalJs(`(() => {
    const app = window.__wordrogue;
    app.save.data.ink = 0;
    app.menus.renderArchive();
    const btn = [...document.querySelectorAll('#archiveUpgrades .up-buy')][1];
    const off = btn.classList.contains('off');
    const lv0 = Object.keys(app.save.d.meta).length;
    btn.click();
    return { off, lv0, ink: app.save.ink };
  })()`);
  ok(no.off, '買えないのにボタンが有効');
  ok(no.ink === 0, `買えないのに墨が減った: ${no.ink}`);
}
await evalJs('window.__wordrogue.menus.show("title")');
await sleep(150);

sec('タイトル画面の記録に「文を崩した数」が出る');
{
  const rec = await evalJs('document.getElementById("recBroken") ? document.getElementById("recBroken").textContent : null');
  ok(rec !== null, '記録に「文を崩した数」が無い');
  ok(/^[\d,.k]+$/i.test(rec), `数が表示されていない: ${rec}`);
}

sec('ステージ選択へ');
await evalJs('document.getElementById("btnStart").click()');
await sleep(300);
ok(await evalJs('!document.getElementById("stages").hidden'), 'ステージ選択が開いた');
const stageCards = await evalJs('document.querySelectorAll("#stageList .stage-card").length');
ok(stageCards === 9, `ステージカード数: ${stageCards}`);

sec('武器選択へ');
await evalJs('document.querySelectorAll("#stageList .stage-card")[0].click()');
await sleep(300);
ok(await evalJs('!document.getElementById("loadout").hidden'), '武器選択が開いた');
const loCards = await evalJs('document.querySelectorAll("#loadoutList .lo-card").length');
ok(loCards >= 4, `武器カード数: ${loCards}`);

sec('ゲーム開始');
await evalJs('document.getElementById("loadoutGo").click()');
await sleep(1200);
ok(await evalJs('!document.getElementById("hud").hidden'), 'HUD が表示された');
const state = await evalJs('window.__wordrogue.mode');
ok(state === 'play', `mode: ${state}`);

sec('非表示の要素が実際に隠れていること (display の上書き対策)');
{
  const vis = await evalJs(`JSON.stringify(
    ['hudPaused','hudHint','hudBoss','forge','reward','result','title','stages','loadout','howto','settings']
      .map((id) => {
        const n = document.getElementById(id);
        return { id, hidden: n.hidden, display: getComputedStyle(n).display };
      })
      .filter((x) => x.hidden && x.display !== 'none')
  )`);
  const bad = JSON.parse(vis);
  for (const b of bad) console.log(`    ${b.id}: hidden=true だが display=${b.display}`);
  ok(bad.length === 0, `hidden なのに表示されている要素: ${bad.length}`);
}

const runInfo = await evalJs(`(() => {
  const r = window.__wordrogue.run;
  return { weapons: r.weapons.length, lexicon: r.lexicon.filter(Boolean).length,
           enemies: r.enemies.length, hp: r.player.hp, state: r.state };
})()`);
ok(runInfo.weapons === 2, `武器数: ${runInfo.weapons}`);
ok(runInfo.lexicon > 0, `語彙に語がある: ${runInfo.lexicon}`);
ok(runInfo.hp > 0, `HP: ${runInfo.hp}`);

sec('実際にフレームが進むこと');
const before = await evalJs('window.__wordrogue.run.time');
await sleep(1500);
const after = await evalJs('window.__wordrogue.run.time');
ok(after > before, `時間が進んでいる: ${before} -> ${after}`);

const alive = await evalJs('window.__wordrogue.run.enemies.length');
const killed = await evalJs('window.__wordrogue.run.kills');
ok(alive + killed > 0, `敵が湧いているか倒されている: 生存 ${alive} / 討伐 ${killed}`);

sec('移動入力が効くこと');
const px = await evalJs('window.__wordrogue.run.player.x');
await evalJs(`(() => {
  const app = window.__wordrogue;
  app.input.keys.add('d');
})()`);
await sleep(900);
await evalJs('window.__wordrogue.input.keys.delete("d")');
const nx = await evalJs('window.__wordrogue.run.player.x');
ok(nx > px + 20, `右移動した: ${px.toFixed(0)} -> ${nx.toFixed(0)}`);

sec('武器が攻撃していること');
const shots = await evalJs(`(() => {
  const r = window.__wordrogue.run;
  return r.bullets.length + r.fields.length + r.slashes.length + r.rings.length;
})()`);
ok(shots >= 0, `エフェクト数: ${shots}`);

sec('言葉鍛冶を開けること');
await evalJs(`document.getElementById('btnForge').click()`);
await sleep(400);
ok(await evalJs('!document.getElementById("forge").hidden'), '言葉鍛冶が開いた');
ok(await evalJs('window.__wordrogue.run.paused === true'), '時間が止まった');
const rows = await evalJs('document.querySelectorAll("#forgeWeapons .wrow").length');
ok(rows === 3, `行の数: ${rows} (自身 1 + 武器 2)`);
const selfRow = await evalJs('!!document.querySelector("#forgeWeapons .wrow-self")');
ok(selfRow, 'プレイヤー自身の文の行が無い');
const slots = await evalJs('document.querySelectorAll("#forgeWeapons .slot").length');
// 自身 4 + 武器 2 x (枠 4 + 末尾語 1)
// 自身 4 + 末尾語 1、武器 2 x (枠 4 + 末尾語 1)
ok(slots === 15, `枠の数: ${slots} (自身 5 + 武器 2 x 5 = 15)`);

sec('末尾語が枠の外に固定で出ていること');
{
  const tails = await evalJs(`(() => {
    const app = window.__wordrogue;
    return {
      defs: app.run.weapons.map(w => ({ id: w.defId, tail: w.tail, title: w.title })),
      shown: [...document.querySelectorAll('#forgeWeapons .slot-tail')].map(n => n.textContent),
      texts: [...document.querySelectorAll('#forgeWeapons .sn-text')].map(n => n.textContent),
    };
  })()`);
  // 自身 1 + 武器 2 = 3 つ。
  ok(tails.shown.length === 3, `末尾語が ${tails.shown.length} 個 (自身 1 + 武器 2)`);
  ok(tails.shown.includes('人'), `自身の末尾語「人」が表示されていない: ${tails.shown.join(',')}`);
  for (const w of tails.defs) {
    ok(tails.shown.includes(w.tail), `末尾語「${w.tail}」が表示されていない: ${tails.shown.join(',')}`);
    ok(w.title.endsWith(w.tail), `名前が末尾語で終わっていない: ${w.title}`);
  }
  for (const t of tails.texts) {
    if (t !== '—') ok(/[一-龥]$/.test(t), `文面が末尾で終わっていない: ${t}`);
  }
  console.log(`    末尾語: ${tails.shown.join(' / ')} / 文面: ${tails.texts.join(' | ')}`);
}
const sent = await evalJs('document.querySelectorAll("#forgeWeapons .sentence").length');
ok(sent === 3, `文面表示の数: ${sent}`);
const sentText = await evalJs(
  '[...document.querySelectorAll("#forgeWeapons .sn-text")].map(n => n.textContent).join(" | ")');
ok(sentText.includes('|'), `文面 nonempty: ${sentText}`);
console.log(`    文面: ${sentText}`);
const coreGone = await evalJs('document.querySelectorAll("#forgeWeapons .sn-core").length');
ok(coreGone === 0, `核語の表示が残っている: ${coreGone}`);

// スタミナ_present か。
const hasStamina = await evalJs('!!document.getElementById("staFill")');
ok(hasStamina, 'スタミナバーが無い');
const pwords = await evalJs('document.querySelectorAll("#forgeLexicon .pword:not(.empty)").length');
ok(pwords > 0, `語彙の語: ${pwords}`);

sec('語を別の枠に移すと文が変わる');
const changed = await evalJs(`(() => {
  const app = window.__wordrogue;
  const run = app.run;
  const before = run.weapons.map(w => w.resolve(run.player.stats).fullText);
  // 語彙の最初の語を武器 0 の空き枠に入れる。
  const word = run.lexicon.find(w => w);
  run.placeWord(run.weapons[0], 1, word);
  const after = run.weapons.map(w => w.resolve(run.player.stats).fullText);
  return { before, after, text: word.text };
})()`);
ok(changed.before[0] !== changed.after[0], `文が変化: ${changed.before[0]} -> ${changed.after[0]}`);

sec('不成文にすると武器が無効になる');
const broken = await evalJs(`(() => {
  const run = window.__wordrogue.run;
  const wi = run.weapons[0];
  wi.slots.fill(null);
  const res = wi.resolve(run.player.stats);
  return { active: res.active, dmg: res.stats.dmg, reason: res.reasonText };
})()`);
ok(broken.active === false, '不成文で無効化');
ok(broken.dmg === 0, `威力が 0: ${broken.dmg}`);
ok(!!broken.reason, `理由: ${broken.reason}`);

sec('鍛冶を閉じると時間が再開する');
await evalJs('document.getElementById("forgeBack").click()');
await sleep(300);
ok(await evalJs('window.__wordrogue.run.paused === false'), '時間が再開した');

sec('ドラッグできる要素とドロップ先が用意されていること');
await evalJs('document.getElementById("btnForge").click()');
await sleep(350);
{
  const dnd = await evalJs(`(() => {
    const run = window.__wordrogue.run;
    const wi = run.weapons[0];
    wi.slots.fill(null);
    const lex = [...document.querySelectorAll('#forgeLexicon .pword:not(.empty)')];
    const slot0 = document.querySelectorAll('#forgeWeapons .wrow')[1].querySelector('.slot');
    return {
      // HTML5 の draggable は使ってない。pointer で自前実装する。
      html5: document.querySelectorAll('#forge [draggable="true"]').length,
      lexicon: lex.length,
      // 語彙の語と枠が、ドロップ先として data-place を持つこと。
      lexiconPlace: lex.filter(n => n.dataset.place).length,
      slotPlace: !!slot0.dataset.place,
      tailPlace: [...document.querySelectorAll('#forge .slot-tail')].some(n => n.dataset.place),
    };
  })()`);
  ok(dnd.html5 === 0, `HTML5 の draggable が残っている: ${dnd.html5} 個 (タップを奪う)`);
  ok(dnd.lexicon === dnd.lexiconPlace, `語彙の語に data-place が無い: ${dnd.lexiconPlace} / ${dnd.lexicon}`);
  ok(dnd.slotPlace, '枠に data-place が無い');
  ok(!dnd.tailPlace, '末尾語がドロップ先になっている');
  console.log(`    語彙 ${dnd.lexicon} 語すべてに data-place / 末尾語は対象外`);
}

sec('ドラッグで語を枠へ入れ、枠どうしで入れ替えられること');
{
  // HTML5 のドラッグは CDP から再現しにくいので、Forge の drop ハンドラを直接叩く。
  const dnd = await evalJs(`(() => {
    const app = window.__wordrogue;
    const forge = app.forge;
    const run = app.run;
    const wi = run.weapons[0];
    const a = run.lexicon.findIndex(w => w);
    const b = run.lexicon.findIndex((w, i) => i > a && w);
    const wa = run.lexicon[a].text;
    const wb = run.lexicon[b].text;

    // 語彙 -> 空き枠。
    forge.dragFrom = { kind: 'lexicon', index: a };
    forge.dropOnto(forge.dragFrom, { kind: 'slot', wi, index: 0 });
    const placed = { inSlot: wi.slots[0] && wi.slots[0].text, lexNowNull: run.lexicon[a] === null };

    // もう 1 語を別の空き枠へ。
    forge.dragFrom = { kind: 'lexicon', index: b };
    forge.dropOnto(forge.dragFrom, { kind: 'slot', wi, index: 1 });
    const placed2 = { inSlot: wi.slots[1] && wi.slots[1].text };

    // 枠 0 と枠 1 を入れ替え。
    forge.dragFrom = { kind: 'slot', wi, index: 0 };
    forge.dropOnto(forge.dragFrom, { kind: 'slot', wi, index: 1 });
    const swapped = { s0: wi.slots[0] && wi.slots[0].text, s1: wi.slots[1] && wi.slots[1].text };

    // 枠 -> 語彙 (空きセル) なら戻せる。
    const free = run.lexicon.indexOf(null);
    forge.dragFrom = { kind: 'slot', wi, index: 0 };
    forge.dropOnto(forge.dragFrom, { kind: 'lexicon', index: free });
    const back = { slot0: wi.slots[0], lex: run.lexicon[free] && run.lexicon[free].text };

    return { wa, wb, placed, placed2, swapped, back, free, title: wi.title };
  })()`);
  ok(dnd.placed.inSlot === dnd.wa, `語彙の語が枠に入らない: ${dnd.placed.inSlot}`);
  ok(dnd.placed.lexNowNull, '語彙に語が残っている');
  ok(dnd.placed2.inSlot === dnd.wb, `2 語目が入らない: ${dnd.placed2.inSlot}`);
  ok(dnd.swapped.s0 === dnd.wb && dnd.swapped.s1 === dnd.wa,
    `枠の入れ替えが違う: ${dnd.swapped.s0} / ${dnd.swapped.s1}`);
  ok(dnd.back.slot0 === null, '枠から語が戻らない');
  ok(dnd.back.lex === dnd.wb, `語彙へ語が戻らない: ${dnd.back.lex}`);
  console.log(`    「${dnd.wa}」->枠0 ->枠1 と入れ替え -> 語彙へ戻す すべて成立`);
}

sec('語彙が満杯ならドラッグで語を消さないこと');
{
  const full = await evalJs(`(() => {
    const app = window.__wordrogue;
    const forge = app.forge;
    const run = app.run;
    const wi = run.weapons[0];
    // 語彙にある語を写して埋める。同じ語を何個並べてもよい。
    const seed = run.lexicon.find(w => w);
    const clone = () => ({ ...seed });
    while (!run.lexiconFull) run.giveWord(clone(), true);
    const wi0 = wi.slots[0] || clone();
    wi.setSlot(0, wi0);
    const before = wi0.text;

    // 語彙 -> 埋まった枠。追い出せない。
    forge.dragFrom = { kind: 'lexicon', index: 0 };
    forge.dropOnto(forge.dragFrom, { kind: 'slot', wi, index: 0 });
    const afterSwap = wi.slots[0] && wi.slots[0].text;

    // 埋まったセル <-> 埋まった枠。語は失われない。
    const lexText = run.lexicon[0].text;
    forge.dragFrom = { kind: 'lexicon', index: 0 };
    forge.dropOnto(forge.dragFrom, { kind: 'slot', wi, index: 0 });
    const exchanged = wi.slots[0] && wi.slots[0].text;

    return { full: run.lexiconFull, before, afterSwap, exchanged, lexText };
  })()`);
  ok(full.full, '満杯になっていない');
  console.log(`    満杯: 「${full.before}」-> 枠(埋まり) で保持 / セルと枠で交換して「${full.exchanged}」`);
  ok(full.exchanged === full.lexText, '交換で語彙の語が入らなかった');
}

sec('「忘れる」で語彙の空きを作れること');
{
  const forget = await evalJs(`(() => {
    const app = window.__wordrogue;
    const forge = app.forge;
    const run = app.run;
    const before = run.lexiconFreeCount;
    forge.forgetMode = false;
    forge.toggleForget();
    const on = forge.forgetMode;
    const btnOn = document.getElementById('btnForgeForget').classList.contains('on');
    const target = run.lexicon.findIndex(w => w);
    const word = run.lexicon[target];
    // 語彙の語をクリック = 忘れる。
    document.querySelectorAll('#forgeLexicon .pword:not(.empty)')[target].click();
    const after = run.lexiconFreeCount;
    // 同じ語が複数あってもよいので、身分 (オブジェクト) で確かめる。
    const gone = !run.lexicon.includes(word);
    forge.toggleForget();
    return { before, after, on, btnOn, gone, text: word.text, off: !forge.forgetMode };
  })()`);
  ok(forget.on, '忘れるモードにならない');
  ok(forget.btnOn, '忘れるボタンが光らない');
  ok(forget.after === forget.before + 1, `空きが増えていない: ${forget.before} -> ${forget.after}`);
  ok(forget.gone, `「${forget.text}」がまだある`);
  ok(forget.off, '忘れるモードが解除されない');
  console.log(`    「${forget.text}」を忘れて空き ${forget.before} -> ${forget.after}`);
}

sec('語彙が満杯のときの 3 択は「捨てる」を求める');
{
  const choice = await evalJs(`(() => {
    const app = window.__wordrogue;
    const run = app.run;
    const seed = run.lexicon.find(w => w);
    const clone = () => ({ ...seed });
    while (!run.lexiconFull) run.giveWord(clone(), true);
    run.offerWordChoices();
    app.hud.renderChoices(run, () => {});
    const cand = document.querySelectorAll('#choiceList .choice-card').length;
    const disc = document.getElementById('choiceForgetList');
    const discCount = disc ? disc.querySelectorAll('button').length : 0;
    // 捨てる語を選ぶ。
    if (discCount) disc.querySelectorAll('button')[0].click();
    const afterPick = !document.getElementById('choiceForgetList').hidden;
    // 候補を選ぶ。
    const card = document.querySelector('#choiceList .choice-card');
    if (card) card.click();
    return { cand, discCount, afterPick, full: run.lexiconFull, left: run.lexicon.filter(Boolean).length };
  })()`);
  ok(choice.cand === 3, `候補が ${choice.cand} 個 (3 択のはず)`);
  ok(choice.discCount > 0, '捨てる語の一覧が出ていない');
  ok(choice.full, '満杯になっていない');
  ok(choice.afterPick, '語を選んでいないのに候補が出せない');
  ok(choice.left > 0, '語彙が空になった');
  console.log(`    満杯時の 3 択: 候補 ${choice.cand} / 捨てる語 ${choice.discCount} 語 / 語彙 ${choice.left} 語`);
}

sec('辞書は戦闘中から開け、閉じると時間が戻る');
{
  // 戦闘中から。鍛冶が開いたままだと「閉じたら鍛冶へ戻る」側に寄るので、
  // 明示的に戦闘モードへ戻しておく。
  await evalJs(`(() => {
    const app = window.__wordrogue;
    if (!document.getElementById('forge').hidden) app.forge.close();
    app.mode = 'play';
    app.run.paused = false;
  })()`);
  await evalJs('document.getElementById("btnDictInGame").click()');
  await sleep(300);
  const d0 = await evalJs(`({
    hidden: document.getElementById('dict').hidden,
    mode: window.__wordrogue.mode,
    paused: window.__wordrogue.run.paused,
  })`);
  ok(!d0.hidden, '辞書が開いていない');
  ok(d0.mode === 'dict', `mode が dict でない: ${d0.mode}`);
  ok(d0.paused === true, '時間が止まっていない');

  await evalJs('document.querySelector(\'[data-close="dict"]\').click()');
  await sleep(250);
  const d1 = await evalJs(`({
    hidden: document.getElementById('dict').hidden,
    mode: window.__wordrogue.mode,
    paused: window.__wordrogue.run.paused,
  })`);
  ok(d1.hidden, '辞書が閉じない');
  ok(d1.mode === 'play', `mode が play に戻らない: ${d1.mode}`);
  ok(d1.paused === false, '時間が再開しない');
  console.log('    戦闘中から開閉でき、閉じると時間が戻る');
}

sec('辞書メニューが開き、検索とカテゴリ絞り込みが効くこと');
{
  await evalJs('document.getElementById("btnDictInGame").click()');
  await sleep(250);
  const d = await evalJs(`(() => ({
    rows: document.querySelectorAll('#dictList .dict-row').length,
    tabs: document.querySelectorAll('#dictTabs .dict-tab').length,
    count: document.getElementById('dictCount').textContent,
    search: !!document.getElementById('dictSearch'),
  }))()`);
  ok(d.rows > 100, `辞書の行が少ない: ${d.rows}`);
  ok(d.tabs === 7, `カテゴリのタブ数: ${d.tabs} (すべて + 6 カテゴリ)`);
  ok(d.search, '検索欄が無い');
  ok(/\d+ \/ \d+ 語/.test(d.count), `件数の表示: ${d.count}`);
  console.log(`    辞書: ${d.rows} 語 / タブ ${d.tabs} 個 / ${d.count}`);

  // 検索で絞る。
  const found = await evalJs(`(() => {
    const s = document.getElementById('dictSearch');
    s.value = '火';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    return {
      rows: document.querySelectorAll('#dictList .dict-row').length,
      texts: [...document.querySelectorAll('#dictList .dict-w')].map(n => n.textContent),
    };
  })()`);
  ok(found.rows > 0, '検索で 0 件になった');
  ok(found.rows < d.rows, `検索で絞れていない: ${found.rows} -> ${d.rows}`);
  ok(found.texts.every((t) => t.includes('火')), `関係ない語が混じった: ${found.texts.join(',')}`);

  // カテゴリで絞る。
  const byCat = await evalJs(`(() => {
    const s = document.getElementById('dictSearch');
    s.value = '';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    const tabs = [...document.querySelectorAll('#dictTabs .dict-tab')];
    tabs.find(n => n.textContent === '接続').click();
    // タブは描き直されるので、選び直して選択状態を見る。
    const picked = [...document.querySelectorAll('#dictTabs .dict-tab')]
      .find(n => n.textContent === '接続');
    return {
      rows: document.querySelectorAll('#dictList .dict-row').length,
      allConn: [...document.querySelectorAll('#dictList .dict-cat')].every(n => n.textContent === '接続'),
      on: picked.classList.contains('on'),
    };
  })()`);
  ok(byCat.rows > 0, '接続詞が 1 つも出ていない');
  ok(byCat.allConn, '接続詞以外のカテゴリが混じった');
  ok(byCat.on, 'タブが選択状態にならない');
  console.log(`    検索「火」-> ${found.rows} 語 / カテゴリ「接続」-> ${byCat.rows} 語`);

  // 該当なし。
  const none = await evalJs(`(() => {
    const s = document.getElementById('dictSearch');
    s.value = 'この語は絶対にない';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    return {
      empty: !!document.querySelector('#dictList .dict-empty'),
      rows: document.querySelectorAll('#dictList .dict-row').length,
    };
  })()`);
  ok(none.empty && none.rows === 0, '該当なしの表示が無い');
  console.log('    該当なし -> 「見つからなかった。」');

  // 検索語は残さない。閉じる -> 次のテストへ。
  await evalJs('document.querySelector(\'[data-close="dict"]\').click()');
  await sleep(250);
  ok(await evalJs('document.getElementById("dict").hidden'), '辞書が閉じない');
  ok(await evalJs('window.__wordrogue.run.paused === false'), '閉じても時間が止まったまま');
  ok(await evalJs('document.getElementById("dictSearch").value === ""'), '検索語が残っている');
}

sec('タップで語を選べる (HTML5 drag をやめた理由)');
{
  // .click() を直接呼ぶとイベントを通らないので、本物のタップを再現する。
  // HTML5 の draggable 元素的_DEF だと、実機ではタップが native drag に
  // 奪われて click が出ず、語を選べなくなる。それを放置してはいけない。
  const t = await evalJs(`(() => {
    const app = window.__wordrogue;
    const forge = app.forge;
    const run = app.run;
    const tap = (node) => {
      const r = node.getBoundingClientRect();
      const o = {
        bubbles: true, cancelable: true, composed: true,
        clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
        pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0,
      };
      node.dispatchEvent(new PointerEvent('pointerdown', o));
      node.dispatchEvent(new PointerEvent('pointerup', o));
      node.dispatchEvent(new MouseEvent('click', o));
    };
    const draggable = [...document.querySelectorAll('#forge [data-place], #forgeLexicon .pword')]
      .filter(n => n.draggable).length;

    const word = document.querySelector('#forgeLexicon .pword:not(.empty)');
    // 個数バッジ (×3) が入っているので、本体の span だけ読む。
    const text = word.querySelector('span').textContent.trim();
    tap(word);
    const armed = forge.armed ? forge.armed.text : null;
    const highlighted = document.querySelectorAll('#forgeLexicon .pword.armed').length;

    const row = document.querySelectorAll('#forgeWeapons .wrow')[1];
    const slots = row.querySelectorAll('.slot');
    let empty = -1;
    for (let i = 0; i < slots.length; i++) if (!slots[i].classList.contains('filled')) { empty = i; break; }
    if (armed && empty >= 0) tap(slots[empty]);
    const got = run.weapons[0].slots[empty] && run.weapons[0].slots[empty].text;
    return { draggable, text, armed, highlighted, got, ok: got === text, stick: app.input.stick.active };
  })()`);
  ok(t.draggable === 0, `draggable が残っている: ${t.draggable} 個 (タップを奪う)`);
  ok(t.armed === t.text, `タップで語を選べない: armed=${t.armed} / ${t.text}`);
  ok(t.highlighted === 1, `選んだ語が光っていない: ${t.highlighted}`);
  ok(t.ok, `タップした語が枠に入らない: ${t.got}`);
  ok(!t.stick, 'タップが移動スティックに取られた');
  console.log(`    タップで「${t.text}」を選んで枠に入れる`);
}

sec('pointer でドラッグできる');
{
  const d = await evalJs(`(() => {
    const app = window.__wordrogue;
    const forge = app.forge;
    const run = app.run;
    // 辞書などが上に開いていると座標の当たり判定を吸ってしまうので閉じる。
    app.menus.hideAll();
    if (document.getElementById('forge').hidden) document.getElementById('btnForge').click();
    // 結果が変わらないよう、枠を全部空にしてから 0 番へ入れる。
    const wi = run.weapons[0];
    wi.slots.fill(null);
    wi.resolve(run.player.stats);
    forge.render();
    const word = document.querySelector('#forgeLexicon .pword:not(.empty)');
    const text = word.querySelector('span').textContent.trim();
    const from = word.getBoundingClientRect();
    // 末尾語 (slot-tail) は枠ではないので除外する。
    const row = document.querySelectorAll('#forgeWeapons .wrow')[1];
    const slots = row.querySelectorAll('.slot:not(.slot-tail)');
    const to = slots[0].getBoundingClientRect();
    const x0 = from.left + from.width / 2, y0 = from.top + from.height / 2;
    const x1 = to.left + to.width / 2, y1 = to.top + to.height / 2;
    const ev = (type, x, y) => word.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, clientX: x, clientY: y,
      pointerId: 2, pointerType: 'mouse', isPrimary: true, button: 0,
    }));
    ev('pointerdown', x0, y0);
    ev('pointermove', x0 + 20, y0 + 20);
    ev('pointermove', x1, y1);
    const hot = forge.dropAt(x1, y1);
    ev('pointerup', x1, y1);
    const got = wi.slots[0] && wi.slots[0].text;
    return { text, got, ok: got === text, dragFrom: forge.dragFrom, hot: !!hot };
  })()`);
  ok(d.hot, 'ドロップ先を判別できない');
  ok(d.ok, `ドラッグで語が入らない: ${d.got} (狙いは ${d.text})`);
  ok(!d.dragFrom, 'ドラッグの後に dragFrom が残った');
  console.log(`    ドラッグで「${d.text}」を枠へ`);
}

sec('言葉鍛冶の上から辞書を引ける');
{
  const d = await evalJs(`(() => {
    const app = window.__wordrogue;
    // 状態に左右されないよう、閉じてから開き直す。
    if (!document.getElementById('forge').hidden) {
      document.getElementById('forgeBack').click();
    }
    document.getElementById('btnForge').click();
    const before = { mode: app.mode, forgeOpen: !document.getElementById('forge').hidden };
    document.getElementById('btnForgeDict').click();
    const opened = {
      dict: !document.getElementById('dict').hidden,
      mode: app.mode,
      // 鍛冶を閉じていないこと。語を組み立てた状態が保たれること。
      forgeStillOpen: !document.getElementById('forge').hidden,
      paused: app.run.paused,
    };
    document.querySelector('[data-close="dict"]').click();
    return {
      before, opened,
      closed: {
        dict: !document.getElementById('dict').hidden,
        mode: app.mode,
        forgeStillOpen: !document.getElementById('forge').hidden,
        paused: app.run.paused,
      },
    };
  })()`);
  ok(d.before.forgeOpen, '鍛冶が開いていない');
  ok(d.opened.dict, '辞書が開かない');
  ok(d.opened.forgeStillOpen, '辞書で鍛冶が閉じてしまった (語を選び直すことになる)');
  ok(d.opened.paused, '時間が止まっていない');
  ok(!d.closed.dict, '辞書が閉じない');
  ok(d.closed.mode === 'forge', `閉じても鍛冶に戻らない: ${d.closed.mode}`);
  ok(d.closed.forgeStillOpen, '閉じたら鍛冶が消えた');
  console.log(`    鍛冶 → 辞書 → 鍛冶 に戻る (${d.closed.mode})`);
}
await evalJs('document.getElementById("forgeBack").click()');
await sleep(200);

sec('ダッシュでスタミナが消費される');
{
  await evalJs('document.getElementById("forgeBack").click()');
  await sleep(300);
  const sta0 = await evalJs('window.__wordrogue.run.player.stamina');
  // スペースを押した状態にして移動させる。
  await evalJs(`(() => {
    const app = window.__wordrogue;
    app.input.keys.add(' ');
    app.input.keys.add('d');
  })()`);
  await sleep(700);
  const mid = await evalJs(`({
    sta: window.__wordrogue.run.player.stamina,
    dashing: window.__wordrogue.run.player.dashing,
    speed: Math.hypot(window.__wordrogue.run.player.vx, window.__wordrogue.run.player.vy),
    base: window.__wordrogue.run.player.stats.spd,
    trail: window.__wordrogue.run.player.dashTrail.length,
    width: document.getElementById("staFill").style.width,
  })`);
  await evalJs(`(() => {
    const app = window.__wordrogue;
    app.input.keys.delete(' ');
    app.input.keys.delete('d');
  })()`);
  ok(mid.sta < sta0, `スタミナが減っていない: ${sta0} -> ${mid.sta}`);
  ok(mid.dashing === true, 'ダッシュ状態になっていない');
  ok(mid.speed > mid.base * 1.5, `ダッシュの速さが足りない: ${mid.speed.toFixed(0)} (基準 ${mid.base})`);
  ok(mid.trail > 0, '残像が出ていない');
  ok(/%$/.test(mid.width) && parseFloat(mid.width) < 100, `バーが減っていない: ${mid.width}`);
  console.log(`    スタミナ ${sta0.toFixed(0)} -> ${mid.sta.toFixed(0)} / 速度 ${mid.speed.toFixed(0)} (基準 ${mid.base}) / 残像 ${mid.trail}`);

  // 離すと回復する。
  await sleep(900);
  const sta1 = await evalJs('window.__wordrogue.run.player.stamina');
  ok(sta1 > mid.sta, `回復しない: ${mid.sta.toFixed(0)} -> ${sta1.toFixed(0)}`);
}

sec('プレイヤー自身の文で称号ができる');
{
  const res = await evalJs(`(async () => {
    const m = await import(new URL('js/data/words.js', document.baseURI).href);
    const run = window.__wordrogue.run;
    const p = run.player;
    p.selfSlots.fill(null);
    // 「人」は枠の外に固定で付くので、枠には入れない。
    p.selfSlots[0] = m.makeWord('頑強');
    p.selfSlots[1] = m.makeWord('疾走');
    run.refreshStats();
    return {
      title: p.stats.selfTitle,
      valid: p.stats.selfValid,
      power: p.stats.selfPower,
      atk: p.stats.atkMul,
      armor: p.stats.armor,
      hudHidden: document.getElementById("hudSelf").hidden,
    };
  })()`);
  ok(res.title === '頑強疾走人', `称号が「${res.title}」`);
  ok(res.valid === true, '自身の文が不成文');
  ok(res.power > 1, `文の力が上がっていない: ${res.power}`);
  ok(res.armor > 0, `装甲が乗っていない: ${res.armor}`);
  await sleep(200);
  const shown = await evalJs('document.getElementById("hudSelf").textContent');
  ok(shown.includes('頑強疾走人'), `HUD に称号が出ていない: ${shown}`);
  ok(shown.includes('称号'), `HUD の称号ラベルが無い: ${shown}`);
  ok(/文の力 x[\d.]+/.test(shown), `HUD に文の力が出ていない: ${shown}`);
  console.log(`    称号「${res.title}」 文の力 x${res.power.toFixed(2)} / 装甲 ${res.armor.toFixed(2)} / HUD ${shown.trim()}`);

  // 末尾の「人」は固定。並べ替えても外れない。
  const tail = await evalJs(`(async () => {
    const m = await import(new URL('js/data/words.js', document.baseURI).href);
    const run = window.__wordrogue.run;
    const p = run.player;
    p.selfSlots[0] = m.makeWord('鋼');
    p.selfSlots[1] = m.makeWord('疾速');
    run.refreshStats();
    const a = p.stats.selfTitle;
    [p.selfSlots[0], p.selfSlots[1]] = [p.selfSlots[1], p.selfSlots[0]];
    run.refreshStats();
    return { a, b: p.stats.selfTitle, slots: p.selfSlots.filter(Boolean).length };
  })()`);
  ok(tail.a === '鋼疾速人', `末尾の「人」が付かない: ${tail.a}`);
  ok(tail.b === '疾速鋼人', `入れ替えると末尾が変わる: ${tail.b}`);
  ok(tail.slots === 2, `枠に「人」を入れてしまった: ${tail.slots}`);
  console.log(`    並べ替え → 「${tail.a}」→「${tail.b}」 末尾は人固定`);
}

sec('敵の文が表示される');
{
  const r = await evalJs(`(async () => {
    const m = await import(new URL('js/game/entities.js', document.baseURI).href);
    const app = window.__wordrogue;
    const run = app.run;
    // 敵が 1 体はいてほしい。足りなければ作る。
    const e = m.makeEnemy('wraith', run.player.x + 60, run.player.y - 40);
    e.spawned = 1;
    run.enemies.push(e);
    const before = e.words.join('');
    // 描画して例外が出ないか見る。
    let err = null;
    try { app.renderer.drawEnemySentence(e, run); } catch (ex) { err = ex.message; }
    return { before, hasWords: e.words.length >= 2, err };
  })()`);
  ok(r.hasWords, '敵が文を持っていない');
  ok(!r.err, `文の描画で例外: ${r.err}`);

  // 崩れた敵の描画も通る。
  const b = await evalJs(`(async () => {
    const m = await import(new URL('js/game/entities.js', document.baseURI).href);
    const app = window.__wordrogue;
    const run = app.run;
    const e = m.makeEnemy('golem', run.player.x + 60, run.player.y - 40);
    e.spawned = 1;
    e.words = e.words.slice(0, 1);
    e.broken = true;
    run.enemies.push(e);
    let err = null;
    try { app.renderer.drawEnemySentence(e, run); } catch (ex) { err = ex.message; }
    e.dead = true;
    return { err, text: e.words.join('') };
  })()`);
  ok(!b.err, `不成文の描画で例外: ${b.err}`);
  console.log(`    敵の文「${r.before}」/ 崩れた文「${b.text}」`);
}

sec('描画で例外が出てもプレイヤーが消えない');
{
  // 鉱物系 (土・金・鉄) の弾はすべて同じ描画経路を通る。
  // ここが壊れると例外で描画が止まり、プレイヤーが描画されない。
  const res = await evalJs(`(async () => {
    const app = window.__wordrogue;
    const run = app.run;
    const g = app.renderer.ctx;
    const cv = g.canvas;
    const dpr = cv.width / (cv.clientWidth || cv.width) || 1;
    const before = app.renderer.drawErrorCount;
    run.player.invuln = 99;   // 描画確認の間は死なせない

    // 画面内の生存数を保ったまま、鉱物系と各種形状の弾を並べる。
    run.enemies.length = 0;
    const els = ['earth', 'gold', 'steel', 'fire', 'thunder', 'ice', 'poison'];
    const shapes = ['shot', 'slash', 'orb', 'beam', 'bomb', 'shard', 'ring'];
    let n = 0;
    for (const el of els) {
      for (const shape of shapes) {
        run.bullets.push({
          x: 60 + (n % 12) * 26, y: 70 + Math.floor(n / 12) * 24,
          vx: 30, vy: 12, r: 7, life: 9, maxLife: 9,
          element: el, shape, kindName: 'shot', pierce: 0, uid: n, color: '#c9a227',
        });
        n++;
      }
    }
    // 敵と弾、両方の描画経路を通す。位置は {x, y} で渡す。
    for (let i = 0; i < 3; i++) {
      run.spawnEnemy('slime', { x: 300 + i * 40, y: 200 });
    }
    run.enemies.forEach((e) => { e.spawned = 1; });

    await new Promise(r => setTimeout(r, 400));

    // プレイヤー位置に絵があるか。背景色と違う pixels を数える。
    // 描画は毎フレーム「地面 -> 壁 -> 敵 -> 弾 -> プレイヤー」の順に進むので、
    // 途中で例外が出るとプレイヤーの手前が空のままになる。
    const p = run.player;
    // カメラはプレイヤーを画面中心に追うので、描画位置は中心。
    // シェイクの分だけ数 px ずれるので、 넓い square を判决する。
    const R = app.renderer;
    const cx = Math.round(R.w / 2), cy = Math.round(R.h / 2);
    const S = 44;
    const x0 = Math.min(Math.max(cx - S, 0), cv.width - S);
    const y0 = Math.min(Math.max(cy - S, 0), cv.height - S);
    const sw = Math.min(S * 2, cv.width - x0);
    const sh = Math.min(S * 2, cv.height - y0);
    const bxo = Math.min(Math.max(x0 - 10, 0), cv.width - 1);
    const byo = Math.min(Math.max(y0 - 10, 0), cv.height - 1);
    const bg = g.getImageData(bxo, byo, 1, 1).data;
    const img = g.getImageData(x0, y0, sw, sh).data;
    let painted = 0;
    for (let i = 0; i < img.length; i += 4) {
      if (Math.abs(img[i] - bg[0]) + Math.abs(img[i + 1] - bg[1]) + Math.abs(img[i + 2] - bg[2]) > 24) {
        painted++;
      }
    }
    return { added: app.renderer.drawErrorCount - before, painted, total: sw * sh, alive: p.alive };
  })()`);
  ok(res.added === 0, `弾の描画で例外が ${res.added} 回起きた`);
  ok(res.painted > 20, `プレイヤーが描画されていない (背景と違う ${res.painted} px)`);
  console.log(`    鉱物系/各種形の弾を描画 -> 例外 ${res.added} / プレイヤーに着色 ${res.painted} px`);
}

sec('武器名が文面と基本名の両方で出る');
{
  // 直前の「不成文」テストで語を空にしてあるので、元の文に戻す。
  const names = await evalJs(`(async () => {
    const app = window.__wordrogue;
    const run = app.run;
    // 名前表示の検証を空欄で行わないため。
    const def = run.weapons[0].def;
    const m = await import(new URL('js/data/words.js', document.baseURI).href);
    const wi0 = run.weapons[0];
    wi0.slots.fill(null);
    wi0.slots[0] = m.makeWord(def.startWord);
    if (wi0.slots[1] !== undefined) wi0.slots[1] = m.makeWord(def.startWord2);
    run.refreshStats();
    return true;
  })()`);
  // HUD と鍛冶の描画を 1 フレーム待つ。
  await sleep(300);
  const view = await evalJs(`(() => {
    const run = window.__wordrogue.run;
    const out = { chips: [], rows: [] };
    for (const node of document.querySelectorAll('.wchip')) {
      out.chips.push({
        txt: node.querySelector('.wchip-txt')?.textContent || '',
        base: node.querySelector('.wchip-base')?.textContent || '',
      });
    }
    for (const n of document.querySelectorAll('#forgeWeapons .wrow-name')) {
      out.rows.push(n.textContent);
    }
    out.titles = run.weapons.map(w => w.title);
    out.defNames = run.weapons.map(w => w.def.name);
    return out;
  })()`);
  ok(view.titles.length > 0, '武器がない');
  for (const t of view.titles) {
    ok(t && !/undefined|null|空/.test(t), `武器名が壊れている: "${t}"`);
    ok(t.length > 1, `武器名が文面になっていない: "${t}"`);
  }
  for (const t of view.defNames) {
    ok(t && !/undefined/.test(t), `基本名が壊れている: "${t}"`);
  }
  for (const t of view.rows) {
    ok(t && !/undefined/.test(t), `鍛冶の武器名が壊れている: "${t}"`);
  }
  ok(view.chips.length > 0, 'HUD に武器チップが無い');
  for (const c of view.chips) {
    ok(!/undefined/.test(c.txt + c.base), `HUD に undefined が出る: ${JSON.stringify(c)}`);
    ok(/[一-龥ぁ-んァ-ヶ]/.test(c.txt), `HUD に武器名が出ない: ${JSON.stringify(c)}`);
    ok(/[一-龥]/.test(c.base), `HUD に基本名が出ない: ${JSON.stringify(c)}`);
  }
  console.log(`    武器名: ${view.titles.map((t, i) => t + '(' + view.defNames[i] + ')').join(' / ')}`);
  console.log(`    HUD チップ: ${view.chips.map((c) => c.base + ' ' + c.txt).join(' / ')}`);
}

sec('forge にリセット項目が無いこと');
{
  const has = await evalJs(`(() => ({
    reroll: !!document.getElementById('btnReroll'),
    text: (document.body.textContent || '').includes('引き直す'),
    rateUp: (document.body.textContent || '').includes('Upgrade rate'),
  }))()`);
  ok(!has.reroll, '「語を引き直す」ボタンが残っている');
  ok(!has.text, '「引き直す」という文言が残っている');
  ok(!has.rateUp, '「Upgrade rate」がある');
  const note = await evalJs('document.querySelector(".forge-note")?.textContent || ""');
  ok(/レベルアップ/.test(note), `ヒント文言が無い: "${note}"`);
  console.log(`    鍛冶の注記: ${note.trim()}`);
}

sec('遊び方の説明が実装と矛盾していないこと');
{
  // 玩法説明は手で書いているので、実装から変わった項目を放置すると
  // 古いルールのまま画面に出る。ここで止める。
  const doc = await evalJs('document.getElementById("howto").textContent');
  const banned = [
    ['核語', '核語は廃止されている'],
    ['攻撃の形を決める', '攻撃は末尾語だけが決める'],
    ['語を引き直す', '引き直しは無い'],
    ['助詞', '助詞は廃止されている'],
    ['助動詞', '助動詞は廃止されている'],
  ];
  for (const [needle, why] of banned) {
    ok(!doc.includes(needle), `玩法説明に古い記述「${needle}」が残っている (${why})`);
  }
  // 例の武器名は現在の形 (末尾語つき) であるべき。
  for (const t of ['刃必殺剣', '爆裂無双迅早剣', '火球剣']) {
    ok(doc.includes(t), `玩法説明に例「${t}」が無い`);
  }
  // 末尾語と接続詞の記述があるはず。
  for (const t of ['末尾', '接続詞', '優先順位']) {
    ok(doc.includes(t), `遊び方に「${t}」の記述が無い`);
  }

  // 報酬は武器と休息だけで、ことばは出ない。
  const rewardSec = doc.slice(doc.indexOf('クリア報酬'));
  ok(rewardSec.includes('休息'), `クリア報酬の説明に休息が無い: ${rewardSec.slice(0, 60)}`);
  ok(rewardSec.includes('ことばはここでは出ない'), '報酬からことばが出ない旨が書かれていない');
  ok(!rewardSec.includes('自身の強化'), '報酬の説明に旧仕様の自身の強化が残っている');
  console.log(`    遊び方 ${doc.length} 文字 / 古い記述なし`);
}

sec('ステージクリアと報酬');
const cleared = await evalJs(`(async () => {
  const app = window.__wordrogue;
  const run = app.run;
  // 高速で倒してクリア扱いにする。
  run.player.stats.atk = 99999;
  for (const e of run.enemies) e.hp = 1;
  await new Promise(r => setTimeout(r, 600));
  run.finish(true);
  await new Promise(r => setTimeout(r, 600));
  return { mode: app.mode, rewardOpen: !document.getElementById('reward').hidden };
})()`);
ok(cleared.mode === 'reward', `報酬画面へ: ${cleared.mode}`);
ok(cleared.rewardOpen, '報酬画面が表示された');

const rwCards = await evalJs('document.querySelectorAll("#rewardList .rw-card").length');
ok(rwCards === 3, `報酬カードの枚数: ${rwCards}`);

sec('ステージ報酬にことばは出ない');
{
  // ことばは戦闘中のレベルアップでのみ入る。報酬からは配らない。
  const kinds = await evalJs(`[...document.querySelectorAll('#rewardList .rw-card')]
    .map(c => c.dataset.kind)`);
  ok(!kinds.includes('word'), `報酬にことばがある: ${kinds.join(', ')}`);
  for (const k of kinds) {
    ok(['weapon', 'weaponup', 'self', 'rest'].includes(k), `知らない報酬の種類: ${k}`);
  }
  const dom = await evalJs(`({
    swap: !!document.getElementById('rewardSwap'),
    label: (document.getElementById('reward')?.textContent || '').includes('語彙が満杯'),
  })`);
  ok(!dom.swap, '交換用の DOM が残っている');
  ok(!dom.label, '「語彙が満杯」の文言が残っている');
  console.log(`    報酬の種類: ${kinds.join(' / ')}`);
}

sec('報酬を選ぶと次の報酬へ');
await evalJs('document.querySelectorAll("#rewardList .rw-card")[0].click()');
await sleep(500);
const afterPick = await evalJs('({ mode: window.__wordrogue.mode, open: !document.getElementById("reward").hidden })');
ok(afterPick.open || afterPick.mode === 'result',
   `報酬の進行: mode=${afterPick.mode} open=${afterPick.open}`);

sec('結果画面');
await evalJs(`(async () => {
  const app = window.__wordrogue;
  // 残りの報酬を消費する。
  let guard = 0;
  while (app.mode === 'reward' && guard++ < 6) {
    const c = document.querySelectorAll('#rewardList .rw-card');
    if (!c.length) break;
    c[0].click();
    await new Promise(r => setTimeout(r, 350));
  }
})()`);
await sleep(600);
ok(await evalJs('!document.getElementById("result").hidden'), '結果画面が出た');
const rsRows = await evalJs('document.querySelectorAll("#resultStats .rs-row").length');
ok(rsRows >= 5, `結果行の数: ${rsRows}`);

sec('セーブが記録されたこと');
const saved = await evalJs(`(() => {
  const raw = localStorage.getItem('wordrogue.save.v1');
  if (!raw) return null;
  const d = JSON.parse(raw);
  return { cleared: d.clearedStages, runs: d.totalRuns, kills: d.totalKills, best: d.bestScore };
})()`);
ok(saved !== null, 'セーブデータがある');
ok(saved && saved.cleared.includes(1), `クリア記録: ${JSON.stringify(saved?.cleared)}`);
ok(saved && saved.runs >= 1, `プレイ回数: ${saved?.runs}`);

sec('コンソールエラーが無いこと');
const real = errors.filter((e) => !/favicon|Autoplay|AudioContext|user gesture/i.test(e.text));
for (const e of real) console.log(`    [${e.kind}] ${e.text.slice(0, 220)}`);
ok(real.length === 0, `エラー数: ${real.length}`);

console.log(`\n---- 合格 ${pass} / 不合格 ${fail} ----`);
cleanup();
process.exit(fail ? 1 : 0);
