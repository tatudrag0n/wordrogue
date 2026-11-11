// ============================================================================
// ワードローグ — 戦闘
//
// 武器ごとに「どう撃つか」をここへ集約する。
// resolve() が active=false を返した武器は、ここには届かない。
// ============================================================================

import { TAU, clamp, dist2, rng } from '../core/util.js';
import { makeBullet, makeField, ensureHitSet, hitsEnemy, cutEnemyWords } from './entities.js';
import { ELEMENTS } from '../data/words.js?v=1.53';
import { startWeaponMotion, syncMotionShape } from './motions.js?v=1.53';

/** 秒間あたりの攻撃回数からクールダウンを計算。 */
const cdOf = (rate) => 1 / Math.max(0.05, rate);

/**
 * 武器の攻撃が届く形 (半径と扇の角度)。モーションはこの値だけを見て描くので、
 * 見た目と当たり判定は必ず一致する。
 *   斬撃 … 扇 (st.arc) を半径 st.range × 大きさ
 *   薙ぎ … 全方位を半径 st.range + 範囲
 * @param {object} st 武器ステータス
 * @param {object} [stats] プレイヤー能力 (大きさを持つ)
 * @returns {{reach:number, arc:number}}
 */
export function attackShape(st, stats = {}) {
  const size = (stats && stats.size) || 1;
  if (st.kind === 'whip') {
    return { reach: (st.range + (st.area || 0)) * size, arc: 0 };
  }
  return {
    reach: (st.range || 100) * size * (st.size || 1),
    arc: st.arc || 0,
  };
}

/**
 * 属性ごとの当たりの粒。形そのものが属性の意味になる。
 *   wind → 風の弧、fire → 火の粉、ice → 氷片、thunder → 稲妻…
 */
const ELEM_FX = {
  fire:    { shape: 'ember',   n: 7, spd: 190, life: 0.38, r: 1.7, grav: -20 },
  ice:     { shape: 'crystal', n: 6, spd: 210, life: 0.36, r: 2.1 },
  thunder: { shape: 'spark',   n: 9, spd: 300, life: 0.22, r: 1.6 },
  poison:  { shape: 'bubble',  n: 6, spd: 95,  life: 0.6,  r: 2.4, grav: -34 },
  light:   { shape: 'spark',   n: 7, spd: 250, life: 0.3,  r: 1.5 },
  dark:    { shape: 'smoke',   n: 5, spd: 80,  life: 0.55, r: 3.0 },
  wind:    { shape: 'gust',    n: 5, spd: 260, life: 0.34, r: 2.4 },
  water:   { shape: 'dot',     n: 6, spd: 170, life: 0.38, r: 2.0 },
  nature:  { shape: 'leaf',    n: 5, spd: 140, life: 0.5,  r: 2.2 },
  steel:   { shape: 'shard',   n: 6, spd: 230, life: 0.3,  r: 2.0 },
  blood:   { shape: 'ink',     n: 5, spd: 180, life: 0.4,  r: 2.5 },
  earth:   { shape: 'shard',   n: 6, spd: 170, life: 0.4,  r: 2.4 },
  gold:    { shape: 'spark',   n: 7, spd: 260, life: 0.32, r: 1.6 },
  none:    { shape: 'spark',   n: 5, spd: 180, life: 0.28, r: 1.8 },
};

/** 命中の粒を属性の形で散らす。会心は輪も足す。 */
function elementHitFx(run, e, el, crit) {
  if (!run || !run.burst) return;
  const fx = ELEM_FX[el] || ELEM_FX.none;
  const info = ELEMENTS[el] || ELEMENTS.none;
  run.burst(e.x, e.y, crit ? fx.n + 3 : fx.n, info.color, {
    spd: fx.spd, spdMin: fx.spd * 0.25, life: fx.life, r: fx.r,
    shape: fx.shape, drag: 4.2, grav: fx.grav || 0,
  });
  // 白い芯。紙の上でも「当たった」瞬間が読める。
  run.burst(e.x, e.y, crit ? 3 : 2, '#fffdf7', {
    spd: 110, spdMin: 30, life: 0.16, r: 1.3, shape: 'dot', drag: 7,
  });
  if (crit && run.rings) {
    run.rings.push({
      x: e.x, y: e.y, r: 24, life: 0.22, maxLife: 0.22,
      color: info.color, hit: new Set(), thin: true,
    });
  }
  // 風は「斬った風が抜ける」輪をひとつ。属性の意味を形にする。
  if (el === 'wind' && run.rings) {
    run.rings.push({
      x: e.x, y: e.y, r: e.r * 3.2, life: 0.24, maxLife: 0.24,
      color: info.color, hit: new Set(), dash: true,
    });
  }
}

/**
 * 武器を 1 回発動させる。
 * @param {object} run
 * @param {object} wi WeaponInst
 * @param {object} res resolve() の結果
 */
export function fireWeapon(run, wi, res) {
  const st = res.stats;
  if (res.heal) st.heal = true;
  // 結算画面の「武器ごとの与ダメージ」用。発射元の武器を st に刻む。
  st.wid = wi.def.id;
  st.wname = wi.def.name;
  const p = run.player;
  // 攻撃の種類は文中の武器語 (基本武器) が決めている (無ければ武器の既定)。
  const kind = res.kind || wi.def.kind;

  wi.flash = 1;
  wi.phase += 0.6;
  wi.attackCount = (wi.attackCount || 0) + 1;

  // 照準。敵がいれば最寄りを向く。angle を返す (敵オブジェクトではない)。
  const tgt = run.nearestEnemy(p.x, p.y);
  const aim = tgt ? Math.atan2(tgt.y - p.y, tgt.x - p.x) : p.face;
  const el = res.element || 'none';
  const elInfo = ELEMENTS[el] || ELEMENTS.none;

  // 撃つ瞬間の身体の動き。描画側がこれを見て、僅かに反って光る。
  p.castFlash = 0.18;
  p.castDir = aim;
  p.castColor = elInfo.color;
  p.castKind = kind;
  run.audio.cast?.(el, kind, wi.def.id);

  // 攻撃の見た目。weaponTick が予備動作を先に始めていれば、それを
  // 打撃の瞬間へ進める。直接 fireWeapon を呼ぶテストでは、その場で
  // 振り始める。どちらも当たり判定・威力・間隔は変えない。
  const interval = 1 / Math.max(0.05, st.rate || 1);
  // 見た目の扇と間合いを、これから当てる範囲に合わせる。
  const shape = attackShape(st, p.stats);
  if (!wi.motion || wi.motion.seq < (wi.motionSeq || 0)) {
    const m = startWeaponMotion(wi, res, aim, {
      interval, elapsed: 0, reach: shape.reach, arc: shape.arc,
    });
    // 予備動作を先に始めていない直接攻撃は、打撃の瞬間から見せる。
    m.elapsed = m.impactAt;
  } else {
    wi.aim = aim;
    wi.motion.aim = aim;
    wi.motion.baseAim = aim;
    syncMotionShape(wi.motion, shape.reach, shape.arc);
    wi.motion.elapsed = Math.max(wi.motion.elapsed, wi.motion.impactAt);
  }

  switch (kind) {
    case 'slash': doSlash(run, wi, st, aim, el, elInfo); break;
    case 'dual': doDual(run, wi, st, aim, el, elInfo); break;
    case 'shot':  doShot(run, wi, st, aim, false, el, elInfo); break;
    case 'pierce': doShot(run, wi, st, aim, false, el, elInfo); break;
    case 'bomb':  doBomb(run, wi, st, aim, el, elInfo); break;
    case 'chain': doChain(run, wi, st, aim, el); break;
    case 'boomerang': doShot(run, wi, st, aim, true, el, elInfo); break;
    case 'whip':  doWhip(run, wi, st, aim, el, elInfo); break;
    case 'aura':  doAura(run, wi, st, el); break;
    case 'beam':  doBeam(run, wi, st, aim, el, elInfo); break;
    case 'flame': doFlame(run, wi, st, aim, el, elInfo); break;
    case 'spray': doSpray(run, wi, st, aim, el, elInfo); break;
    case 'gust': doGust(run, wi, st, aim, el, elInfo); break;
    case 'bolt': doBolt(run, wi, st, aim, el, elInfo); break;
    case 'rain': doRain(run, wi, st, aim, el, elInfo); break;
    case 'shadow': doShadow(run, wi, st, aim, el, elInfo); break;
    case 'wave': doWave(run, wi, st, aim, el, elInfo); break;
    case 'meteor': doMeteor(run, wi, st, el, elInfo); break;
    default: break;
  }

  // 反動。プレイヤー自身が押し戻される。
  if (st.recoil) {
    p.vx -= Math.cos(aim) * st.recoil * 2.6;
    p.vy -= Math.sin(aim) * st.recoil * 2.6;
  }
}

// 炎を前方へ扇状に吹きつける。近距離の敵をまとめて焼く。
function doFlame(run, wi, st, aim, el, elInfo) {
  const p = run.player;
  const reach = st.range * 1.35 * st.size;
  const arc = Math.min(2.0, 1.15 + (st.area || 0) / 100);
  run.slashes.push({ x: p.x, y: p.y, a: aim, r: reach, arc, life: 0.38, maxLife: 0.38, color: elInfo.color, el, flame: true, hit: new Set() });
  run.burst(p.x + Math.cos(aim) * reach * 0.55, p.y + Math.sin(aim) * reach * 0.55, 20, elInfo.color, {
    a: aim, spread: arc, spd: 180, spdMin: 40, life: 0.5, r: 3, shape: 'ember', drag: 2, grav: -35,
  });
  for (const e of run.enemies) {
    if (e.dead || dist2(e.x, e.y, p.x, p.y) > (reach + e.r) ** 2) continue;
    let d = Math.atan2(e.y - p.y, e.x - p.x) - aim;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    if (Math.abs(d) <= arc / 2) run.damage(e, st, { crit: rollCrit(st), knock: st.knock, element: el, burn: st.burn });
  }
  run.audio.tone({ freq: 180, type: 'sawtooth', dur: 0.18, vol: 0.08, slide: 2.5 });
  run.shake(1.8);
}

// 隕石は敵の頭上から落とし、着弾で通常の爆発処理に入れる。
function doMeteor(run, wi, st, el, elInfo) {
  const p = run.player;
  const target = run.nearestEnemy(p.x, p.y);
  if (!target) return;
  const x = target.x + (run.rand() - 0.5) * 52;
  const y = target.y - 300;
  const b = makeBullet({ x, y, vx: (target.x - x) * 0.25, vy: 620, r: 12 * st.size, size: st.size,
    life: 1.1, pierce: 99, explode: Math.max(st.explode, 44 + (st.area || 0)), burn: st.burn,
    knock: st.knock || 90, element: el, color: elInfo.color, shape: 'bomb', kindName: 'bomb' });
  b.st = st; b.wi = wi; run.bullets.push(b);
  run.burst(x, y, 8, elInfo.color, { spd: 95, spdMin: 25, life: 0.35, r: 3, shape: 'ember', grav: 40 });
}

// 水鉄砲。細い水の筋をまっすぐ飛ばす。連射が効き、count で水流が増える。
function doSpray(run, wi, st, aim, el, elInfo) {
  const p = run.player;
  const n = Math.max(1, Math.round(st.count || 1));
  const speed = Math.max(500, st.speed || 300);
  for (let i = 0; i < n; i++) {
    const a = aim + (run.rand() - 0.5) * 0.14;
    const b = makeBullet({
      x: p.x + Math.cos(a) * 14, y: p.y + Math.sin(a) * 14,
      vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
      r: 4 * st.size, size: st.size, dmg: st.dmg * 0.6,
      life: 0.5, pierce: st.pierce, element: el, color: elInfo.color,
      kindName: 'shot',
    });
    b.st = st; b.wi = wi;
    run.bullets.push(b);
  }
  run.burst(p.x + Math.cos(aim) * 14, p.y + Math.sin(aim) * 14, 4, elInfo.color, {
    a: aim, spread: 0.3, spd: 200, life: 0.2, r: 2, shape: 'dot', drag: 6,
  });
  run.audio.shoot();
}

// 落雷。敵の頭上から稲妻を落とす。
function doBolt(run, wi, st, aim, el, elInfo) {
  const p = run.player;
  const n = Math.max(1, Math.round(st.count || 1));
  const near = run.enemies
    .filter((e) => !e.dead && dist2(e.x, e.y, p.x, p.y) < 420 * 420)
    .sort((a, b) => dist2(a.x, a.y, p.x, p.y) - dist2(b.x, b.y, p.x, p.y));
  for (let i = 0; i < n; i++) {
    const e = near[i % Math.max(1, near.length)] || null;
    const x = e ? e.x : p.x + Math.cos(aim) * 120;
    const y = e ? e.y : p.y + Math.sin(aim) * 120;
    run.lightnings.push({
      x1: x, y1: y - 320, x2: x, y2: y,
      life: 0.22, maxLife: 0.22,
      color: elInfo.color, el,
    });
    run.burst(x, y, 6, elInfo.color, {
      spd: 160, spdMin: 40, life: 0.24, r: 2, shape: 'spark', drag: 5,
    });
    for (const t of run.enemies) {
      if (t.dead || dist2(t.x, t.y, x, y) > (26 + t.r) ** 2) continue;
      run.damage(t, st, { crit: rollCrit(st), element: el });
    }
  }
  run.audio.tone({ freq: 1400, type: 'sawtooth', dur: 0.1, vol: 0.07, slide: 0.4 });
  run.shake(2);
}

// 突風。広い範囲を吹き抜け、敵を押し戻す。
function doGust(run, wi, st, aim, el, elInfo) {
  const p = run.player;
  const reach = st.range * 1.4 * st.size;
  const arc = Math.min(2.4, 1.3 + (st.area || 0) / 90);
  run.slashes.push({
    x: p.x, y: p.y, a: aim, r: reach, arc,
    life: 0.3, maxLife: 0.3,
    color: elInfo.color, el, hit: new Set(),
  });
  run.burst(p.x + Math.cos(aim) * reach * 0.5, p.y + Math.sin(aim) * reach * 0.5, 8, elInfo.color, {
    a: aim, spread: arc, spd: 240, life: 0.34, r: 2.6, shape: 'gust', drag: 4,
  });
  for (const e of run.enemies) {
    if (e.dead) continue;
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d > reach + e.r) continue;
    const diff = Math.atan2(Math.sin(Math.atan2(e.y - p.y, e.x - p.x) - aim), Math.cos(Math.atan2(e.y - p.y, e.x - p.x) - aim));
    if (Math.abs(diff) > arc / 2) continue;
    const push = 90 + (st.knock || 0);
    e.vx += Math.cos(aim) * push * 2.2;
    e.vy += Math.sin(aim) * push * 2.2;
    run.damage(e, st, { crit: rollCrit(st), knock: st.knock, element: el });
  }
  run.audio.tone({ freq: 520, type: 'noise', dur: 0.22, vol: 0.06, slide: -0.6 });
  run.shake(1.2);
}

// 雨。前方の帯に小さな水滴を降らせる。
function doRain(run, wi, st, aim, el, elInfo) {
  const p = run.player;
  const n = Math.max(6, Math.round(6 + (st.count || 1) * 2));
  const dist = st.range * 1.2;
  for (let i = 0; i < n; i++) {
    const off = (run.rand() - 0.5) * dist * 1.6;
    const x = p.x + Math.cos(aim) * dist + Math.cos(aim + Math.PI / 2) * off;
    const y = p.y + Math.sin(aim) * dist + Math.sin(aim + Math.PI / 2) * off - 240;
    const b = makeBullet({
      x, y, vx: 0, vy: 420,
      r: 3 * st.size, size: st.size, dmg: st.dmg * 0.45,
      life: 1.2, pierce: 0, element: el, color: elInfo.color,
      kindName: 'shot',
    });
    b.st = st; b.wi = wi;
    run.bullets.push(b);
  }
  run.audio.tone({ freq: 720, type: 'sine', dur: 0.2, vol: 0.05, slide: -0.8 });
}

// 暗黒球。ゆっくり敵を追う闇の玉。
function doShadow(run, wi, st, aim, el, elInfo) {
  const p = run.player;
  const n = Math.max(1, Math.round(st.count || 1));
  for (let i = 0; i < n; i++) {
    const a = aim + (i - (n - 1) / 2) * 0.3;
    const b = makeBullet({
      x: p.x + Math.cos(a) * 16, y: p.y + Math.sin(a) * 16,
      vx: Math.cos(a) * 200, vy: Math.sin(a) * 200,
      r: 7 * st.size, size: st.size, dmg: st.dmg,
      life: 1.6, pierce: 99, homing: 0.5,
      element: el, color: elInfo.color, kindName: 'shot',
    });
    b.st = st; b.wi = wi;
    run.bullets.push(b);
  }
  run.audio.tone({ freq: 220, type: 'sine', dur: 0.18, vol: 0.06, slide: -0.5 });
}

// 波動。プレイヤーを中心に広がる環。触れた敵を巻き込む。
function doWave(run, wi, st, aim, el, elInfo) {
  const p = run.player;
  const reach = st.range * 1.5 * st.size;
  run.rings.push({
    x: p.x, y: p.y,
    spiral: true,
    turns: 1,
    baseAim: aim,
    reach,
    life: 0.45, maxLife: 0.45,
    color: elInfo.color, el,
    st: { ...st },
    hit: new Set(),
  });
  run.rings.push({
    x: p.x, y: p.y,
    r: 30, life: 0.3, maxLife: 0.3,
    color: elInfo.color, hit: new Set(), thin: true,
  });
  run.audio.tone({ freq: 300, type: 'sine', dur: 0.3, vol: 0.07, slide: 1.6 });
}
// ─────────────────────────────────────────────────────────────────────────────
// 近接
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 扇形 (arc が TAU なら円の全体) の内側の敵に 1 回ずつ当てる。
 * hit に入っていない敵だけ。doSlash / doDual で同じ判定を使うので、
 * 見た目と当たり判定がずれる場所が 1 つも生まれない。
 * @returns {number} 当たった数
 */
function hitSector(run, x, y, aim, reach, arc, st, el, hit) {
  let n = 0;
  const full = arc >= TAU - 1e-6;
  for (const e of run.enemies) {
    if (e.dead || (hit && hit.has(e.uid))) continue;
    const d2 = dist2(e.x, e.y, x, y);
    if (d2 > reach * reach) continue;
    if (!full) {
      const a = Math.atan2(e.y - y, e.x - x);
      let diff = (a - aim) % TAU;
      if (diff > Math.PI) diff -= TAU;
      if (diff < -Math.PI) diff += TAU;
      if (Math.abs(diff) > arc / 2) continue;
    }
    if (hit) hit.add(e.uid);
    run.damage(e, st, { crit: rollCrit(st), knock: st.knock, element: el });
    n++;
  }
  return n;
}

/** 攻撃 3 回ごとの特別な振り。def.pattern に入っている武器だけが持つ。 */
const SLASH_PATTERNS = { cross: 0.65, spin: 0.72 };

function doSlash(run, wi, st, aim, el, elInfo) {
  const p = run.player;
  // 当たる範囲と、描く扇は同じ値から作る。ここがずれると
  // 「見えていない敵に当たる」「見えている敵に当たらない」が起きる。
  const shape = attackShape(st, p.stats);
  let reach = shape.reach;
  let arc = shape.arc > 0.02 ? shape.arc : Math.PI * 2 / 3;
  // 常に同じ攻撃をしない。3 回に 1 回、十字 (前後) か旋回 (円の全体) になる。
  const patKey = wi.def.pattern && (wi.attackCount % 3 === 0) ? wi.def.pattern : null;
  const patMul = patKey ? SLASH_PATTERNS[patKey] : 1;
  const pst = patMul < 1 ? { ...st, dmg: st.dmg * patMul } : st;
  let aim2 = aim;
  let extra = null;
  if (patKey === 'cross') {
    extra = aim + Math.PI;
  } else if (patKey === 'spin') {
    arc = Math.PI * 2;
    reach *= 1.06;
  }
  // 旋回攻撃の輪。回った範囲を読ませる。
  if (patKey === 'spin') {
    run.rings.push({
      x: p.x, y: p.y, r: reach * 0.9, life: 0.28, maxLife: 0.28,
      color: elInfo.color, hit: new Set(), thin: true,
    });
  }
  // 刃の軌跡は、モーションの打撃〜振り抜けのあいだだけ描く。
  const motion = wi.motion || null;
  if (motion) syncMotionShape(motion, reach, arc);
  const life = motion
    ? Math.max(0.28, motion.duration - motion.windup + 0.08)
    : 0.32;
  const mk = (a, m, hitOwn) => {
    run.slashes.push({
      x: p.x, y: p.y, a,
      r: reach,
      arc,
      life, maxLife: life,
      color: elInfo.color,
      el,
      motion: m,
      hit: hitOwn ? new Set() : null,
    });
    return run.slashes.at(-1);
  };
  // 数増やす系の語 (count) で斬撃が扇状に増える。幅は arc を基準に少し広げるだけ。
  const n = Math.max(1, Math.min(6, Math.round(st.count || 1)));
  const fan = n === 1 ? 0 : Math.min(arc * 0.6, 0.22 * (n - 1));
  const slashes = [];
  for (let i = 0; i < n; i++) {
    slashes.push(mk(aim2 + (n === 1 ? 0 : (i / (n - 1) - 0.5) * fan), motion, true));
  }
  run.audio.slash();
  // 刃の先で属性が弾ける。風なら風の弧、炎なら火の粉。
  const fx = ELEM_FX[el] || ELEM_FX.none;
  run.burst(p.x + Math.cos(aim2) * reach * 0.72, p.y + Math.sin(aim2) * reach * 0.72, 6, elInfo.color, {
    a: aim2, spread: Math.min(Math.PI, arc) * 0.9, spd: fx.spd * 1.4, spdMin: fx.spd * 0.4,
    life: fx.life, r: fx.r, shape: fx.shape, drag: 5,
  });
  for (const s of slashes) hitSector(run, p.x, p.y, s.a, reach, arc, pst, el, s.hit);
  if (extra != null) {
    // 反対側。同じ軌道の鏡写し。モーションは角度だけ裏返す。
    const back = motion ? { ...motion, baseAim: extra } : null;
    const sb = mk(extra, back, true);
    run.burst(p.x + Math.cos(extra) * reach * 0.72, p.y + Math.sin(extra) * reach * 0.72, 5, elInfo.color, {
      a: extra, spread: Math.min(Math.PI, arc) * 0.9, spd: fx.spd * 1.4, spdMin: fx.spd * 0.4,
      life: fx.life, r: fx.r, shape: fx.shape, drag: 5,
    });
    hitSector(run, p.x, p.y, extra, reach, arc, pst, el, sb.hit);
  }
}

// ── 鞭。渦を描きながら手元から外へ伸びていき、通ったところをなぎ払う。 ─────
// 当たりは run.spiralTick が渦の先端の位置で刻む (見えた渦がそのまま当たる)。
function doWhip(run, wi, st, aim, el, elInfo) {
  const p = run.player;
  const reach = attackShape(st, p.stats).reach;
  // 渦が手元から外周まで走る時間。間合いが長いほどゆっくり。
  const life = clamp(0.5 + (st.range || 100) / 420, 0.5, 0.95);
  // 数増やす系の語 (count) で薙ぎの渦が増える。向きは扇状にずらす。
  const n = Math.max(1, Math.min(4, Math.round(st.count || 1)));
  const fan = n === 1 ? 0 : Math.min(1.4, 0.5 * (n - 1));
  for (let i = 0; i < n; i++) {
    run.rings.push({
      x: p.x, y: p.y,
      spiral: true,
      turns: 2.2,
      baseAim: aim + (n === 1 ? 0 : (i / (n - 1) - 0.5) * fan),
      reach,
      life, maxLife: life,
      color: elInfo.color, el,
      st: { ...st },
      hit: new Set(),
    });
  }
  run.audio.slash();
  // 渦の口火。手元がふくらんでから、鞭が伸びていく。
  run.rings.push({
    x: p.x, y: p.y, r: 18, life: 0.2, maxLife: 0.2,
    color: elInfo.color, hit: new Set(), thin: true,
  });
  run.shake(1.2);
  const fx = ELEM_FX[el] || ELEM_FX.none;
  run.burst(p.x + Math.cos(aim) * reach * 0.2, p.y + Math.sin(aim) * reach * 0.2, 5, elInfo.color, {
    a: aim, spread: 1.2, spd: fx.spd, spdMin: 60, life: fx.life, r: fx.r, shape: fx.shape, drag: 5,
  });
}

// ── 双剣。左右交互の二刀斬り。2 回斬ったあとの 3 回目は体ごと回る全面斬り。 ──
function doDual(run, wi, st, aim, el, elInfo) {
  const p = run.player;
  const shape = attackShape(st, p.stats);
  const n = wi.attackCount || 0;
  const spin = n % 3 === 0;
  const motion = wi.motion || null;
  const fx = ELEM_FX[el] || ELEM_FX.none;
  if (spin) {
    // 全面斬り。その場で体ごと回り、周囲ぜんぶを薙ぐ。1 回の力は少し落ちる。
    const st2 = { ...st, dmg: st.dmg * 0.72, knock: st.knock };
    const reach = shape.reach * 1.08;
    const arc = Math.PI * 2;
    if (motion) syncMotionShape(motion, reach, arc);
    const life = motion ? Math.max(0.34, motion.duration - motion.windup + 0.12) : 0.36;
    run.slashes.push({
      x: p.x, y: p.y, a: aim, r: reach, arc,
      life, maxLife: life,
      color: elInfo.color, el, motion,
      hit: new Set(),
      spin: true,
    });
    run.audio.slash();
    run.audio.tone?.({ freq: 320, type: 'sawtooth', dur: 0.16, vol: 0.05, slide: 1.8 });
    run.shake(2.4);
    // 全面斬りの輪。回った範囲がそのまま広がっていく。
    run.rings.push({
      x: p.x, y: p.y, r: reach * 0.92, life: 0.3, maxLife: 0.3,
      color: elInfo.color, hit: new Set(), thin: true,
    });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU;
      run.burst(p.x + Math.cos(a) * reach * 0.88, p.y + Math.sin(a) * reach * 0.88, 1, elInfo.color, {
        a, spread: 0.4, spd: fx.spd * 1.2, spdMin: 60, life: fx.life, r: fx.r, shape: fx.shape, drag: 5,
      });
    }
    hitSector(run, p.x, p.y, aim, reach, arc, st2, el, run.slashes.at(-1).hit);
    return;
  }
  // 通常の 2 回は、左右交互の二刀斬り。振る側を攻撃ごとに変える。
  const side = n % 2 === 1 ? 1 : -1;
  const a0 = aim + side * 0.46;
  const arc = Math.max(0.9, shape.arc * 0.72);
  const reach = shape.reach;
  if (motion) syncMotionShape(motion, reach, arc);
  const life = motion ? Math.max(0.24, motion.duration - motion.windup + 0.06) : 0.28;
  run.slashes.push({
    x: p.x, y: p.y, a: a0, r: reach, arc,
    life, maxLife: life,
    color: elInfo.color, el, motion,
    hit: new Set(),
  });
  run.audio.slash();
  run.burst(p.x + Math.cos(a0) * reach * 0.72, p.y + Math.sin(a0) * reach * 0.72, 5, elInfo.color, {
    a: a0, spread: arc * 0.9, spd: fx.spd * 1.4, spdMin: fx.spd * 0.4,
    life: fx.life, r: fx.r, shape: fx.shape, drag: 5,
  });
  hitSector(run, p.x, p.y, a0, reach, arc, st, el, run.slashes.at(-1).hit);
}

// ─────────────────────────────────────────────────────────────────────────────
// 射撃
// ─────────────────────────────────────────────────────────────────────────────
function doShot(run, wi, st, aim, boomerang, el, elInfo) {
  const p = run.player;
  const n = Math.max(1, Math.round(st.count));
  const spread = st.spread || 0;
  const speed = Math.max(500, st.speed || 300);

  for (let i = 0; i < n; i++) {
    const off = n === 1 ? 0 : (i / (n - 1) - 0.5) * spread;
    const a = aim + off;
    const b = makeBullet({
      x: p.x + Math.cos(a) * 14,
      y: p.y + Math.sin(a) * 14,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      r: 5 * st.size,
      size: st.size,
      life: boomerang ? 4 : 2.2,
      pierce: st.pierce,
      explode: st.explode,
      burn: st.burn, poison: st.poison, chill: st.chill, shock: st.shock, freeze: st.freeze,
      knock: st.knock,
      split: st.split, splitDmg: st.dmg,
      bounce: st.bounce, bounceLeft: st.bounce,
      homing: st.homing,
      boomerang,
      range: boomerang ? 260 : 0,
      element: el,
      shape: boomerang ? 'blade' : (st.shape || 'shot'),
      color: elInfo.color,
      kindName: boomerang ? 'boomerang' : 'shot',
    });
    b.ret = false;
    b.st = st;
    b.wi = wi;
    run.bullets.push(b);
  }
  // 口火。銃口から広がる細い輪と、進行方向へ走る火花。
  const mx = p.x + Math.cos(aim) * 12, my = p.y + Math.sin(aim) * 12;
  run.rings.push({
    x: mx, y: my, r: 13 * st.size, life: 0.14, maxLife: 0.14,
    color: elInfo.color, hit: new Set(), thin: true,
  });
  run.burst(mx, my, 5, elInfo.color, {
    a: aim, spread: 0.5, spd: 320, spdMin: 120, life: 0.14, r: 1.6, shape: 'spark', drag: 7,
  });
  run.audio.shoot();
  run.shake(1.4);
}

// ─────────────────────────────────────────────────────────────────────────────
// 爆弾
// ─────────────────────────────────────────────────────────────────────────────
function doBomb(run, wi, st, aim, el, elInfo) {
  const p = run.player;
  const speed = Math.max(500, st.speed || 200);
  // 数増やす系の語 (count) で爆弾が扇状に増える。
  const n = Math.max(1, Math.min(6, Math.round(st.count || 1)));
  const fan = n === 1 ? 0 : Math.min(0.9, 0.24 * (n - 1));
  for (let i = 0; i < n; i++) {
    const a = aim + (n === 1 ? 0 : (i / (n - 1) - 0.5) * fan);
    const b = makeBullet({
      x: p.x, y: p.y,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      r: 8 * st.size,
      size: st.size,
      life: 1.5,
      pierce: 99,
      explode: st.explode,
      burn: st.burn, poison: st.poison, chill: st.chill,
      knock: st.knock,
      element: el,
      color: elInfo.color,
      kindName: 'bomb',
    });
    b.st = st; b.wi = wi;
    run.bullets.push(b);
  }
  // 投げの口火。手元がほんのり明くなって、弾が飛んでいく。
  run.rings.push({
    x: p.x + Math.cos(aim) * 10, y: p.y + Math.sin(aim) * 10,
    r: 10 * st.size, life: 0.16, maxLife: 0.16,
    color: elInfo.color, hit: new Set(), thin: true,
  });
  run.burst(p.x + Math.cos(aim) * 12, p.y + Math.sin(aim) * 12, 4, elInfo.color, {
    a: aim, spread: 0.7, spd: 240, spdMin: 80, life: 0.16, r: 1.6, shape: 'ember', drag: 6,
  });
  run.audio.tone({ freq: 200, type: 'square', dur: 0.1, vol: 0.05, slide: 0.6 });
}

// ─────────────────────────────────────────────────────────────────────────────
// 連鎖 (稲光)
// ─────────────────────────────────────────────────────────────────────────────
function doChain(run, wi, st, aim, el) {
  // 数増やす系の語で連鎖の本数を増やす。
  const c = Math.max(1, Math.min(3, Math.round(st.count || 1)));
  for (let k = 0; k < c; k++) chainOnce(run, st, el);
  run.audio.tone({ freq: 1600, type: 'sawtooth', dur: 0.09, vol: 0.07, slide: 0.35 });
  run.shake(2);
}

function chainOnce(run, st, el) {
  const n = Math.max(1, Math.round(st.chain));
  const hit = [];
  let ex = run.player.x, ey = run.player.y;

  for (let i = 0; i < n; i++) {
    const tgt = run.nearestEnemy(ex, ey, hit, 340);
    if (!tgt) break;
    hit.push(tgt.uid);
    run.lightnings.push({
      x1: ex, y1: ey, x2: tgt.x, y2: tgt.y,
      life: 0.24, maxLife: 0.24,
      color: (ELEMENTS[el] || {}).color || '#1b6ca8',
      el,
    });
    run.damage(tgt, st, {
      crit: rollCrit(st),
      knock: st.knock,
      element: el,
      shock: st.shock,
    });
    ex = tgt.x; ey = tgt.y;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 光線
// ─────────────────────────────────────────────────────────────────────────────
function doBeam(run, wi, st, aim, el, elInfo) {
  const p = run.player;
  const len = st.range;
  const wdt = 10 * st.size;
  // 数増やす系の語 (count) で光線が並んで増える。
  const n = Math.max(1, Math.min(5, Math.round(st.count || 1)));
  const gap = 16 * st.size;
  const beams = [];
  for (let i = 0; i < n; i++) {
    const off = n === 1 ? 0 : (i / (n - 1) - 0.5) * (n - 1) * gap;
    const ox = p.x + Math.cos(aim + Math.PI / 2) * off;
    const oy = p.y + Math.sin(aim + Math.PI / 2) * off;
    run.beams.push({
      x: ox, y: oy, a: aim, len, w: wdt,
      life: 0.3, maxLife: 0.3,
      color: elInfo?.color || '#e8a30a',
      el,
    });
    beams.push({ ox, oy });
  }
  const hit = new Set();

  const dx = Math.cos(aim), dy = Math.sin(aim);
  // 口火。光の出るところが白くはじける。
  run.rings.push({
    x: p.x + dx * 14, y: p.y + dy * 14, r: 16 * st.size, life: 0.18, maxLife: 0.18,
    color: elInfo?.color || '#e8a30a', hit: new Set(), thin: true,
  });
  run.burst(p.x + dx * 14, p.y + dy * 14, 6, elInfo?.color || '#e8a30a', {
    a: aim, spread: 0.6, spd: 300, spdMin: 100, life: 0.16, r: 1.8, shape: 'spark', drag: 7,
  });
  for (const e of run.enemies) {
    if (e.dead || hit.has(e.uid)) continue;
    // 並んだ光線のいずれか 1 本でも拾えば当たり。
    for (const bm of beams) {
      const t = clamp((e.x - bm.ox) * dx + (e.y - bm.oy) * dy, 0, len);
      const cxp = bm.ox + dx * t, cyp = bm.oy + dy * t;
      if (dist2(e.x, e.y, cxp, cyp) > (e.r + wdt / 2) ** 2) continue;
      hit.add(e.uid);
      run.damage(e, st, { crit: rollCrit(st), knock: st.knock, element: el });
      break;
    }
  }
  run.audio.tone({ freq: 900, type: 'sine', dur: 0.14, vol: 0.08, slide: 2.2 });
  run.shake(3);
}

// ─────────────────────────────────────────────────────────────────────────────
// 棘壁 (プレイヤー中心のフィールド)
// ─────────────────────────────────────────────────────────────────────────────
function doAura(run, wi, st, el) {
  const p = run.player;
  const reach = st.range * (p.stats.size || 1) * st.size;
  run.fields.push(makeField(p.x, p.y, reach, st.dmg, {
    life: 0.5,
    element: el,
    burn: st.burn, poison: st.poison, chill: st.chill, shock: st.shock,
    freeze: st.freeze,
    attached: true,
  }));
  // 数増やす系の語でオーラを重ねる (半径を段階的に広げる)。
  const n = Math.max(1, Math.min(3, Math.round(st.count || 1)));
  for (let i = 1; i < n; i++) {
    run.fields.push(makeField(p.x, p.y, reach * (1 + i * 0.28), st.dmg, {
      life: 0.5,
      element: el,
      burn: st.burn, poison: st.poison, chill: st.chill, shock: st.shock,
      freeze: st.freeze,
      attached: true,
    }));
  }
  // 少し回復。
  if (st.regen) run.healPlayer(st.regen * 0.35 * n);
}

const rollCrit = (st) => rng() < (st.crit || 0);

/**
 * 武器の文で敵の文を斬る。
 *   斬る量は 成立 1 語、熟語 +1、述語 +1。確率は文の良し悪しで変わる。
 *   毎回斬るとボスでも数秒で崩れてしまうので、確率を賭ける。
 *   ボスは文が長いぶん斬りにくい (0.3 倍にする)。
 * 崩れた敵は止まる。ボスは攻撃パターンだけが落ちる。
 * @param {object} e 敵
 * @param {object} st 武器ステータス
 * @param {object} run
 */
function cutByWeapon(e, st, run) {
  if (!e.words || e.broken || e.boss || e.midBoss) return;
  const power = st.cutPower || 0;
  if (power <= 0) return;
  const chance = st.cutChance || 0;
  if (chance <= 0 || rng() >= chance) return;

  const r = cutEnemyWords(e, power);
  if (r.cut > 0) {
    e.cutFlash = 1;
    run.dmgTexts.push({
      x: e.x, y: e.y - e.r - 12, v: 0, crit: false,
      life: 0.7, maxLife: 0.7, vy: -30, text: `−${r.text}`,
      color: '#c1432b',
    });
    // 斬った語が飛ぶ。火花を少しだけ散らす。
    run.burst?.(e.x, e.y, 5, '#c1432b', {
      spd: 170, spdMin: 40, life: 0.34, r: 1.6, shape: 'spark', drag: 5,
    });
  }
  if (r.broken) {
    // 崩れた。止める。
    // ただしボスは倒れない。接触ダメージは残して、攻撃パターンだけ落とす。
    e.atkCd = 99;
    e.charging = 0;
    if (!e.boss) {
      e.dmg = 0;
      e.speed = e.def.speed * 0.4;
    }
    run.brokenCount = (run.brokenCount || 0) + 1;
  }
}

/**
 * 敵にダメージを与える。文の効果がすべてここで効く。
 * @param {object} e 敵
 * @param {object} st 武器ステータス
 * @param {object} opt {crit, knock, element, shock, extra}
 */
export function damage(run, e, st, opt = {}) {
  if (!e || e.dead) return 0;
  if (st.heal) {
    const amt = Math.max(1, Math.round((st.dmg || 0) * 0.5));
    e.hp += amt;
    if (run && run.dmgTexts) {
      run.dmgTexts.push({
        x: e.x, y: e.y - e.r - 12, v: 0, crit: false,
        life: 0.7, maxLife: 0.7, vy: -30, text: '+' + amt,
        color: '#37b24d',
      });
    }
    return 0;
  }

  let dmg = st.dmg;
  const crit = opt.crit;
  if (crit) dmg *= (st.critDmg || 1.5);
  dmg = Math.max(1, Math.round(dmg));

  // 文が崩れた敵は脆い。斬る方が楽になる。
  // ボスは倒れない。止まるのは攻撃パターンだけ。
  if (e.broken) dmg = Math.max(1, Math.round(dmg * (e.boss ? 1.5 : 2.5)));

  e.hp -= dmg;
  e.flash = 1;

  // ヒットの火花。属性の形で散らす (風は弧、氷は粒、雷は稲妻)。
  const hitEl = opt.element || st.el || 'none';
  elementHitFx(run, e, hitEl, !!crit);
  run?.audio?.elemHit?.(hitEl);

  // 手の部位に属性語があると、接触する近接武器 (斬撃・薙ぎ) がその属性を纏う。
  // 武器側に属性が無いときだけ。手の属性は部位強化が由来。
  if (st.el === 'none' && run.player && run.player.stats && run.player.stats.handElement) {
    st.el = run.player.stats.handElement;
    if (run.player.stats.handStatus) {
      for (const [k, v] of Object.entries(run.player.stats.handStatus)) {
        st[k] = (st[k] || 0) + v;
      }
    }
  }

  // 敵の文を斬る。プレイヤーの文がよいほど多く斬れる。
  if (!opt.noCut) cutByWeapon(e, st, run);

  // 状態異常。
  const el = opt.element || 'none';
  const info = ELEMENTS[el];
  if (info?.status) {
    switch (info.status) {
      case 'burn':
        e.burn = Math.max(e.burn, (opt.burn ?? st.burn) || 2);
        e.burnT = Math.max(e.burnT, 3);
        break;
      case 'chill':
        e.chill = Math.max(e.chill, (opt.chill ?? st.chill) || 0.15);
        e.chillT = Math.max(e.chillT, 2.5);
        break;
      case 'poison':
        e.poison = Math.max(e.poison, (opt.poison ?? st.poison) || 2);
        e.poisonT = Math.max(e.poisonT, 4);
        break;
      case 'shock':
        if (rng() < ((opt.shock ?? st.shock) || 0)) e.stun = Math.max(e.stun, 0.5);
        break;
    }
  }
  if ((st.freeze || opt.freeze) && rng() < 0.35) e.freeze = Math.max(e.freeze, 0.8);

  // 吸血。
  const ls = st.lifesteal || 0;
  if (ls > 0) run.healPlayer(dmg * ls * 0.5);

  // 撃退。
  const kn = opt.knock ?? st.knock ?? 0;
  if (kn > 0) {
    const a = Math.atan2(e.y - run.player.y, e.x - run.player.x);
    e.x += Math.cos(a) * kn * 0.12;
    e.y += Math.sin(a) * kn * 0.12;
  }

  // ボスの装甲。貫通や光線が主力。
  if (e.def.armor && !st.pierce && !st.area) dmg *= 0.7;

  if (st.wid && run.weaponDmg) {
    const rec = run.weaponDmg.get(st.wid);
    if (rec) rec.dmg += dmg;
    else run.weaponDmg.set(st.wid, { name: st.wname || st.wid, dmg });
  }

  run.damageNumbers?.(e.x, e.y, dmg, crit);
  run.onDamaged?.(e, dmg);

  if (e.hp <= 0) run.killEnemy(e, st);
  return dmg;
}

export { cdOf, rollCrit };
