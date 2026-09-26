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
    this.pouchEl = $('#forgePouch');
    this.pouchCount = $('#pouchCount');
    this.detailEl = $('#forgeDetail');
    this.hintEl = $('#forgeHint');
    this.hintBtn = $('#btnForgeHint');

    /** @type {object|null} 選択中の語 */
    this.armed = null;
    this.hintOn = false;

    $('#forgeClose').addEventListener('click', () => this.close());
    $('#forgeBack').addEventListener('click', () => this.close());
    this.hintBtn.addEventListener('click', () => {
      this.hintOn = !this.hintOn;
      this.hintEl.hidden = !this.hintOn;
      this.render();
    });
  }

  setRun(run) { this.run = run; this.armed = null; }

  open() {
    this.armed = null;
    this.root.hidden = false;
    this.run.paused = true;
    this.render();
  }

  close() {
    this.root.hidden = true;
    this.run.paused = false;
    this.armed = null;
    this.opt.onClose?.();
  }

  get isOpen() { return !this.root.hidden; }

  toggle() { this.isOpen ? this.close() : this.open(); }

  /** 画面を再描画する。 */
  render() {
    this.renderWeapons();
    this.renderPouch();
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

    for (const wi of this.run.weapons) {
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

      row.append(this.renderSlots(wi, (i) => this.onSlotClick(wi, i)));
      row.append(this.renderSentence(wi, res));
      row.append(this.renderStats(res));
      list.append(row);
    }
  }

  /** 枠を並べる。onClick(i) でクリックを処理する。末尾語は外して置けない。 */
  renderSlots(wi, onClick) {
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
      node.addEventListener('click', () => onClick(i));
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

    row.append(this.renderSlots({ slots: p.selfSlots, tail: SELF_TAIL }, (i) => this.onSelfSlotClick(i)));

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
  // 語袋
  // ───────────────────────────────────────────────────────────────────────────
  renderPouch() {
    const box = this.pouchEl;
    clear(box);

    const counts = new Map();
    for (const w of this.run.pouch) {
      if (w) counts.set(w.text, (counts.get(w.text) || 0) + 1);
    }

    for (const w of this.run.pouch) {
      if (!w) {
        box.append(el('div', { class: 'pword empty' }, ''));
        continue;
      }
      const cat = CATEGORIES[w.cat] || CATEGORIES.modifier;
      const conn = CONNECTOR_SET.has(w.text);
      const node = el('div', {
        class: 'pword' + (this.armed === w ? ' armed' : '') + (conn ? ' pword-conn' : ''),
        style: { borderColor: cat.color },
        title: `${w.text} [${cat.name}]${conn ? ' — 接続詞。直前の語に結合する。' : ''}`,
      }, el('span', {}, w.text));
      const n = counts.get(w.text);
      if (n > 1) node.append(el('span', { class: 'pword-n' }, `×${n}`));
      node.addEventListener('click', () => this.onPouchClick(w));
      box.append(node);
    }

    const filled = this.run.pouch.filter(Boolean).length;
    this.pouchCount.textContent = `${filled} / ${this.run.pouch.length}`;
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
      d.append(el('span', { class: 'dl' }, '語袋か武器か自身の枠。枠を空けると文が崩れる。'));
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
    for (const w of this.run.pouch) if (w) have.add(w.text);
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
  onPouchClick(word) {
    this.opt.audio?.tap?.();
    this.armed = this.armed === word ? null : word;
    this.render();
  }

  onSlotClick(wi, index) {
    if (this.armed) {
      const w = this.armed;
      this.armed = null;
      this.run.placeWord(wi, index, w);
      this.opt.audio?.worn?.(wi.resolve(this.run.player.stats));
      this.opt.onChange?.();
      this.render();
      return;
    }
    if (wi.slots[index]) {
      this.run.toPouch(wi.slots[index]);
      this.opt.audio?.tap?.();
      this.opt.onChange?.();
      this.render();
    }
  }

  onSelfSlotClick(i) {
    const p = this.run.player;
    if (this.armed) {
      const w = this.armed;
      this.armed = null;
      this.run.placeSelfWord(i, w);
      this.opt.audio?.worn?.({ active: true });
      this.opt.onChange?.();
      this.render();
      return;
    }
    if (p.selfSlots[i]) {
      this.run.toPouch(p.selfSlots[i]);
      this.opt.audio?.tap?.();
      this.opt.onChange?.();
      this.render();
    }
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
  dmgMul: '威力',
};

const PS_LABEL = {
  hp: '体力', spd: '移動', atk: '攻撃', armor: '装甲', crit: '会心',
  regen: '回復', lifesteal: '吸血', luck: '幸運', magnet: '吸引',
  xp: '経験値', size: '大きさ', shield: 'シールド',
};
