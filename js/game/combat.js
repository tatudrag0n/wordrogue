// ============================================================================
// ワードローグ — 戦闘
//
// 武器ごとに「どう撃つか」をここへ集約する。
// resolve() が active=false を返した武器は、ここには届かない。
// ============================================================================

import { TAU, clamp, dist2, rng } from '../core/util.js';
import { makeBullet, makeField, ensureHitSet, hitsEnemy, cutEnemyWords } from './entities.js';
import { ELEMENTS } from '../data/words.js?v=1.44';

/** 秒間あたりの攻撃回数からクールダウンを計算。 */
const cdOf = (rate) => 1 / Math.max(0.05, rate);

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

  // 撃つ瞬間の身体の動き。描画側がこれを見て、僅かに反って光る。
  p.castFlash = 0.18;
  p.castDir = aim;
  p.castColor = elInfo.color;
  p.castKind = kind;
  run.audio.cast?.(el, kind, wi.def.id);

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
    case 'flame': doFlame(run, wi, st, aim, el, elInfo); break;
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
    life: 0.32, maxLife: 0.32,
    color: elInfo.color,
    el,
    hit: new Set(),
  });
  run.audio.slash();
  // 刃の先で属性が弾ける。風なら風の弧、炎なら火の粉。
  const fx = ELEM_FX[el] || ELEM_FX.none;
  run.burst(p.x + Math.cos(aim) * reach * 0.72, p.y + Math.sin(aim) * reach * 0.72, 6, elInfo.color, {
    a: aim, spread: arc * 0.9, spd: fx.spd * 1.4, spdMin: fx.spd * 0.4,
    life: fx.life, r: fx.r, shape: fx.shape, drag: 5,
  });

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
    x: p.x, y: p.y, r: reach, life: 0.36, maxLife: 0.36,
    color: elInfo.color, el, hit: new Set(),
  });
  run.audio.slash();
  const fx = ELEM_FX[el] || ELEM_FX.none;
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + Math.random() * 0.3;
    run.burst(p.x + Math.cos(a) * reach * 0.9, p.y + Math.sin(a) * reach * 0.9, 1, elInfo.color, {
      a, spread: 0.4, spd: fx.spd, spdMin: 60, life: fx.life, r: fx.r, shape: fx.shape, drag: 5,
    });
  }
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
  run.audio.shoot();
  run.shake(1.4);
}

// ─────────────────────────────────────────────────────────────────────────────
// 爆弾
// ─────────────────────────────────────────────────────────────────────────────
function doBomb(run, wi, st, aim, el, elInfo) {
  const p = run.player;
  const speed = Math.max(500, st.speed || 200);
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
  run.beams.push({
    x: p.x, y: p.y, a: aim, len, w: wdt,
    life: 0.3, maxLife: 0.3,
    color: elInfo?.color || '#e8a30a',
    el,
  });

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
    life: 0.5,
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

  run.damageNumbers?.(e.x, e.y, dmg, crit);
  run.onDamaged?.(e, dmg);

  if (e.hp <= 0) run.killEnemy(e, st);
  return dmg;
}

export { cdOf, rollCrit };
