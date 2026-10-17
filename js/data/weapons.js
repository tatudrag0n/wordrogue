// ============================================================================
// ワードローグ — 武器定義
//
// 武器は「基本の 15 武器語」に対応する 15 種だけ。
//   剣 刃 刀 斧 槍 矛 牙 爪 拳 鞭 鎖 杖 銃 弓 針
// 武器そのものは弱く、文で強化する前提。
// 枠に並べる語だけで文になる。
//   例 枠に「火」「必殺」-> 「火必殺剣」  成立 (炎の斬撃)
//
// 末尾の語 (tail) は武器ごとに決まっていて、枠の外に自動で付く。
// 語を並べ替えても末尾は動かないので、名前と攻撃の型が必ず一致する。
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
 *   boomerang 出てから戻ってくる刃。
 *   whip      プレイヤー周囲を薙ぐ。
 *   beam      一直線の貫通光。
 */
export const WEAPONS = {
  sword: {
    id: 'sword', name: '剣', kind: 'slash', glyph: '剣', tail: '剣',
    desc: '扇形を薙ぎ払う。近接の基本。',
    base: { dmg: 9, rate: 1.5, range: 92, arc: 1.9, size: 1, crit: 0.05 },
    grow: { dmg: 3.2, rate: 0.1, range: 4, arc: 0.05 },
    startWord: '刃', startWord2: '必殺', maxLevel: 8, startSlots: 4,
  },
  blade: {
    id: 'blade', name: '刃', kind: 'slash', glyph: '刃', tail: '刃',
    desc: '速く振れる小刃。手数で押す。',
    base: { dmg: 6, rate: 2.1, range: 82, arc: 1.5, size: 0.95, crit: 0.06 },
    grow: { dmg: 2.0, rate: 0.16, range: 4 },
    startWord: '鋼', startWord2: '剛利', maxLevel: 8, startSlots: 4,
  },
  katana: {
    id: 'katana', name: '刀', kind: 'slash', glyph: '刀', tail: '刀',
    desc: 'しなやかに冴える。会心が出やすい。',
    base: { dmg: 8, rate: 1.7, range: 104, arc: 2.0, size: 1, crit: 0.09 },
    grow: { dmg: 2.8, rate: 0.12, range: 4 },
    startWord: '鋭利', startWord2: '会心', maxLevel: 8, startSlots: 4,
  },
  axe: {
    id: 'axe', name: '斧', kind: 'whip', glyph: '斧', tail: '斧',
    desc: '重い一撃。広く薙ぎ、敵を吹き飛ばす。',
    base: { dmg: 15, rate: 0.72, range: 142, area: 14, size: 1.15, knock: 95, crit: 0.06 },
    grow: { dmg: 4.8, rate: 0.05, range: 7, area: 2 },
    startWord: '撃退', startWord2: '重', maxLevel: 8, startSlots: 4,
  },
  spear: {
    id: 'spear', name: '槍', kind: 'slash', glyph: '槍', tail: '槍',
    desc: '長い間合いの突き。串刺しにする。',
    base: { dmg: 11, rate: 1.05, range: 152, arc: 0.8, size: 1, crit: 0.06 },
    grow: { dmg: 3.6, rate: 0.09, range: 6 },
    startWord: '貫徹', startWord2: '遠', maxLevel: 8, startSlots: 4,
  },
  halberd: {
    id: 'halberd', name: '矛', kind: 'slash', glyph: '矛', tail: '矛',
    desc: '大きく振る。扇が広く、複数を薙ぐ。',
    base: { dmg: 12, rate: 1.15, range: 126, arc: 2.3, size: 1.05, crit: 0.05 },
    grow: { dmg: 3.8, rate: 0.09, range: 5, arc: 0.06 },
    startWord: '強力', startWord2: '長', maxLevel: 8, startSlots: 4,
  },
  fang: {
    id: 'fang', name: '牙', kind: 'slash', glyph: '牙', tail: '牙',
    desc: '鋭い噛みつき。速く、会心が出やすい。',
    base: { dmg: 8, rate: 2.7, range: 72, arc: 1.25, size: 0.9, crit: 0.09 },
    grow: { dmg: 2.6, rate: 0.18, range: 3 },
    startWord: '血', startWord2: '瞬殺', maxLevel: 8, startSlots: 4,
  },
  claw: {
    id: 'claw', name: '爪', kind: 'whip', glyph: '爪', tail: '爪',
    desc: '短く速い。近くを連続で薙ぐ。',
    base: { dmg: 7, rate: 2.6, range: 100, area: 6, size: 0.9, crit: 0.08, knock: 20 },
    grow: { dmg: 2.3, rate: 0.16, range: 4 },
    startWord: '血', startWord2: '紅蓮', maxLevel: 8, startSlots: 4,
  },
  fist: {
    id: 'fist', name: '拳', kind: 'slash', glyph: '拳', tail: '拳',
    desc: '至近距離を打つ。隙が少ない。',
    base: { dmg: 6, rate: 3.2, range: 66, arc: 1.1, size: 0.85, crit: 0.06 },
    grow: { dmg: 2.0, rate: 0.2, range: 3 },
    startWord: '殴る', startWord2: '速', maxLevel: 8, startSlots: 4,
  },
  whip: {
    id: 'whip', name: '鞭', kind: 'whip', glyph: '鞭', tail: '鞭',
    desc: '周囲を薙ぐ。近接の範囲攻撃。',
    base: { dmg: 10, rate: 1.25, range: 130, area: 10, size: 1, knock: 60, crit: 0.05 },
    grow: { dmg: 3.4, rate: 0.1, range: 7, area: 2 },
    startWord: '嵐', startWord2: '強力', maxLevel: 8, startSlots: 4,
  },
  chain: {
    id: 'chain', name: '鎖', kind: 'boomerang', glyph: '鎖', tail: '鎖',
    desc: '投げて手元に戻る。貫通し、よく跳ねる。',
    base: { dmg: 10, rate: 0.9, speed: 300, pierce: 4, bounce: 2, size: 1, crit: 0.06 },
    grow: { dmg: 3.4, rate: 0.1, pierce: 0.34, bounce: 0.3 },
    startWord: '回帰', startWord2: '貫徹', maxLevel: 8, startSlots: 4,
  },
  staff: {
    id: 'staff', name: '杖', kind: 'beam', glyph: '杖', tail: '杖',
    desc: '一直線を貫く光を放つ。装甲も切り裂く。',
    base: { dmg: 16, rate: 0.7, range: 460, pierce: 99, size: 1, crit: 0.1, speed: 900 },
    grow: { dmg: 5.2, rate: 0.08, range: 20 },
    startWord: '閃', startWord2: '電', maxLevel: 8, startSlots: 4,
  },
  gun: {
    id: 'gun', name: '銃', kind: 'shot', glyph: '銃', tail: '銃',
    desc: '最も近い敵へ自動で撃つ。',
    base: { dmg: 6, rate: 2.0, speed: 330, count: 1, size: 1, crit: 0.05, spread: 0 },
    grow: { dmg: 2.1, rate: 0.22, speed: 12, count: 0.34 },
    startWord: '弾', startWord2: '速', maxLevel: 8, startSlots: 4,
  },
  bow: {
    id: 'bow', name: '弓', kind: 'shot', glyph: '弓', tail: '弓',
    desc: '貫通して飛ぶ。素直に強い。',
    base: { dmg: 8, rate: 1.1, speed: 420, pierce: 2, size: 1, crit: 0.08, homing: 0 },
    grow: { dmg: 2.8, rate: 0.1, pierce: 0.34, speed: 10 },
    startWord: '矢', startWord2: '貫徹', maxLevel: 8, startSlots: 4,
  },
  needle: {
    id: 'needle', name: '針', kind: 'shot', glyph: '針', tail: '針',
    desc: '細くて速い。連射で削り、貫通する。',
    base: { dmg: 4, rate: 4.0, speed: 540, count: 2, pierce: 1, size: 0.7, crit: 0.06, spread: 0.05 },
    grow: { dmg: 1.3, rate: 0.28, count: 0.2, pierce: 0.2 },
    startWord: '毒', startWord2: '腐蝕', maxLevel: 8, startSlots: 4,
  },
};

export const WEAPON_IDS = Object.keys(WEAPONS);

/** 攻撃の種類の日本語名。UI は必ずこれを使う (raw な kind を出さない)。 */
export const KIND_LABEL = {
  slash: '斬撃', shot: '射撃', whip: '薙ぎ', beam: '光線',
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

/** 開始時に選択できる武器。基本の 15 種はいつでも全部使える。 */
export function startingWeaponsFor() {
  return WEAPON_IDS.slice();
}
