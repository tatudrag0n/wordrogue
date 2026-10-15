// ============================================================================
// ワードローグ — プレイヤー能力の解決
//
// プレイヤーの強化はメインメニューの「部位強化」で行う (戦闘中には行わない)。
// 頭・右腕・左腕・右手・左手・右足・左足・胸・胴の 9 部位に語を入れると、
// その語の効果 (buff 語の player、それ以外の語は fx のうちプレイヤーに
// 効くもの) がそのまま能力に乗る。セーブの恒久強化 (書庫) もここで重ねる。
//
// 戦闘中の語彙 (言葉デッキから来る) はステータスに影響しない。
// ============================================================================

import { WORDS, CONNECTOR_SET } from '../data/words.js';
import { clamp } from '../core/util.js';

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
 * 部位に入れた語とセーブの恒久強化からプレイヤー能力を集計する。
 * @param {Array<string|object>} partWords 部位に入っている語 (text でも語オブジェクトでも可)
 * @param {Object} meta セーブ側の恒久強化
 * @returns {typeof BASE_PLAYER}
 */
export function resolvePlayerStats(partWords, meta = {}) {
  const s = { ...BASE_PLAYER };
  s.maxHp += meta.hp || 0;
  s.atkMul += meta.atk || 0;
  s.xpMul += meta.xp || 0;
  s.armor += meta.armor || 0;
  s.magnet += meta.magnet || 0;
  s.crit += meta.crit || 0;

  // 部位の語。buff 語は player の効果、それ以外は fx のうち効くものだけ。
  s.partCount = 0;
  s.partTexts = [];
  for (const w of partWords || []) {
    const text = typeof w === 'string' ? w : w?.text;
    const info = (text && WORDS[text]) || (typeof w === 'object' ? w : null);
    if (!info || !info.text || CONNECTOR_SET.has(info.text)) continue;
    const isBuff = info.cat === 'buff';
    let used;
    if (isBuff) {
      used = applyBuffFx(s, info.player || info.fx || {});
    } else {
      used = false;
      for (const [k, v] of Object.entries(info.fx || {})) {
        if (!PART_KEYS.has(k) || typeof v !== 'number') continue;
        if (k === 'hp') s.maxHp += v;
        else s[k] = (s[k] || 0) + v;
        used = true;
      }
    }
    if (used) {
      s.partCount++;
      s.partTexts.push(info.text);
    }
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
