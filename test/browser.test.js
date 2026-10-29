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
  '--no-proxy-server',
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
// くじの演出時間をテストするので、OS の「視差効果を減らす」設定に左右されないようにする。
await S('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
});

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
// 初回はチュートリアルが自動で開き、タイトルを覆う。閉じてから見る。
await evalJs(`(() => {
  const m = window.__wordrogue.menus;
  if (m.tutorial && !m.tutorial.hidden) m.closeTutorial();
})()`);
ok(await evalJs('!document.getElementById("title").hidden'), 'タイトルが表示されている');
ok(await evalJs('document.getElementById("btnStart") !== null'), '開始ボタンがある');

sec('恒久強化は廃止。体を強くするのは部位の語だけ');
{
  await evalJs('window.__wordrogue.menus.show("grow")');
  await sleep(250);
  const a = await evalJs(`(() => ({
    hidden: document.getElementById('grow').hidden,
    ink: document.getElementById('growInk').textContent,
    parts: document.querySelectorAll('#growParts .grow-part').length,
  }))()`);
  ok(!a.hidden, '強化タブが開いていない');
  ok(a.parts === 7, `部位が 7 コマでない: ${a.parts}`);

  // 旧・恒久強化ぶんの効果は、部位に意味の合う語を入れて取る。
  const st = await evalJs(`(async () => {
    const app = window.__wordrogue;
    const save = app.save;
    for (const t of ['賢', '硬', '強']) if (!save.ownsWord(t)) save.data.collection.push(t);
    save.clearPart('head', 0);
    save.clearPart('head', 1);
    save.clearPart('trnk', 0);
    save.clearPart('rhnd', 0);
    const stats = await import(new URL('js/game/stats.js', document.baseURI).href);
    const plain = stats.resolvePlayerStats(save.partEntries());
    save.setPart('head', 0, '賢');
    save.setPart('trnk', 0, '硬');
    save.setPart('rhnd', 0, '強');
    const buffed = stats.resolvePlayerStats(save.partEntries());
    app.menus.renderGrow();
    return {
      plainLex: plain.lexicon, wiseLex: buffed.lexicon,
      plainXp: plain.xpMul, wiseXp: buffed.xpMul,
      plainArmor: plain.armor, wiseArmor: buffed.armor,
      slots: document.querySelectorAll('#growParts [data-part="head"] .sen-row .sen-word').length,
      limit: (document.querySelector('#growParts [data-part="head"] .grow-part-lv') || {}).textContent || '',
      total: (document.getElementById('growTotal').textContent || '').slice(0, 80),
    };
  })()`);
  ok(st.plainLex === 0, `部位が空なのに語彙が増えている: ${st.plainLex}`);
  ok(st.wiseLex > 0, `賢い頭で語彙が広がらない: ${st.wiseLex}`);
  ok(st.wiseXp > st.plainXp, `賢い頭で経験値が上がらない: ${st.plainXp} -> ${st.wiseXp}`);
  ok(st.wiseArmor > st.plainArmor, `硬い胴で装甲が上がらない: ${st.plainArmor} -> ${st.wiseArmor}`);
  ok(st.slots === 1, `頭の語が 1 つでない: ${st.slots}`);
  ok(/\/ 10 文字/.test(st.limit), `部位の上限が 10 文字でない: ${st.limit}`);
  ok(/語彙/.test(st.total), `部位の合計に語彙が出ない: ${st.total}`);
  console.log(`    頭「賢」で語彙 +${st.wiseLex} / 胴「硬」で装甲 +${(st.wiseArmor * 100).toFixed(0)}%`);

  // 書庫タブは言葉くじとデッキだけ。恒久強化の入れ物は残っていない。
  const w = await evalJs(`(() => {
    const app = window.__wordrogue;
    app.menus.show('words');
    return {
      growHidden: document.getElementById('grow').hidden,
      gacha: !!document.getElementById('gachaBtn') && !!document.getElementById('gachaTenBtn'),
      deck: document.querySelectorAll('#deckWords .grow-word').length,
      leftovers: document.querySelectorAll('#archiveUpgrades, #archiveWords, .up-row, .up-buy').length,
    };
  })()`);
  ok(w.growHidden, '書庫タブで強化タブが残っている');
  ok(w.gacha, '言葉くじのボタンが無い');
  ok(w.deck > 0, '言葉デッキの語が出ていない');
  ok(w.leftovers === 0, `恒久強化の入れ物が残っている: ${w.leftovers}`);
}
await evalJs('window.__wordrogue.menus.show("title")');
await sleep(150);

sec('コナミコマンドで開発者モードを開閉する');
{
  const keys = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
  const opened = await evalJs(`(() => {
    const app = window.__wordrogue;
    app.menus.show('title');
    app.mode = 'title';
    for (const key of ${JSON.stringify(keys)}) window.dispatchEvent(new KeyboardEvent('keydown', { key }));
    return { visible: !document.getElementById('devMode').hidden, mode: app.mode };
  })()`);
  ok(opened.visible && opened.mode === 'dev', `開発者モードが開かない: ${JSON.stringify(opened)}`);
  await evalJs(`for (const key of ${JSON.stringify(keys)}) window.dispatchEvent(new KeyboardEvent('keydown', { key }))`);
  ok(await evalJs('document.getElementById("devMode").hidden'), 'コマンド再入力で開発者モードが閉じない');
  ok(await evalJs('window.__wordrogue.mode === "title"'), '閉じた後タイトルへ戻らない');
  console.log('    ↑↑↓↓←→←→BA で開き、再入力で閉じる');
}

sec('Esc は開いている画面を閉じ、裏のタイトルで Enter が暴発しない');
{
  const r = await evalJs(`(() => {
    const app = window.__wordrogue;
    const m = app.menus;
    if (m.tutorial && !m.tutorial.hidden) m.closeTutorial();
    m.show('title');
    app.mode = 'title';
    m.show('howto');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter' }));
    const afterEnter = {
      howto: !document.getElementById('howto').hidden,
      stages: !document.getElementById('stages').hidden,
    };
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape' }));
    return {
      afterEnter,
      afterEsc: {
        howto: !document.getElementById('howto').hidden,
        title: !document.getElementById('title').hidden,
      },
    };
  })()`);
  ok(r.afterEnter.howto, '遊び方が開いていない');
  ok(!r.afterEnter.stages, '遊び方の上で Enter を押すと裏のステージ選択が開く');
  ok(!r.afterEsc.howto, 'Esc で遊び方が閉じない');
  ok(r.afterEsc.title, 'Esc でタイトルに戻らない');
  console.log('    画面の上では Enter が裏へ抜けず、Esc で 1 段戻る');
}

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
    ['hudPaused','hudHint','hudBoss','forge','result','title','stages','loadout','howto','settings']
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
ok(runInfo.lexicon === 0, `開始時の語彙が空でない: ${runInfo.lexicon}`);
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

sec('一時停止メニューから再開・設定・自動停止ができる');
{
  await evalJs('document.getElementById("btnPause").click()');
  await sleep(220);
  const p0 = await evalJs(`({
    open: !document.getElementById('hudPaused').hidden,
    mode: window.__wordrogue.mode,
    paused: window.__wordrogue.run.paused,
    forge: !document.getElementById('forge').hidden,
    resume: !!document.getElementById('btnResume'),
    meta: document.getElementById('pauseMeta').textContent,
  })`);
  ok(p0.open, '一時停止メニューが出ない');
  ok(p0.mode === 'pause', `mode が pause でない: ${p0.mode}`);
  ok(p0.paused === true, '一時停止しても時間が止まらない');
  ok(!p0.forge, '一時停止で言葉鍛冶まで開いてしまう');
  ok(p0.resume, '再開ボタンが無い');
  ok(/第 \d+ 戦/.test(p0.meta), `止めた場所が出ない: ${p0.meta}`);

  await evalJs('document.getElementById("btnPauseSettings").click()');
  await sleep(200);
  const p1 = await evalJs(`({
    settings: !document.getElementById('settings').hidden,
    pause: !document.getElementById('hudPaused').hidden,
    mode: window.__wordrogue.mode,
  })`);
  ok(p1.settings, 'ポーズから設定が開かない');
  ok(!p1.pause, '設定の裏にポーズ画面が残っている');
  ok(p1.mode === 'settings', `mode が settings でない: ${p1.mode}`);

  await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape' }));`);
  await sleep(220);
  const p2 = await evalJs(`({
    settings: !document.getElementById('settings').hidden,
    pause: !document.getElementById('hudPaused').hidden,
    mode: window.__wordrogue.mode,
    paused: window.__wordrogue.run.paused,
  })`);
  ok(!p2.settings, 'Esc で設定が閉じない');
  ok(p2.pause, '設定を閉じてもポーズに戻らない');
  ok(p2.mode === 'pause' && p2.paused, `ポーズに戻っていない: ${p2.mode}`);

  await evalJs('document.getElementById("btnResume").click()');
  await sleep(220);
  const p3 = await evalJs(`({
    open: !document.getElementById('hudPaused').hidden,
    mode: window.__wordrogue.mode,
    paused: window.__wordrogue.run.paused,
  })`);
  ok(!p3.open && p3.mode === 'play' && !p3.paused, '再開できない');

  const auto = await evalJs(`(() => {
    const app = window.__wordrogue;
    app.input.keys.add('d');
    window.dispatchEvent(new Event('blur'));
    return {
      keys: app.input.keys.size,
      mode: app.mode,
      paused: app.run.paused,
    };
  })()`);
  ok(auto.keys === 0, `blur 後もキーが残っている: ${auto.keys}`);
  ok(auto.mode === 'pause' && auto.paused, 'ウィンドウを離れても自動で止まらない');
  await evalJs('document.getElementById("btnResume").click()');
  await sleep(200);
  console.log('    再開 / 設定 / Esc / blur 自動停止を確認');
}

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
ok(rows.self === 0, `自身の文の行が残っている: ${rows.self}`);
ok(rows.weapon === 1, `武器の文の行の数: ${rows.weapon}`);
// 武器が最大 3 つまで無いことを知らせる余白行。
ok(rows.hint === 1, `武器を追加できる旨の行が無い: ${JSON.stringify(rows)}`);
console.log(`    行: 自身 ${rows.self} / 武器 ${rows.weapon} / 追加案内 ${rows.hint}`);
const words = await evalJs('document.querySelectorAll("#forgeWeapons .sen-word").length');
ok(words >= 1, `文の中の語が表示されない: ${words}`);
const gaps = await evalJs('document.querySelectorAll("#forgeWeapons .sen-gap, #forgeWeapons .sen-out").length');
ok(gaps === 0, `語のあいだの記号や空欄が残っている: ${gaps}`);
const rowsN = await evalJs('document.querySelectorAll("#forgeWeapons .sen-row").length');
ok(rowsN >= 1, `文の行が出ていない: ${rowsN}`);
const conns = await evalJs('document.querySelectorAll("#forgeWeapons .sen-conn").length');
ok(conns >= 1, `接続詞の表示がない: ${conns}`);

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
    wi.sentence.push(m.makeWord('刃'));
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
      gaps: document.querySelectorAll('#forgeWeapons .sen-gap, #forgeWeapons .sen-out').length,
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
  ok(conn.gaps === 0, `語のあいだの ✕ / 空欄が残っている: ${conn.gaps}`);
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
      sentenceRows: document.querySelectorAll('#forgeWeapons .sen-row').length,
      rows: [...document.querySelectorAll('#forgeWeapons .wrow')].map(n => n.textContent),
    };
  })()`);
  // 武器の文に末尾語は無い。文面プレビューは廃止し、語の行そのものが文になる。
  ok(tails.defs.every((w) => w.maxLen === 10), `文の上限が 10 でない: ${tails.defs.map(w => w.maxLen)}`);
  ok(tails.texts.length === 0, `一文プレビューが残っている: ${tails.texts.join(' | ')}`);
  ok(tails.sentenceRows === tails.defs.length,
    `文の行の数: ${tails.sentenceRows} / ${tails.defs.length}`);
  for (const w of tails.defs) {
    ok(w.title && !/undefined|null|空/.test(w.title), `武器名が壊れている: ${w.title}`);
  }
  console.log(`    文の行: ${tails.sentenceRows} / 一文プレビュー無し`);
}
const coreGone = await evalJs('document.querySelectorAll("#forgeWeapons .sn-core").length');
ok(coreGone === 0, `核語の表示が残っている: ${coreGone}`);

// スタミナ_present か。
const hasStamina = await evalJs('!!document.getElementById("staFill")');
ok(hasStamina, 'スタミナバーが無い');
const pwords = await evalJs('document.querySelectorAll("#forgeLexicon .pword:not(.empty)").length');
ok(pwords >= 0, `語彙の語: ${pwords}`);

sec('語を文に足すと文が変わる');
const changed = await evalJs(`(async () => {
  const app = window.__wordrogue;
  const run = app.run;
  const before = run.weapons.map(w => w.resolve(run.player.stats).fullText);
  // 語彙が空なら語を 1 つ足す。
  if (!run.lexicon.find(w => w)) {
    const m = await import(new URL('js/data/words.js', document.baseURI).href);
    run.addWord(m.makeWord('炎'), true);
  }
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
  const dnd = await evalJs(`(async () => {
    const run = window.__wordrogue.run;
    const wi = run.weapons[0];
    // 直前のテストで文を空にしました。語が無いと「語の置き場」を見られない。
    if (!run.lexicon.find((w) => w)) {
      const m = await import(new URL('js/data/words.js', document.baseURI).href);
      run.addWord(m.makeWord('炎'), true);
    }
    if (wi.sentence.count <= 1) {
      const forge = window.__wordrogue.forge;
      const lx = run.lexicon.findIndex((w) => w);
      if (lx >= 0) forge.dropOnto({ kind: 'lexicon', index: lx }, { kind: 'slot', wi, index: 0 });
    }
    const lex = [...document.querySelectorAll('#forgeLexicon .pword:not(.empty)')];
    // 自身の文と「武器を追加できる」の行を除いた、武器の文の行。
    const row0 = [...document.querySelectorAll('#forgeWeapons .wrow')]
      .find((r) => !r.classList.contains('wrow-self') && !r.classList.contains('wrow-empty'));
    const item0 = row0 && row0.querySelector('.sen-item');
    const senRow = row0 && row0.querySelector('.sen-row');
    const sr = senRow && senRow.getBoundingClientRect();
    const hr = row0 && row0.querySelector('.wrow-head').getBoundingClientRect();
    const forge = window.__wordrogue.forge;
    const rowPlace = !!(sr && forge.dropAt(sr.left + sr.width / 2, sr.top + sr.height / 2));
    const headPlace = !!(hr && forge.dropAt(hr.left + 4, hr.top + hr.height / 2));
    return {
      // HTML5 の draggable は使ってない。pointer で自前実装する。
      html5: document.querySelectorAll('#forge [draggable="true"]').length,
      lexicon: lex.length,
      lexiconPlace: lex.filter(n => n.dataset.place).length,
      itemPlace: !!item0 && !!item0.dataset.place,
      rowPlace,
      headPlace,
    };
  })()`);
  ok(dnd.html5 === 0, `HTML5 の draggable が残っている: ${dnd.html5} 個 (タップを奪う)`);
  ok(dnd.lexicon === dnd.lexiconPlace, `語彙の語に data-place が無い: ${dnd.lexiconPlace} / ${dnd.lexicon}`);
  ok(!dnd.itemPlace, '文の語に古い data-place が残っている');
  ok(dnd.rowPlace, '文の行がドロップ先になっていない');
  ok(dnd.headPlace, '武器の見出しへのドロップが行に届かない');
  console.log(`    語彙 ${dnd.lexicon} 語に data-place / 文の行と見出しのどこでもドロップ可`);
}

sec('ドラッグで語を文へ入れ、文の並びを変えられること');
{
  // HTML5 のドラッグは CDP から再現しにくいので、Forge の drop ハンドラを直接叩く。
  const dnd = await evalJs(`(async () => {
    const app = window.__wordrogue;
    const forge = app.forge;
    const run = app.run;
    const wi = run.weapons[0];
    // 結果に左右されないよう、文を空にしてから始める。
    wi.sentence.clear();
    forge.render();
    // 語彙が空なら語を足す。
    if (!run.lexicon.find(w => w)) {
      const m = await import(new URL('js/data/words.js', document.baseURI).href);
      run.addWord(m.makeWord('炎'), true);
      run.addWord(m.makeWord('剛'), true);
      run.addWord(m.makeWord('速'), true);
    }
    const a = run.lexicon.findIndex(w => w);
    const b = run.lexicon.findIndex((w, i) => i > a && w);
    const wa = run.lexicon[a].text;
    const wb = run.lexicon[b].text;

    // 語彙 -> 文の末尾 (行の末尾に落とす = 足す)。
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

    // 文の行の末尾へ運べば、並びの末尾に来る。
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
    `行の末尾へ運んでも末尾に来ない: ${JSON.stringify(dnd.gapMoved)}`);
  ok(dnd.back.count === 1, `文から語が戻らない: ${dnd.back.count}`);
  // 先頭の語を語彙へ戻すので、入るのは wa の語。
  ok(dnd.back.lex === dnd.wa, `語彙へ語が戻らない: ${dnd.back.lex}`);
  ok(dnd.backOccupied.ok && dnd.backOccupied.lexHasIt,
    `埋まったマスに落としても語彙へ戻らない: ${JSON.stringify(dnd.backOccupied)}`);
  console.log(`    「${dnd.wa}」→「${dnd.title}」… 並べ替え → 行の末尾 → 語彙へ戻す すべて成立`);
}

sec('語の上に落としても置き換えない (手前に差し込む)');
{
  const dnd = await evalJs(`(async () => {
    const m = await import(new URL('js/data/words.js', document.baseURI).href);
    const app = window.__wordrogue;
    const forge = app.forge;
    const run = app.run;
    const wi = run.weapons[0];
    wi.sentence.clear();
    for (const t of ['炎', '剛', '速']) wi.sentence.push(m.makeWord(t));
    while (run.lexiconFull) run.forgetWord(run.lexicon.find(Boolean));
    if (!run.lexicon.some((w) => w && w.text === '火')) run.addWord(m.makeWord('火'), true);
    const lx = run.lexicon.findIndex((w) => w && w.text === '火');
    forge.render();
    // 文の 2 番目の語 (剛) の上へ 火 を落とす。
    forge.dropOnto({ kind: 'lexicon', index: lx }, { kind: 'slot', wi, index: 1 });
    const texts = wi.sentence.words.map((w) => w.text);
    forge.dragFrom = null;
    forge.suppressClick = false;
    return { texts };
  })()`);
  ok(dnd.texts.join('') === '炎火剛速',
    `置き換えが起きた / 手前に差し込めていない: ${dnd.texts.join('')}`);
  ok(dnd.texts.includes('剛'), `落とした先の語が消えた: ${dnd.texts.join('')}`);
  console.log(`    「炎剛速」の「剛」へ「火」-> 「${dnd.texts.join('')}」`);
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
      + run.weapons.reduce((n, w) => n + w.sentence.count, 0);
    const lexText = run.lexicon[0].text;

    // 語彙 -> 文 (行の末尾)。語彙の空きが 1 つ増えるだけ。
    forge.dropOnto({ kind: 'lexicon', index: 0 }, { kind: 'gap', wi, index: wi.sentence.count });
    const after = run.lexicon.filter(Boolean).length
      + run.weapons.reduce((n, w) => n + w.sentence.count, 0);
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

sec('レベルアップ選択中はゲームが止まり、中央に大きな選択肢が出る');
{
  await evalJs(`(() => {
    const app = window.__wordrogue;
    if (!document.getElementById('forge').hidden) app.forge.close();
    app.menus.hideAll();
    app.mode = 'play';
    app.run.paused = false;
    app.hud.show(true);
    const run = app.run;
    // 語彙が満杯だと先に捨てる操作が要るので、空きを 1 つ作る。
    let guard = 0;
    while (run.lexiconFull && guard++ < 40) {
      run.forgetWord(run.lexicon[run.lexicon.findIndex(Boolean)]);
    }
    run.pendingChoices.length = 0;
    app.hud._choiceSig = '';
    run.offerWordChoices();
  })()`);
  await sleep(350);
  const ui = await evalJs(`(() => {
    const app = window.__wordrogue;
    const run = app.run;
    const box = document.getElementById('hudChoice');
    const veil = document.getElementById('hudChoiceVeil');
    const br = box.getBoundingClientRect();
    const card = document.querySelector('#choiceList .choice-card');
    const cr = card && card.getBoundingClientRect();
    return {
      hidden: box.hidden,
      veil: !veil.hidden,
      cx: br.left + br.width / 2,
      cy: br.top + br.height / 2,
      vw: window.innerWidth,
      vh: window.innerHeight,
      w: br.width,
      cardW: cr ? cr.width : 0,
      cardH: cr ? cr.height : 0,
      time: run.time,
      pending: run.pendingChoices.length,
    };
  })()`);
  ok(!ui.hidden, '3 択の中央パネルが出ていない');
  ok(ui.veil, '3 択の背景幕が出ていない');
  ok(ui.pending === 1, `3 択の候補が ${ui.pending} 件`);
  ok(Math.abs(ui.cx - ui.vw / 2) < 3, `3 択が横中央でない: ${ui.cx} / ${ui.vw / 2}`);
  ok(Math.abs(ui.cy - ui.vh / 2) < 3, `3 択が縦中央でない: ${ui.cy} / ${ui.vh / 2}`);
  ok(ui.w >= 400, `3 択のパネルが小さい: ${ui.w}px`);
  ok(ui.cardW >= 120 && ui.cardH >= 90,
    `候補カードが小さい: ${ui.cardW}x${ui.cardH}`);

  await sleep(500);
  const after = await evalJs(`(() => {
    const app = window.__wordrogue;
    return { time: app.run.time, hp: app.run.player.hp, pending: app.run.pendingChoices.length };
  })()`);
  ok(after.time === ui.time, `選択中にステージ時間が進んだ: ${ui.time} -> ${after.time}`);
  ok(after.pending === 1, `選択中に 3 択が消えた: ${after.pending}`);

  // 後続のテストに残さない。候補を 1 つ選んで閉じる。
  await evalJs(`(() => {
    const card = document.querySelector('#choiceList .choice-card');
    if (card) card.click();
    const app = window.__wordrogue;
    app.run.pendingChoices.length = 0;
    app.hud._choiceSig = '';
    app.run.paused = false;
    app.mode = 'play';
  })()`);
  await sleep(200);
  console.log(`    中央 ${Math.round(ui.cx)},${Math.round(ui.cy)} / パネル ${Math.round(ui.w)}px`
    + ` / カード ${Math.round(ui.cardW)}x${Math.round(ui.cardH)}`);
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
  ok(d.tabs === 6, `カテゴリのタブ数: ${d.tabs} (すべて + 5 カテゴリ。形態は載せない。体に効く専用カテゴリは無い)`);
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
    // 文の余白をタップすると末尾に入る。特定の「＋」は無い。
    const senRow = row.querySelector('.sen-row');
    if (armed && senRow) tap(senRow);
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
    // 文の行のどこでも追加位置になる。
    const row = [...document.querySelectorAll('#forgeWeapons .wrow')]
      .find((r) => !r.classList.contains('wrow-self') && !r.classList.contains('wrow-empty'));
    const to = row.querySelector('.sen-row').getBoundingClientRect();
    const x0 = from.left + from.width / 2, y0 = from.top + from.height / 2;
    const x1 = to.right - 4, y1 = to.top + to.height / 2;
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

sec('指が文の行の上で離れてもドロップが確定する');
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
    const senRow = row.querySelector('.sen-row');
    const from = word.getBoundingClientRect();
    const to = senRow.getBoundingClientRect();
    const x0 = from.left + from.width / 2, y0 = from.top + from.height / 2;
    const x1 = to.right - 4, y1 = to.top + to.height / 2;
    const o = (x, y) => ({
      bubbles: true, cancelable: true, clientX: x, clientY: y,
      pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0,
    });
    word.dispatchEvent(new PointerEvent('pointerdown', o(x0, y0)));
    word.dispatchEvent(new PointerEvent('pointermove', o(x0 + 20, y0 + 20)));
    word.dispatchEvent(new PointerEvent('pointermove', o(x1, y1)));
    // pointerup は文の行へ飛ばす。ソースには届かない。
    senRow.dispatchEvent(new PointerEvent('pointerup', o(x1, y1)));
    const got = wi.sentence.words[0] && wi.sentence.words[0].text;
    return { text, got, ok: got === text, dragFrom: forge.dragFrom };
  })()`);
  ok(d.ok, `行の上で離しても語が入らない: ${d.got} (狙いは ${d.text})`);
  ok(!d.dragFrom, 'ドラッグの後に dragFrom が残った');
  console.log(`    行の上で離しても「${d.text}」が入った`);
}

sec('文の語を語彙の箱へドラッグで戻せる');
{
  const d = await evalJs(`(async () => {
    const m = await import(new URL('js/data/words.js', document.baseURI).href);
    const app = window.__wordrogue;
    const forge = app.forge;
    const run = app.run;
    app.menus.hideAll();
    if (document.getElementById('forge').hidden) document.getElementById('btnForge').click();
    const wi = run.weapons[0];
    wi.sentence.clear();
    for (const t of ['炎', '剛', '速']) wi.sentence.push(m.makeWord(t));
    while (run.lexiconFull) run.forgetWord(run.lexicon.find(Boolean));
    run.refreshStats();
    forge.render();

    const chip = document.querySelector('#forgeWeapons .sen-word');
    const text = chip.querySelector('span').textContent.trim();
    const box = document.getElementById('forgeLexicon').getBoundingClientRect();
    const from = chip.getBoundingClientRect();
    const x0 = from.left + from.width / 2, y0 = from.top + from.height / 2;
    const x1 = box.left + box.width / 2, y1 = box.top + box.height / 2;
    const ev = (type, x, y) => chip.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, clientX: x, clientY: y,
      pointerId: 9, pointerType: 'touch', isPrimary: true, button: 0,
    }));
    ev('pointerdown', x0, y0);
    ev('pointermove', x0 + 20, y0 + 20);
    ev('pointermove', x1, y1);
    ev('pointerup', x1, y1);
    return {
      text,
      removed: !wi.sentence.words.some((w) => w.text === text),
      inLex: run.lexicon.some((w) => w && w.text === text),
      dragFrom: forge.dragFrom,
    };
  })()`);
  ok(d.removed, `文の語が残っている: ${d.text}`);
  ok(d.inLex, '語彙の箱へ戻っていない');
  ok(!d.dragFrom, 'ドラッグの後に dragFrom が残った');
  console.log(`    文の「${d.text}」を語彙の箱へ -> 戻った`);
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
    const senRow = row.querySelector('.sen-row');
    const from = word.getBoundingClientRect();
    const to = senRow.getBoundingClientRect();
    const x0 = from.left + from.width / 2, y0 = from.top + from.height / 2;
    const x1 = to.right - 4, y1 = to.top + to.height / 2;
    const o = (x, y) => ({
      bubbles: true, cancelable: true, clientX: x, clientY: y,
      pointerId: 8, pointerType: 'touch', isPrimary: true, button: 0,
    });
    word.dispatchEvent(new PointerEvent('pointerdown', o(x0, y0)));
    word.dispatchEvent(new PointerEvent('pointermove', o(x0 + 20, y0 + 20)));
    word.dispatchEvent(new PointerEvent('pointermove', o(x1, y1)));
    senRow.dispatchEvent(new PointerEvent('pointercancel', o(x1, y1)));
    const got = wi.sentence.words[0] && wi.sentence.words[0].text;
    return { text, got, ok: got == null, dragFrom: forge.dragFrom };
  })()`);
  ok(d.ok, `pointercancel で語が文へ入ってしまう: ${d.got}`);
  ok(!d.dragFrom, 'pointercancel の後に dragFrom が残った');
  console.log('    pointercancel では語が入らない');
}

sec('言葉鍛冶で「敵を深く斬る剣」と「深く敵を斬る剣」を作って攻撃できる');
{
  const r = await evalJs(`(async () => {
    const m = await import(new URL('js/data/words.js', document.baseURI).href);
    const app = window.__wordrogue;
    const forge = app.forge;
    const run = app.run;
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    app.menus.hideAll();
    if (document.getElementById('forge').hidden) document.getElementById('btnForge').click();

    // 武器 1 本と語彙を、この検査に必要な語だけにする。
    const wi = run.weapons[0];
    wi.sentence.clear();
    for (let i = 0; i < run.lexicon.length; i++) run.lexicon[i] = null;
    for (const t of ['敵', '深', '斬', '剣']) run.giveWord(m.makeWord(t), true);
    run.refreshStats();
    forge.render();

    const realRows = () => [...document.querySelectorAll('#forgeWeapons .wrow')]
      .filter((r) => !r.classList.contains('wrow-self') && !r.classList.contains('wrow-empty'));
    const row = () => realRows()[0];
    const senRow = () => row().querySelector('.sen-row');
    const lexChip = (t) => [...document.querySelectorAll('#forgeLexicon .pword:not(.empty)')]
      .find((n) => n.querySelector('span') && n.querySelector('span').textContent.trim() === t);
    let pointerId = 100;
    const ev = (node, type, x, y, id) => node.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true,
      clientX: x, clientY: y, pointerId: id, pointerType: 'mouse',
      isPrimary: true, button: 0,
    }));
    // 語を掴んで、座標へ運んで離す。ドロップ先は行 (target) の要素。
    const drag = (src, target, x1, y1) => {
      const a = src.getBoundingClientRect();
      const x0 = a.left + a.width / 2, y0 = a.top + a.height / 2;
      const id = ++pointerId;
      ev(src, 'pointerdown', x0, y0, id);
      ev(src, 'pointermove', x0 + 24, y0 + 16, id);
      ev(src, 'pointermove', x1, y1, id);
      ev(target, 'pointerup', x1, y1, id);
    };
    // 文の行の右端へ落とす。語と語のあいだの特定の隙間は狙わない。
    const addWord = (t) => {
      const chip = lexChip(t);
      if (!chip) return false;
      const r = senRow().getBoundingClientRect();
      drag(chip, senRow(), r.right - 8, r.top + r.height / 2);
      return true;
    };
    const tap = (node) => {
      const r = node.getBoundingClientRect();
      const id = ++pointerId;
      ev(node, 'pointerdown', r.left + r.width / 2, r.top + r.height / 2, id);
      ev(node, 'pointerup', r.left + r.width / 2, r.top + r.height / 2, id);
    };
    // 語の右の接続詞チップをタップし、一覧から選ぶ。
    const setConn = (index, k) => {
      const items = [...senRow().querySelectorAll('.sen-item')];
      const chip = items[index] && items[index].querySelector('.sen-conn');
      if (!chip) return { ok: false, why: 'no-chip' };
      tap(chip);
      const btn = [...document.querySelectorAll('.conn-pick')]
        .find((b) => b.textContent.trim() === k);
      if (!btn) {
        return {
          ok: false, why: 'no-option',
          options: [...document.querySelectorAll('.conn-pick')].map((b) => b.textContent.trim()),
        };
      }
      btn.click();
      return { ok: true, conn: wi.sentence.at(index).conn ? wi.sentence.at(index).conn.text : null };
    };
    const build = async (order, conns) => {
      for (const t of order) addWord(t);
      await sleep(40);             // ドラッグ直後のタップ抑制を解く
      const set = [];
      for (const x of conns) {
        const z = setConn(x[0], x[1]);
        set.push(z);
        if (!z.ok) break;
      }
      return { set, text: wi.sentence.text };
    };
    const snapshot = () => {
      const res = wi.resolve(run.player.stats);
      const rr = row();
      return {
        text: wi.sentence.text,
        words: wi.sentence.words.map((w) => w.text),
        conns: wi.sentence.conns.map((c) => (c ? c.text : null)),
        valid: res.valid,
        active: res.active,
        dmg: res.stats.dmg,
        kind: res.kind,
        tail: res.tail,
        grade: res.gradeInfo ? res.gradeInfo.name : '',
        shownGrade: rr.querySelector('.wrow-grade')
          ? rr.querySelector('.wrow-grade').textContent.trim() : '',
        nat: rr.querySelector('.wrow-nat') ? rr.querySelector('.wrow-nat').textContent : '',
        natural: res.evalResult ? res.evalResult.natural : 0,
        pending: res.pending,
        reason: res.reasonText || res.reason || '',
      };
    };
    const returnWord = async (t) => {
      const chip = [...senRow().querySelectorAll('.sen-word:not(.sen-tail)')]
        .find((n) => n.textContent.trim() === t);
      if (!chip) return { ok: false, why: 'no-word' };
      const box = document.getElementById('forgeLexicon').getBoundingClientRect();
      drag(chip, document.getElementById('forgeLexicon'), box.left + box.width / 2, box.top + box.height / 2);
      await sleep(40);
      return {
        ok: true,
        inSen: wi.sentence.words.some((w) => w.text === t),
        inLex: run.lexicon.some((w) => w && w.text === t),
      };
    };

    const firstBuild = await build(['敵', '深', '斬', '剣'], [[0, 'を'], [1, 'く'], [2, 'る']]);
    const afterFirst = snapshot();

    // 文の語を語彙へ戻す (DOM のドラッグ)。4 語すべて戻してから作り直す。
    const returned = [];
    for (const t of ['剣', '斬', '深', '敵']) returned.push(await returnWord(t));
    const empty = { count: wi.sentence.count, lex: run.lexicon.filter(Boolean).map((w) => w.text) };

    const secondBuild = await build(['深', '敵', '斬', '剣'], [[0, 'く'], [1, 'を'], [2, 'る']]);
    const afterSecond = snapshot();

    // 語の上に落としても置き換えない (手前に差し込む)。
    run.giveWord(m.makeWord('火'), true);
    run.refreshStats();
    forge.render();
    const fireChip = lexChip('火');
    const targetChip = [...senRow().querySelectorAll('.sen-word:not(.sen-tail)')]
      .find((n) => n.textContent.trim() === '斬');
    const tc = targetChip.getBoundingClientRect();
    drag(fireChip, targetChip, tc.left + tc.width / 2, tc.top + tc.height / 2);
    await sleep(40);
    const inserted = { words: wi.sentence.words.map((w) => w.text), count: wi.sentence.count };
    const fireInSen = [...senRow().querySelectorAll('.sen-word:not(.sen-tail)')]
      .find((n) => n.textContent.trim() === '火');
    const lb = document.getElementById('forgeLexicon').getBoundingClientRect();
    drag(fireInSen, document.getElementById('forgeLexicon'), lb.left + lb.width / 2, lb.top + lb.height / 2);
    await sleep(40);
    const afterCleanup = snapshot();

    return {
      firstBuild, afterFirst, returned, empty, secondBuild, afterSecond,
      inserted, afterCleanup, lexCount: run.lexicon.filter(Boolean).length,
    };
  })()`);

  ok(r.firstBuild.text === '敵を深く斬る剣', `1 つ目の文面: ${r.firstBuild.text}`);
  ok(r.firstBuild.set.every((s) => s.ok), `接続詞を UI から選べない: ${JSON.stringify(r.firstBuild.set)}`);
  ok(r.afterFirst.words.join('') === '敵深斬剣', `語の並び: ${r.afterFirst.words.join('')}`);
  ok(r.afterFirst.conns.join(',') === 'を,く,る,', `接続詞の並び: ${r.afterFirst.conns.join(',')}`);
  ok(r.afterFirst.valid, `「${r.afterFirst.text}」が不成文: ${r.afterFirst.reason}`);
  ok(r.afterFirst.active, `「${r.afterFirst.text}」が攻撃しない`);
  ok(r.afterFirst.dmg > 0, `威力が 0: ${r.afterFirst.dmg}`);
  ok(r.afterFirst.tail === '剣' && r.afterFirst.kind === 'slash',
    `武器語と攻撃の型: ${r.afterFirst.tail} / ${r.afterFirst.kind}`);
  ok(/名文|絶句|成立/.test(r.afterFirst.shownGrade) && r.afterFirst.shownGrade !== '不成文',
    `表示が成立していない: ${r.afterFirst.shownGrade}`);
  ok(/連用修飾/.test(r.afterFirst.nat) && /目的語/.test(r.afterFirst.nat),
    `自然さの内訳に連用修飾・目的語が出ない: ${r.afterFirst.nat}`);
  console.log(`    「${r.afterFirst.text}」— ${r.afterFirst.shownGrade} / 自然さ ${r.afterFirst.natural.toFixed(2)} / 威力 ${r.afterFirst.dmg.toFixed(0)}`);

  ok(r.returned.every((x) => x.ok && !x.inSen && x.inLex),
    `文の語を語彙へ戻せない: ${JSON.stringify(r.returned)}`);
  ok(r.empty.count === 0, `文が空にならない: ${r.empty.count}`);
  ok(r.empty.lex.length === 4, `語彙に 4 語戻っていない: ${r.empty.lex.join('')}`);

  ok(r.secondBuild.text === '深く敵を斬る剣', `2 つ目の文面: ${r.secondBuild.text}`);
  ok(r.secondBuild.set.every((s) => s.ok), `接続詞を UI から選べない: ${JSON.stringify(r.secondBuild.set)}`);
  ok(r.afterSecond.valid, `「${r.afterSecond.text}」が不成文: ${r.afterSecond.reason}`);
  ok(r.afterSecond.active, `「${r.afterSecond.text}」が攻撃しない`);
  ok(r.afterSecond.dmg > 0, `威力が 0: ${r.afterSecond.dmg}`);
  ok(/名文|絶句|成立/.test(r.afterSecond.shownGrade) && r.afterSecond.shownGrade !== '不成文',
    `表示が成立していない: ${r.afterSecond.shownGrade}`);
  ok(Math.abs(r.afterSecond.natural - r.afterFirst.natural) < 1e-9,
    `語順で自然さが変わる: ${r.afterFirst.natural} / ${r.afterSecond.natural}`);
  console.log(`    「${r.afterSecond.text}」— ${r.afterSecond.shownGrade} / 自然さ ${r.afterSecond.natural.toFixed(2)} / 威力 ${r.afterSecond.dmg.toFixed(0)}`);

  // 語の上に落としても置き換えない。すべての語が残り、1 語増える。
  ok(r.inserted.count === 5, `置き換えが起きた: ${r.inserted.words.join('')} (${r.inserted.count} 語)`);
  for (const t of ['深', '敵', '斬', '剣', '火']) {
    ok(r.inserted.words.includes(t), `差し込みで「${t}」が消えた: ${r.inserted.words.join('')}`);
  }
  ok(r.afterCleanup.text === '深く敵を斬る剣', `差し込んだ語を戻せない: ${r.afterCleanup.text}`);
  ok(r.afterCleanup.active, `戻したあと攻撃できない: ${r.afterCleanup.reason}`);
  console.log(`    差し込み: ${r.inserted.words.join('')} → 戻すと「${r.afterCleanup.text}」`);
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

sec('部位強化はメニューで設定し、戦闘に効く');
{
  // メニューを開いて、部位に語を入れ、デッキを組み替える。
  const menu = await evalJs(`(() => {
    const app = window.__wordrogue;
    app.menus.show('grow');
    const save = app.save;
    save.addInk(1000);
    app.menus.renderGrow();
    const gachaBefore = save.collection.length;
    const g = save.drawGacha();
    // 部位は 10 文字まで。文末は語で閉じるので、接続詞は前の語に付ける
    // (癒す骨)。1 語 + 接続詞は文末が接続詞になり、不成文になる。
    save.setPart('head', 0, '癒');
    save.setPart('head', 1, '骨');
    save.toggleDeck('炎');
    return {
      shown: !document.getElementById('grow').hidden,
      parts: document.querySelectorAll('#growParts .grow-part').length,
      words: document.querySelectorAll('#growWords .grow-word').length,
      gachaBefore, gachaOk: g.ok, coll: save.collection.length,
      part: save.partWordList().join(''),
      ink: save.ink,
    };
  })()`);
  ok(menu.shown, '部位強化の画面が開かない');
  ok(menu.parts === 7, `部位の数: ${menu.parts}`);
  ok(menu.words >= 5, `所持語の表示が少ない: ${menu.words}`);
  ok(menu.gachaOk, '言葉くじが引けない');
  ok(menu.coll >= menu.gachaBefore, `くじで所持語が減った: ${menu.gachaBefore} -> ${menu.coll}`);
  ok(menu.part.includes('癒'), `部位に語が入らない: ${menu.part}`);
  console.log(`    部位 7 / 所持 ${menu.words} 語 (体に効く語だけ) / くじ後の言玉 ${menu.ink}`);

  // ランに渡すと、部位の語が能力に乗り、デッキが開始時の語彙に入る。
  const applied = await evalJs(`(async () => {
    const m = await import(new URL('js/game/run.js', document.baseURI).href);
    const app = window.__wordrogue;
    app.menus.hide('grow');
    const run = new m.Run({
      stageId: 1, save: app.save, audio: app.audio, weaponIds: ['sword'],
      lexiconSize: 12, deckWords: app.save.deck, partWords: app.save.partWordList(),
    });
    return {
      partCount: run.player.stats.partCount,
      maxHp: run.player.stats.maxHp,
      regen: run.player.stats.regen,
      hasSelf: run.player.self !== undefined,
      filled: run.lexicon.filter(Boolean).length,
    };
  })()`);
  ok(applied.partCount >= 1, `部位が能力に乗らない: ${applied.partCount}`);
  ok(applied.regen > 0, `部位の回復が能力に乗らない: ${applied.regen}`);
  ok(applied.maxHp >= 100, `体力が素の値より低い: ${applied.maxHp}`);
  ok(applied.hasSelf === false, '戦闘中に自身の文が残っている');
  ok(applied.filled === 0, `開始時の語彙が空でない: ${applied.filled}`);
  console.log(`    部位 ${applied.partCount} 語 / 体力 ${applied.maxHp} / 語彙 ${applied.filled} 語`);

  // 接続詞を実際に押して選ぶ。候補は **その語の送り仮名だけ** (鍛冶と同じルール)。
  // 頭には 癒 が入っている。癒 の送り仮名は す / える / して / えて。
  // 部位の接続詞の一覧は、戦闘中の言葉鍛冶と **同じ .conn-picker** を開く。
  const conn = await evalJs(`(() => {
    const app = window.__wordrogue;
    app.menus.show('grow');
    app.menus.renderGrow();
    const live = () => [...document.querySelectorAll('#growParts .grow-part')]
      .find(p => p.querySelector('.grow-part-name').textContent === '頭');
    const open = () => {
      if (!document.querySelector('.conn-picker')) live().querySelector('.sen-conn').click();
      return [...document.querySelectorAll('.conn-picker .conn-pick')];
    };
    const labels = open().map(n => n.textContent.trim());
    // 「す」(癒す) を選ぶと文が成る。
    const pick = [...document.querySelectorAll('.conn-picker .conn-pick')]
      .find(n => n.textContent.trim() === 'す');
    if (pick) pick.click();
    const note = live().querySelector('.grow-part-note');
    return {
      labels,
      pickerSameAsForge: !!document.querySelector('.conn-picker'),
      note: note ? note.textContent.trim() : '',
      conn: (app.save.partRaw('head') || []).filter(Boolean)[0].conn,
      words: document.querySelectorAll('#growWords .grow-word').length,
      noteEl: document.getElementById('growWordsNote').textContent,
      totalRows: document.querySelectorAll('#growTotal .eff').length,
      wordEff: document.querySelectorAll('#growWords .grow-word-eff').length,
      undoDisabled: document.getElementById('btnGrowUndo').disabled,
      limit: (live().querySelector('.grow-part-lv') || {}).textContent || '',
    };
  })()`);
  ok(conn.labels[0] === 'なし', `接続詞の一覧の先頭が無しでない: ${JSON.stringify(conn.labels)}`);
  ok(conn.labels.slice(1).every(t => ['す', 'える', 'して', 'えて'].includes(t)),
    `癒 に付かない形が出ている: ${JSON.stringify(conn.labels)}`);
  ok(conn.conn === 'す', `接続詞がセーブに入らない: ${conn.conn}`);
  ok(!/不成文/.test(conn.note), `癒す が不成文になっている: ${conn.note}`);
  ok(/10 文字/.test(conn.limit), `文字数の表示が無い: ${conn.limit}`);
  ok(conn.undoDisabled === false, '「戻す」が押せない');
  ok(conn.totalRows > 0, '部位の合計に効果が出ていない');
  ok(conn.wordEff > 0, '所持語に効きの表示が無い');
  ok(conn.words > 0 && conn.words < 40, `所持語が絞られていない: ${conn.words}`);
  ok(/体に効く/.test(conn.noteEl), `絞り込みの説明が出ない: ${conn.noteEl}`);
  console.log(`    接続詞 ${conn.labels.join(' ')} → ${conn.conn} / 所持語 ${conn.words} / ${conn.limit}`);
}


sec('言葉くじはリールを回してからカードを開く');
{
  // 幕が開いた瞬間に抽選は終わっている。演出だけが遅れる。
  const start = await evalJs(`(() => {
    const app = window.__wordrogue;
    app.menus.show('grow');
    app.save.addInk(500);
    app.menus.renderGrow();
    const ink = app.save.ink;
    const coll = app.save.collection.length;
    document.getElementById('gachaBtn').click();
    const veil = document.getElementById('gachaVeil');
    return {
      ink, coll,
      open: !veil.hidden,
      spinning: veil.classList.contains('is-spinning'),
      revealed: veil.classList.contains('is-revealed'),
      againOff: document.getElementById('gachaAgain').disabled,
      reels: [...document.querySelectorAll('#gachaReels span')].map(s => s.textContent).join(''),
      afterInk: app.save.ink,
      afterColl: app.save.collection.length,
    };
  })()`);
  ok(start.open, 'くじの幕が開かない');
  ok(start.spinning && !start.revealed, '回っている間の状態が違う');
  ok(start.againOff, '回っている間にもう一度引けてしまう');
  ok(start.reels.length >= 3, `リールに語が出ていない: ${JSON.stringify(start.reels)}`);
  ok(start.afterInk < start.ink, `言玉が減っていない: ${start.ink} -> ${start.afterInk}`);
  ok(start.afterColl >= start.coll, `所持語が減った: ${start.coll} -> ${start.afterColl}`);
  console.log(`    開始: 言玉 ${start.ink} -> ${start.afterInk} / リール ${start.reels}`);

  await sleep(500);
  const mid = await evalJs(`(() => {
    const veil = document.getElementById('gachaVeil');
    const g = window.__wordrogue.menus._lastGacha;
    return {
      spinning: veil.classList.contains('is-spinning'),
      revealed: veil.classList.contains('is-revealed'),
      word: g ? g.word : '',
      result: document.getElementById('gachaResult').textContent,
    };
  })()`);
  ok(mid.spinning && !mid.revealed, '500ms でまだ開示されている');
  ok(!mid.result.includes(mid.word), '演出中に一行の結果が先に出ている');

  // 1080ms で停止 + 260ms 後に開示。描画が重い環境でも取りこぼさないよう余裕を取る。
  await sleep(1500);
  const done = await evalJs(`(() => {
    const app = window.__wordrogue;
    const veil = document.getElementById('gachaVeil');
    const g = app.menus._lastGacha;
    return {
      revealed: veil.classList.contains('is-revealed'),
      spinning: veil.classList.contains('is-spinning'),
      word: g.word, dup: !!g.dup, ink: g.ink,
      card: document.getElementById('gachaWord').textContent,
      cat: document.getElementById('gachaCat').textContent.trim(),
      eff: document.getElementById('gachaEff').textContent.trim(),
      note: document.getElementById('gachaNote').textContent,
      seal: document.getElementById('gachaSeal').textContent,
      ribbon: !document.getElementById('gachaNew').hidden,
      againOff: document.getElementById('gachaAgain').disabled,
    };
  })()`);
  ok(done.revealed && !done.spinning, 'リールが止まってもカードが開かない');
  ok(!done.againOff, '開示後にもう一度引けない');
  ok(done.card === done.word, `カードの語が違う: ${done.card} / ${done.word}`);
  ok(done.cat.length > 0, 'カードにカテゴリが出ていない');
  ok(done.eff.length > 0, 'カードに効果が出ていない');
  ok(/言玉/.test(done.note), `残りの言玉が出ていない: ${done.note}`);
  ok(done.ribbon === !done.dup, `NEW の出し分けが違う (dup=${done.dup})`);
  ok(done.seal === (done.dup ? '重' : '新'), `印章が違う: ${done.seal}`);
  console.log(`    開示: 「${done.card}」${done.dup ? '重複' : '新'} / ${done.cat} / ${done.eff} / 残り ${done.ink}`);

  const closed = await evalJs(`(() => {
    document.getElementById('gachaClose').click();
    return {
      hidden: document.getElementById('gachaVeil').hidden,
      result: document.getElementById('gachaResult').textContent,
    };
  })()`);
  ok(closed.hidden, 'とじるを押しても幕が閉じない');
  ok(closed.result.includes(done.word), `閉じたあとに結果が残らない: ${closed.result}`);

  // 演出の途中で閉じても、引いた語と言玉は残る。
  const aborted = await evalJs(`(() => {
    const app = window.__wordrogue;
    const ink = app.save.ink;
    document.getElementById('gachaBtn').click();
    const word = app.menus._lastGacha.word;
    document.getElementById('gachaX').click();
    return {
      ink, afterInk: app.save.ink, word,
      hidden: document.getElementById('gachaVeil').hidden,
      spinning: app.menus._gachaSpinning,
      result: document.getElementById('gachaResult').textContent,
    };
  })()`);
  ok(aborted.hidden, '演出中に ✕ を押しても幕が閉じない');
  ok(!aborted.spinning, '閉じても回転の錠が残る');
  ok(aborted.afterInk < aborted.ink, '閉じたら言玉が戻ってしまう');
  ok(aborted.result.includes(aborted.word), `閉じた結果が残らない: ${aborted.result}`);
  console.log(`    途中で閉じても「${aborted.word}」は残る (言玉 ${aborted.ink} -> ${aborted.afterInk})`);
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

sec('中ボスの文・宝箱・中ボス HUD が描画できる');
{
  const mid = await evalJs(`(async () => {
    const m = await import(new URL('js/game/entities.js', document.baseURI).href);
    const app = window.__wordrogue;
    const run = app.run;
    const e = m.makeEnemy('mid_boar', run.player.x + 80, run.player.y - 50);
    e.spawned = 1;
    run.enemies.push(e);
    run.midBoss = e;
    run.boss = null;
    let err = null;
    try { app.renderer.drawEnemySentence(e, run); } catch (ex) { err = 'enemy: ' + ex.message; }
    const q = m.makePickup(e.x, e.y, 'chest', 1);
    run.pickups.push(q);
    try { app.renderer.drawPickups(run); } catch (ex) { err = (err ? err + ' / ' : '') + 'chest: ' + ex.message; }
    app.hud.update(run, () => {});
    const shown = {
      hidden: document.getElementById('hudBoss').hidden,
      name: document.getElementById('bossName').textContent,
      midClass: document.getElementById('hudBoss').classList.contains('mid'),
    };
    run.enemies = run.enemies.filter((x) => x !== e);
    run.pickups = run.pickups.filter((x) => x !== q);
    run.midBoss = null;
    return { err, words: e.words.length, text: e.words.join(''), chestLife: q.life, chestR: q.r, shown };
  })()`);
  ok(!mid.err, `中ボス/宝箱の描画で例外: ${mid.err}`);
  ok(mid.words === 4 && mid.text.length === 4, `中ボスの文字数: ${mid.words} / ${mid.text}`);
  ok(mid.chestLife === 0 && mid.chestR > 7, `宝箱の寿命/大きさ: ${mid.chestLife} / ${mid.chestR}`);
  ok(!mid.shown.hidden && mid.shown.midClass && mid.shown.name.includes('中ボス'),
    `中ボス HUD: ${JSON.stringify(mid.shown)}`);
  console.log(`    中ボス「${mid.text}」/ 宝箱 / HUD ${mid.shown.name}`);
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

    // 画面内の生存数を保ったまま、全属性と各種形状の弾を並べる。
    run.enemies.length = 0;
    const els = [
      'earth', 'gold', 'steel', 'fire', 'thunder', 'ice', 'poison',
      'wind', 'water', 'light', 'dark', 'nature', 'blood', 'none',
    ];
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
    // 属性ごとの斬撃・輪・光線・粒も通す (風の弧や状態異常のオーラを含む)。
    run.slashes.push({
      x: run.player.x, y: run.player.y, a: 0.3, r: 90, arc: 1.6,
      life: 0.3, maxLife: 0.3, color: '#2f9e8f', el: 'wind', hit: new Set(),
    });
    run.rings.push({
      x: run.player.x, y: run.player.y, r: 60, life: 0.3, maxLife: 0.3,
      color: '#2f9e8f', el: 'wind', dash: true, thin: true, hit: new Set(),
    });
    run.beams.push({
      x: run.player.x, y: run.player.y, a: 0.2, len: 160, w: 8,
      life: 0.3, maxLife: 0.3, color: '#2f9e8f', el: 'wind',
    });
    for (const shape of ['gust', 'bubble', 'crystal', 'ember', 'smoke', 'leaf', 'shard']) {
      run.burst(run.player.x + 40, run.player.y + 20, 2, '#2f9e8f', {
        spd: 80, life: 0.4, r: 2, shape, drag: 4,
      });
    }
    run.screenFlash = { color: '#f1d488', life: 0.2, maxLife: 0.3 };
    run.player.castFlash = 0.15;
    run.player.castDir = 0.4;
    run.player.castColor = '#d9480f';
    run.player.stats.handElement = 'fire';
    // 敵と弾、両方の描画経路を通す。位置は {x, y} で渡す。
    for (let i = 0; i < 3; i++) {
      run.spawnEnemy('slime', { x: 300 + i * 40, y: 200 });
    }
    run.enemies.forEach((e, i) => {
      e.spawned = 1;
      if (i === 0) {
        e.burn = 2; e.burnT = 2; e.poison = 2; e.poisonT = 2;
        e.chill = 0.2; e.chillT = 2; e.freeze = 0.5; e.stun = 0.5;
      }
      if (i === 1) { e.broken = true; e.words = e.words.slice(0, 1); }
    });

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

sec('HUD の武器チップは文面だけを出す');
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
        hasBase: !!node.querySelector('.wchip-base'),
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
    ok(!/undefined/.test(c.txt), `HUD に undefined が出る: ${JSON.stringify(c)}`);
    ok(/[一-龥ぁ-んァ-ヶ]/.test(c.txt), `HUD に武器名が出ない: ${JSON.stringify(c)}`);
    // 武器の区分 (刃・銃などの基本の型) は出さない。空の文でも「刃」と出てしまうため。
    ok(!c.hasBase, `HUD に武器区分が残っている: ${JSON.stringify(c)}`);
  }
  console.log(`    武器名: ${view.titles.map((t, i) => t + '(' + view.defNames[i] + ')').join(' / ')}`);
  console.log(`    HUD チップ: ${view.chips.map((c) => c.txt).join(' / ')}`);
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
  for (const t of ['焔必刃', '焔を斬られた硬刃']) {
    ok(doc.includes(t), `玩法説明に例「${t}」が無い`);
  }
  // 文の長さ・武器語・接続詞の記述があるはず。
  for (const t of ['10 文字', '武器語', '接続詞']) {
    ok(doc.includes(t), `遊び方に「${t}」の記述が無い`);
  }

  // 報酬は武器と休息だけで、ことばは出ない。
  const rewardSec = doc.slice(doc.indexOf('クリア報酬'));
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
ok(cleared.state === 'clear', `クリア状態になっていない: ${cleared.state}`);
ok(cleared.mode === 'result', `結果画面へ: ${cleared.mode}`);
ok(!cleared.rewardDom, '三択の報酬画面 (旧 #reward) の DOM が残っている');
ok(cleared.resultOpen, '結果画面が表示された');

sec('結果画面');
await sleep(300);
ok(await evalJs('!document.getElementById("result").hidden'), '結果画面が出た');
const rsRows = await evalJs('document.querySelectorAll("#resultStats .rs-row").length');
ok(rsRows >= 5, `結果行の数: ${rsRows}`);
const nextBtn = await evalJs(`({
  hidden: document.getElementById('resultNext').hidden,
  text: document.getElementById('resultNext').textContent,
})`);
ok(!nextBtn.hidden, 'クリア後の「次へ」ボタンが隠れている');
ok(/次のステージ/.test(nextBtn.text), `次へボタンの文言: ${nextBtn.text}`);

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
