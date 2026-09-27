// ============================================================================
// ワードローグ — 接続詞
//
// 接続詞は「直前の語」に結合する。結合すると 1 つの合成語になる。
//   例 「律」+「スル」 -> 律スル
//
// 規則は 2 つ。
//
// 1. 同じ接続詞は 1 文に 1 回まで。
//      NG 「風ノ海ノ銃」 … ノが 2 回出ている。
//
// 2. 接続詞には優先順位があり、下位の接続詞は上位の接続詞より前に置けない。
//      NG 「雷ノ浸食サレタ剣」 … ノ (下位) が サレタ (上位) より先。
//      OK 「浸食サレタ雷ノ剣」 … サレタ (上位) が ノ (下位) より先。
//
// 結合元にない接続詞は宙に浮く (どの語とも結合せず、効果だけを少し得る)。
// 「無双」は接続詞を使えない語なので「思考セシ天下無双ノ剣」の ノは宙に浮く。
// ============================================================================

/**
 * 接続詞と、その優先順位。
 *   pri 1 … 述語・受身。文を閉じるので最上位。
 *   pri 2 … 説明。
 *   pri 3 … 格。語を修飾するので最下位。
 * 数が小さいほど優先順位が高い。文は昇順出现在해야 成立する。
 */
export const CONNECTORS = {
  // pri 1 … 述語・受身
  サレタ: { pri: 1, desc: '受身・状態。「〜された」', fx: { dmg: 2 } },
  ワレタ: { pri: 1, desc: '受身。「〜われた」', fx: { dmg: 2, armor: 0.02 } },

  // pri 2 … 説明
  スル:   { pri: 2, desc: '説明。「〜する」', fx: { dmg: 3, rate: 0.15 } },
  セシ:   { pri: 2, desc: '説明。「〜し」', fx: { dmg: 3, rate: 0.1 } },

  // pri 3 … 格
  ノ:     { pri: 3, desc: '格。「〜の」', fx: { dmg: 1, size: 0.05 } },
  イ:     { pri: 3, desc: '接尾。「〜しい」', fx: { dmg: 2, crit: 0.01 } },
  ナ:     { pri: 3, desc: '断定。「〜だ」', fx: { dmg: 2, area: 4 } },
  ツ:     { pri: 3, desc: '接尾。「〜つ」', fx: { dmg: 2, rate: 0.1 } },
};

/**
 * 結合元。接続詞と組にして合成語になる語。
 * ここに無い語は結合できない (接続詞は宙に浮く)。
 * 値は接続詞 1 つか配列。「破壊」は「スル」でも「サレタ」でも結べる。
 */
export const CONNECT_SOURCES = {
  // スル
  爆発: 'スル', 貫通: 'スル', 分裂: 'スル', 回帰: 'スル',
  追尾: 'スル', 律: 'スル', 破壊: ['スル', 'サレタ'],

  // ノ
  海潮: 'ノ', 風: 'ノ', 雷: 'ノ', 炎: 'ノ', 流水: 'ノ', 潮流: 'ノ',
  地: 'ノ', 血: 'ノ', 死: 'ノ', 闇影: 'ノ', 光: 'ノ', 呪イ: 'ノ',
  黄金: 'ノ', 伝説: 'ノ',

  // イ  … 「呪イ」はもともと一語として辞書にあるので、ここには混ぜない。
  鋭利: 'イ', 堅固: 'イ', 剛硬: 'イ', 迅早: 'イ', 速: 'イ',

  // セシ
  呪縛: 'セシ', 回避: 'セシ', 思考: 'セシ', 自律: 'セシ',

  // サレタ
  浸食: 'サレタ', 改造: 'サレタ', 絆縛: 'サレタ', 催眠: 'サレタ',

  // ワレタ
  失落: 'ワレタ', 救: 'ワレタ',

  // ナ
  巨大: 'ナ', 荘厳: 'ナ', 鋭利: 'ナ',

  // ツ
  断続: 'ツ', 貫穿: 'ツ', 分裂: 'ツ',
};

/** 結合元を「接続詞 -> 結合できる語」に裏返す。 */
export const SOURCES_BY_CONNECTOR = (() => {
  const out = Object.create(null);
  for (const c of Object.keys(CONNECTORS)) out[c] = [];
  for (const [src, v] of Object.entries(CONNECT_SOURCES)) {
    for (const c of [].concat(v)) {
      if (out[c]) out[c].push(src);
    }
  }
  for (const c of Object.keys(out)) out[c].sort((a, b) => a.localeCompare(b, 'ja'));
  return out;
})();

/**
 * 接続詞の優先順 (優先順位の高い順)。
 * 文の判定とヒントの並びで使う。
 */
export const CONNECT_ORDER = Object.keys(CONNECTORS).sort(
  (a, b) => CONNECTORS[a].pri - CONNECTORS[b].pri || a.localeCompare(b, 'ja'),
);

/** 接続詞かどうか。 */
export function isConnector(text) {
  return Object.prototype.hasOwnProperty.call(CONNECTORS, text);
}

/** 接続詞の優先順位。接続詞でなければ null。 */
export function connectorPri(text) {
  const c = CONNECTORS[text];
  return c ? c.pri : null;
}

/** この語が使える接続詞 (結合先)。複数なら配列。 */
export function connectorFor(source) {
  const v = CONNECT_SOURCES[source];
  if (!v) return [];
  const list = [].concat(v).filter((c) => CONNECTORS[c]);
  return list;
}

/**
 * 分割結果に接続詞の規則を適用する。
 *
 * @param {string[]} segs 分割結果
 * @returns {{
 *   ok: boolean,
 *   reason: string,
 *   reasonText: string,
 *   compounds: Array<{text:string, source:string, connector:string, pri:number}>,
 *   floats: string[],
 *   used: string[],
 *   order: number[],
 * }}
 */
export function checkConnectors(segs) {
  const compounds = [];
  const floats = [];
  const used = [];
  const order = [];
  const seen = new Map();
  let prevPri = 0;
  let prevName = '';

  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (!isConnector(s)) continue;

    const { pri } = CONNECTORS[s];
    order.push(pri);

    // 規則 1 … 同じ接続詞は 1 回まで。
    const n = (seen.get(s) || 0) + 1;
    seen.set(s, n);
    if (n > 1) {
      return {
        ok: false,
        reason: 'dupconn',
        reasonText: `接続詞「${s}」を 2 回使っている。同じ接続詞は 1 文に 1 回まで。`,
        compounds, floats, used, order,
      };
    }

    // 規則 2 … 優先順位は昇順。降になったら脱落。
    if (pri < prevPri) {
      return {
        ok: false,
        reason: 'connorder',
        reasonText: `接続詞「${prevName}」の後に「${s}」は置けない。`
          + '上位の接続詞 (〜サレタ / 〜スル) を先に置くこと。',
        compounds, floats, used, order,
      };
    }
    prevPri = pri;
    prevName = s;

    // 直前の語と結合を試みる。直前が接続詞なら結べない。
    const src = segs[i - 1];
    const binds = src && !isConnector(src) && connectorFor(src).includes(s);
    if (binds) {
      compounds.push({ text: src + s, source: src, connector: s, pri });
      used.push(s);
    } else {
      // 結合先が無い。宙に浮くが、文の成立を妨げはしない。
      floats.push(s);
    }
  }

  return {
    ok: true,
    reason: '',
    reasonText: '',
    compounds,
    floats,
    used,
    order,
  };
}
