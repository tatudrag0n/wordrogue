// ============================================================================
// ワードローグ — ステージ定義
//
// 1 ステージ = 制限時間まで生き延びてボス香蕉。
// 経過時間に合わせて出現テーブルを順に配備する。
// クリア報酬は報酬画面で選ぶ。
//
// **ステージは箱庭型。** 敵が湧き続ける開いたフィールドではなく、
// 塀に囲まれた小さな庭 (箱庭) の中で戦う。
//   arena … 庭の広さ。中心が原点で、x = ±w/2, y = ±h/2 が壁。
//           プレイヤー・敵・弾はこの外に出られない。
//   garden … 庭の意匠 (畝・花・木・池・石・垣・砂・灯籠・骨・石畳)。
//           床に描く景色で、当たり判定は持たない。
// 庭が画面より小さければ、闇の中に箱庭全体が見えて囲い込まれたことが
// 一目でわかる。大きければ壁まで歩いて壁の内側で戦う。
// ============================================================================

/**
 * waves は 10 秒刻み。各要素は { at: 開始秒, list: [[敵ID, 個体数], ...] }
 * 一度に出すと出切ったぶんは次のウェーブに回す。
 *
 * midBoss / midBossAt … 各章の中ボスと出現時刻 (秒)。
 *   中ボスはボスとは別枠。倒すと宝箱 (ランダムな言葉 2 個) を落とす。
 */
export const STAGES = [
  {
    id: 1, name: '村の外れ', time: 60, boss: null,
    midBoss: 'mid_boar', midBossAt: 30,
    color: '#6f8a52', ground: '#dfe7cb', accent: '#3f6b3a',
    intro: '夜が明ける前に村を出る。',
    arena: { w: 1600, h: 1100 },
    garden: ['rows', 'flower'],
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
    midBoss: 'mid_treant', midBossAt: 35,
    color: '#4e7a46', ground: '#d8e3c6', accent: '#2f5c34',
    intro: '樹が蠢える。何かが居る。',
    arena: { w: 1700, h: 1150 },
    garden: ['grove'],
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
    midBoss: 'mid_grave', midBossAt: 40,
    color: '#a3814f', ground: '#e9dcc0', accent: '#7d5a2a',
    intro: '民が去った村。灯りがまだ点いている。',
    arena: { w: 1750, h: 1200 },
    garden: ['rock', 'rows'],
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
    midBoss: 'mid_knight', midBossAt: 42,
    color: '#767c95', ground: '#dfe0e6', accent: '#4c5169',
    intro: '石棺の隙間から冷気。',
    arena: { w: 1700, h: 1300 },
    garden: ['bones', 'rock'],
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
    midBoss: 'mid_wraith', midBossAt: 45,
    color: '#a97a4e', ground: '#e9dccb', accent: '#8a4f28',
    intro: '城壁の向こうで、魔王が待っている。',
    arena: { w: 1900, h: 1250 },
    garden: ['hedge', 'lantern'],
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
    midBoss: 'mid_demon', midBossAt: 50,
    color: '#6c5cae', ground: '#dddff0', accent: '#4b3d86',
    intro: 'すべてが終わる場所。',
    arena: { w: 1800, h: 1300 },
    garden: ['tiles', 'bones'],
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
    midBoss: 'mid_scribe', midBossAt: 52,
    color: '#a5813f', ground: '#eee6cf', accent: '#7a5a1e',
    intro: '使われなかったことばが積まれている。',
    arena: { w: 1900, h: 1250 },
    garden: ['gravel', 'lantern'],
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
    midBoss: 'mid_rhyme', midBossAt: 55,
    color: '#4f86a8', ground: '#dce8ef', accent: '#2c6280',
    intro: '上へ上へ。同じ音が何千も重なっている。',
    arena: { w: 1600, h: 1500 },
    garden: ['hedge', 'gravel'],
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
    midBoss: 'mid_origin', midBossAt: 60,
    color: '#c9971f', ground: '#f2ead2', accent: '#9a6f0c',
    intro: '最初の語が、そこから生まれている。',
    arena: { w: 2000, h: 1400 },
    garden: ['pond', 'grove'],
    waves: [
      { at: 0,  list: [['rhymer', 20], ['inkfiend', 18], ['brush', 40]] },
      { at: 18, list: [['golem', 10], ['wraith', 26]] },
      { at: 36, list: [['rhymer', 28], ['ghost', 30], ['shooter', 20]] },
      { at: 58, list: [['golem', 14], ['inkfiend', 24], ['rhymer', 30]] },
      { at: 80, list: [['ghost', 40], ['brush', 70], ['rhymer', 40], ['shooter', 26]] },
    ],
    reward: 6,
  },
  // ── 第二の庭。根源を越えた先に、囲われた庭が続いている ────────────────
  {
    id: 10, name: '苔庭', time: 125, boss: 'boss_scribe',
    midBoss: 'mid_moss', midBossAt: 60,
    color: '#5d7f4e', ground: '#dfe8cc', accent: '#3d5f34',
    intro: '苔が石を飲み込んでいる。',
    arena: { w: 1700, h: 1200 },
    garden: ['grove', 'rock'],
    waves: [
      { at: 0,  list: [['golem', 6], ['wraith', 20]] },
      { at: 20, list: [['inkfiend', 16], ['rhymer', 14]] },
      { at: 40, list: [['brush', 50], ['shooter', 18], ['brute', 12]] },
      { at: 62, list: [['rhymer', 24], ['golem', 10], ['ghost', 30]] },
      { at: 84, list: [['inkfiend', 30], ['wraith', 30], ['brush', 60]] },
      { at: 104, list: [['golem', 16], ['rhymer', 32], ['brute', 20]] },
    ],
    reward: 6,
  },
  {
    id: 11, name: '竹林の間', time: 130, boss: 'boss_dragon',
    midBoss: 'mid_bamboo', midBossAt: 62,
    color: '#6d8f5a', ground: '#e3ead2', accent: '#46663b',
    intro: '竹は一本では立たない。',
    arena: { w: 1650, h: 1450 },
    garden: ['bamboo'],
    waves: [
      { at: 0,  list: [['wraith', 24], ['rhymer', 16]] },
      { at: 20, list: [['brush', 60], ['inkfiend', 20]] },
      { at: 42, list: [['golem', 12], ['shooter', 24], ['brute', 16]] },
      { at: 64, list: [['rhymer', 30], ['ghost', 34], ['wraith', 30]] },
      { at: 86, list: [['inkfiend', 34], ['brush', 80], ['shooter', 28]] },
      { at: 108, list: [['golem', 20], ['rhymer', 40], ['brute', 26]] },
    ],
    reward: 7,
  },
  {
    id: 12, name: '水鏡の池', time: 135, boss: 'boss_lich',
    midBoss: 'mid_mirror', midBossAt: 65,
    color: '#4a7f97', ground: '#dbe7ea', accent: '#2d5f77',
    intro: '水面が天を映している。動くと壊れる。',
    arena: { w: 2000, h: 1300 },
    garden: ['pond', 'rock'],
    waves: [
      { at: 0,  list: [['rhymer', 22], ['inkfiend', 22], ['brush', 50]] },
      { at: 20, list: [['golem', 14], ['wraith', 34]] },
      { at: 44, list: [['rhymer', 34], ['ghost', 36], ['shooter', 26]] },
      { at: 66, list: [['inkfiend', 38], ['brute', 22], ['brush', 90]] },
      { at: 88, list: [['golem', 22], ['rhymer', 44], ['wraith', 40]] },
      { at: 112, list: [['brush', 110], ['shooter', 34], ['ghost', 44]] },
    ],
    reward: 7,
  },
  {
    id: 13, name: '枯山水', time: 140, boss: 'boss_demon',
    midBoss: 'mid_dry', midBossAt: 68,
    color: '#9a9384', ground: '#eee9dd', accent: '#6d6555',
    intro: '水のない庭。波は砂の上にある。',
    arena: { w: 2100, h: 1300 },
    garden: ['gravel', 'rock'],
    waves: [
      { at: 0,  list: [['golem', 16], ['rhymer', 26], ['inkfiend', 26]] },
      { at: 22, list: [['brush', 80], ['shooter', 30]] },
      { at: 46, list: [['wraith', 40], ['brute', 26], ['ghost', 40]] },
      { at: 68, list: [['rhymer', 40], ['golem', 24], ['inkfiend', 42]] },
      { at: 92, list: [['brush', 120], ['shooter', 38], ['rhymer', 50]] },
      { at: 116, list: [['golem', 30], ['wraith', 50], ['brute', 34]] },
    ],
    reward: 8,
  },
  {
    id: 14, name: '灯籠の路', time: 145, boss: 'boss_scribe',
    midBoss: 'mid_lantern', midBossAt: 70,
    color: '#c08a3e', ground: '#eee2c8', accent: '#8a5c22',
    intro: '灯がひとつ、ひとつ点いている。',
    arena: { w: 1800, h: 1500 },
    garden: ['lantern', 'gravel'],
    waves: [
      { at: 0,  list: [['inkfiend', 30], ['rhymer', 30], ['brush', 70]] },
      { at: 22, list: [['golem', 20], ['shooter', 34]] },
      { at: 48, list: [['wraith', 46], ['ghost', 46], ['brute', 30]] },
      { at: 70, list: [['rhymer', 46], ['inkfiend', 48], ['golem', 26]] },
      { at: 94, list: [['brush', 130], ['shooter', 42], ['wraith', 54]] },
      { at: 120, list: [['rhymer', 58], ['golem', 34], ['brute', 40]] },
    ],
    reward: 8,
  },
  {
    id: 15, name: '霧の苑', time: 150, boss: 'boss_word',
    midBoss: 'mid_mist', midBossAt: 72,
    color: '#8b9bb0', ground: '#e6e9ee', accent: '#5d6b80',
    intro: '霧の向こうに、何かが立っている。',
    arena: { w: 2000, h: 1450 },
    garden: ['pond', 'flower'],
    waves: [
      { at: 0,  list: [['rhymer', 34], ['inkfiend', 34], ['brush', 90]] },
      { at: 24, list: [['golem', 24], ['wraith', 50]] },
      { at: 50, list: [['ghost', 50], ['brute', 34], ['shooter', 44]] },
      { at: 74, list: [['rhymer', 52], ['inkfiend', 54], ['golem', 30]] },
      { at: 98, list: [['brush', 150], ['wraith', 60], ['shooter', 48]] },
      { at: 126, list: [['golem', 40], ['rhymer', 66], ['brute', 46]] },
    ],
    reward: 9,
  },
  {
    id: 16, name: '花筏の野', time: 155, boss: 'boss_dragon',
    midBoss: 'mid_bloom', midBossAt: 75,
    color: '#c46b8f', ground: '#f2e0e4', accent: '#96456a',
    intro: '花びらが地面を埋めている。',
    arena: { w: 2200, h: 1400 },
    garden: ['flower', 'rows'],
    waves: [
      { at: 0,  list: [['inkfiend', 40], ['rhymer', 38], ['brush', 100]] },
      { at: 24, list: [['golem', 28], ['shooter', 48]] },
      { at: 52, list: [['wraith', 56], ['ghost', 56], ['brute', 38]] },
      { at: 76, list: [['rhymer', 58], ['inkfiend', 60], ['golem', 34]] },
      { at: 102, list: [['brush', 170], ['shooter', 54], ['wraith', 66]] },
      { at: 130, list: [['golem', 46], ['rhymer', 74], ['brute', 52]] },
    ],
    reward: 9,
  },
  {
    id: 17, name: '月見の壇', time: 160, boss: 'boss_lich',
    midBoss: 'mid_moon', midBossAt: 78,
    color: '#6f7bb5', ground: '#e2e4f0', accent: '#46519a',
    intro: '月は庭を一つずつ数える。',
    arena: { w: 1900, h: 1600 },
    garden: ['pond', 'lantern'],
    waves: [
      { at: 0,  list: [['rhymer', 42], ['inkfiend', 44], ['brush', 120]] },
      { at: 26, list: [['golem', 32], ['wraith', 62]] },
      { at: 54, list: [['ghost', 62], ['brute', 44], ['shooter', 56]] },
      { at: 80, list: [['rhymer', 64], ['inkfiend', 66], ['golem', 40]] },
      { at: 108, list: [['brush', 190], ['shooter', 60], ['wraith', 74]] },
      { at: 138, list: [['golem', 54], ['rhymer', 84], ['brute', 60]] },
    ],
    reward: 10,
  },
  {
    id: 18, name: '静寂の間', time: 165, boss: 'boss_demon',
    midBoss: 'mid_quiet', midBossAt: 80,
    color: '#7b7f86', ground: '#e7e6e3', accent: '#4e5157',
    intro: '言葉が出なくなった庭。',
    arena: { w: 2100, h: 1500 },
    garden: ['hedge', 'gravel'],
    waves: [
      { at: 0,  list: [['inkfiend', 48], ['rhymer', 48], ['brush', 140]] },
      { at: 26, list: [['golem', 36], ['shooter', 62]] },
      { at: 56, list: [['wraith', 70], ['ghost', 70], ['brute', 50]] },
      { at: 84, list: [['rhymer', 72], ['inkfiend', 74], ['golem', 46]] },
      { at: 112, list: [['brush', 210], ['shooter', 68], ['wraith', 82]] },
      { at: 142, list: [['golem', 60], ['rhymer', 94], ['brute', 68]] },
    ],
    reward: 10,
  },
  {
    id: 19, name: '言葉の庭', time: 170, boss: 'boss_word',
    midBoss: 'mid_garden', midBossAt: 85,
    color: '#d8b23c', ground: '#f4eeda', accent: '#a37a14',
    intro: '根源を越えると、そこには庭があった。',
    arena: { w: 2400, h: 1600 },
    garden: ['pond', 'grove', 'flower'],
    waves: [
      { at: 0,  list: [['rhymer', 54], ['inkfiend', 54], ['brush', 160]] },
      { at: 28, list: [['golem', 42], ['wraith', 78], ['shooter', 68]] },
      { at: 58, list: [['ghost', 78], ['brute', 58], ['rhymer', 80]] },
      { at: 86, list: [['inkfiend', 86], ['golem', 52], ['brush', 230]] },
      { at: 116, list: [['wraith', 94], ['shooter', 76], ['rhymer', 104]] },
      { at: 148, list: [['golem', 70], ['brute', 76], ['brush', 260], ['rhymer', 110]] },
    ],
    reward: 12,
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
