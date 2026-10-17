// ============================================================================
// ワードローグ — セーブデータ (localStorage)
//
// 走者向けの記録のみ。ランの途中状態は保存しない。
// ============================================================================

import { STAGES } from '../data/stages.js';
import { DRAWABLE_ALL, starterCollection } from '../data/words.js';

const KEY = 'wordrogue.save.v1';

const DEFAULTS = {
  version: 1,
  clearedStages: [],   // クリア済みステージ ID
  bestScore: 0,
  totalKills: 0,
  totalRuns: 0,
  totalBroken: 0,     // 文を崩した敵の累計
  ink: 0,              // 書庫の通貨「墨」
  collection: starterCollection(), // 持っている語 (ランに出る語彙の元)
  meta: {},            // 恒久強化 (hp / atk / xp / armor / magnet / crit)
  settings: { volume: 0.5, screenShake: true, showDamage: true },
  seenIntro: false,
};

/**
 * 書庫で買える恒久強化。stats.js の resolvePlayerStats がそのまま読む。
 * cost は 1 段階あたりの墨。max は買える上限。
 */
export const META_UPGRADES = {
  hp: { name: '体力', desc: '最大体力が上がる', cost: 30, max: 10, per: 4 },
  atk: { name: '攻撃', desc: 'すべての攻撃が上がる', cost: 45, max: 10, per: 0.03 },
  armor: { name: '装甲', desc: '被ダメージが減る', cost: 35, max: 8, per: 1 },
  xp: { name: '経験値', desc: 'レベルが早く上がる', cost: 40, max: 8, per: 0.06 },
  magnet: { name: '引き寄せ', desc: '経験値を引き寄せる', cost: 25, max: 6, per: 0.2 },
  crit: { name: '会心', desc: '会心率が上がる', cost: 50, max: 8, per: 0.02 },
};

/** 言葉くじ 1 回の値段 (墨)。 */
export const LOTTERY_COST = 25;

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
    this.migrate();
    return this.data;
  }

  /**
   * 古いセーブを今の形に合わせる。
   * 初期の語は無料で全員に配り、昔の「恒久の語」は持ち物に移す。
   */
  migrate() {
    const d = this.data;
    if (!Array.isArray(d.collection)) d.collection = [];
    for (const t of starterCollection()) {
      if (!d.collection.includes(t)) d.collection.push(t);
    }
    for (const t of d.startingWords || []) {
      if (!d.collection.includes(t)) d.collection.push(t);
    }
    delete d.startingWords;
    delete d.unlockedWeapons;
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

  // ── 語の持ち物 (言葉くじ) ─────────────────────────────────────────────────
  hasWord(text) { return this.data.collection.includes(text); }

  /** 語を 1 つ持ち物に加える。既にあれば false。 */
  addWord(text) {
    if (this.hasWord(text)) return false;
    this.data.collection.push(text);
    this.save();
    return true;
  }

  /** まだ持っていない、引ける語の数。 */
  get lotteryRemaining() {
    return DRAWABLE_ALL.filter((t) => !this.hasWord(t)).length;
  }

  /**
   * 言葉くじを 1 回引く。墨を払って、まだ持っていない語を 1 つ得る。
   * @returns {{ok:boolean, reason:string, text?:string}}
   */
  drawLottery(rng = Math.random) {
    if (this.lotteryRemaining === 0) return { ok: false, reason: 'empty' };
    if (this.ink < LOTTERY_COST) return { ok: false, reason: 'ink' };
    const pool = DRAWABLE_ALL.filter((t) => !this.hasWord(t));
    const text = pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
    this.data.ink -= LOTTERY_COST;
    this.data.collection.push(text);
    this.save();
    return { ok: true, reason: '', text };
  }

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

  /** 次の 1 段階を買うのに必要な墨。買えないなら null。 */
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
