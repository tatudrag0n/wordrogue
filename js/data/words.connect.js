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
//
// 熟語の接続詞:
//   接続詞の直前の語列 (接続詞を挟まずに続いた語) が熟語になっていて、
//   その熟語がプール (words.phrase.js の pool) を持つなら、熟語の形も付く。
//     発 電 する → 熟語「発電」+ する = 発電する (述語・連体)
//     電 する    → 「電」は名詞で する を持たない → 宙に浮く (不成立)
//   熟語の形と語の形の両方にあるときは熟語の形を使う (役割は熟語のもの)。
// ============================================================================

import {
  poolOfText, posOfText, WORD_POOLS, NOUN_POOL, COMPOUND_POOLS, MAX_COMPOUND_POOL_LEN,
  compoundPoolOf,
} from './words.pool.js';

export { NOUN_POOL, WORD_POOLS, COMPOUND_POOLS };

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
  for (const t of Object.keys(COMPOUND_POOLS)) for (const e of COMPOUND_POOLS[t].pool) add(e);
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

// ─────────────────────────────────────────────────────────────────────────────
// 熟語の接続詞
//
// run … 接続詞の直前に、接続詞を挟まずに続いた語のテキスト (古い順)。
//   「炎の発電する」なら する の run は ['発', '電']。
// run の末尾 (後ろ寄りの部分列) が熟語になっていれば、その熟語の形が付く。
// 長い熟語から先に見る。
// ─────────────────────────────────────────────────────────────────────────────

/**
 * run の末尾にできている熟語のうち、接続詞プールを持つものを長い順に。
 * @param {string[]} run
 * @returns {Array<{text:string, n:number, pool:ReadonlyArray<object>}>}
 *   n … 熟語を作っている語の数。
 */
export function compoundsEndingIn(run) {
  const out = [];
  if (!run || run.length < 2) return out;
  for (let n = run.length; n >= 2; n--) {
    const text = run.slice(run.length - n).join('');
    if (text.length > MAX_COMPOUND_POOL_LEN) continue;
    const pool = compoundPoolOf(text);
    if (pool) out.push({ text, n, pool });
  }
  return out;
}

/**
 * run の直後に接続詞 k を付けたときの形。熟語の形を先に見て、無ければ最後の語の形。
 * @param {string[]} run
 * @param {string} k
 * @returns {{source:string, n:number, form:object, compound:boolean}|null}
 */
export function formAfter(run, k) {
  if (!run || !run.length || !isConnector(k)) return null;
  for (const c of compoundsEndingIn(run)) {
    const form = c.pool.find((e) => e.k === k);
    if (form) return { source: c.text, n: c.n, form, compound: true };
  }
  const last = run[run.length - 1];
  const form = formOf({ text: last }, k);
  return form ? { source: last, n: 1, form, compound: false } : null;
}

/**
 * run の直後に置ける接続詞の一覧。熟語の形 (長い熟語から) → 最後の語のプールの順。
 * @param {string[]} run
 * @returns {string[]}
 */
export function connectorsAfter(run) {
  if (!run || !run.length) return [];
  const out = [];
  for (const c of compoundsEndingIn(run)) for (const e of c.pool) out.push(e.k);
  out.push(...connectorFor({ text: run[run.length - 1] }));
  return [...new Set(out)];
}

/**
 * この語の直後にこの接続詞を置けるか。プールにあるかどうかだけ。
 * @param {{text:string}|null} source 直前の語
 * @param {string} connector
 * @param {string[]} [before] source の前に接続詞を挟まずに続いた語 (熟語の判定用)。
 *   canConnect(電, 'する', ['発']) … 発電する → true / canConnect(電, 'する') → false
 */
export function canConnect(source, connector, before = []) {
  if (!source || !isConnector(connector)) return false;
  if (formOf(source, connector)) return true;
  return !!formAfter([...before, source.text], connector);
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

  // j の位置で終わる、接続詞を挟まない語の並び (熟語の判定用)。
  const runBefore = (j) => {
    const out = [];
    for (let t = j; t >= 0 && segs[t] && !isConnector(segs[t]) && out.length < 8; t--) out.unshift(segs[t]);
    return out;
  };
  // 位置 i の接続詞が結ぶ相手と形。熟語なら熟語ごと。
  //   → { src: 語の情報 (熟語なら熟語), e: 形, start: 結ぶ相手の先頭の位置, compound }
  const bindAt = (i) => {
    const s = segs[i];
    if (!s || !isConnector(s)) return null;
    const src = info(segs[i - 1]);
    if (!src) return null;
    const hit = formAfter(runBefore(i - 1), s);
    if (!hit) return null;
    if (!hit.compound) return { src, e: hit.form, start: i - 1, compound: false };
    return {
      src: { text: hit.source, pos: POS.noun, pool: compoundPoolOf(hit.source) },
      e: hit.form, start: i - hit.n, compound: true,
    };
  };
  // j から始まる語 (接続詞の直後に来る語) と、その語に付いた形。
  // j から始まる熟語に接続詞が付いていれば熟語ごと見る (炎の 爆 発 する 剣)。
  const headAt = (j) => {
    if (!segs[j] || isConnector(segs[j])) return { w: null, f: null };
    let c = j;
    while (c < segs.length && !isConnector(segs[c])) c++;
    if (c < segs.length && c > j + 1) {
      const b = bindAt(c);
      if (b && b.compound && b.start === j) return { w: b.src, f: b.e };
    }
    const w = info(segs[j]);
    const b = c === j + 1 ? bindAt(c) : null;
    return { w, f: b ? b.e : null };
  };

  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (!isConnector(s)) continue;

    // 1. 直前の語 (か、直前の語列でできた熟語) と結合する。
    //    プールに無ければ宙に浮く = 壊れた文。
    const prev = segs[i - 1];
    const bound = bindAt(i);
    const src = bound ? bound.src : info(prev);
    const e = bound ? bound.e : null;
    if (!e) {
      acc.floats.push(s);
      const who = src ? src.text : (prev ?? '(先頭)');
      const mine = src ? connectorsAfter(runBefore(i - 1)) : [];
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
      source: bound.compound ? src.text : prev, connector: s, pri: CONNECTORS[s].pri, pos: src.pos,
      role: e.role, next: e.next, pred: !!e.pred, adj: !!e.adj, idx: i,
      // 熟語に付いた形なら true。start は結んだ相手の先頭の位置。
      phrase: bound.compound, start: bound.start,
    });
    acc.used.push(s);

    // 次の語と、その語に付いた形。
    const { w: nw, f: nf } = headAt(i + 1);
    const next = nw ? nw.text : segs[i + 1];

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
