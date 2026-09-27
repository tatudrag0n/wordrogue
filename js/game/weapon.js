// ============================================================================
// ワードローグ — 武器インスタンスと性能の解決
//
// ここが「文が成立していなければその武器は無効化される」の実装。
// 解決結果が active=false なら、combat 側は撃たない。
//
// 武器名は「枠の語を連結したもの + 末尾語 (tail)」になる。
// 末尾語は枠の外に固定で付くので、並べ替えても attack の型は変わらない。
// ============================================================================

import { WEAPONS, baseStatsForLevel, slotsForLevel } from '../data/weapons.js';
import { evaluate, makeWord, ELEMENTS } from '../data/words.js';
import { clamp } from '../core/util.js';

/** 文の中で属性の重みを強めるための中央テーブル。 */
const ELEMENT_WEIGHT = 3;

let wUid = 0;

/**
 * 末尾語を描画用の形と攻撃の種類に対応させる。
 * 武器の tail だけがここを通るので、名前と攻撃が必ず一致する。
 */
const FORM_INFO = {
  // 斬撃
  剣: ['blade', 'slash'], 刃: ['blade', 'slash'], 短刀: ['blade', 'slash'],
  太刀: ['blade', 'slash'], 大剣: ['blade', 'slash'],
  利爪: ['blade', 'slash'], 尖牙: ['blade', 'slash'],
  // 射撃
  弾: ['shot', 'shot'], 矢: ['arrow', 'shot'], 針: ['arrow', 'shot'],
  球: ['orb', 'shot'], 岩塊: ['orb', 'shot'], 竜頭: ['arrow', 'shot'],
  夾撃: ['arrow', 'shot'], 乱打: ['shot', 'shot'], 殲滅: ['orb', 'shot'],
  貫通: ['arrow', 'shot'], 複製: ['orb', 'shot'],
  銃: ['shot', 'shot'], 弓: ['arrow', 'shot'],
  // 爆弾
  爆弾: ['bomb', 'bomb'], 彗星: ['orb', 'bomb'],
  // 連鎖
  雷: ['shot', 'chain'], 雷神: ['shot', 'chain'],
  // 軌道
  環: ['blade', 'orbit'], 回転: ['blade', 'orbit'], 回転刃: ['blade', 'orbit'],
  // 環刃 (戻る刃)
  環刃: ['blade', 'boomerang'],
  // 薙ぎ
  鞭: ['blade', 'whip'], 嵐: ['orb', 'whip'],
  // 城壁
  壁: ['orb', 'aura'], 棘壁: ['orb', 'aura'],
  // 光線
  光線: ['arrow', 'beam'], 反射: ['blade', 'beam'],
  // 追加武器の末尾語
  太刀: ['blade', 'slash'], 針: ['arrow', 'shot'], 岩塊: ['orb', 'bomb'],
  利爪: ['blade', 'whip'], 竜頭: ['arrow', 'shot'], 複製: ['orb', 'shot'],
  大剣: ['blade', 'whip'], 夾撃: ['arrow', 'shot'], 乱打: ['shot', 'shot'],
};

/**
 * 末尾語から形と攻撃タイプを決める。
 * @param {string} tail
 * @returns {{shape:string|null, kind:string|null}}
 */
function formOf(tail) {
  const info = FORM_INFO[tail];
  if (!info) return { shape: null, kind: null };
  return { shape: info[0], kind: info[1] };
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

  /**
   * 武器名の末尾に固定で付く語。枠の外なので外せない。
   * ここが攻撃の種類も決める (「剣」なら必ず斬撃)。
   */
  get tail() { return this.def.tail || this.def.name; }
  /** 末尾語をインスタンスとして作る。評価のときに文の最後に加える。 */
  get tailWord() { return makeWord(this.tail); }

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


  /**
   * 武器名。埋めた語をそのまま連結したもの + 末尾語。
   * 「爆裂」「無双」「迅」+ 剣なら「爆裂無双迅剣」になる。
   */
  get title() {
    const t = this.slots.map((s) => (s ? s.text : '')).join('') + this.tail;
    return t || this.def.name;
  }

  /** 文面。枠の語と末尾語を並べたもの。 */
  get fullText() {
    return this.slots.map((s) => (s ? s.text : '')).join('') + this.tail;
  }

  /**
   * 埋めた語と末尾語をまとめて文として評価する。
   * 末尾語はプレイヤーが置いた語ではないので、実質語の要求を 1 つ増やす。
   * 枠の語だけで実質語を 2 つ以上置けば文になる。
   */
  evaluate() {
    return evaluate([...this.slots.filter(Boolean), this.tailWord], { minContent: 3 });
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
    // 攻撃の種類は末尾語だけが決める。途中の形態語は効果だけ足す。
    const form = formOf(this.tail);

    const out = {
      active: e.valid,
      valid: e.valid,
      reason: e.reason,
      reasonText: e.reasonText,
      grade: e.grade,
      gradeInfo: e.gradeInfo,
      element: e.element,
      elementInfo: ELEMENTS[e.element] || ELEMENTS.none,
      // 攻撃の種類は末尾語が決める。無ければ武器の既定。
      kind: form.kind || this.def.kind,
      shape: form.shape,
      title: this.title,
      text: this.fullText,
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

    // 文の新闻中心。敵の文を斬る量と確率に使う。
    //   成立なら 1 語、熟語があれば +1、述語 (接続詞の合成) があれば +1。
    //   文越好いほど、斬る量も確率も上がる。
    st.grade = e.grade;
    st.idiom = e.idiom ? 1 : 0;
    st.predicated = e.predicated ? 1 : 0;
    st.cutPower = 1 + st.idiom + st.predicated;
    st.cutChance = 0.15 * st.cutPower * (1 + (e.idiom ? 0.5 : 0)) * (1 + (e.predicated ? 0.5 : 0));

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
    st.shape = form.shape;
    st.kind = out.kind;

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
