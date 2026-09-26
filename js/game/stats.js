// ============================================================================
// ワードローグ — プレイヤー能力の解決
//
// 語袋の中の「自身強化語」と、プレイヤー自身の文、セーブの恒久強化から
// 最終ステータスを作る。
//
// 自身の文は武器と同じく、末尾の語 (人) が枠の外に固定で付く。
// 語を並べ替えても末尾は動かないので、称号は必ず「○○人」になる。
// ============================================================================

import { WORDS, PARTICLES, evaluate, makeWord } from '../data/words.js';
import { clamp } from '../core/util.js';

/** プレイヤー自身の文の末尾語。枠の外に固定で付く。 */
export const SELF_TAIL = '人';

/** 素の能力。 */
export const BASE_PLAYER = {
  maxHp: 100,
  spd: 122,        // px/s
  atk: 1,          // 攻撃倍率
  atkMul: 1,       // 攻撃倍率 (文から来る)
  xpMul: 1,
  hpMul: 1,
  armor: 0,        // 被ダメージ軽減 (%)
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

/** 語袋の buff 語がプレイヤーに与えるキー一覧。 */
const BUFF_KEYS = new Set([
  'hp', 'spd', 'atk', 'armor', 'crit', 'regen', 'lifesteal',
  'luck', 'magnet', 'xp', 'size', 'shield',
]);

/**
 * 語袋と「自身の文」からプレイヤー能力を集計する。
 * @param {Array} pouch 語袋
 * @param {Array<object>} selfSlots プレイヤーの文
 * @param {Object} meta セーブ側の恒久強化
 * @returns {typeof BASE_PLAYER}
 */
export function resolvePlayerStats(pouch, selfSlots = [], meta = {}) {
  const s = { ...BASE_PLAYER };
  s.maxHp += meta.hp || 0;
  s.atkMul += meta.atk || 0;
  s.xpMul += meta.xp || 0;
  s.armor += meta.armor || 0;
  s.magnet += meta.magnet || 0;
  s.crit += meta.crit || 0;

  // 語袋の buff 語。
  for (const w of pouch) {
    if (!w || w.cat !== 'buff' || !w.player) continue;
    for (const [k, v] of Object.entries(w.player)) {
      if (!BUFF_KEYS.has(k)) continue;
      s[k] = (s[k] || 0) + v;
    }
  }

  // プレイヤー自身の文。末尾語 (人) も一緒に評価する。
  // 中の語が player を持っていれば足す。文が成立していれば文の力が半分だけ効く。
  const selfFilled = selfSlots.filter(Boolean);
  const selfAll = [...selfFilled, makeWord(SELF_TAIL)];
  const selfTitle = selfAll.map((w) => w.text).join('');
  // 末尾語はプレイヤーが置いた語ではないので、実質語の要求を 1 つ増やす。
  const ev = evaluate(selfAll, { minContent: 3 });
  const selfValid = ev.valid;
  const selfPower = selfValid ? 1 + (ev.fx.power - 1) * 0.5 : 1;
  for (const w of selfFilled) {
    const p = w.player || (w.cat === 'buff' ? w.fx : null);
    if (!p) continue;
    for (const [k, v] of Object.entries(p)) {
      if (!BUFF_KEYS.has(k)) continue;
      s[k] = (s[k] || 0) + v;
    }
  }
  s.selfTitle = selfFilled.length ? selfTitle : '';
  s.selfValid = selfFilled.length ? selfValid : false;
  s.selfPower = selfPower;
  s.selfPowerFx = ev.fx.power;
  s.selfSegments = ev.segments;
  // 自身の文の力は、攻撃と防御に効く。
  s.atkMul *= selfPower;
  s.armor = clamp(s.armor * selfPower, 0, 0.8);

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

/** 語袋の中で重複している語をまとめる (表示用)。 */
export function pouchSummary(pouch) {
  const count = new Map();
  for (const w of pouch) {
    if (!w) continue;
    count.set(w.text, (count.get(w.text) || 0) + 1);
  }
  return [...count.entries()].map(([text, n]) => ({ text, n, word: w(pouch, text) }))
    .filter((x) => x.word);
}

const w = (pouch, text) => pouch.find((x) => x && x.text === text);

/** 語袋の中で「文に使える」語 (助詞でないもの) の数。 */
export function contentCount(pouch) {
  let n = 0;
  for (const x of pouch) {
    if (x && !PARTICLES.has(x.text)) n++;
  }
  return n;
}

/**
 * HUD に出す能力表示の並びを決める。
 * 称号は hud-self 側で出るので、ここには数値だけ。
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
