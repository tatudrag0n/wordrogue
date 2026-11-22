// ============================================================================
// ワードローグ — 適応品質 (描画の段階調整)
//
// スマホで重いときに、ゲーム内容・当たり判定・DPS を一切変えずに
// 「見た目の解像度と装飾」だけを段階的に落とすための純粋関数群。
// 状態を持たないので単体テストで仕様を固定できる (test/quality.test.js)。
//
// 段階は 0 (最高) → 3 (最軽量)。
//   DPR 上限        : 2 → 1.5 → 1.25 → 1
//   パーティクル上限 : 500 → 220 → 220 → 120
//     ※ 中間段階では解像度を先に落とし、粒の数は 220 で粘る。
//       最終段階で初めて 120 まで絞る (演出の芯を残すため)。
//   装飾 (decor)    : full → full → reduced → off
//     reduced … 残像 (ゴースト) を間引き、画面の粒 (モート) と紙目を止める
//     off     … 残像・速度線も止める。軌跡そのものと着弾は残る。
// ============================================================================

export const QUALITY_LEVELS = [
  { name: 'high', dprCap: 2, particleCap: 500, decor: 'full' },
  { name: 'balanced', dprCap: 1.5, particleCap: 220, decor: 'full' },
  { name: 'light', dprCap: 1.25, particleCap: 220, decor: 'reduced' },
  { name: 'minimal', dprCap: 1, particleCap: 120, decor: 'off' },
];

export const QUALITY_MAX = QUALITY_LEVELS.length - 1;

/** 段階を範囲内に丸める。 */
export function clampQuality(level) {
  const n = Number.isFinite(level) ? Math.trunc(level) : 0;
  return Math.max(0, Math.min(QUALITY_MAX, n));
}

export function dprCapFor(level) { return QUALITY_LEVELS[clampQuality(level)].dprCap; }
export function particleCapFor(level) { return QUALITY_LEVELS[clampQuality(level)].particleCap; }
export function decorFor(level) { return QUALITY_LEVELS[clampQuality(level)].decor; }

/**
 * 起動時の段階。タッチ操作・小画面では最初から 1 (balanced) に抑える。
 * デスクトップの大画面は 0 (high)。
 */
export function initialQuality(env = {}) {
  const touch = !!env.touch;
  const small = !!env.smallScreen;
  return (touch || small) ? 1 : 0;
}

/** この FPS を下回ったら 1 段階落とす。 */
export const FPS_DOWNGRADE = 45;
/** ここまで回復したら 1 段階戻してよい (戻す条件は落とす条件より厳しくする)。 */
export const FPS_UPGRADE = 58;

/**
 * 計測した平均 FPS から次の段階を決める純粋関数。
 * - fps < 45 … 1 段階落とす (最軽量で頭打ち)
 * - fps >= 58 かつ最低段階より上 … 1 段階戻す
 * - それ以外 … 維持 (ヒステリシスで段階が揺れないようにする)
 * fps が有限でない (計測前) ときは維持。
 */
export function decideQuality(level, fps) {
  const cur = clampQuality(level);
  if (!Number.isFinite(fps)) return cur;
  if (fps < FPS_DOWNGRADE) return clampQuality(cur + 1);
  if (fps >= FPS_UPGRADE) return clampQuality(cur - 1);
  return cur;
}

/** 実効 DPR。端末 DPR と段階上限の小さい方 (最低 1)。 */
export function effectiveDpr(level, deviceDpr) {
  const d = Number.isFinite(deviceDpr) && deviceDpr > 0 ? deviceDpr : 1;
  return Math.max(1, Math.min(dprCapFor(level), d));
}
