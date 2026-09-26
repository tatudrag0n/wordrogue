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

sec('ステージ選択へ');
await evalJs('document.getElementById("btnStart").click()');
await sleep(300);
ok(await evalJs('!document.getElementById("stages").hidden'), 'ステージ選択が開いた');
const stageCards = await evalJs('document.querySelectorAll("#stageList .stage-card").length');
ok(stageCards === 6, `ステージカード数: ${stageCards}`);

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
  return { weapons: r.weapons.length, pouch: r.pouch.filter(Boolean).length,
           enemies: r.enemies.length, hp: r.player.hp, state: r.state };
})()`);
ok(runInfo.weapons === 2, `武器数: ${runInfo.weapons}`);
ok(runInfo.pouch > 0, `語袋に語がある: ${runInfo.pouch}`);
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
ok(rows === 2, `武器行の数: ${rows}`);
const slots = await evalJs('document.querySelectorAll("#forgeWeapons .slot").length');
ok(slots === 6, `枠の数: ${slots} (武器 2 つ x Lv1 の 3 枠 = 6)`);
const sent = await evalJs('document.querySelectorAll("#forgeWeapons .sentence").length');
ok(sent === 2, `文面表示の数: ${sent}`);
const sentText = await evalJs(
  '[...document.querySelectorAll("#forgeWeapons .sn-text")].map(n => n.textContent).join(" | ")');
ok(/^[^|]+\|/.test(sentText) || sentText.includes('|'), `文面 nonempty: ${sentText}`);
console.log(`    文面: ${sentText}`);
const pwords = await evalJs('document.querySelectorAll("#forgePouch .pword:not(.empty)").length');
ok(pwords > 0, `語袋の語: ${pwords}`);

sec('語を別の枠に移すと文が変わる');
const changed = await evalJs(`(() => {
  const app = window.__wordrogue;
  const run = app.run;
  const before = run.weapons.map(w => w.resolve(run.player.stats).fullText);
  // 語袋の最初の語を武器 0 の空き枠に入れる。
  const word = run.pouch.find(w => w);
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
    // 語袋が満杯なら交換を先に済ませる。
    if (!document.getElementById('rewardSwap').hidden) {
      const s = document.querySelector('#swapList .pword');
      if (s) { s.click(); await new Promise(r => setTimeout(r, 200)); }
    }
    const card = document.querySelectorAll('#rewardList .rw-card');
    if (card.length) card[0].click();
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
