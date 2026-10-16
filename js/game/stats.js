// ============================================================================
// ワードローグ — プレイヤー能力の解決
//
// プレイヤーの強化はメインメニューの「部位強化」で行う (戦闘中には行わない)。
// 頭・右腕・左腕・右手・左手・右足・左足・胸・胴の 9 部位に語を入れると、
// その語の効果 (buff 語の player、それ以外の語は fx のうちプレイヤーに
// 効くもの) がそのまま能力に乗る。セーブの恒久強化 (書庫) もここで重ねる。
//
// 部位は **1 文として数える** (武器と同じ)。1 部位に 2 語まで入れられて、
// 語の直後には接続詞が選べる。
//   頑・健        … 2 語が並ぶだけ。文の力は少しだけ乗る。
//   発 + 電する   … 熟語「発電」が成立して、部位まるごとの効果が伸びる。
// 不成文の部位 (接続詞が結べていない等) は何も効かない。
//
// 戦闘中の語彙 (言葉デッキから来る) はステータスに影響しない。
// ============================================================================

import { WORDS, CONNECTOR_SET, CONNECTORS } from '../data/words.js';
import { clamp } from '../core/util.js';
import { evaluatePart, normPartEntries } from './parts.js';

/** 素の能力。 */
export const BASE_PLAYER = {
  maxHp: 100,
  spd: 122,        // px/s
  atk: 1,          // 攻撃倍率
  atkMul: 1,       // 攻撃倍率
  xpMul: 1,
  hpMul: 1,
  armor: 0,        // 被ダメージ軽減 (割合)
  crit: 0.05,
  critDmg: 1.5,    // 会心倍率
  magnet: 1.0,     // ピックアップ回収半径倍率
  regen: 0,        // hp/s
  lifesteal: 0,
  luck: 0,
  size: 1,         // 当たり判定サイズ倍率
  shield: 0,       // 吸収シールド (被弾時に消費)
  slowImmune: 0,   // 1 で完全免疫
  reflect: 0,      // 被弾を返す割合
};

/** buff 語がプレイヤーに与えるキー一覧。 */
const BUFF_KEYS = new Set([
  'hp', 'spd', 'atk', 'armor', 'crit', 'regen', 'lifesteal',
  'luck', 'magnet', 'xp', 'size', 'shield',
]);

/**
 * buff 以外の語を部位に入れたとき、プレイヤーに効くキー。
 * 動詞の spd は弾速、大きさと攻撃は武器側のものなので、ここには入れない。
 */
const PART_KEYS = new Set([
  'hp', 'armor', 'crit', 'regen', 'lifesteal', 'luck', 'magnet', 'shield',
]);

/**
 * buff 語の効果をプレイヤー能力へ写す。
 * 語データの hp は絶対値、spd と xp は割合なので、行き先のキーが違う。
 * @returns {boolean} 何か効いたか
 */
function applyBuffFx(s, src) {
  let used = false;
  for (const [k, v] of Object.entries(src)) {
    if (typeof v !== 'number' || !BUFF_KEYS.has(k)) continue;
    if (k === 'hp') s.maxHp += v;
    else if (k === 'xp') s.xpMul += v;
    else if (k === 'spd') s.spd *= 1 + v;
    else s[k] = (s[k] || 0) + v;
    used = true;
  }
  return used;
}

/**
 * 部位 1 つぶんの効果をプレイヤー能力に足す。
 * @param {object} s 集計中の能力
 * @param {object} src 語・接続詞・熟語の効果
 * @param {Set<string>} keys 通すキー
 * @param {number} gain 文の力による倍率
 * @param {boolean} buffForm buff 語の形か (hp / xp / spd の向きが違う)
 * @returns {boolean} 何か効いたか
 */
function applyPartSrc(s, src, keys, gain, buffForm) {
  let used = false;
  for (const [k, v] of Object.entries(src || {})) {
    if (typeof v !== 'number') continue;
    if (buffForm) {
      if (!BUFF_KEYS.has(k)) continue;
      if (k === 'hp') s.maxHp += v * gain;
      else if (k === 'xp') s.xpMul += v * gain;
      else if (k === 'spd') s.spd *= 1 + v * gain;
      else s[k] = (s[k] || 0) + v * gain;
      used = true;
      continue;
    }
    if (!keys.has(k)) continue;
    if (k === 'hp') s.maxHp += v * gain;
    else s[k] = (s[k] || 0) + v * gain;
    used = true;
  }
  return used;
}

/**
 * 部位に入れた語とセーブの恒久強化からプレイヤー能力を集計する。
 * @param {Array} parts 部位。次のどれでも受けつける。
 *   ・{ name, words:[{text,conn}] }   … 部位ごとの文 (いまの形)
 *   ・'頑' / { text:'頑' }             … 語 1 つ (古い呼び出し。1 語 = 1 部位)
 * @param {Object} meta セーブ側の恒久強化
 * @returns {typeof BASE_PLAYER}
 */
export function resolvePlayerStats(parts, meta = {}) {
  const s = { ...BASE_PLAYER };
  s.maxHp += meta.hp || 0;
  s.atkMul += meta.atk || 0;
  s.xpMul += meta.xp || 0;
  s.armor += meta.armor || 0;
  s.magnet += meta.magnet || 0;
  s.crit += meta.crit || 0;

  s.partCount = 0;
  s.partTexts = [];
  s.partRows = [];      // 部位ごとの表示 (文・grade・文の力)
  s.partBroken = [];    // 不成文の部位

  for (const raw of parts || []) {
    const isPart = raw && typeof raw === 'object' && Array.isArray(raw.words);
    const words = isPart ? raw.words : [raw];
    const name = isPart ? (raw.name || raw.id || '') : '';
    const p = evaluatePart(normPartEntries(words));
    if (!p.sen.count) continue;

    if (!p.valid) {
      s.partBroken.push({ name, text: p.text, reasonText: p.reasonText });
      continue;
    }
    const gain = p.gain;
    let used = 0;
    // 語そのものの効果。
    for (const e of p.sen.entries) {
      const info = WORDS[e.word.text];
      if (!info) continue;
      const isBuff = info.cat === 'buff';
      const ok = isBuff
        ? applyPartSrc(s, info.player || info.fx || {}, BUFF_KEYS, gain, true)
        : applyPartSrc(s, info.fx || {}, PART_KEYS, gain, false);
      if (ok) { used++; s.partTexts.push(info.text); }
      // 語の直後の接続詞。部位ではプレイヤーに効くキーだけを通す。
      if (e.conn) {
        if (applyPartSrc(s, CONNECTORS[e.conn.text]?.fx || {}, PART_KEYS, gain, false)) used++;
      }
    }
    // 熟語が成立していれば、その効果も乗る (発電 = 感電など)。
    if (p.idiom) applyPartSrc(s, p.idiom.fx || {}, PART_KEYS, gain, false);
    s.partCount += used;
    s.partRows.push({
      name, text: p.text, grade: p.ev.grade, gradeName: p.gradeInfo?.name || '',
      power: p.power, gain, idiom: p.idiom?.name || null,
    });
  }

  // 補正と上限。
  s.armor = clamp(s.armor, 0, 0.75);
  s.crit = clamp(s.crit, 0, 1);
  s.critDmg = Math.max(1, s.critDmg);
  s.size = clamp(s.size, 0.55, 2.2);
  s.magnet = clamp(s.magnet, 0.3, 6);
  s.spd = clamp(s.spd, 40, 420);
  s.maxHp = Math.max(10, s.maxHp * s.hpMul);
  s.hpMul = 1;
  s.atk = Math.max(0.1, s.atk);
  s.atkMul = Math.max(0.1, s.atkMul);
  s.xpMul = Math.max(0.1, s.xpMul);
  s.lifesteal = clamp(s.lifesteal, 0, 1.2);
  s.luck = clamp(s.luck, 0, 3);

  return s;
}

/** 語彙の中で重複している語をまとめる (表示用)。 */
export function lexiconSummary(lexicon) {
  const count = new Map();
  for (const w of lexicon) {
    if (!w) continue;
    count.set(w.text, (count.get(w.text) || 0) + 1);
  }
  return [...count.entries()].map(([text, n]) => ({ text, n, word: w(lexicon, text) }))
    .filter((x) => x.word);
}

const w = (lexicon, text) => lexicon.find((x) => x && x.text === text);

/** 語彙の中で「文に使える」語 (接続詞でないもの) の数。 */
export function lexiconContentCount(lexicon) {
  let n = 0;
  for (const x of lexicon) {
    if (x && !CONNECTOR_SET.has(x.text)) n++;
  }
  return n;
}

/**
 * HUD に出す能力表示の並びを決める。
 * 値が 0 のものは入れない。
 * @param {typeof BASE_PLAYER} s
 * @returns {Array<{key:string,label:string,value:string,kind:string}>}
 */
export function statRows(s) {
  const pct = (v) => `${Math.round(v * 100)}%`;
  const rows = [];

  rows.push({ key: 'atk', label: '攻撃', value: pct(s.atk * s.atkMul), kind: 'up' });
  rows.push({ key: 'spd', label: '移動', value: String(Math.round(s.spd)), kind: '' });
  rows.push({ key: 'hp', label: '体力', value: String(Math.round(s.maxHp)), kind: '' });
  rows.push({ key: 'crit', label: '会心', value: pct(s.crit), kind: '' });
  rows.push({ key: 'critDmg', label: '会心威力', value: `${s.critDmg.toFixed(2)}倍`, kind: '' });
  rows.push({ key: 'armor', label: '減傷', value: pct(s.armor), kind: s.armor > 0 ? 'up' : '' });

  // 0 のものは省略する。回復や吸血など、取ったときだけ効くもの。
  if (s.regen > 0) rows.push({ key: 'regen', label: '回復', value: `${s.regen.toFixed(1)}/s`, kind: 'up' });
  if (s.lifesteal > 0) rows.push({ key: 'lifesteal', label: '吸血', value: pct(s.lifesteal), kind: 'up' });
  if (s.shield > 0) rows.push({ key: 'shield', label: 'シールド', value: String(Math.round(s.shield)), kind: 'up' });
  if (s.magnet > 1.02) rows.push({ key: 'magnet', label: '吸引', value: `${s.magnet.toFixed(1)}倍`, kind: 'up' });
  if (s.xpMul > 1.02) rows.push({ key: 'xpMul', label: '経験値', value: pct(s.xpMul), kind: 'up' });
  if (s.slowImmune >= 1) rows.push({ key: 'slowImmune', label: '減速耐性', value: 'あり', kind: 'up' });
  if (Math.abs(s.size - 1) > 0.02) {
    rows.push({ key: 'size', label: '大きさ', value: `${s.size.toFixed(2)}倍`, kind: '' });
  }

  return rows;
}

/** 1 行のテキストに落とす版 (ログやテスト用)。 */
export function statLine(s) {
  return statRows(s).map((r) => `${r.label} ${r.value}`).join('  ');
}

export { BUFF_KEYS };
