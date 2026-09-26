// ============================================================================
// ワードローグ — 画面描画 (Canvas 2D)
//
// 外部画像ファイルを一切使わない。全部その場で描く。
// ============================================================================

import { TAU, clamp, lerp } from '../core/util.js';
import { ELEMENTS } from '../data/words.js';

export class Renderer {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.dpr = 1;
    this.w = 0;
    this.h = 0;
    this.camX = 0;
    this.camY = 0;
    this.resize();
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.cv.clientWidth || window.innerWidth;
    const h = this.cv.clientHeight || window.innerHeight;
    this.dpr = dpr;
    this.w = w;
    this.h = h;
    this.cv.width = Math.round(w * dpr);
    this.cv.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** 画面中心から端までの距離。湧き位置の計算に使う。 */
  get viewR() { return Math.hypot(this.w, this.h) / 2; }

  begin() {
    const g = this.ctx;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
  }

  /**
   * 1 フレーム分を描く。
   * @param {object} run
   * @param {object} stick タッチスティックの表示状態
   */
  draw(run, stick) {
    const g = this.ctx;
    this.begin();

    // カメラ (画面シェイク込み)。
    const p = run.player;
    let sx = 0, sy = 0;
    if (run.shakeAmt > 0) {
      const s = run.shakeAmt;
      sx = (Math.random() - 0.5) * s;
      sy = (Math.random() - 0.5) * s;
    }
    this.camX = p.x - this.w / 2 + sx;
    this.camY = p.y - this.h / 2 + sy;

    g.save();
    g.translate(-this.camX, -this.camY);

    this.drawGround(run);
    this.drawCorpses(run);
    this.drawFields(run);
    this.drawPickups(run);
    this.drawSlashes(run);
    this.drawRings(run);
    this.drawLightnings(run);
    this.drawEnemies(run);
    this.drawBullets(run);
    this.drawPlayer(run);
    this.drawLightnings(run);
    this.drawDamageTexts(run);

    g.restore();

    this.drawVignette(run);
    this.drawStickUI(stick);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 背景
  // ───────────────────────────────────────────────────────────────────────────
  drawGround(run) {
    const g = this.ctx;
    const st = run.stage;

    g.fillStyle = st.ground;
    g.fillRect(this.camX, this.camY, this.w, this.h);

    // グリッド (視点を基準に等間隔で描いてスクロール感を出す)。
    const size = 96;
    const ox = ((this.camX % size) + size) % size;
    const oy = ((this.camY % size) + size) % size;
    g.strokeStyle = 'rgba(255,255,255,.045)';
    g.lineWidth = 1;
    g.beginPath();
    for (let x = ox; x < this.w; x += size) { g.moveTo(x, 0); g.lineTo(x, this.h); }
    for (let y = oy; y < this.h; y += size) { g.moveTo(0, y); g.lineTo(this.w, y); }
    g.stroke();

    // ステージアクセントの淡い光。
    const rg = g.createRadialGradient(
      this.camX + this.w / 2, this.camY + this.h / 2, 0,
      this.camX + this.w / 2, this.camY + this.h / 2, this.viewR,
    );
    rg.addColorStop(0, 'rgba(0,0,0,0)');
    rg.addColorStop(1, 'rgba(0,0,0,.42)');
    g.fillStyle = rg;
    g.fillRect(this.camX, this.camY, this.w, this.h);
  }

  drawVignette(run) {
    const g = this.ctx;
    // 残り時間の少なさで赤く染める。
    const left = run.stage.time - run.time;
    const danger = run.stage.boss ? (run.boss ? 1 : 0) : clamp(1 - left / 20, 0, 1);
    if (danger > 0.02) {
      const rg = g.createRadialGradient(
        this.w / 2, this.h / 2, Math.min(this.w, this.h) * 0.3,
        this.w / 2, this.h / 2, this.viewR,
      );
      rg.addColorStop(0, 'rgba(255,40,60,0)');
      rg.addColorStop(1, `rgba(255,40,60,${0.3 * danger})`);
      g.fillStyle = rg;
      g.fillRect(0, 0, this.w, this.h);
    }
    if (run.boss && run.boss.hp / run.boss.maxHp < 0.999) {
      const hp = run.boss.hp / run.boss.maxHp;
      g.fillStyle = 'rgba(220,40,60,.85)';
      g.fillRect(0, 0, this.w * hp, 4);
      g.fillStyle = 'rgba(0,0,0,.35)';
      g.fillRect(this.w * hp, 0, this.w * (1 - hp), 4);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 個体
  // ───────────────────────────────────────────────────────────────────────────
  drawCorpses(run) {
    const g = this.ctx;
    for (const c of run.corpses) {
      const a = (c.life / c.maxLife) * 0.6;
      g.globalAlpha = a;
      g.fillStyle = c.color;
      g.beginPath();
      g.arc(c.x, c.y, c.r * (1 + (1 - c.life / c.maxLife) * 0.8), 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;
  }

  drawFields(run) {
    const g = this.ctx;
    for (const f of run.fields) {
      const t = f.life / f.maxLife;
      const a = t * 0.34;
      g.globalAlpha = a;
      const rg = g.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r);
      rg.addColorStop(0, f.color);
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = rg;
      g.beginPath();
      g.arc(f.x, f.y, f.r, 0, TAU);
      g.fill();

      g.globalAlpha = t * 0.7;
      g.strokeStyle = f.color;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(f.x, f.y, f.r * (1 - t * 0.25), 0, TAU);
      g.stroke();
    }
    g.globalAlpha = 1;
  }

  drawPickups(run) {
    const g = this.ctx;
    for (const q of run.pickups) {
      const bob = Math.sin(q.t * 6) * 2;
      const fade = q.life < 3 ? (Math.floor(q.life * 8) % 2 ? 0.3 : 1) : 1;
      g.globalAlpha = fade;
      g.fillStyle = q.type === 'heal' ? '#7dff9b' : '#ffd43b';
      g.beginPath();
      g.arc(q.x, q.y + bob, q.r, 0, TAU);
      g.fill();
      g.globalAlpha = fade * 0.35;
      g.beginPath();
      g.arc(q.x, q.y + bob, q.r * 2.2, 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;
  }

  drawSlashes(run) {
    const g = this.ctx;
    for (const s of run.slashes) {
      const t = s.life / s.maxLife;
      g.save();
      g.globalAlpha = t * 0.5;
      g.fillStyle = s.color;
      g.beginPath();
      g.moveTo(s.x, s.y);
      g.arc(s.x, s.y, s.r * (1.05 - t * 0.12), s.a - s.arc / 2, s.a + s.arc / 2);
      g.closePath();
      g.fill();
      g.restore();
    }
  }

  drawRings(run) {
    const g = this.ctx;
    for (const s of run.rings) {
      const t = s.life / s.maxLife;
      g.save();
      g.globalAlpha = t * 0.42;
      g.strokeStyle = s.color;
      g.lineWidth = 7 * t + 1;
      g.beginPath();
      g.arc(s.x, s.y, s.r * (1.02 - t * 0.1), 0, TAU);
      g.stroke();
      g.restore();
    }
  }

  drawEnemies(run) {
    const g = this.ctx;
    for (const e of run.enemies) {
      if (e.spawned < 1) continue;
      const a = (e.alpha ?? 1) * clamp(e.spawned, 0, 1);
      g.globalAlpha = a;

      const col = e.flash > 0.05 ? '#ffffff' : e.def.color;
      g.fillStyle = col;
      g.save();
      g.translate(e.x, e.y);

      switch (e.def.ai) {
        case 'shooter':
          g.rotate(e.face);
          g.beginPath();
          g.moveTo(e.r * 1.3, 0);
          g.lineTo(-e.r, -e.r * 0.9);
          g.lineTo(-e.r, e.r * 0.9);
          g.closePath();
          g.fill();
          break;
        case 'charger':
        case 'boss':
          g.rotate(e.face);
          polyPath(g, 6, e.r, e.r * 0.78);
          g.fill();
          break;
        case 'wraith':
        case 'ghost':
          g.rotate(e.face + Math.PI / 2);
          g.beginPath();
          g.moveTo(0, -e.r * 1.5);
          g.lineTo(e.r, 0);
          g.lineTo(0, e.r * 1.1);
          g.lineTo(-e.r, 0);
          g.closePath();
          g.fill();
          break;
        default: {
          const sq = e.def.wobble ? 1 + Math.sin(e.wob) * 0.09 : 1;
          g.beginPath();
          g.arc(0, 0, e.r * sq, 0, TAU);
          g.fill();
        }
      }
      g.restore();

      // ヨコの点滅。
      g.globalAlpha = 1;
      g.fillStyle = '#fff';
      g.beginPath();
      g.arc(e.x - e.r * 0.3, e.y - e.r * 0.3, Math.max(1.2, e.r * 0.18), 0, TAU);
      g.fill();

      // 状態異常のマーク。
      const marks = [];
      if (e.burn > 0) marks.push(['#ff7a2f', e.burnT]);
      if (e.poison > 0) marks.push(['#9dff5c', e.poisonT]);
      if (e.chill > 0) marks.push(['#7ad7ff', e.chillT]);
      if (e.freeze > 0) marks.push(['#c8f0ff', 1]);
      if (e.stun > 0) marks.push(['#ffe14d', 1]);
      for (let i = 0; i < marks.length; i++) {
        const [c, t] = marks[i];
        g.globalAlpha = 0.35 + 0.5 * Math.abs(Math.sin(e.t * 8 + i));
        g.fillStyle = c;
        g.beginPath();
        g.arc(e.x - e.r + i * 6, e.y - e.r - 7, 2.4, 0, TAU);
        g.fill();
        void t;
      }
      g.globalAlpha = 1;

      // ボス HP バー。
      if (e.boss) {
        const w = e.r * 2.2;
        g.fillStyle = 'rgba(0,0,0,.6)';
        g.fillRect(e.x - w / 2, e.y - e.r - 14, w, 4);
        g.fillStyle = '#ff4d6d';
        g.fillRect(e.x - w / 2, e.y - e.r - 14, w * clamp(e.hp / e.maxHp, 0, 1), 4);
      }
    }
    g.globalAlpha = 1;
  }

  drawBullets(run) {
    const g = this.ctx;
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const b of run.bullets) {
      const c = b.color || '#fff';
      const r = Math.max(2, b.r);

      if (b.kindName === 'orbit') {
        g.save();
        g.translate(b.x, b.y);
        g.rotate(b.spin);
        g.fillStyle = c;
        g.globalAlpha = 0.95;
        g.beginPath();
        g.moveTo(r, 0);
        g.lineTo(0, r * 0.45);
        g.lineTo(-r, 0);
        g.lineTo(0, -r * 0.45);
        g.closePath();
        g.fill();
        g.restore();
        continue;
      }

      g.globalAlpha = 0.35;
      g.fillStyle = c;
      g.beginPath();
      g.arc(b.x, b.y, r * 2.1, 0, TAU);
      g.fill();

      g.globalAlpha = 1;
      g.beginPath();
      g.arc(b.x, b.y, r, 0, TAU);
      g.fill();

      // 進行方向に伸ばす。
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > 20 && b.kindName !== 'bomb') {
        g.globalAlpha = 0.5;
        g.strokeStyle = c;
        g.lineWidth = r * 1.1;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(b.x, b.y);
        g.lineTo(b.x - (b.vx / sp) * r * 3.4, b.y - (b.vy / sp) * r * 3.4);
        g.stroke();
      }
    }
    g.restore();
  }

  drawPlayer(run) {
    const g = this.ctx;
    const p = run.player;

    // 吸収シールド。
    if (p.shield > 0) {
      g.save();
      g.globalAlpha = 0.28 + 0.12 * Math.sin(run.t * 4);
      g.strokeStyle = '#8ce9ff';
      g.lineWidth = 2.5;
      g.beginPath();
      g.arc(p.x, p.y, p.r + 8, 0, TAU);
      g.stroke();
      g.restore();
    }

    const blink = p.invuln > 0 && Math.floor(p.invuln * 18) % 2 === 0;
    g.save();
    g.globalAlpha = blink ? 0.4 : 1;
    g.translate(p.x, p.y);
    g.rotate(p.face);

    // 白い体。進行方向のトゲと瞳で向きを示す。
    g.fillStyle = p.flash > 0.05 ? '#fff' : '#f2f6ff';
    g.beginPath();
    g.arc(0, 0, p.r, 0, TAU);
    g.fill();

    // 進行方向のトゲ。
    g.fillStyle = '#ffd43b';
    g.beginPath();
    g.moveTo(p.r * 1.5, 0);
    g.lineTo(p.r * 0.4, -p.r * 0.62);
    g.lineTo(p.r * 0.4, p.r * 0.62);
    g.closePath();
    g.fill();

    // 視線。
    g.fillStyle = '#1a2030';
    g.beginPath();
    g.arc(p.r * 0.45, 0, p.r * 0.24, 0, TAU);
    g.fill();
    g.restore();
    g.globalAlpha = 1;
  }

  drawLightnings(run) {
    const g = this.ctx;
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.lineCap = 'round';
    for (const l of run.lightnings) {
      const t = l.life / l.maxLife;
      const c = l.color || '#c8f0ff';
      g.globalAlpha = t;
      g.strokeStyle = c;
      g.lineWidth = 4 * t + 1;
      g.beginPath();
      g.moveTo(l.x1, l.y1);
      // ジグザグ。
      const seg = 5;
      const dx = (l.x2 - l.x1) / seg, dy = (l.y2 - l.y1) / seg;
      const nx = -dy, ny = dx;
      for (let i = 1; i < seg; i++) {
        const j = (Math.random() - 0.5) * 16;
        g.lineTo(l.x1 + dx * i + (nx / seg) * j, l.y1 + dy * i + (ny / seg) * j);
      }
      g.lineTo(l.x2, l.y2);
      g.stroke();
    }
    g.restore();
  }

  /** 光線。敵より後ろに描きたいので個別に呼ぶ。 */
  drawBeams(run) {
    const g = this.ctx;
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.lineCap = 'round';
    for (const b of run.beams) {
      const t = b.life / b.maxLife;
      g.globalAlpha = t * 0.85;
      g.strokeStyle = '#fff6c9';
      g.lineWidth = b.w * t;
      g.beginPath();
      g.moveTo(b.x, b.y);
      g.lineTo(b.x + Math.cos(b.a) * b.len, b.y + Math.sin(b.a) * b.len);
      g.stroke();
    }
    g.restore();
  }

  drawDamageTexts(run) {
    const g = this.ctx;
    g.save();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const t of run.dmgTexts) {
      const a = clamp(t.life / t.maxLife, 0, 1);
      g.globalAlpha = a;
      g.font = `700 ${t.crit ? 19 : 13}px system-ui, sans-serif`;
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(0,0,0,.75)';
      g.strokeText(String(t.v), t.x, t.y);
      g.fillStyle = t.crit ? '#ffd43b' : '#fff';
      g.fillText(String(t.v), t.x, t.y);
    }
    g.restore();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // タッチスティック
  // ───────────────────────────────────────────────────────────────────────────
  drawStickUI(stick) {
    if (!stick || !stick.active) return;
    const g = this.ctx;
    g.save();
    g.globalAlpha = 0.32;
    g.strokeStyle = '#fff';
    g.lineWidth = 2.5;
    g.beginPath();
    g.arc(stick.ox, stick.oy, 56, 0, TAU);
    g.stroke();

    g.globalAlpha = 0.5;
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(stick.ox + stick.dx * 56, stick.oy + stick.dy * 56, 20, 0, TAU);
    g.fill();
    g.restore();
  }
}

function polyPath(g, n, r, ri) {
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const a2 = ((i + 0.5) / n) * TAU;
    g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    g.lineTo(Math.cos(a2) * ri, Math.sin(a2) * ri);
  }
  g.closePath();
}

export { polyPath, ELEMENTS, lerp };
