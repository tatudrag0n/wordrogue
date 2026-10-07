// テストが毎回同じ結果になるように、グローバルの Math.random を固定する。
//
// ESM の import は宣言順に評価されるので、このファイルを**いちばん先に**
// import すればCORE側 (js/core/util.js の rng) も同時に固定される。
// 敵のふらつき・会心・感電などの判定に乱数が混ざっているため、
// 固定しないと 1 ステージのクリア可否が実行ごとに変わる。

// mulberry32。シードはどれでもよい。
let s = 0x9e3779b9;
Math.random = function seededRandom() {
  s |= 0; s = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export const SEEDED = true;