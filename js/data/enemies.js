// ============================================================================
// ワードローグ — 敵定義
//
// ai には挙動のパターンを書く。
//   chase    まっすぐ追ってくる。基本。
//   erratic  ふらふらしながら近づく。
//   charger  一定距離を置いたら突進する。
//   dasher   予備動作のあと、一直線に踏み込む (新しい突進)。
//   shooter  距離を保って弾を撃つ。
//   spitter  距離を保ち、三方向に弾を撃つ (新しい射撃)。
//   orbiter  周回しながら近づく。
//   swarm    極小の群れ。数で押す。
//   burrow   地中に潜って出て、弾を撃つ。
//   boss     行動パターンを配列で指定する。中ボスもこの AI を使う。
//
// rank は敵の強さの段階。1=雑魚 / 2=そこそこ / 3=強敵 / 4=精鋭 / 5=ボス。
// words は敵が持つ「文」。プレイヤーの文からこの文の語を斬り落とす。
// 語が足りなくなると文が崩れて (不成文)、敵は無力になる。
// 文字数は rank に合わせる (1・2・3・4・5 文字)。全部、辞書にある語だけ。
// 雑魚 (rank 1) は 1 文字なので、文としては成立しない — 斬ればすぐ崩れる。
// ============================================================================

import { evaluate, WORDS } from './words.js?v=1.23';


export const ENEMIES = {
  // ── 雑魚 (1 文字) ─────────────────────────────────────────────────────
  bat: {
    words: ['影'], rank: 1,
    id: 'bat', name: 'コウモリ', ai: 'erratic',
    hp: 10, speed: 62, dmg: 6, r: 9, xp: 1, color: '#804e97', wing: 0.6,
  },
  slime: {
    words: ['溶'], rank: 1,
    id: 'slime', name: 'スライム', ai: 'chase',
    hp: 16, speed: 42, dmg: 7, r: 12, xp: 1, color: '#2ab25a', wobble: 1,
  },
  swarm: {
    words: ['裂'], rank: 1,
    id: 'swarm', name: '子虫', ai: 'swarm',
    hp: 5, speed: 96, dmg: 4, r: 6, xp: 1, color: '#b1a72a',
  },

  // ── そこそこ (2 文字) ────────────────────────────────────────────────
  goblin: {
    words: ['剛', '爪'], rank: 2,
    id: 'goblin', name: 'ゴブリン', ai: 'chase',
    hp: 22, speed: 70, dmg: 9, r: 11, xp: 2, color: '#65a83e',
  },
  skeleton: {
    words: ['死', '刃'], rank: 2,
    id: 'skeleton', name: 'スケルトン', ai: 'charger',
    hp: 30, speed: 55, dmg: 11, r: 12, xp: 3, color: '#8b7841',
    charge: { range: 210, speed: 320, time: 0.55, cd: 1.9 },
  },
  ghost: {
    words: ['漆', '死'], rank: 2,
    id: 'ghost', name: 'ゴースト', ai: 'orbiter',
    hp: 26, speed: 58, dmg: 8, r: 11, xp: 3, color: '#2789a5', alpha: 0.55,
    orbit: { r: 90, w: 1.5 },
  },
  shooter: {
    words: ['貫', '刃'], rank: 2,
    id: 'shooter', name: 'アーチャー', ai: 'shooter',
    hp: 24, speed: 46, dmg: 8, r: 11, xp: 3, color: '#a37639',
    keep: 220, shot: { speed: 150, dmg: 8, cd: 2.2 },
  },
  mole: {
    words: ['土', '爪'], rank: 2,
    id: 'mole', name: 'モグラ', ai: 'burrow',
    hp: 18, speed: 50, dmg: 7, r: 10, xp: 2, color: '#8c6a48',
    burrow: { dive: 1.1, surface: 0.9, shot: { speed: 130, dmg: 6, cd: 0 } },
  },
  brush: {
    words: ['早', '鋼'], rank: 2,
    id: 'brush', name: '筆', ai: 'erratic',
    hp: 14, speed: 98, dmg: 6, r: 8, xp: 2, color: '#987a34', wing: 0.4,
  },

  // ── 強敵 (3 文字) ────────────────────────────────────────────────────
  brute: {
    words: ['巨', '剛', '力'], rank: 3,
    id: 'brute', name: 'ゴブリン主力', ai: 'chase',
    hp: 90, speed: 40, dmg: 18, r: 19, xp: 6, color: '#a45142', heavy: 1,
  },
  wraith: {
    words: ['夜', '雷', '影'], rank: 3,
    id: 'wraith', name: 'レイス', ai: 'dasher',
    hp: 46, speed: 84, dmg: 12, r: 12, xp: 5, color: '#5f3da9', alpha: 0.7,
    dash: { range: 250, speed: 430, windup: 0.38, time: 0.5, cd: 2.1 },
  },
  inkfiend: {
    words: ['毒', '影', '闇'], rank: 3,
    id: 'inkfiend', name: '墨鬼', ai: 'spitter',
    hp: 40, speed: 50, dmg: 10, r: 12, xp: 5, color: '#493e6b',
    keep: 240, shot: { speed: 190, dmg: 10, cd: 2.6, count: 3, spread: 0.24 },
  },

  // ── 精鋭 (4 文字) ────────────────────────────────────────────────────
  rhymer: {
    words: ['響', '律', '華', '斉'], rank: 4,
    id: 'rhymer', name: '韻獣', ai: 'charger',
    hp: 70, speed: 60, dmg: 16, r: 16, xp: 8, color: '#66309c',
    charge: { range: 240, speed: 380, time: 0.6, cd: 2.2 },
  },
  golem: {
    words: ['鋼', '巨', '剛', '硬'], rank: 4,
    id: 'golem', name: 'ゴーレム', ai: 'chase',
    hp: 210, speed: 32, dmg: 24, r: 26, xp: 12, color: '#5c5c7f', heavy: 2,
    armor: 2,
  },

  // ── 中ボス (4 文字・各章に 1 体) ──────────────────────────────────────
  // boss AI を使うが、boss フラグは立てない。文は斬れて、倒すと宝箱を落とす。
  mid_boar: {
    words: ['荒', '牙', '剛', '力'], rank: 4, midBoss: 1,
    id: 'mid_boar', name: '荒猪', ai: 'boss',
    hp: 260, speed: 52, dmg: 16, r: 28, xp: 25, color: '#a45142', heavy: 2, armor: 1,
    patterns: ['charge', 'slam'], atkGap: 3.0, arena: 260,
  },
  mid_treant: {
    words: ['樹', '根', '苔', '花'], rank: 4, midBoss: 1,
    id: 'mid_treant', name: '古樹', ai: 'boss',
    hp: 480, speed: 46, dmg: 20, r: 30, xp: 45, color: '#4e7a46', heavy: 2, armor: 2,
    patterns: ['ring', 'summon', 'slam'], atkGap: 3.2, arena: 280,
  },
  mid_grave: {
    words: ['骨', '魂', '冥', '死'], rank: 4, midBoss: 1,
    id: 'mid_grave', name: '墓守', ai: 'boss',
    hp: 760, speed: 50, dmg: 24, r: 30, xp: 70, color: '#767c95', heavy: 2, armor: 2,
    patterns: ['summon', 'slam', 'ring'], atkGap: 3.1, arena: 290,
  },
  mid_knight: {
    words: ['鋼', '鉄', '剛', '刃'], rank: 4, midBoss: 1,
    id: 'mid_knight', name: '鎧騎士', ai: 'boss',
    hp: 1150, speed: 54, dmg: 28, r: 32, xp: 100, color: '#8b7841', heavy: 2, armor: 3,
    patterns: ['charge', 'slam', 'ring'], atkGap: 3.0, arena: 300,
  },
  mid_wraith: {
    words: ['夜', '影', '死', '闇'], rank: 4, midBoss: 1,
    id: 'mid_wraith', name: '夜影', ai: 'boss',
    hp: 1650, speed: 62, dmg: 32, r: 32, xp: 140, color: '#5f3da9', heavy: 2, armor: 2,
    patterns: ['charge', 'ring', 'summon'], atkGap: 2.9, arena: 310,
  },
  mid_demon: {
    words: ['魔', '獄', '炎', '闇'], rank: 4, midBoss: 1,
    id: 'mid_demon', name: '獄炎獣', ai: 'boss',
    hp: 2350, speed: 58, dmg: 38, r: 34, xp: 190, color: '#b32d2d', heavy: 3, armor: 3,
    patterns: ['ring', 'breath', 'charge'], atkGap: 2.8, arena: 320,
  },
  mid_scribe: {
    words: ['律', '鋼', '早', '斉'], rank: 4, midBoss: 1,
    id: 'mid_scribe', name: '律書', ai: 'boss',
    hp: 3300, speed: 60, dmg: 44, r: 34, xp: 250, color: '#998333', heavy: 3, armor: 3,
    patterns: ['ring', 'summon', 'slam'], atkGap: 2.8, arena: 330,
  },
  mid_rhyme: {
    words: ['響', '律', '華', '斉'], rank: 4, midBoss: 1,
    id: 'mid_rhyme', name: '韻律', ai: 'boss',
    hp: 4600, speed: 64, dmg: 50, r: 36, xp: 330, color: '#4f86a8', heavy: 3, armor: 3,
    patterns: ['breath', 'charge', 'ring'], atkGap: 2.7, arena: 340,
  },
  mid_origin: {
    words: ['光', '闇', '虚', '幻'], rank: 4, midBoss: 1,
    id: 'mid_origin', name: '原初', ai: 'boss',
    hp: 6400, speed: 66, dmg: 56, r: 38, xp: 430, color: '#c9971f', heavy: 3, armor: 4,
    patterns: ['ring', 'breath', 'summon', 'slam'], atkGap: 2.6, arena: 360,
  },

  // ── ボス (5 文字) ────────────────────────────────────────────────────
  boss_slime: {
    words: ['溶', '巨', '剛', '硬', '力'], rank: 5,
    id: 'boss_slime', name: 'キングスライム', ai: 'boss', boss: 1,
    hp: 1500, speed: 46, dmg: 22, r: 42, xp: 60, color: '#36af5f', heavy: 2,
    patterns: ['charge', 'summon', 'slam'],
    arena: 300,
  },
  boss_dragon: {
    words: ['焔', '雷', '刃', '剛', '硬'], rank: 5,
    id: 'boss_dragon', name: '黒竜', ai: 'boss', boss: 1,
    hp: 4200, speed: 62, dmg: 30, r: 46, xp: 140, color: '#8c2d49', heavy: 2,
    patterns: ['charge', 'breath', 'summon', 'slam', 'spiral'],
    arena: 330,
  },
  boss_lich: {
    words: ['死', '凍', '貫', '冥', '闇'], rank: 5,
    id: 'boss_lich', name: 'リーチ', ai: 'boss', boss: 1,
    hp: 9800, speed: 54, dmg: 36, r: 44, xp: 320, color: '#492d8c', heavy: 2,
    patterns: ['summon', 'ring', 'breath', 'charge', 'slam'],
    arena: 360,
  },
  boss_demon: {
    words: ['魔', '爆', '巨', '剛', '力'], rank: 5,
    id: 'boss_demon', name: '深淵の魔王', ai: 'boss', boss: 1,
    hp: 26000, speed: 58, dmg: 44, r: 52, xp: 900, color: '#b32d2d', heavy: 3,
    patterns: ['charge', 'ring', 'breath', 'summon', 'slam', 'drain'],
    arena: 400,
  },
  boss_scribe: {
    words: ['律', '鋼', '貫', '早', '斉'], rank: 5,
    id: 'boss_scribe', name: '筆王', ai: 'boss', boss: 1,
    hp: 44000, speed: 66, dmg: 52, r: 48, xp: 1800, color: '#998333', heavy: 3,
    patterns: ['ring', 'summon', 'breath', 'charge', 'slam'],
    arena: 420,
  },
  boss_word: {
    words: ['爆', '雷', '凍', '剛', '裂'], rank: 5,
    id: 'boss_word', name: '詞獣', ai: 'boss', boss: 1,
    hp: 96000, speed: 62, dmg: 64, r: 56, xp: 4000, color: '#6827a5', heavy: 3,
    patterns: ['ring', 'breath', 'summon', 'charge', 'slam', 'drain'],
    arena: 450,
  },
};

/** 通常敵の一覧 (中ボス・ボスは含めない)。*/
export const ENEMY_IDS = Object.keys(ENEMIES)
  .filter((id) => !ENEMIES[id].boss && !ENEMIES[id].midBoss);
/** 中ボスの一覧。*/
export const MID_BOSS_IDS = Object.keys(ENEMIES).filter((id) => ENEMIES[id].midBoss);
/** 章ボスの一覧。*/
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
