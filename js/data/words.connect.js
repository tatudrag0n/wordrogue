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
//   3. 連用 (adv) は節の後方の動詞か形容に係る。名詞だけでは閉じない。
//        係り先が節の終わりまでに無ければ不成文。
//        NG「速く剣」「妙に剣」「急に焔」
//      目的語句や「の」句は越えられる (連用修飾は後方の述語に係る)。
//        OK「速く敵を斬る剣」「深く敵の剣を斬る剣」
//   4. 格「を」は同じ節の後方の他動詞で受ける。「に」「へ」は動作か形容。
//        あいだに 0 個以上の連用修飾語が入れる。
//        NG「焔を剣」 / OK「敵を深く斬る剣」「敵に深く刺す剣」
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
import { PHRASE_BONUS } from './words.phrase.js';
export { NOUN_POOL, WORD_POOLS, COMPOUND_POOLS };

/** 登録済み熟語の最長文字数。文の判定と同じ上限。 */
const MAX_COMPOUND = Object.keys(PHRASE_BONUS).reduce((m, k) => Math.max(m, k.length), 2);

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
  と:     { desc: '並列。「〜と」', fx: { count: 1, spread: 0.10 } },
  も:     { desc: '並列。「〜も」', fx: { count: 1, dmg: 1 } },
  や:     { desc: '列挙。「〜や」', fx: { count: 2, spread: 0.15 } },
  で:     { desc: '手段・場所。「〜で」', fx: { dmg: 2, area: 6 } },
  から:   { desc: '起点。「〜から」', fx: { range: 8, speed: 15 } },
  まで:   { desc: '到達。「〜まで」', fx: { range: 10, pierce: 1 } },
  より:   { desc: '比較。「〜より」', fx: { pierce: 2, crit: 0.02 } },
  が:     { desc: '主格。「〜が」', fx: { dmg: 1, crit: 0.02 } },
  は:     { desc: '主題。「〜は」', fx: { dmg: 1, rate: 0.05 } },
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
 * run の末尾にできている **登録済みの熟語すべて** (プールの有無を問わない)。
 * プールを持たない熟語でも、末尾 1 字の活用を借りてはいけない。
 *   「反射」は登録済みなので、末尾の「射」の る を借りた「反射る」は作らない。
 * @param {string[]} run
 * @returns {Array<{text:string, n:number, pool:ReadonlyArray<object>|null}>}
 */
export function registeredCompoundsEndingIn(run) {
  const out = [];
  if (!run || run.length < 2) return out;
  for (let n = run.length; n >= 2; n--) {
    const text = run.slice(run.length - n).join('');
    if (text.length > MAX_COMPOUND) continue;
    if (!PHRASE_BONUS[text]) continue;
    out.push({ text, n, pool: compoundPoolOf(text) });
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
  const compounds = registeredCompoundsEndingIn(run);
  if (compounds.length) {
    // 熟語自身の活用を先に探す (長い熟語から)。
    for (const c of compounds) {
      const form = c.pool && c.pool.find((e) => e.k === k);
      if (form) return { source: c.text, n: c.n, form, compound: true };
    }
    // 名詞としての格助詞は、どの熟語にも付く。係り先は熟語全体。
    const noun = NOUN_POOL.find((e) => e.k === k);
    if (noun) {
      const c = compounds[0];
      return { source: c.text, n: c.n, form: noun, compound: true };
    }
    // 熟語として登録されている以上、末尾 1 字の活用には戻らない。
    //   反射 + る / 約束 + す は熟語の形ではないので結べない。
    return null;
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
  const compounds = registeredCompoundsEndingIn(run);
  for (const c of compounds) {
    if (c.pool) for (const e of c.pool) out.push(e.k);
  }
  if (compounds.length) {
    // 熟語は名詞でもあるので、格助詞は必ず使える。ここで末尾 1 字の
    // 活用を足すと「反射る」のような候補が出てしまう。
    for (const e of NOUN_POOL) out.push(e.k);
  } else {
    out.push(...connectorFor({ text: run[run.length - 1] }));
  }
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
  // 直前の語列が熟語を作るなら、熟語のプールだけを見る。
  //   canConnect(約束, 'された')       -> true
  //   canConnect(射, 'る', ['反'])     -> false (反射る は熟語の形ではない)
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
 * 連体節の主体になれる語。ほとんどの語 (焔・風・剣) は物であって、
 * 他動詞の主体にはならない。神・魔のような人格的な語だけ許す。
 */
const ANIMATE_SUBJECT = new Set(['神', '魔', '魂', '霊', '賢', '己', '心', '影', '死', '冥', '覇']);

/** 主体を表す格。この格のあとに他動詞の形が来るときは、主体になれる語が要る。 */
const SUBJECT_CASES = new Set(['が', 'は']);

/**
 * 分割結果に接続詞の規則を適用する。
 *
 * 判定は「接続詞の直後の 1 語」ではなく、**節の終わりまで先読みする**。
 *   ・「〜を」は、後方の他動詞の述語まで係り先を探す。
 *     あいだには 0 個以上の連用修飾語 (深く・静かに・必ず…) が入れる。
 *   ・連用形は、目的語句を越えて後方の述語 (動詞・形容) に係れる。
 *   ・連用形が名詞に係ることはない。述語が見つからないまま節が終われば不成文。
 *
 * 係り先は語ではなく **語の単位** で数える。接続詞を挟まずに熟語になる
 * 語列 (発 + 電 + する) は 1 つの述語として扱う。
 *
 * @param {string[]} segs 分割結果
 * @param {Record<string, {pos?:string, cat?:string, pool?:Array}>} [dict] 語の情報
 * @returns {{
 *   ok: boolean, reason: string, reasonText: string,
 *   compounds: Array<{text:string, source:string, connector:string, pri:number, pos:string,
 *     role:string, next?:string, pred:boolean, adj:boolean, idx:number,
 *     start:number, phrase:boolean, resolved?:number}>,
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

  // 1. すべての接続詞が直前の語 (か、直前の語列でできた熟語) に結べること。
  //    プールに無ければ宙に浮く = 壊れた文。
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (!isConnector(s)) continue;
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

    // 同じ接続詞でも、動詞の連体 (貫く) と形容の連用 (強く) は別の使い方。
    // 重複として減点するのは、同じ使われ方のときだけ。
    const dupKey = `${s}|${e.pred ? 'pred' : 'mod'}`;
    const n = (seen.get(dupKey) || 0) + 1;
    seen.set(dupKey, n);
    if (n > 1) acc.dups.push(s);

    acc.order.push(CONNECTORS[s].pri);
    acc.compounds.push({
      text: src.text + s,
      source: bound.compound ? src.text : prev, connector: s, pri: CONNECTORS[s].pri, pos: src.pos,
      role: e.role, next: e.next, pred: !!e.pred, adj: !!e.adj, passive: !!e.passive, idx: i,
      // 熟語に付いた形なら true。start は結んだ相手の先頭の位置。
      phrase: bound.compound, start: bound.start,
    });
    acc.used.push(s);
  }

  const compByConn = new Map(acc.compounds.map((c) => [c.idx, c]));

  // 2. 語の単位。接続詞を挟まずに熟語になる語列は 1 語としてまとめる。
  //    units[k] = { start, end, text, word, form, connIdx, compound }
  const units = [];
  for (let i = 0; i < segs.length; i++) {
    if (isConnector(segs[i])) continue;
    let c = i + 1;
    while (c < segs.length && !isConnector(segs[c])) c++;
    if (c < segs.length) {
      const b = bindAt(c);
      if (b && b.compound && b.start === i) {
        units.push({
          start: i, end: c - 1, text: b.src.text, word: b.src,
          form: b.e, connIdx: c, compound: true,
        });
        i = c;                       // 熟語の内側の語は単位にしない
        continue;
      }
      // 登録済みの熟語 (滅亡・毒蝕弾…) の語列は 1 つの名詞として扱う。
      // 「焦がす滅亡の光」の 滅 を裸の動詞と見ないため。
      if (c > i + 1) {
        const runText = segs.slice(i, c).join('');
        if (PHRASE_BONUS[runText] && b && !b.compound && b.start === c - 1) {
          units.push({
            start: i, end: c - 1, text: runText,
            word: { text: runText, pos: POS.noun },
            form: b.e, connIdx: c, compound: false, phrase: true,
          });
          i = c - 1;
          continue;
        }
      }
    } else if (i < segs.length - 1) {
      const runText = segs.slice(i).join('');
      if (PHRASE_BONUS[runText]) {
        units.push({
          start: i, end: segs.length - 1, text: runText,
          word: { text: runText, pos: POS.noun },
          form: null, connIdx: -1, compound: false, phrase: true,
        });
        break;
      }
    }
    const own = (c === i + 1 && c < segs.length) ? bindAt(c) : null;
    units.push({
      start: i, end: i, text: segs[i], word: info(segs[i]),
      form: own && !own.compound && own.start === i ? own.e : null,
      connIdx: own && !own.compound && own.start === i ? c : -1,
      compound: false,
    });
  }

  // 単位の述語性。形の役割まで見る。
  //   深く (形容の連用)  … 連用修飾。述語ではない
  //   斬り (動詞の連用)  … 述語。ただし後ろの動詞へも続く
  //   斬る (動詞の連体) / 斬 (形なし・用言) … 述語
  //   静かな (形容の連体) … 述語 (形容)
  // 形の無い語は品詞で見る。光・発・志 のように動詞の形を持つ名詞でも、
  // 裸で置かれていれば名詞句の頭であって述語ではない。
  const predVerb = (u) => (u.form
    ? isVerbal(u.word) && (u.form.pred || (u.form.role === 'adv' && !u.form.adj))
    : u.word.pos === POS.verb);
  const predAdj = (u) => (u.form
    ? isAdjectival(u.word) && u.form.role === 'adn' && !!u.form.adj
    : u.word.pos === POS.adj || u.word.pos === POS.naadj);
  const advUnit = (u) => !!u.form && u.form.role === 'adv';
  const predUnit = (u) => predVerb(u) || predAdj(u);
  const nominal = (u) => !predUnit(u) && !advUnit(u);

  // 連用形が越えられる名詞句か。名詞の連なりが格 (の・を・に・へ) で
  // 閉じているときだけ、その句を目的語・主語として越えられる。
  //   「深く敵を斬る」   … 敵を (をで閉じる) → 越えられる
  //   「深く敵の剣を斬る」… 敵の + 剣を (をで閉じる) → 越えられる
  //   「深く剣」          … 剣 (格が無い) → 越えられない
  const nominalRunCaseClosed = (k) => {
    let j = k;
    let last = null;
    while (j < units.length && nominal(units[j])) { last = units[j]; j++; }
    return !!(last && last.form && last.form.role === 'case');
  };

  // 3. 連体と「の」のあとは名詞句。連用の語や裸の動詞は来ない。
  for (let k = 0; k < units.length; k++) {
    const u = units[k];
    const f = u.form;
    if (!f || !(f.role === 'adn' || (f.role === 'case' && f.next === 'noun'))) continue;
    const nx = units[k + 1];
    if (!nx) continue;
    if ((nx.word.pos === POS.verb && !nx.form) || (nx.form && nx.form.role === 'adv')) {
      return fail('connnoun',
        `「${u.text}${f.k}」のあとに「${nx.text}${nx.form ? nx.form.k : ''}」は置けない。`
        + '連体の形や「の」のあとは名詞 (か連体の形) が来る。',
        acc);
    }

    // 3b. 「〜の」の直後に他動詞の連体形が来るなら、前の語がその動作の
    //     主体でなければならない。「焔の斬る剣」は日本語に無い
    //     (焔は斬る主体になれない)。神・魔のような主体になれる語だけ許す。
    if (f.role === 'case' && f.next === 'noun' && nx.form
      && nx.form.pred && !nx.form.intr && !nx.form.passive && !u.compound
      && u.word && !ANIMATE_SUBJECT.has(u.word.text)) {
      return fail('subjectverb',
        `「${u.text}の」のあとに他動詞「${nx.text}${nx.form.k}」は置けない。`
        + `「${u.text}」は「${nx.text}」の主体になれない。`
        + `目的語なら「${u.text}を${nx.text}${nx.form.k}」の形にすること。`,
        acc);
    }
  }

  // 4. 係り先の先読み。
  //    保留した「を」「に/へ」「連用」を、後方の述語で解決する。
  //    節 (文) の終わりまでに解決しなければ不成文。
  const pendingObj = [];
  const pendingCase = [];
  const pendingAdv = [];
  const settle = (list, u) => {
    for (const p of list) if (p.comp) p.comp.resolved = u.start;
    list.length = 0;
  };
  const firstText = (list) => (list.length && list[0].comp ? list[0].comp.text : '');

  for (let k = 0; k < units.length; k++) {
    const u = units[k];
    const vp = predVerb(u);
    const ap = predAdj(u);

    // 「を」の受け先。最初に出会った動詞で決める。
    // 自動詞なら受けられない (焔を燃える剣 ✗)。
    if (pendingObj.length && vp) {
      if (u.form && u.form.intr) {
        return fail('intransitive',
          `「${firstText(pendingObj)}」の受け先が自動詞「${u.text}${u.form.k}」になっている。`
          + '「〜を」は他動詞の形 (燃やす・凍らす など) で受けること。',
          acc);
      }
      settle(pendingObj, u);
    }
    // 「に」「へ」「で」「から」「まで」「より」は動作か形容で受ける。
    // 「が」「は」は主体なので、人格の無い語 (炎・剣) を他動詞の主体にはできない。
    //   NG「炎が斬る剣」 / OK「炎が燃える剣」「神が斬る剣」
    if (pendingCase.length && (vp || ap)) {
      if (vp) {
        const bad = pendingCase.find((p) => p.subject && !p.animate
          && u.form && u.form.pred && !u.form.intr && !u.form.passive);
        if (bad) {
          return fail('subjectverb',
            `「${bad.unit.text}${bad.comp ? bad.comp.connector : ''}」のあとに他動詞「${u.text}${u.form.k}」は置けない。`
            + `「${bad.unit.text}」は「${u.text}${u.form.k}」の主体になれない。`
            + `目的語なら「${bad.unit.text}を${u.text}${u.form.k}」の形にすること。`,
            acc);
        }
      }
      settle(pendingCase, u);
    }
    // 連用形は動詞か形容で受ける。
    if (pendingAdv.length && (vp || ap)) settle(pendingAdv, u);

    if (advUnit(u)) {
      // 動詞の連用形 (斬り) は述語を兼ねたまま、次の動詞へ続く。
      pendingAdv.push({ comp: compByConn.get(u.connIdx) || null, unit: u });
      continue;
    }
    if (vp || ap) continue;

    // 名詞。保留した係り先を越えられるかを見る。
    if (pendingObj.length) {
      return fail('noobject',
        `「${firstText(pendingObj)}」の受け先になる他動詞が文の中に無い。`
        + '「〜を」のあとに、連用修飾を挟んで動詞を置くこと。'
        + '連用形は動詞か形容を修飾する。',
        acc);
    }
    if (pendingCase.length) {
      return fail('noobject',
        `「${firstText(pendingCase)}」の受け先になる動作か形容が文の中に無い。`
        + `「〜${segs[units[k].connIdx] || 'に'}」のあとに動詞か形容を置くこと。`,
        acc);
    }
    if (pendingAdv.length && !nominalRunCaseClosed(k)) {
      return fail('connnoun',
        `連用形「${firstText(pendingAdv)}」の係り先になる動詞・形容が文の中に無い。`
        + '連用形は名詞に係らない。名詞の前は連体の形 (〜い・〜な・〜る) にすること。',
        acc);
    }

    // 名詞句の格。ここから係り先の解決を保留する。
    if (u.form && u.form.role === 'case') {
      if (u.form.next === 'verb') {
        pendingObj.push({ comp: compByConn.get(u.connIdx) || null, unit: u });
      } else if (u.form.next === 'pred') {
        const comp = compByConn.get(u.connIdx) || null;
        pendingCase.push({
          comp, unit: u,
          subject: !!comp && SUBJECT_CASES.has(comp.connector),
          animate: ANIMATE_SUBJECT.has(u.text),
        });
      }
    }
  }

  // 節の終わりまで保留が残ったら不成文。
  if (pendingObj.length) {
    return fail('noobject',
      `「${firstText(pendingObj)}」の受け先になる他動詞が文の中に無い。`
      + '「〜を」のあとに、連用修飾を挟んで動詞を置くこと。',
      acc);
  }
  if (pendingCase.length) {
    return fail('noobject',
      `「${firstText(pendingCase)}」の受け先になる動作か形容が文の中に無い。`
      + '「〜に」「〜へ」のあとに動詞か形容を置くこと。',
      acc);
  }
  if (pendingAdv.length) {
    return fail('connnoun',
      `連用形「${firstText(pendingAdv)}」の係り先になる動詞・形容が文の中に無い。`
      + '連用形は名詞に係らない。名詞の前は連体の形 (〜い・〜な・〜る) にすること。',
      acc);
  }

  return { ok: true, reason: '', reasonText: '', ...acc };
}
