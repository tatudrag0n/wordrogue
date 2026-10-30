// ============================================================================
// ワードローグ — 部位強化の文 (7 部位を縦に並べる)
//
// 戦闘中の言葉鍛冶と **同じ土台 (senpad.js)** で組む。
//   ・所持語をタップして選び、部位の行をタップで置く
//   ・所持語を部位の行へドラッグすると、落とした位置に差し込む
//   ・部位の中の語はドラッグで並べ替え / 別の部位へ移動
//   ・部位の語を所持語の箱へドラッグすると外れる
//   ・語をタップで接続詞が順に回る。接続詞のマスをタップで一覧から選ぶ
//   ・「戻す」で直前の操作を 1 つ戻す
// 文は 1 部位 10 文字まで (武器と同じ)。語の数に上限はない。
// ============================================================================

import { el, clear } from '../core/util.js';
import { WORDS, CATEGORIES } from '../data/words.js?v=1.47';
import { PART_MAX_LEN, PARTS } from '../core/save.js';
import { makePartSentence } from '../game/parts.js';
import {
  wordEffectRows, wordDirectEffectRows, isPartUsable, wordMeaningParts, PART_KIND_LABELS,
} from '../game/stats.js';
import { FX_LABEL, PS_LABEL } from './labels.js';
import { SenPad } from './senpad.js';

/** 語の効果を 1 行にまとめる (ツールチップ用)。 */
function fxText(src, label) {
  const parts = [];
  for (const [k, v] of Object.entries(src || {})) {
    if (typeof v !== 'number' || Math.abs(v) < 0.01) continue;
    parts.push(`${label[k] || k}${v > 0 ? '+' : ''}${Math.round(v * 100) / 100}`);
  }
  return parts.length ? parts.join(' ') : '効果なし';
}

export class GrowPad extends SenPad {
  /** @param {object} menu Menus (effectChips / renderGrowPartNote / rankTip を使う) */
  constructor(menu) {
    super({ audio: menu.audio });
    this.menu = menu;
    this.save = menu.save;
    /** 所持語の一覧 (描いた順)。place の index はこの並び。 */
    this.poolWords = [];
    /** 選んだ語のひとこと (効く部位など)。 */
    this.hint = '';
  }

  get audio() { return this.menu.audio; }

  // ── 描画 ──────────────────────────────────────────────────────────────

  /** 部位 7 行と所持語を描き直す。 */
  render() {
    const menu = this.menu;
    // 描き直すと開いていた接続詞の一覧は行き場を失う。鍛冶と同じく閉じる。
    this.closeConnPicker();
    if (menu.growUndo) menu.growUndo.disabled = this.undoStack.length === 0;
    this.rows.clear();
    this.placeById.clear();
    clear(menu.growParts);

    for (const p of PARTS) {
      const words = this.save.partRaw(p.id).filter(Boolean);
      const box = el('div', { class: 'grow-part' + (words.length ? ' filled' : '') });
      box.dataset.padRow = '1';   // 行のどこへ落としても挿入できる
      box.dataset.part = p.id;
      const row = el('div', { class: 'grow-part-row' });
      row.append(el('span', { class: 'grow-part-name' }, p.name));

      const sen = makePartSentence(words);
      const line = el('div', { class: 'sen-row' + (words.length ? '' : ' empty') });
      // 行そのものが受け皿。落とした x 座標に近い境目へ差し込む。
      this.rows.set(line, { part: p.id });
      if (!words.length) {
        line.append(el('span', { class: 'grow-part-placeholder' }, '語をここへ'));
      }
      sen.entries.forEach((e, i) => {
        const place = { kind: 'slot', part: p.id, index: i };
        line.append(this.renderWord(e, place, words));
      });
      // 行の余白 (語の後ろ) をタップ = 末尾へ入れる。
      this.bindRowBlank(line, { part: p.id });

      const lv = el('span', { class: 'grow-part-lv' },
        `${sen.len} / ${PART_MAX_LEN} 文字`);
      const clearBtn = el('button', {
        class: 'btn grow-part-clear', type: 'button',
        title: `「${p.name}」の語をすべて外す`,
        disabled: !words.length,
      }, '空にする');
      clearBtn.addEventListener('click', () => this.clearPart(p));
      row.append(line, lv, clearBtn);
      box.append(row);
      box.append(menu.renderGrowPartNote(p, words.map((x) => ({ text: x.text, conn: x.conn }))));
      menu.growParts.append(box);
    }

    this.renderPool();
    this.renderNote();
  }

  /** 文の語 1 つ。右に接続詞。 */
  renderWord(entry, place, words) {
    const w = entry.word.text;
    const info = WORDS[w];
    const cat = CATEGORIES[info?.cat] || CATEGORIES.modifier;
    const armed = this.armed && this.padTextOf(this.armed) === w;
    const heldNow = this.held && this.padTextOf(this.held.word) === w
      && this.padKeyOf(this.held.place) === this.padKeyOf(place);
    const chip = el('div', {
      class: 'sen-word' + (armed ? ' armed' : '') + (heldNow ? ' held' : ''),
      style: { borderColor: cat.color },
      title: `${w} [${cat.name}]`
        + `\nタップ: 後ろの接続詞を切り替える`
        + `\n長押し: 接続詞の一覧`
        + `\nドラッグ: 並べ替える / 別の部位へ移す / 所持語へ戻す`
        + `\n使える接続詞: ${this.connListText(place, entry)}`,
    }, el('span', {}, w));
    this.makeDraggable(chip, place, () => this.onWordTap(place), () => this.openConnPicker(place, chip));

    const conn = entry.conn;
    const connChip = el('div', {
      class: conn ? 'sen-conn filled' : 'sen-conn empty',
      title: conn
        ? `接続詞「${conn.text}」— 別の接続詞を選ぶ`
        : '接続詞なし。タップで選ぶ (語本体のタップでも回る)',
    }, el('span', {}, conn ? conn.text : ''));
    this.makeTappable(connChip, () => this.openConnPicker(place, connChip));

    return el('div', { class: 'sen-item' }, chip, connChip);
  }

  /** 使える接続詞の並び (ヒント用)。 */
  connListText(place, entry) {
    const sen = this.padSenOf(place);
    if (!sen) return '—';
    const opts = sen.connOptions(place.index);
    const cur = entry.conn ? entry.conn.text : 'なし';
    if (!opts.length) return `なし (今: ${cur})`;
    return `${opts.join(' → ')} → なし (今: ${cur})`;
  }

  /** 行の余白をタップ / 語を選んだまま行を押すと末尾へ。 */
  bindRowBlank(line, ctx) {
    let down = null;
    line.addEventListener('pointerdown', (ev) => {
      if (ev.target === line) down = { x: ev.clientX, y: ev.clientY };
    });
    line.addEventListener('pointerup', (ev) => {
      const d = down;
      down = null;
      if (ev.target !== line || !d || this.suppressClick || this.dragFrom) return;
      if (Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > SenPad.DRAG_SLOP) return;
      if (!this.armed && !this.held) return;
      const count = makePartSentence(this.save.partRaw(ctx.part).filter(Boolean)).count;
      this.onGapTap(this.padPlaceAt(ctx, count));
    });
    line.addEventListener('pointercancel', () => { down = null; });
  }

  /** 所持語。体に効く語だけを並べる。 */
  renderPool() {
    const menu = this.menu;
    const save = this.save;
    const owned = save.collection.filter((t) => !!WORDS[t]);
    const usable = owned.filter((t) => isPartUsable(t));
    this.poolWords = usable;
    const hiddenN = owned.length - usable.length;
    if (menu.growWordsNote) {
      menu.growWordsNote.textContent = hiddenN
        ? `体に効く ${usable.length} 語。ほか ${hiddenN} 語は武器の文で使う語 (部位では何も起きない) なので隠している`
        : `体に効く ${usable.length} 語`;
    }
    if (!menu.growWords) return;
    clear(menu.growWords);
    usable.forEach((t, i) => {
      const info = WORDS[t];
      if (!info) return;
      const src = [fxText(info.fx, FX_LABEL), info.player ? `体 ${fxText(info.player, PS_LABEL)}` : '']
        .filter((x) => x && x !== '効果なし').join(' / ') || '効果なし';
      const used = save.partWordList().filter((x) => x === t).length;
      const direct = wordDirectEffectRows(t);
      const eff = wordEffectRows(t);
      const kinds = wordMeaningParts(t);
      const where = kinds.map((k) => PART_KIND_LABELS[k] || k).join('・');
      const b = el('button', {
        class: 'btn grow-word' + (this.armed === t ? ' sel' : '') + (used ? ' used' : '')
          + (direct.length || kinds.length ? ' has-eff' : ' no-eff') + ' rk' + save.rankIndex(t),
        type: 'button',
        title: `${CATEGORIES[info.cat]?.name || info.cat} / ランク ${save.rankOf(t).name}: ${src}`
          + `\n${menu.rankTip(t)}`
          + `\nタップで選び、部位の行をタップで置く。ドラッグで直接置ける。`
          + (direct.length ? `\n体に効く: ${direct.map((r) => `${r.label} ${r.text}`).join(' / ')}`
            : '\n体に直接は効かない (文にすれば文の力ぶん強くなる)')
          + (kinds.length ? `\n効く部位: ${where} (語の意味が${where}で働く)` : '')
          + (eff.length && !direct.length ? '\n文にすれば文の力ぶんだけ強くなる' : '')
          + (used ? `\n部位に ${used} 語入っている (同じ語をいくつでも置ける)` : ''),
      }, t, used ? el('i', { class: 'grow-word-used' }, `×${used}`) : null);
      if (direct.length) b.append(el('i', { class: 'grow-word-eff' }, direct.map((r) => r.text).join(' ')));
      if (where) b.append(el('i', { class: 'grow-word-eff where' }, where));
      const place = { kind: 'pool', index: i };
      this.makeDraggable(b, place, () => this.onPoolTap(t));
      menu.growWords.append(b);
    });
  }

  /** 操作の説明と、直前の操作の結果。 */
  renderNote() {
    const note = this.menu.growSelNote;
    if (!note) return;
    if (this.msg) { note.textContent = this.msg; return; }
    if (this.armed) {
      const t = this.padTextOf(this.armed);
      note.textContent = `「${t}」を選択中 — 部位の行を押すとそこに入る。押した位置で並びが決まる。`
        + (this.hint ? ` ${this.hint}` : '');
      return;
    }
    if (this.held) {
      note.textContent = `「${this.padTextOf(this.held.word)}」を持ち上げ中 — 部位の行を押すとそこへ移る。所持語の箱を押すと外れる。`;
      return;
    }
    note.textContent = '部位は 1 文。10 文字まで、語はいくつでも並べられる。'
      + '所持語をドラッグして部位の行へ落とすと、その位置に入る。'
      + '語をタップすると接続詞が順に回り、接続詞のマスをタップすると一覧から選べる。'
      + (this.hint ? ` ${this.hint}` : '');
  }

  // ── SenPad のフック ────────────────────────────────────────────────────

  padScope() { return [this.menu.growParts, this.menu.growWords].filter(Boolean); }
  padPoolEl() { return this.menu.growWords; }
  padRows() { return this.rows; }
  padPlaceAt(ctx, index) { return { kind: 'slot', part: ctx.part, index }; }
  padPoolPlace() { return { kind: 'pool', index: -1 }; }
  padPoolItem(index) { return this.poolWords[index] ?? null; }

  padKeyOf(place) {
    if (!place) return '';
    if (place.kind === 'pool') return `L${place.index}`;
    return `${place.part}_${place.index}`;
  }

  padSenOf(place) {
    if (!place || !place.part) return null;
    return makePartSentence(this.save.partRaw(place.part).filter(Boolean));
  }

  padWordAt(place) {
    const e = this.padSenOf(place)?.at(place.index);
    return e ? e.word : null;
  }

  padInsert(place, item) {
    const r = this.save.partInsert(place.part, place.index, this.padTextOf(item));
    return r.ok ? r : { ok: false, reason: r.reason };
  }

  padMove(from, to) {
    if (from.part === to.part) {
      return this.save.partMove(from.part, from.index, to.index);
    }
    // 別の部位へ。長さが足りないときは何も動かさない。
    const e = this.padSenOf(from)?.at(from.index);
    if (!e) return { ok: false, reason: 'empty' };
    const ins = this.save.partInsert(to.part, to.index, e.word.text);
    if (!ins.ok) return ins;
    const connText = e.conn ? e.conn.text : null;
    this.save.partRemove(from.part, from.index);
    if (connText) this.save.setPartConn(to.part, to.index, connText);
    return { ok: true, reason: 'moved' };
  }

  padReturn(place) { return this.save.partRemove(place.part, place.index); }

  padSetConn(place, text) { return this.save.setPartConn(place.part, place.index, text); }

  padCycle(place) {
    const sen = this.padSenOf(place);
    if (!sen) return { ok: false, text: null, reason: 'range' };
    const r = sen.cycleConnAt(place.index);
    if (!r.ok) return r;
    const w = this.save.setPartConn(place.part, place.index, r.text);
    return w.ok ? r : { ok: false, text: null, reason: w.reason };
  }

  padSnapshot() { return JSON.parse(JSON.stringify(this.save.data.parts || {})); }

  padRestore(state) {
    this.save.data.parts = JSON.parse(JSON.stringify(state));
    this.save.save();
  }

  padRender() { this.menu.renderGrow(); }
  padChanged() {}

  /** 語を選んだら、前の操作の結果表示は消し、効く部位の一言を出す。 */
  onPoolTap(item) {
    this.msg = '';
    const t = this.padTextOf(item);
    const kinds = wordMeaningParts(t);
    const where = kinds.map((k) => PART_KIND_LABELS[k] || k).join('・');
    this.hint = where ? `「${t}」は${where}に入れると効く (語の意味が部位の働きに合う)` : '';
    super.onPoolTap(item);
  }

  /** 部位を空にする。 */
  clearPart(part) {
    if (!this.save.partRaw(part.id).filter(Boolean).length) return;
    this.beginEdit();
    this.save.partClear(part.id);
    this.msg = `「${part.name}」の語をすべて外した。`;
    this.audio?.uns?.();
    this.padRender();
  }

  /** 所持語の選択を解く (画面を離れるとき)。 */
  reset() {
    this.armed = null;
    this.held = null;
    this.undoStack = [];
    this.msg = '';
    this.hint = '';
    this.closeConnPicker();
  }
}
