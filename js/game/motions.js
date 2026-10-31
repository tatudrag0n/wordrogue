// ============================================================================
// ワードローグ — 武器のモーション
//
// 攻撃の「見た目」だけをここで決める。威力・間隔・当たり判定は combat.js の
// ままで、モーションを足しても DPS は変わらない。
//
// 1 回の攻撃は 4 つの局面を持つ。
//   予備動作 (windup) … 構え、引き絞り、振りかぶり
//   打撃   (strike) … 加速して刃先が走る。ここで命中
//   振り抜け (follow) … 勢いが残り、刃が行き過ぎる
//   戻り   (recover) … 次の構えへ戻る
//
// 武器ごとに軌道・速さ・重さを変え、同じ武器でも振り方を交互に変える。
// 乱数は使わない。攻撃回数 (motionSeq) だけで決まるので、テストで再現できる。
// ============================================================================

import { TAU, clamp } from '../core/util.js';

const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const easeOut = (t) => 1 - (1 - t) ** 3;
const easeIn = (t) => t * t;
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const wrapAngle = (a) => {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
};

/**
 * 武器の描画形。攻撃の型 (slash / shot / whip …) が同じでも、
 * 武器語が違えば持ち方と振り方を変える。
 *   family … slash / thrust / smash / punch / ranged / cast / whip / throw
 *   style  … 軌跡の作り方。同じ斬撃でも武器種で見え方を変える。
 *     wave    … 刃そのものが刃から離れて飛ぶ斬撃波 (刃)
 *     sweep   … 体の左右へ大きく薙ぐ (刀)
 *     forward … 正面へ短く斬り込む (剣)
 *     arc     … 標準の弧 (汎用の刃)
 *     smash / punch / bite / claw / thrust / ranged / cast / whip / throw
 *               … family ごとの描き方
 *
 * **variant の from / to / curve は「当たり判定の扇の半分の角度」に対する比**。
 * 実際の角度は、攻撃の瞬間に扇 (st.arc) から決まる。扇の外へはみ出さないので、
 * 見た目の刃の軌跡と当たる範囲が必ず一致する。
 */
export const WEAPON_MOTIONS = {
  // ── 刃: 斬撃が飛ぶ。刃から離れた三日月が、扇の外周 (間合い) まで走る。──
  sword: {
    style: 'wave', family: 'slash', duration: 0.50, windup: 0.34, impact: 0.54, follow: 0.80,
    rest: -0.55, lunge: 5, weight: 0.7,
    variants: [
      { id: 'kesa', from: -1.00, to: 1.00, curve: 0.07, label: '袈裟の斬撃波' },
      { id: 'gyaku', from: 1.00, to: -1.00, curve: -0.06, label: '逆袈裟の斬撃波' },
      { id: 'yoko', from: -1.00, to: 1.00, curve: 0.02, label: '横一文字の斬撃波' },
    ],
  },
  // ── 刀: 左右に斬る。扇の端から端まで振り抜く。──
  tachi: {
    style: 'sweep', family: 'slash', duration: 0.74, windup: 0.40, impact: 0.58, follow: 0.84,
    rest: -1.00, lunge: 10, weight: 1.25,
    variants: [
      { id: 'migi', from: -1.00, to: 1.00, curve: 0.10, label: '右薙ぎ' },
      { id: 'hidari', from: 1.00, to: -1.00, curve: -0.10, label: '左薙ぎ' },
      { id: 'kaeshi', from: -1.00, to: 1.00, curve: 0.05, label: '返し薙ぎ' },
    ],
  },
  // ── 剣: 前方に斬る。正面から大きく外れない、短い斬り込み。──
  longsword: {
    style: 'forward', family: 'slash', duration: 0.58, windup: 0.36, impact: 0.57, follow: 0.82,
    rest: -0.40, lunge: 8, weight: 0.9,
    variants: [
      { id: 'shomen', from: -1.00, to: 1.00, curve: 0.04, label: '正面斬り' },
      { id: 'kiriage', from: 1.00, to: -1.00, curve: -0.04, label: '斬り上げ' },
      { id: 'sashi', from: -1.00, to: 1.00, curve: 0.02, label: '突き込み' },
    ],
  },
  greatblade: {
    style: 'smash', family: 'smash', duration: 0.92, windup: 0.54, impact: 0.68, follow: 0.88,
    rest: -1.1, lunge: 17, weight: 1.8,
    variants: [
      { id: 'onigiri', from: -1.00, to: 1.00, curve: 0.12, label: '鬼斬り' },
      { id: 'kabuto', from: 1.00, to: -1.00, curve: -0.14, label: '兜割り' },
      { id: 'tsubame', from: -1.00, to: 1.00, curve: 0.09, label: '燕返し' },
    ],
  },
  hammer: {
    style: 'smash', family: 'smash', duration: 1.00, windup: 0.62, impact: 0.72, follow: 0.90,
    rest: -1.4, lunge: 13, weight: 2.2, ground: true,
    variants: [
      { id: 'tettsui', from: -1.00, to: 1.00, curve: 0.10, label: '鉄槌' },
      { id: 'gaten', from: 1.00, to: -1.00, curve: 0.12, label: '岩砕き' },
      { id: 'daiuchi', from: -1.00, to: 1.00, curve: -0.14, label: '大打ち' },
    ],
  },
  axe: {
    style: 'smash', family: 'smash', duration: 0.82, windup: 0.47, impact: 0.64, follow: 0.86,
    rest: -1.0, lunge: 12, weight: 1.5,
    variants: [
      { id: 'hagane', from: -1.00, to: 1.00, curve: 0.10, label: '鋼断ち' },
      { id: 'maki', from: 1.00, to: -1.00, curve: -0.07, label: '巻き割り' },
    ],
  },
  claw: {
    style: 'claw', family: 'claw', duration: 0.38, windup: 0.22, impact: 0.48, follow: 0.76,
    rest: -0.8, lunge: 9, weight: 0.5, passes: 3,
    variants: [
      { id: 'hikisaki', from: -1.00, to: 1.00, curve: 0.10, label: '引っ掻き' },
      { id: 'juuji', from: 1.00, to: -1.00, curve: -0.08, label: '十字爪' },
      { id: 'kama', from: -1.00, to: 1.00, curve: 0.06, label: '鎌爪' },
    ],
  },
  fang: {
    style: 'bite', family: 'bite', duration: 0.42, windup: 0.48, impact: 0.56, follow: 0.76,
    rest: -0.35, lunge: 15, weight: 0.8,
    variants: [
      { id: 'kamitsuki', from: -1.00, to: 1.00, curve: 0.05, label: '噛みつき' },
      { id: 'hiki', from: 1.00, to: -1.00, curve: -0.05, label: '引き裂き' },
    ],
  },
  fist: {
    style: 'punch', family: 'punch', duration: 0.30, windup: 0.42, impact: 0.48, follow: 0.72,
    rest: -0.35, lunge: 14, weight: 0.55,
    variants: [
      { id: 'zuki', from: -1.00, to: 1.00, curve: 0.04, label: '正拳' },
      { id: 'yokoge', from: 1.00, to: -1.00, curve: -0.04, label: '横拳' },
      { id: 'ren', from: -1.00, to: 1.00, curve: 0.02, label: '連打' },
    ],
  },
  spear: {
    style: 'thrust', family: 'thrust', duration: 0.44, windup: 0.46, impact: 0.48, follow: 0.72,
    rest: -0.15, lunge: 18, weight: 0.8,
    variants: [
      { id: 'tsuki', from: 0.02, to: -0.02, curve: 0, label: '直突き' },
      { id: 'renzuki', from: 0.06, to: -0.04, curve: 0.02, label: '連突き' },
      { id: 'nage', from: -0.08, to: 0.05, curve: -0.02, label: '上段突き' },
    ],
  },
  gun: {
    style: 'ranged', family: 'ranged', duration: 0.28, windup: 0.26, impact: 0.32, follow: 0.62,
    rest: -0.08, lunge: -5, weight: 0.25, recoil: 9,
    variants: [
      { id: 'hip', from: -0.03, to: 0.03, curve: 0, label: '腰溜め射撃' },
      { id: 'aim', from: 0.02, to: -0.02, curve: 0, label: '照準射撃' },
      { id: 'rapid', from: -0.08, to: 0.10, curve: 0.02, label: '速射' },
    ],
  },
  needle: {
    style: 'ranged', family: 'ranged', duration: 0.22, windup: 0.18, impact: 0.26, follow: 0.58,
    rest: -0.04, lunge: -3, weight: 0.15, recoil: 4,
    variants: [
      { id: 'flick', from: -0.08, to: 0.07, curve: 0, label: '指弾' },
      { id: 'senbon', from: 0.06, to: -0.06, curve: 0, label: '千本' },
    ],
  },
  bow: {
    style: 'ranged', family: 'ranged', duration: 0.40, windup: 0.54, impact: 0.58, follow: 0.78,
    rest: -0.18, lunge: -4, weight: 0.3, draw: true,
    variants: [
      { id: 'hyakubu', from: -0.04, to: 0.04, curve: 0, label: '百歩穿ち' },
      { id: 'tsurune', from: 0.08, to: -0.06, curve: 0, label: '弦鳴り' },
    ],
  },
  staff: {
    style: 'cast', family: 'cast', duration: 0.56, windup: 0.52, impact: 0.57, follow: 0.8,
    rest: -0.5, lunge: 0, weight: 0.35, glow: true,
    variants: [
      { id: 'jin', from: -0.30, to: 0.10, curve: 0.06, label: '陣を描く' },
      { id: 'kou', from: 0.20, to: -0.12, curve: -0.05, label: '光を纏う' },
    ],
  },
  chain: {
    style: 'whip', family: 'whip', duration: 0.62, windup: 0.40, impact: 0.58, follow: 0.84,
    rest: -1.1, lunge: 0, weight: 1.0, coil: 2,
    variants: [
      { id: 'uchi', from: -1.00, to: 1.00, curve: 0.20, label: '鎖打ち' },
      { id: 'maki', from: 1.00, to: -1.00, curve: -0.18, label: '巻き薙ぎ' },
      { id: 'tatsumaki', from: -0.30, to: 1.00, curve: 0.28, label: '竜巻' },
    ],
  },
  whip: {
    style: 'whip', family: 'whip', duration: 0.54, windup: 0.34, impact: 0.53, follow: 0.82,
    rest: -1.0, lunge: 0, weight: 0.7, coil: 1,
    variants: [
      { id: 'shippu', from: -1.00, to: 1.00, curve: 0.18, label: '疾風打ち' },
      { id: 'figure8', from: 1.00, to: -1.00, curve: -0.16, label: '八の字' },
      { id: 'crack', from: 0.20, to: -0.50, curve: 0.24, label: '鞭先返し' },
    ],
  },
  throw: {
    style: 'throw', family: 'throw', duration: 0.58, windup: 0.38, impact: 0.53, follow: 0.86,
    rest: -0.8, lunge: 0, weight: 0.6, spin: true,
    variants: [
      { id: 'souten', from: -0.80, to: 0.65, curve: 0.10, label: '双転' },
      { id: 'kaiten', from: 0.55, to: -0.85, curve: -0.09, label: '回転投げ' },
    ],
  },
  orb: {
    style: 'cast', family: 'cast', duration: 0.54, windup: 0.52, impact: 0.57, follow: 0.82,
    rest: -0.35, lunge: 0, weight: 0.2, glow: true,
    variants: [
      { id: 'shu', from: -0.15, to: 0.15, curve: 0.04, label: '集気' },
      { id: 'han', from: 0.15, to: -0.15, curve: -0.04, label: '放気' },
    ],
  },
  // ── 鋏: 二枚の刃で挟む。短い予備動作から、まっすぐ閉じる。──
  shears: {
    style: 'arc', family: 'slash', duration: 0.34, windup: 0.30, impact: 0.52, follow: 0.78,
    rest: -0.32, lunge: 6, weight: 0.45,
    variants: [
      { id: 'hasami', from: -1.00, to: 1.00, curve: 0.04, label: '挟み切り' },
      { id: 'kaeshi', from: 1.00, to: -1.00, curve: -0.04, label: '返し挟み' },
      { id: 'tachikiri', from: -1.00, to: 1.00, curve: 0.02, label: '断ち切り' },
    ],
  },
  // ── 鋸: 押し引きで挽く。ゆっくり大きく薙ぐ。──
  saw: {
    style: 'sweep', family: 'slash', duration: 0.72, windup: 0.42, impact: 0.58, follow: 0.86,
    rest: -0.95, lunge: 11, weight: 1.35,
    variants: [
      { id: 'hikikiri', from: -1.00, to: 1.00, curve: 0.09, label: '引き切り' },
      { id: 'oshikiri', from: 1.00, to: -1.00, curve: -0.09, label: '押し切り' },
      { id: 'kaeshibiki', from: -0.85, to: 0.85, curve: 0.05, label: '返し挽き' },
    ],
  },
  blade: {
    style: 'arc', family: 'slash', duration: 0.52, windup: 0.36, impact: 0.55, follow: 0.82,
    rest: -0.6, lunge: 7, weight: 0.8,
    variants: [
      { id: 'basic', from: -1.00, to: 1.00, curve: 0.06, label: '斬り下ろし' },
      { id: 'basic2', from: 1.00, to: -1.00, curve: -0.06, label: '斬り上げ' },
      { id: 'basic3', from: -1.00, to: 1.00, curve: 0.04, label: '薙ぎ' },
    ],
  },
  // ── 双剣: 二刀の速い斬撃波。左右交互に飛ぶ。 ──
  dualblades: {
    style: 'wave', family: 'slash', duration: 0.40, windup: 0.30, impact: 0.50, follow: 0.78,
    rest: -0.5, lunge: 6, weight: 0.6,
    variants: [
      { id: 'migi', from: -1.00, to: 1.00, curve: 0.05, label: '右の一刀' },
      { id: 'hidari', from: 1.00, to: -1.00, curve: -0.05, label: '左の一刀' },
      { id: 'ren', from: -1.00, to: 1.00, curve: 0.02, label: '連刃' },
    ],
  },
};


/** 武器語 -> 持ち方。未知の武器語は形 (res.shape) から寄せる。 */
export const GLYPH_MOTION = {
  刃: 'sword', 剣: 'longsword', 刀: 'tachi', 斧: 'greatblade', 槌: 'hammer',
  牙: 'fang', 爪: 'claw', 拳: 'fist', 銃: 'gun', 杖: 'staff',
  鋏: 'shears', 鋸: 'saw',
  弓: 'bow', 槍: 'spear', 矛: 'spear', 針: 'needle', 鞭: 'whip', 鎖: 'chain',
  環: 'blade', 輪: 'blade', 光: 'staff', 雷: 'staff', 渦: 'orb', 弾: 'orb',
  玉: 'orb', 球: 'orb', 矢: 'bow', 爆: 'orb', 還: 'throw',
};

/** 形 (shape) だけ分かっているときの持ち方。 */
const SHAPE_MOTION = {
  blade: 'blade', arrow: 'spear', shot: 'gun', orb: 'orb', bomb: 'orb',
};

/**
 * 1 回の攻撃モーションを作る。
 * @param {object} wi WeaponInst
 * @param {object} res resolve() の結果
 * @param {number} aim 照準角
 * @param {{interval?:number, elapsed?:number}} [opt]
 * @returns {object}
 */
export function startWeaponMotion(wi, res, aim, opt = {}) {
  const key = motionKey(wi, res);
  const base = WEAPON_MOTIONS[key] || WEAPON_MOTIONS.blade;
  const seq = (wi.motionSeq || 0) + 1;
  const variant = base.variants[(seq - 1) % base.variants.length];
  const interval = Math.max(0.04, opt.interval || (1 / Math.max(0.05, res?.stats?.rate || 1)));
  // 攻撃間隔より長いモーションは重なる。予備動作を削って、次の攻撃までに
  // 振り抜けまで収める (威力・間隔には触らない)。
  const duration = Math.max(0.12, Math.min(base.duration, interval * 0.92));
  const st = res?.stats || {};
  const family = familyOf(base, res);
  // 刃の角度と間合いは、**当たり判定の扇と半径をそのまま使う**。
  // variant は扇の半分の角度に対する比なので、軌跡が扇からはみ出さない。
  const arc = sectorArc(st, opt);
  const reach = sectorReach(st, opt);
  const m = {
    key, family, style: base.style || styleOfFamily(family),
    variant: variant.id, label: variant.label, seq,
    duration,
    windup: duration * base.windup,
    impactAt: duration * base.impact,
    followAt: duration * base.follow,
    elapsed: Math.max(0, Number(opt.elapsed) || 0),
    aim,
    baseAim: aim,
    // 扇の半分の角度に対する比。実際の角度は扇 (arc) から決まる。
    fromF: variant.from,
    toF: variant.to,
    curveF: variant.curve || 0,
    from: 0,
    to: 0,
    curve: 0,
    rest: base.rest,
    reach,
    arc,
    lunge: base.lunge || 0,
    weight: base.weight || 1,
    passes: base.passes || 1,
    coil: base.coil || 0,
    recoil: base.recoil || 0,
    glow: !!base.glow,
    ground: !!base.ground,
    spin: !!base.spin,
    draw: !!base.draw,
    color: res?.elementInfo?.color || '#d4a94e',
    el: res?.element || 'none',
    shape: res?.shape || 'blade',
    glyph: res?.tail || wi?.def?.glyph || wi?.def?.name || '刃',
  };
  syncMotionShape(m, reach, arc);
  wi.motionSeq = seq;
  wi.motion = m;
  wi.aim = aim;
  wi.lastMotion = m;
  if (wi.motionLog) {
    wi.motionLog.push(m);
    if (wi.motionLog.length > 24) wi.motionLog.shift();
  }
  return m;
}

/** 武器の攻撃の型ごとの既定の style。 */
function styleOfFamily(family) {
  if (family === 'thrust') return 'thrust';
  if (family === 'ranged') return 'ranged';
  if (family === 'cast') return 'cast';
  if (family === 'whip') return 'whip';
  if (family === 'throw') return 'throw';
  if (family === 'smash') return 'smash';
  if (family === 'punch') return 'punch';
  if (family === 'bite') return 'bite';
  if (family === 'claw') return 'claw';
  return 'arc';
}

/** 扇の角度。斬撃の武器は st.arc、それ以外は細い扇にしておく。 */
function sectorArc(st, opt) {
  const hit = Number(opt.arc);
  if (Number.isFinite(hit) && hit > 0.02) return hit;
  const own = Number(st.arc);
  if (Number.isFinite(own) && own > 0.02) return own;
  return 0.9;
}

/** 刃の届く距離。当たり判定と同じ式 (combat.js の attackShape) を使う。 */
function sectorReach(st, opt) {
  const hit = Number(opt.reach);
  if (Number.isFinite(hit) && hit > 0) return hit;
  return (Number(st.range) || 100) * (Number(st.size) || 1);
}

/**
 * モーションの扇と間合いを、当たり判定の値へ合わせ直す。
 * 予備動作のあいだに文が変わっても、打撃の瞬間には必ず一致する。
 * @param {object} m startWeaponMotion の戻り値
 * @param {number} reach 当たる距離
 * @param {number} arc 当たる扇の角度
 */
export function syncMotionShape(m, reach, arc) {
  if (!m) return m;
  if (Number.isFinite(reach) && reach > 0) m.reach = reach;
  const a = Number(arc);
  if (Number.isFinite(a) && a > 0.02) m.arc = a;
  // 扇の半分を基準に、variant の比を実際の角度へ直す。
  const half = (m.arc > 0.02 ? m.arc : 0.9) / 2;
  m.from = (m.fromF || 0) * half;
  m.to = (m.toF || 0) * half;
  m.curve = (m.curveF || 0) * half;
  m.halfArc = half;
  return m;
}

/** 攻撃の型と武器の形から、描画の family を決める。 */
function familyOf(base, res) {
  const kind = res?.kind;
  // 双剣。乗っている武器の持ち方が射撃・詠唱でも、二刀の斬撃として描く。
  if (kind === 'dual') {
    return base.family === 'ranged' || base.family === 'cast' ? 'slash' : base.family;
  }
  if (kind === 'whip') return 'whip';
  if (kind === 'pierce') return 'thrust';
  if (kind === 'shot' || kind === 'chain' || kind === 'beam' || kind === 'bomb') {
    return base.family === 'thrust' || base.family === 'slash' ? 'ranged' : base.family;
  }
  if (kind === 'slash' && base.family === 'ranged') return 'slash';
  if (kind === 'boomerang') return 'throw';
  return base.family;
}

/** モーションの元になる武器の持ち方。 */
export function motionKey(wi, res) {
  // 双剣。文の中で熟語になった二刀は、どの武器の文でも二刀の振り方をする。
  // 鉄球 (旋回) と分身 (自律) は撃つのではないので、モーションを持たない。
  if (res?.kind === 'dual') return 'dualblades';
  const tail = res?.tail;
  if (tail && GLYPH_MOTION[tail]) return GLYPH_MOTION[tail];
  const glyph = wi?.def?.glyph || wi?.def?.name;
  if (glyph && GLYPH_MOTION[glyph]) return GLYPH_MOTION[glyph];
  if (res?.shape && SHAPE_MOTION[res.shape]) return SHAPE_MOTION[res.shape];
  return 'blade';
}

/** モーションの長さ (秒)。攻撃間隔より短くする。 */
export function motionDuration(wi, res, interval) {
  const key = motionKey(wi, res);
  const base = WEAPON_MOTIONS[key] || WEAPON_MOTIONS.blade;
  return Math.max(0.12, Math.min(base.duration, Math.max(0.04, interval) * 0.92));
}

/** 予備動作の長さ (秒)。 */
export function motionWindup(wi, res, interval) {
  const key = motionKey(wi, res);
  const base = WEAPON_MOTIONS[key] || WEAPON_MOTIONS.blade;
  return motionDuration(wi, res, interval) * base.windup;
}

/**
 * 攻撃の何秒前から振り始めるか。打撃の瞬間が攻撃の瞬間に重なるよう、
 * 予備動作ではなく **打撃までの時間** を返す。
 */
export function motionLead(wi, res, interval) {
  const key = motionKey(wi, res);
  const base = WEAPON_MOTIONS[key] || WEAPON_MOTIONS.blade;
  return motionDuration(wi, res, interval) * base.impact;
}

/**
 * 経過時間から、いまの姿勢を求める。描画はこの値だけを見る。
 * 返す値はすべて有限。rAF が飛んでも clamp で破綻しない。
 * @param {object} m startWeaponMotion の戻り値
 * @param {number} [dt] 経過を進める秒数
 * @returns {object}
 */
export function motionPose(m, dt = 0) {
  if (!m) return null;
  if (dt) m.elapsed = Math.min(m.duration, (m.elapsed || 0) + Math.max(0, dt));
  const t = clamp((m.elapsed || 0) / m.duration, 0, 1);
  const u = clamp(t, 0, 0.999999);
  const w = m.windup / m.duration;
  const i = m.impactAt / m.duration;
  const f = m.followAt / m.duration;

  let phase = 'windup';
  let phaseT = 0;
  let swing = 0;
  if (t >= f) {
    phase = 'recover';
    phaseT = smooth(clamp((t - f) / (1 - f), 0, 1));
  } else if (t >= i) {
    phase = 'follow';
    phaseT = smooth(clamp((t - i) / (f - i), 0, 1));
    swing = 1;
  } else if (t >= w) {
    phase = 'strike';
    phaseT = clamp((t - w) / (i - w), 0, 1);
    swing = easeOut(phaseT);
  } else {
    phase = 'windup';
    phaseT = clamp(t / w, 0, 1);
  }

  // 振りかぶりはゆっくり、打撃は速く。戻りは少し遅れて余韻を残す。
  const wu = phase === 'windup' ? easeInOut(phaseT) : 1;
  const follow = phase === 'follow' || phase === 'recover' ? phaseT : 0;
  const angleRel = phase === 'windup'
    ? lerp(m.rest, m.from, wu)
    : phase === 'strike'
      ? lerp(m.from, m.to, swing)
      : phase === 'follow'
        ? lerp(m.to, m.to + (m.to - m.from) * 0.12, follow)
        : lerp(m.to + (m.to - m.from) * 0.12, m.rest, phaseT);
  // 刃が扇の外へ出ないようにする。振り抜けの余韻も、当たる範囲の内側で止める。
  const half = m.halfArc || (m.arc > 0.02 ? m.arc / 2 : 0);
  const bow = m.curve * Math.sin(clamp(t, 0, 1) * Math.PI);
  let rel = angleRel + bow;
  if (half > 0 && phase !== 'windup') rel = clamp(rel, -half, half);
  const angle = m.baseAim + rel;

  // 突きは角度ではなく「伸び」で見せる。
  let extension = 1;
  if (m.family === 'thrust') {
    extension = phase === 'windup' ? lerp(0.55, 0.82, wu)
      : phase === 'strike' ? lerp(0.82, 1.42, swing)
        : phase === 'follow' ? lerp(1.42, 1.32, phaseT)
          : lerp(1.32, 0.9, phaseT);
  } else if (m.family === 'ranged' || m.family === 'cast') {
    extension = phase === 'windup' ? lerp(0.85, 0.72, wu)
      : phase === 'strike' ? lerp(1, 1.08, phaseT)
        : 1;
  } else {
    extension = phase === 'windup' ? lerp(0.88, 0.7, wu)
      : phase === 'strike' ? lerp(1, 1.08, swing)
        : phase === 'follow' ? lerp(1.08, 1.02, phaseT)
          : lerp(1.02, 0.9, phaseT);
  }

  // 重心移動。踏み込んで、振り抜いたら戻る。
  const lungeK = phase === 'windup' ? -0.18 * wu
    : phase === 'strike' ? lerp(0.15, 1, swing)
      : phase === 'follow' ? lerp(1, 0.82, phaseT)
        : lerp(0.82, 0.25, phaseT);
  const lunge = m.lunge * lungeK;
  const alpha = phase === 'recover' ? 1 - phaseT * 0.55 : 1;
  const impact = t >= m.impactAt / m.duration
    ? Math.exp(-(t - m.impactAt / m.duration) * 12) : 0;
  const flash = phase === 'strike' ? Math.sin(clamp(phaseT, 0, 1) * Math.PI) : 0;
  const spin = m.spin
    ? (phase === 'windup' ? -0.2 * wu : lerp(-0.2, TAU * 1.15, clamp(t, 0, 1)))
    : 0;
  // 斬撃波 (style: wave) が刃から離れて飛ぶ量。打撃から振り抜けの終わりまで、
  // 0 (手元) → 1 (間合いの外周) へ進む。描画だけが使う。
  const windT = m.windup / m.duration;
  const followT = m.followAt / m.duration;
  const flight = clamp((t - windT) / Math.max(1e-3, followT - windT), 0, 1);
  const fly = phase === 'windup' ? 0 : 0.15 + 0.85 * easeOut(flight);

  return {
    t, u, phase, phaseT, swing, follow,
    angle, angleRel: rel, extension, lunge, half,
    x: Math.cos(m.aim) * lunge,
    y: Math.sin(m.aim) * lunge,
    alpha, impact, flash, spin,
    reach: m.reach * extension,
    arc: m.arc,
    flight, fly,
    tipX: Math.cos(angle) * m.reach * extension,
    tipY: Math.sin(angle) * m.reach * extension,
  };
}

/** 経過を 1 フレーム進める。寿命が切れたら false。 */
export function advanceWeaponMotion(m, dt) {
  if (!m) return false;
  m.elapsed = Math.min(m.duration, (m.elapsed || 0) + Math.max(0, dt));
  return m.elapsed < m.duration - 1e-6;
}

/** 打撃の瞬間か (描画で 1 回だけ火花を出すための判定)。 */
export function isImpactFrame(m, prev, now) {
  if (!m) return false;
  return prev < m.impactAt && now >= m.impactAt;
}

/**
 * 武器の描画形の分類。テストと、持ち方の一覧表示に使う。
 * @param {string} glyph 武器語
 */
export function weaponStyle(glyph, shape) {
  const key = GLYPH_MOTION[glyph] || SHAPE_MOTION[shape] || 'blade';
  const base = WEAPON_MOTIONS[key];
  return {
    key,
    family: base?.family || 'slash',
    style: base?.style || 'arc',
    variants: base?.variants.length || 0,
  };
}

export { wrapAngle };
