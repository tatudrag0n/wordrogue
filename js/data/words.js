// ============================================================================
// ワードローグ — 語辞書と「文の成立判定」
//
// ここがこのゲームの心臓。語を並べて連結した文字列が、
// 辞書で完全に分割できるときだけ「文が成立する」。
// 成立しなければその武器は無効化される。
//
//   「火」「の」「球」 -> 「火の球」 -> ['火','の','球'] -> 成立 (分节)
//   「火」「球」       -> 「火球」   -> ['火','球']    -> 成立 + 熟語(火球)
//   「火」             -> 「火」     -> 1 語          -> 不成立 (文にならない)
//   「の」             -> 「の」     -> 接続詞だけ    -> 不成立 (実質語が無い)
//   「爆裂」「する」   -> 「爆裂する」 -> 合成成立
//   「風」「の」「潮」「の」「銃」 -> のが 2 回 -> 成立 (自然さの減点)
// ============================================================================

import { RAW_TABLES, TAIL_UNMODIFIABLE } from './words.core.js';
import { CATEGORIES, ELEMENTS } from './words.core.js';
import { PHRASE_BONUS } from './words.phrase.js';
import {
  checkConnectors, checkTailModifier, CONNECTORS, CONNECT_ORDER, POS,
  PREDICATE_CONNECTORS, isAdnominal, isConnector,
} from './words.connect.js';
import { poolOfText, posOfText } from './words.pool.js';

export {
  CATEGORIES, ELEMENTS, PHRASE_BONUS, CONNECTORS, CONNECT_ORDER, POS,
  TAIL_UNMODIFIABLE, PREDICATE_CONNECTORS, isAdnominal, isConnector,
};

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
    // 品詞と接続詞プールは語ごとに words.pool.js で決める。
    WORDS[text] = {
      text,
      cat,
      el: el && el !== '-' ? el : null,
      fx: effects,
      player: cat === 'buff' ? effects : null,
      pos: posOfText(text),
      // この語の直後に付く送り仮名 (接続詞)。
      pool: poolOfText(text),
    };
    wordUid++;
  }
}

// 接続詞 (送り仮名) も分割のために辞書へ入れる。効果は CONNECTORS が正。
for (const k of CONNECT_ORDER) {
  if (WORDS[k]) { DUPLICATES.push(k); continue; }
  WORDS[k] = {
    text: k, cat: 'connect', el: null, fx: CONNECTORS[k].fx, player: null, pos: null, pool: [],
  };
}

/** い形容の語 (表示・検査用)。プールの品詞から作る。 */
export const ADJ_STEMS = new Set(Object.keys(WORDS).filter((w) => WORDS[w].pos === POS.adj));
/** な形容の語 (表示・検査用)。 */
export const NA_ADJ_STEMS = new Set(Object.keys(WORDS).filter((w) => WORDS[w].pos === POS.naadj));

/** 品詞。 */
export function posOf(text) { return WORDS[text]?.pos || null; }

/** 分割判定に使う語集合。 */
const DICT = new Set(Object.keys(WORDS));

/** 語にかな (平仮名・片仮名) が含まれるか。 */
const KANA_RE = /[ぁ-んァ-ヶー]/;
export function hasKana(text) { return KANA_RE.test(text); }

/**
 * 自身の文の末尾に固定で付く語。文面には必ず現れるので、
 * 語彙から引けてはいけない (「頑強人人」のような名前になる)。
 * 分割には語として必要なので、辞書からは消さない。
 */
const FIXED_TAIL = '人';

/**
 * 語彙から引ける語のカテゴリ。
 * 形態語 (剣・銃・環 …) は武器の末尾語だから引かない。
 * 接続詞は鍛冶の接続詞プールから無限に使えるので引かない。
 * 辞書には残す — 文の分割と末尾語の判定に使う。
 */
const isDrawableCat = (c) => c === 'element' || c === 'modifier'
  || c === 'buff' || c === 'verb';

/** 語彙から引ける語だけ (接続詞・動詞・形態語を除く)。 */
export const DRAWABLE = Object.keys(WORDS).filter((w) => {
  const c = WORDS[w].cat;
  return c !== 'connect' && c !== 'verb' && c !== 'form' && w !== FIXED_TAIL;
});

/**
 * 語彙から引ける語。動詞も含む。
 * 接続詞は鍛冶の接続詞プールから無限に使えるので引かない。
 * 動詞は 1 枚で 1 つの動作になる。形態語は末尾語なので入らない。
 * 出る比重は種別ごとに少しずつ抑えてある。
 */
export const DRAWABLE_ALL = Object.keys(WORDS).filter(
  (w) => w !== FIXED_TAIL && isDrawableCat(WORDS[w].cat),
);

/** 接続詞。分割はするが、それだけでは文にならない。 */
export const CONNECTOR_SET = new Set(
  Object.keys(WORDS).filter((w) => WORDS[w].cat === 'connect'),
);

/**
 * 接続詞の一覧。鍛冶の接続詞プールが無限に出す。
 * 接続詞は語彙から引かない — 文を編集するときにいつでも使える。
 */
export const CONNECTOR_LIST = CONNECT_ORDER.slice();

/**
 * 開始時に放进語彙する語。漢字だけで、短いもの。
 * 漢字だけの武器をリズムよく並べるための土台にする。
 */
export const SIMPLE_POOL = Object.keys(WORDS).filter((w) => {
  const c = WORDS[w].cat;
  if (w === FIXED_TAIL) return false;
  if (c !== 'element' && c !== 'modifier' && c !== 'buff') return false;
  return !KANA_RE.test(w) && w.length <= 2;
});

/** 種別ごとの語配列。 */
export const WORDS_BY_CAT = {
  element: [], form: [], modifier: [], verb: [], buff: [], connect: [],
};
for (const w of Object.keys(WORDS)) WORDS_BY_CAT[WORDS[w].cat].push(w);

/** 語を「インスタンス」として引くためのプロトタイプをキャッシュ。 */
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
// 文の組み立て
//
// 枠 (slots) には語だけが入る。接続詞は connects に入れて、
// connects[i] は slots[i] の直後 (つまり枠と枠のあいだ) に置かれる。
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 枠と接続詞から文の並び (evaluate に渡す配列) を作る。
 * @param {Array<object|null>} slots 枠。語だけ。
 * @param {Array<object|null>} connects 接続詞。connects[i] は slots[i] の直後。
 * @param {object|null} tailWord 末尾語。枠の外に固定で付く。
 * @returns {Array<object>}
 */
export function composeSegments(slots, connects, tailWord) {
  const out = [];
  const n = Math.max(slots.length, connects ? connects.length : 0);
  for (let i = 0; i < n; i++) {
    const w = slots[i];
    if (w) out.push(w);
    const c = connects && connects[i];
    if (c) out.push(c);
  }
  if (tailWord) out.push(tailWord);
  return out;
}

/** 文面 (結合した文字列)。末尾語も含める。 */
export function composeText(slots, connects, tailWord) {
  return composeSegments(slots, connects, tailWord).map((w) => w.text).join('');
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
  noparticle: '接続詞だけの羅列。実質語が要る',
  fewwords:   '実質語が足りない。語を足してください',
  tailverb:   '末尾語を動詞が直接修飾している',
  tailparticle: '格の接続詞の後に末尾語が来る',
  tailform:   '形を表す語が末尾語を直接修飾している',
  connorder:  '接続詞どうしが続いている',
  floatconn:  '接続詞が直前の語に結べない',
  connnoun:   '連用形の接続詞のあとに名詞が来ている',
  noobject:   '「〜を」のあとに動詞 (=目的語) が無い',
};

/**
 * 語の配列を評価して、文として成立するか判定し、効果を合算する。
 * @param {Array<{text:string}>} words
 * @param {{minContent?:number, tail?:string}} [opt]
 *   minContent … 実質語の最低数。既定は 2。
 *     武器は末尾語 (tail) を文に含めて評価するため、末尾語ぶん余分に要求する。
 *   tail … 末尾語のテキスト。渡すと末尾語の直前の語も日本語として正しいか見る。
 *     も判定する。武器と自身の称号は渡す。
 * @returns {{
 *   valid:boolean, reason:string, reasonText:string, text:string,
 *   segments:string[], content:number, grade:string, gradeInfo:Object,
 *   element:string, fx:Object, idiom:Object|null, phraseBonus:number, bonusWords:number
 * }}
 */
export function evaluate(words, opt = {}) {
  const minContent = opt.minContent || 2;
  const texts = (words || []).map((w) => w.text);
  const joined = texts.join('');

  const base = {
    text: joined,
    segments: [],
    content: 0,
    verbs: 0,
    predicated: false,
    element: 'none',
    fx: {},
    idiom: null,
    phraseBonus: 0,
    conn: null,
    compounds: [],
    bonusWords: 0,
    natural: 0,
    naturalParts: [],
  };

  if (!texts.length) {
    return { ...base, valid: false, reason: 'empty', reasonText: REASONS.empty, grade: 'broken', gradeInfo: GRADES.broken };
  }

  const segs = segment(joined);
  if (!segs) {
    return { ...base, valid: false, reason: 'unseg', reasonText: REASONS.unseg, grade: 'broken', gradeInfo: GRADES.broken };
  }
  // 分割結果から実効語 (接続詞でない語) を数えながら効果を集計する。
  let content = 0;
  let verbs = 0;
  const elWeight = Object.create(null);
  const fx = Object.create(null);

  for (const s of segs) {
    const w = WORDS[s];
    if (!w) continue;
    // 接続詞は文の骨組みであって、実効語ではない。
    const filler = w.cat === 'connect';
    if (!filler) content++;
    if (w.cat === 'verb') verbs++;
    if (w.el) elWeight[w.el] = (elWeight[w.el] || 0) + 1;
    for (const [k, v] of Object.entries(w.fx)) {
      fx[k] = (fx[k] || 0) + v;
    }
  }

  // 成立条件: 実効語 (接続詞でない語) が minContent 個以上あること。
  //   実質語が 1 つだけ …「火の」     -> onelexeme
  // 「火の球」「火球」は実質語が 2 つなので成立する。
  if (content < minContent) {
    return {
      ...base, segments: segs, content, valid: false,
      reason: content === 0 ? 'noparticle' : (content === 1 ? 'onelexeme' : 'fewwords'),
      reasonText: content === 0 ? '接続詞だけの羅列。実質語が要る'
        : (content === 1 ? REASONS.onelexeme : REASONS.fewwords),
      grade: 'broken', gradeInfo: GRADES.broken,
    };
  }

  // 接続詞の規則。語ごとのプールと、選んだ形の役割で見る。
  // 同じ接続詞 2 回は不成立ではなく、自然さの減点 (下)。
  const conn = checkConnectors(segs, WORDS);
  if (!conn.ok) {
    return {
      ...base, segments: segs, content, valid: false,
      reason: conn.reason, reasonText: conn.reasonText,
      conn,
      grade: 'broken', gradeInfo: GRADES.broken,
    };
  }

  // 接続詞の合成。束ねた 1 語として数える。
  //   「爆裂」+「する」 -> 爆裂する
  const compounds = conn.compounds;

  // 末尾語を日本語として正しく修飾できているか。
  //   「斬剣」「貫通を剣」… 用言や格助詞が直前にあるものは日本語に無い。
  //   「刃剣」… 形を表す語を 2 つ並べたものは無い。
  if (opt.tail && segs.length >= 2) {
    const last = segs[segs.length - 2];
    const isConn = CONNECTOR_SET.has(last);
    // 接続詞なら、その場の役割 (連体・格「の」) で名詞を修飾できるかを見る。
    const lastC = isConn ? compounds.find((c) => c.idx === segs.length - 2) : null;
    const adn = !!lastC && (lastC.role === 'adn' || (lastC.role === 'case' && lastC.next === 'noun'));
    const tail = checkTailModifier(
      last, isConn ? null : WORDS[last]?.pos, isConn, TAIL_UNMODIFIABLE, adn,
    );
    if (!tail.ok) {
      return {
        ...base, segments: segs, content, valid: false,
        reason: tail.reason, reasonText: tail.reasonText,
        conn, compounds,
        grade: 'broken', gradeInfo: GRADES.broken,
      };
    }

    // 末尾語に係っている「連体修飾句」の先頭も見る。
    //   「業火を斬られた刃剣」… された は名詞を修飾できるので通るが、
    //   その名詞句の頭が「刃」なので「刃剣」になる。日本語に無い。
    // 接続詞を挟んでも、末尾語に直続する語は形を表す語にできない。
    // 末尾語そのものは末尾語配列に含まれないので、探してその 1 つ前を見る。
    const tailIdx = segs.lastIndexOf(opt.tail);
    for (let i = tailIdx - 1; i >= 0; i--) {
      if (CONNECTOR_SET.has(segs[i])) continue;
      if (TAIL_UNMODIFIABLE.has(segs[i])) {
        return {
          ...base, segments: segs, content, valid: false,
          reason: 'tailform',
          reasonText: `末尾語に係った「${segs[i]}」の形が重複している。`
            + `「${segs[i]}${opt.tail}」は日本語に無い。`
            + '属性や効果の語を挟むこと。',
          conn, compounds,
          grade: 'broken', gradeInfo: GRADES.broken,
        };
      }
      break;
    }
  }

  const connFx = Object.create(null);
  for (const c of compounds) {
    // 束ねた分だけ、合成 1 つぶんとして数える。実質語数には影響させない。
    for (const [k, v] of Object.entries(CONNECTORS[c.connector].fx)) {
      connFx[k] = (connFx[k] || 0) + v;
    }
  }
  for (const [k, v] of Object.entries(connFx)) fx[k] = (fx[k] || 0) + v;

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

  // ───────────────────────────────────────────────────────────────────────
  // 自然さと完成度
  //
  // ここがこのゲームの中心。日本語として自然で、しかも文として完成している
  // ほど強くする。長いから強JEく、自然だから強く、完成しているから強くする。
  //
  //   属性で始まる   …「刃必殺剣」より「業火剛利剣」のほうが主題として自然
  //   格がある       …「〜の」で前修飾される
  //   連体がある     …形容の〜く・〜い・〜な
  //   述語がある     …用言がある / 「〜する」「〜された」で述語になる
  //   羅列・宙に浮く接続詞は，自然さを下げる
  // ───────────────────────────────────────────────────────────────────────
  const parts = [];
  const segWords = segs.map((s) => ({ s, info: WORDS[s] }));
  const contentSegs = segWords.filter((w) => w.info && w.info.cat !== 'connect');

  // ── 主題 ────────────────────────────────────────────────────────────────
  // 日本語の武器名は「属性 (青・炎・業火…) で始まるときに最も自然」。
  // 形や効果、動詞で始めると主題が立たない。
  const headCat = contentSegs.length ? contentSegs[0].info.cat : null;
  if (headCat === 'element') {
    parts.push({ key: 'topic', label: '属性で始まる', v: 1.2 });
  } else if (headCat === 'form') {
    parts.push({ key: 'topicform', label: '形で始まる', v: -0.8 });
  } else if (headCat === 'modifier') {
    parts.push({ key: 'topicmod', label: '効果で始まる', v: -0.3 });
  } else if (headCat === 'verb') {
    parts.push({ key: 'topicverb', label: '動詞で始まる', v: -0.4 });
  }
  // 実体語が 4 つ以上続けて並ぶと羅列になる。
  //   「業火剛利必殺吸血剣」… 修飾が重なると名詞の列であって文ではない。
  //   「業火の鋭く斬る剣」  … 係り結びがあるので羅列にならない。
  let runLen = 0;
  let worstRun = 0;
  for (const w of segWords) {
    if (!w.info) { runLen = 0; continue; }
    if (w.info.cat === 'connect') { runLen = 0; continue; }
    runLen++;
    if (runLen > worstRun) worstRun = runLen;
  }
  if (worstRun >= 4) {
    parts.push({ key: 'enumeration', label: `${worstRun} 語が羅列`, v: -0.45 * (worstRun - 3) });
  }
  // 同じ接続詞の 2 回目以降。不成立にはしないが、くどいので減点。
  //   「風の潮の銃」… 読めるが「の」の連続は少し重い。
  for (const d of conn.dups) {
    parts.push({ key: 'dupconn', label: `接続詞「${d}」の重複`, v: -0.4 });
  }
  // 格 (の・へ。「いの」のような名詞化 + の も含む)。
  const isGenitive = (c) => c.role === 'case' && (c.next === 'noun' || c.connector === 'へ');
  for (const c of compounds) {
    if (isGenitive(c)) {
      parts.push({ key: 'genitive', label: `格「〜${c.connector}」`, v: 0.55 });
    }
  }
  const compAt = new Map(compounds.map((c) => [c.idx, c]));
  // 格句と連体節が同じ語に係る並び。
  //   「火傷する毒の剣」… 「火傷する毒」の「剣」。連体節が先に来て、格がその名詞に付く。
  //   「毒の火傷する剣」… 「毒の」「火傷する剣」。格と「〜する」が同じ名詞に同時に付く。
  //                       日本語ではどちらかに係り損ねる。片方を内側に入れるので減点。
  // 「業火を斬られた剛硬な剣」のように述語が一文を閉じる並びは別物なので見ない。
  for (const c of compounds) {
    if (!isGenitive(c)) continue;
    const i = c.idx - 1;
    const next = segs[i + 2];
    const nc = segs[i + 3];
    // 「格 + 名詞 + 連体節 (する / る / された)」 の並びだけを見る。
    if (!next || !nc || !CONNECTOR_SET.has(nc)) continue;
    if (!compAt.get(i + 3)?.pred) continue;
    if (WORDS[next]?.pos !== POS.noun) continue;
    // 連体節が係る先。連体形だから、その直後の名詞に付く。
    const tailWord = opt.tail || segs[segs.length - 1];
    const bound = segs[i + 4] || tailWord;
    if (bound !== tailWord) continue;
    parts.push({
      key: 'overlap',
      label: `格句と連体節が末尾語に重なる (${segs.slice(i, i + 4).join('')})`,
      v: -0.5,
    });
  }
  // 連体。い形容詞の「〜い」(い) と な形容詞の「〜な」(な) はどちらも名詞を修飾する。
  // かな もな形容詞の連体形なので同じ加点。静かな刃 / 確かな刃。
  // 形容の形 (プールで + の印) のうち、名詞を修飾する連体だけ。
  for (const c of compounds) {
    if (c.adj && c.role === 'adn') {
      parts.push({ key: 'adjectival', label: `連体「${c.connector}」`, v: 0.5 });
    }
  }
  // 末尾語を直前に修飾しているか。
  //   「業火の剛利く剣」… 結合した連体が末尾語に係っている。
  //   「業火剛利な剣」… な形容詞の連体。「〜な」が末尾語に係っている。
  // 末尾語は文の途中ではないので、ここは末尾語そのものを見る。
  const tailPos = opt.tail ? segs.lastIndexOf(opt.tail) : segs.length;
  // 末尾語に係っている名詞句の頭。接続詞を飛ばした最初の実体語。
  //   業火 を 斬 る 静 な 剛硬 剣 → 剛硬
  let head = null;
  let headPos = -1;
  for (let i = tailPos - 1; i >= 0; i--) {
    if (CONNECTOR_SET.has(segs[i])) continue;
    head = segs[i];
    headPos = i;
    break;
  }
  const headInfo = head ? WORDS[head] : null;
  let compoundBindInfo = null;
  if (opt.tail && headInfo && !TAIL_UNMODIFIABLE.has(head)) {
    // 連体形（い・な・された・る）が直前にあれば、その接続詞が末尾語に係っている。
    const boundToTail = compounds.some((c) => c.idx === headPos + 1);
    compoundBindInfo = { bound: boundToTail };
    if (boundToTail || headInfo.cat !== 'form') {
      parts.push({ key: 'modifier', label: '末尾語を修飾', v: 0.6 });
    }
    // い形容詞・な形容詞は連体形でしか名詞を修飾しない。
    //   「業火剛利剣」  … 「剛利」が落のまま「剣」に付いている。
    //   「業火剛利な剣」… 「〜な」が「剣」に係っている。日本語として完成。
    if (!boundToTail
      && (headInfo.pos === POS.adj || headInfo.pos === POS.naadj)) {
      parts.push({
        key: 'bareadj',
        label: `形容「${head}」が連体形でない`,
        v: -0.6,
      });
    }
  }
  // 述語。用言そのものか、「〜する」「〜された」「〜る」。
  if (verbs) parts.push({ key: 'verb', label: '動作', v: 0.4 * Math.min(verbs, 2) });
  // 主語と述語が繋がって、一文として閉じているか。
  //   「業火を斬る剣」… 動詞があって述語 (〜る / 〜された) がそろう。
  //   「業火剛利剣」   … 用言が無いので述語にならない。
  let hasPredicate = false;
  for (const c of compounds) {
    if (c.pred) {
      parts.push({ key: 'predicated', label: `述語「〜${c.connector}」`, v: 0.6 });
      hasPredicate = true;
    }
  }
  // 目的語。格助詞「〜を」のあとに動詞が来ていれば、一文として閉じている。
  //   「業火を斬る剣」… これが日本語の完全な一節。
  for (const c of compounds) {
    if (!(c.role === 'case' && c.next === 'verb')) continue;
    const next = segs[c.idx + 1];
    if (next && WORDS[next] && (WORDS[next].cat === 'verb' || compAt.get(c.idx + 2)?.pred)) {
      parts.push({ key: 'object', label: '目的語', v: 0.7 });
      break;
    }
  }
  // 述語を置いたのに、そのあとに述語句をぶら下げる語が残っている。
  //   「業火斬る剛利剣」… 斬る剣の剛利。日本語に無い並び方。
  //   ただし「業火を斬る硬剣」のように、残った語が末尾語を修飾しているなら
  //   減点しない。これが接続詞ありきの自然な形 (述語 + 連体修飾 + 末尾語)。
  //   い形容詞は語幹複合の「業火斬る鋭剣」も日本語として読める (鋭い剣と同義) が、
  //   な形容詞は語幹で名詞を修飾しないので、「業火斬る剛利剣」は減点のまま。
  if (hasPredicate) {
    const lastPredicate = compounds
      .filter((c) => c.pred)
      .map((c) => c.idx)
      .pop();
    const after = segs.slice(lastPredicate + 1, tailPos);
    // 残った語が末尾語直前の修飾語そのもの (head)、または末尾語に係る句 (名詞 + の など)
    // なら末尾語に係っている。head が末尾語を修飾できないとき (な形容詞が語幹のまま
    // 連体形無しで置かれたとき) は、係り損ねとして減点する。
    const lastMod = after.length ? after[after.length - 1] : null;
    const modInfo = lastMod ? WORDS[lastMod] : null;
    const headBound = lastMod === head && headInfo
      && (!compoundBindInfo || compoundBindInfo.bound
        || headInfo.pos !== POS.naadj);
    const tailBinder = headBound || (modInfo && modInfo.cat === 'connect');
    if (after.length && !tailBinder) {
      parts.push({
        key: 'dangling',
        label: `述語が末尾語に係っていない (${after.join('')})`,
        v: -0.5,
      });
    }
  }
  if (idiom) parts.push({ key: 'idiom', label: `熟語「${idiom.name}」`, v: 0.7 });
  const natural = Math.max(0, parts.reduce((s, p) => s + p.v, 0));

  // 文の力。自然な分量だけが足される。
  //   実質語 1 つに 5% (長さは少しだけ報いる)
  //   自然さに 1 単位あたり 30% — 自然さが本命。
  //   熟語はさらに固定で足す。別の語と重なっていても熟語が成立すれば乗る。
  const PHRASE_BONUS = 0.2;
  const phraseBonus = idiom ? PHRASE_BONUS : 0;
  const bonusWords = Math.max(0, content - 1);
  const predicated = hasPredicate;
  fx.power = 1 + bonusWords * 0.05 + natural * 0.30 + phraseBonus;

  // 評価。自然さと完成度で決まる。
  let grade = 'plain';
  if (natural >= 2.8) grade = 'great';
  else if (natural >= 1.6) grade = 'idiom';

  return {
    valid: true,
    reason: '',
    reasonText: '',
    text: joined,
    segments: segs,
    content,
    verbs,
    predicated,
    conn,
    compounds,
    grade,
    gradeInfo: GRADES[grade],
    element,
    fx,
    idiom,
    phraseBonus,
    bonusWords,
    natural,
    naturalParts: parts,
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
 * 語彙から重み付き抽選で語を引く。
 * 接続詞は含まれない (鍛冶のプールから無限に使う)。
 */
export function drawWord(rng, opts = {}) {
  const cat = opts.cat;
  const pool = cat ? WORDS_BY_CAT[cat] : DRAWABLE_ALL;
  if (!pool || !pool.length) return null;

  // 重み付き抽選。種別ごとの重みを読む。
  // 接続詞は抽選に出ない。鍛冶の下部のプールから無限に置ける。
  // かなを含む語 (動詞) は漢字だけの武器を作りやすくするため 1/4 に抑える。
  const KANA_PENALTY = 0.25;
  const weights = pool.map((w) => {
    const word = WORDS[w];
    const c = CATEGORIES[word.cat];
    const base = c ? c.weight : 10;
    let k = base;
    if (hasKana(w)) k *= KANA_PENALTY;
    return k;
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return makeWord(pool[i]);
  }
  return makeWord(pool[pool.length - 1]);
}

/**
 * 武器語 (形態語) を 1 つ引く。
 * レベルアップの 3 択には他の語より低い確率で出る。
 * 語彙からは引けない — 戦闘中に得た武器語は、そのまま新しい文になる。
 * @param {Function} rng
 * @param {Set<string>} [exclude] すで دخلている武器語
 * @returns {object|null}
 */
export function drawFormWord(rng, exclude) {
  const pool = WORDS_BY_CAT.form.filter((w) => !(exclude && exclude.has(w)));
  if (!pool.length) return null;
  return makeWord(pool[Math.floor(rng() * pool.length)]);
}

/**
 * 開始時に使う語を引く。漢字だけで短い語だけから。
 * 1 語ずつ重複を避けて取る。
 * @param {Function} rng
 * @returns {object|null}
 */
export function drawSimple(rng, used = new Set()) {
  if (!SIMPLE_POOL.length) return null;
  for (let tries = 0; tries < 24; tries++) {
    const w = SIMPLE_POOL[Math.floor(rng() * SIMPLE_POOL.length)];
    if (!used.has(w)) { used.add(w); return makeWord(w); }
  }
  return null;
}

/** 文の成立・不成文の判定結果を文章化する (ログ用)。 */
export function describePhrase(evalResult) {
  if (!evalResult.valid) return `不成文 — ${evalResult.reasonText}`;
  const base = `${evalResult.gradeInfo.name}「${evalResult.text}」`;
  return evalResult.idiom ? `${base} — 熟語「${evalResult.idiom.name}」成立` : base;
}
