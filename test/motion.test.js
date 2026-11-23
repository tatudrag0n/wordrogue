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
  WEAPON_MOTIONS, GLYPH_MOTION, SHAPE_MOTION, motionKey, motionWindup, motionLead, motionDuration,
  startWeaponMotion, motionPose, weaponStyle, syncMotionShape, swingCurve, crescentGeom,
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

sec('武器種ごとにモーションの作り方が変わる (刃・刀・剣は三日月を飛ばす)');
{
  const styles = {};
  for (const d of Object.values(WEAPONS)) {
    const wi = new WeaponInst(d.id);
    const res = wi.resolve({ ...BASE_PLAYER });
    styles[d.id] = startWeaponMotion(wi, res, 0.6, { interval: 1 / Math.max(0.05, res.stats.rate) }).style;
  }
  ok(styles.sword === 'wave', `刃が斬撃を飛ばす動きになっていない: ${styles.sword}`);
  ok(styles.tachi === 'wave', `刀が三日月を飛ばす動きになっていない: ${styles.tachi}`);
  ok(styles.longsword === 'wave', `剣が三日月を飛ばす動きになっていない: ${styles.longsword}`);
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
  const cresKeys = new Map();
  for (let i = 0; i < 60 * 4; i++) {
    r.update(1 / 60, { ax: 0, ay: 0, moving: false, angle: 0 });
    for (const s of r.slashes) {
      if (!s.motion) continue;
      seen++;
      styles.add(s.motion.style);
      // 1.69: 刃・刀・剣はどれも三日月 (wave)。違いは key と三日月の形 (cres)。
      if (s.motion.cres) {
        cresKeys.set(s.motion.key, `${s.motion.cres.len}/${s.motion.cres.thick}/${s.motion.cres.spin}`);
      }
      // 描く半径・扇 == 当てる半径・扇。
      if (Math.abs(s.r - s.motion.reach) > 1e-9) bad++;
      if (Math.abs(s.arc - s.motion.arc) > 1e-9) bad++;
    }
  }
  ok(seen > 0, '斬撃のエフェクトが 1 度も出ていない');
  ok(bad === 0, `見た目と当たり判定がずれた斬撃 ${bad}`);
  ok(cresKeys.has('sword') && cresKeys.has('tachi') && cresKeys.has('longsword'),
    `刃・刀・剣の三日月が同時に出ていない: ${[...cresKeys.keys()].join(' ')}`);
  ok(new Set(cresKeys.values()).size === cresKeys.size,
    `三日月の形が武器ごとに違わない: ${[...cresKeys.entries()].map(([k, v]) => `${k}=${v}`).join(' ')}`);
  console.log(`  斬撃 ${seen} 回 / 出た style ${[...styles].join(' ')} / 三日月 ${[...cresKeys.keys()].join(' ')}`);
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


sec('武器ごとに signature と軌跡が違う (1.65 の差別化)');
{
  const sigs = Object.entries(WEAPON_MOTIONS).map(([k, pr]) => [k, pr.sig]);
  ok(sigs.every(([, sg]) => !!sg), `sig の無いモーション: ${sigs.filter(([, sg]) => !sg).map(([k]) => k).join(' ')}`);
  ok(new Set(sigs.map(([, sg]) => sg)).size === sigs.length, 'sig が重複している');
  // 軌跡ベクトル (角度・伸び・固有量) が武器ごとに一致しないこと。
  // 持ち方 (key) ごとに、実際にその key へ届く語と kind で作る。
  const SPEC = {
    sword: ['刃', 'slash'], tachi: ['刀', 'sweep'], longsword: ['剣', 'thrust'],
    axe: ['斧', 'smash'], hammer: ['槌', 'quake'], claw: ['爪', 'flurry'],
    fang: ['牙', 'reap'], fist: ['拳', 'dual'], spear: ['槍', 'shard'],
    gun: ['銃', 'shot'], needle: ['針', 'shot'], bow: ['弓', 'pierce'],
    staff: ['杖', 'shadow'], chain: ['鎖', 'whip'], whip: ['鞭', 'whip'],
    throw: ['還', 'boomerang'], orb: ['玉', 'shot'], shears: ['鋏', 'snip'],
    saw: ['鋸', 'grind'], blade: [null, 'slash'], dualblades: [null, 'dual'],
    orbit: ['環', 'orbit'], beam: ['光', 'beam'], bolt: ['雷', 'chain'],
  };
  const vecs = new Map();
  const dup = [];
  for (const [key, [glyph, kind]] of Object.entries(SPEC)) {
    const wi = { motionSeq: 0 };
    const res = { kind, compound: key === 'dualblades', shape: 'blade', stats: { range: 100, arc: 1.8, size: 1, rate: 1.5 }, tail: glyph, elementInfo: { color: '#d4a94e' } };
    const m = startWeaponMotion(wi, res, 0.2, { interval: 10 });
    if (m.key !== key) { dup.push(`${key} を作ったつもりが ${m.key}`); continue; }
    const v = [];
    for (const f of [0.15, 0.35, 0.5, 0.62, 0.8, 0.95]) {
      m.elapsed = f * m.duration;
      const pp = motionPose(m);
      v.push(pp.angleRel.toFixed(3), pp.extension.toFixed(3), pp.fly.toFixed(2),
        (pp.open || 0).toFixed(2), (pp.jaw || 0).toFixed(2), (pp.sawQ || 0).toFixed(2),
        (pp.pulses || []).map((x) => x.toFixed(1)).join(','), String((pp.ghosts || []).length));
      for (const gh of (pp.ghosts || [])) {
        if (!finite(gh.rel) || !finite(gh.alpha)) dup.push(`${key}:残像が非有限`);
        if (pp.phase !== 'windup' && Math.abs(gh.rel) > m.arc / 2 + 1e-9) dup.push(`${key}:残像が扇の外`);
      }
    }
    const key2 = v.join('|');
    if (vecs.has(key2)) dup.push(`${key} と ${vecs.get(key2)} の軌跡が一致`);
    vecs.set(key2, key);
  }
  ok(dup.length === 0, `軌跡の重複/異常: ${dup.join(' ')}`);
  console.log(`  ${vecs.size} 種の軌跡がすべて異なる / sig ${new Set(sigs.map(([, x]) => x)).size} 種`);
}

sec('anticipation・ヒットストップ保持・武器固有の時間変化');
{
  const mk = (id) => {
    const wi = new WeaponInst(id);
    const res = wi.resolve({ ...BASE_PLAYER });
    return startWeaponMotion(wi, res, 0, { interval: 10 });
  };
  // 刀: 予備動作の中ほどで、振る方向と逆へ余分に引いている。
  const mt = mk('tachi');
  mt.elapsed = (mt.windup / 2);
  const pt = motionPose(mt);
  const noDip = -1.0 + (mt.from - -1.0) * 0.5; // easeInOut(0.5)=0.5 の素の位置
  ok(pt.angleRel < noDip - 0.04, `刀の anticipation が無い: ${pt.angleRel} vs ${noDip}`);
  // 槌: 打撃直後は姿勢が凍る (held) が、局面は follow のまま順序が崩れない。
  const mh = mk('hammer');
  mh.elapsed = mh.impactAt + mh.duration * 0.03;
  const ph = motionPose(mh);
  ok(ph.held === true && ph.phase === 'follow', `槌の保持が効いていない: held=${ph.held} phase=${ph.phase}`);
  ok(Math.abs(ph.angleRel - mh.to) < 1e-6, `保持中に角度が動いた: ${ph.angleRel} != ${mh.to}`);
  // 鋸: 打撃中の角度が往復する (単調でない)。
  const ms = mk('saw');
  const angs = [];
  for (let i = 0; i <= 24; i++) { ms.elapsed = ms.windup + (ms.followAt - ms.windup) * (i / 24); angs.push(motionPose(ms).angleRel); }
  let turns = 0;
  for (let i = 2; i < angs.length; i++) if (Math.sign(angs[i] - angs[i - 1]) !== Math.sign(angs[i - 1] - angs[i - 2])) turns++;
  ok(turns >= 2, `鋸の往復が無い: 方向転換 ${turns}`);
  // 鋏: 開きが二段で閉じる (途中で止まる)。
  const mc = mk('scissors');
  const openAt = (f) => { mc.elapsed = mc.duration * f; return motionPose(mc).open; };
  const oMid = openAt(0.42); // 打撃局面の 55% 付近 = 二段目の「間」
  ok(oMid > 0.3 && oMid < 0.5, `鋏の二段目の間が無い: open=${oMid}`);
  // 針: 連続突きが時間差で進む。
  const mn = mk('needle');
  mn.elapsed = mn.windup + (mn.impactAt - mn.windup) * 0.4;
  const pn = motionPose(mn);
  ok(pn.pulses.length === 3 && pn.pulses[0] > pn.pulses[2], `針の連続突きが時間差でない: ${pn.pulses}`);
  // 加速曲線: 重い武器は序盤が遅く、軽い武器は序盤が速い。
  ok(swingCurve({ curve: 'heavy' }, 0.3) < swingCurve({ curve: 'snap' }, 0.3), '重さで加速曲線が変わっていない');
  console.log('  anticipation / held / 鋸の往復 / 鋏の二段 / 針の時間差 / 加速曲線を確認');
}

sec('名前↔モーション監査 (1.69: 実際の攻撃の型にモーションを合わせる)');
{
  // 語 → 持ち方。名前ではなく「その語が実際に何をする攻撃か」で決まる。
  ok(weaponStyle('斧').key === 'axe', `斧が axe でない: ${weaponStyle('斧').key}`);
  ok(weaponStyle('環').key === 'orbit' && weaponStyle('輪').key === 'orbit'
    && weaponStyle('渦').key === 'orbit', '環・輪・渦が周回 (orbit) でない');
  ok(weaponStyle('光').key === 'beam', `光が beam でない: ${weaponStyle('光').key}`);
  ok(weaponStyle('雷').key === 'bolt', `雷が bolt でない: ${weaponStyle('雷').key}`);
  ok(weaponStyle('弾').key === 'throw' && weaponStyle('爆').key === 'throw',
    '弾・爆が投擲 (throw) でない');
  // 武器定義 (末尾語が無い初期状態) からでも、定義のグリフで正しい持ち方に届く。
  const keyOf = (id) => {
    const wi = new WeaponInst(id);
    return motionKey(wi, wi.resolve({ ...BASE_PLAYER }));
  };
  ok(keyOf('greatblade') === 'axe', `斧 (武器定義) の持ち方: ${keyOf('greatblade')}`);
  ok(keyOf('bomb') === 'throw', `弾 (武器定義) の持ち方: ${keyOf('bomb')}`);
  ok(keyOf('orbit') === 'orbit', `環 (武器定義) の持ち方: ${keyOf('orbit')}`);
  ok(keyOf('beam') === 'beam', `光 (武器定義) の持ち方: ${keyOf('beam')}`);
  ok(keyOf('thunder') === 'bolt', `雷 (武器定義) の持ち方: ${keyOf('thunder')}`);
  // GLYPH_MOTION の全エントリが実在プロファイルを指す。
  const dead = Object.entries(GLYPH_MOTION).filter(([, k]) => !WEAPON_MOTIONS[k]);
  ok(dead.length === 0, `実在しないプロファイルを指す語: ${dead.map(([g]) => g).join(' ')}`);
  // 到達不能なプロファイルが無い (どの key にも、語・形・特殊経路のどれかで届く)。
  const reachable = new Set([
    ...Object.values(GLYPH_MOTION), ...Object.values(SHAPE_MOTION), 'dualblades', 'blade',
  ]);
  const unreach = Object.keys(WEAPON_MOTIONS).filter((k) => !reachable.has(k));
  ok(unreach.length === 0, `到達不能なプロファイル: ${unreach.join(' ')}`);
  // 剣は突き主体: 先頭バリアントが細い突き (扇の振り幅が小さい)。
  const lv = WEAPON_MOTIONS.longsword.variants;
  ok(Math.abs(lv[0].to - lv[0].from) < 0.2, `剣の先頭バリアントが突きでない: ${lv[0].label}`);
  ok(lv.some((v) => Math.abs(v.to - v.from) >= 1.9), '剣に斬撃バリアントが無い');
  console.log('  斧=axe / 環・輪・渦=orbit / 光=beam / 雷=bolt / 弾・爆=throw / 到達不能なし');
}

sec('飛ぶ三日月 (1.69): 幾何が扇と間合いの内側に収まる');
{
  const WAVE_KEYS = ['sword', 'tachi', 'longsword', 'blade', 'dualblades'];
  for (const key of WAVE_KEYS) {
    ok(WEAPON_MOTIONS[key].style === 'wave' && !!WEAPON_MOTIONS[key].cres,
      `${key} が三日月 (wave + cres) でない`);
  }
  ok(!!WEAPON_MOTIONS.fang.cres, '牙に小さな三日月の形が無い');
  let checked = 0, out = 0, thin = 0;
  const SPEC2 = {
    sword: ['刃', 'slash'], tachi: ['刀', 'sweep'], longsword: ['剣', 'slash'],
    blade: [null, 'slash'], dualblades: [null, 'dual'], fang: ['牙', 'reap'],
  };
  for (const [key, [glyph, kind]] of Object.entries(SPEC2)) {
    const wi = { motionSeq: 0 };
    const res = { kind, compound: key === 'dualblades', shape: 'blade', stats: { range: 100, arc: 1.8, size: 1, rate: 1.5 }, tail: glyph, elementInfo: { color: '#d4a94e' } };
    const m = startWeaponMotion(wi, res, 0.3, { interval: 10 });
    if (m.key !== key) { out++; console.log(`    ${key} を作ったつもりが ${m.key}`); continue; }
    let prevR = -1, grew = true;
    for (let i = 0; i <= 30; i++) {
      m.elapsed = (i / 30) * m.duration;
      const pose = motionPose(m);
      const geo = crescentGeom(m, pose);
      checked++;
      // 中心 + 半径が間合いを超えない (見えた三日月 = 当たる範囲の内側)。
      if (geo.d + geo.R > m.reach + 1e-6) out++;
      // 先端の角度 (回転込み) が扇の外へ出ない。
      const tip = Math.abs(geo.rot)
        + Math.atan2(geo.R * Math.sin(geo.span / 2), geo.d + geo.R * Math.cos(geo.span / 2));
      if (tip > m.arc / 2 + 1e-6) out++;
      if (![geo.d, geo.R, geo.span, geo.thick, geo.rot].every(finite)) out++;
      if (pose.fly > 0.3 && geo.thick <= 0) thin++;
      if (key === 'sword') { if (geo.R < prevR - 1e-9) grew = false; prevR = geo.R; }
    }
    if (key === 'sword') ok(grew, '刃の三日月が飛ぶほど大きくならない');
  }
  ok(out === 0, `三日月が扇・間合いの外へ出た/壊れた ${out}`);
  ok(thin === 0, `三日月の厚みが消える ${thin}`);
  // 武器ごとの個性: 刀は幅広で扁平、剣は細く、牙は小さい。
  ok(WEAPON_MOTIONS.tachi.cres.len > WEAPON_MOTIONS.sword.cres.len
    && WEAPON_MOTIONS.tachi.cres.thick < WEAPON_MOTIONS.sword.cres.thick,
    '刀の三日月が幅広・扁平でない');
  ok(WEAPON_MOTIONS.longsword.cres.thick < WEAPON_MOTIONS.sword.cres.thick,
    '剣の三日月が細くない');
  ok(WEAPON_MOTIONS.fang.cres.len < WEAPON_MOTIONS.sword.cres.len, '牙の三日月が小さくない');
  console.log(`  ${checked} 時点で三日月は扇と間合いの内側 / 刀=幅広扁平 剣=細 牙=小`);
}

console.log(`\n---- 合格 ${pass} / 不合格 ${fail} ----`);
process.exit(fail ? 1 : 0);
