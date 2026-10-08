// ============================================================================
// ワードローグ — 接続詞 (語ごとの接続詞プール)
//
// 接続詞は「直前の語」に結合する。結合すると 1 つの合成語になる。
//   例 「斬」+「る」 -> 斬る / 「滑」+「らかな」 -> 滑らかな
//
// どの接続詞が付くかは **語ごとのプール** (words.pool.js) で決まる。
// 品詞の規則や例外表は持たない。語が持っている送り仮名だけが付く。
//   斬 … る・られた・り   → 斬された ✗ / 斬られた ✓
//   凍 … る・える          → 凍ける ✗ / 凍える ✓
//   名詞 … の・を・に・へ (NOUN_POOL)
//
// 文の判定は「選んだ形の役割」で見る。接続詞の文字列そのものでは見ない。
//   同じ「に」でも、焔に (格) と 妙に (連用) は役割が違う。
//   同じ「く」でも、速く (連用) と 貫く (連体・終止) は役割が違う。
//
// 文が壊れるのは次のときだけ。
//   1. 接続詞が直前の語に結べない (その語のプールに無い / 直前が接続詞・先頭)。
//        NG「斬された」「焔する」「焔の斬く」
//   2. 連体 (adn) と 格「の」 のあとは名詞句。連用の語や裸の動詞は来ない。
//        NG「斬る速く…」
//      (動詞が連体形で続く「斬る燃える刃」「焔の斬られた剣」は名詞句として認める)
//   3. 連用 (adv) のあとは動詞か形容。名詞は来ない。
//        NG「速く剣」「妙に剣」「急に焔」
//   4. 格「を」のあとは動作 (述語の形を持つ語)。「に」「へ」は動作か形容。
//        NG「焔を剣」
//
// 同じ接続詞を 2 回使うのは **不成立ではなく自然さの減点** にした。
//   「風の潮の銃」は日本語として読めるので成立する (少し弱い)。
// ============================================================================

import { poolOfText, posOfText, WORD_POOLS, NOUN_POOL } from './words.pool.js';

export { NOUN_POOL, WORD_POOLS };

/** 品詞。自然さの採点 (形容の連体・裸の形容) と末尾語の判定に使う。 */
export const POS = {
  noun: '体言',
  adj: '形容',
  naadj: '形動',
  verb: '用言',
};

/** 役割の表示名。 */
export const ROLE_LABEL = {
  adn: '連体',
  adv: '連用',
  case: '格',
};

// ─────────────────────────────────────────────────────────────────────────────
// 接続詞の効果
//
// 旧来の接続詞の効果はそのまま残す。新しい送り仮名は、役割と語尾から
// いちばん近い旧来の接続詞の効果を借りる (fxFor)。
// ─────────────────────────────────────────────────────────────────────────────

/** 旧来からある接続詞の効果と説明。 */
const LEGACY = {
  された: { desc: '受身。「〜された」', fx: { dmg: 2 } },
  われた: { desc: '受身。「〜われた」', fx: { dmg: 2, armor: 0.02 } },
  られた: { desc: '受身。「〜られた」', fx: { dmg: 2, rate: 0.1 } },
  る:     { desc: '連体・終止。「〜る」', fx: { dmg: 3, rate: 0.12 } },
  く:     { desc: '連用 (形容) / 連体 (動詞)。「〜く」', fx: { dmg: 3, crit: 0.02 } },
  な:     { desc: '連体。「〜な」', fx: { dmg: 2, area: 4 } },
  かな:   { desc: '連体。「〜かな」', fx: { dmg: 2, area: 4 } },
  い:     { desc: '連体。「〜い」', fx: { dmg: 2, crit: 0.01 } },
  する:   { desc: '述語。「〜する」', fx: { dmg: 3, rate: 0.15 } },
  む:     { desc: '連体・終止。「〜む」', fx: { dmg: 5, crit: 0.02 } },
  ける:   { desc: '連体・終止。「〜ける」', fx: { dmg: 4, pierce: 1 } },
  り:     { desc: '連用。「〜り」', fx: { dmg: 2, spread: 0.12 } },
  つ:     { desc: '連体・終止。「〜つ」', fx: { dmg: 2, rate: 0.1 } },
  の:     { desc: '格。「〜の」', fx: { dmg: 1, size: 0.05 } },
  に:     { desc: '格 / 連用。「〜に」', fx: { dmg: 1, homing: 0.1 } },
  を:     { desc: '格。「〜を」', fx: { dmg: 2, knock: 12 } },
  へ:     { desc: '方向。「〜へ」', fx: { dmg: 1, speed: 22 } },
};

/**
 * 新しい送り仮名の効果。いちばん近い旧来の接続詞から借りる。
 *   〜た (受身・完了)   → された
 *   格 (いの / いを)    → 語尾の格 (の / を / に)
 *   連用                → く
 *   形容の連体 〜な     → な   / それ以外の形容 → い
 *   動詞の連体          → る
 *   それ以外の連体      → な   (疾き・奇なる …)
 */
function fxFor(k, e) {
  if (LEGACY[k]) return LEGACY[k].fx;
  if (k.endsWith('た')) return LEGACY['された'].fx;
  if (e.role === 'case') return (LEGACY[k.slice(-1)] || LEGACY['の']).fx;
  if (e.role === 'adv') return LEGACY['く'].fx;
  if (e.adj) return (k.endsWith('な') ? LEGACY['な'] : LEGACY['い']).fx;
  if (e.pred) return LEGACY['る'].fx;
  return LEGACY['な'].fx;
}

const priOf = (e) => (e.role === 'case' ? 3 : e.role === 'adv' ? 2 : 1);

/**
 * 接続詞の一覧。全部の語のプールに出てくる送り仮名から作る。
 *   pri   … 並び順 (1 連体 / 2 連用 / 3 格)。判定には使わない。
 *   roles … この送り仮名がとる役割 (語によって違うことがある)。
 *   fx    … 合成したときに得る効果。
 */
export const CONNECTORS = (() => {
  const out = Object.create(null);
  const add = (e) => {
    if (!out[e.k]) {
      out[e.k] = {
        pri: priOf(e),
        desc: LEGACY[e.k]?.desc || `${ROLE_LABEL[e.role]}。「〜${e.k}」`,
        fx: fxFor(e.k, e),
        roles: new Set(),
      };
    }
    out[e.k].roles.add(e.role);
    if (priOf(e) < out[e.k].pri) out[e.k].pri = priOf(e);
  };
  for (const e of NOUN_POOL) add(e);
  for (const t of Object.keys(WORD_POOLS)) for (const e of WORD_POOLS[t].pool) add(e);
  return out;
})();

/** 接続詞の並び (表示用)。 */
export const CONNECT_ORDER = Object.keys(CONNECTORS).sort(
  (a, b) => CONNECTORS[a].pri - CONNECTORS[b].pri || a.length - b.length || a.localeCompare(b, 'ja'),
);

/** どれかの語で述語 (動詞の形) になる送り仮名。参考用。 */
export const PREDICATE_CONNECTORS = new Set(
  Object.values(WORD_POOLS).flatMap((p) => p.pool.filter((e) => e.pred).map((e) => e.k)),
);

/** どの語でも名詞を修飾しない送り仮名 (連用だけの形)。参考用。 */
export const NON_ADNOMINAL_CONNECTORS = new Set(
  Object.keys(CONNECTORS).filter((k) => [...CONNECTORS[k].roles].every((r) => r === 'adv')),
);

/** 接続詞かどうか。 */
export function isConnector(text) {
  return Object.prototype.hasOwnProperty.call(CONNECTORS, text);
}

/** 連体として使える語があるか (参考)。 */
export function isAdnominal(text) {
  const c = CONNECTORS[text];
  return !!(c && (c.roles.has('adn') || c.roles.has('case')));
}

/** 接続詞の並び順の値。接続詞でなければ null。 */
export function connectorPri(text) {
  const c = CONNECTORS[text];
  return c ? c.pri : null;
}

/**
 * 語の接続詞プール。
 * @param {{text:string, pool?:Array}|null} word
 */
export function poolOf(word) {
  if (!word || !word.text || isConnector(word.text)) return [];
  return word.pool || poolOfText(word.text);
}

/** 語のプールの中で、その送り仮名の項目。無ければ null。 */
export function formOf(word, k) {
  return poolOf(word).find((e) => e.k === k) || null;
}

/**
 * この語に結合できる接続詞の一覧 (プールの順)。
 * 言葉鍛冶の切り替え・一覧とテストで使う。
 */
export function connectorFor(word) {
  return poolOf(word).map((e) => e.k);
}

/**
 * この語の直後にこの接続詞を置けるか。プールにあるかどうかだけ。
 * @param {{text:string}|null} source 直前の語
 * @param {string} connector
 */
export function canConnect(source, connector) {
  if (!source || !isConnector(connector)) return false;
  return !!formOf(source, connector);
}

/** 語が動作 (述語の形) を持つか。「〜を」の受け先になれる。 */
export function isVerbal(word) {
  if (!word) return false;
  return word.pos === POS.verb || poolOf(word).some((e) => e.pred);
}

/** 語が形容 (形容の形) を持つか。 */
export function isAdjectival(word) {
  if (!word) return false;
  return word.pos === POS.adj || word.pos === POS.naadj || poolOf(word).some((e) => e.adj);
}

/**
 * 末尾語 (剣・銃・環 …) の直前に置いてよい語か。
 *
 * @param {string|null} lastText 末尾語の直前の語。接続詞ならその語。
 * @param {string|null} pos その品詞。接続詞なら null。
 * @param {boolean} isConn 接続詞かどうか。
 * @param {Set<string>} unmodifiable 末尾語を直接修飾できない語。
 * @param {boolean} [adn] 接続詞のとき、その場の役割が名詞を修飾できるか。
 * @returns {{ok:boolean, reason:string, reasonText:string}}
 */
export function checkTailModifier(lastText, pos, isConn, unmodifiable, adn) {
  if (!lastText) return { ok: true, reason: '', reasonText: '' };
  if (isConn) {
    if (adn) return { ok: true, reason: '', reasonText: '' };
    return {
      ok: false,
      reason: 'tailparticle',
      reasonText: `接続詞「${lastText}」は末尾語を修飾できない。`
        + '連用形 (〜く・〜に・〜り) の後ろに名詞は来ない。連体の形を選ぶこと。',
    };
  }
  if (pos === POS.verb) {
    return {
      ok: false,
      reason: 'tailverb',
      reasonText: `「${lastText}」は動詞。末尾語を直接修飾できない。`
        + '動詞のあとは連体の形 (〜る・〜られた など) を置くこと。',
    };
  }
  if (unmodifiable && unmodifiable.has(lastText)) {
    return {
      ok: false,
      reason: 'tailform',
      reasonText: `「${lastText}」は形を表す語。末尾語を直接修飾できない。`
        + '「刃剣」のような重複は日本語に無い。属性や効果の語を挟むこと。',
    };
  }
  return { ok: true, reason: '', reasonText: '' };
}

const fail = (reason, reasonText, acc) => ({
  ok: false, reason, reasonText,
  compounds: acc.compounds, floats: acc.floats, used: acc.used, order: acc.order, dups: acc.dups,
});

/**
 * 分割結果に接続詞の規則を適用する。
 *
 * @param {string[]} segs 分割結果
 * @param {Record<string, {pos?:string, cat?:string, pool?:Array}>} [dict] 語の情報
 * @returns {{
 *   ok: boolean, reason: string, reasonText: string,
 *   compounds: Array<{text:string, source:string, connector:string, pri:number, pos:string,
 *     role:string, next?:string, pred:boolean, adj:boolean, idx:number}>,
 *   floats: string[], used: string[], order: number[], dups: string[],
 * }}
 */
export function checkConnectors(segs, dict) {
  const acc = { compounds: [], floats: [], used: [], order: [], dups: [] };
  const seen = new Map();
  const info = (s) => (s && !isConnector(s) ? { text: s, ...(dict?.[s] || {}), pos: dict?.[s]?.pos || posOfText(s) } : null);

  // 各位置の語に付いた形 (次の位置が接続詞なら、その項目)。
  const formAt = (i) => {
    const w = info(segs[i]);
    const c = segs[i + 1];
    if (!w || !c || !isConnector(c)) return null;
    return formOf(w, c);
  };

  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (!isConnector(s)) continue;

    // 1. 直前の語と結合する。プールに無ければ宙に浮く = 壊れた文。
    const prev = segs[i - 1];
    const src = info(prev);
    const e = src ? formOf(src, s) : null;
    if (!e) {
      acc.floats.push(s);
      const who = src ? src.text : (prev ?? '(先頭)');
      const mine = src ? connectorFor(src) : [];
      return fail('floatconn',
        `接続詞「${s}」が直前の「${who}」に結べない。`
        + (mine.length ? `「${who}」に付くのは ${mine.join('・')}。` : '接続詞は語のあとにだけ付く。'),
        acc);
    }

    const n = (seen.get(s) || 0) + 1;
    seen.set(s, n);
    if (n > 1) acc.dups.push(s);

    acc.order.push(CONNECTORS[s].pri);
    acc.compounds.push({
      text: src.text + s,
      source: prev, connector: s, pri: CONNECTORS[s].pri, pos: src.pos,
      role: e.role, next: e.next, pred: !!e.pred, adj: !!e.adj, idx: i,
    });
    acc.used.push(s);

    // 次の語と、その語に付いた形。
    const next = segs[i + 1];
    const nw = info(next);
    const nf = nw ? formAt(i + 1) : null;

    // 2. 連体と「の」のあとは名詞句。
    if (e.role === 'adn' || (e.role === 'case' && e.next === 'noun')) {
      if (nw && ((nw.pos === POS.verb && !nf) || (nf && nf.role === 'adv'))) {
        return fail('connnoun',
          `「${src.text}${s}」のあとに「${next}${nf ? nf.k : ''}」は置けない。`
          + '連体の形や「の」のあとは名詞 (か連体の形) が来る。',
          acc);
      }
    }

    // 3. 連用のあとは動詞か形容。名詞は来ない。
    if (e.role === 'adv') {
      const okNext = nw && (isVerbal(nw) || isAdjectival(nw))
        && (!nf || nf.pred || nf.adj || nf.role === 'adv');
      if (nw && !okNext) {
        return fail('connnoun',
          `連用形「${src.text}${s}」のあとに名詞「${next}」は置けない。`
          + '連用形は動詞か形容を修飾する。名詞の前は連体の形 (〜い・〜な・〜る) にすること。',
          acc);
      }
    }

    // 4. 「を」は動作、「に」「へ」は動作か形容が要る。
    if (e.role === 'case' && (e.next === 'verb' || e.next === 'pred')) {
      const wantAdj = e.next === 'pred';
      const capable = nw && (isVerbal(nw) || (wantAdj && isAdjectival(nw)));
      const formOk = !nf || nf.pred || nf.role === 'adv' || (wantAdj && nf.adj);
      if (!capable || !formOk) {
        return fail('noobject',
          `接続詞「${s}」のあとに${wantAdj ? '動作か形容' : '動作'}が無い。`
          + `「〜${s}」のあとには ${wantAdj ? '斬る・強い' : '斬る・燃える'} のような語が要る。`,
          acc);
      }
    }
  }

  return { ok: true, reason: '', reasonText: '', ...acc };
}
