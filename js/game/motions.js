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
const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - (1 - t) ** 5);
const easeInCubic = (t) => t * t * t;
const easeSnap = (t) => 1 - (1 - t) ** 4;
/** 打撃の加速曲線。武器の signature ごとに「重さ」の出方が違う。
 *  heavy … ゆっくり入り、最後に加速して落ちる (斧・槌)
 *  snap  … 最初の一瞬でほぼ行き切る (鋏・牙・針・拳・銃)
 *  saw   … 等速。押し引きの往復は pose 側で付ける (鋸)
 *  expo  … 速く走って、抜けで少し緩む (既定) */
export function swingCurve(m, t) {
  const x = clamp(t, 0, 1);
  if (!m) return easeOutExpo(x);
  if (m.curve === 'heavy') return easeInCubic(x);
  if (m.curve === 'snap') return easeSnap(x);
  if (m.curve === 'saw') return x;
  return easeOutExpo(x);
}
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
 *     wave    … 刃から離れて前方へ飛ぶ三日月型の斬撃波 (刃・刀・剣・汎用の刃・双剣)
 *     sweep   … 体の左右へ大きく薙ぐ (鋸の押し引き)
 *     arc     … 標準の弧 (鋏など、style を持たない斬撃の受け皿)
 *     smash / punch / bite / claw / thrust / ranged / cast / whip / throw
 *               … family ごとの描き方
 *
 * **variant の from / to / curve は「当たり判定の扇の半分の角度」に対する比**。
 * 実際の角度は、攻撃の瞬間に扇 (st.arc) から決まる。扇の外へはみ出さないので、
 * 見た目の刃の軌跡と当たる範囲が必ず一致する。
 */
export const WEAPON_MOTIONS = {
  // ── 刃: 斬撃が飛ぶ。刃から離れた三日月が、扇の外周 (間合い) まで走る。──
  //    cres … 三日月の形。len=長さ (間合い比) / thick=厚み / spin=飛翔中の回転 /
  //    trail=後ろに残す残像三日月の数。幾何は crescentGeom が扇の内側に収める。
  sword: {
    style: 'wave', family: 'slash', duration: 0.50, windup: 0.34, impact: 0.54, follow: 0.80,
    sig: 'wave-crescent', curve: 'expo', antic: 0.18, hold: 0.04, ghosts: 2,
    cres: { len: 1.0, thick: 0.13, spin: 0.35, trail: 3 },
    rest: -0.55, lunge: 5, weight: 0.7,
    variants: [
      { id: 'kesa', from: -1.00, to: 1.00, curve: 0.07, label: '袈裟の斬撃波' },
      { id: 'gyaku', from: 1.00, to: -1.00, curve: -0.06, label: '逆袈裟の斬撃波' },
      { id: 'yoko', from: -1.00, to: 1.00, curve: 0.02, label: '横一文字の斬撃波' },
    ],
  },
  // ── 刀: 居合の構えから、幅広で扁平な三日月を飛ばす。納刀の所作は pose 側に残る。──
  tachi: {
    style: 'wave', family: 'slash', duration: 0.74, windup: 0.40, impact: 0.58, follow: 0.84,
    sig: 'iai-flash', curve: 'expo', antic: 0.30, hold: 0.09, ghosts: 1,
    cres: { len: 1.18, thick: 0.09, spin: 0.22, trail: 2 },
    rest: -1.00, lunge: 10, weight: 1.25,
    variants: [
      { id: 'migi', from: -1.00, to: 1.00, curve: 0.10, label: '右薙ぎの三日月' },
      { id: 'hidari', from: 1.00, to: -1.00, curve: -0.10, label: '左薙ぎの三日月' },
      { id: 'kaeshi', from: -1.00, to: 1.00, curve: 0.05, label: '返し薙ぎの三日月' },
    ],
  },
  // ── 剣: 本体は突き (kind: thrust)。バリアントも突き主体にし、
  //    斬撃として振る (動詞で slash になった) ときは細く速い三日月が飛ぶ。──
  longsword: {
    style: 'wave', family: 'slash', duration: 0.58, windup: 0.36, impact: 0.57, follow: 0.82,
    sig: 'crescent-thrust-mix', curve: 'snap', antic: 0.22, hold: 0.05, ghosts: 2,
    cres: { len: 0.8, thick: 0.08, spin: 0.5, trail: 2 },
    rest: -0.40, lunge: 8, weight: 0.9,
    variants: [
      { id: 'tsuki', from: 0.05, to: -0.05, curve: 0, label: '突き込み' },
      { id: 'shomen', from: -1.00, to: 1.00, curve: 0.04, label: '正面斬り' },
      { id: 'kiriage', from: 1.00, to: -1.00, curve: -0.04, label: '斬り上げ' },
    ],
  },
  hammer: {
    style: 'smash', family: 'smash', duration: 1.00, windup: 0.62, impact: 0.72, follow: 0.90,
    sig: 'quake-ring', curve: 'heavy', antic: 0.38, hold: 0.12, ghosts: 1,
    rest: -1.4, lunge: 13, weight: 2.2, ground: true,
    variants: [
      { id: 'tettsui', from: -1.00, to: 1.00, curve: 0.10, label: '鉄槌' },
      { id: 'gaten', from: 1.00, to: -1.00, curve: 0.12, label: '岩砕き' },
      { id: 'daiuchi', from: -1.00, to: 1.00, curve: -0.14, label: '大打ち' },
    ],
  },
  axe: {
    style: 'smash', family: 'smash', duration: 0.82, windup: 0.47, impact: 0.64, follow: 0.86,
    sig: 'smash-chop', curve: 'heavy', antic: 0.30, hold: 0.09, ghosts: 1,
    rest: -1.0, lunge: 12, weight: 1.5,
    variants: [
      { id: 'hagane', from: -1.00, to: 1.00, curve: 0.10, label: '鋼断ち' },
      { id: 'maki', from: 1.00, to: -1.00, curve: -0.07, label: '巻き割り' },
      { id: 'jiwari', from: -1.00, to: 1.00, curve: 0.13, label: '地割り' },
    ],
  },
  claw: {
    style: 'claw', family: 'claw', duration: 0.38, windup: 0.22, impact: 0.48, follow: 0.76,
    sig: 'claw-stagger', curve: 'snap', antic: 0.12, hold: 0.02, ghosts: 2, stagger: 0.16,
    rest: -0.8, lunge: 9, weight: 0.5, passes: 3,
    variants: [
      { id: 'hikisaki', from: -1.00, to: 1.00, curve: 0.10, label: '引っ掻き' },
      { id: 'juuji', from: 1.00, to: -1.00, curve: -0.08, label: '十字爪' },
      { id: 'kama', from: -1.00, to: 1.00, curve: 0.06, label: '鎌爪' },
    ],
  },
  fang: {
    style: 'bite', family: 'bite', duration: 0.42, windup: 0.48, impact: 0.56, follow: 0.76,
    sig: 'bite-snap', curve: 'snap', antic: 0.26, hold: 0.08, ghosts: 1,
    // 噛みつきが本体。斬撃波は小さめの二連だけを短く飛ばす (drawBiteTrail)。
    cres: { len: 0.55, thick: 0.09, spin: 0.3, trail: 0 },
    rest: -0.35, lunge: 15, weight: 0.8,
    variants: [
      { id: 'kamitsuki', from: -1.00, to: 1.00, curve: 0.05, label: '噛みつき' },
      { id: 'hiki', from: 1.00, to: -1.00, curve: -0.05, label: '引き裂き' },
    ],
  },
  fist: {
    style: 'punch', family: 'punch', duration: 0.30, windup: 0.42, impact: 0.48, follow: 0.72,
    sig: 'punch-rush', curve: 'snap', antic: 0.10, hold: 0.02, ghosts: 3, pulses: 4,
    rest: -0.35, lunge: 14, weight: 0.55,
    variants: [
      { id: 'zuki', from: -1.00, to: 1.00, curve: 0.04, label: '正拳' },
      { id: 'yokoge', from: 1.00, to: -1.00, curve: -0.04, label: '横拳' },
      { id: 'ren', from: -1.00, to: 1.00, curve: 0.02, label: '連打' },
    ],
  },
  spear: {
    style: 'thrust', family: 'thrust', duration: 0.44, windup: 0.46, impact: 0.48, follow: 0.72,
    sig: 'thrust-ghostline', curve: 'expo', antic: 0.20, hold: 0.05, ghosts: 3,
    rest: -0.15, lunge: 18, weight: 0.8,
    variants: [
      { id: 'tsuki', from: 0.02, to: -0.02, curve: 0, label: '直突き' },
      { id: 'renzuki', from: 0.06, to: -0.04, curve: 0.02, label: '連突き' },
      { id: 'nage', from: -0.08, to: 0.05, curve: -0.02, label: '上段突き' },
    ],
  },
  gun: {
    style: 'ranged', family: 'ranged', duration: 0.28, windup: 0.26, impact: 0.32, follow: 0.62,
    sig: 'gun-recoil-shell', curve: 'snap', antic: 0.05, hold: 0.03, ghosts: 0,
    rest: -0.08, lunge: -5, weight: 0.25, recoil: 9,
    variants: [
      { id: 'hip', from: -0.03, to: 0.03, curve: 0, label: '腰溜め射撃' },
      { id: 'aim', from: 0.02, to: -0.02, curve: 0, label: '照準射撃' },
      { id: 'rapid', from: -0.08, to: 0.10, curve: 0.02, label: '速射' },
    ],
  },
  needle: {
    style: 'ranged', family: 'ranged', duration: 0.22, windup: 0.18, impact: 0.26, follow: 0.58,
    sig: 'needle-rapid', curve: 'snap', antic: 0.06, hold: 0.01, ghosts: 2, pulses: 3,
    rest: -0.04, lunge: -3, weight: 0.15, recoil: 4,
    variants: [
      { id: 'flick', from: -0.08, to: 0.07, curve: 0, label: '指弾' },
      { id: 'senbon', from: 0.06, to: -0.06, curve: 0, label: '千本' },
    ],
  },
  bow: {
    style: 'ranged', family: 'ranged', duration: 0.40, windup: 0.54, impact: 0.58, follow: 0.78,
    sig: 'bow-draw-release', curve: 'snap', antic: 0.28, hold: 0.04, ghosts: 1,
    rest: -0.18, lunge: -4, weight: 0.3, draw: true,
    variants: [
      { id: 'hyakubu', from: -0.04, to: 0.04, curve: 0, label: '百歩穿ち' },
      { id: 'tsurune', from: 0.08, to: -0.06, curve: 0, label: '弦鳴り' },
    ],
  },
  staff: {
    style: 'cast', family: 'cast', duration: 0.56, windup: 0.52, impact: 0.57, follow: 0.8,
    sig: 'cast-circle', curve: 'expo', antic: 0.15, hold: 0.05, ghosts: 1,
    rest: -0.5, lunge: 0, weight: 0.35, glow: true,
    variants: [
      { id: 'jin', from: -0.30, to: 0.10, curve: 0.06, label: '陣を描く' },
      { id: 'kou', from: 0.20, to: -0.12, curve: -0.05, label: '光を纏う' },
    ],
  },
  chain: {
    style: 'whip', family: 'whip', duration: 0.62, windup: 0.40, impact: 0.58, follow: 0.84,
    sig: 'chain-link-wave', curve: 'snap', antic: 0.20, hold: 0.04, ghosts: 2,
    rest: -1.1, lunge: 0, weight: 1.0, coil: 2,
    variants: [
      { id: 'uchi', from: -1.00, to: 1.00, curve: 0.20, label: '鎖打ち' },
      { id: 'maki', from: 1.00, to: -1.00, curve: -0.18, label: '巻き薙ぎ' },
      { id: 'tatsumaki', from: -0.30, to: 1.00, curve: 0.28, label: '竜巻' },
    ],
  },
  whip: {
    style: 'whip', family: 'whip', duration: 0.54, windup: 0.34, impact: 0.53, follow: 0.82,
    sig: 'whip-crack', curve: 'expo', antic: 0.22, hold: 0.03, ghosts: 2,
    rest: -1.0, lunge: 0, weight: 0.7, coil: 1,
    variants: [
      { id: 'shippu', from: -1.00, to: 1.00, curve: 0.18, label: '疾風打ち' },
      { id: 'figure8', from: 1.00, to: -1.00, curve: -0.16, label: '八の字' },
      { id: 'crack', from: 0.20, to: -0.50, curve: 0.24, label: '鞭先返し' },
    ],
  },
  throw: {
    style: 'throw', family: 'throw', duration: 0.58, windup: 0.38, impact: 0.53, follow: 0.86,
    sig: 'throw-spin', curve: 'expo', antic: 0.18, hold: 0.03, ghosts: 2,
    rest: -0.8, lunge: 0, weight: 0.6, spin: true,
    variants: [
      { id: 'souten', from: -0.80, to: 0.65, curve: 0.10, label: '双転' },
      { id: 'kaiten', from: 0.55, to: -0.85, curve: -0.09, label: '回転投げ' },
    ],
  },
  orb: {
    style: 'cast', family: 'cast', duration: 0.54, windup: 0.52, impact: 0.57, follow: 0.82,
    sig: 'orb-charge', curve: 'expo', antic: 0.12, hold: 0.06, ghosts: 1,
    rest: -0.35, lunge: 0, weight: 0.2, glow: true,
    variants: [
      { id: 'shu', from: -0.15, to: 0.15, curve: 0.04, label: '集気' },
      { id: 'han', from: 0.15, to: -0.15, curve: -0.04, label: '放気' },
    ],
  },
  // ── 鋏: 二枚の刃で挟む。短い予備動作から、まっすぐ閉じる。──
  shears: {
    style: 'arc', family: 'slash', duration: 0.34, windup: 0.30, impact: 0.52, follow: 0.78,
    sig: 'snip-two-stage', curve: 'snap', antic: 0.08, hold: 0.07, ghosts: 1, snapAt: 0.45,
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
    sig: 'saw-push-pull', curve: 'saw', antic: 0.16, hold: 0.03, ghosts: 1, strokes: 3,
    rest: -0.95, lunge: 11, weight: 1.35,
    variants: [
      { id: 'hikikiri', from: -1.00, to: 1.00, curve: 0.09, label: '引き切り' },
      { id: 'oshikiri', from: 1.00, to: -1.00, curve: -0.09, label: '押し切り' },
      { id: 'kaeshibiki', from: -0.85, to: 0.85, curve: 0.05, label: '返し挽き' },
    ],
  },
  blade: {
    style: 'wave', family: 'slash', duration: 0.52, windup: 0.36, impact: 0.55, follow: 0.82,
    sig: 'arc-basic', curve: 'expo', antic: 0.18, hold: 0.04, ghosts: 2,
    cres: { len: 0.95, thick: 0.12, spin: 0.3, trail: 2 },
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
    sig: 'dual-alternate', curve: 'expo', antic: 0.14, hold: 0.03, ghosts: 2,
    cres: { len: 0.9, thick: 0.11, spin: 0.4, trail: 3 },
    rest: -0.5, lunge: 6, weight: 0.6,
    variants: [
      { id: 'migi', from: -1.00, to: 1.00, curve: 0.05, label: '右の一刀' },
      { id: 'hidari', from: 1.00, to: -1.00, curve: -0.05, label: '左の一刀' },
      { id: 'ren', from: -1.00, to: 1.00, curve: 0.02, label: '連刃' },
    ],
  },
  // ── 環・輪・渦: 周回そのものが攻撃の動き。戦闘中は軌道刃として回り続けるので
  //    (run.orbitTick / render.drawWeaponSpirits)、このプロファイルは
  //    「刃を振る」のではなく周回の所作を表す。斬撃化したときだけ弧になる。──
  orbit: {
    style: 'orbit', family: 'slash', duration: 0.60, windup: 0.36, impact: 0.55, follow: 0.82,
    sig: 'orbit-spin', curve: 'expo', antic: 0.16, hold: 0.03, ghosts: 2, spin: true,
    rest: -0.7, lunge: 0, weight: 0.7,
    variants: [
      { id: 'kaiten', from: -1.00, to: 1.00, curve: 0.30, label: '旋回' },
      { id: 'shuukai', from: 1.00, to: -1.00, curve: -0.30, label: '周回' },
      { id: 'senpuu', from: -1.00, to: 1.00, curve: 0.18, label: '旋風' },
    ],
  },
  // ── 光: 光線 (beam) を撃つ手元。詠唱サークルではなく、一点に集光して放つ。──
  beam: {
    style: 'cast', family: 'cast', duration: 0.52, windup: 0.50, impact: 0.56, follow: 0.80,
    sig: 'beam-charge', curve: 'expo', antic: 0.14, hold: 0.05, ghosts: 1, glow: true,
    rest: -0.3, lunge: 0, weight: 0.3,
    variants: [
      { id: 'shuukou', from: -0.20, to: 0.08, curve: 0.03, label: '集光' },
      { id: 'houkou', from: 0.14, to: -0.06, curve: -0.02, label: '放光' },
    ],
  },
  // ── 雷: 連鎖稲光 (chain) / 落雷 (bolt) を呼ぶ手元。杖の詠唱ではなく、
  //    天へ掲げて指し示す所作で雷を落とす。──
  bolt: {
    style: 'cast', family: 'cast', duration: 0.48, windup: 0.46, impact: 0.54, follow: 0.78,
    sig: 'bolt-call', curve: 'snap', antic: 0.20, hold: 0.04, ghosts: 1, glow: true,
    rest: -0.9, lunge: 0, weight: 0.4,
    variants: [
      { id: 'kakage', from: -0.50, to: -0.10, curve: 0.05, label: '天へ掲げる' },
      { id: 'sashishimesu', from: -0.15, to: 0.15, curve: 0, label: '指し示す' },
    ],
  },
};


/** 武器語 -> 持ち方。未知の武器語は形 (res.shape) から寄せる。
 *  対応は「その語の実際の攻撃の型」に合わせる (名前↔モーション監査, 1.69):
 *    斧は打撃 (smash) の axe、環・輪・渦は周回 (orbit)、光は光線 (beam)、
 *    雷は連鎖/落雷 (bolt)、弾・爆は投擲 (throw)。 */
export const GLYPH_MOTION = {
  刃: 'sword', 剣: 'longsword', 刀: 'tachi', 斧: 'axe', 槌: 'hammer',
  牙: 'fang', 爪: 'claw', 拳: 'fist', 銃: 'gun', 杖: 'staff',
  鋏: 'shears', 鋸: 'saw',
  弓: 'bow', 槍: 'spear', 矛: 'spear', 針: 'needle', 鞭: 'whip', 鎖: 'chain',
  環: 'orbit', 輪: 'orbit', 光: 'beam', 雷: 'bolt', 渦: 'orbit', 弾: 'throw',
  玉: 'orb', 球: 'orb', 爆: 'throw', 還: 'throw',
};

/** 形 (shape) だけ分かっているときの持ち方。 */
export const SHAPE_MOTION = {
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
    sig: base.sig || base.style || 'arc-basic',
    cres: base.cres || null,
    curve: base.curve || 'expo',
    antic: base.antic || 0,
    holdF: base.hold || 0,
    ghostsN: base.ghosts || 0,
    pulses: base.pulses || 0,
    strokes: base.strokes || 0,
    stagger: base.stagger || 0,
    snapAt: base.snapAt || 0.45,
    glow: !!base.glow,
    ground: !!base.ground,
    spin: !!base.spin,
    draw: !!base.draw,
    color: res?.elementInfo?.color || '#d4a94e',
    el: res?.element || 'none',
    elSub: res?.subElement || null,
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
  if (kind === 'pierce' || kind === 'thrust') return 'thrust';
  if (kind === 'smash' || kind === 'quake') return 'smash';
  if (kind === 'sweep') return 'slash';
  if (kind === 'vortex' || kind === 'nova' || kind === 'blaze' || kind === 'venom' || kind === 'void') return 'cast';
  if (kind === 'gale' || kind === 'tide' || kind === 'shard' || kind === 'quake') {
    return base.family === 'thrust' || base.family === 'slash' ? 'ranged' : base.family;
  }
  if (kind === 'shot' || kind === 'chain' || kind === 'beam' || kind === 'bomb') {
    return base.family === 'thrust' || base.family === 'slash' ? 'ranged' : base.family;
  }
  if (kind === 'slash' && base.family === 'ranged') return 'slash';
  if (kind === 'boomerang') return 'throw';
  return base.family;
}

/** モーションの元になる武器の持ち方。 */
export function motionKey(wi, res) {
  // 双剣 (文で熟語になった二刀) は二刀の振り方。拳など武器自身の dual は本来の持ち方。
  // 鉄球 (旋回) と分身 (自律) は撃つのではないので、モーションを持たない。
  if (res?.kind === 'dual' && res?.compound) return 'dualblades';
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
  let held = false;
  // 打撃の直後、ほんの一瞬だけ姿勢を止める (ヒットストップ的な「溜め」)。
  // 局面名は follow のまま phaseT=0 で凍るので、局面の順序は崩れない。
  const holdEnd = Math.min(f - 0.01, i + (m.holdF || 0));
  if (t >= f) {
    phase = 'recover';
    phaseT = smooth(clamp((t - f) / (1 - f), 0, 1));
  } else if (t >= i && t < holdEnd) {
    phase = 'follow';
    phaseT = 0;
    swing = 1;
    held = true;
  } else if (t >= i) {
    phase = 'follow';
    phaseT = smooth(clamp((t - holdEnd) / Math.max(1e-3, f - holdEnd), 0, 1));
    swing = 1;
  } else if (t >= w) {
    phase = 'strike';
    phaseT = clamp((t - w) / (i - w), 0, 1);
    swing = swingCurve(m, phaseT);
  } else {
    phase = 'windup';
    phaseT = clamp(t / w, 0, 1);
  }

  // 振りかぶりはゆっくり、打撃は速く。戻りは少し遅れて余韻を残す。
  // anticipation: 振り始めに、振る方向と逆へ少しだけ余分に引く。
  const wu = phase === 'windup' ? easeInOut(phaseT) : 1;
  const follow = phase === 'follow' || phase === 'recover' ? phaseT : 0;
  const dirS = Math.sign(m.to - m.from) || 1;
  const anticDip = phase === 'windup'
    ? -dirS * (m.antic || 0) * (m.halfArc || 0) * Math.sin(wu * Math.PI) : 0;
  let angleRel;
  if (m.sig === 'iai-flash') {
    // 居合: 抜いたら、振り抜けで鞘へ戻る方向へ引く (行きっぱなしにしない)。
    angleRel = phase === 'windup' ? lerp(m.rest, m.from, wu)
      : phase === 'strike' ? lerp(m.from, m.to, swing)
        : phase === 'follow' ? lerp(m.to, m.from * 0.88, easeOut(phaseT))
          : lerp(m.from * 0.88, m.rest, phaseT);
  } else {
    angleRel = phase === 'windup'
      ? lerp(m.rest, m.from, wu)
      : phase === 'strike'
        ? lerp(m.from, m.to, swing)
        : phase === 'follow'
          ? lerp(m.to, m.to + (m.to - m.from) * 0.12, follow)
          : lerp(m.to + (m.to - m.from) * 0.12, m.rest, phaseT);
  }
  if (phase === 'windup') angleRel += anticDip;
  // 鋸: 打撃〜振り抜けで押し引きの往復を重ねる。等速の往復が「挽く」動きになる。
  let sawQ = 0;
  if (m.strokes > 0 && (phase === 'strike' || phase === 'follow')) {
    sawQ = clamp((t - w) / Math.max(1e-3, f - w), 0, 1);
    angleRel += Math.sin(sawQ * m.strokes * Math.PI * 2) * 0.13 * (m.halfArc || 0) * (1 - sawQ * 0.45);
  }
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

  // ── 武器種ごとの固有量 (すべて決定的・有限・扇の内側) ──
  // 残像: 打撃の少し前の角度を、薄く遅れて並べる。
  const ghosts = [];
  const gN = m.ghostsN || 0;
  if (gN > 0 && phase !== 'windup') {
    for (let k = 1; k <= gN; k++) {
      const lagPt = phase === 'strike' ? clamp(phaseT - k * 0.16, 0, 1) : 1;
      let gRel = lerp(m.from, m.to, swingCurve(m, lagPt)) + bow;
      if (half > 0) gRel = clamp(gRel, -half, half);
      const gAlpha = (1 - k / (gN + 1)) * (phase === 'strike' ? 0.5 : 0.5 * (1 - phaseT * 0.7));
      ghosts.push({ rel: gRel, alpha: clamp(gAlpha, 0, 1) });
    }
  }
  // 打撃の速さ (速度線の長さに使う)。打撃局面での swing の傾き。
  const speed = phase === 'strike'
    ? clamp((swingCurve(m, phaseT) - swingCurve(m, Math.max(0, phaseT - 0.1))) / 0.1, 0, 4) : 0;
  // 連続動作 (針の連続突き・拳の連打・爪の時間差)。各発の進み具合。
  const pulseN = m.pulses || (m.sig === 'claw-stagger' ? (m.passes || 3) : 0);
  const pulses = [];
  for (let k = 0; k < pulseN; k++) {
    const stag = m.sig === 'claw-stagger' ? (m.stagger || 0.16) * k : k * 0.22;
    const raw = phase === 'windup' ? 0
      : phase === 'strike' ? clamp(phaseT * 1.6 - stag, 0, 1) : 1;
    pulses.push(easeSnap(raw));
  }
  // 鋏の開き (open) と牙の顎 (jaw)。どちらも 0=閉 / 1=開。
  let open = 0;
  if (m.sig === 'snip-two-stage') {
    if (phase === 'windup') open = lerp(0.3, 1, wu);
    else if (phase === 'strike') {
      const sa = m.snapAt || 0.45;
      open = phaseT < sa ? 1 - 0.62 * easeOut(phaseT / sa)
        : phaseT < sa + 0.18 ? 0.38
          : 1 - (0.62 + 0.38 * easeOut(clamp((phaseT - sa - 0.18) / Math.max(1e-3, 1 - sa - 0.18), 0, 1)));
    } else open = phase === 'follow' ? 0.04 : lerp(0.04, 0.3, phaseT);
  }
  let jaw = 0;
  if (m.sig === 'bite-snap') {
    jaw = phase === 'windup' ? lerp(0.2, 1, wu)
      : phase === 'strike' ? 1 - easeSnap(phaseT)
        : phase === 'follow' ? 0.03 : lerp(0.03, 0.2, phaseT);
  }
  // 詠唱サークルの広がり (杖・玉) と、銃の反動、鞭先の弾け。
  const circleK = phase === 'windup' ? wu : phase === 'strike' ? 1 : 1 - phaseT * 0.6;
  const recoilK = (m.recoil || 0) * impact;
  const crack = m.sig === 'whip-crack' && phase !== 'windup'
    ? clamp((swing - 0.82) / 0.18, 0, 1) * (phase === 'strike' ? 1 : 1 - phaseT) : 0;

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
    held, ghosts, speed, pulses, open, jaw, circleK, recoilK, crack, sawQ,
    sig: m.sig || '',
  };
}

/** 三日月の既定の形 (cres を持たないプロファイル用)。 */
export const DEFAULT_CRES = { len: 0.95, thick: 0.12, spin: 0.3, trail: 2 };

/**
 * 飛ぶ三日月の幾何。pose.fly (0=手元 → 1=間合いの外周) から、
 * 三日月の中心距離 d・半径 R・広がり span・厚み thick・回転 rot を決める。
 * **不変条件**: 中心距離 + 半径は間合い (m.reach) を超えず、先端の角度は
 * 扇 (m.arc) の内側に収まる。描画 (render.js) とテストが同じ値を共有する
 * 純粋関数で、当たり判定には一切触らない (判定は従来の扇のまま)。
 * @param {object} m startWeaponMotion の戻り値
 * @param {object} pose motionPose の戻り値 (fly を持つもの)
 * @returns {{d:number, R:number, span:number, thick:number, rot:number, fly:number}}
 */
export function crescentGeom(m, pose) {
  const cres = (m && m.cres) || DEFAULT_CRES;
  const reach = Math.max(1, (m && m.reach) || 1);
  const arc = (m && m.arc > 0.02) ? m.arc : 1.8;
  const half = arc / 2;
  const fly = clamp(pose && Number.isFinite(pose.fly) ? pose.fly : 1, 0, 1);
  // 飛ぶほど大きくなる。届いた瞬間、中心 + 半径 = 間合い ちょうどに重なる。
  const R = reach * 0.30 * cres.len * (0.45 + 0.55 * fly);
  const d = Math.max(0, (reach - R) * fly);
  // 回転ぶんを差し引いて、先端が扇の外へ出ない広がりに丸める。
  const dir = Math.sign(((m && m.to) || 0) - ((m && m.from) || 0)) || 1;
  const rot = dir * cres.spin * (fly - 0.45) * 0.7;
  const maxTip = Math.max(0.05, half * 0.94 - Math.abs(rot));
  let span = Math.min(2.5, Math.max(0.4, arc * 0.85 * cres.len));
  const tip = Math.atan2(R * Math.sin(span / 2), d + R * Math.cos(span / 2));
  if (tip > maxTip && tip > 0) span *= maxTip / tip;
  const thick = reach * cres.thick * (0.5 + 0.5 * fly);
  return { d, R, span, thick, rot, fly };
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
    sig: base?.sig || base?.style || 'arc',
    curve: base?.curve || 'expo',
    variants: base?.variants.length || 0,
  };
}

export { wrapAngle };
