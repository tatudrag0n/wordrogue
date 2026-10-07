// ============================================================================
// ワードローグ — 武器インスタンスと性能の解決
//
// ここが「文が成立していなければその武器は無効化される」の実装。
// 解決結果が active=false なら、combat 側は撃たない。
//
// 武器は「自由に並べた文」です。枠に嵌めない。
//   語彙から語をドラッグして文の中に落とす。並べ替えてもよい。
//   語の横 (直後) には接続詞が付く。語をタップすると切り替わる。
//   文は 10 文字まで。
//
// 攻撃の型は「文の中の武器語 (剣・弾・環…)」が決める。
// 武器語は自動で付かない。戦闘中のレベルアップで語として得る。
// 武器語が文に無いときは、その武器の既定の型を使う。
// ============================================================================

import { WEAPONS, baseStatsForLevel, lookupDef, FORM_SHAPE, KIND_SHAPE } from '../data/weapons.js';
import { evaluate, makeWord, ELEMENTS, WORDS, GRADES } from '../data/words.js';
import { clamp } from '../core/util.js';
import { Sentence, MAX_SENTENCE_LEN } from './sentence.js';

/** 武器語 (形態語) かどうか。 */
const isForm = (text) => WORDS[text]?.cat === 'form';

let wUid = 0;

export class WeaponInst {
  /**
   * @param {string} defId 武器の定義 ID。'form:剣' のような武器語由来の ID も可。
   * @param {number} level
   */
  constructor(defId, level = 1) {
    this.uid = ++wUid;
    this.defId = defId;
    this.def = lookupDef(defId);
    if (!this.def) throw new Error(`未知の武器: ${defId}`);
    this.level = level;
    /** @type {Sentence} 自由に並べた文。 */
    this.sentence = new Sentence({ maxLen: MAX_SENTENCE_LEN });
    this.cd = 0;
    this.phase = 0;         // 攻撃ごとの描画用 位相
    this.aim = 0;           // 照準角
    this.orbitAngle = 0;
    this.flash = 0;         // 攻撃フラッシュ
    this._sig = null;       // 再計算の判定用シグネチャ
    this._cache = null;
  }

  get name() { return this.def.name; }
  get filled() { return this.sentence.words; }

  // ── 旧スロット API の互換。内部は自由配置。 ────────────────────────────────
  get slots() { return this.sentence.words; }
  get connects() { return this.sentence.conns; }
  /** 語を index に置く。空いていれば挿入、すでにあれば置き換える。 */
  setSlot(i, word) {
    if (!word) return this.sentence.removeAt(i).ok;
    if (i >= this.sentence.count) return this.sentence.push(word).ok;
    if (this.sentence.entries[i].word === word) return true;
    // 長さは「その語の文字数の差だけ」見る。
    const old = this.sentence.entries[i].word.text;
    const d = word.text.length - old.length;
    if (this.sentence.len + d > this.sentence.maxLen) return false;
    this.sentence.entries[i].word = word;
    this._sig = null;
    return true;
  }
  /** 語の直後 (i) に接続詞を置く。 */
  setConnect(i, word) {
    const text = word ? word.text : null;
    const r = this.sentence.setConnAt(i, text);
    if (r.ok) this._sig = null;
    return r.ok;
  }
  /** 枠数は自由配置になったので何もしない (残互換)。 */
  resizeSlots() { this._sig = null; }

  /**
   * 文の中の武器語 (末尾から見て最初に見つかったもの)。
   * 攻撃の型はこれが決める。無いなら null。
   */
  get tail() {
    const ws = this.sentence.words;
    for (let i = ws.length - 1; i >= 0; i--) {
      if (isForm(ws[i].text)) return ws[i].text;
    }
    return null;
  }
  get tailWord() { return this.tail ? makeWord(this.tail) : null; }

  /** 文の並び (evaluate に渡す配列)。 */
  get segments() { return this.sentence.segments(); }

  levelUp() {
    if (this.level >= this.def.maxLevel) return false;
    this.level++;
    this._sig = null;
    return true;
  }

  /** 武器名。文そのもの。 */
  get title() {
    const t = this.sentence.text;
    return t || this.def.name;
  }

  /** 文面。 */
  get fullText() { return this.sentence.text; }

  /**
   * 文の中に 2 つ以上の武器語が並んでいないか。
   * 「刃剣」「弾矢」は日本語に無い並びなので落とす。
   * @returns {string[]|null}  並んでいた 2 語
   */
  adjacentForms() {
    const ws = this.sentence.words;
    for (let i = 0; i + 1 < ws.length; i++) {
      if (isForm(ws[i].text) && isForm(ws[i + 1].text)) return [ws[i].text, ws[i + 1].text];
    }
    return null;
  }

  /**
   * 並べた語・接続詞を文として評価する。
   * 武器語はプレイヤーが置いた語なので、実質語の要求は 2 つでよい。
   * 武器語は文のどこに置いてもよいので「末尾語」として扱わない。
   * (直前の語が武器語を修飾できるかの判定は下の adjacentForms で行う)
   */
  evaluate() {
    const e = this.sentence.evaluate({ minContent: 2 });
    if (!e.valid) return e;
    const pair = this.adjacentForms();
    if (pair) {
      return {
        ...e,
        valid: false,
        reason: 'tailform',
        reasonText: `武器語「${pair[0]}」と「${pair[1]}」が並んでいない。`
          + `形を表す語どうしは隣り合えないので、語を 1 つ挟むこと。`,
        grade: 'broken',
        gradeInfo: GRADES.broken,
      };
    }
    return e;
  }

  /**
   * 戦闘に使う最終ステータスを作る。
   * @param {object} ps プレイヤー能力
   */
  resolve(ps) {
    const sig = this.level + '|' + this.sentence.sig();
    if (this._sig === sig && this._cache) return this._cache;

    const e = this.evaluate();
    const base = baseStatsForLevel(this.def, this.level);
    // 攻撃の型は文の中の武器語が決める。無ければこの武器の既定。
    const tail = this.tail;
    const info = tail ? FORM_SHAPE[tail] : null;
    const kind = (info && info[1]) || this.def.kind;
    const shape = (info && info[0]) || this.def.shape || KIND_SHAPE[kind] || 'blade';

    const out = {
      active: e.valid,
      valid: e.valid,
      reason: e.reason,
      reasonText: e.reasonText,
      grade: e.grade,
      gradeInfo: e.gradeInfo,
      element: e.element,
      elementInfo: ELEMENTS[e.element] || ELEMENTS.none,
      kind,
      shape,
      tail,
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
      st[k] = (st[k] || 0) + v;
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
    // 描画用の形。
    st.shape = shape;
    st.kind = kind;

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
