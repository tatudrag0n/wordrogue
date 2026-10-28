// ============================================================================
// ワードローグ — 語のランク
//
// 語はすべて **コモン** から始まる。言葉くじで同じ語をもう一度引くと
// 1 段ずつ上がり、その語の効果が伸びる。
//
//   コモン → アンコモン → レア → エピック → レジェンド
//    ×1.00     ×1.12        ×1.25   ×1.40      ×1.60
//
// 効果は語の fx (武器側) と player (体側) の両方に掛かる。掛ける場所は
// 2 か所だけにしている。
//   ・文の評価 (js/data/words.js の evaluate) … 武器の文と部位の文の力
//   ・部位の集計 (js/game/stats.js)          … 語そのものの効果
// 語のデータ (WORDS) は共通なので、セーブのランクは **ここに預ける**。
// セーブを読み書きするたびに setRanks() で入れ替える。
// ============================================================================

/** ランクの並び。index がそのまま段階。 */
export const RANKS = [
  { name: 'コモン',      short: 'C', mul: 1.00, color: '#6b7383' },
  { name: 'アンコモン',  short: 'U', mul: 1.12, color: '#12a58a' },
  { name: 'レア',        short: 'R', mul: 1.25, color: '#2f7fc4' },
  { name: 'エピック',    short: 'E', mul: 1.40, color: '#8b5cf6' },
  { name: 'レジェンド',  short: 'L', mul: 1.60, color: '#d9a406' },
];

/** 最大の段階 (レジェンド)。 */
export const RANK_MAX = RANKS.length - 1;

/** 語 → 段階。セーブから渡される。無ければ全員コモン。 */
let table = null;

/**
 * セーブのランク表を差し込む。値は段階 (0〜RANK_MAX)。
 * 範囲外や壊れた値は 0 に丸める。
 */
export function setRanks(map) {
  table = map && typeof map === 'object' && !Array.isArray(map) ? map : null;
}

/** 語の段階 (0 = コモン)。 */
export function rankIndex(text) {
  const n = table ? table[text] : 0;
  return Number.isInteger(n) ? Math.min(RANK_MAX, Math.max(0, n)) : 0;
}

/** 語のランク定義。 */
export function rankOf(text) {
  return RANKS[rankIndex(text)];
}

/** 語の効果に掛ける倍率。 */
export function rankMul(text) {
  return rankOf(text).mul;
}

/** 次のランク名。最上位なら null。 */
export function nextRankName(text) {
  const i = rankIndex(text);
  return i < RANK_MAX ? RANKS[i + 1].name : null;
}
