// ============================================================================
// ワードローグ — ステージ定義
//
// 1 ステージ = 制限時間まで生き延びてボス香蕉。
// 経過時間に合わせて出現テーブルを順に配備する。
// クリア報酬は報酬画面で選ぶ。
// ============================================================================

/**
 * waves は 10 秒刻み。各要素は { at: 開始秒, list: [[敵ID, 個体数], ...] }
 * 一度に出すと出切ったぶんは次のウェーブに回す。
 */
export const STAGES = [
  {
    id: 1, name: '村の外れ', time: 60, boss: null,
    color: '#2a3a2e', ground: '#1b2a1f', accent: '#8fd694',
    intro: '夜が明ける前に村を出る。',
    waves: [
      { at: 0,  list: [['bat', 6]] },
      { at: 12, list: [['bat', 10], ['slime', 4]] },
      { at: 28, list: [['slime', 8], ['goblin', 5]] },
      { at: 44, list: [['bat', 12], ['goblin', 8], ['swarm', 10]] },
    ],
    reward: 2,
  },
  {
    id: 2, name: '森の奥', time: 70, boss: 'boss_slime',
    color: '#1e3326', ground: '#13241a', accent: '#7ad694',
    intro: '樹が蠢える。何かが居る。',
    waves: [
      { at: 0,  list: [['bat', 10], ['slime', 6]] },
      { at: 14, list: [['goblin', 10], ['swarm', 14]] },
      { at: 30, list: [['ghost', 6], ['goblin', 10]] },
      { at: 46, list: [['skeleton', 8], ['ghost', 8], ['swarm', 20]] },
      { at: 58, list: [['brute', 2]] },
    ],
    reward: 2,
  },
  {
    id: 3, name: '廃村', time: 80, boss: 'boss_dragon',
    color: '#332a20', ground: '#241c15', accent: '#e0b070',
    intro: '民が去った村。灯りがまだ点いている。',
    waves: [
      { at: 0,  list: [['goblin', 12], ['swarm', 16]] },
      { at: 14, list: [['skeleton', 10], ['shooter', 5]] },
      { at: 30, list: [['wraith', 8], ['goblin', 14]] },
      { at: 46, list: [['brute', 4], ['shooter', 8]] },
      { at: 62, list: [['wraith', 12], ['ghost', 10]] },
    ],
    reward: 3,
  },
  {
    id: 4, name: '地下墓場', time: 85, boss: 'boss_lich',
    color: '#2a2a34', ground: '#1b1b22', accent: '#b0b0d0',
    intro: '石棺の隙間から冷気。',
    waves: [
      { at: 0,  list: [['skeleton', 14], ['ghost', 10]] },
      { at: 14, list: [['wraith', 10], ['shooter', 10]] },
      { at: 30, list: [['brute', 6], ['skeleton', 16]] },
      { at: 46, list: [['ghost', 16], ['wraith', 14]] },
      { at: 62, list: [['golem', 2], ['shooter', 12]] },
    ],
    reward: 3,
  },
  {
    id: 5, name: '城塞外壁', time: 90, boss: 'boss_demon',
    color: '#3a2020', ground: '#261515', accent: '#ff8a70',
    intro: '城壁の向こうで、魔王が待っている。',
    waves: [
      { at: 0,  list: [['brute', 8], ['skeleton', 16]] },
      { at: 16, list: [['wraith', 16], ['shooter', 14]] },
      { at: 32, list: [['golem', 3], ['wraith', 18]] },
      { at: 48, list: [['brute', 12], ['ghost', 20]] },
      { at: 66, list: [['golem', 5], ['wraith', 20], ['shooter', 16]] },
    ],
    reward: 3,
  },
  {
    id: 6, name: '深淵の魔王城', time: 100, boss: 'boss_demon',
    color: '#2a1030', ground: '#1a0a1e', accent: '#d070ff',
    intro: 'すべてが終わる場所。',
    waves: [
      { at: 0,  list: [['wraith', 20], ['shooter', 16]] },
      { at: 16, list: [['golem', 5], ['brute', 14]] },
      { at: 34, list: [['ghost', 24], ['wraith', 22]] },
      { at: 52, list: [['golem', 8], ['shooter', 20]] },
      { at: 70, list: [['brute', 20], ['wraith', 26], ['golem', 6]] },
    ],
    reward: 4,
  },
];

export const STAGE_IDS = STAGES.map((s) => s.id);

/** ステージ定義を取り出す。 */
export function getStage(id) {
  return STAGES.find((s) => s.id === id) || STAGES[0];
}

/** 指定ステージまでにクリアした最高 ID。 */
export function clearedCount(list) {
  return Array.isArray(list) ? list.length : 0;
}
