// ============================================================================
// ワードローグ — 戦闘
//
// 武器ごとに「どう撃つか」をここへ集約する。
// resolve() が active=false を返した武器は、ここには届かない。
// ============================================================================

import { TAU, clamp, dist2, rng } from '../core/util.js';
import { makeBullet, makeField, ensureHitSet, hitsEnemy } from './entities.js';
import { ELEMENTS } from '../data/words.js';

/** 秒間あたりの攻撃回数からクールダウンを計算。 */
const cdOf = (rate) => 1 / Math.max(0.05, rate);

/**
 * 武器を 1 回発動させる。
 * @param {object} run
 * @param {object} wi WeaponInst
 * @param {object} res resolve() の結果
 */
export function fireWeapon(run, wi, res) {
  const st = res.stats;
  const p = run.player;
  const kind = wi.def.kind;

  wi.flash = 1;
  wi.phase += 0.6;

  // 照準。敵がいれば最寄りを向く。
  const aim = run.nearestEnemy(p.x, p.y) || p.face;
  const el = res.element || 'none';
  const elInfo = ELEMENTS[el] || ELEMENTS.none;

  switch (kind) {
    case 'slash': doSlash(run, wi, st, aim, el, elInfo); break;
    case 'shot':  doShot(run, wi, st, aim, false, el, elInfo); break;
    case 'pierce': doShot(run, wi, st, aim, false, el, elInfo); break;
    case 'bomb':  doBomb(run, wi, st, aim, el, elInfo); break;
    case 'chain': doChain(run, wi, st, aim, el); break;
    case 'boomerang': doShot(run, wi, st, aim, true, el, elInfo); break;
    case 'whip':  doWhip(run, wi, st, aim, el, elInfo); break;
    case 'aura':  doAura(run, wi, st, el); break;
    case 'beam':  doBeam(run, wi, st, aim, el, elInfo); break;
    default: break;
  }

  // 反動。プレイヤー自身が押し戻される。
  if (st.recoil) {
    p.vx -= Math.cos(aim) * st.recoil * 2.6;
    p.vy -= Math.sin(aim) * st.recoil * 2.6;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 近接
// ─────────────────────────────────────────────────────────────────────────────
function doSlash(run, wi, st, aim, el, elInfo) {
  const p = run.player;
  const reach = st.range * (p.stats.size || 1) * st.size;
  const arc = st.arc;
  run.slashes.push({
    x: p.x, y: p.y, a: aim,
    r: reach,
    arc,
    life: 0.18, maxLife: 0.18,
    color: elInfo.color,
    hit: new Set(),
  });
  run.audio.slash();

  // 扇形内の敵に 1 回だけ当てる。
  for (const e of run.enemies) {
    if (e.dead || run.slashes.at(-1).hit.has(e.uid)) continue;
    const d2 = dist2(e.x, e.y, p.x, p.y);
    if (d2 > reach * reach) continue;
    const a = Math.atan2(e.y - p.y, e.x - p.x);
    let diff = (a - aim) % TAU;
    if (diff > Math.PI) diff -= TAU;
    if (diff < -Math.PI) diff += TAU;
    if (Math.abs(diff) > arc / 2) continue;
    run.slashes.at(-1).hit.add(e.uid);
    run.damage(e, st, { crit: rollCrit(st), knock: st.knock, element: el });
  }
}

function doWhip(run, wi, st, aim, el, elInfo) {
  const p = run.player;
  const reach = (st.range + (st.area || 0)) * (p.stats.size || 1);
  run.rings.push({
    x: p.x, y: p.y, r: reach, life: 0.24, maxLife: 0.24,
    color: elInfo.color, hit: new Set(),
  });
  run.audio.slash();
  for (const e of run.enemies) {
    if (e.dead) continue;
    if (dist2(e.x, e.y, p.x, p.y) > reach * reach) continue;
    const rr = reach + e.r;
    if (dist2(e.x, e.y, p.x, p.y) > rr * rr) continue;
    run.rings.at(-1).hit.add(e.uid);
    run.damage(e, st, { crit: rollCrit(st), knock: st.knock || 60, element: el });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 射撃
// ─────────────────────────────────────────────────────────────────────────────
function doShot(run, wi, st, aim, boomerang, el, elInfo) {
  const p = run.player;
  const n = Math.max(1, Math.round(st.count));
  const spread = st.spread || 0;
  const speed = st.speed || 300;

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
      color: elInfo.color,
      kindName: boomerang ? 'boomerang' : 'shot',
    });
    b.ret = false;
    b.st = st;
    b.wi = wi;
    run.bullets.push(b);
  }
  run.audio.shoot();
  run.shake(1.4);
}

// ─────────────────────────────────────────────────────────────────────────────
// 爆弾
// ─────────────────────────────────────────────────────────────────────────────
function doBomb(run, wi, st, aim, el, elInfo) {
  const p = run.player;
  const speed = st.speed || 200;
  const b = makeBullet({
    x: p.x, y: p.y,
    vx: Math.cos(aim) * speed,
    vy: Math.sin(aim) * speed,
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
    gravity: 90,
  });
  b.st = st; b.wi = wi;
  run.bullets.push(b);
  run.audio.tone({ freq: 200, type: 'square', dur: 0.1, vol: 0.05, slide: 0.6 });
}

// ─────────────────────────────────────────────────────────────────────────────
// 連鎖 (稲光)
// ─────────────────────────────────────────────────────────────────────────────
function doChain(run, wi, st, aim, el) {
  let from = run.player;
  const n = Math.max(1, Math.round(st.chain));
  const hit = [];
  let ex = from.x, ey = from.y;

  for (let i = 0; i < n; i++) {
    const tgt = run.nearestEnemy(ex, ey, hit, 340);
    if (!tgt) break;
    hit.push(tgt.uid);
    run.lightnings.push({ x1: ex, y1: ey, x2: tgt.x, y2: tgt.y, life: 0.16, maxLife: 0.16 });
    run.damage(tgt, st, {
      crit: rollCrit(st),
      knock: st.knock,
      element: el,
      shock: st.shock,
      element: el,
    });
    ex = tgt.x; ey = tgt.y;
  }
  run.audio.tone({ freq: 1600, type: 'sawtooth', dur: 0.09, vol: 0.07, slide: 0.35 });
  run.shake(2);
}

// ─────────────────────────────────────────────────────────────────────────────
// 光線
// ─────────────────────────────────────────────────────────────────────────────
function doBeam(run, wi, st, aim, el, elInfo) {
  const p = run.player;
  const len = st.range;
  const wdt = 10 * st.size;
  const hit = new Set();
  run.beams.push({ x: p.x, y: p.y, a: aim, len, w: wdt, life: 0.22, maxLife: 0.22 });

  const dx = Math.cos(aim), dy = Math.sin(aim);
  for (const e of run.enemies) {
    if (e.dead || hit.has(e.uid)) continue;
    // 線分と円の最近点距離で判定。
    const rx = e.x - p.x, ry = e.y - p.y;
    const t = clamp(rx * dx + ry * dy, 0, len);
    const cxp = p.x + dx * t, cyp = p.y + dy * t;
    if (dist2(e.x, e.y, cxp, cyp) > (e.r + wdt / 2) ** 2) continue;
    hit.add(e.uid);
    run.damage(e, st, { crit: rollCrit(st), knock: st.knock, element: el });
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
    life: 0.35,
    element: el,
    burn: st.burn, poison: st.poison, chill: st.chill, shock: st.shock,
    freeze: st.freeze,
    attached: true,
  }));
  // 少し回復。
  if (st.regen) run.healPlayer(st.regen * 0.35);
}

const rollCrit = (st) => rng() < (st.crit || 0);

/**
 * 敵にダメージを与える。文の効果がすべてここで効く。
 * @param {object} e 敵
 * @param {object} st 武器ステータス
 * @param {object} opt {crit, knock, element, shock, extra}
 */
export function damage(run, e, st, opt = {}) {
  if (!e || e.dead) return 0;

  let dmg = st.dmg;
  const crit = opt.crit;
  if (crit) dmg *= (st.critDmg || 1.5);
  dmg = Math.max(1, Math.round(dmg));

  e.hp -= dmg;
  e.flash = 1;

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
  if (ls > 0) run.healPlayer(dmg * ls);

  // 撃退。
  const kn = opt.knock ?? st.knock ?? 0;
  if (kn > 0) {
    const a = Math.atan2(e.y - run.player.y, e.x - run.player.x);
    e.x += Math.cos(a) * kn * 0.12;
    e.y += Math.sin(a) * kn * 0.12;
  }

  // ボスの装甲。貫通や光線が主力。
  if (e.def.armor && !st.pierce && !st.area) dmg *= 0.7;

  run.damageNumbers?.(e.x, e.y, dmg, crit);
  run.onDamaged?.(e, dmg);

  if (e.hp <= 0) run.killEnemy(e, st);
  return dmg;
}

export { cdOf, rollCrit };
