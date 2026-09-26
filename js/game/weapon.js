// ============================================================================
// ワードローグ — 武器インスタンスと性能の解決
//
// ここが「文が成立していなければその武器は無効化される」の実装。
// 解決結果が active=false なら、combat 側は撃たない。
// ============================================================================

import { WEAPONS, baseStatsForLevel, slotsForLevel } from '../data/weapons.js';
import { evaluate, makeWord, ELEMENTS } from '../data/words.js';
import { clamp } from '../core/util.js';

/** 文の中で属性の重みを強めるための中央テーブル。 */
const ELEMENT_WEIGHT = 3;

let wUid = 0;

/** 武器の核語 (空洞に最初から入っている語) のキャッシュ。 */
const coreCache = new Map();
function coreWordOf(defId) {
  if (!coreCache.has(defId)) coreCache.set(defId, makeWord(WEAPONS[defId].core));
  return coreCache.get(defId);
}

/** 形態語を描画用の形に対応させる。同じ形の語はまとめる。 */
const FORM_SHAPE = {
  矢: 'arrow', 針: 'arrow', 竜頭: 'arrow', 夾撃: 'arrow',
  弾: 'shot', 乱打: 'shot',
  刃: 'blade', 刀: 'blade', 太刀: 'blade', 大剣: 'blade', 爪: 'blade', 牙: 'blade', 鞭: 'blade',
  球: 'orb', 塊: 'orb', 彗星: 'orb',
  爆弾: 'bomb',
};

/**
 * 文面の中から形を決める。後ろにある形態語を優先する。
 * 例:「炎の球の矢」なら 矢 (arrow)。
 */
function shapeOf(segments) {
  let shape = null;
  for (const s of segments) {
    if (FORM_SHAPE[s]) shape = FORM_SHAPE[s];
  }
  return shape;
}

export class WeaponInst {
  /**
   * @param {string} defId
   * @param {number} level
   */
  constructor(defId, level = 1) {
    this.uid = ++wUid;
    this.defId = defId;
    this.def = WEAPONS[defId];
    if (!this.def) throw new Error(`未知の武器: ${defId}`);
    this.level = level;
    /** @type {Array<object|null>} スロット。空のままでもよい。 */
    this.slots = new Array(slotsForLevel(this.def, level)).fill(null);
    this.cd = 0;
    this.phase = 0;         // 攻撃ごとの描画用 位相
    this.aim = 0;           // 照準角
    this.orbitAngle = 0;
    this.flash = 0;         // 攻撃フラッシュ
    this._sig = null;       // 再計算の判定用シグネチャ
    this._cache = null;
  }

  get name() { return this.def.name; }
  get filled() { return this.slots.filter(Boolean); }

  /** 現在のスロット数を.level から再計算する。レベル上昇時に呼ぶ。 */
  resizeSlots() {
    const want = slotsForLevel(this.def, this.level);
    while (this.slots.length < want) this.slots.push(null);
    if (this.slots.length > want) this.slots.length = want;
    this._sig = null;
  }

  /** スロットに語を入れる。null で外す。 */
  setSlot(i, word) {
    if (i < 0 || i >= this.slots.length) return false;
    this.slots[i] = word || null;
    this._sig = null;
    return true;
  }

  levelUp() {
    if (this.level >= this.def.maxLevel) return false;
    this.level++;
    this.resizeSlots();
    return true;
  }

  /** 文面 (核語 + 埋めた語) の文字列。表示用。 */
  get phraseText() {
    return this.slots.map((s) => (s ? s.text : '＿')).join('');
  }

  /** 核語込みで文を評価し、，孟性を合算する。 */
  evaluate() {
    const list = [coreWordOf(this.defId), ...this.slots.filter(Boolean)];
    const r = evaluate(list);
    r.withCore = true;
    return r;
  }

  /**
   * 戦闘に使う最終ステータスを作る。
   * @param {object} ps プレイヤー能力
   * @returns {{active:boolean, reason:string, reasonText:string, grade:string,
   *   gradeInfo:object, element:string, elementInfo:object, stats:object,
   *   evalResult:object, text:string, dps:number}}
   */
  resolve(ps) {
    const sig = this.level + '|' + this.slots.map((s) => (s ? s.uid : '-')).join(',');
    if (this._sig === sig && this._cache) return this._cache;

    const e = this.evaluate();
    const base = baseStatsForLevel(this.def, this.level);

    const out = {
      active: e.valid,
      valid: e.valid,
      reason: e.reason,
      reasonText: e.reasonText,
      grade: e.grade,
      gradeInfo: e.gradeInfo,
      element: e.element,
      elementInfo: ELEMENTS[e.element] || ELEMENTS.none,
      text: this.slots.map((s) => (s ? s.text : '')).join(''),
      fullText: e.text,
      evalResult: e,
      stats: {},
      dps: 0,
    };

    if (!e.valid) {
      // 不成文。性能はゼロ。戦闘では完全に無効化される。
      out.stats = { ...base, dmg: 0, rate: 0, count: 0 };
      this._sig = sig; this._cache = out;
      return out;
    }

    const fx = e.fx || {};
    const st = { ...base };

    // 文の効果を base に加算する。
    for (const [k, v] of Object.entries(fx)) {
      if (k === 'power' || k === 'atkMul' || k === 'xpMul' || k === 'hpMul' || k === 'slowImmune') continue;
      if (k === 'split' || k === 'bounce' || k === 'chain' || k === 'count' || k === 'pierce' || k === 'orbit') {
        st[k] = (st[k] || 0) + v;
      } else {
        st[k] = (st[k] || 0) + v;
      }
    }

    // プレイヤー能力との合成。
    st.dmg = Math.max(0, st.dmg || 0) * ps.atk * ps.atkMul * (1 + (fx.atkMul || 0));
    st.crit = clamp((st.crit || 0) + ps.crit, 0, 1);
    // 会心倍率は 1.5 を基準に、文の効果が足し算される。
    st.critDmg = Math.max(1, (st.critDmg || 0) + 1.5);
    st.lifesteal = clamp((st.lifesteal || 0) + ps.lifesteal, 0, 1.2);
    st.magnet = (st.magnet || 0) + ps.magnet;
    st.xpMul = (fx.xpMul || 0) + ps.xpMul;
    st.power = 1;

    // 範囲系の下限と上限。
    st.size = clamp(st.size ?? 1, 0.3, 4);
    st.area = Math.max(0, st.area || 0);
    st.range = st.range || 100;
    st.rate = Math.max(0.05, st.rate || 1);
    st.speed = st.speed ?? 260;
    st.count = Math.max(0, Math.round(st.count || 0));
    st.pierce = Math.max(0, Math.round(st.pierce || 0));
    st.split = Math.max(0, Math.round(st.split || 0));
    st.bounce = Math.max(0, Math.round(st.bounce || 0));
    st.chain = Math.max(0, Math.round(st.chain || 0));
    st.orbit = Math.max(0, Math.round(st.orbit || 0));
    st.arc = st.arc || 0;
    st.spread = clamp(st.spread || 0, 0, Math.PI);
    st.duration = Math.max(0.3, st.duration || 0);
    st.homing = clamp(st.homing || 0, 0, 1);
    st.regen = Math.max(0, st.regen || 0);
    st.knock = st.knock || 0;
    st.recoil = st.recoil || 0;
    st.explode = st.explode || 0;
    st.armor = (st.armor || 0) + ps.armor;
    st.slowImmune = Math.max(st.slowImmune || 0, ps.slowImmune);
    st.freeze = st.freeze || 0;
    st.reflect = st.reflect || 0;
    // 弾・分裂・フィールドが参照する属性。
    st.el = e.element;
    // 描画用の形。形態語が鍵になる。
    st.shape = shapeOf(e.segments);

    // 概算 DPS (UI の比較用)。
    const multi = Math.max(1, st.count) * (1 + st.split * 0.4) * (1 + st.pierce * 0.25)
      * (1 + (st.orbit ? st.orbit * 0.9 : 0)) * (1 + st.area / 500)
      * (st.explode ? 1.4 : 1) * (1 + st.chain * 0.5);
    out.stats = st;
    out.dps = st.dmg * st.rate * multi * (1 + st.crit * (st.critDmg - 1));

    this._sig = sig; this._cache = out;
    return out;
  }
}

/**
 * 比較用に主要な項目を取り出す。
 * 威力と攻撃速度は必ず出し、それ以外は値があるものだけ出す。
 */
export function keyStats(st) {
  if (!st) return [];
  const rows = [];
  const add = (key, label, fmt) => {
    if (st[key] === undefined || st[key] === null) return;
    rows.push({ key, label, value: fmt ? fmt(st[key]) : st[key] });
  };
  const addIf = (key, label, fmt) => {
    if (!st[key]) return;
    add(key, label, fmt);
  };

  add('dmg', '威力', (v) => v.toFixed(0));
  add('rate', '攻撃/秒', (v) => v.toFixed(2));
  addIf('count', '数', (v) => String(Math.round(v)));
  addIf('pierce', '貫通', (v) => String(Math.round(v)));
  addIf('orbit', '回転数', (v) => String(Math.round(v)));
  addIf('explode', '爆発', (v) => v.toFixed(0));
  addIf('chain', '連鎖', (v) => String(Math.round(v)));
  addIf('split', '分裂', (v) => String(Math.round(v)));
  addIf('bounce', '反射', (v) => String(Math.round(v)));
  addIf('crit', '会心', (v) => `${(v * 100).toFixed(0)}%`);
  if (st.critDmg > 1.55) add('critDmg', '会心威力', (v) => `${v.toFixed(2)}倍`);
  addIf('burn', '炎上', (v) => v.toFixed(1));
  addIf('poison', '毒', (v) => v.toFixed(1));
  addIf('chill', '減速', (v) => `${(v * 100).toFixed(0)}%`);
  addIf('shock', '感電', (v) => `${(v * 100).toFixed(0)}%`);
  addIf('freeze', '凍結', (v) => `${(v * 100).toFixed(0)}%`);
  addIf('lifesteal', '吸血', (v) => `${(v * 100).toFixed(0)}%`);
  addIf('regen', '回復', (v) => v.toFixed(1));
  addIf('shield', 'シールド', (v) => v.toFixed(0));
  addIf('area', '範囲', (v) => v.toFixed(0));
  addIf('range', '間合い', (v) => v.toFixed(0));
  addIf('speed', '速さ', (v) => v.toFixed(0));
  addIf('homing', '追尾', (v) => `${(v * 100).toFixed(0)}%`);
  addIf('knock', '撃退', (v) => v.toFixed(0));
  if (st.magnet > 1.05) add('magnet', '吸引', (v) => v.toFixed(1));

  // 大きさは 1.0 を基準に、変わっているときだけ出す。
  if (st.size && Math.abs(st.size - 1) > 0.02) {
    add('size', '大きさ', (v) => `${v.toFixed(2)}倍`);
  }
  return rows;
}
