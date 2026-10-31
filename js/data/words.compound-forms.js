// ============================================================================
// ワードローグ — 熟語の固定活用 (接続詞プール)
//
// 熟語も 1 つの語として、**その熟語だけが持つ送り仮名** を決めておく。
// 末尾の漢字 1 字の活用を借りると、日本語に無い形ができてしまう。
//   反射 + る   -> 反射る  ✗ (「射」の る を借りていた)
//   約束 + される -> 約束される ✓ (熟語自身が持つ)
//
// 熟語の品詞は辞書 (JMdict) の見出しを基準にし、動作を表す名詞
// (サ変名詞) だけに活用を置く。名詞としての格助詞 (の・と・も・や・を・に…)
// は words.pool.js がすべての熟語へ一律で足すので、ここには書かない。
//
//   他動詞 … する / した / して / される / された / されて
//   自動詞 … する / した / して
//   形容動詞 … な / に
//
// 末尾の文字が動詞でも、熟語全体が名詞ならその活用は使わない。
// 例: 「反射」は 反 + 射 だが「反射る」にはならない。
//
// この一覧は言葉くじの抽選には出ない。鍛冶で語の右をタップしたときの
// 候補だけを決める。熟語を足したら、その熟語がサ変名詞・形容動詞なら
// ここにも 1 行足すこと (test/all.mjs が漏れを検査する)。
// ============================================================================

/** 他動詞のサ変熟語。目的語を取れ、受身 (〜される) も自然。 */
export const SURU_TRANSITIVE = new Set(`
  圧縮 威嚇 殴打 火葬 貫徹 軽減 結合 厳守 減少 減速 減反 根絶 殺菌
  射殺 銃殺 縮小 伸縮 打破 短縮 鍛錬 弾圧 吐露 突破 濃縮 爆撃 発掘
  風刺 防水 網羅 乱発 連結 連続 連打 連発 固執 融通 銃撃 防護 大破
  約束 破壊 攻撃 開放 追撃 損壊 焼失 激突
`.trim().split(/\s+/));

/** 自動詞のサ変熟語。受身にはしない (爆発された のような形を作らない)。 */
export const SURU_INTRANSITIVE = new Set(`
  引退 影響 会合 確執 感心 還流 気絶 急死 結晶 幻滅 減退 降雪 合流
  再会 再燃 再発 散会 散発 死亡 射精 終結 浸水 水死 衰退 精通 絶滅
  潜水 旋回 早退 遅刻 沈静 徹夜 冬眠 凍死 突貫 破滅 破裂 白熱 発芽
  発光 発泡 反響 反撃 反発 反乱 舞踏 矛盾 融合 流血 流通 流浪 連鎖
  連覇 急伸 続伸 長打 浮沈 紅潮 焼死 多発 散骨
  消滅 崩壊 壊滅 全滅 再生 攻防 損傷 炎上 衝突 崩落
`.trim().split(/\s+/));

/** 形容動詞として使える熟語。連体「〜な」と連用「〜に」を持つ。 */
export const NA_ADJECTIVE_COMPOUNDS = new Set(`
  華麗 神聖 暗黒 漆黒 静寂 迅速 正確 精巧 精密 巨大 強力 強烈
  深刻 深遠 壮大 壮絶 壮麗 端麗 明白 巧妙 賢明 厳密 厳重 厳正
  軽妙 温雅 温厚 温和 豪華 豪壮 剛強 剛力 強硬 強壮 強大 短気
  気軽 気長 気密 無精 素敵 適正 端正 清明 精鋭 絶大 絶妙 天真
  鈍感 鈍重 特大 冷静 冷徹
`.trim().split(/\s+/));

const SURU_T = 'する:adn* した:adn* して:adv* される:adn*p された:adn*p されて:adv*p';
const SURU_I = 'する:adn* した:adn* して:adv*';
const NA_ADJ = 'な:adn+ に:adv+';

/**
 * 熟語 -> 送り仮名の指定 (words.pool.js の書式)。
 * 手書きの words.phrase.js の pool が最優先。ここはその次に使う。
 */
export const COMPOUND_FORM_SPECS = Object.create(null);
for (const text of SURU_TRANSITIVE) COMPOUND_FORM_SPECS[text] = SURU_T;
for (const text of SURU_INTRANSITIVE) {
  if (!COMPOUND_FORM_SPECS[text]) COMPOUND_FORM_SPECS[text] = SURU_I;
}
for (const text of NA_ADJECTIVE_COMPOUNDS) {
  // サ変と形容動詞の両方を持つ熟語 (冷静・沈静など) は、動詞の形も残す。
  COMPOUND_FORM_SPECS[text] = [COMPOUND_FORM_SPECS[text], NA_ADJ].filter(Boolean).join(' ');
}

/** 熟語の送り仮名の指定。無ければ空文字。 */
export function compoundFormSpec(text) {
  return COMPOUND_FORM_SPECS[text] || '';
}
