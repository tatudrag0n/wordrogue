// ============================================================================
// ワードローグ — 語辞書と「文の成立判定」
//
// ここがこのゲームの心臓。語を並べて連結した文字列が、
// 辞書で完全に分割できるときだけ「文が成立する」。
// 成立しなければその武器は無効化される。
//
//   「火」「の」「球」 -> 「火の球」 -> ['火','の','球'] -> 成立 (分节)
//   「火」「球」       -> 「火球」   -> ['火','球']    -> 成立 + 熟語(火球)
//   「火」「の」       -> 「火」     -> 1 語          -> 不成立 (文にならない)
//   「の」「は」       -> 「のは」   -> 助詞だけ      -> 不成立 (実質語が無い)
//   「あ」「い」       -> 「あい」   -> 分割不能      -> 不成立
// ============================================================================

import { RAW_TABLES } from './words.core.js';
import { CATEGORIES, ELEMENTS } from './words.core.js';
import { PHRASE_BONUS } from './words.phrase.js';

export { CATEGORIES, ELEMENTS, PHRASE_BONUS };

/** 単語 ID 採番用。 */
let wordUid = 0;

/** @type {Record<string, {text:string,cat:string,el:string|null,fx:Object,player:Object|null}>} */
export const WORDS = Object.create(null);

/** 分割判定に使う語の長さを用一个。 */
export const MAX_WORD_LEN = 5;

/** 二重定義された語。データ側のバグ検出用。 */
export const DUPLICATES = [];

const parseFx = (tokens) => {
  const fx = {};
  for (const t of tokens) {
    const m = /^([A-Za-z]+)([+-][\d.]+)$/.exec(t);
    if (!m) continue;
    const v = parseFloat(m[2]);
    fx[m[1]] = (fx[m[1]] || 0) + v;
  }
  return fx;
};

for (const table of RAW_TABLES) {
  for (const line of table.split('\n')) {
    const row = line.trim();
    if (!row) continue;
    const [text, cat, el, ...fx] = row.split(/\s+/);
    if (!text || !CATEGORIES[cat]) continue;

    // 同じ語が二重に定義されていた場合は初回定義を採用して記録。
    if (WORDS[text]) {
      DUPLICATES.push(text);
      continue;
    }

    const effects = parseFx(fx);
    WORDS[text] = {
      text,
      cat,
      el: el && el !== '-' ? el : null,
      fx: effects,
      player: cat === 'buff' ? effects : null,
    };
    wordUid++;
  }
}

/** 分割判定に使う語集合。文語 (助詞) も含める。 */
const DICT = new Set(Object.keys(WORDS));

/** 語袋から引ける語だけ (核語と助詞を除く)。 */
export const DRAWABLE = Object.keys(WORDS).filter((w) => {
  const c = WORDS[w].cat;
  return c === 'element' || c === 'form' || c === 'modifier' || c === 'buff';
});

/**
 * 語袋から引ける語。助詞 (文語) と助動詞も含む。
 * 助詞は「火の弾」のように文を読める形にするため必要。
 * 動詞は 1 枚で 1 つの動作になる。
 * 出る比重は種別ごとに少しずつ抑えてある。
 */
export const DRAWABLE_ALL = Object.keys(WORDS).filter((w) => {
  const c = WORDS[w].cat;
  return c === 'element' || c === 'form' || c === 'modifier' || c === 'buff'
    || c === 'grammar' || c === 'verb' || c === 'aux';
});


/** 助詞・文語。分割はするが、それだけでは文にならない。 */
export const PARTICLES = new Set(
  Object.keys(WORDS).filter((w) => WORDS[w].cat === 'grammar'),
);

/** 種別ごとの語配列。 */
export const WORDS_BY_CAT = {
  element: [], form: [], modifier: [], verb: [], buff: [],
  grammar: [], aux: [],
};
for (const w of Object.keys(WORDS)) WORDS_BY_CAT[WORDS[w].cat].push(w);

/** 語を「 Instances」として引くためのプロトタイプを缓存。 */
export function makeWord(text) {
  const base = WORDS[text];
  if (!base) throw new Error(`未知の語: ${text}`);
  return {
    uid: wordUid++,
    text: base.text,
    cat: base.cat,
    el: base.el,
    fx: base.fx,
    player: base.player,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 分节 (Segmentation) — 動的計画法で最長優先の分割を探す
// ─────────────────────────────────────────────────────────────────────────────

const segCache = new Map();

/**
 * 文字列を辞書で完全に分割する。
 * @param {string} s
 * @returns {string[]|null} 分割結果。不可なら null
 */
export function segment(s) {
  if (!s) return [];
  if (segCache.has(s)) return segCache.get(s);

  const n = s.length;
  // memo[i] = s.slice(i) の最短分割 (語数が少ないほうを採用)
  const memo = new Array(n + 1).fill(null);
  memo[n] = [];

  for (let i = n - 1; i >= 0; i--) {
    const lim = Math.min(MAX_WORD_LEN, n - i);
    for (let l = lim; l >= 1; l--) {
      const sub = s.slice(i, i + l);
      if (!DICT.has(sub)) continue;
      const rest = memo[i + l];
      if (!rest) continue;
      if (!memo[i] || rest.length + 1 < memo[i].length) memo[i] = [sub, ...rest];
    }
  }

  const out = memo[0];
  segCache.set(s, out);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 熟語の検出
//
// 文面は核語から始まる (例: 「力火球」)。そのため合成語は文面中の
// 部分列として探す。長いものから順に、部分文字列として現れたものを 1 つ採用する。
// ─────────────────────────────────────────────────────────────────────────────
const MAX_COMPOUND = Object.keys(PHRASE_BONUS).reduce((m, k) => Math.max(m, k.length), 2);

/**
 * 文面の中から最長の合成語を探す。
 * @param {string} text
 * @returns {{phrase:string,name:string,desc:string,fx:Object}|null}
 */
export function findCompound(text) {
  if (!text) return null;
  let best = null;
  for (let i = 0; i < text.length; i++) {
    for (let l = Math.min(MAX_COMPOUND, text.length - i); l >= 2; l--) {
      const sub = text.slice(i, i + l);
      const hit = PHRASE_BONUS[sub];
      if (hit) {
        if (!best || hit.phrase.length > best.phrase.length) best = hit;
        break;
      }
    }
  }
  return best;
}

// ─────────────────────────────────────────────────────────────────────────────
// 文の成立判定
// ─────────────────────────────────────────────────────────────────────────────

export const GRADES = {
  broken: { key: 'broken', name: '不成文', color: '#ff5470' },
  plain:  { key: 'plain',  name: '成立',   color: '#8ce99a' },
  idiom:  { key: 'idiom',  name: '名文',   color: '#ffd43b' },
  great:  { key: 'great',  name: '絶句',   color: '#ff9f43' },
};

const REASONS = {
  empty:      '語が置かれていない',
  onelexeme:  '実質語が 1 つだけ。文になっていない',
  unseg:      '辞書にある語に分割できない',
  noparticle: '助詞だけの羅列。実質語が要る',
};

/**
 * 語の配列を評価して、文として成立するか判定し、効果を合算する。
 * @param {Array<{text:string}>} words
 * @returns {{
 *   valid:boolean, reason:string, reasonText:string, text:string,
 *   segments:string[], content:number, grade:string, gradeInfo:Object,
 *   element:string, fx:Object, idiom:Object|null, bonusWords:number
 * }}
 */
export function evaluate(words) {
  const texts = (words || []).map((w) => w.text);
  const joined = texts.join('');

  const base = {
    text: joined,
    segments: [],
    content: 0,
    verbs: 0,
    aux: 0,
    predicated: false,
    element: 'none',
    fx: {},
    idiom: null,
    bonusWords: 0,
  };

  if (!texts.length) {
    return { ...base, valid: false, reason: 'empty', reasonText: REASONS.empty, grade: 'broken', gradeInfo: GRADES.broken };
  }

  const segs = segment(joined);
  if (!segs) {
    return { ...base, valid: false, reason: 'unseg', reasonText: REASONS.unseg, grade: 'broken', gradeInfo: GRADES.broken };
  }
  // 分割結果から実効語 (助詞でも助動詞でもない語) を数えながら効果を集計する。
  let content = 0;
  let verbs = 0;
  let aux = 0;
  const elWeight = Object.create(null);
  const fx = Object.create(null);

  for (const s of segs) {
    const w = WORDS[s];
    if (!w) continue;
    // 助詞と助動詞は文の骨組みであって、実効語ではない。
    const filler = PARTICLES.has(s) || w.cat === 'aux';
    if (!filler) content++;
    if (w.cat === 'verb') verbs++;
    if (w.cat === 'aux') aux++;
    if (w.el) elWeight[w.el] = (elWeight[w.el] || 0) + 1;
    for (const [k, v] of Object.entries(w.fx)) {
      fx[k] = (fx[k] || 0) + v;
    }
  }

  // 成立条件: 実効語 (助詞でない語) が 2 つ以上あること。
  //   助詞だけの羅列    …「のはが」   -> noparticle
  //   実質語が 1 つだけ …「火の」     -> onelexeme
  // 「火の球」「火球」は実質語が 2 つなので成立する。
  if (content < 2) {
    return {
      ...base, segments: segs, content, valid: false,
      reason: content === 0 ? 'noparticle' : 'onelexeme',
      reasonText: content === 0 ? REASONS.noparticle : REASONS.onelexeme,
      grade: 'broken', gradeInfo: GRADES.broken,
    };
  }

  // 属性は重みの最大のものを採用。すべて重み 1 なので立ち上がり数で決まる。
  let element = 'none';
  let best = 0;
  for (const [k, v] of Object.entries(elWeight)) {
    if (v > best) { best = v; element = k; }
  }

  // 熟語 (合成語) ボーナス。文面中の部分列として探す。
  const idiom = findCompound(joined);
  if (idiom) {
    for (const [k, v] of Object.entries(idiom.fx)) {
      fx[k] = (fx[k] || 0) + v;
    }
  }

  // 文の構造に応じた「文の力」。
  //   実質語 1 つに 8%
  //   助詞   1 つに 5%
  //   動詞   1 つに 4%  (動作を表している)
  //   述語 (助動詞「する」) があれば 10%。文の骨組みがそろっている。
  //   熟語に 15%
  // 長い・読みやすい・述語のある文ほど強くなる。
  const bonusWords = Math.max(0, content - 1);
  const particles = segs.length - content - aux;
  const predicated = aux > 0;
  fx.power = 1
    + bonusWords * 0.08
    + particles * 0.05
    + verbs * 0.04
    + (predicated ? 0.10 : 0)
    + (idiom ? 0.15 : 0);

  // 評価。述語つきは最低でも「名文」相当にする。
  let grade = 'plain';
  if (idiom && (content >= 4 || predicated)) grade = 'great';
  else if (idiom || content >= 4 || predicated) grade = 'idiom';

  return {
    valid: true,
    reason: '',
    reasonText: '',
    text: joined,
    segments: segs,
    content,
    verbs,
    aux,
    predicated,
    grade,
    gradeInfo: GRADES[grade],
    element,
    fx,
    idiom,
    bonusWords,
  };
}

/**
 * 手持ちの語だけで作れる熟語を列挙する。言葉鍛冶のヒントに使う。
 * @param {Iterable<string>} available 手元の語
 * @param {number} limit
 * @returns {Array<{phrase:string,name:string,desc:string,fx:Object,needs:string[]}>}
 */
export function possibleCompounds(available, limit = 16) {
  const avail = available instanceof Set ? available : new Set(available);
  const out = [];
  for (const key of Object.keys(PHRASE_BONUS)) {
    const segs = segment(key);
    if (!segs) continue;
    if (!segs.every((w) => avail.has(w))) continue;
    out.push({ ...PHRASE_BONUS[key], phrase: key, needs: segs });
  }
  // 語数が多い熟語ほど到達が面倒なので先に出す。
  out.sort((a, b) => b.needs.length - a.needs.length || b.phrase.length - a.phrase.length);
  return out.slice(0, limit);
}

/**
 * 語袋から重み付き抽選で語を引く。
 * 助詞も引けるが、比重は少し下げてある。
 */
export function drawWord(rng, opts = {}) {
  const cat = opts.cat;
  const pool = cat ? WORDS_BY_CAT[cat] : DRAWABLE_ALL;
  if (!pool || !pool.length) return null;

  // 重み付き抽選。種別ごとの重みを読む。
  const weights = pool.map((w) => {
    const c = CATEGORIES[WORDS[w].cat];
    const base = c ? c.weight : 10;
    return WORDS[w].cat === 'grammar' ? base * 2.5 : base;
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return makeWord(pool[i]);
  }
  return makeWord(pool[pool.length - 1]);
}

/** 文の成立・不成文の判定結果を文章化する (ログ用)。 */
export function describePhrase(evalResult) {
  if (!evalResult.valid) return `不成文 — ${evalResult.reasonText}`;
  const base = `${evalResult.gradeInfo.name}「${evalResult.text}」`;
  return evalResult.idiom ? `${base} — 熟語「${evalResult.idiom.name}」成立` : base;
}
