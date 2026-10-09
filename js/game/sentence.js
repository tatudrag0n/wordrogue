// ============================================================================
// ワードローグ — 文 (自由に並べた語の並び)
//
// 武器の文もプレイヤー自身の文も、この同じ仕組みで作る。
// 「枠」に語を嵌めるのではなく、語を自由に並べて文にする。
//   語は 1 文字以上自由に入れ替えられる。
//   接続詞は「その語の直後」に付く。語の横にあるだけなので、
//   並べ替えても文の長さは変わらない。
//
// 長さの上限は 10 文字。末尾語 (人) があれば、そのぶんも数える。
// 語をタップすると直後の接続詞が切り替わり、使える接続詞を
// 一周すると「接続詞なし」になり、また先頭から回す:
//
//   「斬」→ る(斬る) → られた(斬られた) → り(斬り) → 無し
//   「発」→ する(発する) → の → を → に → へ → 無し
//
// 使える接続詞は「その語のプール (words.pool.js) にある送り仮名」だけ。
// 並びもプールの順。文字数の上限を超えるものだけ外す。
//
// 直前の語と合わせて熟語になっているときは、熟語の送り仮名も先頭に出る。
//   「発」「電」と並べて「電」をタップ → する(発電する) → の → を → に → へ → 無し
// 熟語の判定は、接続詞を挟まずに続いた語だけで見る (「発の電」は熟語ではない)。
// ============================================================================

import { evaluate, makeWord, WORDS } from '../data/words.js';
import { connectorsAfter, formAfter, CONNECTORS } from '../data/words.connect.js';

/** 文の文字数の上限。接続詞も末尾語も数える。 */
export const MAX_SENTENCE_LEN = 10;

export class Sentence {
  /**
   * @param {{maxLen?:number, tail?:string}} [opt]
   *   maxLen … 上限の文字数。省略時は 10。
   *   tail   … 文の末尾に固定で付く語 (プレイヤー自身の文の「人」)。
   */
  constructor(opt = {}) {
    this.maxLen = opt.maxLen || MAX_SENTENCE_LEN;
    this.tailText = opt.tail || null;
    /** @type {Array<{word:object, conn:object|null}>} 語の並び */
    this.entries = [];
  }

  get tailWord() { return this.tailText ? makeWord(this.tailText) : null; }

  /** 語の並びだけ取り出す (表示・検索用)。 */
  get words() { return this.entries.map((e) => e.word); }
  /** 各語の直後の接続詞。 */
  get conns() { return this.entries.map((e) => e.conn); }
  /** 入っている語の数。 */
  get count() { return this.entries.length; }
  /** 入っている語だけ。 */
  get filled() { return this.words.filter(Boolean); }

  /** 文面。末尾語も連結する。 */
  get text() {
    let t = '';
    for (const e of this.entries) {
      t += e.word.text + (e.conn ? e.conn.text : '');
    }
    return t + (this.tailText || '');
  }

  /** 現在の文字数。末尾語と接続詞も数える。 */
  get len() { return this.text.length; }
  /** あと何文字まで置けるか。 */
  get free() { return this.maxLen - this.len; }
  /** これ以上置けないか。 */
  get full() { return this.free <= 0; }

  /** 文の並び (evaluate に渡す配列)。 */
  segments() {
    const out = [];
    for (const e of this.entries) {
      out.push(e.word);
      if (e.conn) out.push(e.conn);
    }
    if (this.tailText) out.push(makeWord(this.tailText));
    return out;
  }

  /** これらの語を文として評価する。 */
  evaluate(opt = {}) { return evaluate(this.segments(), opt); }

  /** 語 instanciaを探す。 */
  indexOf(word) { return this.entries.findIndex((e) => e.word === word); }
  at(i) { return this.entries[i] || null; }

  /** 並べ替え・再計算の判定用シグネチャ。 */
  sig() {
    return this.len + '|' + this.entries.map((e) => e.word.uid + ':' + (e.conn ? e.conn.uid : '-')).join(',');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 語を置く
  // ───────────────────────────────────────────────────────────────────────────

  /** 今の並びから index の位置に語を 1 語だけ足すのに収まるか。 */
  fits(text, index = this.entries.length, connText = null) {
    const add = text.length + (connText ? connText.length : 0);
    if (this.len + add > this.maxLen) return false;
    // 実際に並べて長さを確かめる (接続詞込み)。
    if (!connText) return true;
    const probe = new Sentence({ maxLen: this.maxLen, tail: this.tailText });
    probe.entries = this.entries.map((e) => ({ word: e.word, conn: e.conn }));
    probe.entries.splice(index, 0, { word: { text }, conn: { text: connText } });
    return probe.len <= this.maxLen;
  }

  /**
   * index の位置に語を差し込む。既存の語は動かさない。
   * @returns {{ok:boolean, reason:string}}
   */
  insertAt(index, word) {
    if (!word) return { ok: false, reason: 'noword' };
    if (isConnText(word.text)) return { ok: false, reason: 'notword' };
    if (!this.fits(word.text, index)) {
      return { ok: false, reason: 'len' };
    }
    const at = Math.max(0, Math.min(index, this.entries.length));
    this.entries.splice(at, 0, { word, conn: null });
    return { ok: true, reason: 'placed' };
  }

  /** 末尾に足す。 */
  push(word) { return this.insertAt(this.entries.length, word); }

  /** 位置の語を取り除く。接続詞も一緒に消える。 */
  removeAt(index) {
    const e = this.entries[index];
    if (!e) return { ok: false, reason: 'empty' };
    this.entries.splice(index, 1);
    return { ok: true, reason: 'removed', word: e.word, conn: e.conn };
  }

  /** 語(from)を to の位置へ移す。 */
  moveTo(from, to) {
    if (from < 0 || from >= this.entries.length) return { ok: false, reason: 'range' };
    const at = Math.max(0, Math.min(to, this.entries.length));
    if (at === from || at === from + 1) return { ok: true, reason: 'same' };
    const [e] = this.entries.splice(from, 1);
    const idx = at > from ? at - 1 : at;
    this.entries.splice(idx, 0, e);
    return { ok: true, reason: 'moved' };
  }

  /** 語を入れ替える。 */
  swap(a, b) {
    if (a === b) return { ok: true, reason: 'same' };
    if (a < 0 || b < 0 || a >= this.entries.length || b >= this.entries.length) {
      return { ok: false, reason: 'range' };
    }
    const t = this.entries[a];
    this.entries[a] = this.entries[b];
    this.entries[b] = t;
    return { ok: true, reason: 'swapped' };
  }

  clear() { this.entries = []; }

  // ───────────────────────────────────────────────────────────────────────────
  // 接続詞
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * 位置の語の直後に置ける接続詞。その語のプールの送り仮名だけ (プールの順)。
   * さらに「文字数が収まる」ものだけを出す。
   * @returns {string[]}
   */
  connOptions(index) {
    const e = this.entries[index];
    if (!e) return [];
    const info = WORDS[e.word.text];
    if (!info) return [];
    const cur = e.conn ? e.conn.text.length : 0;
    return connectorsAfter(this.runBefore(index))
      .filter((c) => this.len - cur + c.length <= this.maxLen);
  }

  /**
   * index の語で終わる、接続詞を挟まずに続いた語の並び (古い順)。熟語の判定用。
   *   発 電 [する] → ['発', '電']   /   発の 電 → ['電']
   * @returns {string[]}
   */
  runBefore(index) {
    const out = [];
    for (let i = index; i >= 0; i--) {
      const e = this.entries[i];
      if (!e) break;
      if (i < index && e.conn) break;
      out.unshift(e.word.text);
    }
    return out;
  }

  /**
   * index の語の直後に接続詞 k を付けたときの形 (熟語の形を優先)。表示用。
   * @returns {{source:string, n:number, form:object, compound:boolean}|null}
   */
  connForm(index, k) {
    if (!this.entries[index]) return null;
    return formAfter(this.runBefore(index), k);
  }

  /** 語の直後に接続詞を置く。null で外す。 */
  setConnAt(index, conn) {
    const e = this.entries[index];
    if (!e) return { ok: false, reason: 'range' };
    if (!conn) { e.conn = null; return { ok: true, reason: 'cleared' }; }
    if (!CONNECTORS[conn]) return { ok: false, reason: 'unknown' };
    if (!this.connOptions(index).includes(conn)) return { ok: false, reason: 'nomatch' };
    e.conn = makeWord(conn);
    return { ok: true, reason: 'placed' };
  }

  /**
   * 語の直後の接続詞を 1 つ進める。
   * 使える接続詞を順に回り、一周したら「接続詞なし」になる。
   * @returns {{ok:boolean, text:string|null, reason:string}}
   */
  cycleConnAt(index) {
    const e = this.entries[index];
    if (!e) return { ok: false, text: null, reason: 'range' };
    const opts = this.connOptions(index);
    if (!opts.length) { e.conn = null; return { ok: false, text: null, reason: 'none' }; }
    const cur = e.conn ? e.conn.text : null;
    const at = cur ? opts.indexOf(cur) : -1;
    const next = at < 0 ? opts[0] : (at + 1 < opts.length ? opts[at + 1] : null);
    e.conn = next ? makeWord(next) : null;
    return { ok: true, text: next, reason: next ? 'placed' : 'cleared' };
  }
}

const isConnText = (t) => !!CONNECTORS[t];
