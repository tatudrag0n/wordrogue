// ============================================================================
// ワードローグ — 言葉鍛冶 (文の組み立て画面)
//
// 枠に語を嵌めるのではない。語を自由に並べて文にする。
//   語彙の語を文の語へドラッグすると、その手前に差し込まれる (置き換えはしない)。
//   文の中の語はドラッグで並べ替えられる。語彙へ戻せば外れる。
//   文は語と語のあいだに空間を置かず、そのまま連結して見せる。
//
// 接続詞は語の直後に付く。語の横にあるだけなので、
// 文の並びを動かしても骨組みはそのまま残る。
//   語をタップするたびに、その語に付く接続詞が切り替わる。
//   候補はその語のプール (words.pool.js) だけ。一周すると「接続詞なし」になる。
//   例 「斬」→ る → られた → り → 無し
// 文は 10 文字まで。
// ============================================================================

import { $, el, clear } from '../core/util.js';
import {
  WORDS, CATEGORIES, CONNECTOR_LIST, possibleCompounds, evaluate, makeWord,
} from '../data/words.js';
import { CONNECTORS, CONNECT_ORDER, formOf, ROLE_LABEL } from '../data/words.connect.js';
import { KIND_LABEL, WEAPON_MAX } from '../data/weapons.js';
import { FX_LABEL, PS_LABEL } from './labels.js';
import { keyStats } from '../game/weapon.js';

/**
 * 置き場到现在の内容でキーを作る。描き直しても同じキーになるので、
 * ドロップ先の data-place は安定する。
 * @param {{kind:string,index:number,wi?:object}} place
 */
function placeKey(place) {
  if (place.kind === 'lexicon') return `L${place.index}`;
  return `W${place.wIdx ?? '?'}_${place.index}`;
}

const round = (v) => (Number.isInteger(v) ? v : Math.round(v * 100) / 100);

/** 語の体側の効果 (p.) を一行に。部位強化でだけ効く分。 */
function selfLine(player) {
  const out = [];
  for (const [k, v] of Object.entries(player || {})) {
    if (!v) continue;
    out.push(`${PS_LABEL[k] || k} ${v > 0 ? '+' : ''}${round(v)}`);
  }
  return out.join(' ');
}

/**
 * 語に付く接続詞のチップ。語チップのすぐ右に並べて「語の直後」を表す。
 * ここをタップしても、その語が持つ接続詞が切り替わる (語と同じ操作)。
 */
/** 接続詞メニューの説明。その語での役割を出す (同じ「に」でも 焔に=格 / 妙に=連用)。 */
/** 熟語に付く形 (発電する) なら熟語ごと出す。 */
function pickTitle(wordText, k, hit) {
  if (hit && hit.compound) {
    return `${hit.source}${k} — ${ROLE_LABEL[hit.form.role] || ''} (熟語「${hit.source}」の形)`;
  }
  const f = formOf({ text: wordText }, k);
  return f ? `${wordText}${k} — ${ROLE_LABEL[f.role] || ''}` : (CONNECTORS[k]?.desc || '');
}

function renderConnector(forge, place, conn) {
  const title = conn
    ? `接続詞「${conn.text}」 — ${CONNECTORS[conn.text]?.desc || ''}`
      + '\nタップ: 接続詞をメニューから選ぶ'
    : '接続詞なし。タップすると接続詞を選べる。'
      + '\n(語本体のタップで順に切り替えることもできる)';  
  const node = el('div', {
    class: conn ? 'sen-conn filled' : 'sen-conn empty',
    title,
  }, el('span', {}, conn ? conn.text : ''));
  // 接続詞のチップは一発で選べるメニューを開く。語本体は今まで通り順に回る。
  forge.makeTappable(node, () => forge.openConnPicker(place, node));
  return node;
}

export class Forge {
  /** @param {object} run */
  constructor(run, opt) {
    this.run = run;
    this.opt = opt;
    this.root = $('#forge');
    this.listEl = $('#forgeWeapons');
    this.lexiconEl = $('#forgeLexicon');
    // conn-pool は削除し、接続詞は語チップの直後に表示する。
    this.lexiconCount = $('#lexiconCount');
    this.detailEl = $('#forgeDetail');
    this.hintEl = $('#forgeHint');
    this.hintBtn = $('#btnForgeHint');
    this.forgetBtn = $('#btnForgeForget');

    /** @type {object|null} 語彙からタップで選んだ語。次に文をタップで置ける。 */
    this.armed = null;
    /** 文の中から長押しで持ち上げた語。 */
    this.held = null;
    /** 「忘れる」モード。語彙の語をタップすると捨てる。 */
    this.forgetMode = false;
    /** 直前の操作の結果 (空にした / 語を置いたときの delta)。詳細欄に出す。 */
    this.msg = null;
    /** 直前に接続詞を切り替えた語。使える接続詞を詳細欄に出すために持つ。 */
    this.focusPlace = null;
    this.hintOn = false;
    /** 直前の操作を戻すための控え (語・接続詞の並び)。 */
    this.undoStack = [];
    /** 武器ごとの熟語 (成立の瞬間に光らせるため、前回の状態を覚える)。 */
    this._idiomSeen = new Map();
    /** 開いた直後の初回描画では光らせない。 */
    this._idiomPrimed = false;
    /** 「戻す」ボタン。無い環境 (最小 DOM) では null。 */
    this.undoBtn = $('#btnForgeUndo');
    /** 接続詞を選ぶメニュー。開いている間だけ document.body に居る。 */
    this.pickerEl = null;

    /** ドラッグ中の置き場。 */
    this.dragFrom = null;
    /** data-place のキー -> 置き場。描き直すごとに作り直す。 */
    this.placeById = new Map();
    this._hotId = '';
    /** ドラッグした直後。タップの誤発火を防ぐ。 */
    this.suppressClick = false;
    /** ドラッグ中の語の影。document.body に置いて描画の作り直しを越える。 */
    this.ghost = null;
    /** 影と指の位置の差。掴んだ位置が抜けないようにする。 */
    this.ghostOff = null;
    /** 影の元になった要素 (薄く表示する)。 */
    this.dragSrc = null;
    /** ノード -> pointerdown を開始した位置。タップ判定の基点。 */
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
    this.undoBtn?.addEventListener('click', () => this.undo());
  }

  setRun(run) {
    this.run = run;
    this.armed = null;
    this.held = null;
    this.forgetMode = false;
    this.undoStack = [];
    this.closeConnPicker();
  }

  open() {
    this.armed = null;
    this.held = null;
    this._idiomSeen = new Map();
    this._idiomPrimed = false;
    this.forgetMode = false;
    this.undoStack = [];
    this.closeConnPicker();
    this.forgetBtn.classList.remove('on');
    this.root.hidden = false;
    this.run.paused = true;
    this.render();
  }

  close() {
    const wasOpen = this.isOpen;
    this.root.hidden = true;
    this.run.paused = false;
    this.closeConnPicker();
    this.undoStack = [];
    this.armed = null;
    this.held = null;
    this.forgetMode = false;
    this.forgetBtn.classList.remove('on');
    this.dragFrom = null;
    this.root.classList.remove('placing');
    this.endGhost();
    this.clearDropMarks();
    if (wasOpen) this.opt.onClose?.();
  }

  get isOpen() { return !this.root.hidden; }

  toggle() { this.isOpen ? this.close() : this.open(); }

  /** 画面を再描画する。 */
  render() {
    this.closeConnPicker();
    this.placeById.clear();
    this._hotId = '';
    if (this.undoBtn) this.undoBtn.disabled = this.undoStack.length === 0;
    // 語を選んだ状態。置き場が分かるよう、文の行をやや目立たせる。
    this.root.classList.toggle('placing', !!this.armed || !!this.held);
    this.renderWeapons();
    this.renderLexicon();
    this.renderDetail();
    if (this.hintOn) this.renderHint();
  }

  /** 置き場が属する文 (武器の文)。 */
  senOf(place) {
    if (!place || place.kind === 'lexicon') return null;
    return place.wi ? place.wi.sentence : null;
  }

  /** 置き場に置かれている語。 */
  wordAt(place) {
    if (!place) return null;
    if (place.kind === 'lexicon') return this.run.lexicon[place.index] || null;
    const sen = this.senOf(place);
    const e = sen && sen.at(place.index);
    return e ? e.word : null;
  }

  /**
   * 熟語を構成している語の位置 (文中の index の集合)。
   * 評価結果の文面から熟語の文字範囲を割り出し、語ごとに重なるかで決める。
   * 接続詞 (発電「する」など) は直前の語の一部として扱う。
   */
  idiomWordIndices(sen, ev) {
    const out = new Set();
    const phrase = ev?.idiom?.phrase;
    if (!phrase || !ev?.text) return out;
    const at = ev.text.indexOf(phrase);
    if (at < 0) return out;
    const end = at + phrase.length;
    let pos = 0;
    sen.entries.forEach((e, i) => {
      const wLen = e.word.text.length;
      if (pos < end && pos + wLen > at) out.add(i);
      pos += wLen + (e.conn ? e.conn.text.length : 0);
    });
    return out;
  }

  /** 武器語から作った文を 1 本外す。固定の武器 (刃・銃…) は外せない。 */
  dropWeaponRow(wi) {
    if (this.suppressClick) return { ok: false, reason: 'ignore' };
    this.beginEdit();
    const r = this.run.dropWeapon(wi);
    if (r.ok) {
      this.msg = `文「${wi.title || wi.def.name}」を外した — ${r.returned} 語を語彙へ戻す。`;
      this.armed = null;
      this.held = null;
      this.opt.audio?.tap?.();
    } else {
      this.popEdit();
      this.msg = r.reason === 'fixed'
        ? 'はじめから持っている武器の文は外せない。語を入れ替えて使ってください。'
        : 'もう 1 本足りない — 文を外すと攻撃しなくなる。';
      this.opt.audio?.broken?.();
    }
    this.opt.onChange?.();
    this.render();
    return r;
  }

  /**
   * 文を 1 行に並べる。語と、その直後の接続詞。
   * 語と語のあいだには何も置かない (隙間も「＋」も出さない)。
   * 語を足す位置は文の末尾だけ。
   */
  renderSentenceRow(sen, opt = {}) {
    const row = el('div', { class: 'sen-row' });
    const wordKind = 'slot';

    // 文の末尾にだけ置く追加位置。ドラッグでの語の置き換えはしない。
    const appendPlace = {
      kind: 'gap', index: sen.entries.length, wi: opt.wi || null, wIdx: opt.wIdx,
    };
    const addNode = el('div', {
      class: 'sen-gap sen-add',
      title: 'タップ / ドロップで末尾に語を足す',
    }, el('span', {}, '＋'));
    this.makeDropTarget(addNode, appendPlace);
    this.makeTappable(addNode, () => this.onGapTap(appendPlace));

    sen.entries.forEach((e, i) => {
      const place = { kind: wordKind, index: i, wi: opt.wi || null, wIdx: opt.wIdx };
      row.append(this.renderWordChip(e, place, opt.idiomIdx?.has(i), opt.idiomName));
    });
    row.append(addNode);
    // 末尾語 (「人」) は枠の外に固定で付く。
    if (sen.tailText) {
      row.append(el('div', {
        class: 'sen-word sen-tail',
        title: `「${sen.tailText}」— 固定で付きます。外せません。`,
      }, el('span', {}, sen.tailText)));
    }
    return row;
  }

  /** 文の中の 1 語。右に、その語の直後の接続詞が付く。 */
  renderWordChip(entry, place, inIdiom = false, idiomName = '') {
    const w = entry.word;
    const conn = entry.conn;
    const cat = CATEGORIES[w.cat] || CATEGORIES.modifier;
    const isArmed = (this.armed && this.armed === w) || (this.held && this.held.word === w);
    const isHeld = !!(this.held && this.held.word === w);
    const chip = el('div', {
      class: 'sen-word' + (isArmed ? ' armed' : '') + (isHeld ? ' held' : '')
        + (inIdiom ? ' idiom-word' : ''),
      style: inIdiom ? {} : { borderColor: cat.color },
      title: `${w.text} [${cat.name}]`
        + (inIdiom ? `\n熟語「${idiomName}」を構成する語` : '')
        + `\nタップ: 後ろの接続詞を切り替える`
        + `\n長押し: 接続詞の一覧 (スクロールで選ぶ)`
        + `\nドラッグ: 並べ替える / 語彙へ戻す (語の置き換えはしない)`
        + `\n使える接続詞: ${this.connListText(entry, place)}`,
    }, el('span', {}, w.text));
    // 長押しは「持ち上げ」から接続詞の一覧へ (要求)。並べ替えはドラッグで行う。
    this.makeDraggable(chip, place, () => this.onWordTap(place), () => this.openConnPicker(place, chip));

    // 接続詞は語の直後に置く。語と同じタップで切り替わる。
    const connChip = renderConnector(this, place, conn);

    // 語を語彙へ戻すのは、語を語彙へドラッグする操作に一本化した (✕ は使わない)。

    // 「語 + 接続詞」をひとまとまりの語として扱う。
    // data-place もここに乗せるので、接続詞にポインタが出ても語として拾う。
    const item = el('div', { class: 'sen-item' }, chip, connChip);
    this.makeDropTarget(item, place);
    return item;
  }

  /** 文の中の語を語彙へ戻す。語彙が満杯なら語彙の最古の 1 語を捨てる。 */
  returnWord(place) {
    if (this.suppressClick) return { ok: false, reason: 'ignore' };
    const word = this.run.wordAtPlace(place);
    if (!word) return { ok: false, reason: 'empty' };
    this.held = null;
    this.armed = null;
    this.beginEdit();
    const r = this.run.toLexicon(word);
    if (r.ok) {
      this.msg = `「${word.text}」を語彙へ戻した。`;
      this.opt.audio?.tap?.();
    } else {
      this.popEdit();
      this.msg = r.reason === 'full'
        ? '語彙が満杯。文から語を外せない。'
        : `「${word.text}」は戻せなかった (${r.reason})。`;
      this.opt.audio?.broken?.();
    }
    this.opt.onChange?.();
    this.render();
    return r;
  }

  /** その語に使える接続詞の並び (ヒント用)。 */
  connListText(entry, place) {
    const sen = this.senOf(place);
    if (!sen) return '—';
    const opts = sen.connOptions(place.index);
    if (!opts.length) return 'なし';
    const cur = entry.conn ? entry.conn.text : 'なし';
    return `${opts.join(' → ')} → なし (今: ${cur})`;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 戻す (取り消し) と接続詞のメニュー
  //
  // 語を 1 つ置くにも、接続詞を狙った形にするにも、以前は何度も叩く必要が
  // あった。ここでは (1) 直前の操作を 1 タップで戻せるようにし、
  // (2) 接続詞はメニューから一発で選べるようにする。
  // ───────────────────────────────────────────────────────────────────────────

  /** いまの文の状態を控える。語と接続詞を文字列で持つ。 */
  snapshot() {
    const dump = (sen) => sen.entries.map((e) => [e.word.text, e.conn ? e.conn.text : null]);
    return {
      lexicon: this.run.lexicon.map((w) => (w ? w.text : null)),
      weapons: this.run.weapons.map((wi) => dump(wi.sentence)),
    };
  }

  /** 控えた状態に戻す。 */
  restore(s) {
    const load = (sen, ents) => {
      sen.entries = ents.map(([w, c]) => ({ word: makeWord(w), conn: c ? makeWord(c) : null }));
    };
    this.run.lexicon = s.lexicon.map((t) => (t ? makeWord(t) : null));
    s.weapons.forEach((ents, i) => {
      const wi = this.run.weapons[i];
      if (!wi) return;
      load(wi.sentence, ents);
      wi._sig = null;
    });
    this.run.refreshStats();
  }

  /** 変更の前に控えを積む。失敗したら popEdit() で捨てる。 */
  beginEdit() {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > 40) this.undoStack.shift();
  }

  /** 何も変わらなかった変更の控えを捨てる。 */
  popEdit() { this.undoStack.pop(); }

  /** 直前の操作を戻す。 */
  undo() {
    const s = this.undoStack.pop();
    if (!s) {
      this.msg = '戻せる操作がない。';
      this.render();
      return { ok: false, reason: 'empty' };
    }
    this.armed = null;
    this.held = null;
    this.restore(s);
    this.msg = '直前の操作を戻した。';
    this.opt.audio?.tap?.();
    this.opt.onChange?.();
    this.render();
    return { ok: true, reason: 'undone' };
  }

  /** 接続詞を選ぶメニューを開く。候補 (＋なし) を一発で選べる。 */
  openConnPicker(place, anchor) {
    this.closeConnPicker();
    if (this.armed || this.held) return this.onWordTap(place);
    const sen = this.senOf(place);
    const e = sen && sen.at(place.index);
    if (!e) return null;
    const opts = sen.connOptions(place.index);
    const cur = e.conn ? e.conn.text : null;
    const menu = el('div', { class: 'conn-picker' });
    // 直前の語と熟語になっていれば見出しに出す (「発電」の直後 → する が選べる)。
    const phrase = opts.map((c) => sen.connForm(place.index, c)).find((h) => h && h.compound);
    menu.append(el('div', { class: 'conn-picker-head' },
      phrase ? `${e.word.text} の直後 (熟語「${phrase.source}」)` : `${e.word.text} の直後`));
    // 候補は縦 1 列に並べてスクロールできるようにする (要求)。
    // 指で押せる高さに取り、スクロールで中心に来た候補を少し強調する。
    const list = el('div', { class: 'conn-pick-list' });
    const add = (text, label) => {
      const b = el('button', {
        class: 'conn-pick' + (text === cur ? ' cur' : ''),
        type: 'button',
        title: text ? pickTitle(e.word.text, text, sen.connForm(place.index, text)) : '接続詞を外す',
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
    // いまの接続詞 (無ければ「なし」) を最初に見せる。中心に来るよう合わせる。
    // 本物の DOM でだけ動かす。偽 DOM では位置合わせを飛ばす。
    try {
      const cEl = list.querySelector('.cur');
      if (cEl && list.clientHeight && list.scrollHeight > list.clientHeight
        && cEl.offsetTop != null) {
        list.scrollTop = cEl.offsetTop - (list.clientHeight - cEl.offsetHeight) / 2;
      }
    } catch { /* 初回位置は出なくても支障はない */ }
    // チップの下に出す。画面外なら上へ逃がす。
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
    } catch { /* 本物の DOM でだけ動く。偽 DOM では何もしない */ }
  }

  /** メニューから接続詞を選んで付ける。null なら外す。 */
  pickConnector(place, text) {
    this.closeConnPicker();
    this.beginEdit();
    const r = this.run.setConnAt(place, text ? makeWord(text) : null);
    if (!r || !r.ok) {
      this.popEdit();
      this.msg = `接続詞は付けられなかった (${r?.reason || 'error'})。`;
      this.opt.audio?.broken?.();
    } else {
      this.msg = text ? `接続詞「${text}」を付けた。` : '接続詞を外した。';
      this.focusPlace = { ...place };
      this.opt.audio?.phrase?.();
    }
    this.opt.onChange?.();
    this.render();
    return r;
  }

  /** 接続詞のメニューを閉じる。 */
  closeConnPicker() {
    if (this.pickerEl?.parentNode) this.pickerEl.parentNode.removeChild(this.pickerEl);
    this.pickerEl = null;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 武器の文
  // ───────────────────────────────────────────────────────────────────────────
  renderWeapons() {
    const list = this.listEl;
    clear(list);

    if (this.run.weapons.length < WEAPON_MAX) {
      const row = el('div', { class: 'wrow wrow-empty' });
      const btn = el('button', { class: 'btn btn-primary', type: 'button' },
        `＋ 新しい武器を作る（あと ${WEAPON_MAX - this.run.weapons.length} つ）`);
      this.makeTappable(btn, () => {
        const r = this.run.createBlankWeapon();
        if (r.ok) { this.opt.audio?.tap?.(); this.render(); }
      });
      row.append(btn);
      row.append(el('span', { class: 'muted' },
        '作った文は空。語彙の語を並べて文を組み立てると攻撃できる。'));
      list.append(row);
    }

    let anyBorn = false;
    for (const [n, wi] of this.run.weapons.entries()) {
      const res = wi.resolve(this.run.player.stats);
      // 熟語が新しく成立した瞬間だけ、行ごと光らせる。
      const phrase = res.evalResult.idiom?.phrase || null;
      const born = this._idiomPrimed && !!phrase && this._idiomSeen.get(n) !== phrase;
      this._idiomSeen.set(n, phrase);
      if (born) anyBorn = true;
      const row = el('div', {
        class: 'wrow' + (res.active ? ` ${res.grade}` : res.pending ? ' pending' : ' broken')
          + (born ? ' idiom-born' : ''),
      });

      const head = el('div', { class: 'wrow-head' },
        // 武器名 (文面) は語の並びそのものなので、ここでは表示しない (要求)。
        el('span', { class: 'wrow-kind' }, KIND_LABEL[res.kind] || res.kind),
        el('span', { class: 'wrow-lv' }, `${wi.sentence.len} / ${wi.sentence.maxLen} 文字`),
        res.tail
          ? el('span', { class: 'wrow-kind' }, res.special ? `特殊武器 ${res.tail}` : `武器語 ${res.tail}`)
          : wi.def.special
            ? el('span', { class: 'wrow-kind dim' }, '特殊武器 動詞待ち')
            : el('span', { class: 'wrow-kind dim' }, '武器語なし'),
        el('span', { class: `wrow-grade grade-${res.grade}` },
          res.active ? res.gradeInfo.name : '不成文'),
      );
      // 武器語から作った文は、ここで行ごと外せる。外すと語は語彙へ戻る。
      // (3 本が埋まったまま空いた文だけ残して新しい武器語が取れない、を防ぐ)
      if (wi.def.isForm) {
        const dropBtn = el('button', {
          class: 'wrow-drop', type: 'button',
          title: 'この文を外す。入っている語は語彙へ戻る',
          'aria-label': `${wi.def.name} の文を外す`,
        }, el('span', {}, '文を外す'));
        this.makeTappable(dropBtn, () => this.dropWeaponRow(wi));
        head.append(dropBtn);
      }
      // 並び直すときに全部戻すのはタップ 1 回で済むようにする。
      if (wi.sentence.count) {
        const clearBtn = el('button', {
          class: 'wrow-clear', type: 'button',
          title: 'この文の語をすべて語彙へ戻す',
          'aria-label': `${wi.def.name} の文を空にする`,
        }, el('span', {}, '空にする'));
        this.makeTappable(clearBtn, () => this.clearSentence(wi.sentence));
        head.append(clearBtn);
      }
      row.append(head);

      if (!res.active) {
        row.append(el('div', { class: 'wrow-why' },
          res.pending
            ? `${res.reasonText} — まだ攻撃しません。`
            : `${res.reasonText} — この武器は攻撃しません。語を足してください。`));
      } else if (res.evalResult.idiom) {
        row.append(el('div', { class: 'wrow-why', style: { color: 'var(--idiom)' } },
          `熟語「${res.evalResult.idiom.name}」成立 — ${res.evalResult.idiom.desc}`
          + `（熟語ボーナス 文力 +${res.evalResult.phraseBonus.toFixed(2)}）`));
      }

      row.append(this.renderSentenceRow(wi.sentence, {
        wi, wIdx: n,
        idiomIdx: this.idiomWordIndices(wi.sentence, res.evalResult),
        idiomName: res.evalResult.idiom?.name || '',
      }));
      if (res.active) row.append(this.renderNatural(res.evalResult));
      row.append(this.renderStats(res));
      list.append(row);
    }
    if (anyBorn) this.opt.audio?.phrase?.();
    this._idiomPrimed = true;
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
    if (res.evalResult) {
      wrap.append(el('span', { class: 'stat nat' }, `自然さ ${res.evalResult.natural.toFixed(2)}`));
    }
    return wrap;
  }

  /** 自然さの内訳。加点も減点も出すので、どの語を足せば強くなるかが分かる。 */
  renderNatural(ev) {
    const box = el('div', { class: 'wrow-nat' });
    box.append(el('span', { class: 'nat-total' }, `自然さ ${ev.natural.toFixed(2)}`));
    for (const p of ev.naturalParts) {
      box.append(el('span', { class: p.v >= 0 ? 'nat-plus' : 'nat-minus' },
        `${p.label} ${p.v > 0 ? '+' : ''}${p.v.toFixed(2)}`));
    }
    return box;
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

    for (const [i, w] of this.run.lexicon.entries()) {
      if (!w) {
        box.append(el('div', { class: 'pword empty' }, ''));
        continue;
      }
      const cat = CATEGORIES[w.cat] || CATEGORIES.modifier;
      const info = WORDS[w.text];
      const node = el('div', {
        class: 'pword'
          + (this.armed === w ? ' armed' : '')
          + (this.forgetMode ? ' forgetable' : '')
          + (w.cat === 'form' ? ' is-form' : '')
          // 体に効く効果 (p.) を持つ語は、部位強化でもそのまま効く
          + (info?.player ? ' is-self' : ''),
        style: { borderColor: cat.color },
        title: this.forgetMode
          ? `${w.text} を忘れる（捨てる）`
          : `${w.text} [${cat.name}]\nタップで選んで、文の語や隙間をタップすると置けます。`
            + (info?.player ? `\n体にも効く: ${selfLine(info.player)}` : ''),
      }, el('span', {}, w.text));
      const n = counts.get(w.text);
      if (n > 1) node.append(el('span', { class: 'pword-n' }, `×${n}`));
      const place = { kind: 'lexicon', index: i };
      this.makeDropTarget(node, place);
      if (this.forgetMode) this.makeTappable(node, () => this.onLexiconClick(w));
      else this.makeDraggable(node, place, () => this.onLexiconClick(w));
      // 武器語 (基本武器) と属性語・現象語は、この語から新しい文を作れる。
      // 形態語 (弾・環・玉…) は武器語ではないので + が出ない。
      const canCraft = !this.forgetMode && this.run.canCraftFromWord(w);
      if (canCraft) node.append(this.renderCraftButton(w, info));
      box.append(node);
    }

    const filled = this.run.lexicon.filter(Boolean).length;
    this.lexiconCount.textContent = `${filled} / ${this.run.lexicon.length}`;
    this.lexiconCount.classList.toggle('full', this.run.lexiconFull);
    this.forgetBtn.classList.toggle('on', this.forgetMode);
    this.forgetBtn.textContent = this.forgetMode ? '忘れる (タップで捨てる)' : '忘れる';
    this.forgetBtn.disabled = filled === 0;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 詳細
  // ───────────────────────────────────────────────────────────────────────────
  renderDetail() {
    const d = this.detailEl;
    clear(d);

    // 直前の操作の結果。失敗した理由や、戻した語数を黙って捨てない。
    if (this.msg) {
      d.append(el('span', { class: 'dt msg' }, this.msg));
    }

    // 直前に接続詞を切り替えた語。その語に使える接続詞を全部見せる。
    // (どれが使えるかを毎回覚える必要をなくす。)
    if (!this.armed && !this.held && this.focusPlace) {
      const fw = this.run.wordAtPlace(this.focusPlace);
      const fsen = this.senOf(this.focusPlace);
      const fe = fsen && fsen.at(this.focusPlace.index);
      if (fw && fe) {
        d.append(el('span', { class: 'dt' }, `${fw.text}  ${fe.conn ? `接続詞 ${fe.conn.text}` : '接続詞なし'}`));
        d.append(el('span', { class: 'dl conn-list' },
          `この語に使える接続詞: ${this.connListText(fe, this.focusPlace)}`));
      }
    }

    const sel = this.armed || (this.held && this.held.word) || null;
    if (!sel) {
      d.append(el('span', { class: 'dt' }, '文の中に語を自由に置く'));
      d.append(el('span', { class: 'dl' },
        '語彙の語を文の語へドラッグすると、その手前に差し込める。'
        + '語をタップしてから文の語をタップしても置ける。'
        + 'ドラッグで語を置き換えることはしない。'));
      d.append(el('span', { class: 'dl' },
        '文の語は語彙へドラッグすると戻せる。 ✕ でも戻せる。'
        + '文の中の語は長押しで持ち上げ、タップだけで並べ替えられる。'));
      d.append(el('span', { class: 'dl' },
        '接続詞は語の右のマスをタップ → 使える接続詞を一覧から一発で選べる。'
        + '語本体のタップで順に回すこともできる。'));
      d.append(el('span', { class: 'dl' },
        '「戻す」で直前の操作を 1 つ戻せる。'));
      return;
    }
    if (this.held) {
      d.append(el('span', { class: 'dt' }, `${sel.text}  持ち上げ中`));
      d.append(el('span', { class: 'dl' },
        '文の語か末尾の＋をタップで移動。語彙をタップで語彙へ戻す。'
        + 'もう一度この語をタップで元のまま。'));
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
    if (info?.player) parts.push(`体 ${selfLine(info.player)}`);
    d.append(el('span', { class: 'dl' }, parts.length ? parts.join('  ') : '効果なし'));
    // 文の中にあるときだけ、その語に使える接続詞を全部見せる。
    // （語をタップすると一周する。どれが使えるかを毎回覚える必要をなくす。）
    const loc = this.run.findWordAnywhere(sel);
    if (loc && loc.where !== 'lexicon') {
      const place = { kind: 'slot', wi: loc.wi, wIdx: this.run.weapons.indexOf(loc.wi), index: loc.index };
      const sen = this.senOf(place);
      const e = sen && sen.at(loc.index);
      if (e) {
        d.append(el('span', { class: 'dl conn-list' },
          `この語に使える接続詞: ${this.connListText(e, place)}`));
      }
    }
    if (info?.cat === 'element' || info?.cat === 'phenom') {
      d.append(el('span', { class: 'dl' },
        '属性・現象の語。語彙の右の＋でこの語を頭にした文 (特殊武器) を作れる。'
        + '攻撃できる動詞を述べると撃つようになる。'));
    } else if (info?.cat === 'form') {
      d.append(el('span', { class: 'dl' },
        '形態語。文に置いて効果で支えるただの語 (武器語ではない)。'
        + '武器語 (3 択で得られる) は刃・剣・刀・斧・槍・矛・牙・爪・弓・鞭・鎖・杖・拳・銃の 14 語だけ。'));
    } else {
      d.append(el('span', { class: 'dl' }, '文に置ける。並べた並びで文の力が上がる。'));
    }
  }

  renderHint() {
    const h = this.hintEl;
    clear(h);

    const have = new Set();
    for (const w of this.run.lexicon) if (w) have.add(w.text);
    for (const wi of this.run.weapons) for (const w of wi.sentence.words) have.add(w.text);

    h.append(el('p', {}, '接続詞 (送り仮名) は語ごとに決まっていて、直前の語にだけ付きます。'
      + '語をタップすると、その語の接続詞だけが順に切り替わり、一周したら無しになります。'
      + '連体 (〜る・〜い・〜な) は名詞を修飾し、連用 (〜く・〜に・〜り) は動詞・形容を修飾します。'
      + '「〜を」のあとには動作が要ります。'));
    const ROLE = { adn: '連体 (名詞を修飾)', adv: '連用 (動詞・形容を修飾)', case: '格' };
    const ct = el('table', { class: 'grammar' });
    for (const c of CONNECT_ORDER) {
      const info = CONNECTORS[c];
      ct.append(el('tr', {},
        el('td', { class: 'hc' }, c),
        el('td', {}, [...info.roles].map((r) => ROLE[r] || r).join(' / ')),
      ));
    }
    h.append(ct);

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

  /**
   * 語彙の語につける「＋ 文を作る」ボタン。
   * 押すとその語を頭にした新しい武器の文が生まれる (最大 3 本)。
   * 属性語・現象語なら **特殊武器** — 攻撃できる動詞を述語に足すまで撃たない。
   */
  renderCraftButton(word, info) {
    const special = info?.cat === 'element' || info?.cat === 'phenom';
    const b = el('button', {
      class: 'pword-craft' + (special ? ' special' : ''), type: 'button',
      title: special
        ? `${word.text} — 特殊武器の文を作る (動詞を述べると撃てる)`
        : `${word.text} — この語で新しい武器の文を作る`,
      'aria-label': `${word.text} で新しい文を作る`,
    }, el('span', {}, '＋'));
    this.makeTappable(b, () => this.craftFrom(word));
    return b;
  }

  /** 語を 1 つ使って新しい文を作る。語彙から語は移動する (消えない)。 */
  craftFrom(word) {
    if (this.suppressClick) return { ok: false, reason: 'ignore' };
    this.beginEdit();
    const r = this.run.craftWeaponFrom(word);
    if (r.ok) {
      this.msg = r.kind === 'special'
        ? `特殊武器「${word.text}」の文を作った — 攻撃できる動詞を述べると撃てる。`
        : `「${word.text}」で新しい文を作った。`;
      this.armed = null;
      this.held = null;
      this.opt.audio?.worn?.(r.wi ? r.wi.resolve(this.run.player.stats) : { active: true });
    } else {
      this.popEdit();
      this.msg = r.reasonText || `「${word.text}」からは文を作れない (${r.reason})。`;
      this.opt.audio?.broken?.();
    }
    this.opt.onChange?.();
    this.render();
    return r;
  }

  /** 語彙の語をタップ。選ぶか、忘れるモードなら捨てる。 */
  onLexiconClick(word) {
    if (this.suppressClick) return;
    this.opt.audio?.tap?.();
    if (this.forgetMode) {
      this.beginEdit();
      const gone = this.run.forgetWord(word);
      if (gone) {
        if (!this.run.lexiconFreeCount) this.forgetMode = false;
        this.opt.onChange?.();
      } else {
        this.popEdit();
      }
      this.render();
      return;
    }
    // 文から持ち上げた語なら、語彙へ戻す (タップだけで外せる)。
    if (this.held) {
      const held = this.held;
      this.held = null;
      const r = this.run.toLexicon(held.word);
      if (r.ok) {
        this.opt.audio?.tap?.();
        this.opt.onChange?.();
      } else {
        this.opt.audio?.broken?.();
      }
      this.render();
      return;
    }
    this.armed = this.armed === word ? null : word;
    this.held = null;
    this.render();
  }

  /** 文の語を全部語彙へ戻す (「空にする」ボタン)。 */
  clearSentence(sen) {
    if (this.suppressClick) return { ok: false, reason: 'ignore' };
    if (!sen || !sen.count) return { ok: false, reason: 'empty' };
    this.held = null;
    this.armed = null;
    this.beginEdit();
    // 後ろから戻す。語彙が満杯なら最古の 1 語が捨てる (toLexicon と同じ規則)。
    const left = [...sen.words];
    let n = 0;
    for (let i = left.length - 1; i >= 0; i--) {
      if (left[i] && this.run.toLexicon(left[i]).ok) n++;
    }
    this.msg = n ? `文を空にした — ${n} 語を語彙へ戻した。` : '文を空にした。';
    this.opt.audio?.tap?.();
    this.opt.onChange?.();
    this.render();
    return { ok: true, reason: 'cleared', count: n };
  }

  /** 文の中の語を持ち上げる (長押し)。 */
  pickUp(place) {
    const word = this.run.wordAtPlace(place);
    if (!word) return;
    this.held = { word, place: { ...place } };
    this.armed = null;
    this.opt.audio?.tap?.();
    this.render();
  }

  /** 選んだ語を文の place へ入れる。 */
  placeInto(place) {
    const word = this.armed;
    this.armed = null;
    if (!word) return { ok: false, reason: 'noword' };
    const sen = this.senOf(place);
    this.beginEdit();
    const r = this.run.insertInto(sen, place.index, word, place.wi || null);
    if (r.ok) {
      this.msg = `「${word.text}」を文に入れた。`;
      this.opt.audio?.worn?.(place.wi ? place.wi.resolve(this.run.player.stats) : { active: true });
    } else {
      this.popEdit();
      // 入れたのに何も起きない を無くす。理由を出す。
      this.msg = r.reason === 'len'
        ? `文は ${sen ? sen.maxLen : 10} 文字まで。「${word.text}」は ${word.text.length} 文字なので入らない。`
        : `「${word.text}」は置けなかった (${r.reason})。`;
      this.opt.audio?.broken?.();
    }
    this.opt.onChange?.();
    this.render();
    return r;
  }

  /** 持ち上げた語を place へ移す。元の位置には残る。 */
  moveHeldTo(place) {
    const held = this.held;
    if (!held) return { ok: false, reason: 'noword' };
    // 持ち上げた語をもう一度タップしたら、元のまま戻す。
    if (place.kind === held.place.kind && place.index === held.place.index
      && (place.wi || null) === (held.place.wi || null)) {
      this.held = null;
      this.opt.audio?.tap?.();
      this.render();
      return { ok: true, reason: 'same' };
    }
    this.held = null;
    this.beginEdit();
    const r = this.run.moveWordTo(held.place, place);
    if (r.ok) {
      this.opt.audio?.worn?.(place.wi ? place.wi.resolve(this.run.player.stats) : { active: true });
    } else {
      this.popEdit();
      this.opt.audio?.broken?.();
    }
    this.opt.onChange?.();
    this.render();
    return r;
  }

  /** 文の中の語をタップ。 */
  onWordTap(place) {
    if (this.suppressClick) return;
    if (this.armed) return this.placeInto(place);
    if (this.held) return this.moveHeldTo(place);
    this.beginEdit();
    const r = this.run.cycleConnector(place);
    if (!r.ok) this.popEdit();
    this.focusPlace = { ...place };
    if (r.text) this.opt.audio?.phrase?.();
    else if (r.reason === 'none') this.opt.audio?.broken?.();
    else this.opt.audio?.tap?.();
    this.armed = null;
    this.opt.onChange?.();
    this.render();
  }

  /** 文の隙間 (語を入れる場所) をタップ。 */
  onGapTap(place) {
    if (this.suppressClick) return;
    if (this.armed) return this.placeInto(place);
    if (this.held) return this.moveHeldTo(place);
    this.opt.audio?.tap?.();
    this.render();
    return { ok: false, reason: 'none' };
  }

  /** 「忘れる」モードの切り替え。語彙の語をタップすると捨てる。 */
  toggleForget() {
    this.forgetMode = !this.forgetMode;
    if (this.forgetMode) this.armed = null;
    this.forgetBtn.classList.toggle('on', this.forgetMode);
    this.render();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // ドラッグで移動・並べ替え
  //
  // Pointer Events で自前実装する。HTML5 の drag & drop はタップ端末で
  // 動かない。draggable な要素をタップすると click ではなく native drag が
  // 始まって、語を選べなくなる。pointer ならマウスとタッチで同じ動き。
  // 少し動くまでドラッグ開始しないので、いつものタップは普通の選択になる。
  // ───────────────────────────────────────────────────────────────────────────

  /** ドラッグ開始とみなす移動量 (px)。 */
  static get DRAG_SLOP() { return 7; }

  /** 長押しとみなす時間 (ms)。押したままの語は接続詞の一覧を出す。 */
  static get HOLD_MS() { return 480; }

  /** タップで選べるようにする。 */
  makeTappable(node, onTap) {
    node.addEventListener('pointerdown', (ev) => {
      this.downAt.set(node, { x: ev.clientX, y: ev.clientY });
      // タップ用の要素 (＋ や ✕) を掴んで語のドラッグを始めない。
      ev.stopPropagation();
    }, true);
    node.addEventListener('pointerup', (ev) => {
      if (this.suppressClick || this.dragFrom) return;
      const d = this.downAt.get(node);
      if (!d) return;
      this.downAt.delete(node);
      if (Math.abs(ev.clientX - d.x) > Forge.DRAG_SLOP) return;
      if (Math.abs(ev.clientY - d.y) > Forge.DRAG_SLOP) return;
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
          // onHold は画面を作り直すので pointerup が届かない。
          // 先に window の監視を外さないと関数がたまる。
          detach();
          onHold();
        }, Forge.HOLD_MS);
      }

      const onMove = (e) => {
        if (e.pointerId !== pid) return;
        if (!dragging) {
          if (Math.hypot(e.clientX - sx, e.clientY - sy) < Forge.DRAG_SLOP) return;
          dragging = true;
          dropHold();
          this.dragFrom = place;
          this.held = null;
          // この瞬間に render() してはいけない。DOM が作り直され、
          // pointerup が届かない。選択状態だけ直接落とす。
          this.armed = null;
          for (const n of this.root.querySelectorAll('.armed')) n.classList.remove('armed');
          this.clearDropMarks();
          // 掴んでいる語は指へ追従させる。元の DOM には残さないので、
          // 描画を作り直しても消えないよう body に置く。
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
          // 長押しなら onHold が走っている。タップは実行しない。
          if (!held && onTap) onTap();
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
      const cancel = (e) => {
        if (e.pointerId !== pid) return;
        detach();
        dropHold();
        this.clearDropMarks();
        this.endGhost();
        this.dragFrom = null;
        this.render();
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', finish);
      window.addEventListener('pointercancel', cancel);
    });
  }

  /**
   * ドラッグ中の語の影を作り、指の下へ追従させる。
   * 元の要素は薄くして、影が「掴んでいるもの」として見えるようにする。
   */
  startGhost(node, place, sx, sy, cx, cy) {
    this.endGhost();
    const word = this.run.wordAtPlace(place);
    const ghost = el('div', { class: 'drag-ghost' },
      el('span', { class: 'dg-word' }, word ? word.text : ''));
    const conn = this.run.connAt(place);
    if (conn) ghost.append(el('span', { class: 'dg-conn' }, conn.text));
    document.body.append(ghost);
    const r = node.getBoundingClientRect();
    this.ghost = ghost;
    // 掴んだ位置のままだと指先から語がぶら下がるので、同じ比率を保つ。
    this.ghostOff = { x: sx - r.left, y: sy - r.top };
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

  /** ドロップ先につける。座標から探し出せるよう data-place を振る。 */
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
   * from の語を to へ運ぶ。
   *
   * 文の語の上に落としても置き換えない。落とした位置へ差し込み、
   * 元からある語はそのまま残す。語彙へ落とせば語彙へ戻る。
   * 語彙どうしは動かさない (並びを入れ替えない)。
   */
  dropOnto(from, to) {
    if (!from || !to) return;
    if (from.kind === to.kind && from.index === to.index
      && (from.wi || null) === (to.wi || null)) {
      this.render();
      return;
    }
    if (from.kind === 'lexicon' && to.kind === 'lexicon') {
      this.render();
      return;
    }
    let r;
    let wi = null;
    this.beginEdit();
    if (from.kind === 'lexicon' && to.kind !== 'lexicon') {
      const word = this.run.lexicon[from.index];
      if (!word) { this.popEdit(); this.render(); return; }
      wi = to.kind === 'slot' || to.kind === 'gap' ? to.wi : null;
      // 置き換えはしない。落とした位置に差し込む。
      r = this.run.insertInto(this.senOf(to), to.index, word, wi);
    } else if (from.kind !== 'lexicon' && to.kind === 'lexicon') {
      // 文 → 語彙は、落としたマスが埋まっていても語彙の空きへ戻す。
      // 満杯なら最古の 1 語が語彙から消える (run.toLexicon が処理する)。
      const word = this.wordAt(from);
      if (!word) { this.popEdit(); this.render(); return; }
      r = this.run.toLexicon(word);
      if (r.ok) this.msg = `「${word.text}」を語彙へ戻した。`;
    } else {
      // 文 → 文は並べ替え。語を置き換えるのではなく、並びを動かす。
      wi = from.kind === 'slot' || from.kind === 'gap' ? from.wi
        : (to.kind === 'slot' || to.kind === 'gap' ? to.wi : null);
      r = this.run.swapPlaces(from, to);
    }
    if (r && r.ok) {
      this.opt.audio?.worn?.(wi ? wi.resolve(this.run.player.stats) : { active: true });
    } else {
      this.popEdit();
      this.opt.audio?.broken?.();
      this.msg = r?.reason === 'len'
        ? '文は 10 文字まで。その位置には入らない。'
        : '語を動かせなかった。';
    }
    this.opt.onChange?.();
    this.render();
  }
}
