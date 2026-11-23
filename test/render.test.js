// 描画の通しテスト。  node test/render.test.js
//
// Canvas は使わず、2D コンテキストを記録用の Proxy に差し替えて
// 実際の draw() を最後まで通す。ブラウザが無い環境でも
//  ・描画で例外が出ないこと
//  ・座標に NaN / Infinity が混ざらないこと
//  ・刃・刀・剣の三日月 (wave) が描かれること
// を確かめられる。Chrome が要る browser.test.js の手前の網。
import './seed.mjs';
import { Run } from '../js/game/run.js';
import { WeaponInst } from '../js/game/weapon.js';
import { makeWord, ELEMENTS, blendElementPalette, evaluate } from '../js/data/words.js';
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
  for (const name of ['drawWaveTrail', 'drawCrescent', 'drawArcTrail', 'drawWhipMotion']) {
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
  ok(trails.has('drawCrescent'), '三日月が描かれていない');
  ok(trails.has('drawArcTrail'), '槌・爪の軌跡が描かれていない');
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


sec('武器固有の描画 (鋸・鋏・射撃/詠唱/投擲モーション) が呼ばれる');
{
  const renderer = new Renderer(canvas);
  const called = new Set();
  for (const name of ['drawSawTrail', 'drawSnipTrail', 'drawMotionCasters', 'drawCrescent']) {
    const orig = Renderer.prototype[name];
    Renderer.prototype[name] = function patched(...args) { called.add(name); return orig.apply(this, args); };
  }
  const run = new Run({
    stageId: 3, audio, save: { d: {} }, rng: makeRng(4242), lexiconSize: 12,
    weaponIds: ['tachi'],
  });
  run.weapons.length = 0;
  // 弾 (throw)・光 (beam)・雷 (bolt) の手元モーションもここで通す。
  for (const id of ['tachi', 'saw', 'scissors', 'gun', 'staff', 'bomb', 'beam', 'thunder']) {
    const wi = new WeaponInst(id, 2);
    if (wi.def.tail) wi.sentence.push(makeWord(wi.def.tail));
    run.weapons.push(wi);
  }
  run.spawnEnemy('slime', { x: run.player.x + 60, y: run.player.y });
  run.enemies.forEach((e) => { e.spawned = 1; e.hp = 1e9; });
  for (let i = 0; i < 60 * 6; i++) {
    run.update(1 / 60, { ax: 0, ay: 0, moving: false, angle: 0 });
    renderer.draw(run, null);
  }
  ok(renderer.drawErrorCount === 0, `描画の例外 ${renderer.drawErrorCount} 件`);
  ok(called.has('drawCrescent'), '刀の三日月が描かれていない');
  ok(called.has('drawSawTrail'), '鋸の押し引きが描かれていない');
  ok(called.has('drawSnipTrail'), '鋏の二段挟みが描かれていない');
  ok(called.has('drawMotionCasters'), '射撃/詠唱モーションが描かれていない');
  console.log(`  固有描画: ${[...called].join(' ')}`);
}

sec('適応品質と静的レイヤー (1.66)');
{
  const renderer = new Renderer(canvas);
  ok(renderer.qualityLevel === 0, `初期段階 (デスクトップ) は 0: ${renderer.qualityLevel}`);
  // 20fps が続くと段階が 1 ずつ下がる。
  for (let round = 0; round < 3; round++) {
    for (let i = 0; i < 20; i++) renderer.noteFrame(1 / 20);
  }
  ok(renderer.qualityLevel === 3, `低 FPS で最軽量まで落ちる: ${renderer.qualityLevel}`);
  ok(renderer.decor === 'off', '最軽量では装飾 off');
  const pose = { ghosts: [{ rel: 0, alpha: 1 }, { rel: 1, alpha: 1 }, { rel: 2, alpha: 1 }] };
  ok(renderer.ghostList(pose).length === 0, 'off では残像を出さない');
  renderer.qualityLevel = 2;
  ok(renderer.ghostList(pose).length === 1, 'reduced では残像は 1 つに間引く');
  renderer.qualityLevel = 0;
  ok(renderer.ghostList(pose).length === 3, 'full では残像を全部出す');
  // 影スプライト: Canvas を作れない環境では null で、フォールバック描画も落ちない。
  ok(renderer.shadowSprite() === null, 'テスト環境では影スプライトは null (フォールバック)');
  let threw = null;
  try { renderer.drawSoftShadow(ctx, 10, 10, 20, 8, 0.5); } catch (e) { threw = e; }
  ok(!threw, `柔らかい影のフォールバックで例外: ${threw && threw.message}`);
  // 静的レイヤー: 作れない環境では _static.canvas が null で毎フレーム描画に落ちる。
  const run = makeRun();
  renderer.draw(run, null);
  ok(renderer._static && renderer._static.canvas === null, '静的レイヤーはフォールバック状態');
  ok(renderer.drawErrorCount === 0, `描画の例外 ${renderer.drawErrorCount} 件`);
  console.log(`  品質段階 0→3 / 装飾ゲート / 静的レイヤーのフォールバックを確認`);
}

sec('属性パレットと複合属性 (1.67)');
{
  const hex = /^#[0-9a-f]{6}$/i;
  // 全属性に 3 層 (core/mid/outer) があり、color は互換で残る。
  for (const [key, el] of Object.entries(ELEMENTS)) {
    ok(hex.test(el.core || '') && hex.test(el.mid || '') && hex.test(el.outer || ''),
      `${key} に 3 層パレットが無い`);
    ok(hex.test(el.color || ''), `${key} の color (互換) が無い`);
  }
  // 判別性: 似ていた色同士が別色になっている。
  ok(ELEMENTS.ice.mid !== ELEMENTS.water.mid, '氷と水の mid が同じ');
  const warm = [ELEMENTS.light.mid, ELEMENTS.gold.mid, ELEMENTS.thunder.mid];
  ok(new Set(warm).size === 3, '光・金・雷の mid が区別できない');
  ok(ELEMENTS.ice.mid !== ELEMENTS.water.mid && ELEMENTS.light.color !== ELEMENTS.gold.color,
    '判別しにくい色の組が残っている');

  // 複合: 火+光は「白金の芯を持つ炎」。芯は光の core、体は炎の mid、縁は光の mid。
  const blend = blendElementPalette('fire', 'light');
  ok(blend.core === ELEMENTS.light.core, `複合の芯が副属性になっていない: ${blend.core}`);
  ok(blend.mid === ELEMENTS.fire.mid, '複合の体が主属性になっていない');
  ok(blend.edge === ELEMENTS.light.mid && blend.sub === 'light', '複合の縁/副が記録されていない');
  const plain = blendElementPalette('fire', null);
  ok(plain.core === ELEMENTS.fire.core && plain.sub === null, '副なしは主パレットそのもの');

  // 文の評価が副属性を返す (描画専用)。
  const W = (s) => [...s].map((ch) => makeWord(ch));
  const e1 = evaluate(W('炎聖刃'));
  ok(e1.valid && e1.element === 'fire' && e1.subElement === 'light',
    `炎聖刃: ${e1.element}/${e1.subElement}`);
  const e2 = evaluate(W('炎刃'));
  ok(e2.valid && e2.element === 'fire' && e2.subElement === null, '単属性では副は null');

  // 武器の解決結果とモーションまで副属性が渡る。
  const run = makeRun();
  const wi = run.weapons[0];
  wi.sentence.entries.length = 0;
  wi.sentence.push(makeWord('炎'));
  wi.sentence.push(makeWord('聖'));
  const rep = run.weaponReport()[0];
  ok(rep.res.element === 'fire' && rep.res.subElement === 'light',
    `武器の副属性: ${rep.res.element}/${rep.res.subElement}`);
  run.spawnEnemy('slime', { x: run.player.x + 70, y: run.player.y });
  run.enemies.forEach((e) => { e.spawned = 1; e.hp = 1e9; });
  for (let i = 0; i < 90; i++) run.update(1 / 60, { ax: 0, ay: 0, moving: false, angle: 0 });
  ok(wi.lastMotion && wi.lastMotion.el === 'fire' && wi.lastMotion.elSub === 'light',
    `モーションの副属性: ${wi.lastMotion && wi.lastMotion.el}/${wi.lastMotion && wi.lastMotion.elSub}`);

  // レンダラ側: palFor はブレンドを返し、同じ組はキャッシュ (同一オブジェクト)。
  const renderer = new Renderer(canvas);
  const p1 = renderer.palFor('fire', 'light');
  ok(p1.core === '#ffffff' && p1.mid === ELEMENTS.fire.mid, 'palFor の複合が違う');
  ok(renderer.palFor('fire', 'light') === p1, 'palFor がキャッシュされていない');

  // 全属性の弾・斬撃・輪・フィールド・落雷・ビーム・粒を描いても例外が出ない。
  const els = Object.keys(ELEMENTS);
  for (const el of els) {
    run.bullets.push({
      uid: 7, x: 40, y: 40, vx: 120, vy: 30, r: 5, element: el, elSub: 'light',
      shape: 'shot', size: 1, pierce: 0, kindName: 'shot', color: ELEMENTS[el].color,
    });
    run.slashes.push({
      x: 60, y: 60, a: 0.4, r: 70, arc: 1.6, life: 0.2, maxLife: 0.3, el, elSub: 'gold',
      color: ELEMENTS[el].color, flame: el === 'fire',
    });
    run.rings.push({
      x: 80, y: 80, r: 40, life: 0.2, maxLife: 0.3, el, elSub: 'ice', color: ELEMENTS[el].color,
    });
    run.fields.push({
      x: 90, y: 90, r: 46, life: 2, maxLife: 4, el, elSub: 'fire', color: ELEMENTS[el].color,
    });
    run.beams.push({
      x: 20, y: 100, a: 0.3, len: 120, w: 6, life: 0.2, maxLife: 0.3, el, elSub: 'light',
      color: ELEMENTS[el].color,
    });
    run.particles.push({
      x: 50, y: 90, vx: 30, vy: -20, r: 3, life: 0.4, maxLife: 0.6,
      shape: ['ember', 'crystal', 'spark', 'bubble', 'smoke', 'leaf', 'ink', 'gust', 'dot'][els.indexOf(el) % 9],
      el, elSub: 'dark', color: ELEMENTS[el].color,
    });
  }
  run.lightnings.push({
    x1: 10, y1: 10, x2: 90, y2: 90, life: 0.2, maxLife: 0.3, el: 'thunder', elSub: 'light', color: '#f5b301',
  });
  // 状態異常オーラ (燃焼・毒・冷気・凍結・気絶) も通す。
  const foe = run.enemies[0];
  if (foe) { foe.burn = 1; foe.poison = 1; foe.chill = 1; foe.freeze = 1; foe.stun = 1; }
  renderer.qualityLevel = 0;
  renderer.draw(run, null);
  ok(renderer.drawErrorCount === 0, `全属性の描画で例外 ${renderer.drawErrorCount} 件 (${[...(renderer._drawErrors || new Map()).keys()].join(' ')})`);
  ok(badArg === 0, `非有限の座標 ${badArg} 件`);

  // 品質低下で属性の層と個数が間引かれる。
  ok(renderer.elLayers() === 3 && renderer.elCount(5) === 5, 'full では間引かない');
  renderer.qualityLevel = 3;
  ok(renderer.decor === 'off' && renderer.elLayers() === 1, 'off では 1 層になる');
  ok(renderer.elCount(5) < 5 && renderer.elCount(5) >= 1, 'off では個数が減る (最低 1)');
  renderer.draw(run, null);
  ok(renderer.drawErrorCount === 0, `低品質の描画で例外 ${renderer.drawErrorCount} 件`);
  renderer.qualityLevel = 0;
  console.log('  パレット完全性 / 複合 (火+光) / 全属性の描画 / 品質での間引きを確認');
}

sec('風の流線と複合 (1.72)');
{
  const renderer = new Renderer(canvas);

  // 流線の点列: seg+1 点、全て有限で、時刻が進むと形が変わる (流れが旅する)。
  const pts1 = renderer.windStreamPoints(0, 0, 0.3, 60, 1.7, 0);
  const pts2 = renderer.windStreamPoints(0, 0, 0.3, 60, 1.7, 0.35);
  ok(pts1.length === 8, `流線の点数: ${pts1.length}`);
  ok(pts1.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)), '流線に非有限の点がある');
  ok(pts1.some(([x, y], i) => Math.abs(x - pts2[i][0]) + Math.abs(y - pts2[i][1]) > 0.01),
    '流線が時刻で動いていない (流れが見えない)');
  const tip = pts1[pts1.length - 1];
  const tipD = Math.hypot(tip[0], tip[1]);
  ok(tipD > 50 && tipD < 66, `流線の長さが len と合わない: ${tipD}`);

  // 突風のうねり: 0.2..1 に収まり時刻で変動する。reducedMotion で振れ幅が弱まる。
  let gmin = 1, gmax = 0;
  for (let t = 0; t < 12; t += 0.1) {
    const gv = renderer.windGust(t, 0.7);
    gmin = Math.min(gmin, gv); gmax = Math.max(gmax, gv);
  }
  ok(gmin >= 0.2 && gmax <= 1 && gmax - gmin > 0.25, `突風の範囲: ${gmin}..${gmax}`);
  renderer._rmK = 0.35;
  let rmin = 1, rmax = 0;
  for (let t = 0; t < 12; t += 0.1) {
    const gv = renderer.windGust(t, 0.7);
    rmin = Math.min(rmin, gv); rmax = Math.max(rmax, gv);
  }
  ok(rmax - rmin < gmax - gmin, 'reducedMotion でうねりが弱まっていない');
  renderer._rmK = 1;

  // 品質で流線の描画量が間引かれる (記録 ctx の lineTo 回数で比べる)。
  const countFlow = () => {
    const before = used.get('lineTo') || 0;
    renderer.drawWindFlow(ctx, 100, 100, 0.4, 60, renderer.palFor('wind', 'light'), 1.3, 0.7, 0.9);
    return (used.get('lineTo') || 0) - before;
  };
  renderer.qualityLevel = 0;
  const full = countFlow();
  renderer.qualityLevel = 3;
  const off = countFlow();
  ok(full > off && off >= 1, `品質で流線が間引かれない: full=${full} off=${off}`);
  renderer.qualityLevel = 0;

  // 複合の情報: 風+光の文は主=風・副=光。パレットは芯=光・体=風になる。
  const W = (s) => [...s].map((ch) => makeWord(ch));
  const ev = evaluate(W('風聖刃'));
  ok(ev.valid && ev.element === 'wind' && ev.subElement === 'light',
    `風聖刃: ${ev.element}/${ev.subElement}`);
  const wpal = renderer.palFor('wind', 'light');
  ok(wpal.sub === 'light' && wpal.mid === ELEMENTS.wind.mid && wpal.core === ELEMENTS.light.core,
    '聖なる風のパレット (芯=光・体=風) が違う');

  // 実戦: 風+光の銃を撃つと、流れに乗る粒 (el=wind / elSub=light / curl) が出る。
  const run = new Run({
    stageId: 3, audio, save: { d: {} }, rng: makeRng(9182), lexiconSize: 12,
    weaponIds: ['gun'],
  });
  const wi = run.weapons[0];
  wi.sentence.entries.length = 0;
  wi.sentence.push(makeWord('風'));
  wi.sentence.push(makeWord('聖'));
  run.spawnEnemy('slime', { x: run.player.x + 90, y: run.player.y });
  run.enemies.forEach((e) => { e.spawned = 1; e.hp = 1e9; });
  const input = { ax: 0, ay: 0, moving: false, angle: 0 };
  let gustP = null;
  for (let i = 0; i < 120 && !gustP; i++) {
    run.update(1 / 60, input);
    gustP = run.particles.find((p) => p.shape === 'gust' && p.el === 'wind');
  }
  ok(!!gustP, '風の弾から流れの粒が出ていない');
  if (gustP) {
    ok(gustP.elSub === 'light', `粒の副属性: ${gustP.elSub}`);
    ok(!!gustP.curl, '粒が流れに乗っていない (curl が無い)');
  }
  // そのまま描いても例外が出ない (聖なる風の流線 + 十字のモート)。
  for (let i = 0; i < 30; i++) { run.update(1 / 60, input); renderer.draw(run, null); }
  ok(renderer.drawErrorCount === 0, `聖なる風の描画で例外 ${renderer.drawErrorCount} 件`);
  ok(badArg === 0, `非有限の座標 ${badArg} 件`);

  // 他属性は不変: 炎の単属性パレットは副を持たない。
  ok(renderer.palFor('fire', null).sub === null, '炎の単属性パレットが変わった');
  console.log('  流線の幾何 / 突風 / 品質の間引き / 聖なる風 (風+光) の粒と描画を確認');
}

console.log(`\n---- 合格 ${pass} / 不合格 ${fail} ----`);
process.exit(fail ? 1 : 0);
