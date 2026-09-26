// ============================================================================
// ワードローグ — プレイヤー能力の解決
//
// 語袋の中の「自身強化語」と、セーブの恒久強化から最終ステータスを作る。
// ============================================================================

import { WORDS, PARTICLES } from '../data/words.js';
import { clamp } from '../core/util.js';

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
 * 語袋からプレイヤー能力を集計する。
 * @param {Array<{cat:string,text:string,player:Object|null}>} pouch
 * @param {Object} meta セーブ側の恒久強化
 * @returns {typeof BASE_PLAYER}
 */
export function resolvePlayerStats(pouch, meta = {}) {
  const s = { ...BASE_PLAYER };
  s.maxHp += meta.hp || 0;
  s.atkMul += meta.atk || 0;
  s.xpMul += meta.xp || 0;
  s.armor += meta.armor || 0;
  s.magnet += meta.magnet || 0;
  s.crit += meta.crit || 0;

  for (const w of pouch) {
    if (!w || w.cat !== 'buff' || !w.player) continue;
    for (const [k, v] of Object.entries(w.player)) {
      if (!BUFF_KEYS.has(k)) continue;
      s[k] = (s[k] || 0) + v;
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

/**  player's one-liner for the HUD. */
export function statLine(s) {
  return [
    `攻 ${(s.atk * s.atkMul * 100).toFixed(0)}%`,
    `速 ${Math.round(s.spd)}`,
    `会心 ${(s.crit * 100).toFixed(0)}%`,
    `減傷 ${(s.armor * 100).toFixed(0)}%`,
  ].join('  ');
}

export { BUFF_KEYS };
