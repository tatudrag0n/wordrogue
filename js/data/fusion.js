// ============================================================================
// ワードローグ — 属性融合 (エレメントフュージョン)
//
// 文に 2 つの異なる属性が入ったとき、その組み合わせが定義済みなら
// 攻撃の振る舞いそのものが「融合」したものに変わる。
//   火 + 水 = 蒸気 … 斬撃が当たった相手だけではなく、残った蒸気の雲の
//                     範囲にいる敵に継続的に効く。
//   雷 + 水 = 感電 … 濡れているので稲妻が広く跳ねる。
// 定義の無いペアは従来どおり、副属性は見た目の色ブレンドだけに使う。
//
// 融合は「型の変化 + 既存パワーの再配分」が原則。融合したからといって
// 総威力が跳ねないよう、主攻撃の威力を少し下げ、そのぶんを融合効果
// (場・爆発・連鎖) に回す。再配分は weapon.js の applyFusionStats と
// combat.js の applyFusion が分担する。
//
// 融合が発動するのは、主・副の両属性が文の中に実在するときだけ
// (手の部位の属性で主属性だけ付いた文では発動しない)。
// ============================================================================

/**
 * 融合の定義。キーは属性ペアを辞書順に並べた 'a+b'。
 *   name … 表示名 (武器の内訳・HUD に出す)
 *   desc … 辞書・内訳表示用の説明
 *   palette … 融合専用の 3 層パレット (芯 / 体 / 縁)。フィールドや粒の
 *              描画が elementPalette の代わりに使う。
 */
export const FUSIONS = {
  'fire+water': {
    id: 'steam', name: '蒸気',
    desc: '熱と水がぶつかり、白い蒸気の雲が残る。雲の中にいる敵は継続的に蒸され、弱い火傷を負う。',
    palette: { core: '#ffffff', mid: '#dceefb', outer: '#8fb0c9', color: '#cfe3f2' },
  },
  'fire+ice': {
    id: 'steamblast', name: '蒸気爆発',
    desc: '熱と冷気が衝突して一気に膨張する。攻撃の焦点で爆裂し、周囲を吹き飛ばす。',
    palette: { core: '#ffffff', mid: '#ffb26b', outer: '#5b8db8', color: '#f2b879' },
  },
  'thunder+water': {
    id: 'conduct', name: '感電',
    desc: '濡れた体は電気を通す。稲妻の跳躍が増え、感電が強くなる。連鎖しない攻撃でも小さな稲妻が跳ねる。',
    palette: { core: '#ffffff', mid: '#7fe7ff', outer: '#1864ab', color: '#4dc3ff' },
  },
  'fire+wind': {
    id: 'firestorm', name: '炎嵐',
    desc: '風が炎を運んで広げる。攻撃の焦点に炎の場が残り、燃焼が範囲へ伝わる。',
    palette: { core: '#fff1a8', mid: '#ffa94d', outer: '#c22500', color: '#fb8c2e' },
  },
  'ice+wind': {
    id: 'blizzard', name: '吹雪',
    desc: '冷気が風に乗って一帯を覆う。範囲に冷気の場が残り、中の敵を減速させる。',
    palette: { core: '#ffffff', mid: '#a5e8f5', outer: '#1595b8', color: '#8fd8e8' },
  },
  'earth+water': {
    id: 'mud', name: '泥',
    desc: '土が水を吸って泥になる。足を取る場が残り、敵の撃退は泥に飲まれて弱まる。',
    palette: { core: '#e6c9a8', mid: '#8a6f42', outer: '#5d4630', color: '#9a7b4f' },
  },
  'poison+water': {
    id: 'pollution', name: '汚染',
    desc: '毒が水に溶けて広がる。汚染された場が残り、中の敵を毒し続ける。',
    palette: { core: '#d8ffb0', mid: '#57ab5a', outer: '#1e6f5c', color: '#4fae62' },
  },
};

/** 融合 ID → 定義。 */
export const FUSION_BY_ID = Object.fromEntries(
  Object.values(FUSIONS).map((f) => [f.id, f]),
);

/** 融合 ID → パレット (描画用)。 */
export const FUSION_PALETTES = Object.fromEntries(
  Object.values(FUSIONS).map((f) => [f.id, f.palette]),
);

/**
 * 2 属性の融合を引く。順序は問わない (主・副どちらが先でも同じ融合)。
 * 定義が無いペア・同じ属性・無属性は null (= 従来の色ブレンドに落ちる)。
 * @param {string} a 主属性
 * @param {string} b 副属性
 * @returns {object|null} FUSIONS の値
 */
export function fusionOf(a, b) {
  if (!a || !b || a === 'none' || b === 'none' || a === b) return null;
  const key = [a, b].sort().join('+');
  return FUSIONS[key] || null;
}
