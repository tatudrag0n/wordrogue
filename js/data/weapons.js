// ============================================================================
// ワードローグ — 武器定義
//
// 武器そのものは弱く、文で強化する前提。
// 枠に並べる語だけで文になる。
//   例 枠に「刃」「利」-> 「刃利剣」  成立 (花火的斬撃)
//
// 末尾の語 (tail) は武器ごとに決まっていて、枠の外に自動で付く。
// 語を並べ替えても末尾は動かないので、名前と攻撃の型が必ず一致する。
//   例 「爆裂」「無双」「迅」+ 剣 -> 「爆裂無双迅剣」  斬撃
//
// tail は辞書に載っている必要がある (文として分割できること)。
// 攻撃の種類は tail だけが決める。途中の形態語は効果だけ足す。
//
// level を上げるほど基礎値が伸び、2 / 4 / 6 で語スロットが 1 つ増える。
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
    id: 'sword', name: '剣', kind: 'slash', glyph: '剣', tail: '剣',
    desc: '扇形を薙ぎ払う。近接の基本。',
    base: { dmg: 9, rate: 1.5, range: 92, arc: 1.9, size: 1, crit: 0.05 },
    grow: { dmg: 3.2, rate: 0.1, range: 4, arc: 0.05 },
    startWord: '刃', startWord2: '利', maxLevel: 8, startSlots: 4, unlock: null,
  },
  gun: {
    id: 'gun', name: '銃', kind: 'shot', glyph: '銃', tail: '銃',
    desc: '最も近い敵へ自動で撃つ。',
    base: { dmg: 6, rate: 2.0, speed: 330, count: 1, size: 1, crit: 0.05, spread: 0 },
    grow: { dmg: 2.1, rate: 0.22, speed: 12, count: 0.34 },
    startWord: '弾', startWord2: '速', maxLevel: 8, startSlots: 4, unlock: null,
  },
  arrow: {
    id: 'arrow', name: '弓', kind: 'shot', glyph: '弓', tail: '弓',
    desc: '貫通して飛ぶ。素直に強い。',
    base: { dmg: 8, rate: 1.1, speed: 420, pierce: 2, size: 1, crit: 0.08, homing: 0 },
    grow: { dmg: 2.8, rate: 0.1, pierce: 0.34, speed: 10 },
    startWord: '矢', startWord2: '貫', maxLevel: 8, startSlots: 4, unlock: { stage: 1 },
  },
  bomb: {
    id: 'bomb', name: '爆弾', kind: 'bomb', glyph: '爆', tail: '爆弾',
    desc: '投げて爆発させる。範囲と炎上。',
    base: { dmg: 14, rate: 0.55, speed: 210, explode: 30, area: 26, size: 1.1, count: 1, knock: 50 },
    grow: { dmg: 4.6, rate: 0.06, explode: 8, area: 5 },
    startWord: '炎', startWord2: '烈', maxLevel: 8, startSlots: 4, unlock: { stage: 1 },
  },
  orbit: {
    id: 'orbit', name: '回転刃', kind: 'orbit', glyph: '環', tail: '環',
    desc: 'アドレスのまわりに回る刃。',
    base: { dmg: 7, orbit: 2, size: 1, crit: 0.04, rate: 0.5 },
    grow: { dmg: 2.4, orbit: 0.34, size: 0.05 },
    startWord: '鋼', startWord2: '迅', maxLevel: 8, startSlots: 4, unlock: { stage: 2 },
  },
  thunder: {
    id: 'thunder', name: '雷', kind: 'chain', glyph: '雷', tail: '雷',
    desc: '敵から敵へ連鎖する稲光。',
    base: { dmg: 11, rate: 1.1, chain: 3, shock: 0.10, size: 1, crit: 0.05 },
    grow: { dmg: 3.6, chain: 0.34, rate: 0.1 },
    startWord: '電', startWord2: '連鎖', maxLevel: 8, startSlots: 4, unlock: { stage: 2 },
  },
  whip: {
    id: 'whip', name: '鞭', kind: 'whip', glyph: '鞭', tail: '鞭',
    desc: '周囲を薙ぐ。近接の範囲攻撃。',
    base: { dmg: 10, rate: 1.25, range: 130, area: 10, size: 1, knock: 60, crit: 0.05 },
    grow: { dmg: 3.4, rate: 0.1, range: 7, area: 2 },
    startWord: '嵐', startWord2: '強', maxLevel: 8, startSlots: 4, unlock: { stage: 3 },
  },
  aura: {
    id: 'aura', name: '棘壁', kind: 'aura', glyph: '壁', tail: '壁',
    desc: '体温を纏った腐蚀の城壁。触れると傷つく。',
    base: { dmg: 4, rate: 1.0, range: 92, size: 1, slowImmune: 0, regen: 0 },
    grow: { dmg: 1.6, range: 7, rate: 0.1 },
    startWord: '毒', startWord2: '堅', maxLevel: 8, startSlots: 4, unlock: { stage: 3 },
  },
  boomerang: {
    id: 'boomerang', name: '環刃', kind: 'boomerang', glyph: '還', tail: '環刃',
    desc: '飛んで戻ってくる刃。貫通する。',
    base: { dmg: 10, rate: 0.9, speed: 300, pierce: 4, bounce: 2, size: 1, crit: 0.06 },
    grow: { dmg: 3.4, rate: 0.1, pierce: 0.34, bounce: 0.3 },
    startWord: '迅', startWord2: '貫', maxLevel: 8, startSlots: 4, unlock: { stage: 4 },
  },
  beam: {
    id: 'beam', name: '光線', kind: 'beam', glyph: '光', tail: '光線',
    desc: '一直線を貫く光。装甲も切り裂く。',
    base: { dmg: 16, rate: 0.7, range: 460, pierce: 99, size: 1, crit: 0.1, speed: 900 },
    grow: { dmg: 5.2, rate: 0.08, range: 20 },
    startWord: '閃', startWord2: '電', maxLevel: 8, startSlots: 4, unlock: { stage: 5 },
  },
};

export const WEAPON_IDS = Object.keys(WEAPONS);

/** 攻撃の種類の日本語名。UI は必ずこれを使う (raw な kind を出さない)。 */
export const KIND_LABEL = {
  slash: '斬撃', shot: '射撃', bomb: '爆弾', chain: '連鎖',
  orbit: '軌道', whip: '薙ぎ', aura: '城壁', beam: '光線',
  boomerang: '還刃', none: '',
};

/** 武器の現在のスロット数を求める。Lv2 / Lv4 / Lv6 で 1 つずつ増える。 */
export function slotsForLevel(def, level) {
  return def.startSlots + (level >= 2 ? 1 : 0) + (level >= 4 ? 1 : 0) + (level >= 6 ? 1 : 0);
}

/** 武器レベルに応じた基礎値を計算する。末尾語 (tail) の効果は文の側で加わる。 */
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
