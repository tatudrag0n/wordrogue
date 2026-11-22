// 適応品質の純粋関数のテスト。  node test/quality.test.js
import {
  QUALITY_LEVELS, QUALITY_MAX, clampQuality, dprCapFor, particleCapFor,
  decorFor, initialQuality, decideQuality, effectiveDpr,
  FPS_DOWNGRADE, FPS_UPGRADE,
} from '../js/core/quality.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const sec = (t) => console.log(`\n== ${t} ==`);

sec('段階表: DPR と粒上限が単調に下がる');
{
  ok(QUALITY_LEVELS.length === 4, `段階は 4 つ: ${QUALITY_LEVELS.length}`);
  const dprs = QUALITY_LEVELS.map((q) => q.dprCap);
  ok(JSON.stringify(dprs) === JSON.stringify([2, 1.5, 1.25, 1]), `DPR 順: ${dprs}`);
  const caps = QUALITY_LEVELS.map((q) => q.particleCap);
  ok(caps[0] === 500 && caps[caps.length - 1] === 120, `粒上限の両端: ${caps}`);
  ok(caps.includes(220), '粒上限に 220 の段階がある');
  for (let i = 1; i < caps.length; i++) ok(caps[i] <= caps[i - 1], `粒上限が増えていない (${i})`);
  for (let i = 1; i < dprs.length; i++) ok(dprs[i] < dprs[i - 1], `DPR が下がっている (${i})`);
  ok(decorFor(0) === 'full' && decorFor(QUALITY_MAX) === 'off', '装飾は full → off');
}

sec('clamp / アクセサ');
{
  ok(clampQuality(-3) === 0 && clampQuality(99) === QUALITY_MAX, '範囲外は丸める');
  ok(clampQuality(NaN) === 0, 'NaN は 0');
  ok(dprCapFor(1) === 1.5 && particleCapFor(1) === 220, '段階 1 の値');
  ok(effectiveDpr(0, 3) === 2, '端末 DPR 3 でも上限 2');
  ok(effectiveDpr(3, 3) === 1, '最軽量は DPR 1');
  ok(effectiveDpr(0, 0) === 1 && effectiveDpr(0, NaN) === 1, '不正な DPR は 1');
}

sec('初期段階: タッチ/小画面は抑えめ');
{
  ok(initialQuality({ touch: false, smallScreen: false }) === 0, 'デスクトップは high');
  ok(initialQuality({ touch: true }) === 1, 'タッチは balanced');
  ok(initialQuality({ smallScreen: true }) === 1, '小画面は balanced');
  ok(initialQuality() === 0, '情報なしは high');
}

sec('FPS による段階決定 (ヒステリシス)');
{
  ok(decideQuality(0, 30) === 1, '30fps は 1 段階落とす');
  ok(decideQuality(0, FPS_DOWNGRADE - 0.1) === 1, '閾値未満は落とす');
  ok(decideQuality(0, FPS_DOWNGRADE) === 0, '閾値ちょうどは維持');
  ok(decideQuality(2, 50) === 2, '中間帯は維持 (揺れない)');
  ok(decideQuality(2, FPS_UPGRADE) === 1, '回復したら 1 段階戻す');
  ok(decideQuality(0, 60) === 0, '最高段階からは戻らない');
  ok(decideQuality(QUALITY_MAX, 10) === QUALITY_MAX, '最軽量で頭打ち');
  ok(decideQuality(1, NaN) === 1, '計測前 (NaN) は維持');
  // 連続で落としても段階は 1 ずつしか動かない。
  let lv = 0; const seq = [];
  for (let i = 0; i < 6; i++) { lv = decideQuality(lv, 20); seq.push(lv); }
  ok(JSON.stringify(seq) === JSON.stringify([1, 2, 3, 3, 3, 3]), `連続低下: ${seq}`);
}

console.log(`\n---- 合格 ${pass} / 不合格 ${fail} ----`);
process.exit(fail ? 1 : 0);
