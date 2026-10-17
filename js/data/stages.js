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
    color: '#6f8a52', ground: '#dfe7cb', accent: '#3f6b3a',
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
    color: '#4e7a46', ground: '#d8e3c6', accent: '#2f5c34',
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
    color: '#a3814f', ground: '#e9dcc0', accent: '#7d5a2a',
    intro: '民が去った村。灯りがまだ点いている。',
    waves: [
      { at: 0,  list: [['goblin', 12], ['swarm', 16]] },
      { at: 14, list: [['skeleton', 10], ['shooter', 5]] },
      { at: 30, list: [['wraith', 8], ['goblin', 14], ['mole', 6]] },
      { at: 46, list: [['brute', 4], ['shooter', 8]] },
      { at: 62, list: [['wraith', 12], ['ghost', 10]] },
    ],
    reward: 3,
  },
  {
    id: 4, name: '地下墓場', time: 85, boss: 'boss_lich',
    color: '#767c95', ground: '#dfe0e6', accent: '#4c5169',
    intro: '石棺の隙間から冷気。',
    waves: [
      { at: 0,  list: [['skeleton', 14], ['ghost', 10]] },
      { at: 14, list: [['wraith', 10], ['shooter', 10]] },
      { at: 30, list: [['brute', 6], ['skeleton', 16], ['mole', 8]] },
      { at: 46, list: [['ghost', 16], ['wraith', 14]] },
      { at: 62, list: [['golem', 2], ['shooter', 12]] },
    ],
    reward: 3,
  },
  {
    id: 5, name: '城塞外壁', time: 90, boss: 'boss_demon',
    color: '#a97a4e', ground: '#e9dccb', accent: '#8a4f28',
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
    color: '#6c5cae', ground: '#dddff0', accent: '#4b3d86',
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
  {
    id: 7, name: '語書庫', time: 105, boss: 'boss_scribe',
    color: '#a5813f', ground: '#eee6cf', accent: '#7a5a1e',
    intro: '使われなかったことばが積まれている。',
    waves: [
      { at: 0,  list: [['brush', 20], ['skeleton', 14]] },
      { at: 16, list: [['inkfiend', 10], ['wraith', 16]] },
      { at: 32, list: [['rhymer', 10], ['brush', 30], ['shooter', 10]] },
      { at: 50, list: [['golem', 6], ['inkfiend', 14]] },
      { at: 70, list: [['rhymer', 18], ['wraith', 24], ['brush', 40]] },
    ],
    reward: 4,
  },
  {
    id: 8, name: '韻律の塔', time: 110, boss: 'boss_scribe',
    color: '#4f86a8', ground: '#dce8ef', accent: '#2c6280',
    intro: '上へ上へ。同じ音が何千も重なっている。',
    waves: [
      { at: 0,  list: [['rhymer', 16], ['inkfiend', 12]] },
      { at: 16, list: [['brush', 40], ['shooter', 16]] },
      { at: 34, list: [['rhymer', 22], ['wraith', 20], ['inkfiend', 16]] },
      { at: 54, list: [['golem', 9], ['rhymer', 24]] },
      { at: 76, list: [['ghost', 30], ['brush', 50], ['shooter', 22]] },
    ],
    reward: 5,
  },
  {
    id: 9, name: '言葉の根源', time: 120, boss: 'boss_word',
    color: '#c9971f', ground: '#f2ead2', accent: '#9a6f0c',
    intro: '最初の語が、そこから生まれている。',
    waves: [
      { at: 0,  list: [['rhymer', 20], ['inkfiend', 18], ['brush', 40]] },
      { at: 18, list: [['golem', 10], ['wraith', 26]] },
      { at: 36, list: [['rhymer', 28], ['ghost', 30], ['shooter', 20]] },
      { at: 58, list: [['golem', 14], ['inkfiend', 24], ['rhymer', 30]] },
      { at: 80, list: [['ghost', 40], ['brush', 70], ['rhymer', 40], ['shooter', 26]] },
    ],
    reward: 6,
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
