// ============================================================================
// ワードローグ — 部位強化の文
//
// 部位にも武器と同じ「文」の仕組みをそのまま使う。語の数に上限はなく、
// **10 文字まで**並べられる。語の直後には接続詞 (送り仮名) が付く。
//
// **戦闘中の言葉鍛冶と同じ仕組み・同じルール** で作る。
//   ・語の直後に付く接続詞 (送り仮名) は **その語のプールと熟語の形** だけ。
//     候補は Sentence.connOptions (鍛冶と共通のコード) が決める。
//   ・文が成り立つかの判定も同じ evaluate を通す (Sentence クラスも共通)。
//   ・違うのは末尾だけ。武器は武器語 (剣・銃...) で文を閉じるが、部位は
//     **部位名 (頭・右手...) が後ろに付く** とみなす (implicitTail)。
//     「賢い」「硬い」のような連体形や「の」で終わる形がそのまま成り立つ。
// 成り立った文は部位の効きを伸ばし (文の力)、成り立たない文は何も効かない。
//
// 接続詞を付ける意義は 2 つ。
//   1. 2 語を **熟語** にできる …「発」「電」+「する」= 発電する
//   2. 文が完成するほど強くなる … 部位の文の力 (power) が効果と体に乗る
// ============================================================================

import { makeWord, WORDS, CONNECTOR_SET } from '../data/words.js?v=1.48';
import {
  canConnect, connectorFor, CONNECTORS, CONNECT_ORDER, ROLE_LABEL,
} from '../data/words.connect.js';
import { Sentence } from './sentence.js';
import { PART_MAX_LEN } from '../core/save.js';

/** 接続詞の役割。画面の見出しに使う。 */
export const ROLE_ORDER = ['adn', 'adv', 'case'];

/**
 * 部位語 (text / {text,conn}) の並びを { text, conn } の並びに整える。
 * 旧セーブの文字列だけのかたちもここで吸収する。
 *
 * 接続詞は **鍛冶と同じルール** で検証する — その語 (または前の語列が作る熟語) の
 * 送り仮名だけを残す。知らない文字列や付けられない形は落とし、語そのものは残す。
 */
export function normPartEntries(words) {
  const out = [];
  for (const raw of words || []) {
    if (!raw) continue;
    const text = typeof raw === 'string' ? raw : raw.text || raw.t || null;
    if (!text || !WORDS[text] || CONNECTOR_SET.has(text)) continue;
    const conn = typeof raw === 'string' ? null : raw.conn || raw.c || null;
    out.push({ text, conn: conn && CONNECTORS[conn] ? conn : null });
  }
  // 付けられない接続詞 (旧仕様のセーブなど) は落とす。語そのものは消さない。
  for (let i = 0; i < out.length; i++) {
    if (!out[i].conn) continue;
    const before = [];
    for (let k = i - 1; k >= 0 && !out[k].conn; k--) before.unshift(out[k].text);
    if (!canConnect({ text: out[i].text }, out[i].conn, before)) out[i].conn = null;
  }
  return out;
}

/**
 * 部位の文を作る。長さ (PART_MAX_LEN) を超える語は入らない。
 * 接続詞は鍛冶と同じ検証 (canConnect) を通ってから入る。付けられない形は付かない。
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
 * 部位の index の語に付けられる接続詞。**戦闘中の言葉鍛冶と同じ候補** を返す。
 *
 *   1. その語の形 (プールの送り仮名)  ... 斬 -> る / られた / り
 *   2. 熟語の形 (直前の語列が熟語のときの送り仮名) ... 発電 の する
 * これ以外は選べない。候補そのものは Sentence.connOptions (鍛冶と共通のコード) が
 * 決め、文字数を超える形も出さない。
 * どの選択肢にも `valid` (その形にしたとき文が成り立つか) と成らない理由が付く。
 *
 * @param {Array} words 部位の語
 * @param {number} index 枠の番号
 * @returns {Array<{
 *   text:string, role:string, roleLabel:string, desc:string, formText:string,
 *   compound:boolean, source:'word'|'compound', valid:boolean, power:number, reason:string
 * }>}
 */
export function partConnChoices(words, index) {
  const entries = normPartEntries(words);
  const e = entries[index];
  if (!e) return [];
  const sen = makePartSentence(entries);
  const keep = sen.entries[index]?.conn?.text || null;   // 評価の間だけ差し替える
  const own = new Set(connectorFor({ text: e.text }));   // その語自身の形

  const out = [];
  for (const k of sen.connOptions(index)) {
    const info = CONNECTORS[k];
    if (!info) continue;
    const hit = sen.connForm(index, k);
    const role = info.roles.has('adn') ? 'adn' : info.roles.has('adv') ? 'adv' : 'case';
    sen.entries[index].conn = k ? makeWord(k) : null;
    const ev = sen.evaluate({ minContent: 1, implicitTail: true });
    out.push({
      text: k,
      role,
      roleLabel: ROLE_LABEL[role] || '',
      desc: info.desc,
      source: own.has(k) ? 'word' : 'compound',
      compound: !!(hit && hit.compound),
      formText: `${e.text}${k}`,          // 付けたときの見た目 (「賢」+ い = 賢い)
      valid: ev.valid,
      power: ev.valid ? (ev.fx.power || 1) : 1,
      reason: ev.valid ? '' : (ev.reasonText || ''),
    });
  }
  sen.entries[index].conn = keep ? makeWord(keep) : null;

  // その語の形 -> 熟語の形。同じ中なら文が成る形を先に、あとはプールの順。
  const rank = (x) => (x.source === 'word' ? 0 : 1);
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

/**
 * この接続詞を今この枠に付けられるか。
 * 鍛冶と同じく **その語 (または熟語) の送り仮名** だけを許す。null はいつでも可。
 */
export function partCanSetConn(words, index, conn) {
  if (!conn) return true;
  const entries = normPartEntries(words);
  if (!entries[index] || !CONNECTORS[conn]) return false;
  return makePartSentence(entries).connOptions(index).includes(conn);
}

/** その語の形 (プールの送り仮名) を、付けられる順に。表示の目印に使う。 */
export function partWordForms(text) {
  return connectorFor({ text });
}

/** 部位の接続詞が「その語の形」かどうか (画面の目印用)。 */
export function isWordForm(text, conn) {
  return !!conn && partWordForms(text).includes(conn);
}

