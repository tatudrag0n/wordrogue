// ============================================================================
// ワードローグ — セーブデータ (localStorage)
//
// 走者向けの記録のみ。ランの途中状態は保存しない。
// ============================================================================

import { STAGES } from '../data/stages.js';

const KEY = 'wordrogue.save.v1';

const DEFAULTS = {
  version: 1,
  clearedStages: [],   // クリア済みステージ ID
  unlockedWeapons: ['sword', 'gun'],
  bestScore: 0,
  totalKills: 0,
  totalRuns: 0,
  startingWords: [],  // 恒久的に手に入れた語 (リスポーン時に語袋に入る)
  meta: {},            // 恒久強化_progress
  settings: { volume: 0.5, screenShake: true, showDamage: true },
  seenIntro: false,
};

function deepMerge(base, patch) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = deepMerge(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export class Save {
  constructor() {
    this.data = { ...DEFAULTS };
    this.available = true;
    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.data = deepMerge(DEFAULTS, JSON.parse(raw));
    } catch {
      this.available = false;
      this.data = { ...DEFAULTS };
    }
    return this.data;
  }

  save() {
    if (!this.available) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      this.available = false;
    }
  }

  reset() {
    this.data = JSON.parse(JSON.stringify(DEFAULTS));
    this.save();
  }

  get d() { return this.data; }

  // ── 進行状況 ─────────────────────────────────────────────────────────────
  isCleared(stageId) { return this.data.clearedStages.includes(stageId); }

  /** 選択できる最も先のステージ番号。 */
  get maxStage() {
    let max = 1;
    for (const s of STAGES) {
      if (this.isCleared(s.id)) max = Math.min(STAGES.length, s.id + 1);
    }
    return max;
  }

  /** そのステージのクリア回数。 */
  stars(stageId) { return this.data.clearedStages.filter((x) => x === stageId).length; }

  markCleared(stageId) {
    if (!this.data.clearedStages.includes(stageId)) this.data.clearedStages.push(stageId);
  }

  unlockWeapon(id) {
    if (!this.data.unlockedWeapons.includes(id)) this.data.unlockedWeapons.push(id);
  }
  hasWeapon(id) { return this.data.unlockedWeapons.includes(id); }

  addStartingWord(text) {
    if (!this.data.startingWords.includes(text)) this.data.startingWords.push(text);
  }
  hasStartingWord(text) { return this.data.startingWords.includes(text); }

  // ── 走者記録 ─────────────────────────────────────────────────────────────
  recordRun({ score, kills, stageId, cleared }) {
    const d = this.data;
    d.totalRuns++;
    d.totalKills += kills;
    if (score > d.bestScore) d.bestScore = score;
    if (cleared) this.markCleared(stageId);
    this.save();
  }

  // ── 設定 ─────────────────────────────────────────────────────────────────
  setSetting(k, v) {
    this.data.settings[k] = v;
    this.save();
  }
  setting(k) { return this.data.settings[k]; }
}

export { KEY, DEFAULTS };
