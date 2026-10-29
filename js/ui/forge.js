// ============================================================================
// ワードローグ — 言葉鍛冶 (文の組み立て画面)
//
// 枠に語を嵌めるのではない。語を自由に並べて文にする。
//   語彙の語を文の行へドラッグすると、落とした x 座標に近い境目へ差し込む。
//   語の置き換えはしない。文の中の語はドラッグで並べ替えられる。
//   文の語を語彙の箱へドラッグすると語彙へ戻る。
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
} from '../data/words.js?v=1.43';
import { CONNECTORS, CONNECT_ORDER } from '../data/words.connect.js';
import { KIND_LABEL, WEAPON_MAX } from '../data/weapons.js?v=1.43';
import { FX_LABEL, PS_LABEL } from './labels.js';
import { keyStats } from '../game/weapon.js?v=1.43';
import { SenPad } from './senpad.js';

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

export class Forge extends SenPad {
  /** @param {object} run */
  constructor(run, opt) {
    super(opt);
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
    /** 文の行 -> その文の置き場。ドロップは行のどこでも受ける。 */
    this.senDropRows = this.rows;
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
    this.senDropRows.clear();
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
      this.opt.audio?.uns?.();
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
   * ドロップは行のどこでも受ける。落とした x 座標に近い語の境目へ入る。
   */
  renderSentenceRow(sen, opt = {}) {
    const row = el('div', { class: 'sen-row' });
    const wordKind = 'slot';
    const wIdx = opt.wIdx;
    const wi = opt.wi || null;

    // 文の行そのものがドロップ先。語の間の空白を狙わせない。
    if (wi) {
      row.dataset.sen = String(wIdx ?? '');
      this.senDropRows.set(row, { wi, wIdx });
      // 語を持ち上げている / 選んでいるときに、行の余白を押すと末尾へ。
      // スクロールの指を拾わないよう、動いた量はタップと同じ 7px まで。
      let rowDown = null;
      row.addEventListener('pointerdown', (ev) => {
        if (ev.target === row) rowDown = { x: ev.clientX, y: ev.clientY };
      });
      row.addEventListener('pointerup', (ev) => {
        const down = rowDown;
        rowDown = null;
        if (ev.target !== row || !down || this.suppressClick || this.dragFrom) return;
        if (Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > Forge.DRAG_SLOP) return;
        if (!this.armed && !this.held) return;
        this.onGapTap({ kind: 'gap', wi, wIdx, index: sen.count });
      });
      row.addEventListener('pointercancel', () => { rowDown = null; });
    }

    sen.entries.forEach((e, i) => {
      const place = { kind: wordKind, index: i, wi, wIdx };
      row.append(this.renderWordChip(e, place, opt.idiomIdx?.has(i), opt.idiomName));
    });
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

    // 語を語彙へ戻すのは、語を語彙へドラッグする操作に一本化した。

    // 「語 + 接続詞」をひとまとまりの語として扱う。
    const item = el('div', { class: 'sen-item' }, chip, connChip);
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
      this.opt.audio?.uns?.();
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
      // 行の余白 (見出し・効果表示) へ落としても文に入れられる。
      row.dataset.padRow = '1';

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
    if (anyBorn) { this.opt.audio?.phrase?.(); }
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
          : `${w.text} [${cat.name}]\nタップで選んで、文の語か行の余白をタップすると置けます。`
            + (info?.player ? `\n体にも効く: ${selfLine(info.player)}` : ''),
      }, el('span', {}, w.text));
      const n = counts.get(w.text);
      if (n > 1) node.append(el('span', { class: 'pword-n' }, `×${n}`));
      const place = { kind: 'lexicon', index: i };
      this.makeDropTarget(node, place);
      if (this.forgetMode) this.makeTappable(node, () => this.onPoolTap(w));
      else this.makeDraggable(node, place, () => this.onPoolTap(w));
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
      const fw = this.padWordAt(this.focusPlace);
      const fsen = this.padSenOf(this.focusPlace);
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
        '語彙の語を文の行の好きな場所へドラッグすると、落とした位置に差し込める。'
        + '語をタップしてから文の語か余白をタップしても置ける。'
        + 'ドラッグで語を置き換えることはしない。'));
      d.append(el('span', { class: 'dl' },
        '文の語は語彙の箱へドラッグすると戻せる。'
        + '文の中の語はドラッグで並べ替えられる。'));
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
        '文の語か行の余白をタップで移動。語彙をタップで語彙へ戻す。'
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
        + '武器語 (3 択で得られる) は刃・剣・刀・斧・槍・矛・牙・爪・弓・鞭・鎖・杖・拳・銃・針の 15 語だけ。'));
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







  // ───────────────────────────────────────────────────────────────────────────
  // 共通の操作 (SenPad) に渡すもの
  //
  // タップ・ドラッグ・接続詞の一覧・取り消しは senpad.js の 1 つの実装。
  // ここは「語彙と武器の文」をそれが扱える形に橋渡しするだけ。
  // 部位強化も同じ土台を使うので、操作はどこでも同じになる。
  // ───────────────────────────────────────────────────────────────────────────

  padScope() { return [this.root]; }
  padPoolEl() { return this.lexiconEl; }
  padRows() { return this.rows; }
  padPlaceAt(ctx, index) { return { kind: 'slot', index, wi: ctx.wi, wIdx: ctx.wIdx }; }
  padPoolPlace() { return { kind: 'lexicon', index: -1 }; }
  padPoolItem(index) { return this.run.lexicon[index] || null; }

  /** 置き場のキー。描き直しても同じになるので data-place が安定する。 */
  padKeyOf(place) {
    if (!place) return '';
    if (place.kind === 'lexicon') return `L${place.index}`;
    return `W${place.wIdx ?? '?'}_${place.index}`;
  }

  padSenOf(place) { return this.senOf(place); }
  padWordAt(place) { return this.wordAt(place); }
  padConnAt(place) { return this.run.connAt(place); }

  padInsert(place, word) {
    const sen = this.senOf(place);
    if (!sen) return { ok: false, reason: 'range' };
    return this.run.insertInto(sen, place.index, word, place.wi || null);
  }
  padMove(from, to) { return this.run.moveWordTo(from, to); }
  padReturn(place) {
    const word = this.wordAt(place);
    if (!word) return { ok: false, reason: 'empty' };
    return this.run.toLexicon(word);
  }
  padSetConn(place, text) { return this.run.setConnAt(place, text ? makeWord(text) : null); }
  padCycle(place) { return this.run.cycleConnector(place); }
  padSnapshot() { return this.snapshot(); }
  padRestore(state) { this.restore(state); }
  padRender() { this.render(); }
  padChanged() { this.opt.onChange?.(); }
  padForget(word) {
    const gone = this.run.forgetWord(word);
    if (gone && !this.run.lexiconFreeCount) this.forgetMode = false;
    return gone;
  }
}
