// ============================================================================
// ワードローグ — HUD
// ============================================================================

import { $, el, clear, clamp, fmtNum, fmtTime } from '../core/util.js';
import { KIND_LABEL } from '../data/weapons.js';
import { WORDS, CATEGORIES } from '../data/words.js';
import { statRows } from '../game/stats.js';
import { FX_LABEL, fxLine as makeFxLine } from './labels.js';

export class Hud {
  constructor() {
    this.root = $('#hud');
    this.hpFill = $('#hpFill');
    this.shieldFill = $('#shieldFill');
    this.hpText = $('#hpText');
    this.xpFill = $('#xpFill');
    this.xpText = $('#xpText');
    this.staFill = $('#staFill');
    this.staText = $('#staText');
    this.hudSelf = $('#hudSelf');
    this.hudStats = $('#hudStats');
    this.hudStage = $('#hudStage');
    this.hudTimer = $('#hudTimer');
    this.hudScore = $('#hudScore');
    this.hudKills = $('#hudKills');
    this.hudHint = $('#hudHint');
    this.hudWeapons = $('#hudWeapons');
    this.hudBoss = $('#hudBoss');
    this.bossName = $('#bossName');
    this.bossFill = $('#bossFill');
    this.hudPaused = $('#hudPaused');

    // 3 択
    this.choiceBox = $('#hudChoice');
    this.choiceTitle = $('#choiceTitle');
    this.choiceTimer = $('#choiceTimer');
    this.choiceList = $('#choiceList');
    this.choiceForget = $('#choiceForget');
    this.choiceForgetList = $('#choiceForgetList');
    /** 捨てる語を選んだ位置。null は未選択。 */
    this.forgetIndex = null;
    /** いま表示している 3 択。 */
    this._choice = null;
    this._choiceSig = '';

    this._chipNodes = [];
    this._statNodes = null;
    this._lastHint = '';
  }

  show(on) { this.root.hidden = !on; }

  setPaused(on) { this.hudPaused.hidden = !on; }

  /**
   * @param {object} run
   * @param {(wi:object)=>void} onChipClick 武器チップを押した時
   */
  update(run, onChipClick) {
    const p = run.player;
    const s = p.stats;

    // HP / シールド
    const hpPct = clamp(p.hp / p.maxHp, 0, 1) * 100;
    this.hpFill.style.width = `${hpPct}%`;
    const shPct = clamp(p.shield / Math.max(1, p.maxHp), 0, 1) * 100;
    this.shieldFill.style.width = `${shPct}%`;
    this.hpText.textContent = p.shield > 0.5
      ? `${Math.ceil(p.hp)} / ${p.maxHp}  (+${Math.ceil(p.shield)})`
      : `${Math.ceil(p.hp)} / ${p.maxHp}`;

    // 経験値
    this.xpFill.style.width = `${clamp(p.xp / p.xpNext, 0, 1) * 100}%`;
    this.xpText.textContent = `Lv ${p.level}`;

    // スタミナ
    const staPct = clamp(p.stamina / p.maxStamina, 0, 1) * 100;
    this.staFill.style.width = `${staPct}%`;
    this.staText.textContent = p.dashing ? 'ダッシュ中' : `${Math.ceil(p.stamina)}`;
    this.staFill.classList.toggle('dashing', p.dashing);
    this.staFill.classList.toggle('empty', p.stamina < 12);

    // プレイヤー自身の文 (称号)。
    const selfTitle = p.stats.selfTitle || '';
    if (selfTitle) {
      this.hudSelf.hidden = false;
      clear(this.hudSelf);
      this.hudSelf.append(
        el('span', { class: 'hud-self-mark' }, '称号'),
        el('b', { class: 'hud-self-text' }, selfTitle),
        el('span', { class: 'hud-self-pow' }, `文の力 x${p.stats.selfPower.toFixed(2)}`),
      );
      this.hudSelf.classList.toggle('invalid', p.stats.selfValid === false);
      this.hudSelf.title = p.stats.selfValid
        ? `自身の文「${selfTitle}」— 文の力が攻撃と防御に効く`
        : `自身の文「${selfTitle}」— 不成文。枠の語を 2 つ以上並べよう`;
    } else {
      this.hudSelf.hidden = true;
    }

    // 能力。ラベルと数値を別の要素にして、桁がずれても読み分けられるようにする。
    this.renderStats(s);

    // 3 択。
    this.renderChoices(run);

    // ステージ / 制限時間
    this.hudStage.textContent = `第 ${run.stage.id} 戦・${run.stage.name}`;
    const left = run.stage.boss ? null : run.stage.time - run.time;
    if (left !== null) {
      this.hudTimer.textContent = fmtTime(left);
      this.hudTimer.classList.toggle('urgent', left < 10);
    } else {
      this.hudTimer.textContent = fmtTime(run.time);
      this.hudTimer.classList.remove('urgent');
    }

    this.hudScore.textContent = fmtNum(run.score);
    this.hudKills.textContent = fmtNum(run.kills);

    // ボス
    const b = run.boss;
    if (b && !b.dead) {
      this.hudBoss.hidden = false;
      this.bossName.textContent = b.def.name;
      this.bossFill.style.width = `${clamp(b.hp / b.maxHp, 0, 1) * 100}%`;
    } else {
      this.hudBoss.hidden = true;
    }

    // ヒント
    if (run.hintT > 0) {
      this.hudHint.hidden = false;
      if (run.hint !== this._lastHint) {
        this._lastHint = run.hint;
        this.hudHint.textContent = run.hint;
      }
    } else {
      this.hudHint.hidden = true;
      this._lastHint = '';
    }

    this._chips(run, onChipClick);
  }

  /** 武器チップ。不成文の武器は赤くして取り消し線を付ける。 */
  _chips(run, onChipClick) {
    const report = run.weaponReport();
    if (this._chipNodes.length !== report.length) {
      this.hudWeapons.textContent = '';
      this._chipNodes = report.map(({ wi }) => {
        const node = el('button', { class: 'wchip', type: 'button' },
          el('span', { class: 'wchip-lv' }, `Lv${wi.level}`),
          el('span', { class: 'wchip-txt' }, wi.name),
        );
        node.addEventListener('click', () => onChipClick?.(wi));
        this.hudWeapons.append(node);
        return { wi, node };
      });
    }
    for (let i = 0; i < report.length; i++) {
      const { wi, node } = this._chipNodes[i];
      const res = report[i].res;
      node.className = 'wchip'
        + (res.active ? '' : ' broken')
        + (res.active && res.grade === 'great' ? ' great' : '')
        + (res.active && res.grade === 'idiom' ? ' idiom' : '');
      node.querySelector('.wchip-lv').textContent = `Lv${wi.level}`;
      // 武器名はそのまま文面。基本の型も添えてどちらの武器か分かるようにする。
      const txt = node.querySelector('.wchip-txt');
      if (!node.querySelector('.wchip-base')) {
        const base = el('span', { class: 'wchip-base' }, '');
        node.insertBefore(base, txt);
      }
      node.querySelector('.wchip-base').textContent = wi.def.name;
      txt.textContent = res.active ? ` ${wi.title}` : ` ${wi.title || ''} — ${res.reasonText}`;
      node.title = res.active
        ? `${wi.def.name}「${res.fullText}」 — ${res.gradeInfo.name} / `
          + `${KIND_LABEL[res.kind] || res.kind} / 威力 ${res.stats.dmg.toFixed(0)}`
        : `不成文: ${res.reasonText}`;
    }
  }

  /**
   * レベルアップの 3 択。
   * 語彙が満杯のときは、先に「何を捨てるか」を選ばせる。
   * ゲームは止めない。時間切れなら run 側で自動で決まる。
   * @param {object} run
   * @param {(id:number, index:number, discardIndex:number|null)=>void} onPick
   */
  renderChoices(run, onPick) {
    this._onPick = onPick || this._onPick;
    const c = run.pendingChoices && run.pendingChoices[0];
    if (!c) {
      this.choiceBox.hidden = true;
      this._choice = null;
      this._choiceSig = '';
      return;
    }

    const full = run.lexiconFull;
    const sig = `${c.id}|${c.words.map((w) => w.text).join(',')}|${full}|${this.forgetIndex}|`
      + run.lexicon.map((w) => (w ? w.text : '-')).join(',');
    const left = Math.max(0, Math.ceil(c.life));
    this.choiceTimer.textContent = String(left);
    this.choiceTimer.classList.toggle('urgent', left <= 2);

    if (this._choiceSig === sig) return;
    this._choiceSig = sig;
    this.choiceBox.hidden = false;

    // 捨てる語の選択。満杯のときだけ出す。
    this.choiceForget.hidden = !full;
    if (full) {
      this.choiceTitle.textContent = this.forgetIndex === null
        ? '語彙が満杯 — 捨てることばを選んで'
        : '捨てることばを選んだ — 新しいことばを選んで';
      clear(this.choiceForgetList);
      run.lexicon.forEach((w, i) => {
        if (!w) return;
        const node = el('button', {
          class: 'choice-card forget' + (this.forgetIndex === i ? ' gone' : ''),
          type: 'button',
          title: `「${w.text}」を忘れる`,
        }, el('span', {}, w.text));
        node.addEventListener('click', () => {
          this.forgetIndex = this.forgetIndex === i ? null : i;
          this._choiceSig = '';
          this.renderChoices(run);
        });
        this.choiceForgetList.append(node);
      });
    } else {
      this.choiceTitle.textContent = 'ことばを 1 つ選んで';
    }

    // 候補。
    clear(this.choiceList);
    c.words.forEach((w, i) => {
      const info = WORDS[w.text];
      const cat = CATEGORIES[w.cat] || CATEGORIES.modifier;
      const node = el('button', {
        class: 'choice-card',
        type: 'button',
        style: { borderColor: cat.color },
        title: this.fxLine(w),
      },
        el('span', {}, w.text),
        el('span', { class: 'choice-card-cat' }, cat.name),
        el('span', { class: 'choice-card-fx' }, this.fxLine(w)),
      );
      if (w.cat === 'connect') node.append(el('span', { class: 'conn-mark' }, '結'));
      node.addEventListener('click', () => {
        if (full && this.forgetIndex === null) {
          this._choiceSig = '';
          this.renderChoices(run);
          return;
        }
        this._onPick?.(c.id, i, full ? this.forgetIndex : null);
        this.forgetIndex = null;
        this._choiceSig = '';
      });
      this.choiceList.append(node);
    });
  }

  /** 語の効果を 1 行にまとめる (3 択のカードと詳細)。 */
  fxLine(w) {
    const info = WORDS[w.text];
    if (!info) return '';
    return makeFxLine(info.fx, FX_LABEL, 3);
  }

  /**
   * 能力表示。ラベルと数値を別の要素にして、桁がずれても読み分けられるようにする。
   * 並びが変わらないので、更新は中身のテキストだけ差し替える。
   */
  renderStats(s) {
    const rows = statRows(s);
    if (!this._statNodes || this._statNodes.length !== rows.length) {
      clear(this.hudStats);
      this._statNodes = rows.map((r) => {
        const node = el('div', { class: 'statbox' },
          el('span', { class: 'statbox-k' }, r.label),
          el('b', { class: 'statbox-v' }, r.value),
        );
        this.hudStats.append(node);
        return { node, k: node.querySelector('.statbox-k'), v: node.querySelector('.statbox-v') };
      });
    }
    for (let i = 0; i < rows.length; i++) {
      const { node, k, v } = this._statNodes[i];
      const r = rows[i];
      k.textContent = r.label;
      v.textContent = r.value;
      node.className = 'statbox' + (r.kind ? ` ${r.kind}` : '');
      node.title = `${r.label} ${r.value}`;
    }
  }
}

