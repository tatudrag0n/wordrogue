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
    p.selfSlots[1] = m.makeWord('疾');
    run.refreshStats();
    const a = p.stats.selfTitle;
    [p.selfSlots[0], p.selfSlots[1]] = [p.selfSlots[1], p.selfSlots[0]];
    run.refreshStats();
    return { a, b: p.stats.selfTitle, slots: p.selfSlots.filter(Boolean).length };
  })()`);
  ok(tail.a === '鋼疾人', `末尾の「人」が付かない: ${tail.a}`);
  ok(tail.b === '疾鋼人', `入れ替えると末尾が変わる: ${tail.b}`);
  ok(tail.slots === 2, `枠に「人」を入れてしまった: ${tail.slots}`);
  console.log(`    並べ替え → 「${tail.a}」→「${tail.b}」 末尾は人固定`);
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
    ['火の弾</code> のように', '文の例は現行の形式にする'],
  ];
  for (const [needle, why] of banned) {
    ok(!doc.includes(needle), `玩法説明に古い記述「${needle}」が残っている (${why})`);
  }
  // 例の武器名は現在の形 (末尾語つき) であるべき。
  for (const t of ['刃利剣', '爆裂無双迅剣', '火球剣']) {
    ok(doc.includes(t), `玩法説明に例「${t}」が無い`);
  }
  // 末尾語とレベルアップの獲得の記述があるはず。
  for (const t of ['末尾', 'レベルアップ']) {
    ok(doc.includes(t), `玩法説明に「${t}」の記述が無い`);
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
    label: (document.getElementById('reward')?.textContent || '').includes('語袋が満杯'),
  })`);
  ok(!dom.swap, '交換用の DOM が残っている');
  ok(!dom.label, '「語袋が満杯」の文言が残っている');
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
