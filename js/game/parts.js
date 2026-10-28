// ============================================================================
// ワードローグ — 部位強化の文
//
// 部位にも武器と同じ「文」の仕組みを使う。1 部位に 2 語まで入れられて、
// 語の直後には **接続詞 (送り仮名)** が付く。
//
// 武器の鍛冶と違うのは **接続詞の選び方** だけ。
//   武器 … その語のプールにある送り仮名だけ (「斬」に る / られた / り)
//   部位 … どの接続詞でも選べる。付けた結果が文になるかは UI が ✓ / ✕ で示す
// 理由は 2 つある。
//   1. 部位の語は手持ちが少ない。プールを絞ると「接続詞が 1 つも選べない」語が出る
//      (癒 + 斬 のような並びでは、プールの形がどれも文を壊す)。
//   2. 「付けてから文が壊れた」ことが分かれば直せる。選べないより選べるほうがよい。
// 成り立った文は部位の効きを伸ばし (文の力)、成り立たない文は何も効かない。
//
// 接続詞を付ける意義は 2 つ。
//   1. 2 語を **熟語** にできる …「発」「電」+「する」= 発電する
//   2. 文が完成するほど強くなる … 部位の文の力 (power) が効果と体に乗る
// ============================================================================

import { makeWord, WORDS, CONNECTOR_SET } from '../data/words.js?v=1.28';
import {
  connectorFor, formAfter, CONNECTORS, CONNECT_ORDER, ROLE_LABEL,
} from '../data/words.connect.js';
import { Sentence } from './sentence.js';
import { PART_MAX_LEN, PART_SLOTS } from '../core/save.js';

/** 接続詞の役割。画面の見出しに使う。 */
export const ROLE_ORDER = ['adn', 'adv', 'case'];

/**
 * 部位語 (text / {text,conn}) の並びを { text, conn } の並びに整える。
 * 旧セーブの文字列だけのかたちもここで吸収する。
 *
 * 接続詞は「辞書にある送り仮名」なら何でも通す (部位は自由)。
 * 知らない文字列は黙って落とす。
 */
export function normPartEntries(words) {
  const out = [];
  for (const raw of words || []) {
    if (!raw) continue;
    const text = typeof raw === 'string' ? raw : raw.text || raw.t || null;
    if (!text || !WORDS[text] || CONNECTOR_SET.has(text)) continue;
    const conn = typeof raw === 'string' ? null : raw.conn || raw.c || null;
    out.push({ text, conn: conn && CONNECTORS[conn] ? conn : null });
    if (out.length >= PART_SLOTS) break;   // 1 部位に入りきるのは PART_SLOTS 語まで
  }
  return out;
}

/**
 * 部位の文を作る。長さ (PART_MAX_LEN) を超える語は入らない。
 * 接続詞は Sentence の検証を通さない — 部位は「選べるが文が壊れる場合もある」
 * ので、ここで落とすと選んだ接続詞が消えてしまう。
 * @param {Array} words 部位の語 (text でも {text,conn} でも可)
 * @returns {Sentence}
 */
export function makePartSentence(words) {
  const sen = new Sentence({ maxLen: PART_MAX_LEN });
  for (const e of normPartEntries(words)) {
    if (!sen.fits(e.text, sen.count, e.conn)) break;
    sen.entries.push({ word: makeWord(e.text), conn: e.conn ? makeWord(e.conn) : null });
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
  // 部位は「速い足」「焔の腕」のように、体の部位名が後ろに付く。
  // 連体形・「の」で終わる形は、その部位名に係る形として閉じていると見る。
  const ev = sen.evaluate({ minContent: 1, implicitTail: true });
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
 * 部位の index の語に付けられる接続詞を、**付けられる順** にまとめる。
 *
 *   1. その語の形 (プールの送り仮名)  … まずこれを出す
 *   2. 熟語の形 (直前の語列が熟語のときの送り仮名) … 発電 の する
 *   3. それ以外の接続詞 … 自由。並びによっては文が壊れる
 *
 * どの選択肢にも `valid` (その形にしたとき文が成り立つか) が付く。
 * 文を壊す形でも選べる — 選べないより、選んで理由が見えるほうがよい。
 *
 * @param {Array} words 部位の語
 * @param {number} index 枠の番号
 * @param {{all?:boolean}} [opt] all=true で 3. のすべてを含める (既定は true)
 * @returns {Array<{
 *   text:string, role:string, roleLabel:string, desc:string,
 *   source:'word'|'compound'|'other', valid:boolean, power:number, reason:string
 * }>}
 */
export function partConnChoices(words, index, opt = {}) {
  const entries = normPartEntries(words);
  const e = entries[index];
  if (!e) return [];
  const sen = makePartSentence(entries);
  const keep = sen.entries[index]?.conn?.text || null;

  const own = new Set(connectorFor({ text: e.text }));      // その語の形
  const run = (() => {
    const out = [];
    for (let i = index; i >= 0; i--) {
      const x = sen.entries[i];
      if (!x) break;
      if (i < index && x.conn) break;
      out.unshift(x.word.text);
    }
    return out;
  })();
  // 直前の語列が熟語になっていれば、熟語の形も「この語の形」として先に出す。
  const marked = new Map();   // text -> 'word' | 'compound'
  for (const k of own) marked.set(k, 'word');
  if (run.length >= 2) {
    for (const k of CONNECT_ORDER) {
      const hit = formAfter(run, k);
      if (hit && hit.compound) marked.set(k, 'compound');
    }
  }

  const list = opt.all === false
    ? [...marked.keys()]
    : [...new Set([...CONNECT_ORDER, ...marked.keys()])];

  const out = [];
  for (const k of list) {
    const info = CONNECTORS[k];
    if (!info) continue;
    sen.entries[index].conn = k ? makeWord(k) : null;
    const ev = sen.evaluate({ minContent: 1, implicitTail: true });
    const source = marked.get(k) || 'other';
    out.push({
      text: k,
      role: info.roles.has('adn') ? 'adn' : info.roles.has('adv') ? 'adv' : 'case',
      roleLabel: ROLE_LABEL[info.roles.has('adn') ? 'adn' : info.roles.has('adv') ? 'adv' : 'case'] || '',
      desc: info.desc,
      source,
      valid: ev.valid,
      power: ev.valid ? (ev.fx.power || 1) : 1,
      reason: ev.valid ? '' : (ev.reasonText || ''),
    });
  }
  sen.entries[index].conn = keep ? makeWord(keep) : null;

  // その語の形 → 熟語の形 → 残り、の順に並べる。
  const rank = (x) => (x.source === 'word' ? 0 : x.source === 'compound' ? 1 : 2);
  return out.sort((a, b) => rank(a) - rank(b)
    || (a.valid === b.valid ? 0 : a.valid ? -1 : 1)
    || CONNECT_ORDER.indexOf(a.text) - CONNECT_ORDER.indexOf(b.text));
}

/**
 * 部位の index の語の直後に、**文が成り立つ** 接続詞の一覧 (互換 API)。
 * 画面は partConnChoices を使う。テストと道具のために残す。
 * @returns {string[]}
 */
export function partConnOptions(words, index) {
  return partConnChoices(words, index).filter((c) => c.valid).map((c) => c.text);
}

/** この接続詞を今この枠に付けられるか。部位は接続詞を自由に選べる。 */
export function partCanSetConn(words, index, conn) {
  if (!conn) return true;
  const entries = normPartEntries(words);
  return !!(entries[index] && CONNECTORS[conn]);
}

/** その語の形 (プールの送り仮名) を、付けられる順に。表示の目印に使う。 */
export function partWordForms(text) {
  return connectorFor({ text });
}

/** 部位の接続詞が「その語の形」かどうか (画面の目印用)。 */
export function isWordForm(text, conn) {
  return !!conn && partWordForms(text).includes(conn);
}

