// ============================================================================
// ワードローグ — 戦闘
//
// 武器ごとに「どう撃つか」をここへ集約する。
// resolve() が active=false を返した武器は、ここには届かない。
// ============================================================================

import { TAU, clamp, dist2, rng } from '../core/util.js';
import { makeBullet, makeField, ensureHitSet, hitsEnemy, cutEnemyWords } from './entities.js';
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
  // 攻撃の種類は文中の形態語が決めている (無ければ武器の既定)。
  const kind = res.kind || wi.def.kind;

  wi.flash = 1;
  wi.phase += 0.6;

  // 照準。敵がいれば最寄りを向く。angle を返す (敵オブジェクトではない)。
  const tgt = run.nearestEnemy(p.x, p.y);
  const aim = tgt ? Math.atan2(tgt.y - p.y, tgt.x - p.x) : p.face;
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
  // 振りを左右交互にして、見た目の単調さを消す。
  wi.swing = -(wi.swing || 1);
  run.slashes.push({
    x: p.x, y: p.y, a: aim,
    va: aim + wi.swing * 0.24,
    r: reach,
    arc,
    life: 0.32, maxLife: 0.32,
    color: elInfo.color,
    hit: new Set(),
  });
  run.audio.slash();

  // 刃先の火花。
  for (let i = 0; i < 5; i++) {
    const a = aim + (i / 4 - 0.5) * arc * 0.9;
    run.burst(p.x + Math.cos(a) * reach * 0.9, p.y + Math.sin(a) * reach * 0.9, 1, elInfo.color, {
      spd: 160, spdMin: 40, life: 0.3, r: 2.4,
      a: a + wi.swing * 1.4, spread: 1.4,
    });
  }

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
    run.burst(e.x, e.y, 4, elInfo.color, { spd: 190, life: 0.3, r: 2.6, a: a + Math.PI, spread: 2 });
    run.damage(e, st, { crit: rollCrit(st), knock: st.knock, element: el });
  }
}

function doWhip(run, wi, st, aim, el, elInfo) {
  const p = run.player;
  const reach = (st.range + (st.area || 0)) * (p.stats.size || 1);
  run.rings.push({
    x: p.x, y: p.y, r: reach, life: 0.36, maxLife: 0.36,
    color: elInfo.color, hit: new Set(),
    a: aim, arc: 2.9,
  });
  run.audio.slash();
  for (const e of run.enemies) {
    if (e.dead) continue;
    if (dist2(e.x, e.y, p.x, p.y) > reach * reach) continue;
    const rr = reach + e.r;
    if (dist2(e.x, e.y, p.x, p.y) > rr * rr) continue;
    run.rings.at(-1).hit.add(e.uid);
    const ea = Math.atan2(e.y - p.y, e.x - p.x);
    run.burst(e.x, e.y, 5, elInfo.color, { spd: 200, life: 0.3, r: 2.6, a: ea, spread: 2.4 });
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

  // マズルフラッシュ。
  run.burst(
    p.x + Math.cos(aim) * (p.r + 6), p.y + Math.sin(aim) * (p.r + 6),
    boomerang ? 6 : 4, elInfo.color,
    { a: aim, spread: boomerang ? 2.2 : 0.7, spd: 150, spdMin: 40, life: 0.22, r: 2.4 },
  );

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
      pierce: boomerang ? Math.max(st.pierce, 3) : st.pierce,
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
      spin: Math.random() * TAU,
      spinSpd: boomerang ? 14 : 0,
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
  const range = 340 + (st.area || 0) * 0.8;
  let ex = from.x, ey = from.y;

  for (let i = 0; i < n; i++) {
    const tgt = run.nearestEnemy(ex, ey, hit, range);
    if (!tgt) break;
    hit.push(tgt.uid);
    run.lightnings.push({
      x1: ex, y1: ey, x2: tgt.x, y2: tgt.y,
      life: 0.24, maxLife: 0.24, color: '#ffe14d',
    });
    run.burst(tgt.x, tgt.y, 6, '#ffe14d', { spd: 190, life: 0.32, r: 2.4 });
    run.damage(tgt, st, {
      crit: rollCrit(st),
      knock: st.knock,
      element: el,
      shock: st.shock,
    });
    ex = tgt.x; ey = tgt.y;
  }

  // 行き止まりから枝を散らして、落雷らしく見せる。
  if (hit.length) {
    for (let k = 0; k < 3; k++) {
      const a = Math.random() * TAU;
      const len = 36 + Math.random() * 64;
      run.lightnings.push({
        x1: ex, y1: ey,
        x2: ex + Math.cos(a) * len, y2: ey + Math.sin(a) * len,
        life: 0.15, maxLife: 0.15, color: '#fff6c9', thin: true,
      });
    }
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
  run.beams.push({
    x: p.x, y: p.y, a: aim, len, w: wdt,
    life: 0.3, maxLife: 0.3, color: elInfo.color,
  });

  const dx = Math.cos(aim), dy = Math.sin(aim);

  // 銃口の閃光と、線に沿う残り火。
  run.burst(p.x + dx * (p.r + 6), p.y + dy * (p.r + 6), 5, elInfo.color, {
    a: aim, spread: 0.6, spd: 150, life: 0.24, r: 2.6,
  });
  for (let i = 1; i <= 6; i++) {
    const d = (i / 7) * len * (0.35 + Math.random() * 0.65);
    run.burst(p.x + dx * d, p.y + dy * d, 1, elInfo.color, {
      spd: 50, spdMin: 0, life: 0.3, r: 2.2, drag: 4,
    });
  }

  for (const e of run.enemies) {
    if (e.dead || hit.has(e.uid)) continue;
    // 線分と円の最近点距離で判定。
    const rx = e.x - p.x, ry = e.y - p.y;
    const t = clamp(rx * dx + ry * dy, 0, len);
    const cxp = p.x + dx * t, cyp = p.y + dy * t;
    if (dist2(e.x, e.y, cxp, cyp) > (e.r + wdt / 2) ** 2) continue;
    hit.add(e.uid);
    run.burst(e.x, e.y, 5, elInfo.color, { spd: 210, life: 0.3, r: 2.6 });
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
    life: 0.5,
    element: el,
    burn: st.burn, poison: st.poison, chill: st.chill, shock: st.shock,
    freeze: st.freeze,
    attached: true,
  }));
  const col = (ELEMENTS[el] || ELEMENTS.none).color;
  run.rings.push({
    x: p.x, y: p.y, r: reach * 0.96,
    life: 0.3, maxLife: 0.3, color: col, w: 0.6,
  });
  // 少し回復。
  if (st.regen) {
    run.healPlayer(st.regen * 0.35);
    run.burst(p.x, p.y, 3, '#7dff9b', { spd: 70, life: 0.45, r: 2.2, grav: -50 });
  }
}

const rollCrit = (st) => rng() < (st.crit || 0);

/**
 * 武器の文で敵の文を斬る。
 *   斬る量は 成立 1 語、熟語 +1、述語 +1。確率は文の良し悪しで変わる。
 *   毎回斬ると敵の文が数秒で消えてしまうので、確率を賭ける。
 * ボスは文を斬れない。倒すには通常のダメージを積むしかない。
 * 崩れた敵は止まる。
 * @param {object} e 敵
 * @param {object} st 武器ステータス
 * @param {object} run
 */
function cutByWeapon(e, st, run) {
  if (!e.words || e.broken || e.boss) return;
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
      color: '#ffd43b',
    });
    run.burst(e.x, e.y, 8, '#ffd43b', { spd: 220, life: 0.35, r: 2.6 });
  }
  if (r.broken) {
    // 崩れた。止める。
    e.atkCd = 99;
    e.charging = 0;
    e.dmg = 0;
    e.speed = e.def.speed * 0.4;
    run.burst(e.x, e.y, 16, '#ff5470', { spd: 260, life: 0.5, r: 3 });
    run.flashFx = Math.min(0.6, run.flashFx + 0.08);
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

  let dmg = st.dmg;
  const crit = opt.crit;
  if (crit) dmg *= (st.critDmg || 1.5);
  dmg = Math.max(1, Math.round(dmg));

  // 文が崩れた敵は脆い。斬る方が楽になる。
  if (e.broken) dmg = Math.max(1, Math.round(dmg * 2.5));

  e.hp -= dmg;
  e.flash = 1;
  if (crit) run.burst(e.x, e.y, 4, '#ffd43b', { spd: 210, life: 0.3, r: 2.4 });

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
