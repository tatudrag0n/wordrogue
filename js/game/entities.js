// ============================================================================
// ワードローグ — 実体 (敵・弾・ピックアップ・フィールド)
//
// すべて平坦なオブジェクト。配列から swap-remove で取り除く。
// ============================================================================

import { TAU, clamp, dist2, angleDiff } from '../core/util.js';
import { ENEMIES, enemyWords, enemySentence } from '../data/enemies.js';
import { ELEMENTS } from '../data/words.js';

let eUid = 0;

export function makeEnemy(id, x, y, hpScale = 1, dmgScale = 1, rnd = Math.random) {
  const d = ENEMIES[id];
  return {
    kind: 'enemy',
    uid: ++eUid,
    id, def: d,
    x, y, vx: 0, vy: 0,
    r: d.r,
    hp: d.hp * hpScale,
    maxHp: d.hp * hpScale,
    dmg: d.dmg * dmgScale,
    speed: d.speed,
    xp: d.xp,
    boss: !!d.boss,
    alpha: d.alpha ?? 1,
    // 状態異常
    burn: 0, burnT: 0,
    poison: 0, poisonT: 0,
    chill: 0, chillT: 0,
    freeze: 0,
    stun: 0,
    // 描画
    face: 0, wob: rnd() * TAU, flash: 0,
    // 敵が持つ文。プレイヤーの文から語を斬り落とす。
    words: enemyWords(d),
    broken: false,
    cutFlash: 0,
    // AI
    t: rnd() * 2,
    atkCd: 0, charging: 0, cdLeft: (d.charge?.cd || 2) * rnd(),
    phase: rnd() * TAU,
    dead: false,
    spawned: 0,
  };
}

/**
 * 敵の文を現在まで評価した結果。語の表は変わらないので lazy に計算。
 * @param {object} e 敵
 */
export function enemyEval(e) {
  if (!e._sent) e._sent = enemySentence(e.def, e.words);
  return e._sent;
}

/**
 * 敵の文から語を斬る。前から取る (文が崩れていく)。
 * 実質語が 2 つを下回ると崩れる。
 * @param {object} e 敵
 * @param {number} n 斬る語数
 * @returns {{cut:number, broken:boolean, text:string}}
 */
export function cutEnemyWords(e, n) {
  if (!e.words || e.broken || n <= 0) return { cut: 0, broken: !!e.broken, text: '' };
  let cut = 0;
  for (let k = 0; k < n && e.words.length > 1; k++) {
    e.words.pop();
    cut++;
    // 崩れるまで斬る。崩れたところで止める。
    if (!enemySentence(e.def, e.words).valid) break;
  }
  e._sent = null;
  const r = enemyEval(e);
  if (!r.valid && !e.broken) {
    e.broken = true;
    e.cutFlash = 1;
  }
  return { cut, broken: e.broken, text: e.words.join('') };
}

export function makeBullet(o) {
  return {
    kind: 'bullet',
    uid: ++eUid,
    x: 0, y: 0, px: 0, py: 0,
    vx: 0, vy: 0,
    r: 5,
    dmg: 0,
    crit: false,
    pierce: 0,
    hitIds: null,        // 後から Set を作るため null 起点
    life: 3,
    size: 1,
    element: 'none',
    owner: 'player',
    explode: 0,
    burn: 0, poison: 0, chill: 0, shock: 0, freeze: 0,
    knock: 0,
    split: 0, splitDmg: 0,
    bounce: 0, bounceLeft: 0,
    homing: 0,
    homingTarget: null,
    orbit: null,          // 軌道: {a, r, w}
    spin: 0,
    kindName: 'shot',
    range: 0, traveled: 0,
    originX: 0, originY: 0,
    color: '#fff',
    boomerang: false,
    dead: false,
    ...o,
  };
}

/** 軌道弾も通常弾と同じ当たり判定を使う。 */
export function ensureHitSet(b) {
  if (!b.hitIds) b.hitIds = new Set();
  return b.hitIds;
}

export function makePickup(x, y, kind, value) {
  return {
    kind: 'pickup',
    uid: ++eUid,
    x, y, r: 7,
    type: kind,      // 'xp' | 'heal' | 'magnet' | 'shield' | 'coin'
    value: value || 1,
    t: 0,
    // 経験値は life を 0 にして切らない。拾えなかった分が消えるのはきつい。
    life: kind === 'xp' ? 0 : 30,
    vx: (Math.random() - 0.5) * 90,
    vy: (Math.random() - 0.5) * 90,
    pulling: 0,      // 1 なら吸引中 (描画で光らせる)
    dead: false,
  };
}

/** 爆発などの即是フィールド。 */
export function makeField(x, y, r, dmg, opts = {}) {
  return {
    kind: 'field',
    uid: ++eUid,
    x, y, r,
    dmg,
    life: opts.life ?? 0.3,
    maxLife: opts.life ?? 0.3,
    element: opts.element || 'none',
    burn: opts.burn || 0,
    poison: opts.poison || 0,
    chill: opts.chill || 0,
    shock: opts.shock || 0,
    freeze: opts.freeze || 0,
    knock: opts.knock || 0,
    hitIds: new Set(),
    color: (ELEMENTS[opts.element] || ELEMENTS.none).color,
    dead: false,
  };
}

/** 画面内の矩形に対するリング状の当たり判定。 */
export function hitsField(en, f) {
  const dx = en.x - f.x, dy = en.y - f.y;
  const rr = f.r + en.r;
  return dx * dx + dy * dy <= rr * rr;
}

export function hitsEnemy(en, b) {
  const rr = b.r + en.r;
  return dist2(en.x, en.y, b.x, b.y) <= rr * rr;
}

// ─────────────────────────────────────────────────────────────────────────────
// 敵の更新
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {object} en
 * @param {object} w ワールド {t, player}
 * @param {number} dt
 */
export function updateEnemy(en, w, dt) {
  const p = w.player;
  en.t += dt;
  en.wob += dt * 6;
  if (en.flash > 0) en.flash = Math.max(0, en.flash - dt * 4);
  if (en.cutFlash > 0) en.cutFlash = Math.max(0, en.cutFlash - dt * 2.2);

  // 状態異常を 時間経過させる。
  tickStatus(en, dt);

  let dx = p.x - en.x, dy = p.y - en.y;
  const d = Math.hypot(dx, dy) || 1;
  dx /= d; dy /= d;

  let mvx = 0, mvy = 0;
  const slow = en.chill > 0 ? (1 - clamp(en.chill, 0, 0.85)) : 1;
  const frozen = en.freeze > 0 || en.stun > 0;
  if (en.freeze > 0) en.freeze = Math.max(0, en.freeze - dt);
  if (en.stun > 0) en.stun = Math.max(0, en.stun - dt);

  const sp = en.speed * slow * (frozen ? 0 : 1);
  const ai = en.def.ai;

  if (!frozen) {
    // 文が崩れた敵は動けない。 palabra のない体は威胁にならない。
    if (en.broken) {
      mvx = 0; mvy = 0;
    } else {
    switch (ai) {
      case 'erratic': {
        const s = Math.sin(en.t * 4 + en.wob * 0.1) * 0.55;
        mvx = dx + (-dy) * s;
        mvy = dy + dx * s;
        break;
      }
      case 'swarm': {
        mvx = dx * 1.15 + Math.sin(en.t * 7 + en.phase) * 0.3;
        mvy = dy * 1.15 + Math.cos(en.t * 7 + en.phase) * 0.3;
        break;
      }
      case 'charger': {
        if (en.charging > 0) {
          en.charging -= dt;
          mvx = Math.cos(en.face); mvy = Math.sin(en.face);
        } else {
          en.cdLeft -= dt;
          const cfg = en.def.charge;
          if (d < cfg.range && d > 40 && en.cdLeft <= 0) {
            en.charging = cfg.time;
            en.cdLeft = cfg.cd;
            en.face = Math.atan2(dy, dx);
          } else {
            mvx = dx; mvy = dy;
          }
        }
        break;
      }
      case 'orbiter': {
        const o = en.def.orbit;
        const ang = Math.atan2(dy, dx) + o.w * dt;
        const tx = p.x - Math.cos(ang) * o.r;
        const ty = p.y - Math.sin(ang) * o.r;
        mvx = (tx - en.x) / dt * 0.02;
        mvy = (ty - en.y) / dt * 0.02;
        const l = Math.hypot(mvx, mvy) || 1;
        mvx /= l; mvy /= l;
        break;
      }
      case 'shooter': {
        const keep = en.def.keep;
        if (d > keep + 30) { mvx = dx; mvy = dy; }
        else if (d < keep - 30) { mvx = -dx; mvy = -dy; }
        else { mvx = -dy * 0.5; mvy = dx * 0.5; }
        break;
      }
      case 'boss':
        bossMove(en, w, dt, dx, dy, d);
        break;
      default:
        mvx = dx; mvy = dy;
    }
    }
  }

  const l = Math.hypot(mvx, mvy);
  if (l > 0.001) {
    mvx /= l; mvy /= l;
    en.x += mvx * sp * dt;
    en.y += mvy * sp * dt;
    en.face = Math.atan2(mvy, mvx);
  }

  if (ai === 'shooter' && !frozen) {
    en.atkCd -= dt;
    if (en.atkCd <= 0 && d < 420) {
      en.atkCd = en.def.shot.cd;
      w.spawnEnemyShot?.(en.x, en.y, Math.atan2(dy, dx), en.def.shot);
    }
  }
}

function tickStatus(en, dt) {
  if (en.burnT > 0) {
    en.burnT -= dt;
    en.hp -= en.burn * dt * 3.2;
    if (en.burnT <= 0) en.burn = 0;
  }
  if (en.poisonT > 0) {
    en.poisonT -= dt;
    en.hp -= en.poison * dt * 2.4;
    if (en.poisonT <= 0) en.poison = 0;
  }
  if (en.chillT > 0) {
    en.chillT -= dt;
    if (en.chillT <= 0) en.chill = 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ボスの行動
// ─────────────────────────────────────────────────────────────────────────────

function bossMove(en, w, dt, dx, dy, d) {
  const p = w.player;
  en.atkCd -= dt;
  const phase = en.hp / en.maxHp;
  en.face = Math.atan2(dy, dx);

  if (en.charging > 0) {
    en.charging -= dt;
    en.x += Math.cos(en.face) * en.speed * 3.4 * dt;
    en.y += Math.sin(en.face) * en.speed * 3.4 * dt;
    return;
  }
  if (en.ring > 0) {
    en.ring -= dt;
    en.x += Math.cos(en.face) * en.speed * 0.25 * dt;
    en.y += Math.sin(en.face) * en.speed * 0.25 * dt;
    return;
  }

  if (en.atkCd <= 0) {
    // 文が崩れていれば攻撃パターンを封じられる。ただし動くし接触ダメージも残る。
    if (en.broken) {
      en.atkCd = 1.2;
      en.x += dx * en.speed * 0.6 * dt;
      en.y += dy * en.speed * 0.6 * dt;
      return;
    }
    const pats = en.def.patterns;
    const pat = pats[en.patIdx % pats.length];
    en.patIdx = (en.patIdx || 0) + 1;
    // 体力が減るほど攻撃間隔が短くなる。
    en.atkCd = (en.def.atkGap || 2.1) * (0.5 + phase * 0.6);

    switch (pat) {
      case 'charge':
        en.charging = 0.75;
        break;
      case 'ring':
        en.ring = 1.1;
        w.bossRing?.(en);
        break;
      case 'breath':
        w.bossBreath?.(en);
        break;
      case 'summon':
        w.bossSummon?.(en);
        break;
      case 'slam':
        w.bossSlam?.(en);
        break;
      case 'drain':
        w.bossDrain?.(en);
        break;
    }
    return;
  }

  // 通常移動。距離に応じて回り込む。
  const want = en.def.arena ? en.def.arena * 0.6 : 200;
  if (d > want) { en.x += dx * en.speed * dt; en.y += dy * en.speed * dt; }
  else { en.x -= dx * en.speed * 0.4 * dt; en.y -= dy * en.speed * 0.4 * dt; }
  en.x += -dy * Math.sin(w.t * 0.8) * en.speed * 0.4 * dt;
  en.y += dx * Math.sin(w.t * 0.8) * en.speed * 0.4 * dt;
}

// ─────────────────────────────────────────────────────────────────────────────
// 弾の更新
// ─────────────────────────────────────────────────────────────────────────────

export function updateBullet(b, w, dt) {
  b.life -= dt;
  if (b.life <= 0) { b.dead = true; return; }

  if (b.orbit) {
    // プレイヤー身边を回る。
    const o = b.orbit;
    o.a += o.w * dt;
    const tx = w.player.x + Math.cos(o.a) * o.r;
    const ty = w.player.y + Math.sin(o.a) * o.r;
    b.px = b.x; b.py = b.y;
    b.x = tx; b.y = ty;
    b.spin += dt * 10;
    b.traveled += Math.hypot(b.x - b.px, b.y - b.py);
    return;
  }

  if (b.boomerang) {
    const p = w.player;
    const d = Math.hypot(b.x - p.x, b.y - p.y);
    b.t += 0;
    if (b.ret) {
      b.x += (p.x - b.x) * Math.min(1, dt * 9);
      b.y += (p.y - b.y) * Math.min(1, dt * 9);
      if (d < 22) b.dead = true;
    }
  } else if (b.homing > 0) {
    const tgt = pickTarget(b, w);
    if (tgt) {
      const want = Math.atan2(tgt.y - b.y, tgt.x - b.x);
      const cur = Math.atan2(b.vy, b.vx);
      const na = cur + clamp(angleDiff(cur, want), -b.homing * 5.2 * dt, b.homing * 5.2 * dt);
      const sp = Math.hypot(b.vx, b.vy) || 1;
      b.vx = Math.cos(na) * sp;
      b.vy = Math.sin(na) * sp;
    }
  }

  b.px = b.x; b.py = b.y;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.spin += (b.vx + b.vy) * 0.0008 + dt;
  b.traveled += Math.hypot(b.x - b.px, b.y - b.py);

  if (b.boomerang && !b.ret && b.traveled > (b.range || 240)) b.ret = true;

  if (b.range && b.traveled > b.range && !b.orbit) b.dead = true;
}

/** 追尾の標的を選ぶ。 */
function pickTarget(b, w) {
  if (b.homingTarget && !b.homingTarget.dead) return b.homingTarget;
  let best = null, bd = Infinity;
  for (const e of w.enemies) {
    if (e.dead) continue;
    const d2 = dist2(e.x, e.y, b.x, b.y);
    if (d2 < bd) { bd = d2; best = e; }
  }
  b.homingTarget = best;
  return best;
}

export { angleDiff, TAU };
