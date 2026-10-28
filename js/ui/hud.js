// ============================================================================
// ワードローグ — HUD
// ============================================================================

import { $, el, clear, clamp, fmtNum, fmtTime } from '../core/util.js';
import { KIND_LABEL } from '../data/weapons.js?v=1.34';
import { WORDS, CATEGORIES } from '../data/words.js?v=1.34';
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
    this.hudCombo = $('#hudCombo');
    this.comboValue = $('#comboValue');
    this.hudHint = $('#hudHint');
    this.hudWeapons = $('#hudWeapons');
    this.hudBoss = $('#hudBoss');
    this.bossName = $('#bossName');
    this.bossFill = $('#bossFill');
    this.hudPaused = $('#hudPaused');
    this.pauseMeta = $('#pauseMeta');
    this.btnResume = $('#btnResume');
    this.btnDash = $('#btnDash');

    // 3 択
    this.choiceVeil = $('#hudChoiceVeil');
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

  /**
   * ポーズ画面の表示。run を渡すと、止めた場所と戦況を出す。
   * 出すときは「再開」にフォーカスして、キーボードだけでも戻れるようにする。
   */
  setPaused(on, run) {
    this.hudPaused.hidden = !on;
    if (!on) return;
    if (run?.stage) {
      this.pauseMeta.textContent = '第 ' + run.stage.id + ' 戦・' + run.stage.name
        + ' ／ ' + run.kills + ' 討伐 ／ ' + fmtTime(run.time);
    } else if (this.pauseMeta) {
      this.pauseMeta.textContent = '';
    }
    globalThis.requestAnimationFrame?.(() => {
      try { this.btnResume?.focus({ preventScroll: true }); } catch {}
    });
  }

  /**
   * ダッシュボタン。タッチ端末だけ表示する。
   * 画面を長押しする操作は移動しかできないので、
   * ダッシュは別の指で押せるようにしておく。
   * @param {Input} input
   */
  bindDash(input) {
    const show = () => {
      // ダッシュボタンと 3 択がぶつからないよう、CSS 側で 3 択をずらす。
      document.body.classList.add('touch');
      this.wireDash(input);
    };
    // ホバーできない = タッチ (スマホ / タブレット) とみなす。
    if (window.matchMedia?.('(hover: none) and (pointer: coarse)')?.matches) {
      show();
      return;
    }
    // タッチ機能のついた PC は、初めて指で触ったときに出す。
    // 実タップまで出さない。待つのは 1 回だけ。
    if ((navigator.maxTouchPoints || 0) > 0) {
      window.addEventListener('touchstart', show, { once: true, passive: true });
    }
  }

  /**
   * ダッシュボタンの実処理。表示の判断とは分けてあるので、
   * テストから直接呼べる。
   * @param {Input} input
   */
  wireDash(input) {
    const b = this.btnDash;
    if (!b || this._dashBound) return;
    this._dashBound = true;
    b.hidden = false;

    const down = (e) => {
      // 画面側の長押し (スティック) と同じにならないようにする。
      e.preventDefault();
      e.stopPropagation();
      input.setTouchDash(true);
      b.classList.add('on');
       try { b.setPointerCapture?.(e.pointerId); } catch {}
    };
    const up = () => {
      input.setTouchDash(false);
      b.classList.remove('on');
    };
    b.addEventListener('pointerdown', down);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('pointerleave', up);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  }

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
    this.hpFill.classList.toggle('low', hpPct <= 32);
    this.hpFill.classList.toggle('critical', hpPct <= 15);
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
    if (this.btnDash) this.btnDash.classList.toggle('empty', p.stamina < 12);

    // 部位強化 (メインメニューで設定)。戦闘中は表示だけ。
    const partTexts = p.stats.partTexts || [];
    if (partTexts.length) {
      this.hudSelf.hidden = false;
      clear(this.hudSelf);
      this.hudSelf.append(
        el('span', { class: 'hud-self-mark' }, '部位'),
        el('b', { class: 'hud-self-text' }, partTexts.join('・')),
      );
      this.hudSelf.classList.remove('invalid');
      this.hudSelf.title = '部位強化の語 — メインメニューの「部位強化」で変更できる';
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
    this._bumpIfChanged('score', this.hudScore, fmtNum(run.score));
    this._bumpIfChanged('kills', this.hudKills, fmtNum(run.kills));

    // 連斬。2 体から出し、倒した瞬間だけ少し膨らむ。
    const combo = run.combo || 0;
    if (this.hudCombo) {
      this.hudCombo.hidden = combo < 2;
      if (combo >= 2) {
        this.comboValue.textContent = String(combo);
        const scale = 1 + Math.min(0.4, (run.comboPulse || 0) * 0.9);
        this.hudCombo.style.setProperty('--combo-scale', scale.toFixed(3));
        this.hudCombo.classList.toggle('hot', combo >= 8);
      }
    }

    // ボス / 中ボス
    const b = run.boss || run.midBoss;
    const isMid = !!b && !run.boss;
    this.hudBoss.classList.toggle('mid', isMid);
    if (b && !b.dead) {
      this.hudBoss.hidden = false;
      this.bossName.textContent = (isMid ? '中ボス ' : '') + b.def.name;
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
        // 出すたびに、下から滑り込む。
        this.hudHint.classList.remove('pop');
        void this.hudHint.offsetWidth;
        this.hudHint.classList.add('pop');
      }
    } else {
      this.hudHint.hidden = true;
      this._lastHint = '';
    }

    this._chips(run, onChipClick);
  }

  /** スコア・討伐数の数字が変わったときだけ、小さく跳ねさせる。 */
  _bumpIfChanged(key, node, value) {
    if (!node) return;
    if (!this._numCache) this._numCache = Object.create(null);
    if (this._numCache[key] === value) return;
    const had = this._numCache[key] != null;
    this._numCache[key] = value;
    if (!had) return;
    node.classList.remove('bump');
    void node.offsetWidth;
    node.classList.add('bump');
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
      // 出すのは文面だけ。武器の「区分」(刃・銃などの基本の型) は出さない。
      // 文から作った武器は頭の語が型を決めるので、区分を添えると
      // 空の文で「刃」と出るなど、実際の攻撃とずれる。
      node.querySelector('.wchip-txt').textContent = res.active
        ? wi.title
        : (wi.title ? `${wi.title} — ${res.reasonText}` : res.reasonText);
      node.title = res.active
        ? `${res.fullText} — ${res.gradeInfo.name} / `
          + `${KIND_LABEL[res.kind] || res.kind} / 威力 ${res.stats.dmg.toFixed(0)}`
        : `不成文: ${res.reasonText}`;
    }
  }

  /**
   * レベルアップの 3 択。
   * 語彙が満杯のときは、先に「何を捨てるか」を選ばせる。
   * 選択中はゲームが止まる。時間切れなら run 側で自動で決まる。
   * @param {object} run
   * @param {(id:number, index:number, discardIndex:number|null)=>void} onPick
   */
  renderChoices(run, onPick) {
    this._onPick = onPick || this._onPick;
    const c = run.pendingChoices && run.pendingChoices[0];
    if (!c) {
      this.choiceBox.hidden = true;
      if (this.choiceVeil) this.choiceVeil.hidden = true;
      this._choice = null;
      this._choiceSig = '';
      return;
    }
    if (this.choiceVeil) this.choiceVeil.hidden = false;

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
      // 候補と同じ語は選べない。捨てたのに同じ語进来是两来访者取胜事になる。
      const cand = new Set(c.words.map((w) => w.text));
      let shown = 0;
      run.lexicon.forEach((w, i) => {
        if (!w || cand.has(w.text)) return;
        shown++;
        const node = el('button', {
          class: 'choice-card forget' + (this.forgetIndex === i ? ' gone' : ''),
          type: 'button',
          title: `「${w.text}」を忘れる`,
        }, el('span', {}, w.text));
        node.addEventListener('click', () => {
          run.audio?.uiSelect?.();
          this.forgetIndex = this.forgetIndex === i ? null : i;
          this._choiceSig = '';
          this.renderChoices(run);
        });
        this.choiceForgetList.append(node);
      });
      if (!shown) {
        this.choiceForgetList.append(el('span', { class: 'choice-note' },
          '捨てる語がない (全部候補と同じ)'));
      }
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
        style: { borderColor: cat.color, animationDelay: `${i * 55}ms` },
        title: this.fxLine(w),
      },
        el('span', {}, w.text),
        el('span', { class: 'choice-card-cat' }, cat.name),
        el('span', { class: 'choice-card-fx' }, this.fxLine(w)),
      );
      if (w.cat === 'connect') node.append(el('span', { class: 'conn-mark' }, '結'));
      node.addEventListener('click', () => {
        if (full && this.forgetIndex === null) {
          run.audio?.uiDeny?.();
          this._choiceSig = '';
          this.renderChoices(run);
          return;
        }
        run.audio?.uiSelect?.();
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

