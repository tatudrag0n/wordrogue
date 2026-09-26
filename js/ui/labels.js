// ============================================================================
// ワードローグ — UI 用の日本語ラベル
//
// 効果のキーと日本語名の対応。forge / hud / 辞書 で共有する。
// 同じ表を複数に書くと片方だけ古くなるので、ここに 1 つだけ置く。
// ============================================================================

/** 武器側の効果。 */
export const FX_LABEL = {
  dmg: '威力', rate: '攻撃/秒', speed: '速さ', count: '数', pierce: '貫通',
  split: '分裂', bounce: '反射', chain: '連鎖', orbit: '回転', size: '大きさ',
  area: '範囲', range: '間合い', arc: '扇', spread: '散り', crit: '会心',
  critDmg: '会心威力', homing: '追尾', duration: '持続', explode: '爆発',
  burn: '炎上', poison: '毒', chill: '減速', shock: '感電', freeze: '凍結',
  lifesteal: '吸血', regen: '回復', shield: 'シールド', knock: '撃退',
  recoil: '反動', magnet: '吸引', slowImmune: '減速耐性', reflect: '反射',
  armor: '装甲', power: '文力',
  // 素の値は足し算、「〜Pct」は掛け算。
  atkMul: '攻撃', dmgMul: '威力', hpMul: '体力', xpMul: '経験値',
  atkMulPct: '攻撃倍率', xpMulPct: '経験値倍率',
  dmgMulPct: '威力倍率', hpMulPct: '体力倍率',
};

/** プレイヤー自身の効果 (語彙と自身の文から来る)。 */
export const PS_LABEL = {
  hp: '体力', spd: '移動', atk: '攻撃', armor: '装甲', crit: '会心',
  regen: '回復', lifesteal: '吸血', luck: '幸運', magnet: '吸引',
  xp: '経験値', size: '大きさ', shield: 'シールド', critDmg: '会心威力',
};

/** 1 行にまとめる。0 近い項目は捨てる。 */
export function fxLine(fx, label, limit = 3) {
  const parts = [];
  for (const [k, v] of Object.entries(fx || {})) {
    if (Math.abs(v) < 0.01) continue;
    const n = Math.round(v * 100) / 100;
    parts.push(`${label[k] || k}${v > 0 ? '+' : ''}${n}`);
  }
  return parts.slice(0, limit).join(' ');
}
