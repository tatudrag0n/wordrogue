// ============================================================================
// ワードローグ — 武器定義
//
// 武器そのものは弱く、文で強化する前提。
// 自由に並べた語が、そのまま武器名 (= 文面) になる。
//   例 「業火」「を」「斬」-> 「業火を斬」  成立
//
// 末尾語は自動で付かない。tail はこの武器の「初期の武器語」であって、
// 文の中に自分で置く（戦闘中のレベルアップで武器語を得ると増える）。
// 置いた武器語が攻撃を決める。置かなければこの武器の既定の型になる。
//   例 「業火」「を」「斬」「刃」-> 斬撃
//
// level を上げるほど基礎値が伸びる。文の長さは武器レベルとは無関係で 10 文字まで。
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
    id: 'sword', name: '刃', kind: 'slash', glyph: '刃', tail: '刃',
    desc: '扇形を薙ぎ払う。近接の基本。',
    base: { dmg: 9, rate: 1.9, range: 92, arc: 1.9, size: 1, crit: 0.05 },
    grow: { dmg: 3.2, rate: 0.1, range: 4, arc: 0.05 },
    startWord: '炎', startWord2: '必', maxLevel: 8, unlock: null,
  },
  gun: {
    id: 'gun', name: '銃', kind: 'shot', glyph: '銃', tail: '銃',
    desc: '最も近い敵へ自動で撃つ。',
    base: { dmg: 6, rate: 2.0, speed: 330, count: 1, size: 1, crit: 0.05, spread: 0 },
    grow: { dmg: 2.1, rate: 0.22, speed: 12, count: 0.34 },
    startWord: '電', startWord2: '速', maxLevel: 8, unlock: null,
  },
  arrow: {
    id: 'arrow', name: '弓', kind: 'shot', glyph: '弓', tail: '弓',
    desc: '貫通して飛ぶ。素直に強い。',
    base: { dmg: 8, rate: 1.1, speed: 420, pierce: 2, size: 1, crit: 0.08, homing: 0 },
    grow: { dmg: 2.8, rate: 0.1, pierce: 0.34, speed: 10 },
    startWord: '電', startWord2: '貫', maxLevel: 8, unlock: { stage: 1 },
  },
  bomb: {
    id: 'bomb', name: '弾', kind: 'bomb', glyph: '爆', tail: '弾',
    desc: '投げて爆発させる。範囲と炎上。',
    base: { dmg: 14, rate: 0.55, speed: 210, explode: 30, area: 26, size: 1.1, count: 1, knock: 50 },
    grow: { dmg: 4.6, rate: 0.06, explode: 8, area: 5 },
    startWord: '炎', startWord2: '焔', maxLevel: 8, unlock: { stage: 1 },
  },
  orbit: {
    id: 'orbit', name: '環', kind: 'orbit', glyph: '環', tail: '環',
    desc: '自分のまわりに回る刃。',
    base: { dmg: 7, orbit: 2, size: 1, crit: 0.04, rate: 0.5 },
    grow: { dmg: 2.4, orbit: 0.34, size: 0.05 },
    startWord: '鋼', startWord2: '捷', maxLevel: 8, unlock: { stage: 2 },
  },
  thunder: {
    id: 'thunder', name: '雷', kind: 'chain', glyph: '雷', tail: '雷',
    desc: '敵から敵へ連鎖する稲光。',
    base: { dmg: 11, rate: 1.1, chain: 3, shock: 0.10, size: 1, crit: 0.05 },
    grow: { dmg: 3.6, chain: 0.34, rate: 0.1 },
    startWord: '電', startWord2: '連', maxLevel: 8, unlock: { stage: 2 },
  },
  whip: {
    id: 'whip', name: '鞭', kind: 'whip', glyph: '鞭', tail: '鞭',
    desc: '周囲を薙ぐ。近接の範囲攻撃。',
    base: { dmg: 10, rate: 1.25, range: 130, area: 10, size: 1, knock: 60, crit: 0.05 },
    grow: { dmg: 3.4, rate: 0.1, range: 7, area: 2 },
    startWord: '嵐', startWord2: '豪', maxLevel: 8, unlock: { stage: 3 },
  },
  aura: {
    id: 'aura', name: '壁', kind: 'aura', glyph: '壁', tail: '壁',
    desc: '纏った毒の城壁。触れると傷つく。',
    base: { dmg: 4, rate: 1.0, range: 92, size: 1, slowImmune: 0, regen: 0 },
    grow: { dmg: 1.6, range: 7, rate: 0.1 },
    startWord: '毒', startWord2: '固', maxLevel: 8, unlock: { stage: 3 },
  },
  boomerang: {
    id: 'boomerang', name: '還', kind: 'boomerang', glyph: '還', tail: '還',
    desc: '飛んで戻ってくる刃。貫通する。',
    base: { dmg: 10, rate: 0.9, speed: 300, pierce: 4, bounce: 2, size: 1, crit: 0.06 },
    grow: { dmg: 3.4, rate: 0.1, pierce: 0.34, bounce: 0.3 },
    startWord: '電', startWord2: '貫', maxLevel: 8, unlock: { stage: 4 },
  },
  beam: {
    id: 'beam', name: '光', kind: 'beam', glyph: '光', tail: '光',
    desc: '一直線を貫く光。装甲も切り裂く。',
    base: { dmg: 16, rate: 0.7, range: 460, pierce: 99, size: 1, crit: 0.1, speed: 900 },
    grow: { dmg: 5.2, rate: 0.08, range: 20 },
    startWord: '聖', startWord2: '輝', maxLevel: 8, unlock: { stage: 5 },
  },
  // ── 追加分。末尾語が違えば攻撃も形も違になる。──
  tachi: {
    id: 'tachi', name: '刀', kind: 'slash', glyph: '刀', tail: '刀',
    desc: '大きく振る。扇が広く、一振りで複数を薙ぐ。',
    base: { dmg: 15, rate: 0.75, range: 112, arc: 2.9, size: 1.15, crit: 0.06 },
    grow: { dmg: 4.6, rate: 0.06, range: 5, arc: 0.08 },
    startWord: '炎', startWord2: '焔', maxLevel: 8, unlock: { stage: 3 },
  },
  needle: {
    id: 'needle', name: '針', kind: 'shot', glyph: '針', tail: '針',
    desc: '細くて速い。連射で削り、貫通する。',
    base: { dmg: 4, rate: 4.0, speed: 540, count: 2, pierce: 1, size: 0.7, crit: 0.06, spread: 0.05 },
    grow: { dmg: 1.3, rate: 0.28, count: 0.2, pierce: 0.2 },
    startWord: '毒', startWord2: '蝕', maxLevel: 8, unlock: { stage: 3 },
  },
  boulder: {
    id: 'boulder', name: '塊', kind: 'bomb', glyph: '塊', tail: '塊',
    desc: '重い。ゆっくり飛んで、敵を吹き飛ばす。',
    base: { dmg: 20, rate: 0.42, speed: 150, explode: 34, area: 34, size: 1.4, count: 1, knock: 80 },
    grow: { dmg: 6.2, rate: 0.04, explode: 9, area: 6 },
    startWord: '土', startWord2: '崖', maxLevel: 8, unlock: { stage: 4 },
  },
  claw: {
    id: 'claw', name: '爪', kind: 'slash', glyph: '爪', tail: '爪',
    desc: '短く速い。近くを連続で薙ぐ。',
    base: { dmg: 7, rate: 2.6, range: 100, arc: 2.3, area: 6, size: 0.9, crit: 0.08, knock: 20 },
    grow: { dmg: 2.3, rate: 0.16, range: 4, arc: 0.04 },
    startWord: '血', startWord2: '蓮', maxLevel: 8, unlock: { stage: 5 },
  },
  dragon: {
    id: 'dragon', name: '矛', kind: 'shot', glyph: '矛', tail: '矛',
    desc: '長い。遠くを串刺しにする。',
    base: { dmg: 13, rate: 0.85, speed: 460, pierce: 5, size: 1.2, crit: 0.12 },
    grow: { dmg: 4.0, rate: 0.07, pierce: 0.5, speed: 14 },
    startWord: '火', startWord2: '貫', maxLevel: 8, unlock: { stage: 6 },
  },
  clone: {
    id: 'clone', name: '球', kind: 'shot', glyph: '珠', tail: '球',
    desc: '命中した弾が分裂する。',
    base: { dmg: 8, rate: 1.0, speed: 300, count: 2, split: 2, size: 1, crit: 0.05, spread: 0.2 },
    grow: { dmg: 2.7, rate: 0.1, split: 0.3, count: 0.25 },
    startWord: '漆', startWord2: '裂', maxLevel: 8, unlock: { stage: 6 },
  },
  greatblade: {
    id: 'greatblade', name: '斧', kind: 'slash', glyph: '斧', tail: '斧',
    desc: '重い一振り。遠くまで薙ぎ、敵を吹き飛ばす。',
    base: { dmg: 18, rate: 0.6, range: 168, arc: 3.0, area: 18, size: 1.2, knock: 110, crit: 0.06 },
    grow: { dmg: 5.6, rate: 0.05, range: 9, arc: 0.05, area: 2 },
    startWord: '鋼', startWord2: '剛', maxLevel: 8, unlock: { stage: 7 },
  },
  flank: {
    id: 'flank', name: '槍', kind: 'shot', glyph: '槍', tail: '槍',
    desc: '左右から同時に撃つ。',
    base: { dmg: 9, rate: 1.3, speed: 340, count: 2, spread: 0.9, size: 1, crit: 0.05 },
    grow: { dmg: 3.0, rate: 0.1, count: 0.24, spread: 0.04 },
    startWord: '風', startWord2: '旋', maxLevel: 8, unlock: { stage: 8 },
  },
  flurry: {
    id: 'flurry', name: '玉', kind: 'shot', glyph: '玉', tail: '玉',
    desc: '散らばった弾を連射する。数で押す。',
    base: { dmg: 6, rate: 2.4, speed: 380, count: 3, spread: 0.7, size: 0.9, crit: 0.04 },
    grow: { dmg: 2.0, rate: 0.2, count: 0.28 },
    startWord: '風', startWord2: '多', maxLevel: 8, unlock: { stage: 9 },
  },
};

export const WEAPON_IDS = Object.keys(WEAPONS);

/** 同時に持てる武器の最大数。戦闘中に武器語を得ると 1 つ増える。 */
export const WEAPON_MAX = 3;

/**
 * 武器語 (形態語) と、描画の形・攻撃の型の対応。
 *
 * 武器語は文の中に自分で置く。置いた武器語が攻撃を決める。
 * 武器語が文に無ければ、その武器の既定の型になる。
 */
export const FORM_SHAPE = {
  // 斬撃
  刃: ['blade', 'slash'], 剣: ['blade', 'slash'], 刀: ['blade', 'slash'],
  斧: ['blade', 'slash'], 戈: ['blade', 'slash'], 牙: ['blade', 'slash'],
  // 射撃
  弾: ['bomb', 'bomb'], 銃: ['shot', 'shot'], 玉: ['shot', 'shot'],
  爪: ['blade', 'slash'],
  矢: ['arrow', 'shot'], 針: ['arrow', 'shot'], 弓: ['arrow', 'shot'],
  槍: ['arrow', 'shot'], 矛: ['arrow', 'shot'],
  球: ['orb', 'shot'], 珠: ['blade', 'boomerang'], 還: ['blade', 'boomerang'],
  光: ['arrow', 'beam'],
  雷: ['shot', 'chain'],
  // 爆弾
  塊: ['orb', 'bomb'], 岩: ['orb', 'bomb'], 石: ['bomb', 'bomb'],
  // 軌道
  環: ['blade', 'orbit'], 輪: ['blade', 'orbit'],
  // 薙ぎ
  鞭: ['blade', 'whip'], 鎖: ['blade', 'whip'],
  // 城壁
  壁: ['orb', 'aura'], 網: ['orb', 'aura'], 盾: ['orb', 'aura'],
};

/** 攻撃の型から描画の形を引くときの既定値。 */
export const KIND_SHAPE = {
  slash: 'blade', shot: 'shot', pierce: 'arrow', orbit: 'blade',
  bomb: 'bomb', chain: 'shot', boomerang: 'blade', whip: 'blade',
  aura: 'orb', beam: 'arrow',
};

/**
 * 武器語から、武器の定義をその場につくる。
 *
 * 戦闘中に得た武器語 (剣・弾・銃…) から新しい文を作るときに使う。
 * 基礎値は控えめにして、語そのものが力を出す設計にする。
 */
const formDefs = new Map();

export function defForForm(text) {
  // 武器語そのものの定義をキャッシュして使い回す。
  const id = `form:${text}`;
  if (formDefs.has(id)) return formDefs.get(id);
  const info = FORM_SHAPE[text] || ['shot', 'shot'];
  const def = {
    id,
    name: text,
    kind: info[1],
    shape: info[0],
    glyph: text,
    desc: `${text} の文。語を並べて 10 文字までの文にする。`,
    base: { dmg: 5, rate: 1.2, speed: 260, size: 1, count: 1, range: 100, area: 0 },
    grow: { dmg: 1.9, rate: 0.08 },
    startWord: null,
    startWord2: null,
    maxLevel: 8,
    unlock: null,
    isForm: true,
  };
  formDefs.set(id, def);
  return def;
}

/** 武器の定義を引く。武器語由来のものはその場でつくる。 */
export function lookupDef(id) {
  if (WEAPONS[id]) return WEAPONS[id];
  if (id && id.startsWith('form:')) return defForForm(id.slice(5));
  return null;
}

/** 攻撃の種類の日本語名。UI は必ずこれを使う (raw な kind を出さない)。 */
export const KIND_LABEL = {
  slash: '斬撃', shot: '射撃', bomb: '爆弾', chain: '連鎖',
  orbit: '軌道', whip: '薙ぎ', aura: '城壁', beam: '光線',
  boomerang: '還り刃', pierce: '貫通', none: '',
};

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
