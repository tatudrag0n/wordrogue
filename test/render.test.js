// 描画の通しテスト。  node test/render.test.js
//
// Canvas は使わず、2D コンテキストを記録用の Proxy に差し替えて
// 実際の draw() を最後まで通す。ブラウザが無い環境でも
//  ・描画で例外が出ないこと
//  ・座標に NaN / Infinity が混ざらないこと
//  ・刃・刀・剣の軌跡 (wave / sweep / forward) がそれぞれ描かれること
// を確かめられる。Chrome が要る browser.test.js の手前の網。
import './seed.mjs';
import { Run } from '../js/game/run.js';
import { WeaponInst } from '../js/game/weapon.js';
import { makeWord } from '../js/data/words.js';
import { makeRng } from '../js/core/util.js';
import { Renderer } from '../js/ui/render.js';
import { motionPose } from '../js/game/motions.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const sec = (t) => console.log(`\n== ${t} ==`);

// ブラウザの代わり。resize() が window を見る。
globalThis.window = { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 };

const used = new Map();
let badArg = 0;
const grad = () => ({ addColorStop() {} });
const ctx = new Proxy({}, {
  get(target, key) {
    if (key in target) return target[key];
    if (typeof key === 'symbol') return undefined;
    const fn = (...args) => {
      used.set(key, (used.get(key) || 0) + 1);
      for (const v of args) {
        // 座標・半径に非有限が入ると、そのままでは画面が壊れる。
        if (typeof v === 'number' && !Number.isFinite(v)) {
          badArg++;
          throw new Error(`非有限の値: ${String(key)}(${args.join(', ')})`);
        }
      }
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return grad();
      if (key === 'measureText') return { width: 10 };
      if (key === 'getImageData') return { data: [] };
      return undefined;
    };
    target[key] = fn;
    return fn;
  },
  set(target, key, v) { target[key] = v; return true; },
});

const canvas = {
  clientWidth: 1280, clientHeight: 720, width: 0, height: 0,
  style: {}, getContext: () => ctx,
};

const audio = new Proxy({}, { get: () => () => {} });

/** 9 種の武器を持たせたラン。斬撃の style を全部通すのが目的。 */
function makeRun() {
  const run = new Run({
    stageId: 3, audio, save: { d: {} }, rng: makeRng(777), lexiconSize: 12,
    weaponIds: ['sword'],
  });
  run.weapons.length = 0;
  for (const id of ['sword', 'tachi', 'longsword', 'hammer', 'claw', 'fist', 'dragon', 'whip', 'gun']) {
    const wi = new WeaponInst(id, 2);
    if (wi.def.tail) wi.sentence.push(makeWord(wi.def.tail));
    run.weapons.push(wi);
  }
  for (let i = 0; i < 5; i++) {
    run.spawnEnemy('slime', { x: run.player.x + 54 + i * 18, y: run.player.y + (i % 3 - 1) * 26 });
  }
  run.enemies.forEach((e) => { e.spawned = 1; e.hp = 1e9; });
  return run;
}

sec('描画が最後まで通り、座標が壊れない');
{
  const renderer = new Renderer(canvas);
  // 軌跡の style ごとの関数が呼ばれたかを見る。
  const trails = new Set();
  for (const name of ['drawWaveTrail', 'drawSweepTrail', 'drawArcTrail', 'drawWhipMotion']) {
    const orig = Renderer.prototype[name];
    Renderer.prototype[name] = function patched(...args) {
      trails.add(name);
      return orig.apply(this, args);
    };
  }

  const run = makeRun();
  const input = { ax: 0, ay: 0, moving: false, angle: 0 };
  const phases = new Set();
  let frames = 0;
  for (let i = 0; i < 60 * 8; i++) {
    run.update(1 / 60, input);
    renderer.draw(run, null);
    frames++;
    for (const wi of run.weapons) {
      if (wi.motion) phases.add(motionPose(wi.motion).phase);
    }
  }

  ok(frames === 480, `描画できたフレームが足りない: ${frames}`);
  ok(renderer.drawErrorCount === 0, `描画の例外 ${renderer.drawErrorCount} 件 (${[...(renderer._drawErrors || new Map()).keys()].join(' ')})`);
  ok(badArg === 0, `非有限の座標 ${badArg} 件`);
  ok(trails.has('drawWaveTrail'), '刃の斬撃波が描かれていない');
  ok(trails.has('drawSweepTrail'), '刀の薙ぎが描かれていない');
  ok(trails.has('drawArcTrail'), '剣・槌・爪の軌跡が描かれていない');
  ok(phases.has('strike') && phases.has('follow') && phases.has('recover'),
    `モーションの局面が描かれていない: ${[...phases].join(' ')}`);
  console.log(`  ${frames} フレーム / 描画 ${[...used.values()].reduce((a, b) => a + b, 0)} 回 / 軌跡 ${[...trails].join(' ')}`);
}

sec('武器を持たない・敵がいない画面でも落ちない');
{
  const renderer = new Renderer(canvas);
  const run = new Run({
    stageId: 1, audio, save: { d: {} }, rng: makeRng(31), lexiconSize: 8,
    weaponIds: ['gun'],
  });
  for (let i = 0; i < 60; i++) {
    run.update(1 / 60, { ax: 0, ay: 0, moving: false, angle: 0 });
    renderer.draw(run, null);
  }
  ok(renderer.drawErrorCount === 0, `描画の例外 ${renderer.drawErrorCount} 件`);
  console.log('  60 フレーム / 例外なし');
}

sec('武器の絵は真上から見た形 (銃は銃身の軸で上下対称)');
{
  // 記録用の 2D コンテキスト。drawWeaponGlyph が描いた点だけを集める。
  const rec = () => {
    const calls = [];
    const g = new Proxy({}, {
      get(t, k) {
        if (k in t) return t[k];
        if (typeof k === 'symbol') return undefined;
        const fn = (...args) => { calls.push([k, args]); };
        t[k] = fn;
        return fn;
      },
      set(t, k, v) { t[k] = v; return true; },
    });
    return { g, calls };
  };
  // 銃身の軸 (y = 0) を挟んで上下が対称か。横から見た拳銃の絵は対称にならない。
  const symmetric = (calls) => {
    const pts = [];
    for (const [name, a] of calls) {
      if (name === 'moveTo' || name === 'lineTo') pts.push([a[0], a[1]]);
      else if (name === 'quadraticCurveTo') { pts.push([a[0], a[1]]); pts.push([a[2], a[3]]); }
      else if (name === 'arc' || name === 'ellipse') pts.push([a[0], a[1]]);
      else if (name === 'fillRect' || name === 'strokeRect') {
        pts.push([a[0], a[1]]); pts.push([a[0], a[1] + a[3]]);
      }
    }
    const off = pts.filter(([, y]) => Math.abs(y) > 1e-6);
    if (off.length < 8) return { ok: false, why: `描いた点が少なすぎる: ${off.length}`, off };
    const asym = off.filter(([, y]) => !off.some(([, y2]) => Math.abs(y2 + y) < 1e-6));
    return { ok: asym.length === 0, why: `軸で対称でない点: ${JSON.stringify(asym)}`, off };
  };

  const renderer = new Renderer(canvas);
  for (const [glyph, want] of [['銃', true], ['鋏', true], ['鋸', false]]) {
    const { g, calls } = rec();
    let threw = null;
    try { renderer.drawWeaponGlyph(g, glyph, 1, '#d4a94e', 1); } catch (e) { threw = e; }
    ok(!threw, `「${glyph}」の絵で例外: ${threw && threw.message}`);
    const sym = symmetric(calls);
    ok(sym.ok === want,
      `「${glyph}」の絵が真上から見た形になっていない (${sym.why})`);
  }
  console.log('  銃・鋏は銃身/軸を挟んで対称 / 鋸は歯が片側 (真上から見た形)');
}

console.log(`\n---- 合格 ${pass} / 不合格 ${fail} ----`);
process.exit(fail ? 1 : 0);
