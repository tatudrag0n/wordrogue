// ============================================================================
// ワードローグ — 武器定義
//
// 武器そのものは弱く、文で強化する前提。
// 核語 (core) が 1 つ最初から埋め込まれ、実質語がもう 1 つ以上並ぶと発動する。
//   例 剣 + 「炎」        -> 「剣炎」  成立 (花火的斬撃)
//       剣 + 「火」「の」  -> 「剣火」  1 実質語 -> 不成立
//
// level を上げるほど基礎値が伸び、3 と 6 で語スロットが 1 つ増える。
// ============================================================================

/**
 * kind の種類と挙動:
 *   slash     前方扇形を薙ぎ払う。近接。
 *   shot      最も近い敵へ向けて弾を撃つ。
 *   pierce    貫通する直線弾。
 *   orbit     プレイヤー周囲を周回し続ける刃。
 *   bomb      進行方向へ投げて着弾点で爆発。
 *   chain     最寄りの敵へ連鎖する稲光。
 *   boomerang 出てから戻ってくる刃。
 *   whip      プレイヤー周囲を薙ぐ。
 *   aura      プレイヤー周圍の毒のフィールド。触れた敵に継続ダメージ。
 *   beam      一直線の貫通光。
 */
export const WEAPONS = {
  sword: {
    id: 'sword', name: '剣', kind: 'slash', glyph: '剣',
    desc: '扇形を薙ぎ払う。近接の基本。',
    base: { dmg: 9, rate: 1.5, range: 92, arc: 1.9, size: 1, crit: 0.05 },
    grow: { dmg: 3.2, rate: 0.1, range: 4, arc: 0.05 },
    core: '力', startWord: '刃', maxLevel: 8, startSlots: 2, unlock: null,
  },
  gun: {
    id: 'gun', name: '銃', kind: 'shot', glyph: '銃',
    desc: '最も近い敵へ自動で撃つ。',
    base: { dmg: 6, rate: 2.0, speed: 330, count: 1, size: 1, crit: 0.05, spread: 0 },
    grow: { dmg: 2.1, rate: 0.22, speed: 12, count: 0.34 },
    core: '心', startWord: '弾', maxLevel: 8, startSlots: 2, unlock: null,
  },
  arrow: {
    id: 'arrow', name: '矢', kind: 'shot', glyph: '矢',
    desc: '貫通して飛ぶ。素直に強い。',
    base: { dmg: 8, rate: 1.1, speed: 420, pierce: 2, size: 1, crit: 0.08, homing: 0 },
    grow: { dmg: 2.8, rate: 0.1, pierce: 0.34, speed: 10 },
    core: '感', startWord: '矢', maxLevel: 8, startSlots: 2, unlock: { stage: 1 },
  },
  bomb: {
    id: 'bomb', name: '爆弾', kind: 'bomb', glyph: '爆',
    desc: '投げて爆発させる。範囲と炎上。',
    base: { dmg: 14, rate: 0.55, speed: 210, explode: 30, area: 26, size: 1.1, count: 1, knock: 50 },
    grow: { dmg: 4.6, rate: 0.06, explode: 8, area: 5 },
    core: '力', startWord: '爆', maxLevel: 8, startSlots: 2, unlock: { stage: 1 },
  },
  orbit: {
    id: 'orbit', name: '回転刃', kind: 'orbit', glyph: '環',
    desc: 'アドレスのまわりに回る刃。',
    base: { dmg: 7, orbit: 2, size: 1, crit: 0.04, rate: 0.5 },
    grow: { dmg: 2.4, orbit: 0.34, size: 0.05 },
    core: '縛', startWord: '刃', maxLevel: 8, startSlots: 2, unlock: { stage: 2 },
  },
  thunder: {
    id: 'thunder', name: '雷', kind: 'chain', glyph: '雷',
    desc: '敵から敵へ連鎖する稲光。',
    base: { dmg: 11, rate: 1.1, chain: 3, shock: 0.10, size: 1, crit: 0.05 },
    grow: { dmg: 3.6, chain: 0.34, rate: 0.1 },
    core: '技', startWord: '電', maxLevel: 8, startSlots: 2, unlock: { stage: 2 },
  },
  whip: {
    id: 'whip', name: '鞭', kind: 'whip', glyph: '鞭',
    desc: '周囲を薙ぐ。近接の範囲攻撃。',
    base: { dmg: 10, rate: 1.25, range: 130, area: 10, size: 1, knock: 60, crit: 0.05 },
    grow: { dmg: 3.4, rate: 0.1, range: 7, area: 2 },
    core: '心', startWord: '鞭', maxLevel: 8, startSlots: 2, unlock: { stage: 3 },
  },
  aura: {
    id: 'aura', name: '棘壁', kind: 'aura', glyph: '壁',
    desc: '体温を纏った腐蚀の城壁。触れると傷つく。',
    base: { dmg: 4, rate: 1.0, range: 92, size: 1, slowImmune: 0, regen: 0 },
    grow: { dmg: 1.6, range: 7, rate: 0.1 },
    core: '守', startWord: '棘', maxLevel: 8, startSlots: 2, unlock: { stage: 3 },
  },
  boomerang: {
    id: 'boomerang', name: '環刃', kind: 'boomerang', glyph: '還',
    desc: '飛んで戻ってくる刃。貫通する。',
    base: { dmg: 10, rate: 0.9, speed: 300, pierce: 4, bounce: 2, size: 1, crit: 0.06 },
    grow: { dmg: 3.4, rate: 0.1, pierce: 0.34, bounce: 0.3 },
    core: '感', startWord: '刃', maxLevel: 8, startSlots: 2, unlock: { stage: 4 },
  },
  beam: {
    id: 'beam', name: '光線', kind: 'beam', glyph: '光',
    desc: '一直線を貫く光。装甲も切り裂く。',
    base: { dmg: 16, rate: 0.7, range: 460, pierce: 99, size: 1, crit: 0.1, speed: 900 },
    grow: { dmg: 5.2, rate: 0.08, range: 20 },
    core: '技', startWord: '光線', maxLevel: 8, startSlots: 2, unlock: { stage: 5 },
  },
};

export const WEAPON_IDS = Object.keys(WEAPONS);

/** 武器の現在のスロット数を求める。Lv3 と Lv6 で 1 つずつ増える。 */
export function slotsForLevel(def, level) {
  return def.startSlots + (level >= 3 ? 1 : 0) + (level >= 6 ? 1 : 0);
}

/** 武器レベルに応じた基礎値を、核語込みで計算する。 */
export function baseStatsForLevel(def, level) {
  const out = {};
  for (const [k, v] of Object.entries(def.base)) out[k] = v;
  const steps = Math.max(0, level - 1);
  if (def.grow) {
    for (const [k, v] of Object.entries(def.grow)) {
      out[k] = (out[k] || 0) + v * steps;
    }
  }
  return out;
}

/** あるステージで解放される武器。 */
export function weaponsUnlockedAt(stageId) {
  return WEAPON_IDS.filter((id) => {
    const u = WEAPONS[id].unlock;
    return u && u.stage <= stageId;
  });
}

/** ステージ開始時点で選択できる武器。 */
export function startingWeaponsFor(stageId) {
  return WEAPON_IDS.filter((id) => {
    const u = WEAPONS[id].unlock;
    return !u || u.stage <= stageId;
  });
}
