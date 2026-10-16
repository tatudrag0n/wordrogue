// ============================================================================
// ワードローグ — 部位強化の文
//
// 部位にも武器と同じ「文」の仕組みを使う。1 部位に 2 語まで入れられて、
// 語の直後には **接続詞 (送り仮名)** が付く。言葉鍛冶と同じ規則なので、
// 語のプールに無い形 (頑された / 凍かな) は最初から作れない。
//
// 接続詞を付ける意義は 2 つ。
//   1. 2 語を **熟語** にできる …「発」「電」+「する」= 発電する
//   2. 文が完成するほど強くなる … 部位の文の力 (power) が効果に乗る
//
// 不成文の部位は何も効かない — 武器と同じ。ただし UI は「付けたあとで
// 不成文になる接続詞」を出さない (このファイルの canSetConn が判定する)。
// ============================================================================

import { makeWord, WORDS, CONNECTOR_SET } from '../data/words.js';
import { canConnect } from '../data/words.connect.js';
import { Sentence } from './sentence.js';
import { PART_MAX_LEN, PART_SLOTS } from '../core/save.js';

/**
 * 部位語 (text / {text,conn}) の並びを { text, conn } の並びに整える。
 * 旧セーブの文字列だけのかたちもここで吸収する。
 *
 * 接続詞はその語のプールにある形だけ。熟語の形 (発電「する」) は、直前に
 * 接続詞を挟まずに続いた語が熟語になっているときだけ通る — なので
 * before を渡して判定する。付けられない接続詞は黙って落とす。
 */
export function normPartEntries(words) {
  const out = [];
  // 接続詞を挟まずに続いた語 (熟語の判定用)。
  let run = [];
  for (const raw of words || []) {
    if (!raw) continue;
    const text = typeof raw === 'string' ? raw : raw.text || raw.t || null;
    if (!text || !WORDS[text] || CONNECTOR_SET.has(text)) continue;
    const conn = typeof raw === 'string' ? null : raw.conn || raw.c || null;
    const ok = conn && canConnect(WORDS[text], conn, run);
    out.push({ text, conn: ok ? conn : null });
    run = ok ? [] : [...run, text];
    if (out.length >= PART_SLOTS) break;   // 1 部位に入りきるのは PART_SLOTS 語まで
  }
  return out;
}

/**
 * 部位の文を作る。長さ (PART_MAX_LEN) を超える語は入らない。
 * @param {Array} words 部位の語 (text でも {text,conn} でも可)
 * @returns {Sentence}
 */
export function makePartSentence(words) {
  const sen = new Sentence({ maxLen: PART_MAX_LEN });
  for (const e of normPartEntries(words)) {
    if (!sen.fits(e.text)) break;
    sen.push(makeWord(e.text));
    if (e.conn) sen.setConnAt(sen.count - 1, e.conn);
  }
  return sen;
}

/**
 * 部位の文を評価する。実質語 1 つでも効く (1 語だけの部位は普通にあるので)。
 * @returns {{
 *   sen:Sentence, ev:object, text:string, valid:boolean, power:number,
 *   gain:number, gradeInfo:object, reasonText:string, idiom:Object|null
 * }}
 */
export function evaluatePart(words) {
  const sen = makePartSentence(words);
  const ev = sen.evaluate({ minContent: 1 });
  // 文の力をそのまま強さにしない。半分かぶせて、語そのものの価値を主にする。
  const power = ev.valid ? (ev.fx.power || 1) : 1;
  const gain = ev.valid ? Math.max(0.6, Math.min(2.4, 1 + (power - 1) * 0.6)) : 0;
  return {
    sen,
    ev,
    text: sen.text,
    valid: ev.valid,
    power,
    gain,
    gradeInfo: ev.gradeInfo,
    reasonText: ev.reasonText || '',
    idiom: ev.idiom || null,
  };
}

/**
 * 部位の index の語の直後に、今から選べる接続詞。
 * 「付けても部位の文が成立しているもの」だけを出すので、
 * メニューから選んで文を壊すことがない。
 * @param {Array} words 部位の語
 * @param {number} index 枠の番号
 * @returns {string[]}
 */
export function partConnOptions(words, index) {
  const entries = normPartEntries(words);
  const e = entries[index];
  if (!e) return [];
  const sen = makePartSentence(entries);
  const keep = sen.entries[index] ? sen.entries[index].conn?.text || null : null;
  const raw = sen.connOptions(index);
  const out = [];
  for (const k of raw) {
    sen.entries[index].conn = k ? makeWord(k) : null;
    if (sen.evaluate({ minContent: 1 }).valid) out.push(k);
  }
  sen.entries[index].conn = keep ? makeWord(keep) : null;
  return out;
}

/** この接続詞を今この枠に付けられるか (成立するかどうか)。 */
export function partCanSetConn(words, index, conn) {
  if (!conn) return true;
  return partConnOptions(words, index).includes(conn);
}
