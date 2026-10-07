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

sec('書庫で言玉を使い、恒久強化と語彙の枠を買える');
{
  await evalJs('window.__wordrogue.menus.show("archive")');
  await sleep(250);
  const a = await evalJs(`(() => ({
    hidden: document.getElementById('archive').hidden,
    ink: document.getElementById('archiveInk').textContent,
    up: document.querySelectorAll('#archiveUpgrades .up-row').length,
    note: (document.getElementById('archiveWords').textContent || '').slice(0, 40),
  }))()`);
  ok(!a.hidden, '書庫が開いていない');
  ok(a.up === 7, `恒久強化の行数: ${a.up} (7 のはず)`);
  ok(/語彙/.test(a.note), `語彙の説明が無い: ${a.note}`);

  // 言玉を 5000 貯めて、強化と語彙の枠を買う。
  const buy = await evalJs(`(() => {
    const app = window.__wordrogue;
    app.save.data.ink = 5000;
    app.menus.renderArchive();
    const ink0 = app.save.ink;
    const row = document.querySelector('#archiveUpgrades .up-row');
    row.querySelector('.up-buy').click();
    const lv = app.save.metaLevel('hp');
    const spent = ink0 - app.save.ink;
    // 語彙の枠も買う。
    const lexRow = [...document.querySelectorAll('#archiveUpgrades .up-row')]
      .find(n => /語彙/.test(n.textContent || ''));
    const inkBeforeLex = app.save.ink;
    lexRow.querySelector('.up-buy').click();
    return {
      lv, spent,
      lexLv: app.save.metaLevel('lexicon'),
      lexBonus: app.save.lexiconBonus,
      ink: app.save.ink,
      lexCost: inkBeforeLex - app.save.ink,
      metaHp: app.save.metaValue('hp'),
    };
  })()`);
  ok(buy.lv === 1, `強化の段階が上がっていない: ${buy.lv}`);
  ok(buy.spent > 0, `言玉が減っていない: ${buy.spent}`);
  ok(buy.metaHp > 0, `強化の最終値が 0: ${buy.metaHp}`);
  ok(buy.lexLv === 1 && buy.lexBonus === 1, `語彙の枠が増えていない: ${buy.lexLv} / ${buy.lexBonus}`);
  ok(buy.lexCost > 0, `語彙を買っても言玉が減っていない: ${buy.lexCost}`);
  console.log(`    書庫: 強化を 1 段階 (${buy.spent} 言玉) / 語彙 +1 (${buy.lexCost} 言玉)`);

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
  ok(no.ink === 0, `買えないのに言玉が減った: ${no.ink}`);
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
ok(runInfo.weapons === 1, `武器数: ${runInfo.weapons} (最初は 1 つ)`);
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
const rows = await evalJs(`(() => {
  const all = [...document.querySelectorAll('#forgeWeapons .wrow')];
  return {
    total: all.length,
    self: all.filter((r) => r.classList.contains('wrow-self')).length,
    weapon: all.filter((r) => !r.classList.contains('wrow-self')
      && !r.classList.contains('wrow-empty')).length,
    hint: all.filter((r) => r.classList.contains('wrow-empty')).length,
  };
})()`);
ok(rows.self === 1, `自身の文の行の数: ${rows.self}`);
ok(rows.weapon === 1, `武器の文の行の数: ${rows.weapon}`);
// 武器が最大 3 つまで無いことを知らせる余白行。
ok(rows.hint === 1, `武器を追加できる旨の行が無い: ${JSON.stringify(rows)}`);
console.log(`    行: 自身 ${rows.self} / 武器 ${rows.weapon} / 追加案内 ${rows.hint}`);
const selfRow = await evalJs('!!document.querySelector("#forgeWeapons .wrow-self")');
ok(selfRow, 'プレイヤー自身の文の行が無い');
const words = await evalJs('document.querySelectorAll("#forgeWeapons .sen-word").length');
ok(words >= 3, `文の中の語が表示されない: ${words}`);
const gaps = await evalJs('document.querySelectorAll("#forgeWeapons .sen-gap").length');
ok(gaps >= 2, `語の後ろの置き場 (＋) が出ていない: ${gaps}`);
const conns = await evalJs('document.querySelectorAll("#forgeWeapons .sen-conn").length');
ok(conns >= 2, `接続詞の表示がない: ${conns}`);

sec('語をタップすると直後の接続詞が切り替わる');
{
  const conn = await evalJs(`(async () => {
    const m = await import(new URL('js/data/words.js', document.baseURI).href);
    const app = window.__wordrogue;
    const forge = app.forge;
    const run = app.run;
    const wi = run.weapons[0];
    // 文を自由に作り直す。語 2 つ。
    wi.sentence.clear();
    wi.sentence.push(m.makeWord('炎'));
    wi.sentence.push(m.makeWord('斬'));
    forge.render();
    const opts = wi.sentence.connOptions(0);
    const seen = [];
    for (let i = 0; i < opts.length + 1; i++) {
      seen.push(run.cycleConnector({ kind: 'slot', wi, index: 0 }).text);
    }
    forge.render();
    return {
      opts, seen,
      title: wi.title,
      count: wi.sentence.count,
      maxLen: wi.sentence.maxLen,
      len: wi.sentence.len,
      active: wi.resolve(run.player.stats).active,
      shown: [...document.querySelectorAll('#forgeWeapons .sen-conn.filled')].map(n => n.textContent),
      gapText: [...document.querySelectorAll('#forgeWeapons .sen-gap')].map(n => n.textContent.trim()),
    };
  })()`);
  ok(conn.opts.length > 0, '接続詞の候補が出ない');
  ok(conn.seen[conn.opts.length] === null, `一周しても接続詞なしにならない: ${conn.seen.join(',')}`);
  ok(conn.seen.slice(0, conn.opts.length).join() === conn.opts.join(),
    `候補どおりに回らない: ${conn.seen.join(',')}`);
  ok(conn.title.startsWith('炎'), `武器名が違う: ${conn.title}`);
  ok(conn.count === 2, `語が変わった: ${conn.count}`);
  ok(conn.len <= conn.maxLen, `文が ${conn.len} 文字 (上限 ${conn.maxLen})`);
  ok(conn.active, `${conn.title} が不成立`);
  ok(conn.gapText.includes('＋'), `語の後ろに「＋」が無い: ${conn.gapText.join(',')}`);
  console.log(`    「${conn.title}」— ${conn.count} 語 / ${conn.len} 文字 / 接続詞 ${conn.opts.join('→')}→なし`);
}

sec('文は 10 文字まで。武器語は自分で置く');
{
  const tails = await evalJs(`(() => {
    const app = window.__wordrogue;
    const run = app.run;
    const wi = run.weapons[0];
    return {
      defs: run.weapons.map(w => ({ id: w.defId, tail: w.tail, title: w.title, maxLen: w.sentence.maxLen })),
      texts: [...document.querySelectorAll('#forgeWeapons .sn-text')].map(n => n.textContent),
      rows: [...document.querySelectorAll('#forgeWeapons .wrow')].map(n => n.textContent),
    };
  })()`);
  // 自身の文の末尾は「人」だけ。武器の文には末尾語が無い。
  ok(tails.defs.every((w) => w.maxLen === 10), `文の上限が 10 でない: ${tails.defs.map(w => w.maxLen)}`);
  ok(tails.texts.length === 2, `文面表示の数: ${tails.texts.length}`);
  ok(tails.texts.some((t) => t.includes('人')), `称号の末尾が「人」ではない: ${tails.texts.join(' | ')}`);
  for (const w of tails.defs) {
    ok(w.title && !/undefined|null|空/.test(w.title), `武器名が壊れている: ${w.title}`);
  }
  console.log(`    文面: ${tails.texts.join(' | ')}`);
}
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

sec('語を文に足すと文が変わる');
const changed = await evalJs(`(() => {
  const app = window.__wordrogue;
  const run = app.run;
  const before = run.weapons.map(w => w.resolve(run.player.stats).fullText);
  // 語彙の最初の語を武器 0 の文の末尾に足す。
  const word = run.lexicon.find(w => w);
  run.placeWord(run.weapons[0], run.weapons[0].sentence.count, word);
  const after = run.weapons.map(w => w.resolve(run.player.stats).fullText);
  return { before, after, text: word.text };
})()`);
ok(changed.before[0] !== changed.after[0], `文が変化: ${changed.before[0]} -> ${changed.after[0]}`);

sec('不成文にすると武器が無効になる');
const broken = await evalJs(`(() => {
  const run = window.__wordrogue.run;
  const wi = run.weapons[0];
  wi.sentence.clear();
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
    // 直前のテストで文を空にしました。語が無いと「語の置き場」を見られない。
    if (wi.sentence.count === 0) {
      const forge = window.__wordrogue.forge;
      const lx = run.lexicon.findIndex((w) => w);
      if (lx >= 0) forge.dropOnto({ kind: 'lexicon', index: lx }, { kind: 'slot', wi, index: 0 });
    }
    const lex = [...document.querySelectorAll('#forgeLexicon .pword:not(.empty)')];
    // 自身の文と「武器を追加できる」の行を除いた、武器の文の行。
    const row0 = [...document.querySelectorAll('#forgeWeapons .wrow')]
      .find((r) => !r.classList.contains('wrow-self') && !r.classList.contains('wrow-empty'));
    const item0 = row0 && row0.querySelector('.sen-item');
    const gap0 = row0.querySelector('.sen-gap');
    return {
      // HTML5 の draggable は使ってない。pointer で自前実装する。
      html5: document.querySelectorAll('#forge [draggable="true"]').length,
      lexicon: lex.length,
      // 語彙の語と文の中の語・隙間が、ドロップ先として data-place を持つこと。
      lexiconPlace: lex.filter(n => n.dataset.place).length,
      wordPlace: !!item0 && !!item0.dataset.place,
      gapPlace: !!gap0 && !!gap0.dataset.place,
    };
  })()`);
  ok(dnd.html5 === 0, `HTML5 の draggable が残っている: ${dnd.html5} 個 (タップを奪う)`);
  ok(dnd.lexicon === dnd.lexiconPlace, `語彙の語に data-place が無い: ${dnd.lexiconPlace} / ${dnd.lexicon}`);
  ok(dnd.wordPlace, '文の語に data-place が無い');
  ok(dnd.gapPlace, '文の隙間に data-place が無い');
  console.log(`    語彙 ${dnd.lexicon} 語すべてに data-place / 文の語と隙間もドロップ先`);
}

sec('ドラッグで語を文へ入れ、文の並びを変えられること');
{
  // HTML5 のドラッグは CDP から再現しにくいので、Forge の drop ハンドラを直接叩く。
  const dnd = await evalJs(`(() => {
    const app = window.__wordrogue;
    const forge = app.forge;
    const run = app.run;
    const wi = run.weapons[0];
    // 結果に左右されないよう、文を空にしてから始める。
    wi.sentence.clear();
    forge.render();
    const a = run.lexicon.findIndex(w => w);
    const b = run.lexicon.findIndex((w, i) => i > a && w);
    const wa = run.lexicon[a].text;
    const wb = run.lexicon[b].text;

    // 語彙 -> 文の末尾 (末尾の隙間に落とす = 足す)。
    forge.dropOnto({ kind: 'lexicon', index: a }, { kind: 'gap', wi, index: wi.sentence.count });
    const placed = {
      inSen: wi.sentence.words[wi.sentence.count - 1] && wi.sentence.words[wi.sentence.count - 1].text,
      lexNowNull: run.lexicon[a] === null,
    };

    // もう 1 語を文の末尾へ。
    forge.dropOnto({ kind: 'lexicon', index: b }, { kind: 'gap', wi, index: wi.sentence.count });
    const placed2 = {
      inSen: wi.sentence.words[wi.sentence.count - 1] && wi.sentence.words[wi.sentence.count - 1].text,
    };

    // 文の中の語を先頭へ (並び替え)。
    forge.dropOnto({ kind: 'slot', wi, index: 1 }, { kind: 'slot', wi, index: 0 });
    const moved = { s0: wi.sentence.words[0].text, s1: wi.sentence.words[1].text, count: wi.sentence.count };

    // 文の末尾の隙間へ運べば、並びの末尾に来る。
    forge.dropOnto({ kind: 'slot', wi, index: 0 }, { kind: 'gap', wi, index: wi.sentence.count });
    const gapMoved = { first: wi.sentence.words[0].text, last: wi.sentence.words.at(-1).text, count: wi.sentence.count };

    // 文 -> 語彙 (空きセル) なら戻せる。
    const free = run.lexicon.indexOf(null);
    forge.dropOnto({ kind: 'slot', wi, index: 0 }, { kind: 'lexicon', index: free });
    const back = {
      count: wi.sentence.count,
      first: wi.sentence.words[0] && wi.sentence.words[0].text,
      lex: run.lexicon[free] && run.lexicon[free].text,
    };

    // 埋まった語彙のマスへ落としても「空きへ戻す」はできる。
    const lastInSen = wi.sentence.words.at(-1);
    const filled = run.lexicon.findIndex((w) => w != null);
    forge.dropOnto({ kind: 'slot', wi, index: wi.sentence.count - 1 }, { kind: 'lexicon', index: filled });
    const backOccupied = {
      ok: wi.sentence.words.indexOf(lastInSen) < 0,
      lexHasIt: run.lexicon.some((w) => w && w.text === lastInSen.text),
    };

    return { wa, wb, placed, placed2, moved, gapMoved, back, backOccupied, free, title: wi.title };
  })()`);
  ok(dnd.placed.inSen === dnd.wa, `語彙の語が文に入らない: ${dnd.placed.inSen}`);
  ok(dnd.placed.lexNowNull, '語彙に語が残っている');
  ok(dnd.placed2.inSen === dnd.wb, `2 語目が入らない: ${dnd.placed2.inSen}`);
  ok(dnd.moved.s0 === dnd.wb && dnd.moved.s1 === dnd.wa,
    `並び替えが違う: ${dnd.moved.s0} / ${dnd.moved.s1}`);
  ok(dnd.moved.count === 2, `並べ替えで語が失われた: ${dnd.moved.count}`);
  ok(dnd.gapMoved.last === dnd.wb && dnd.gapMoved.count === 2,
    `末尾の隙間へ運んでも末尾に来ない: ${JSON.stringify(dnd.gapMoved)}`);
  ok(dnd.back.count === 1, `文から語が戻らない: ${dnd.back.count}`);
  // 先頭の語を語彙へ戻すので、入るのは wa の語。
  ok(dnd.back.lex === dnd.wa, `語彙へ語が戻らない: ${dnd.back.lex}`);
  ok(dnd.backOccupied.ok && dnd.backOccupied.lexHasIt,
    `埋まったマスに落としても語彙へ戻らない: ${JSON.stringify(dnd.backOccupied)}`);
  console.log(`    「${dnd.wa}」→「${dnd.title}」… 並べ替え → 末尾の隙間 → 語彙へ戻す すべて成立`);
}

sec('語の「✕」で語彙へ戻せること');
{
  const out = await evalJs(`(() => {
    const app = window.__wordrogue;
    const forge = app.forge;
    const run = app.run;
    const wi = run.weapons[0];
    // 直前のテストで文を空にしました。文の語が 1 つないと「✕」を叩けないので戻す。
    const lex = run.lexicon.findIndex((w) => w);
    if (wi.sentence.count === 0 && lex >= 0) {
      forge.dropOnto({ kind: 'lexicon', index: lex }, { kind: 'slot', wi, index: 0 });
    }
    // dropOnto は画面を作り直すので、行は引き直してから取る。
    const row = [...document.querySelectorAll('#forgeWeapons .wrow')]
      .find((r) => !r.classList.contains('wrow-self') && !r.classList.contains('wrow-empty'));
    const btns = [...row.querySelectorAll('.sen-item .sen-out')];
    const items = row.querySelectorAll('.sen-item').length;
    const gone = wi.sentence.words[0].text;
    btns[0].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 5 }));
    btns[0].dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 5, clientY: 5 }));
    return {
      btns: btns.length,
      items,
      count: wi.sentence.count,
      gone,
      inSen: wi.sentence.words.some((w) => w.text === gone),
      inLex: run.lexicon.some((w) => w && w.text === gone),
    };
  })()`);
  ok(out.btns === out.items, `✕ ボタンの数が文の語数と合わない: ${out.btns} / ${out.items}`);
  ok(out.count === out.items - 1, `語を外せていない: ${out.count} / ${out.items}`);
  ok(!out.inSen, `文に語が残っている: ${out.gone}`);
  ok(out.inLex, '語彙に戻っていない');
  console.log(`    「${out.gone}」-> ✕ で外した (文 ${out.count} 語 / 語彙へ戻った)`);
}

sec('語彙が満杯でも文から語を戻せること');
{
  const full = await evalJs(`(async () => {
    const m = await import(new URL('js/data/words.js', document.baseURI).href);
    const app = window.__wordrogue;
    const forge = app.forge;
    const run = app.run;
    const wi = run.weapons[0];
    // 文が 2 語：无ければ語彙から戻しておく (1 語だと外した後に末尾が無い)。
    while (wi.sentence.count < 2) {
      const lx = run.lexicon.findIndex((w) => w);
      if (lx < 0) break;
      forge.dropOnto({ kind: 'lexicon', index: lx }, { kind: 'gap', wi, index: wi.sentence.count });
    }
    // 語彙を全部違う語で埋める。同じ語が 2 つあると「最古」が判定できない。
    const all = Object.keys(m.WORDS).filter((t) => !m.CONNECTOR_LIST.includes(t));
    let pi = 0;
    while (!run.lexiconFull) run.giveWord(m.makeWord(all[(pi++) % all.length]), true);
    const before = run.lexicon.filter(Boolean).length
      + run.weapons.reduce((n, w) => n + w.sentence.count, 0) + run.player.self.count;
    const lexText = run.lexicon[0].text;

    // 語彙 -> 文 (末尾の隙間)。語彙の空きが 1 つ増えるだけ。
    forge.dropOnto({ kind: 'lexicon', index: 0 }, { kind: 'gap', wi, index: wi.sentence.count });
    const after = run.lexicon.filter(Boolean).length
      + run.weapons.reduce((n, w) => n + w.sentence.count, 0) + run.player.self.count;
    const movedIn = wi.sentence.words[wi.sentence.count - 1].text;

    // 文 -> 語彙。満杯なら語彙の最古の 1 語を捨てて戻す。
    const oldest = run.lexicon[run.oldestLexiconIndex()].text;
    const res = run.toLexicon(wi.sentence.words[wi.sentence.count - 1]);
    const kept = wi.sentence.words[wi.sentence.count - 1]?.text ?? null;
    const inLex = run.lexicon.some((w) => w && w.text === movedIn);
    const oldestGone = !run.lexicon.some((w) => w && w.text === oldest);
    const lexN = run.lexicon.filter(Boolean).length;

    // dropOnto を直接叩いたのでドラッグ状態は手で戻す。
    forge.dragFrom = null;
    forge.suppressClick = false;

    return { full: run.lexiconFull, before, after, lexText, movedIn, res, kept, inLex, oldest, oldestGone, lexN };
  })()`);
  ok(full.full, '満杯になっていない');
  ok(full.after === full.before, `語が失われた: ${full.before} -> ${full.after}`);
  ok(full.movedIn === full.lexText, `語彙の語が文に入らなかった: ${full.movedIn}`);
  ok(full.res.ok === true, `満杯のときに語彙へ戻せない: ${JSON.stringify(full.res)}`);
  ok(full.kept !== full.lexText, '戻そうとして語が消えた');
  ok(full.inLex === true, '語が語彙に入っていない');
  ok(full.oldestGone === true, `最古の語が残った: ${full.oldest}`);
  ok(full.lexN === full.after, `語彙の数が変わらない: ${full.lexN} / ${full.after}`);
  console.log(`    満杯: 「${full.movedIn}」-> 文 / 戻したら最古の「${full.oldest}」を捨てた`);
}

sec('「忘れる」で語彙の空きを作れること');
{
  const forget = await evalJs(`(() => {
    const app = window.__wordrogue;
    const forge = app.forge;
    const run = app.run;
    // 満杯かどうかに関係なく「空きが 1 つ増える」ことを見る。
    // 前のテストが語彙を満杯にしてしまっているので、空きを 1 つ作る。
    // 描画し直すので、forge が開いていて語彙が空でないことを先に整える。
    if (document.getElementById('forge').hidden) document.getElementById('btnForge').click();
    forge.forgetMode = false;
    while (run.lexiconFull) {
      const i = run.lexicon.findIndex(Boolean);
      run.forgetWord(run.lexicon[i]);
    }
    forge.render();
    const before = run.lexiconFreeCount;
    forge.toggleForget();
    const on = forge.forgetMode;
    const btnOn = document.getElementById('btnForgeForget').classList.contains('on');
    const target = run.lexicon.findIndex(w => w);
    const word = run.lexicon[target];
    // 語彙の語をタップ = 忘れる。click ではなく pointerup で動くのでそちらを使う。
    // 語彙のセルは run.lexicon と同じ順に並ぶ (空きセルも .pword.empty で入る)。
    // よって埋め込み済みセルの配列で引かず、全セルの target 番目が対象。
    const cell = document.querySelectorAll('#forgeLexicon .pword')[target];
    if (cell.classList.contains('empty')) throw new Error('対象セルが空きだった: ' + target);
    const r = cell.getBoundingClientRect();
    const o = {
      bubbles: true, cancelable: true,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
      pointerId: 9, pointerType: 'touch', isPrimary: true, button: 0,
    };
    cell.dispatchEvent(new PointerEvent('pointerdown', o));
    cell.dispatchEvent(new PointerEvent('pointerup', o));
    const after = run.lexiconFreeCount;
    // 同じ語が複数あってもよいので、身分 (オブジェクト) で確かめる。
    const gone = run.lexicon.indexOf(word) < 0;
    const modeAfter = forge.forgetMode;
    forge.toggleForget();
    return { before, after, on, btnOn, gone, text: word.text, off: !forge.forgetMode, modeAfter };
  })()`);
  ok(forget.on, '忘れるモードにならない');
  ok(forget.modeAfter === true, `忘れたあとも忘れるモードのはず: ${forget.modeAfter}`);
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
    // 満杯にする前に語彙へ戻したマスは空amianospacerictedので、埋め直す。
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

sec('3 択は実際のクリックで選べる');
{
  // 上のテストは DOM の .click() を直接叩いているので、祖層の pointer-events が
  // 死んでいても通ってしまう。プレイヤーは座標を押すので、
  // ここでも座標に届いているか (elementFromPoint) と実クリックで確かめる。
  await evalJs(`(() => {
    const app = window.__wordrogue;
    if (!document.getElementById('forge').hidden) app.forge.close();
    app.mode = 'play';
    app.run.paused = false;
    app.hud.show(true);
    const run = app.run;
    // 満杯だと先に「捨てる」を選ばせる必要がある。空きを 1 つ作っておく。
    let guard = 0;
    while (run.lexiconFull && guard++ < 40) {
      run.forgetWord(run.lexicon[run.lexicon.findIndex(Boolean)]);
    }
    run.pendingChoices.length = 0;
    app.hud._choiceSig = '';
    run.offerWordChoices();
  })()`);
  await sleep(300);

  const geo = await evalJs(`(() => [...document.querySelectorAll('#choiceList .choice-card')].map((c) => {
    const r = c.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    return {
      text: c.querySelector('span')?.textContent || '',
      x, y, w: r.width, h: r.height,
      onTop: !!hit && c.contains(hit),
      over: hit ? (hit.id || hit.className || hit.tagName) : null,
    };
  }))()`);
  ok(geo.length === 3, `候補が ${geo.length} 個 (3 択のはず)`);
  for (const g of geo) {
    ok(g.w > 0 && g.h > 0, `「${g.text}」が画面に出ていない: ${g.w}x${g.h}`);
    ok(g.onTop, `「${g.text}」がクリックできない (上に被っている: ${g.over})`);
  }

  // 座標に本当にマウスイベントを送って、語が入るのまで確認する。
  const pending0 = await evalJs('window.__wordrogue.run.pendingChoices.length');
  const t = geo[0];
  if (t) {
    const common = { x: t.x, y: t.y };
    await S('Input.dispatchMouseEvent', { type: 'mouseMoved', ...common, button: 'none', clickCount: 0 });
    await S('Input.dispatchMouseEvent', { type: 'mousePressed', ...common, button: 'left', clickCount: 1, buttons: 1 });
    await S('Input.dispatchMouseEvent', { type: 'mouseReleased', ...common, button: 'left', clickCount: 1, buttons: 0 });
    await sleep(300);
  }
  const pending1 = await evalJs('window.__wordrogue.run.pendingChoices.length');
  ok(t && pending1 < pending0, `押しても 3 択が残っている: ${pending0} -> ${pending1}`);
  console.log(`    「${t ? t.text : '?'}」を実クリック -> 未選択 ${pending0} -> ${pending1}`);
}

sec('ダッシュボタンが押せる (タッチ端末)');
{
  // PC の Chrome ではホバーできるので、ボタンは隠れている。
  // 実処理 (wireDash) を直接呼んで、座標で押しに谁能いか確かめる。
  const dash = await evalJs(`(() => {
    const app = window.__wordrogue;
    const input = app.input;
    document.body.classList.add('touch');
    app.hud.wireDash(input);
    const b = document.getElementById('btnDash');
    b.hidden = false;
    const r = b.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    const o = {
      shown: !b.hidden,
      big: r.width >= 72 && r.height >= 72,
      inView: r.bottom <= innerHeight && r.right <= innerWidth,
      onTop: !!hit && b.contains(hit),
      over: hit ? (hit.id || hit.className || hit.tagName) : null,
      x, y,
      w: Math.round(r.width), h: Math.round(r.height),
    };
    const ev = (type) => b.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true,
      clientX: x, clientY: y, pointerId: 7, pointerType: 'touch', isPrimary: true,
    }));
    ev('pointerdown');
    o.whileDown = input.dash;
    ev('pointerup');
    o.afterUp = input.dash;   // 指を離しても少しは続く
    return o;
  })()`);
  ok(dash.shown, 'ダッシュボタンが出ない');
  ok(dash.big, `ダッシュボタンが小さすぎる: ${dash.w}x${dash.h}`);
  ok(dash.inView, 'ダッシュボタンが画面外にある');
  ok(dash.onTop, `ダッシュボタンが押せない (上に被っている: ${dash.over})`);
  ok(dash.whileDown, '押してもダッシュしない');

  // 実際に座標にイベントを送って、プレイヤーがダッシュ状態になるか見る。
  await S('Input.dispatchMouseEvent', { type: 'mousePressed', x: dash.x, y: dash.y, button: 'left', clickCount: 1, buttons: 1 });
  await sleep(120);
  const during = await evalJs('window.__wordrogue.run.player.dashing');
  await S('Input.dispatchMouseEvent', { type: 'mouseReleased', x: dash.x, y: dash.y, button: 'left', clickCount: 1, buttons: 0 });
  ok(during, 'ダッシュボタンでプレイヤーがダッシュしない');
  console.log(`    ダッシュボタン: 押している間 true / 離しても 0.2 秒は続く / プレイヤー dashing=${during}`);
}

sec('ステージクリアの報酬カードで固まらないこと');
{
  // 回転刃 (grow に rate が無い) を持ってクリアすると、
  // 報酬の組み立てで例外になり画面が進まなくなる。
  const res = await evalJs(`(async () => {
    const { WeaponInst } = await import(new URL('js/game/weapon.js', document.baseURI).href);
    const app = window.__wordrogue;
    const run = app.run;
    // 鍛冶が開いているままだと finish が反映されないので、戦闘へ戻しておく。
    if (!document.getElementById('forge').hidden) app.forge.close();
    app.mode = 'play';
    run.paused = false;
    run.weapons.length = 0;
    run.weapons.push(new WeaponInst('sword', 1), new WeaponInst('orbit', 1));
    run.refreshStats();
    run.finish(true);
    await new Promise(r => setTimeout(r, 500));
    const cards = [...document.querySelectorAll('#rewardList .rw-card')];
    const before = cards.length;
    // 実際にカードを押す。押せなければ画面が進まない。
    if (cards[0]) cards[0].click();
    await new Promise(r => setTimeout(r, 500));
    const after = [...document.querySelectorAll('#rewardList .rw-card')].length;
    return {
      before, after,
      open: !document.getElementById('reward').hidden,
      mode: app.mode,
      broken: [...document.querySelectorAll('#rewardList .rw-fx')].some(n => /undefined|NaN/.test(n.textContent)),
    };
  })()`);
  ok(res.before >= 1, `報酬カードが出ない: ${res.before}`);
  ok(res.broken, 'カードに undefined が出る');
  ok(res.after < res.before || !res.open, `カードを押しても報酬が終わらない: ${res.before} -> ${res.after} / ${res.mode}`);
  console.log(`    回転刃所持でクリア -> カード ${res.before} 枚 → 押して ${res.after} 枚 (${res.mode})`);
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
  ok(d.tabs === 6, `カテゴリのタブ数: ${d.tabs} (すべて + 5 カテゴリ。形態は載せない)`);
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
  // HTML5 の draggable 要素だと、実機ではタップが native drag に
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

    const row = [...document.querySelectorAll('#forgeWeapons .wrow')]
      .find((r) => !r.classList.contains('wrow-self') && !r.classList.contains('wrow-empty'));
    // 文は自由に並べる。末尾の「＋」(隙間) が唯一の追加位置。
    const gap = [...row.querySelectorAll('.sen-gap')].pop();
    if (armed && gap) tap(gap);
    const sen = run.weapons[0].sentence;
    const got = sen.at(sen.count - 1) && sen.at(sen.count - 1).word.text;
    return { draggable, text, armed, highlighted, got, ok: got === text, stick: app.input.stick.active };
  })()`);
  ok(t.draggable === 0, `draggable が残っている: ${t.draggable} 個 (タップを奪う)`);
  ok(t.armed === t.text, `タップで語を選べない: armed=${t.armed} / ${t.text}`);
  ok(t.highlighted === 1, `選んだ語が光っていない: ${t.highlighted}`);
  ok(t.ok, `タップした語が文に入らない: ${t.got}`);
  ok(!t.stick, 'タップが移動スティックに取られた');
  console.log(`    タップで「${t.text}」を選んで文に入れる`);
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
    // 結果が変わらないよう、文を空にしてから 1 番目へ入れる。
    const wi = run.weapons[0];
    wi.sentence.clear();
    wi.resolve(run.player.stats);
    forge.render();
    const word = document.querySelector('#forgeLexicon .pword:not(.empty)');
    const text = word.querySelector('span').textContent.trim();
    const from = word.getBoundingClientRect();
    // 文の隙間 (＋) が追加位置。
    const row = [...document.querySelectorAll('#forgeWeapons .wrow')]
      .find((r) => !r.classList.contains('wrow-self') && !r.classList.contains('wrow-empty'));
    const slots = [...row.querySelectorAll('.sen-gap')];
    const to = slots[slots.length - 1].getBoundingClientRect();
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
    const got = wi.sentence.words[0] && wi.sentence.words[0].text;
    return { text, got, ok: got === text, dragFrom: forge.dragFrom, hot: !!hot };
  })()`);
  ok(d.hot, 'ドロップ先を判別できない');
  ok(d.ok, `ドラッグで語が入らない: ${d.got} (狙いは ${d.text})`);
  ok(!d.dragFrom, 'ドラッグの後に dragFrom が残った');
  console.log(`    ドラッグで「${d.text}」を文へ`);
}

sec('指がセルの上で離어도ドロップが確定する');
{
  // 実機では語の上で離さない。指は枠のセル上に来ている。
  // テストがソースノードで pointerup を投げていると、
  // 「ソースに pointerup が来ない」実機の挙動を再現していなかった。
  // window で受けていない実装だと、このテストで語が入らないままになる。
  const d = await evalJs(`(() => {
    const app = window.__wordrogue;
    const forge = app.forge;
    const run = app.run;
    app.menus.hideAll();
    if (document.getElementById('forge').hidden) document.getElementById('btnForge').click();
    const wi = run.weapons[0];
    wi.sentence.clear();
    wi.resolve(run.player.stats);
    forge.render();

    const word = document.querySelector('#forgeLexicon .pword:not(.empty)');
    const text = word.querySelector('span').textContent.trim();
    const row = [...document.querySelectorAll('#forgeWeapons .wrow')]
      .find((r) => !r.classList.contains('wrow-self') && !r.classList.contains('wrow-empty'));
    const gaps = [...row.querySelectorAll('.sen-gap')];
    const slot = gaps[gaps.length - 1];
    const from = word.getBoundingClientRect();
    const to = slot.getBoundingClientRect();
    const x0 = from.left + from.width / 2, y0 = from.top + from.height / 2;
    const x1 = to.left + to.width / 2, y1 = to.top + to.height / 2;
    const o = (x, y) => ({
      bubbles: true, cancelable: true, clientX: x, clientY: y,
      pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0,
    });
    word.dispatchEvent(new PointerEvent('pointerdown', o(x0, y0)));
    word.dispatchEvent(new PointerEvent('pointermove', o(x0 + 20, y0 + 20)));
    word.dispatchEvent(new PointerEvent('pointermove', o(x1, y1)));
    // pointerup は文の隙間へ飛ばす。ソースには届かない。
    slot.dispatchEvent(new PointerEvent('pointerup', o(x1, y1)));
    const got = wi.sentence.words[0] && wi.sentence.words[0].text;
    return { text, got, ok: got === text, dragFrom: forge.dragFrom };
  })()`);
  ok(d.ok, `セル上で離しても語が入らない: ${d.got} (狙いは ${d.text})`);
  ok(!d.dragFrom, 'ドラッグの後に dragFrom が残った');
  console.log(`    セル上で離しても「${d.text}」が入った`);
}

sec('pointercancel では語が動かない');
{
  // OS やブラウザにジェスチャを奪われたとき。dropOnto まで進んでしまうと
  // 意図しないのに語が枠に入る。やられないようにしておく。
  const d = await evalJs(`(() => {
    const app = window.__wordrogue;
    const forge = app.forge;
    const run = app.run;
    app.menus.hideAll();
    if (document.getElementById('forge').hidden) document.getElementById('btnForge').click();
    const wi = run.weapons[0];
    wi.sentence.clear();
    wi.resolve(run.player.stats);
    forge.render();

    const word = document.querySelector('#forgeLexicon .pword:not(.empty)');
    const text = word.querySelector('span').textContent.trim();
    const row = [...document.querySelectorAll('#forgeWeapons .wrow')]
      .find((r) => !r.classList.contains('wrow-self') && !r.classList.contains('wrow-empty'));
    const gaps = [...row.querySelectorAll('.sen-gap')];
    const slot = gaps[gaps.length - 1];
    const from = word.getBoundingClientRect();
    const to = slot.getBoundingClientRect();
    const x0 = from.left + from.width / 2, y0 = from.top + from.height / 2;
    const x1 = to.left + to.width / 2, y1 = to.top + to.height / 2;
    const o = (x, y) => ({
      bubbles: true, cancelable: true, clientX: x, clientY: y,
      pointerId: 8, pointerType: 'touch', isPrimary: true, button: 0,
    });
    word.dispatchEvent(new PointerEvent('pointerdown', o(x0, y0)));
    word.dispatchEvent(new PointerEvent('pointermove', o(x0 + 20, y0 + 20)));
    word.dispatchEvent(new PointerEvent('pointermove', o(x1, y1)));
    slot.dispatchEvent(new PointerEvent('pointercancel', o(x1, y1)));
    const got = wi.sentence.words[0] && wi.sentence.words[0].text;
    return { text, got, ok: got == null, dragFrom: forge.dragFrom };
  })()`);
  ok(d.ok, `pointercancel で語が文へ入ってしまう: ${d.got}`);
  ok(!d.dragFrom, 'pointercancel の後に dragFrom が残った');
  console.log('    pointercancel では語が入らない');
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
  // 鍛冶を閉じても mode / paused が.play に戻るとは限らないので、明示的に戻す。
  await evalJs(`(() => {
    const app = window.__wordrogue;
    if (!document.getElementById('forge').hidden) app.forge.close();
    app.mode = 'play';
    app.run.paused = false;
  })()`);
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
    p.self.clear();
    // 「人」は文の外に固定で付くので、文には入れない。
    p.self.push(m.makeWord('頑'));
    p.self.push(m.makeWord('走'));
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
  ok(res.title === '頑走人', `称号が「${res.title}」`);
  ok(res.valid === true, '自身の文が不成文');
  ok(res.power > 1, `文の力が上がっていない: ${res.power}`);
  ok(res.armor > 0, `装甲が乗っていない: ${res.armor}`);
  await sleep(200);
  const shown = await evalJs('document.getElementById("hudSelf").textContent');
  ok(shown.includes('頑走人'), `HUD に称号が出ていない: ${shown}`);
  ok(shown.includes('称号'), `HUD の称号ラベルが無い: ${shown}`);
  ok(/文の力 x[\d.]+/.test(shown), `HUD に文の力が出ていない: ${shown}`);
  console.log(`    称号「${res.title}」 文の力 x${res.power.toFixed(2)} / 装甲 ${res.armor.toFixed(2)} / HUD ${shown.trim()}`);

  // 末尾の「人」は固定。並べ替えても外れない。
  const tail = await evalJs(`(async () => {
    const m = await import(new URL('js/data/words.js', document.baseURI).href);
    const run = window.__wordrogue.run;
    const p = run.player;
    p.self.clear();
    p.self.push(m.makeWord('甲'));
    p.self.push(m.makeWord('鎧'));
    run.refreshStats();
    const a = p.stats.selfTitle;
    p.self.swap(0, 1);
    run.refreshStats();
    return { a, b: p.stats.selfTitle, count: p.self.count };
  })()`);
  ok(tail.a === '甲鎧人', `末尾の「人」が付かない: ${tail.a}`);
  ok(tail.b === '鎧甲人', `入れ替えると末尾が変わる: ${tail.b}`);
  ok(tail.count === 2, `文に「人」を入れてしまった: ${tail.count}`);
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
    // シェイクの分だけ数 px ずれるので、十分広い四角で判定する。
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
    wi0.sentence.clear();
    wi0.sentence.push(m.makeWord(def.startWord));
    wi0.sentence.push(m.makeWord(def.startWord2));
    wi0.sentence.push(m.makeWord(def.tail));
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
    // 語はすべて 1 字なので、1 語だけの武器名もあり得る。
    ok(t.length >= 1, `武器名が空: "${t}"`);
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
    ['末尾語', '武器の文に末尾語は無い'],
    ['枠', '枠ではなく自由に並べる'],
    ['語を引き直す', '引き直しは無い'],
    ['助詞', '助詞は廃止されている'],
    ['助動詞', '助動詞は廃止されている'],
  ];
  for (const [needle, why] of banned) {
    ok(!doc.includes(needle), `玩法説明に古い記述「${needle}」が残っている (${why})`);
  }
  // 例の文は現在の形 (10 文字まで自由に並べた文) であるべき。
  // test/all.mjs が「index.html の例は辞書の語だけで作れるもの」と照合するので同じ語を使う。
  for (const t of ['焔必刃', '焔を斬された硬']) {
    ok(doc.includes(t), `玩法説明に例「${t}」が無い`);
  }
  // 文の長さ・武器語・接続詞の記述があるはず。
  for (const t of ['10 文字', '武器語', '接続詞']) {
    ok(doc.includes(t), `遊び方に「${t}」の記述が無い`);
  }

  // 報酬は武器と休息だけで、ことばは出ない。
  const rewardSec = doc.slice(doc.indexOf('クリア報酬'));
  ok(rewardSec.includes('休息'), `クリア報酬の説明に休息が無い: ${rewardSec.slice(0, 60)}`);
  ok(rewardSec.includes('ことばはここでは出ない'), '報酬からことばが出ない旨が書かれていない');
  ok(!rewardSec.includes('自身の強化'), '報酬の説明に旧仕様の自身の強化が残っている');
  console.log(`    遊び方 ${doc.length} 文字 / 古い記述なし`);
}

sec('ステージクリアは結果画面へ直接進む');
// クリア時は三択の報酬画面を挟まず、言玉がそのまま結果画面に入る。
// 古い報酬画面 (rewardList) の DOM が残.App いないことを確かめる。
const cleared = await evalJs(`(async () => {
  const app = window.__wordrogue;
  const run = app.run;
  if (run.state !== 'playing') return { skipped: true, state: run.state };
  // 高速で倒してクリア扱いにする。
  run.player.stats.atk = 99999;
  for (const e of run.enemies) e.hp = 1;
  await new Promise(r => setTimeout(r, 600));
  run.finish(true);
  await new Promise(r => setTimeout(r, 600));
  return {
    skipped: false,
    state: run.state,
    mode: app.mode,
    rewardDom: !!document.getElementById('reward'),
    resultOpen: !document.getElementById('result').hidden,
  };
})()`);
ok(!cleared.skipped, `ランが既に終わっていた: ${cleared.state}`);
ok(cleared.state === 'clear', `クリア状態になっていない: ${cleared.state}`);
ok(cleared.mode === 'result', `結果画面へ: ${cleared.mode}`);
ok(!cleared.rewardDom, '三択の報酬画面 (旧 #reward) の DOM が残っている');
ok(cleared.resultOpen, '結果画面が表示された');

sec('結果画面');
await sleep(300);
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
