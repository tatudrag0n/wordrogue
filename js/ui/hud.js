// ============================================================================
// ワードローグ — HUD
// ============================================================================

import { $, el, clamp, fmtNum, fmtTime } from '../core/util.js';

export class Hud {
  constructor() {
    this.root = $('#hud');
    this.hpFill = $('#hpFill');
    this.shieldFill = $('#shieldFill');
    this.hpText = $('#hpText');
    this.xpFill = $('#xpFill');
    this.xpText = $('#xpText');
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

    this._chipNodes = [];
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

    // 能力
    const s = p.stats;
    this.hudStats.textContent =
      `攻 ${Math.round(s.atk * s.atkMul * 100)}%  速 ${Math.round(s.spd)}  ` +
      `会心 ${(s.crit * 100).toFixed(0)}%  減傷 ${(s.armor * 100).toFixed(0)}%`;

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
      node.querySelector('.wchip-txt').textContent = res.active
        ? `${wi.name} ${res.fullText}`
        : `${wi.name} ${res.reasonText}`;
      node.title = res.active
        ? `${res.gradeInfo.name}「${res.fullText}」 — 威力 ${res.stats.dmg.toFixed(0)}`
        : `不成文: ${res.reasonText}`;
    }
  }
}
