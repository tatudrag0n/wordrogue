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
  totalBroken: 0,     // 文を崩した敵の累計
  ink: 0,              // 書庫の通貨「言玉」
  meta: {},            // 恒久強化 (hp / atk / xp / armor / magnet / crit / lexicon)
  settings: { volume: 0.5, screenShake: true, showDamage: true },
  seenIntro: false,
};

/**
 * 書庫で買える恒久強化。stats.js の resolvePlayerStats がそのまま読む。
 * cost は 1 段階あたりの言玉。max は買える上限。
 *
 * lexicon は特別: 語彙の枠を 1 つ増やす強化。
 * per=1 なので meta.lexicon がそのまま追加した個数になる。
 */
export const META_UPGRADES = {
  hp: { name: '体力', desc: '最大体力が上がる', cost: 30, max: 10, per: 4 },
  atk: { name: '攻撃', desc: 'すべての攻撃が上がる', cost: 45, max: 10, per: 0.03 },
  armor: { name: '装甲', desc: '被ダメージが減る', cost: 35, max: 8, per: 1 },
  xp: { name: '経験値', desc: 'レベルが早く上がる', cost: 40, max: 8, per: 0.06 },
  magnet: { name: '引き寄せ', desc: '経験値を引き寄せる', cost: 25, max: 6, per: 0.2 },
  crit: { name: '会心', desc: '会心率が上がる', cost: 50, max: 8, per: 0.02 },
  lexicon: { name: '語彙', desc: '手持ちの語を 1 つ多く持つ', cost: 90, max: 18, per: 1 },
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
    // 古いセーブに残っている「恒久の語」は読み飛ばす。
    delete this.data.startingWords;
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

  // ── 書庫 (恒久進行) ───────────────────────────────────────────────────────
  get ink() { return this.data.ink || 0; }

  addInk(n) {
    this.data.ink = Math.max(0, (this.data.ink || 0) + n);
    this.save();
    return this.data.ink;
  }

  /**
   * 強化を何段階買っているか。
   * 保存は「最終値」なので、段階数は per で割って出す。
   * 例: 体力は 1 段階 4。meta.hp = 12 なら 3 段階。
   */
  metaLevel(key) {
    const u = META_UPGRADES[key];
    const v = (this.data.meta || {})[key] || 0;
    if (!u || !u.per) return 0;
    return Math.round(v / u.per);
  }

  /** 強化の最終値。stats.js がそのまま読む。 */
  metaValue(key) { return (this.data.meta || {})[key] || 0; }

  /** 次の 1 段階を買うのに必要な言玉。買えないなら null。 */
  metaCost(key) {
    const u = META_UPGRADES[key];
    if (!u) return null;
    const lv = this.metaLevel(key);
    if (lv >= u.max) return null;
    // 段階が上がるごとに少し高くなる。
    return u.cost + Math.floor(u.cost * 0.5 * (lv / u.max));
  }

  /**
   * 恒久強化を 1 段階買う。
   * @returns {{ok:boolean, reason:string, level?:number}}
   */
  buyMeta(key) {
    const u = META_UPGRADES[key];
    if (!u) return { ok: false, reason: 'unknown' };
    const cost = this.metaCost(key);
    if (cost === null) return { ok: false, reason: 'max' };
    if (this.ink < cost) return { ok: false, reason: 'ink' };
    this.data.ink -= cost;
    this.data.meta = this.data.meta || {};
    const lv = this.metaLevel(key) + 1;
    // stats.js は最終値を読むので、段階数に per を掛けて保存する。
    this.data.meta[key] = lv * u.per;
    this.save();
    return { ok: true, reason: '', level: lv };
  }

  /** 言玉で広げた語彙の枠の数 (追加した個数)。 */
  get lexiconBonus() { return Math.round(this.metaValue('lexicon') || 0); }

  // ── 走者記録 ─────────────────────────────────────────────────────────────
  recordRun({ score, kills, stageId, cleared, broken = 0, ink = 0 }) {
    const d = this.data;
    d.totalRuns++;
    d.totalKills += kills;
    d.totalBroken = (d.totalBroken || 0) + broken;
    if (score > d.bestScore) d.bestScore = score;
    if (cleared) this.markCleared(stageId);
    if (ink) this.data.ink = Math.max(0, (this.data.ink || 0) + ink);
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
