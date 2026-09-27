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
    startWord: '刃', startWord2: '必殺', maxLevel: 8, startSlots: 4, unlock: null,
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
    startWord: '矢', startWord2: '貫徹', maxLevel: 8, startSlots: 4, unlock: { stage: 1 },
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
    startWord: '鋼', startWord2: '迅足', maxLevel: 8, startSlots: 4, unlock: { stage: 2 },
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
    startWord: '嵐', startWord2: '強力', maxLevel: 8, startSlots: 4, unlock: { stage: 3 },
  },
  aura: {
    id: 'aura', name: '棘壁', kind: 'aura', glyph: '壁', tail: '壁',
    desc: '体温を纏った腐蚀の城壁。触れると傷つく。',
    base: { dmg: 4, rate: 1.0, range: 92, size: 1, slowImmune: 0, regen: 0 },
    grow: { dmg: 1.6, range: 7, rate: 0.1 },
    startWord: '毒', startWord2: '堅守', maxLevel: 8, startSlots: 4, unlock: { stage: 3 },
  },
  boomerang: {
    id: 'boomerang', name: '環刃', kind: 'boomerang', glyph: '還', tail: '環刃',
    desc: '飛んで戻ってくる刃。貫通する。',
    base: { dmg: 10, rate: 0.9, speed: 300, pierce: 4, bounce: 2, size: 1, crit: 0.06 },
    grow: { dmg: 3.4, rate: 0.1, pierce: 0.34, bounce: 0.3 },
    startWord: '刃', startWord2: '貫徹', maxLevel: 8, startSlots: 4, unlock: { stage: 4 },
  },
  beam: {
    id: 'beam', name: '光線', kind: 'beam', glyph: '光', tail: '光線',
    desc: '一直線を貫く光。装甲も切り裂く。',
    base: { dmg: 16, rate: 0.7, range: 460, pierce: 99, size: 1, crit: 0.1, speed: 900 },
    grow: { dmg: 5.2, rate: 0.08, range: 20 },
    startWord: '閃', startWord2: '電', maxLevel: 8, startSlots: 4, unlock: { stage: 5 },
  },
  // ── 追加分。末尾語が違えば攻撃も形も違になる。──
  tachi: {
    id: 'tachi', name: '太刀', kind: 'slash', glyph: '太', tail: '太刀',
    desc: '大きく振る。扇が広く、一振りで複数を薙ぐ。',
    base: { dmg: 15, rate: 0.75, range: 112, arc: 2.9, size: 1.15, crit: 0.06 },
    grow: { dmg: 4.6, rate: 0.06, range: 5, arc: 0.08 },
    startWord: '炎', startWord2: '灼熱', maxLevel: 8, startSlots: 4, unlock: { stage: 3 },
  },
  needle: {
    id: 'needle', name: '針', kind: 'shot', glyph: '針', tail: '針',
    desc: '細くて速い。連射で削り、貫通する。',
    base: { dmg: 4, rate: 4.0, speed: 540, count: 2, pierce: 1, size: 0.7, crit: 0.06, spread: 0.05 },
    grow: { dmg: 1.3, rate: 0.28, count: 0.2, pierce: 0.2 },
    startWord: '毒', startWord2: '腐蝕', maxLevel: 8, startSlots: 4, unlock: { stage: 3 },
  },
  boulder: {
    id: 'boulder', name: '岩塊', kind: 'bomb', glyph: '岩', tail: '岩塊',
    desc: '重い。ゆっくり飛んで、敵を吹き飛ばす。',
    base: { dmg: 20, rate: 0.42, speed: 150, explode: 34, area: 34, size: 1.4, count: 1, knock: 80 },
    grow: { dmg: 6.2, rate: 0.04, explode: 9, area: 6 },
    startWord: '厚土', startWord2: '巨岩', maxLevel: 8, startSlots: 4, unlock: { stage: 4 },
  },
  claw: {
    id: 'claw', name: '利爪', kind: 'whip', glyph: '爪', tail: '利爪',
    desc: '短く速い。近くを連続で薙ぐ。',
    base: { dmg: 7, rate: 2.6, range: 100, area: 6, size: 0.9, crit: 0.08, knock: 20 },
    grow: { dmg: 2.3, rate: 0.16, range: 4 },
    startWord: '血', startWord2: '紅蓮', maxLevel: 8, startSlots: 4, unlock: { stage: 5 },
  },
  dragon: {
    id: 'dragon', name: '竜頭', kind: 'shot', glyph: '竜', tail: '竜頭',
    desc: '長い。遠くを串刺しにする。',
    base: { dmg: 13, rate: 0.85, speed: 460, pierce: 5, size: 1.2, crit: 0.12 },
    grow: { dmg: 4.0, rate: 0.07, pierce: 0.5, speed: 14 },
    startWord: '業火', startWord2: '爆裂', maxLevel: 8, startSlots: 4, unlock: { stage: 6 },
  },
  clone: {
    id: 'clone', name: '複製', kind: 'shot', glyph: '複', tail: '複製',
    desc: '命中した弾が分裂する。',
    base: { dmg: 8, rate: 1.0, speed: 300, count: 2, split: 2, size: 1, crit: 0.05, spread: 0.2 },
    grow: { dmg: 2.7, rate: 0.1, split: 0.3, count: 0.25 },
    startWord: '追影', startWord2: '分裂', maxLevel: 8, startSlots: 4, unlock: { stage: 6 },
  },
  greatblade: {
    id: 'greatblade', name: '大剣', kind: 'whip', glyph: '大', tail: '大剣',
    desc: '重い一振り。遠くまで薙ぎ、敵を吹き飛ばす。',
    base: { dmg: 18, rate: 0.6, range: 168, area: 18, size: 1.2, knock: 110, crit: 0.06 },
    grow: { dmg: 5.6, rate: 0.05, range: 9, area: 2 },
    startWord: '鋼', startWord2: '剛硬', maxLevel: 8, startSlots: 4, unlock: { stage: 7 },
  },
  flank: {
    id: 'flank', name: '夾撃', kind: 'shot', glyph: '夾', tail: '夾撃',
    desc: '左右から同時に撃つ。',
    base: { dmg: 9, rate: 1.3, speed: 340, count: 2, spread: 0.9, size: 1, crit: 0.05 },
    grow: { dmg: 3.0, rate: 0.1, count: 0.24, spread: 0.04 },
    startWord: '風', startWord2: '旋風', maxLevel: 8, startSlots: 4, unlock: { stage: 8 },
  },
  flurry: {
    id: 'flurry', name: '乱打', kind: 'shot', glyph: '乱', tail: '乱打',
    desc: '散らばった弾を連射する。数で押す。',
    base: { dmg: 6, rate: 2.4, speed: 380, count: 3, spread: 0.7, size: 0.9, crit: 0.04 },
    grow: { dmg: 2.0, rate: 0.2, count: 0.28 },
    startWord: '迅早', startWord2: '多重', maxLevel: 8, startSlots: 4, unlock: { stage: 9 },
  },
};

export const WEAPON_IDS = Object.keys(WEAPONS);

/** 攻撃の種類の日本語名。UI は必ずこれを使う (raw な kind を出さない)。 */
export const KIND_LABEL = {
  slash: '斬撃', shot: '射撃', bomb: '爆弾', chain: '連鎖',
  orbit: '軌道', whip: '薙ぎ', aura: '城壁', beam: '光線',
  boomerang: '還刃', pierce: '貫通', none: '',
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
