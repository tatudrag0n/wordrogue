// 武器モーションの監査。  node test/motion.test.js
//
// 攻撃の見た目 (予備動作 → 打撃 → 振り抜け → 戻り) が、
//   ・全武器にあること
//   ・武器ごとに軌道が違うこと
//   ・同じ振り方が連続しないこと
//   ・描画に渡す値が有限で、時間の逆行が無いこと
//   ・DPS (威力・間隔) を変えないこと
// を確かめる。Canvas は使わないので Node だけで動く。
import './seed.mjs';
import { WEAPONS, FORM_SHAPE } from '../js/data/weapons.js';
import { WeaponInst } from '../js/game/weapon.js';
import { makeWord } from '../js/data/words.js';
import { Run } from '../js/game/run.js';
import { makeRng } from '../js/core/util.js';
import { BASE_PLAYER } from '../js/game/stats.js';
import {
  WEAPON_MOTIONS, GLYPH_MOTION, motionKey, motionWindup, motionLead, motionDuration,
  startWeaponMotion, motionPose, weaponStyle, syncMotionShape,
} from '../js/game/motions.js';
import { attackShape } from '../js/game/combat.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const sec = (t) => console.log(`\n== ${t} ==`);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const audio = new Proxy({}, { get: () => () => {} });
const save = { d: {} };

sec('全武器にモーションがある');
{
  const defs = Object.values(WEAPONS);
  const missing = [];
  const tooFew = [];
  for (const d of defs) {
    const wi = new WeaponInst(d.id);
    const res = wi.resolve({ ...BASE_PLAYER });
    const key = motionKey(wi, res);
    if (!WEAPON_MOTIONS[key]) missing.push(`${d.id}:${key}`);
    const style = weaponStyle(res.tail || d.name, res.shape);
    if (!WEAPON_MOTIONS[style.key]) missing.push(`${d.name}:${style.key}`);
    if (WEAPON_MOTIONS[style.key]?.variants.length < 2) tooFew.push(d.id);
  }
  ok(missing.length === 0, `モーションの無い武器: ${missing.join(' ')}`);
  ok(tooFew.length === 0, `振り方が 1 種類しかない武器: ${tooFew.join(' ')}`);
  const noGlyph = Object.keys(FORM_SHAPE).filter((g) => !GLYPH_MOTION[g]);
  ok(noGlyph.length === 0, `持ち方の無い武器語: ${noGlyph.join(' ')}`);
  console.log(`  武器 ${defs.length} / 持ち方 ${Object.keys(WEAPON_MOTIONS).length} / 振り方 ${Object.values(WEAPON_MOTIONS).reduce((n, p) => n + p.variants.length, 0)}`);
}

sec('予備動作・打撃・振り抜け・戻りが順に進む');
{
  const ORDER = ['windup', 'strike', 'follow', 'recover'];
  let checked = 0, bad = 0, back = 0;
  for (const [key, profile] of Object.entries(WEAPON_MOTIONS)) {
    for (let v = 0; v < profile.variants.length; v++) {
      const wi = { motionSeq: v };
      const res = { kind: profile.family === 'whip' ? 'whip' : 'slash', shape: 'blade', stats: { range: 100, arc: 1.8, size: 1, rate: 1.5 }, tail: null, elementInfo: { color: '#d4a94e' } };
      const m = startWeaponMotion(wi, res, 0.2, { interval: 1 / 1.5 });
      let last = -1;
      for (let i = 0; i <= 50; i++) {
        m.elapsed = (i / 50) * m.duration;
        const p = motionPose(m);
        for (const k of ['t', 'angle', 'angleRel', 'extension', 'x', 'y', 'lunge', 'reach', 'alpha', 'impact', 'flash']) {
          if (!finite(p[k])) { bad++; if (bad < 4) console.log(`    非有限 ${key}/${m.variant}.${k}=${p[k]}`); }
        }
        if (p.alpha < -1e-9 || p.alpha > 1 + 1e-9) bad++;
        const ord = ORDER.indexOf(p.phase);
        if (ord < last) back++;
        last = Math.max(last, ord);
        checked++;
      }
    }
  }
  ok(bad === 0, `描画値が壊れた箇所 ${bad}`);
  ok(back === 0, `モーションの局面が逆戻りした ${back} 回`);
  console.log(`  ${checked} 時点を検査 (局面の逆戻り ${back} / 非有限 ${bad})`);
  console.log(`  ${Object.entries(WEAPON_MOTIONS).map(([k, p]) => k + ':' + p.variants.map((v) => v.label).join('/')).join('  ')}`);
}

sec('同じ武器でも振り方が変わり、乱数に依らない');
{
  const dups = [];
  for (const d of Object.values(WEAPONS)) {
    const wi = new WeaponInst(d.id);
    const res = wi.resolve({ ...BASE_PLAYER });
    const seq = [];
    for (let i = 0; i < 7; i++) {
      seq.push(startWeaponMotion(wi, res, 0.4, { interval: 1 / Math.max(0.05, res.stats.rate) }).variant);
    }
    for (let i = 1; i < seq.length; i++) if (seq[i] === seq[i - 1]) dups.push(`${d.id}:${seq[i]}`);
    // もう一度作っても、攻撃回数が同じなら同じ順序になる。
    const wi2 = new WeaponInst(d.id);
    const res2 = wi2.resolve({ ...BASE_PLAYER });
    const seq2 = [];
    for (let i = 0; i < 5; i++) seq2.push(startWeaponMotion(wi2, res2, 0.4, { interval: 1 }).variant);
    if (seq.slice(0, 5).join() !== seq2.join()) dups.push(`${d.id}:不安定`);
  }
  ok(dups.length === 0, `同じ振りが連続/不安定: ${dups.join(' ')}`);
  console.log('  攻撃ごとに軌道を巡回 (乱数なし)');
}

sec('攻撃間隔に合わせてモーションが収まる');
{
  let over = 0;
  for (const rate of [0.5, 1, 2, 3, 5, 8]) {
    const wi = new WeaponInst('sword');
    const res = wi.resolve({ ...BASE_PLAYER });
    const interval = 1 / rate;
    const m = startWeaponMotion(wi, res, 0, { interval });
    if (m.duration > interval + 1e-9) over++;
    if (motionWindup(wi, res, interval) > interval + 1e-9) over++;
    if (motionLead(wi, res, interval) > interval + 1e-9) over++;
    if (motionLead(wi, res, interval) < motionDuration(wi, res, interval) * 0.2) over++;
  }
  ok(over === 0, `攻撃間隔より長いモーション ${over}`);
}

sec('モーションは性能を変えない');
{
  const before = new WeaponInst('sword');
  const resBefore = before.resolve({ ...BASE_PLAYER });
  const stats = JSON.stringify(resBefore.stats);
  for (let i = 0; i < 20; i++) startWeaponMotion(before, resBefore, i * 0.2, { interval: 0.5 });
  const resAfter = before.resolve({ ...BASE_PLAYER });
  ok(JSON.stringify(resAfter.stats) === stats, 'モーションで武器の性能が変わった');
  ok(resAfter.dps === resBefore.dps, 'モーションで DPS が変わった');
}

sec('戦闘中にモーションが実際に進む');
{
  const r = new Run({
    stageId: 1, audio, save, rng: makeRng(5150), lexiconSize: 12,
    weaponIds: ['sword'],
  });
  const wi = r.weapons[0];
  r.spawnEnemy('slime', { x: r.player.x + 70, y: r.player.y });
  r.enemies.forEach((e) => { e.spawned = 1; e.hp = 1e9; });
  const input = { ax: 0, ay: 0, moving: false, angle: 0 };
  let sawMotion = 0, sawSwing = 0;
  const phases = new Set();
  for (let i = 0; i < 60 * 6; i++) {
    r.update(1 / 60, input);
    if (wi.motion) {
      sawMotion++;
      const p = motionPose(wi.motion);
      phases.add(p.phase);
      if (p.phase === 'strike') sawSwing++;
    }
  }
  ok(wi.motionSeq >= 8, `6 秒で攻撃が ${wi.motionSeq} 回しかない`);
  // 攻撃の瞬間と打撃の瞬間が重なること (視覚と当たり判定がずれない)。
  const lag = wi.motionLog.map((m) => Math.abs(m.impactAt - motionLead(wi, wi._res, 1 / Math.max(0.05, wi._res.stats.rate))));
  ok(lag.every((d) => d < 1e-9), `打撃と攻撃の瞬間がずれている: ${lag.slice(0, 3)}`);
  ok(sawMotion > 30, `モーションが見えたフレームが少ない: ${sawMotion}`);
  ok(sawSwing > 0, '打撃の局面が一度も無い');
  ok(new Set(wi.motionLog.map((m) => m.variant)).size >= 2, '振り方が 1 種類のまま');
  console.log(`  6 秒 / 攻撃 ${wi.motionSeq} 回 / モーション ${sawMotion} フレーム / 局面 ${[...phases].join(' ')}`);
}

sec('武器種ごとにモーションの作り方が変わる (刃は飛ぶ / 刀は左右 / 剣は前方)');
{
  const styles = {};
  for (const d of Object.values(WEAPONS)) {
    const wi = new WeaponInst(d.id);
    const res = wi.resolve({ ...BASE_PLAYER });
    styles[d.id] = startWeaponMotion(wi, res, 0.6, { interval: 1 / Math.max(0.05, res.stats.rate) }).style;
  }
  ok(styles.sword === 'wave', `刃が斬撃を飛ばす動きになっていない: ${styles.sword}`);
  ok(styles.tachi === 'sweep', `刀が左右の薙ぎになっていない: ${styles.tachi}`);
  ok(styles.longsword === 'forward', `剣が前方の斬りになっていない: ${styles.longsword}`);
  ok(styles.greatblade === 'smash' && styles.hammer === 'smash', '斧・槌が打撃になっていない');
  ok(styles.claw === 'claw' && styles.fang === 'bite' && styles.fist === 'punch', '爪・牙・拳の型が違う');
  const unknown = Object.entries(WS_KEYS()).filter(([, st]) => !st);
  ok(unknown.length === 0, `style の無いモーション: ${unknown.map(([k]) => k).join(' ')}`);
  // 刃の斬撃波は手元から間合いの外周へ飛ぶ。刀は扇の端から端まで。
  const wi = new WeaponInst('sword');
  const res = wi.resolve({ ...BASE_PLAYER });
  const m = startWeaponMotion(wi, res, 0, { interval: 0.5 });
  const flys = [];
  for (let i = 0; i <= 20; i++) { m.elapsed = (i / 20) * m.duration; flys.push(motionPose(m).fly); }
  const up = flys.every((v, i) => i === 0 || v >= flys[i - 1] - 1e-9);
  ok(up && flys.at(-1) > 0.95, `斬撃波が飛んでいない: ${flys.map((v) => v.toFixed(2)).join(' ')}`);
  console.log(`  刃 ${styles.sword} / 刀 ${styles.tachi} / 剣 ${styles.longsword} / 槌 ${styles.hammer} / 爪 ${styles.claw}`);
}

/** すべてのモーションに style があるか。 */
function WS_KEYS() {
  return Object.entries(WEAPON_MOTIONS).map(([k, p]) => [k, !!p.style]);
}

sec('軌跡は当たり判定の扇と間合いからはみ出さない');
{
  let out = 0, short = 0, reachMiss = 0, checked = 0;
  for (const d of Object.values(WEAPONS)) {
    const wi = new WeaponInst(d.id);
    const res = wi.resolve({ ...BASE_PLAYER });
    const shape = attackShape(res.stats, BASE_PLAYER);
    const m = startWeaponMotion(wi, res, 0.6, { interval: 1 / Math.max(0.05, res.stats.rate) });
    if (Math.abs(m.reach - shape.reach) > 1e-9) {
      reachMiss++;
      if (reachMiss < 4) console.log(`    間合いがずれる ${d.id}: ${m.reach} != ${shape.reach}`);
    }
    if (res.kind !== 'slash') continue;
    // 扇の端から端まで振ること (描いた範囲 = 当たる範囲)。
    if (Math.abs((m.to - m.from)) < m.arc - 1e-6) short++;
    for (let i = 0; i <= 40; i++) {
      m.elapsed = (i / 40) * m.duration;
      const p = motionPose(m);
      if (p.phase === 'windup') continue;
      checked++;
      if (Math.abs(p.angleRel) > m.arc / 2 + 1e-9) out++;
      if (p.tipX * p.tipX + p.tipY * p.tipY > (m.reach * 1.45) ** 2) out++;
    }
  }
  ok(out === 0, `扇の外へ出た軌跡 ${out}`);
  ok(short === 0, `扇を覆いきっていない斬撃 ${short}`);
  ok(reachMiss === 0, `当たり判定と間合いがずれる武器 ${reachMiss}`);
  console.log(`  ${checked} 時点で軌跡が扇の内側 / 斬撃は扇を端から端まで覆う`);
}

sec('当たり判定とモーションが同じ値を使う (実際の戦闘)');
{
  const r = new Run({
    stageId: 1, audio, save: { d: {} }, rng: makeRng(2468), lexiconSize: 12,
    weaponIds: ['sword'],
  });
  // 刃・刀・剣を同時に持たせて、3 つの style が同居することを見る。
  for (const id of ['tachi', 'longsword']) {
    if (r.weapons.length >= 3) break;
    r.weapons.push(new WeaponInst(id, 1));
    const wi = r.weapons.at(-1);
    if (wi.def.tail) wi.sentence.push(makeWord(wi.def.tail));
  }
  r.spawnEnemy('slime', { x: r.player.x + 70, y: r.player.y });
  r.enemies.forEach((e) => { e.spawned = 1; e.hp = 1e9; });
  let bad = 0, seen = 0;
  const styles = new Set();
  for (let i = 0; i < 60 * 4; i++) {
    r.update(1 / 60, { ax: 0, ay: 0, moving: false, angle: 0 });
    for (const s of r.slashes) {
      if (!s.motion) continue;
      seen++;
      styles.add(s.motion.style);
      // 描く半径・扇 == 当てる半径・扇。
      if (Math.abs(s.r - s.motion.reach) > 1e-9) bad++;
      if (Math.abs(s.arc - s.motion.arc) > 1e-9) bad++;
    }
  }
  ok(seen > 0, '斬撃のエフェクトが 1 度も出ていない');
  ok(bad === 0, `見た目と当たり判定がずれた斬撃 ${bad}`);
  ok(styles.has('wave') && styles.has('sweep') && styles.has('forward'),
    `3 種のモーションが同時に出ていない: ${[...styles].join(' ')}`);
  console.log(`  斬撃 ${seen} 回 / 出た style ${[...styles].join(' ')}`);
}

sec('扇が変われば、モーションも同じ扇に合わせ直す');
{
  const wi = new WeaponInst('tachi');
  const res = wi.resolve({ ...BASE_PLAYER });
  const m = startWeaponMotion(wi, res, 0.2, { interval: 1 });
  const before = m.to - m.from;
  syncMotionShape(m, 300, 1.2);
  ok(Math.abs((m.to - m.from) - 1.2) < 1e-9, `扇を合わせ直していない: ${before} → ${m.to - m.from}`);
  ok(Math.abs(m.reach - 300) < 1e-9, `間合いを合わせ直していない: ${m.reach}`);
  const p = motionPose({ ...m, elapsed: m.impactAt + 1e-4 });
  ok(Math.abs(p.angleRel) <= 0.6 + 1e-9, `合わせ直した扇からはみ出した: ${p.angleRel}`);
  console.log(`  扇 ${before.toFixed(2)} → 1.20 / 間合い 300`);
}

console.log(`\n---- 合格 ${pass} / 不合格 ${fail} ----`);
process.exit(fail ? 1 : 0);
