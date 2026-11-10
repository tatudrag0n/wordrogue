import assert from 'node:assert/strict';
import test from 'node:test';
import { PROJECTILE_PROFILES, projectileProfile, fireWeaponProjectile, drawWeaponProjectile } from '../js/game/weapon-projectiles.js';
import { updateBullet, hitsEnemy } from '../js/game/entities.js';

const wi = { def: { id: 'longsword', name: '剣', kind: 'slash', tail: '剣' } };
const resOf = (tail = '剣', extra = {}) => ({ active: true, kind: 'slash', tail, stats: { dmg: 11, speed: 850, size: 1, range: 106, count: 1, ...extra } });
const runOf = () => ({ player: { x: 100, y: 200, stats: { size: 1 } }, bullets: [], enemies: [], audio: { slash() {}, shoot() {} }, shake() {} });
function fire(res = resOf(), weapon = wi) {
  const run = runOf();
  const handled = fireWeaponProjectile(run, weapon, res, 0, 'fire', { color: '#c1432b' });
  return { run, handled, b: run.bullets[0] };
}

for (const [tail, profile] of Object.entries(PROJECTILE_PROFILES)) {
  test(`${tail}: projectile generation and fan`, () => {
    const res = resOf(tail, { count: 3 });
    const { run, handled } = fire(res);
    assert.equal(handled, true);
    assert.equal(run.bullets.length, 3);
    assert.equal(new Set(run.bullets.map(b => b.vy)).size, 3);
    assert.ok(run.bullets[0].vy < 0 && run.bullets[2].vy > 0);
    assert.equal(run.bullets[1].vy, 0);
    for (const b of run.bullets) {
      assert.equal(b.weaponVisual, profile.visual);
      assert.equal(b.px, b.x); assert.equal(b.py, b.y);
      assert.ok(b.range >= 260 && b.life > 0 && b.r > 0);
      assert.equal(b.dmg, 11);
      assert.equal(b.pierce, profile.pierce);
    }
  });
}

test('excluded weapons and inactive sentences do not fire', () => {
  const cases = ['爪', '拳', '牙', '鋏'].map(t => resOf(t));
  cases.push({ ...resOf(), active: false }, { ...resOf(), special: true },
    { ...resOf(), kind: 'shot' }, { ...resOf(), kind: 'dual' },
    { ...resOf(), evalResult: { compounds: [{ source: '双剣' }] } });
  for (const res of cases) {
    assert.equal(projectileProfile(wi, res), null);
    const { run, handled } = fire(res);
    assert.equal(handled, false); assert.equal(run.bullets.length, 0);
  }
});

test('count is rounded, bounded, and does not mutate stats', () => {
  for (const [count, expected] of [[0, 1], [-2, 1], [2.6, 3], [99, 6]]) {
    const res = resOf('剣', { count });
    const before = structuredClone(res);
    assert.equal(fire(res).run.bullets.length, expected);
    assert.deepEqual(res, before);
  }
});

test('effects and source attribution are snapshotted', () => {
  const fx = { burn: 2, poison: 3, chill: 0.2, shock: 0.3, freeze: 0.1, knock: 90, explode: 30, split: 2, bounce: 3, homing: 0.4, pierce: 9, crit: 0.5, critDmg: 2 };
  const res = resOf('斧', { ...fx, count: 2 });
  const { run, b } = fire(res);
  for (const [key, value] of Object.entries(fx)) {
    assert.equal(b.st[key], value);
    if (!['crit', 'critDmg'].includes(key)) assert.equal(b[key], value);
  }
  assert.equal(b.element, 'fire'); assert.equal(b.color, '#c1432b');
  assert.equal(b.st.wid, wi.def.id); assert.equal(b.st.wname, wi.def.name);
  assert.equal(b.splitDmg, 11); assert.equal(b.bounceLeft, 3);
  assert.notEqual(b.st, res.stats); assert.notEqual(b.st, run.bullets[1].st);
  res.stats.dmg = 999; assert.equal(b.st.dmg, 11);
});

test('size, area, speed and spread affect projectiles', () => {
  const base = fire().b;
  const bigger = fire(resOf('剣', { size: 2, area: 20 })).b;
  assert.ok(bigger.r > base.r && bigger.range > base.range);
  assert.ok(fire(resOf('剣', { speed: 1700 })).b.vx > base.vx);
  const run = runOf(); run.player.stats.size = 2;
  fireWeaponProjectile(run, wi, resOf(), 0, 'none', { color: '#456789' });
  assert.equal(run.bullets[0].r, base.r * 2);
  const spread = fire(resOf('剣', { count: 3, spread: 1 })).run.bullets;
  assert.ok(Math.abs(Math.atan2(spread[0].vy, spread[0].vx) + 0.5) < 1e-9);
});

test('movement, swept collision and range expiry', () => {
  const { run, b } = fire(); const x = b.x;
  updateBullet(b, run, 0.1);
  assert.ok(b.x > x);
  assert.equal(hitsEnemy({ x: (x + b.x) / 2, y: b.y, r: 4 }, b), true);
  assert.equal(hitsEnemy({ x: b.x, y: b.y + 200, r: 4 }, b), false);
  b.life = 10;
  for (let i = 0; i < 200 && !b.dead; i++) updateBullet(b, run, 0.01);
  assert.equal(b.dead, true); assert.ok(b.traveled > b.range);
  const expired = fire(); expired.b.life = 0.001;
  updateBullet(expired.b, expired.run, 0.01); assert.equal(expired.b.dead, true);
});

test('form weapon source is preserved', () => {
  for (const tail of ['剣', '斧']) {
    const weapon = { def: { id: `form:${tail}`, name: tail, tail, kind: 'slash' } };
    const { b, handled } = fire(resOf(tail), weapon);
    assert.equal(handled, true); assert.equal(b.st.wid, `form:${tail}`);
  }
});

function canvasStub(throws = false) {
  const state = { depth: 0, calls: 0 };
  const g = { save() { state.depth++; }, restore() { state.depth--; } };
  for (const name of ['translate', 'rotate', 'beginPath', 'arc', 'stroke', 'moveTo', 'lineTo', 'rect', 'closePath', 'fill']) {
    g[name] = (...args) => {
      assert.ok(args.every(Number.isFinite), `${name}: nonfinite argument`);
      state.calls++; if (throws && name === 'arc') throw new Error('canvas failure');
    };
  }
  return { g, state };
}

test('all custom visuals draw finite geometry and restore canvas', () => {
  const visuals = new Set();
  for (const tail of Object.keys(PROJECTILE_PROFILES)) {
    const { b } = fire(resOf(tail)); b.traveled = 123;
    const { g, state } = canvasStub();
    assert.equal(drawWeaponProjectile(g, b), true);
    assert.equal(state.depth, 0); assert.ok(state.calls > 0);
    visuals.add(b.weaponVisual);
  }
  assert.equal(visuals.size, 4);
  assert.equal(drawWeaponProjectile({}, { kindName: 'shot' }), false);
});

test('canvas state is restored even if drawing throws', () => {
  const { g, state } = canvasStub(true);
  assert.throws(() => drawWeaponProjectile(g, fire().b), /canvas failure/);
  assert.equal(state.depth, 0);
});
