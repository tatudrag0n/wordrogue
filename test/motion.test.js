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
import { Run } from '../js/game/run.js';
import { makeRng } from '../js/core/util.js';
import { BASE_PLAYER } from '../js/game/stats.js';
import {
  WEAPON_MOTIONS, GLYPH_MOTION, motionKey, motionWindup, motionLead, motionDuration,
  startWeaponMotion, motionPose, weaponStyle,
} from '../js/game/motions.js';

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

console.log(`\n---- 合格 ${pass} / 不合格 ${fail} ----`);
process.exit(fail ? 1 : 0);
