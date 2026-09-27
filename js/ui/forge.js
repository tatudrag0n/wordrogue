// ============================================================================
// ワードローグ — 言葉鍛冶 (武器の組み立て画面)
//
// 語をクリックして選ぶ -> 枠をクリックで装着。戦闘中でも使える。
// 開いている間、時間は止まる。
//
// 武器の枠のほか、プレイヤー自身の文の枠もある。
// 武器名はその文そのもの (「爆裂無双雷剣」) になる。
// ============================================================================

import { $, el, clear } from '../core/util.js';
import { WORDS, CATEGORIES, CONNECTOR_SET, possibleCompounds, evaluate, makeWord } from '../data/words.js';
import { CONNECTORS, SOURCES_BY_CONNECTOR } from '../data/words.connect.js';
import { KIND_LABEL } from '../data/weapons.js';
import { SELF_TAIL } from '../game/stats.js';
import { keyStats } from '../game/weapon.js';

/**
 * 置き場到现在の内容でキーを作る。描き直しても同じキーになるので、
 * ドロップ先の data-place は安定する。
 * @param {{kind:string,index:number,wi?:object}} place
 */
function placeKey(place) {
  if (place.kind === 'lexicon') return `L${place.index}`;
  if (place.kind === 'self') return `S${place.index}`;
  return `W${place.wIdx ?? '?'}_${place.index}`;
}

export class Forge {
  /**
   * @param {object} run
   * @param {{onClose:Function, onChange:Function, audio:object}} opt
   */
  constructor(run, opt) {
    this.run = run;
    this.opt = opt;
    this.root = $('#forge');
    this.listEl = $('#forgeWeapons');
    this.lexiconEl = $('#forgeLexicon');
    this.lexiconCount = $('#lexiconCount');
    this.detailEl = $('#forgeDetail');
    this.hintEl = $('#forgeHint');
    this.hintBtn = $('#btnForgeHint');
    this.forgetBtn = $('#btnForgeForget');

    /** @type {object|null} 選択中の語 */
    this.armed = null;
    /** 「忘れる」モード。語彙の語をクリックすると捨てる。 */
    this.forgetMode = false;
    this.hintOn = false;

    /** ドラッグ中の置き場。{kind, index, wi} */
    this.dragFrom = null;
    /** data-place のキー -> 置き場。描き直すごとに作り直す。 */
    this.placeById = new Map();
    this._hotId = '';
    /** ドラッグした直後。タップの誤発火を防ぐ。 */
    this.suppressClick = false;
    /**
     * ノード -> pointerdown を 시작한位置。タップ判定の基点。
     * インスタンスで 1 個持ちだと、隣のノードで始めたジェスチャの
     * pointerup が古い基点と比べる羽目になって、語を勝手に動かす。
     * @type {WeakMap<HTMLElement, {x:number,y:number}>}
     */
    this.downAt = new WeakMap();

    $('#forgeClose').addEventListener('click', () => this.close());
    $('#forgeBack').addEventListener('click', () => this.close());
    this.hintBtn.addEventListener('click', () => {
      this.hintOn = !this.hintOn;
      this.hintEl.hidden = !this.hintOn;
      this.render();
    });
    this.forgetBtn.addEventListener('click', () => {
      this.opt.audio?.tap?.();
      this.toggleForget();
    });
  }

  setRun(run) { this.run = run; this.armed = null; this.forgetMode = false; }

  open() {
    this.armed = null;
    this.forgetMode = false;
    this.forgetBtn.classList.remove('on');
    this.root.hidden = false;
    this.run.paused = true;
    this.render();
  }

  close() {
    this.root.hidden = true;
    this.run.paused = false;
    this.armed = null;
    this.forgetMode = false;
    this.forgetBtn.classList.remove('on');
    this.dragFrom = null;
    this.clearDropMarks();
    this.opt.onClose?.();
  }

  get isOpen() { return !this.root.hidden; }

  toggle() { this.isOpen ? this.close() : this.open(); }

  /** 画面を再描画する。 */
  render() {
    // ドロップ先の表は描画ごとに作り直す。
    this.placeById.clear();
    this._hotId = '';
    // suppressClick と downAt はここでは触らない。ドラッグ終了で立てた
    // suppressClick を render() が消すと、移動先のタップで語が動く。
    this.renderWeapons();
    this.renderLexicon();
    this.renderDetail();
    if (this.hintOn) this.renderHint();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 武器と自身の文
  // ───────────────────────────────────────────────────────────────────────────
  renderWeapons() {
    const list = this.listEl;
    clear(list);

    list.append(this.renderSelfRow());

    for (const [n, wi] of this.run.weapons.entries()) {
      const res = wi.resolve(this.run.player.stats);
      const row = el('div', {
        class: 'wrow' + (res.active ? ` ${res.grade}` : ' broken'),
      });

      // 見出し。武器名はそのまま文面。
      const head = el('div', { class: 'wrow-head' },
        el('span', { class: 'wrow-name' }, wi.title || wi.def.name),
        el('span', { class: 'wrow-kind' }, wi.def.name),
        el('span', { class: 'wrow-lv' }, `Lv ${wi.level} / ${wi.def.maxLevel}`),
        el('span', { class: 'wrow-kind' }, KIND_LABEL[res.kind] || res.kind),
        el('span', {
          class: `wrow-grade grade-${res.grade}`,
        }, res.active ? res.gradeInfo.name : '不成文'),
      );
      row.append(head);

      if (!res.active) {
        row.append(el('div', { class: 'wrow-why' },
          `${res.reasonText} — この武器は攻撃しません。語を足してください。`));
      } else if (res.evalResult.idiom) {
        row.append(el('div', { class: 'wrow-why', style: { color: 'var(--idiom)' } },
          `熟語「${res.evalResult.idiom.name}」成立 — ${res.evalResult.idiom.desc}`));
      }
      if (res.active && res.evalResult.predicated) {
        row.append(el('div', { class: 'wrow-why', style: { color: '#8ab4ff' } },
          '述語あり — 文の力が上がる。'));
      }

      row.append(this.renderSlots(
        { slots: wi.slots, tail: wi.tail, kind: 'slot', wi, wIdx: n },
        (i) => this.onSlotClick(wi, i)));
      row.append(this.renderSentence(wi, res));
      row.append(this.renderStats(res));
      list.append(row);
    }
  }

  /**
   * 枠を並べる。onClick(i) でクリックを処理する。
   * 末尾語は枠の外に固定で付くので、触れない (ドラッグも受けない)。
   * @param {{slots:Array, tail?:string, kind?:string, wi?:object, wIdx?:number}} wi
   * @param {(i:number)=>void} onClick
   */
  renderSlots(wi, onClick) {
    const kind = wi.kind || 'slot';
    const slots = el('div', { class: 'slots' });
    wi.slots.forEach((word, i) => {
      const isArmed = this.armed && word && this.armed === word;
      const cls = 'slot'
        + (word ? ' filled' : '')
        + (this.armed ? ' drop' : '')
        + (isArmed ? ' armed' : '');
      const node = el('div', { class: cls, title: word ? `${word.text} を戻す` : '空の枠' },
        word
          ? el('span', {}, word.text)
          : el('span', { class: 'empty-mark' }, '＿'));
      const place = { kind, index: i, wi: wi.wi, wIdx: wi.wIdx };
      // 入ってる語は「タップで選択 + ドラッグで移動」、空の枠はタップのみ。
      if (word) this.makeDraggable(node, place, () => onClick(i));
      else this.makeTappable(node, () => onClick(i));
      this.makeDropTarget(node, place);
      slots.append(node);
      if (i < wi.slots.length - 1) slots.append(el('span', { class: 'slot-plus' }, '+'));
    });
    // 末尾語。枠の外に固定で付くので触れない。
    if (wi.tail) {
      slots.append(el('span', { class: 'slot-plus' }, '+'));
      slots.append(el('div', {
        class: 'slot slot-tail',
        title: `${wi.tail} — この武器の末尾語。枠の外に固定で付きます。`,
      }, el('span', {}, wi.tail)));
    }
    return slots;
  }

  /**
   * プレイヤー自身の文。「頑強疾走人」のような称号を作る。
   */
  renderSelfRow() {
    const p = this.run.player;
    const filled = p.selfSlots.filter(Boolean);
    // 末尾の「人」も含めて文を評価する (resolvePlayerStats と同じ)。
    const ev = evaluate([...filled, makeWord(SELF_TAIL)], { minContent: 3 });
    const row = el('div', { class: 'wrow wrow-self' + (ev.valid ? ' ' + ev.grade : ' broken') });

    row.append(el('div', { class: 'wrow-head' },
      el('span', { class: 'wrow-name' }, p.stats.selfTitle || '自身'),
      el('span', { class: 'wrow-kind' }, '称号'),
      el('span', { class: 'wrow-grade grade-' + (ev.valid ? ev.grade : 'broken') },
        ev.valid ? ev.gradeInfo.name : '不成文'),
    ));

    if (!ev.valid && filled.length) {
      row.append(el('div', { class: 'wrow-why' },
        `${ev.reasonText} — 枠の語を 2 つ以上並べると文になる。`));
    }

    row.append(this.renderSlots(
      { slots: p.selfSlots, tail: SELF_TAIL, kind: 'self' },
      (i) => this.onSelfSlotClick(i)));

    // 文面。末尾の「人」は枠の外に固定で付く。
    const joined = p.selfSlots.filter(Boolean).map((w) => w.text).join('') + SELF_TAIL;
    const right = el('span', { class: 'sn-res' },
      el('span', { class: 'sn-eq' }, '= '),
      el('b', { class: 'sn-text' }, joined || '—'),
    );
    if (ev.valid) {
      right.append(el('span', { class: 'sn-seg' },
        ev.segments.map((s) => el('i', { class: `sg ${catClass({ text: s })}` }, s))));
    }
    row.append(el('div', { class: 'sentence' }, right));

    // 乗っている自身の効果。
    const fx = [];
    for (const w of p.selfSlots) {
      if (!w || !w.player) continue;
      for (const [k, v] of Object.entries(w.player)) {
        fx.push(`${PS_LABEL[k] || k}${v > 0 ? '+' : ''}${Math.round(v * 100) / 100}`);
      }
    }
    const stats = el('div', { class: 'wrow-stats' });
    for (const t of fx) stats.append(el('span', { class: 'stat up' }, t));
    if (ev.valid) {
      stats.append(el('span', { class: 'stat idom' }, `文の力 x${p.stats.selfPower.toFixed(2)}`));
    }
    if (stats.childNodes.length) row.append(stats);
    return row;
  }

  /**
   * 文面を表示する。枠の語を区切って連結した結果と、その分割結果。
   * 接続詞と動詞は色が変わるので、どれが骨組みでどれが中身かが分かる。
   */
  renderSentence(wi, res) {
    const wrap = el('div', { class: 'sentence' });

    // 枠の語を + でつないで並べる。
    const parts = el('span', { class: 'sn-parts' });
    wi.slots.forEach((w, i) => {
      if (i > 0) parts.append(el('span', { class: 'sn-plus' }, '+'));
      parts.append(w
        ? el('span', { class: `sn-w ${catClass(w)}`, title: WORDS[w.text]?.cat || '' }, w.text)
        : el('span', { class: 'sn-empty' }, '＿'));
    });
    wrap.append(parts);

    // 連結した結果。末尾語は枠の外に付くので必ず含まれる。
    const joined = wi.fullText !== undefined
      ? wi.fullText
      : wi.slots.filter(Boolean).map((w) => w.text).join('');
    const right = el('span', { class: 'sn-res' },
      el('span', { class: 'sn-eq' }, '= '),
      el('b', { class: 'sn-text' }, joined || '—'),
    );
    if (res.active) {
      right.append(el('span', { class: 'sn-seg' },
        res.evalResult.segments.map((s) => el('i', {
          class: `sg ${catClass({ text: s })}`,
        }, s))));
      if (res.evalResult.predicated) {
        right.append(el('span', { class: 'sn-pred' }, '述語'));
      }
    }
    wrap.append(right);
    return wrap;
  }

  renderStats(res) {
    const wrap = el('div', { class: 'wrow-stats' });
    if (!res.active) {
      wrap.append(el('span', { class: 'stat bad' }, '出力なし'));
      return wrap;
    }
    for (const s of keyStats(res.stats)) {
      const cls = s.key === 'dmg' ? 'stat up' : 'stat';
      wrap.append(el('span', { class: cls }, `${s.label} ${s.value}`));
    }
    if (res.evalResult?.idiom) {
      wrap.append(el('span', { class: 'stat idom' }, `熟語 ${res.evalResult.idiom.name}`));
    }
    return wrap;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 語彙
  // ───────────────────────────────────────────────────────────────────────────
  renderLexicon() {
    const box = this.lexiconEl;
    clear(box);

    const counts = new Map();
    for (const w of this.run.lexicon) {
      if (w) counts.set(w.text, (counts.get(w.text) || 0) + 1);
    }

    // 走査の添字を使う。indexOf だと同じ語が複数あるとき全部が
    // 先頭の添字に寄って、ドラッグの drop 先がおかしくなる。
    for (const [i, w] of this.run.lexicon.entries()) {
      if (!w) {
        box.append(el('div', { class: 'pword empty' }, ''));
        continue;
      }
      const cat = CATEGORIES[w.cat] || CATEGORIES.modifier;
      const conn = CONNECTOR_SET.has(w.text);
      const node = el('div', {
        class: 'pword'
          + (this.armed === w ? ' armed' : '')
          + (conn ? ' pword-conn' : '')
          + (this.forgetMode ? ' forgetable' : ''),
        style: { borderColor: cat.color },
        title: this.forgetMode
          ? `${w.text} を忘れる（捨てる）`
          : `${w.text} [${cat.name}]${conn ? ' — 接続詞。直前の語に結合する。' : ''}\n枠へドラッグして装着できます。`,
      }, el('span', {}, w.text));
      const n = counts.get(w.text);
      if (n > 1) node.append(el('span', { class: 'pword-n' }, `×${n}`));
      const place = { kind: 'lexicon', index: i };
      // 語彙は「ドラッグ元」でもある。枠から語を戻すときの目標になる。
      this.makeDropTarget(node, place);
      // 「忘れる」モードではドラッグ元にしない (捨てるのが目的なので)。
      if (this.forgetMode) this.makeTappable(node, () => this.onLexiconClick(w));
      else this.makeDraggable(node, place, () => this.onLexiconClick(w));
      box.append(node);
    }

    const filled = this.run.lexicon.filter(Boolean).length;
    const full = this.run.lexiconFull;
    this.lexiconCount.textContent = `${filled} / ${this.run.lexicon.length}`;
    this.lexiconCount.classList.toggle('full', full);
    this.forgetBtn.classList.toggle('on', this.forgetMode);
    this.forgetBtn.textContent = this.forgetMode ? '忘れる (クリックで捨てる)' : '忘れる';
    this.forgetBtn.disabled = filled === 0;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 詳細
  // ───────────────────────────────────────────────────────────────────────────
  renderDetail() {
    const d = this.detailEl;
    clear(d);

    const sel = this.armed;
    if (!sel) {
      d.append(el('span', { class: 'dt' }, '語を選んでから枠をクリック'));
      d.append(el('span', { class: 'dl' }, '語彙か武器か自身の枠。枠を空けると文が崩れる。'));
      return;
    }

    const info = WORDS[sel.text];
    const cat = CATEGORIES[info?.cat] || CATEGORIES.modifier;
    d.append(el('span', { class: 'dt' }, `${sel.text}  [${cat.name}]`));

    const fx = info?.fx || {};
    const parts = [];
    for (const [k, v] of Object.entries(fx)) {
      parts.push(`${FX_LABEL[k] || k} ${v > 0 ? '+' : ''}${round(v)}`);
    }
    if (info?.player) {
      for (const [k, v] of Object.entries(info.player)) {
        parts.push(`自身 ${PS_LABEL[k] || k} ${v > 0 ? '+' : ''}${round(v)}`);
      }
    }
    d.append(el('span', { class: 'dl' }, parts.length ? parts.join('  ') : '効果なし'));
    if (CONNECTOR_SET.has(sel.text)) {
      const srcs = CONNECTOR_SOURCES_OF(sel.text);
      d.append(el('span', { class: 'dl' },
        `接続詞。直前の語に結合する。優先順位 ${CONNECTORS[sel.text].pri}。`));
      d.append(el('span', { class: 'dl' },
        srcs.length ? `結合できる語: ${srcs.join('・')}` : '結合できる語はない (宙に浮く)。'));
    } else {
      d.append(el('span', { class: 'dl' }, '実質語。文の成立に必要。'));
    }
  }

  renderHint() {
    const h = this.hintEl;
    clear(h);

    const have = new Set();
    for (const w of this.run.lexicon) if (w) have.add(w.text);
    for (const wi of this.run.weapons) for (const w of wi.slots) if (w) have.add(w.text);
    for (const w of this.run.player.selfSlots) if (w) have.add(w.text);

    const list = possibleCompounds(have, 20);
    if (!list.length) {
      h.append(el('p', {}, '今の語では熟語を作れない。レベルアップで語が増える。'));
      return;
    }
    h.append(el('p', {}, `今の語で作れる熟語 (${list.length} 種):`));
    const table = el('table');
    for (const c of list) {
      table.append(el('tr', {},
        el('td', { class: 'hc' }, c.phrase),
        el('td', {}, c.needs.join('＋')),
        el('td', {}, c.desc),
      ));
    }
    h.append(table);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 操作
  // ───────────────────────────────────────────────────────────────────────────

  /** 語彙の語をクリック。選ぶか、忘れるモードなら捨てる。 */
  onLexiconClick(word) {
    if (this.suppressClick) return;
    this.opt.audio?.tap?.();
    if (this.forgetMode) {
      const gone = this.run.forgetWord(word);
      if (gone) {
        if (!this.run.lexiconFreeCount) this.forgetMode = false;
        this.opt.onChange?.();
      }
      this.render();
      return;
    }
    this.armed = this.armed === word ? null : word;
    this.render();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // ドラッグで移動・入れ替え
  //
  // Pointer Events で自前実装する。HTML5 の drag & drop はタップ端末で
  // 動かない。draggable な要素をタップすると click ではなく native drag が
  // 始まって、語を選べなくなる。pointer ならマウスとタッチで同じ動き。
  // 少し動くまでドラッグ開始しないので、いつものタップは普通の選択になる。
  // ───────────────────────────────────────────────────────────────────────────

  /** ドラッグ開始とみなす移動量 (px)。 */
  static get DRAG_SLOP() { return 7; }

  /**
   * タップで選べるようにする。
   *
   * click には頼らない。ブラウザが click を出さないことがあり
   * (touch-action / スクロール / preventDefault / native drag)、
   * そのたびに「クリックしても反応しない」になる。pointerup は
   * 確実に届くので、選択はそこで行う。
   *
   * @param {HTMLElement} node
   * @param {() => void} onTap
   */
  makeTappable(node, onTap) {
    // タップ判定の基点。pointerdown で記録する。
    node.addEventListener('pointerdown', (ev) => {
      this.downAt.set(node, { x: ev.clientX, y: ev.clientY });
    }, true);
    node.addEventListener('pointerup', (ev) => {
      // ドラッグ中や、直前のドラッグの余韻なら選ばない。
      if (this.suppressClick || this.dragFrom) return;
      // 自分で pointerdown を始めていないノードでは選ばない。
      // ドラッグの開始ノード以外で始まったジェスチャと区別する。
      const d = this.downAt.get(node);
      if (!d) return;
      this.downAt.delete(node);
      if (Math.abs(ev.clientX - d.x) > Forge.DRAG_SLOP) return;
      if (Math.abs(ev.clientY - d.y) > Forge.DRAG_SLOP) return;
      ev.stopPropagation();
      onTap();
    });
    // ジェスチャが中断されたら基点は残さない。
    node.addEventListener('pointercancel', () => this.downAt.delete(node));
  }

  /**
   * ドラッグを始める要素につける。タップでの選択も兼ねる。
   * makeTappable とは併用しない。選択は pointerup の finish で行う。
   *
   * pointermove / pointerup は window で受ける。開始ノードで受けておくと、
   * 指の先にセルが来ている間に離すと pointerup がそのセルに飛んで
   * finish が起きない。つまり実機ではドロップが確定しない。
   * @param {HTMLElement} node
   * @param {{kind:string,index:number,wi?:object}} place
   * @param {() => void} [onTap] タップしたとき (ドラッグしなかったとき) に呼ぶ
   */
  makeDraggable(node, place, onTap) {
    // HTML5 の drag は使わない。残しておくとタップを奪うので明示的に切る。
    node.draggable = false;
    node.addEventListener('dragstart', (ev) => ev.preventDefault());

    node.addEventListener('pointerdown', (ev) => {
      if (ev.button !== undefined && ev.button > 0) return;
      const sx = ev.clientX, sy = ev.clientY;
      const pid = ev.pointerId;
      let dragging = false;

      const onMove = (e) => {
        if (e.pointerId !== pid) return;
        if (!dragging) {
          if (Math.hypot(e.clientX - sx, e.clientY - sy) < Forge.DRAG_SLOP) return;
          dragging = true;
          this.dragFrom = place;
          // この瞬間に render() してはいけない。DOM が作り直され、
          // pointerup が届かない。選択状態だけ直接落とす。
          this.armed = null;
          for (const n of this.root.querySelectorAll('.armed')) n.classList.remove('armed');
          this.clearDropMarks();
        }
        e.preventDefault();
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
        this.clearDropMarks();
        if (!dragging) {
          // 動かさなかった = タップ。click ではなく pointerup で選ぶ。
          if (onTap) onTap();
          return;
        }
        const from = this.dragFrom;
        const to = this.dropAt(e.clientX, e.clientY);
        this.dragFrom = null;
        // ドラッグ終了直後のタップで二重に動かさない。
        this.suppressClick = true;
        setTimeout(() => { this.suppressClick = false; }, 0);
        if (from && to) this.dropOnto(from, to);
        else this.render();
      };
      // ブラウザや OS にジェスチャを奪われたときは何もしない。
      // dropOnto を呼ぶと、意図しないのに語が動く。
      const cancel = (e) => {
        if (e.pointerId !== pid) return;
        detach();
        this.clearDropMarks();
        this.dragFrom = null;
        this.render();
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', finish);
      window.addEventListener('pointercancel', cancel);
    });
  }

  /**
   * ドロップ先につける。座標から探し出せるよう data-place を振る。
   * 置き場の「内容」でキーを作るので、描き直しても同じ id になる。
   * @param {HTMLElement} node
   * @param {{kind:string,index:number,wi?:object}} place
   */
  makeDropTarget(node, place) {
    const key = placeKey(place);
    node.dataset.place = key;
    this.placeById.set(key, place);
  }

  /** 座標の下にあるドロップ先。 */
  dropAt(x, y) {
    const host = document.elementFromPoint(x, y)?.closest('[data-place]');
    if (!host) return null;
    return this.placeById.get(host.dataset.place) || null;
  }

  /** 座標の下にあるドロップ先を光らせる。 */
  markDropAt(x, y) {
    const host = document.elementFromPoint(x, y)?.closest('[data-place]');
    const id = host ? host.dataset.place : '';
    if (id === this._hotId) return;
    this.clearDropMarks();
    this._hotId = id;
    if (!id) return;
    const node = this.root.querySelector(`[data-place="${CSS.escape(id)}"]`);
    if (node) node.classList.add('drop-hot');
  }

  clearDropMarks() {
    for (const n of this.root.querySelectorAll('.drop-hot')) n.classList.remove('drop-hot');
    this._hotId = '';
  }

  /**
   * from の語を to へ移す。語彙 ⇄ 枠、枠 ⇄ 枠。
   * 語彙が満杯で語彙の埋まりが増えるときは入れ替えない。
   */
  dropOnto(from, to) {
    if (!from || !to) return;
    if (from.kind === to.kind && from.index === to.index && (from.wi || null) === (to.wi || null)) return;

    // 語彙 → 枠。空き枠なら普通の装着、埋まっていれば入れ替え (満杯ガードを通る)。
    if (from.kind === 'lexicon' && to.kind !== 'lexicon') {
      const word = this.run.lexicon[from.index];
      if (!word) return;
      const occupied = this.wordAt(to) !== null;
      const r = occupied ? this.run.swapPlaces(from, to)
        : to.kind === 'self'
          ? this.run.placeSelfWord(to.index, word)
          : this.run.placeWord(to.wi, to.index, word);
      if (r.ok) {
        const wi = to.kind === 'slot' ? to.wi : null;
        this.opt.audio?.worn?.(wi ? wi.resolve(this.run.player.stats) : { active: true });
      } else {
        this.opt.audio?.broken?.();
      }
      this.opt.onChange?.();
      this.render();
      return;
    }
    // 枠 → 語彙。空きセルなら語彙へ戻し、埋まっていれば入れ替え。
    if (from.kind !== 'lexicon' && to.kind === 'lexicon') {
      const word = this.wordAt(from);
      if (!word) return;
      const occupied = this.run.lexicon[to.index] != null;
      const r = occupied ? this.run.swapPlaces(from, to) : this.run.toLexicon(word);
      if (r.ok) this.opt.audio?.tap?.();
      else this.opt.audio?.broken?.();
      this.opt.onChange?.();
      this.render();
      return;
    }
    // 枠 ⇄ 枠 は入れ替え。
    const r = this.run.swapPlaces(from, to);
    if (r.ok) {
      const wi = from.kind === 'slot' ? from.wi : to.wi;
      this.opt.audio?.worn?.(wi ? wi.resolve(this.run.player.stats) : { active: true });
    } else {
      this.opt.audio?.broken?.();
    }
    this.opt.onChange?.();
    this.render();
  }

  /** 置き場にある語を取る。 */
  wordAt(place) {
    if (place.kind === 'lexicon') return this.run.lexicon[place.index] || null;
    if (place.kind === 'self') return this.run.player.selfSlots[place.index] || null;
    return place.wi.slots[place.index] || null;
  }

  /** 「忘れる」モードの切り替え。語彙の語をクリックすると捨てる。 */
  toggleForget() {
    this.forgetMode = !this.forgetMode;
    if (this.forgetMode) this.armed = null;
    this.forgetBtn.classList.toggle('on', this.forgetMode);
    this.render();
  }

  onSlotClick(wi, index) {
    if (this.suppressClick) return;
    if (this.armed) {
      const w = this.armed;
      this.armed = null;
      const r = this.run.placeWord(wi, index, w);
      this.opt.audio?.worn?.(wi.resolve(this.run.player.stats));
      this.opt.onChange?.();
      this.render();
      return r;
    }
    if (wi.slots[index]) {
      const r = this.run.toLexicon(wi.slots[index]);
      if (r.ok) this.opt.audio?.tap?.();
      else this.opt.audio?.broken?.();
      this.opt.onChange?.();
      this.render();
      return r;
    }
    return { ok: false, reason: 'empty' };
  }

  onSelfSlotClick(i) {
    if (this.suppressClick) return;
    const p = this.run.player;
    if (this.armed) {
      const w = this.armed;
      this.armed = null;
      const r = this.run.placeSelfWord(i, w);
      this.opt.audio?.worn?.({ active: true });
      this.opt.onChange?.();
      this.render();
      return r;
    }
    if (p.selfSlots[i]) {
      const r = this.run.toLexicon(p.selfSlots[i]);
      if (r.ok) this.opt.audio?.tap?.();
      else this.opt.audio?.broken?.();
      this.opt.onChange?.();
      this.render();
      return r;
    }
    return { ok: false, reason: 'empty' };
  }
}

const round = (v) => (Number.isInteger(v) ? v : Math.round(v * 100) / 100);

/** この接続詞に結合できる語を並べる。 */
function CONNECTOR_SOURCES_OF(conn) {
  return SOURCES_BY_CONNECTOR[conn] || [];
}

/** 語の種類から CSS クラスを作る。接続詞と動詞を区別する。 */
function catClass(w) {
  const info = WORDS[w?.text];
  if (!info) return 'sn-x';
  if (info.cat === 'connect') return 'sn-conn';
  if (info.cat === 'verb') return 'sn-verb';
  if (info.cat === 'buff') return 'sn-buff';
  return 'sn-n';
}

const FX_LABEL = {
  dmg: '威力', rate: '攻撃/秒', speed: '速さ', count: '数', pierce: '貫通',
  split: '分裂', bounce: '反射', chain: '連鎖', orbit: '回転数', size: '大きさ',
  area: '範囲', range: '間合い', arc: '扇', spread: '散り', crit: '会心',
  critDmg: '会心威力', homing: '追尾', duration: '持続', explode: '爆発',
  burn: '炎上', poison: '毒', chill: '減速', shock: '感電', freeze: '凍結',
  lifesteal: '吸血', regen: '回復', shield: 'シールド', knock: '撃退',
  recoil: '反動', magnet: '吸引', slowImmune: '減速耐性', reflect: '反射',
  armor: '装甲', power: '文力', atkMul: '攻撃', xpMul: '経験値',
  dmgMul: '威力', hpMul: '体力',
};

const PS_LABEL = {
  hp: '体力', spd: '移動', atk: '攻撃', armor: '装甲', crit: '会心',
  regen: '回復', lifesteal: '吸血', luck: '幸運', magnet: '吸引',
  xp: '経験値', size: '大きさ', shield: 'シールド', critDmg: '会心威力',
};
