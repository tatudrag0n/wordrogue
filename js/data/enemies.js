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
// ============================================================================

export const ENEMIES = {
  bat: {
    id: 'bat', name: 'コウモリ', ai: 'erratic',
    hp: 10, speed: 62, dmg: 6, r: 9, xp: 1, color: '#9a6bb0', wing: 0.6,
  },
  slime: {
    id: 'slime', name: 'スライム', ai: 'chase',
    hp: 16, speed: 42, dmg: 7, r: 12, xp: 1, color: '#5fd98a', wobble: 1,
  },
  goblin: {
    id: 'goblin', name: 'ゴブリン', ai: 'chase',
    hp: 22, speed: 70, dmg: 9, r: 11, xp: 2, color: '#7fbf5a',
  },
  skeleton: {
    id: 'skeleton', name: 'スケルトン', ai: 'charger',
    hp: 30, speed: 55, dmg: 11, r: 12, xp: 3, color: '#e8e2d0',
    charge: { range: 210, speed: 320, time: 0.55, cd: 1.9 },
  },
  ghost: {
    id: 'ghost', name: 'ゴースト', ai: 'orbiter',
    hp: 26, speed: 58, dmg: 8, r: 11, xp: 3, color: '#a0d8e8', alpha: 0.55,
    orbit: { r: 90, w: 1.5 },
  },
  shooter: {
    id: 'shooter', name: 'アーチャー', ai: 'shooter',
    hp: 24, speed: 46, dmg: 8, r: 11, xp: 3, color: '#c8a06a',
    keep: 220, shot: { speed: 150, dmg: 8, cd: 2.2 },
  },
  brute: {
    id: 'brute', name: 'ゴブリン主力', ai: 'chase',
    hp: 90, speed: 40, dmg: 18, r: 19, xp: 6, color: '#b05a4a', heavy: 1,
  },
  swarm: {
    id: 'swarm', name: '子虫', ai: 'swarm',
    hp: 5, speed: 96, dmg: 4, r: 6, xp: 1, color: '#d8d06a',
  },
  wraith: {
    id: 'wraith', name: 'レイス', ai: 'chase',
    hp: 46, speed: 84, dmg: 12, r: 12, xp: 5, color: '#7a5ac0', alpha: 0.7,
  },
  golem: {
    id: 'golem', name: 'ゴーレム', ai: 'chase',
    hp: 210, speed: 32, dmg: 24, r: 26, xp: 12, color: '#8a8a95', heavy: 2,
    armor: 2,
  },

  // ── ボス ────────────────────────────────────────────────────────────────
  boss_slime: {
    id: 'boss_slime', name: 'キングスライム', ai: 'boss', boss: 1,
    hp: 1500, speed: 46, dmg: 22, r: 42, xp: 60, color: '#3fbf6a', heavy: 2,
    patterns: ['charge', 'summon', 'slam'],
    arena: 300,
  },
  boss_dragon: {
    id: 'boss_dragon', name: '黒竜', ai: 'boss', boss: 1,
    hp: 4200, speed: 62, dmg: 30, r: 46, xp: 140, color: '#8a2f4a', heavy: 2,
    patterns: ['charge', 'breath', 'summon', 'slam'],
    arena: 330,
  },
  boss_lich: {
    id: 'boss_lich', name: 'リーチ', ai: 'boss', boss: 1,
    hp: 9800, speed: 54, dmg: 36, r: 44, xp: 320, color: '#4a2f8a', heavy: 2,
    patterns: ['summon', 'ring', 'breath', 'charge', 'slam'],
    arena: 360,
  },
  boss_demon: {
    id: 'boss_demon', name: '深淵の魔王', ai: 'boss', boss: 1,
    hp: 26000, speed: 58, dmg: 44, r: 52, xp: 900, color: '#b03030', heavy: 3,
    patterns: ['charge', 'ring', 'breath', 'summon', 'slam', 'drain'],
    arena: 400,
  },
};

/** 通常敵の一覧。*/
export const ENEMY_IDS = Object.keys(ENEMIES).filter((id) => !ENEMIES[id].boss);
export const BOSS_IDS = Object.keys(ENEMIES).filter((id) => ENEMIES[id].boss);
