// ============================================================================
// ワードローグ — 文を組む共通の操作 (言葉鍛冶と部位強化で同じコード)
//
// 戦闘中の言葉鍛冶も、タイトルの部位強化も、この 1 つの土台の上で動く。
//   ・語をタップして選び、文の語か行の余白をタップで置く
//   ・語をドラッグして、落とした x 座標に近い境目へ差し込む (置き換えない)
//   ・文の語をドラッグで並べ替える / 語の箱へドラッグで戻す
//   ・語をタップで接続詞が順に回る。接続詞のマスをタップで一覧から一発選択
//   ・「戻す」で直前の操作を 1 つ戻す
//
// 画面ごとに違うのは「どこに語を置くか」だけ。それは pad* のフックで受け取る。
// ジェスチャ・当たり判定・接続詞の一覧・取り消しは、ここ 1 か所にある。
// ============================================================================

import { el } from '../core/util.js';
import { CONNECTORS, ROLE_LABEL, formOf } from '../data/words.connect.js';

/**
 * 文を組む画面の土台。
 *
 * 派生クラスが実装するもの (フック):
 *   padScope()            ドロップの印を消す範囲 (要素の配列)
 *   padPoolEl()           語の箱 (ここへドラッグすると文から戻る)
 *   padRows()             行の要素 -> 置き場の文脈 の Map
 *   padPlaceAt(ctx, i)    ctx の行の i 番目の境目の置き場
 *   padTextOf(item)       語の文字 (語オブジェクトでも文字列でも可)
 *   padWordAt(place)      置き場の語 (無ければ null)
 *   padInsert(place,item) 語を差し込む -> {ok, reason}
 *   padMove(from,to)      語を移す / 並べ替える -> {ok, reason}
 *   padReturn(place)      語を箱へ戻す (文から外す) -> {ok, reason}
 *   padSetConn(place,text) 接続詞を付ける (null で外す) -> {ok, reason}
 *   padCycle(place)       接続詞を 1 つ進める -> {ok, text, reason}
 *   padSnapshot()/padRestore(s)  取り消し用の控え
 *   padRender()           描き直す
 */
export class SenPad {
  constructor(opt = {}) {
    this.opt = opt;
    /** 語の箱から選んだ語 (まだ文に入れていない)。 */
    this.armed = null;
    /** 文の中から持ち上げた語。 */
    this.held = null;
    /** 「忘れる」モード。語の箱の語をタップすると捨てる。 */
    this.forgetMode = false;
    /** 直前の操作の結果。詳細欄に出す。 */
    this.msg = '';
    /** 直前に接続詞を切り替えた置き場。 */
    this.focusPlace = null;
    /** 直前の操作を戻すための控え。 */
    this.undoStack = [];
    /** ドラッグ中の置き場。 */
    this.dragFrom = null;
    /** ドラッグした直後。タップの誤発火を防ぐ。 */
    this.suppressClick = false;
    /** ドラッグ中の語の影。 */
    this.ghost = null;
    this.ghostOff = null;
    this.dragSrc = null;
    /** ノード -> pointerdown を開始した位置。 */
    this.downAt = new WeakMap();
    /** data-place のキー -> 置き場。 */
    this.placeById = new Map();
    /** 文の行 -> その行の文脈。描き直すごとに作り直す。 */
    this.rows = new Map();
    /** 接続詞を選ぶメニュー。開いている間だけ document.body に居る。 */
    this.pickerEl = null;
    this._hotId = '';
  }

  // ── フック (派生クラスが実装する) ──────────────────────────────────────

  padScope() { return []; }
  padPoolEl() { return null; }
  padRows() { return this.rows; }
  padPlaceAt() { throw new Error('padPlaceAt が未実装'); }
  padPoolPlace() { return { kind: 'pool', index: -1 }; }
  padTextOf(item) {
    if (!item) return '';
    return typeof item === 'string' ? item : (item.text || '');
  }
  padWordAt() { return null; }
  padConnAt(place) {
    const e = this.padSenOf(place)?.at(place.index);
    return e ? e.conn : null;
  }
  padSenOf() { return null; }
  padInsert() { return { ok: false, reason: 'noword' }; }
  padMove() { return { ok: false, reason: 'noword' }; }
  padReturn() { return { ok: false, reason: 'empty' }; }
  padSetConn() { return { ok: false, reason: 'notconn' }; }
  padCycle() { return { ok: false, text: null, reason: 'none' }; }
  padSnapshot() { return null; }
  padRestore() {}
  padRender() {}
  padChanged() {}
  padForget() { return null; }

  /** 置き場を見分けるキー。描き直しても同じキーになるようにする。 */
  padKeyOf(place) {
    if (!place) return '';
    return `${place.kind}:${place.pad ?? place.id ?? ''}:${place.index ?? ''}`;
  }

  /** 語の箱を指す置き場か (部位強化は 'pool'、鍛冶は 'lexicon')。 */
  padIsPool(place) {
    return !!place && (place.kind === 'pool' || place.kind === 'lexicon');
  }

  // ── 選ぶ・置く・戻す ────────────────────────────────────────────────────

  /** 語の箱の語をタップ。選ぶ / 持ち上げた語を戻す / 忘れる。 */
  onPoolTap(item) {
    if (this.suppressClick) return;
    this.opt.audio?.tap?.();
    if (this.forgetMode) {
      this.beginEdit();
      const gone = this.padForget(item);
      if (gone) this.padChanged();
      else this.popEdit();
      this.padRender();
      return;
    }
    // 文から持ち上げた語なら、箱へ戻す (タップだけで外せる)。
    if (this.held) {
      const held = this.held;
      this.held = null;
      this.beginEdit();
      const r = this.padReturn(held.place);
      if (r.ok) {
        this.msg = `「${this.padTextOf(held.word)}」を戻した。`;
        this.padChanged();
      } else {
        this.popEdit();
        this.msg = '戻せなかった。';
        this.opt.audio?.broken?.();
      }
      this.padRender();
      return;
    }
    this.armed = this.armed === item ? null : item;
    this.held = null;
    this.padRender();
  }

  /** 選んだ語を置き場へ入れる。 */
  placeInto(place) {
    const item = this.armed;
    this.armed = null;
    if (!item) return { ok: false, reason: 'noword' };
    this.beginEdit();
    const r = this.padInsert(place, item);
    if (r.ok) {
      this.msg = `「${this.padTextOf(item)}」を入れた。`;
      this.opt.audio?.phrase?.();
    } else {
      this.popEdit();
      const sen = this.padSenOf(place);
      this.msg = r.reason === 'len'
        ? `文は ${sen ? sen.maxLen : 10} 文字まで。「${this.padTextOf(item)}」は ${this.padTextOf(item).length} 文字なので入らない。`
        : `「${this.padTextOf(item)}」は置けなかった (${r.reason})。`;
      this.opt.audio?.broken?.();
    }
    this.padChanged();
    this.padRender();
    return r;
  }

  /** 持ち上げた語を置き場へ移す。元の位置には残る。 */
  moveHeldTo(place) {
    const held = this.held;
    if (!held) return { ok: false, reason: 'noword' };
    // 持ち上げた語をもう一度タップしたら、元のまま戻す。
    if (this.padKeyOf(place) === this.padKeyOf(held.place)) {
      this.held = null;
      this.opt.audio?.tap?.();
      this.padRender();
      return { ok: true, reason: 'same' };
    }
    this.held = null;
    this.beginEdit();
    const r = this.padMove(held.place, place);
    if (r.ok) {
      this.msg = `「${this.padTextOf(held.word)}」を移した。`;
      if (this.padIsPool(place)) this.opt.audio?.uns?.();
      else this.opt.audio?.worn?.({ active: true });
    } else {
      this.popEdit();
      this.msg = r.reason === 'len' ? `文は ${this.padSenOf(place)?.maxLen ?? 10} 文字まで。` : '語を移せなかった。';
      this.opt.audio?.broken?.();
    }
    this.padChanged();
    this.padRender();
    return r;
  }

  /** 文の語をタップ。接続詞を 1 つ進める (選んでいる語があれば置く)。 */
  onWordTap(place) {
    if (this.suppressClick) return;
    if (this.armed) return this.placeInto(place);
    if (this.held) return this.moveHeldTo(place);
    this.beginEdit();
    const r = this.padCycle(place);
    if (!r.ok) this.popEdit();
    this.focusPlace = { ...place };
    if (r.text) this.opt.audio?.phrase?.();
    else if (r.reason === 'none') this.opt.audio?.broken?.();
    else this.opt.audio?.tap?.();
    this.armed = null;
    this.padChanged();
    this.padRender();
  }

  /** 文の余白 (語を末尾へ入れる場所) をタップ。 */
  onGapTap(place) {
    if (this.suppressClick) return;
    if (this.armed) return this.placeInto(place);
    if (this.held) return this.moveHeldTo(place);
    this.opt.audio?.tap?.();
    this.padRender();
    return { ok: false, reason: 'none' };
  }

  /** 文の中の語を持ち上げる。 */
  pickUp(place) {
    const word = this.padWordAt(place);
    if (!word) return;
    this.held = { word, place: { ...place } };
    this.armed = null;
    this.opt.audio?.tap?.();
    this.padRender();
  }

  /** 「忘れる」モードの切り替え。 */
  toggleForget() {
    this.forgetMode = !this.forgetMode;
    if (this.forgetMode) this.armed = null;
    this.padRender();
  }

  // ── 取り消し ────────────────────────────────────────────────────────────

  /** 変更の前に控えを積む。失敗したら popEdit() で捨てる。 */
  beginEdit() {
    const s = this.padSnapshot();
    if (s == null) return;
    this.undoStack.push(s);
    if (this.undoStack.length > 40) this.undoStack.shift();
  }

  popEdit() { this.undoStack.pop(); }

  /** 直前の操作を戻す。 */
  undo() {
    const s = this.undoStack.pop();
    if (s == null) {
      this.msg = '戻せる操作がない。';
      this.padRender();
      return { ok: false, reason: 'empty' };
    }
    this.armed = null;
    this.held = null;
    this.padRestore(s);
    this.msg = '直前の操作を戻した。';
    this.opt.audio?.tap?.();
    this.padChanged();
    this.padRender();
    return { ok: true, reason: 'undone' };
  }

  // ── 接続詞の一覧 ────────────────────────────────────────────────────────

  /** 接続詞を選ぶメニューを開く。候補 (＋なし) を一発で選べる。 */
  openConnPicker(place, anchor) {
    this.closeConnPicker();
    if (this.armed || this.held) return this.onWordTap(place);
    const sen = this.padSenOf(place);
    const e = sen && sen.at(place.index);
    if (!e) return null;
    const opts = sen.connOptions(place.index);
    const cur = e.conn ? e.conn.text : null;
    const menu = el('div', { class: 'conn-picker' });
    const phrase = opts.map((c) => sen.connForm(place.index, c)).find((h) => h && h.compound);
    menu.append(el('div', { class: 'conn-picker-head' },
      phrase ? `${e.word.text} の直後 (熟語「${phrase.source}」)` : `${e.word.text} の直後`));
    const list = el('div', { class: 'conn-pick-list' });
    const add = (text, label) => {
      const b = el('button', {
        class: 'conn-pick' + (text === cur ? ' cur' : ''),
        type: 'button',
        title: connTitle(e.word.text, text, sen.connForm(place.index, text)),
      }, el('span', {}, label));
      b.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        this.pickConnector(place, text);
      });
      list.append(b);
    };
    add(null, 'なし');
    for (const c of opts) add(c, c);
    menu.append(list);
    list.addEventListener('scroll', () => this.hintConnScroll(list));
    document.body.append(menu);
    try {
      const cEl = list.querySelector('.cur');
      if (cEl && list.clientHeight && list.scrollHeight > list.clientHeight && cEl.offsetTop != null) {
        list.scrollTop = cEl.offsetTop - (list.clientHeight - cEl.offsetHeight) / 2;
      }
    } catch { /* 初回位置は出なくても支障はない */ }
    try {
      const r = anchor.getBoundingClientRect();
      const h = menu.getBoundingClientRect?.().height || 0;
      const below = (r.bottom ?? 0) + 6;
      const top = (h && below + h > (window.innerHeight || 0))
        ? Math.max(4, (r.top ?? 0) - h - 6) : below;
      menu.style.left = `${Math.max(4, Math.round(r.left ?? 0))}px`;
      menu.style.top = `${Math.round(top)}px`;
    } catch { /* 位置が取れなければそのまま */ }
    this.pickerEl = menu;
    return menu;
  }

  /** スクロールで中心に来た候補を強調する。決定はタップで行う。 */
  hintConnScroll(list) {
    try {
      const kids = [...list.children];
      if (!kids.length || !list.clientHeight) return;
      const mid = (list.scrollTop || 0) + list.clientHeight / 2;
      let best = null, bd = Infinity;
      for (const k of kids) {
        const d = Math.abs((k.offsetTop || 0) + (k.offsetHeight || 0) / 2 - mid);
        if (d < bd) { bd = d; best = k; }
      }
      if (best && !best.classList.contains('snap')) {
        for (const x of kids) x.classList.remove('snap');
        best.classList.add('snap');
      }
    } catch { /* 本物の DOM でだけ動く */ }
  }

  /** メニューから接続詞を選んで付ける。null なら外す。 */
  pickConnector(place, text) {
    this.closeConnPicker();
    this.beginEdit();
    const r = this.padSetConn(place, text || null);
    if (!r || !r.ok) {
      this.popEdit();
      this.msg = `接続詞は付けられなかった (${r?.reason || 'error'})。`;
      this.opt.audio?.broken?.();
    } else {
      this.msg = text ? `接続詞「${text}」を付けた。` : '接続詞を外した。';
      this.focusPlace = { ...place };
      this.opt.audio?.phrase?.();
    }
    this.padChanged();
    this.padRender();
    return r;
  }

  closeConnPicker() {
    if (this.pickerEl?.parentNode) this.pickerEl.parentNode.removeChild(this.pickerEl);
    this.pickerEl = null;
  }

  // ── ドラッグ ────────────────────────────────────────────────────────────
  //
  // Pointer Events で自前実装する。HTML5 の drag & drop はタップ端末で
  // 動かない。少し動くまでドラッグを始めないので、いつものタップは選択になる。

  /** ドラッグ開始とみなす移動量 (px)。 */
  static get DRAG_SLOP() { return 7; }

  /** 長押しとみなす時間 (ms)。押したままの語は接続詞の一覧を出す。 */
  static get HOLD_MS() { return 480; }

  /** タップで選べるようにする。 */
  makeTappable(node, onTap) {
    node.addEventListener('pointerdown', (ev) => {
      this.downAt.set(node, { x: ev.clientX, y: ev.clientY });
      ev.stopPropagation();
    }, true);
    node.addEventListener('pointerup', (ev) => {
      if (this.suppressClick || this.dragFrom) return;
      const d = this.downAt.get(node);
      if (!d) return;
      this.downAt.delete(node);
      if (Math.abs(ev.clientX - d.x) > SenPad.DRAG_SLOP) return;
      if (Math.abs(ev.clientY - d.y) > SenPad.DRAG_SLOP) return;
      ev.stopPropagation();
      onTap();
    });
    node.addEventListener('pointercancel', () => this.downAt.delete(node));
  }

  /** ドラッグを始める要素につける。タップでの選択も兼ねる。 */
  makeDraggable(node, place, onTap, onHold) {
    node.draggable = false;
    node.addEventListener('dragstart', (ev) => ev.preventDefault());

    node.addEventListener('pointerdown', (ev) => {
      if (ev.button !== undefined && ev.button > 0) return;
      const sx = ev.clientX, sy = ev.clientY;
      const pid = ev.pointerId;
      let dragging = false;
      let held = false;
      let holdTimer = null;
      const dropHold = () => {
        if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
      };

      if (onHold) {
        holdTimer = setTimeout(() => {
          holdTimer = null;
          held = true;
          detach();
          onHold();
        }, SenPad.HOLD_MS);
      }

      const onMove = (e) => {
        if (e.pointerId !== pid) return;
        if (!dragging) {
          if (Math.hypot(e.clientX - sx, e.clientY - sy) < SenPad.DRAG_SLOP) return;
          dragging = true;
          dropHold();
          this.dragFrom = place;
          this.held = null;
          this.armed = null;
          // この瞬間に描き直してはいけない (pointerup が届かなくなる)。
          for (const root of this.padScope()) {
            for (const n of root.querySelectorAll?.('.armed') || []) n.classList.remove('armed');
          }
          this.clearDropMarks();
          this.startGhost(node, place, sx, sy, e.clientX, e.clientY);
        }
        e.preventDefault();
        this.moveGhost(e.clientX, e.clientY);
        this.markDropAt(e.clientX, e.clientY);
      };

      const detach = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', finish);
        window.removeEventListener('pointercancel', cancel);
      };
      const finish = (e) => {
        if (e.pointerId !== pid) return;
        detach();
        dropHold();
        this.clearDropMarks();
        this.endGhost();
        if (!dragging) {
          if (!held && onTap) onTap();
          return;
        }
        const from = this.dragFrom;
        const to = this.dropAt(e.clientX, e.clientY);
        this.dragFrom = null;
        this.suppressClick = true;
        setTimeout(() => { this.suppressClick = false; }, 0);
        if (from && to) this.dropOnto(from, to);
        else this.padRender();
      };
      const cancel = (e) => {
        if (e.pointerId !== pid) return;
        detach();
        dropHold();
        this.clearDropMarks();
        this.endGhost();
        this.dragFrom = null;
        this.padRender();
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', finish);
      window.addEventListener('pointercancel', cancel);
    });
  }

  /** ドラッグ中の語の影を作り、指の下へ追従させる。 */
  startGhost(node, place, sx, sy, cx, cy) {
    this.endGhost();
    const word = this.padWordAt(place);
    const ghost = el('div', { class: 'drag-ghost' },
      el('span', { class: 'dg-word' }, this.padTextOf(word)));
    const conn = this.padConnAt(place);
    if (conn) ghost.append(el('span', { class: 'dg-conn' }, this.padTextOf(conn)));
    document.body.append(ghost);
    const r = node.getBoundingClientRect?.() || { left: 0, top: 0 };
    this.ghost = ghost;
    this.ghostOff = { x: sx - (r.left || 0), y: sy - (r.top || 0) };
    const src = node.parentNode?.classList?.contains('sen-item') ? node.parentNode : node;
    src.classList.add('dragging');
    this.dragSrc = src;
    this.moveGhost(cx, cy);
  }

  moveGhost(x, y) {
    const g = this.ghost;
    if (!g) return;
    g.style.left = `${Math.round(x - this.ghostOff.x)}px`;
    g.style.top = `${Math.round(y - this.ghostOff.y)}px`;
  }

  endGhost() {
    if (this.ghost?.parentNode) this.ghost.parentNode.removeChild(this.ghost);
    this.ghost = null;
    if (this.dragSrc?.classList) this.dragSrc.classList.remove('dragging');
    this.dragSrc = null;
  }

  /** ドロップ先につける。 */
  makeDropTarget(node, place) {
    const key = this.padKeyOf(place);
    node.dataset.place = key;
    this.placeById.set(key, place);
  }

  /** 文の行の、x 座標にいちばん近い語の境目。 */
  indexAtX(row, x) {
    const items = [...row.children].filter((n) => n.classList?.contains('sen-item'));
    if (!items.length) return 0;
    for (let i = 0; i < items.length; i++) {
      const r = items[i].getBoundingClientRect();
      if (x <= r.left + r.width / 2) return i;
    }
    return items.length;
  }

  /** 座標の下にあるドロップ先。 */
  dropInfoAt(x, y) {
    const hit = document.elementFromPoint(x, y);
    if (!hit || !hit.closest) return null;

    // 語の箱のどこでも「箱へ戻す」受け皿にする。
    const pool = this.padPoolEl();
    if (pool) {
      if (!pool.dataset.padPool) pool.dataset.padPool = '1';
      const p = hit.closest('[data-pad-pool]');
      if (p && p === pool) return { place: this.padPoolPlace() };
    }

    // 文の行、または行を含む枠 (見出し・効果表示を含む) のどこでも受ける。
    let row = hit.closest('.sen-row');
    if (!row) {
      const host = hit.closest('[data-pad-row]');
      if (host) row = host.querySelector('.sen-row');
    }
    const rows = this.padRows();
    if (row && rows.has(row)) {
      const ctx = rows.get(row);
      const index = this.indexAtX(row, x);
      return { place: this.padPlaceAt(ctx, index), row, index };
    }

    const host = hit.closest('[data-place]');
    if (!host) return null;
    const place = this.placeById.get(host.dataset.place);
    return place ? { place } : null;
  }

  /** 座標の下にあるドロップ先 (互換 API)。 */
  dropAt(x, y) {
    return this.dropInfoAt(x, y)?.place || null;
  }

  /** 座標の下にあるドロップ先を光らせる。文の行なら挿入位置も示す。 */
  markDropAt(x, y) {
    const info = this.dropInfoAt(x, y);
    const place = info?.place;
    const id = place ? `${this.padKeyOf(place)}:${info.index ?? ''}` : '';
    if (id === this._hotId) return;
    this.clearDropMarks();
    this._hotId = id;
    if (!info) return;
    if (this.padIsPool(place)) {
      this.padPoolEl()?.classList.add('drop-hot');
      return;
    }
    const row = info.row;
    if (!row) return;
    row.classList.add('drop-hot');
    const items = [...row.children].filter((n) => n.classList?.contains('sen-item'));
    if (!items.length) {
      row.classList.add('drop-empty');
    } else if (items[info.index]) {
      items[info.index].classList.add('drop-before');
    } else {
      items[items.length - 1].classList.add('drop-after');
    }
  }

  clearDropMarks() {
    for (const root of this.padScope()) {
      for (const n of root.querySelectorAll?.('.drop-hot, .drop-before, .drop-after, .drop-empty') || []) {
        n.classList.remove('drop-hot', 'drop-before', 'drop-after', 'drop-empty');
      }
    }
    this._hotId = '';
  }

  /**
   * from の語を to へ運ぶ。
   * 文の行のどこに落としても、落とした x 座標に近い境目へ **差し込む**。
   * 語を置き換えたり入れ替えたりはしない。
   */
  dropOnto(from, to) {
    if (!from || !to) return;
    if (this.padIsPool(from) && this.padIsPool(to)) { this.padRender(); return; }
    if (this.padKeyOf(from) === this.padKeyOf(to)) { this.padRender(); return; }
    // 戻すときの語は、外す前にとっておく (後では取れない)。
    const movedText = this.padTextOf(this.padWordAt(from));
    this.beginEdit();
    let r;
    if (this.padIsPool(to)) {
      r = this.padReturn(from);
      if (r.ok) this.msg = `「${movedText}」を戻した。`;
    } else if (this.padIsPool(from)) {
      const item = this.padPoolItem(from.index);
      if (item == null) { this.popEdit(); this.padRender(); return; }
      r = this.padInsert(to, item);
    } else {
      r = this.padMove(from, to);
    }
    if (r && r.ok) {
      if (this.padIsPool(to)) this.opt.audio?.uns?.();
      else this.opt.audio?.worn?.({ active: true });
    } else {
      this.popEdit();
      this.opt.audio?.broken?.();
      this.msg = r?.reason === 'len'
        ? `文は ${this.padSenOf(to)?.maxLen ?? 10} 文字まで。その位置には入らない。`
        : '語を動かせなかった。';
    }
    this.padChanged();
    this.padRender();
  }

  /** 語の箱の index の語。派生クラスが実装する。 */
  padPoolItem() { return null; }
}

/**
 * 接続詞メニューの項目の説明。その語での役割を出す
 * (同じ「に」でも 焔に=格 / 妙に=連用)。熟語の形なら熟語ごと出す。
 * @param {string} wordText
 * @param {string|null} k 接続詞
 * @param {{compound:boolean, source:string, form:object}|null} hit
 */
export function connTitle(wordText, k, hit) {
  if (!k) return '接続詞を外す';
  const desc = CONNECTORS[k]?.desc || '';
  if (hit && hit.compound) {
    return `${hit.source}${k} — ${ROLE_LABEL[hit.form.role] || ''} (熟語「${hit.source}」の形)`;
  }
  const f = formOf({ text: wordText }, k);
  const head = f ? `${wordText}${k} — ${ROLE_LABEL[f.role] || ''}` : desc;
  return `${head}${desc && head !== desc ? `\n${desc}` : ''}`;
}
