// ============================================================================
// ワードローグ — 敵定義
//
// ai には挙動のパターンを書く。
//   chase    まっすぐ追ってくる。基本。
//   erratic  ふらふらしながら近づく。
//   charger  一定距離を置いたら突進する。
//   shooter  距離を保って弾を撃つ。
//   orbiter  周回しながら近づく。
//   swarm    extremely small な群れ。数で押す。
//   burrow   地中に潜って出て，合理弹。
//   boss     行動パターンを配列で指定する。
//
// words は敵が持つ「文」。プレイヤーの文からこの文の語を斬り落とす。
// 語が足りなくなると文が崩れて (不成文)、敵は無力になる。
// 全部、辞書にある語だけを並べる。evaluate() で検証済み。
// ============================================================================

import { evaluate, WORDS } from './words.js';


export const ENEMIES = {
  bat: {
    words: ['闇影', '追影'],
    id: 'bat', name: 'コウモリ', ai: 'erratic',
    hp: 10, speed: 62, dmg: 6, r: 9, xp: 1, color: '#9a6bb0', wing: 0.6,
  },
  slime: {
    words: ['溶ける', '小柄'],
    id: 'slime', name: 'スライム', ai: 'chase',
    hp: 16, speed: 42, dmg: 7, r: 12, xp: 1, color: '#5fd98a', wobble: 1,
  },
  goblin: {
    words: ['剛硬', '利爪'],
    id: 'goblin', name: 'ゴブリン', ai: 'chase',
    hp: 22, speed: 70, dmg: 9, r: 11, xp: 2, color: '#7fbf5a',
  },
  skeleton: {
    words: ['死', '角'],
    id: 'skeleton', name: 'スケルトン', ai: 'charger',
    hp: 30, speed: 55, dmg: 11, r: 12, xp: 3, color: '#e8e2d0',
    charge: { range: 210, speed: 320, time: 0.55, cd: 1.9 },
  },
  ghost: {
    words: ['追影', '死'],
    id: 'ghost', name: 'ゴースト', ai: 'orbiter',
    hp: 26, speed: 58, dmg: 8, r: 11, xp: 3, color: '#a0d8e8', alpha: 0.55,
    orbit: { r: 90, w: 1.5 },
  },
  shooter: {
    words: ['角', '貫通'],
    id: 'shooter', name: 'アーチャー', ai: 'shooter',
    hp: 24, speed: 46, dmg: 8, r: 11, xp: 3, color: '#c8a06a',
    keep: 220, shot: { speed: 150, dmg: 8, cd: 2.2 },
  },
  brute: {
    words: ['巨大', '剛硬'],
    id: 'brute', name: 'ゴブリン主力', ai: 'chase',
    hp: 90, speed: 40, dmg: 18, r: 19, xp: 6, color: '#b05a4a', heavy: 1,
  },
  swarm: {
    words: ['分裂', '乱打'],
    id: 'swarm', name: '子虫', ai: 'swarm',
    hp: 5, speed: 96, dmg: 4, r: 6, xp: 1, color: '#d8d06a',
  },
  wraith: {
    words: ['闇黒', '雷神'],
    id: 'wraith', name: 'レイス', ai: 'chase',
    hp: 46, speed: 84, dmg: 12, r: 12, xp: 5, color: '#7a5ac0', alpha: 0.7,
  },
  golem: {
    words: ['鋼', '巨大'],
    id: 'golem', name: 'ゴーレム', ai: 'chase',
    hp: 210, speed: 32, dmg: 24, r: 26, xp: 12, color: '#8a8a95', heavy: 2,
    armor: 2,
  },
  // ── 語書庫 以降 ──────────────────────────────────────────────────────────
  brush: {
    words: ['迅早', '鋼'],
    id: 'brush', name: '筆', ai: 'erratic',
    hp: 14, speed: 98, dmg: 6, r: 8, xp: 2, color: '#e8dcc0', wing: 0.4,
  },
  inkfiend: {
    words: ['毒', '闇影'],
    id: 'inkfiend', name: '墨鬼', ai: 'shooter',
    hp: 40, speed: 50, dmg: 10, r: 12, xp: 5, color: '#4a3f6a',
    keep: 240, shot: { speed: 190, dmg: 10, cd: 2.6 },
  },
  rhymer: {
    words: ['韻人', '剛硬'],
    id: 'rhymer', name: '韻獣', ai: 'charger',
    hp: 70, speed: 60, dmg: 16, r: 16, xp: 8, color: '#c0a0e0',
    charge: { range: 240, speed: 380, time: 0.6, cd: 2.2 },
  },

  // ── ボス ────────────────────────────────────────────────────────────────
  boss_slime: {
    words: ['溶ける', '巨大', '剛硬'],
    id: 'boss_slime', name: 'キングスライム', ai: 'boss', boss: 1,
    hp: 1500, speed: 46, dmg: 22, r: 42, xp: 60, color: '#3fbf6a', heavy: 2,
    patterns: ['charge', 'summon', 'slam'],
    arena: 300,
  },
  boss_dragon: {
    words: ['業火', '雷神', '角'],
    id: 'boss_dragon', name: '黒竜', ai: 'boss', boss: 1,
    hp: 4200, speed: 62, dmg: 30, r: 46, xp: 140, color: '#8a2f4a', heavy: 2,
    patterns: ['charge', 'breath', 'summon', 'slam'],
    arena: 330,
  },
  boss_lich: {
    words: ['死', '凍結', '貫通'],
    id: 'boss_lich', name: 'リーチ', ai: 'boss', boss: 1,
    hp: 9800, speed: 54, dmg: 36, r: 44, xp: 320, color: '#4a2f8a', heavy: 2,
    patterns: ['summon', 'ring', 'breath', 'charge', 'slam'],
    arena: 360,
  },
  boss_demon: {
    words: ['黒魔', '爆裂', '巨大', '剛硬'],
    id: 'boss_demon', name: '深淵の魔王', ai: 'boss', boss: 1,
    hp: 26000, speed: 58, dmg: 44, r: 52, xp: 900, color: '#b03030', heavy: 3,
    patterns: ['charge', 'ring', 'breath', 'summon', 'slam', 'drain'],
    arena: 400,
  },
  boss_scribe: {
    words: ['律', '鋼', '貫通', '迅早'],
    id: 'boss_scribe', name: '筆王', ai: 'boss', boss: 1,
    hp: 44000, speed: 66, dmg: 52, r: 48, xp: 1800, color: '#d8c890', heavy: 3,
    patterns: ['ring', 'summon', 'breath', 'charge', 'slam'],
    arena: 420,
  },
  boss_word: {
    words: ['爆裂', '雷神', '凍結', '剛硬', '分裂'],
    id: 'boss_word', name: '詞獣', ai: 'boss', boss: 1,
    hp: 96000, speed: 62, dmg: 64, r: 56, xp: 4000, color: '#f0e0ff', heavy: 3,
    patterns: ['ring', 'breath', 'summon', 'charge', 'slam', 'drain'],
    arena: 450,
  },
};

/** 通常敵の一覧。*/
export const ENEMY_IDS = Object.keys(ENEMIES).filter((id) => !ENEMIES[id].boss);
export const BOSS_IDS = Object.keys(ENEMIES).filter((id) => ENEMIES[id].boss);

/**
 * 敵の文を評価した結果。定義は変わらないので 1 回だけ計算して持たせる。
 * プレイヤーが語を斬るたびに「残り」で評価し直す。
 * @param {object} def ENEMIES の要素
 * @param {string[]} [remain] 残っている語 (全部なら省略)
 */
const sentCache = new WeakMap();
export function enemySentence(def, remain = null) {
  const full = def.words || [];
  if (!remain) {
    let hit = sentCache.get(def);
    if (!hit) {
      hit = evaluate(full.map((text) => ({ text })));
      sentCache.set(def, hit);
    }
    return hit;
  }
  return evaluate(remain.map((text) => ({ text })));
}

/** 敵の文の残り。全部の語。 */
export function enemyWords(def) {
  return (def.words || []).slice();
}
