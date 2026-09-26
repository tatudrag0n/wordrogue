// ============================================================================
// ワードローグ — 言葉鍛冶 (武器の組み立て画面)
//
// 語をクリックして選ぶ -> 枠をクリックで装着。戦闘中でも使える。
// 開いている間、時間は止まる。
// ============================================================================

import { $, el, clear } from '../core/util.js';
import { WORDS, CATEGORIES, PARTICLES, possibleCompounds, drawWord, evaluate } from '../data/words.js';
import { keyStats } from '../game/weapon.js';

const REROLL_CD = 25;   // 秒 (ゲーム内時間)

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
    this.rerollBtn = $('#btnReroll');
    this.hintBtn = $('#btnForgeHint');

    /** @type {object|null} 選択中の語 */
    this.armed = null;
    this.hintOn = false;
    this.rerollAt = 0;

    $('#forgeClose').addEventListener('click', () => this.close());
    $('#forgeBack').addEventListener('click', () => this.close());
    this.rerollBtn.addEventListener('click', () => this.reroll());
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
  // 武器
  // ───────────────────────────────────────────────────────────────────────────
  renderWeapons() {
    const list = this.listEl;
    clear(list);

    for (const wi of this.run.weapons) {
      const res = wi.resolve(this.run.player.stats);
      const row = el('div', {
        class: 'wrow' + (res.active ? ` ${res.grade}` : ' broken'),
      });

      // 見出し
      const head = el('div', { class: 'wrow-head' },
        el('span', { class: 'wrow-name' }, wi.def.name),
        el('span', { class: 'wrow-core', title: '核語 (最初から埋まっている)' }, wi.def.core),
        el('span', { class: 'wrow-lv' }, `Lv ${wi.level} / ${wi.def.maxLevel}`),
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

      // 枠
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
        node.addEventListener('click', () => this.onSlotClick(wi, i));
        slots.append(node);

        if (i < wi.slots.length - 1) slots.append(el('span', { class: 'slot-plus' }, '+'));
      });
      row.append(slots);

      // 文面。核語 + 枠の語が連結したもの。
      row.append(this.renderSentence(wi, res));

      // 性能
      row.append(this.renderStats(res));
      list.append(row);
    }
  }

  /**
   * 文面を表示する。核語と枠の語を分けて、色で区別する。
   * こうすると「文を組み立てている」ことがひと目で分かる。
   */
  renderSentence(wi, res) {
    const wrap = el('div', { class: 'sentence' });

    // 核語
    wrap.append(el('span', { class: 'sn-core', title: '核語 (武器に固定)' }, wi.def.core));

    const parts = [];
    wi.slots.forEach((w, i) => {
      if (i > 0) parts.push(el('span', { class: 'sn-plus' }, '+'));
      parts.push(w
        ? el('span', {
          class: 'sn-w' + (PARTICLES.has(w.text) ? ' sn-gram' : ''),
          title: WORDS[w.text] ? CATEGORIES[WORDS[w.text].cat]?.name : '',
        }, w.text)
        : el('span', { class: 'sn-empty' }, '＿'));
    });
    wrap.append(el('span', { class: 'sn-parts' }, parts));

    // 連結した結果。
    const joined = [wi.def.core, ...wi.slots.filter(Boolean).map((w) => w.text)].join('');
    const right = el('span', { class: 'sn-res' },
      el('span', { class: 'sn-eq' }, '= '),
      el('b', { class: 'sn-text' }, joined || '—'),
    );
    if (res.active) {
      right.append(el('span', { class: 'sn-seg' },
        res.evalResult.segments.map((s) => el('i', {
          class: PARTICLES.has(s) ? 'sg sg-gram' : 'sg',
        }, s))));
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
    const el2 = this.pouchEl;
    clear(el2);

    const counts = new Map();
    for (const w of this.run.pouch) {
      if (w) counts.set(w.text, (counts.get(w.text) || 0) + 1);
    }

    for (const w of this.run.pouch) {
      if (!w) {
        el2.append(el('div', { class: 'pword empty' }, ''));
        continue;
      }
      const cat = CATEGORIES[w.cat] || CATEGORIES.modifier;
      const gram = PARTICLES.has(w.text);
      const node = el('div', {
        class: 'pword' + (this.armed === w ? ' armed' : '') + (gram ? ' pword-gram' : ''),
        style: { borderColor: cat.color },
        title: `${w.text} [${cat.name}]${gram ? ' — 助詞。文をつなぐ。' : ''}`,
      }, el('span', {}, w.text));
      const n = counts.get(w.text);
      if (n > 1) node.append(el('span', { class: 'pword-n' }, `×${n}`));
      node.addEventListener('click', () => this.onPouchClick(w));
      el2.append(node);
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
      d.append(el('span', { class: 'dl' }, '語袋か武器の枠から選ぶ。枠を空けると文が崩れる。'));
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
    d.append(el('span', { class: 'dl' }, PARTICLES.has(sel.text)
      ? '助詞。分割はするが実質語には数えない。'
      : '実質語。文の成立に必要。'));
  }

  renderHint() {
    const h = this.hintEl;
    clear(h);

    const have = new Set();
    for (const w of this.run.pouch) if (w) have.add(w.text);
    for (const wi of this.run.weapons) for (const w of wi.slots) if (w) have.add(w.text);
    have.add(...this.run.weapons.map((w) => w.def.core));

    const list = possibleCompounds(have, 20);
    if (!list.length) {
      h.append(el('p', {}, '今の語では熟語を作れない。語を引き直そう。'));
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
    const cur = wi.slots[index];
    if (this.armed) {
      const w = this.armed;
      this.armed = null;
      this.run.placeWord(wi, index, w);
      this.opt.audio?.worn?.(wi.resolve(this.run.player.stats));
      this.opt.onChange?.();
      this.render();
      return;
    }
    if (cur) {
      // 語袋へ戻す。
      this.run.toPouch(cur);
      this.opt.audio?.tap?.();
      this.opt.onChange?.();
      this.render();
    }
  }

  reroll() {
    const now = this.run.time;
    if (now < this.rerollAt) return;
    // 語袋の中の語をすべて引き直す。
    const rand = this.run.rand;
    for (let i = 0; i < this.run.pouch.length; i++) {
      if (!this.run.pouch[i]) continue;
      this.run.pouch[i] = drawWord(rand);
    }
    // 武器の枠に埋まっている語は残す (失うと成立しなくなるため)。
    this.rerollAt = now + REROLL_CD;
    this.armed = null;
    this.run.refreshStats();
    this.opt.audio?.worn?.(null);
    this.opt.onChange?.();
    this.render();
  }

  /** 経過時間の表示を直す。ゲーム中も開けるのでクールダウンが進む。 */
  tick() {
    if (!this.isOpen) return;
    const left = this.rerollAt - this.run.time;
    const label = left > 0 ? `${Math.ceil(left)}秒後` : 'すぐ';
    const span = this.rerollBtn.querySelector('span');
    if (span) span.textContent = `(${label})`;
    this.rerollBtn.disabled = left > 0;
  }
}

const round = (v) => (Number.isInteger(v) ? v : Math.round(v * 100) / 100);

const FX_LABEL = {
  dmg: '威力', rate: '攻撃/秒', speed: '速さ', count: '数', pierce: '貫通',
  split: '分裂', bounce: '反射', chain: '連鎖', orbit: '回転数', size: '大きさ',
  area: '範囲', range: '間合い', arc: '扇', spread: '散り', crit: '会心',
  critDmg: '会心威力', homing: '追尾', duration: '持続', explode: '爆発',
  burn: '炎上', poison: '毒', chill: '減速', shock: '感電', freeze: '凍結',
  lifesteal: '吸血', regen: '回復', shield: 'シールド', knock: '撃退',
  recoil: '反動', magnet: '吸引', slowImmune: '減速耐性', reflect: '反射',
  armor: '装甲', power: '文力', atkMul: '攻撃', xpMul: '経験値',
};

const PS_LABEL = {
  hp: '体力', spd: '移動速度', atk: '攻撃', armor: '装甲', crit: '会心',
  regen: '回復', lifesteal: '吸血', luck: '幸運', magnet: '吸引',
  xp: '経験値', size: '大きさ', shield: 'シールド',
};

export { evaluate };
