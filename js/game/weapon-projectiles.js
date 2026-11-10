import { makeBullet } from './entities.js';

export const PROJECTILE_PROFILES = Object.freeze({
  刃: { visual: 'slash-wave', radius: 19, travel: 2.8, speed: 0.85, pierce: 1 },
  剣: { visual: 'slash-wave', radius: 22, travel: 2.8, speed: 0.85, pierce: 1 },
  刀: { visual: 'slash-wave', radius: 30, travel: 2.8, speed: 0.72, pierce: 2 },
  斧: { visual: 'thrown-axe', radius: 16, travel: 2.4, speed: 0.65, pierce: 2 },
  槌: { visual: 'thrown-hammer', radius: 18, travel: 2.4, speed: 0.60, pierce: 1 },
  鋸: { visual: 'thrown-saw', radius: 18, travel: 2.6, speed: 0.72, pierce: 3 },
});

export function projectileProfile(wi, res) {
  if (!res.active || res.special || (res.kind || wi.def.kind) !== 'slash') return null;
  if (res.evalResult?.compounds?.some(c => c.source === '双剣')) return null;
  return PROJECTILE_PROFILES[res.tail || wi.def.tail] || null;
}

export function fireWeaponProjectile(run, wi, res, aim, el, elInfo) {
  const profile = projectileProfile(wi, res);
  if (!profile) return false;
  const st = res.stats, p = run.player;
  const size = (st.size || 1) * (p.stats?.size || 1);
  const count = Math.max(1, Math.min(6, Math.round(st.count || 1)));
  const fan = count === 1 ? 0 : Math.min(Math.PI, Math.max(st.spread || 0, 0.20 * (count - 1)));
  const speed = Math.max(260, (st.speed || 850) * profile.speed);
  const travel = Math.max(260, (st.range || 100) * profile.travel) * size;
  const radius = (profile.radius + Math.max(0, st.area || 0) * 0.10) * size;
  for (let i = 0; i < count; i++) {
    const a = aim + (count === 1 ? 0 : (i / (count - 1) - 0.5) * fan);
    const x = p.x + Math.cos(a) * 14, y = p.y + Math.sin(a) * 14;
    const snapshot = { ...st, wid: wi.def.id, wname: wi.def.name };
    run.bullets.push(makeBullet({
      x, y, px: x, py: y, originX: x, originY: y,
      vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
      r: radius, size, dmg: snapshot.dmg,
      life: travel / speed + 0.15, range: travel,
      pierce: Math.max(profile.pierce, st.pierce || 0),
      explode: st.explode || 0, burn: st.burn || 0, poison: st.poison || 0,
      chill: st.chill || 0, shock: st.shock || 0, freeze: st.freeze || 0,
      knock: st.knock || 0, split: st.split || 0, splitDmg: st.dmg,
      bounce: st.bounce || 0, bounceLeft: st.bounce || 0, homing: st.homing || 0,
      element: el, color: elInfo.color, shape: 'blade', kindName: 'shot',
      weaponVisual: profile.visual, st: snapshot, wi,
    }));
  }
  if (profile.visual === 'slash-wave') run.audio.slash?.();
  else run.audio.shoot?.();
  run.shake?.(1.4);
  return true;
}

export function drawWeaponProjectile(g, b) {
  if (!b.weaponVisual) return false;
  g.save();
  try {
    g.translate(b.x, b.y);
    g.rotate(Math.atan2(b.vy, b.vx));
    g.strokeStyle = b.color || '#445566';
    g.fillStyle = b.color || '#445566';
    g.lineWidth = Math.max(2, b.r * 0.16);
    if (b.weaponVisual === 'slash-wave') {
      g.beginPath();
      g.arc(-b.r * 0.15, 0, b.r * 0.85, -1.25, 1.25);
      g.stroke();
      g.strokeStyle = '#fffdf7';
      g.lineWidth = Math.max(1, b.r * 0.07);
      g.beginPath();
      g.arc(-b.r * 0.15, 0, b.r * 0.72, -1.16, 1.16);
      g.stroke();
    } else {
      g.rotate((b.traveled || 0) * 0.035);
      const r = b.r;
      g.strokeStyle = '#43352b';
      g.lineWidth = Math.max(2, r * 0.17);
      g.beginPath(); g.moveTo(-r * 0.72, 0); g.lineTo(r * 0.60, 0); g.stroke();
      g.strokeStyle = '#26313d';
      g.lineWidth = Math.max(1, r * 0.08);
      g.beginPath();
      if (b.weaponVisual === 'thrown-axe') {
        g.moveTo(r * 0.12, -r * 0.35); g.lineTo(r * 0.58, -r * 0.75);
        g.lineTo(r * 0.76, r * 0.18); g.lineTo(r * 0.20, r * 0.40);
      } else if (b.weaponVisual === 'thrown-hammer') {
        g.rect(r * 0.10, -r * 0.65, r * 0.55, r * 1.30);
      } else {
        for (let i = 0; i < 24; i++) {
          const a = i * Math.PI / 12, rr = r * (i % 2 ? 0.70 : 0.95);
          const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
          if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
      }
      g.closePath(); g.fill(); g.stroke();
    }
  } finally { g.restore(); }
  return true;
}
