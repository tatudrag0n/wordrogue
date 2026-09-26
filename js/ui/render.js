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

  /**
   * 斬撃。薄い扇形の塗りではなく、刃が走过った軌跡として見せる。
   * 内側ほど濃く、先端に明るい縁を乗せる。
   */
  drawSlashes(run) {
    const g = this.ctx;
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const s of run.slashes) {
      const t = s.life / s.maxLife;
      const a0 = s.a - s.arc / 2;
      const a1 = s.a + s.arc / 2;
      // 広がる軌跡。外周到内に向けて濃くする。
      const rOut = s.r * (1.12 - t * 0.14);
      const rIn = s.r * (0.3 + (1 - t) * 0.14);
      const steps = 4;
      for (let i = 0; i < steps; i++) {
        const f = i / steps;
        const rr = rIn + (rOut - rIn) * f;
        g.globalAlpha = t * (0.30 - f * 0.19);
        g.fillStyle = s.color;
        g.beginPath();
        g.moveTo(s.x, s.y);
        g.arc(s.x, s.y, rr, a0, a1);
        g.closePath();
        g.fill();
      }
      // 刃先の明るい縁。
      g.globalAlpha = t * t * 0.95;
      g.strokeStyle = '#ffffff';
      g.lineWidth = 2.4;
      g.beginPath();
      g.arc(s.x, s.y, rOut * 0.99, a0, a1);
      g.stroke();
      g.globalAlpha = t * 0.6;
      g.strokeStyle = s.color;
      g.lineWidth = 4.5;
      g.beginPath();
      g.arc(s.x, s.y, rOut * 0.97, a0, a1);
      g.stroke();
    }
    g.restore();
  }

  drawRings(run) {
    const g = this.ctx;
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const s of run.rings) {
      const t = s.life / s.maxLife;
      g.globalAlpha = t * 0.5;
      g.strokeStyle = s.color;
      g.lineWidth = 9 * t + 1.5;
      g.beginPath();
      g.arc(s.x, s.y, s.r * (1.04 - t * 0.12), 0, TAU);
      g.stroke();
      g.globalAlpha = t * t * 0.8;
      g.strokeStyle = '#ffffff';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(s.x, s.y, s.r * (1.04 - t * 0.12), 0, TAU);
      g.stroke();
    }
    g.restore();
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
    // 弾が多いときは細部を落として矩形描画にフォールバックする。
    const detail = run.bullets.length <= 150;
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const b of run.bullets) {
      if (b.kindName === 'orbit') {
        g.save();
        g.translate(b.x, b.y);
        g.rotate(b.spin);
        g.fillStyle = b.color || '#fff';
        g.globalAlpha = 0.95;
        const r = Math.max(2, b.r);
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
      this.drawProjectile(g, b, run.t, detail);
    }
    g.restore();
  }

  /**
   * 弾を 1 発描く。属性と形状で絵柄を変える。
   * 貫通する数だけ尾が伸び、拡散は扇状に並ぶ。
   */

  drawProjectile(g, b, t, detail) {
    const c = b.color || '#ffffff';
    const el = b.element || 'none';
    const r = Math.max(2, b.r);
    const sp = Math.hypot(b.vx, b.vy);
    const ang = sp > 1 ? Math.atan2(b.vy, b.vx) : 0;
    const shape = b.shape || (b.kindName === 'bomb' ? 'bomb' : 'shot');
    const pierce = b.pierce > 0 ? b.pierce : 0;

    // ── 尾。速度と尾の長さは貫通の数と形とで変わる。
    //    炎と雷は尾を長めに敷く。扇状に広がったときの一体感が出る。
    if (sp > 20 && b.kindName !== 'bomb') {
      const wild = (el === 'fire' || el === 'thunder') ? 1.9
        : (el === 'poison' || el === 'blood' || el === 'nature') ? 1.3 : 1;
      const len = r * (shape === 'arrow' ? 7 : 3.4) * wild
        * (1 + pierce * 0.4) * (1 + (b.size - 1) * 0.5);
      g.save();
      g.translate(b.x, b.y);
      g.rotate(ang);
      g.globalAlpha = 0.5;
      g.fillStyle = c;
      g.beginPath();
      g.moveTo(r * 0.8, 0);
      g.lineTo(0, -r * 0.95);
      g.lineTo(-len, 0);
      g.lineTo(0, r * 0.95);
      g.closePath();
      g.fill();
      g.globalAlpha = 0.22;
      g.beginPath();
      g.moveTo(r * 0.6, 0);
      g.lineTo(0, -r * 1.7);
      g.lineTo(-len * 1.25, 0);
      g.lineTo(0, r * 1.7);
      g.closePath();
      g.fill();
      g.restore();
    }

    // ── 頭部。形状で絵を替える。──
    g.save();
    g.translate(b.x, b.y);
    g.rotate(ang);

    if (shape === 'arrow') {
      // 矢。細長く、先に返しがある。白い芯は小さくして属性の色を残す。
      const L = r * 3.6, W = r * 0.95;
      // 外側のglow。
      g.globalAlpha = 0.3;
      g.fillStyle = c;
      g.beginPath();
      g.moveTo(L * 1.5, 0);
      g.lineTo(-L * 0.9, -W * 2.1);
      g.lineTo(-L * 1.25, 0);
      g.lineTo(-L * 0.9, W * 2.1);
      g.closePath();
      g.fill();
      // 弾体。
      g.globalAlpha = 1;
      g.beginPath();
      g.moveTo(L, 0);
      g.lineTo(L * 0.15, -W);
      g.lineTo(-L * 0.75, -W * 0.42);
      g.lineTo(-L * 0.95, 0);
      g.lineTo(-L * 0.75, W * 0.42);
      g.lineTo(L * 0.15, W);
      g.closePath();
      g.fill();
      // 芯。属性の色が失われすぎないように、先端だけを白くする。
      g.globalAlpha = 0.75;
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.moveTo(L * 0.95, 0);
      g.lineTo(L * 0.3, -W * 0.42);
      g.lineTo(L * 0.2, 0);
      g.lineTo(L * 0.3, W * 0.42);
      g.closePath();
      g.fill();
    } else if (shape === 'blade') {
      const L = r * 2.8, W = r * 0.6;
      g.globalAlpha = 1;
      g.fillStyle = c;
      g.beginPath();
      g.moveTo(L, 0);
      g.lineTo(0, -W);
      g.lineTo(-L, 0);
      g.lineTo(0, W);
      g.closePath();
      g.fill();
    } else if (shape === 'orb') {
      g.globalAlpha = 0.5;
      g.fillStyle = c;
      g.beginPath();
      g.arc(0, 0, r * 1.9, 0, TAU);
      g.fill();
      g.globalAlpha = 1;
      g.beginPath();
      g.arc(0, 0, r, 0, TAU);
      g.fill();
      g.globalAlpha = 0.85;
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(-r * 0.25, -r * 0.25, r * 0.42, 0, TAU);
      g.fill();
    } else if (shape === 'bomb') {
      // 爆弾。暗い球と導火線の火花。
      g.globalAlpha = 0.4;
      g.fillStyle = c;
      g.beginPath();
      g.arc(0, 0, r * 2, 0, TAU);
      g.fill();
      g.globalAlpha = 1;
      g.fillStyle = '#2a2028';
      g.beginPath();
      g.arc(0, 0, r, 0, TAU);
      g.fill();
      g.globalAlpha = 0.95;
      g.fillStyle = c;
      g.beginPath();
      g.arc(0, -r * 1.5, r * 0.42, 0, TAU);
      g.fill();
    } else {
      // 弾。進行方向に少し伸ばしたカプセル。
      const L = r * 1.7;
      g.globalAlpha = 0.4;
      g.fillStyle = c;
      g.beginPath();
      g.ellipse(0, 0, L * 1.5, r * 1.9, 0, 0, TAU);
      g.fill();
      g.globalAlpha = 1;
      g.beginPath();
      g.ellipse(0, 0, L, r, 0, 0, TAU);
      g.fill();
      if (detail) {
        // 芯は小さく。属性の色が残るようにする。
        g.globalAlpha = 0.55;
        g.fillStyle = '#ffffff';
        g.beginPath();
        g.ellipse(L * 0.25, 0, r * 0.5, r * 0.44, 0, 0, TAU);
        g.fill();
      }
    }
    g.restore();

    if (!detail) return;

    // ── 属性ごとの効果。炎の舌・氷片・稲光など。──
    g.save();
    g.globalAlpha = 0.9;
    g.strokeStyle = c;
    g.lineCap = 'round';
    switch (el) {
      case 'fire': {
        // 炎。 进行方向の後ろで 3 本の舌が揺れる。
        g.fillStyle = c;
        for (let i = 0; i < 3; i++) {
          const w = 0.9 + Math.sin(t * 22 + i * 2.1 + b.uid) * 0.35;
          const d = r * (1.5 + i * 1.15);
          g.globalAlpha = 0.5 - i * 0.13;
          g.beginPath();
          g.moveTo(b.x + Math.cos(ang) * r * 0.4, b.y + Math.sin(ang) * r * 0.4);
          g.lineTo(b.x - Math.cos(ang) * d + Math.cos(ang + 1.57) * r * w,
                   b.y - Math.sin(ang) * d + Math.sin(ang + 1.57) * r * w);
          g.lineTo(b.x - Math.cos(ang) * d * 1.25, b.y - Math.sin(ang) * d * 1.25);
          g.lineTo(b.x - Math.cos(ang) * d - Math.cos(ang + 1.57) * r * w,
                   b.y - Math.sin(ang) * d - Math.sin(ang + 1.57) * r * w);
          g.closePath();
          g.fill();
        }
        break;
      }
      case 'ice': {
        g.lineWidth = 1.6;
        for (let i = 0; i < 2; i++) {
          const a = ang + 1.57 + (i ? 0.5 : -0.5);
          const d = r * 1.5;
          g.globalAlpha = 0.7;
          g.beginPath();
          g.moveTo(b.x - Math.cos(ang) * r, b.y - Math.sin(ang) * r);
          g.lineTo(b.x - Math.cos(ang) * d + Math.cos(a) * r * 1.1,
                   b.y - Math.sin(ang) * d + Math.sin(a) * r * 1.1);
          g.stroke();
        }
        break;
      }
      case 'thunder': {
        g.lineWidth = 1.4;
        g.globalAlpha = 0.85;
        g.beginPath();
        g.moveTo(b.x - Math.cos(ang) * r * 1.2, b.y - Math.sin(ang) * r * 1.2);
        const j = (n) => (Math.sin(t * 40 + b.uid * 1.7 + n) * 0.5) * r * 0.9;
        g.lineTo(b.x - Math.cos(ang) * r * 2.4 + j(0), b.y - Math.sin(ang) * r * 2.4 + j(1));
        g.lineTo(b.x - Math.cos(ang) * r * 3.6 + j(2), b.y - Math.sin(ang) * r * 3.6 + j(3));
        g.stroke();
        break;
      }
      case 'poison': {
        g.fillStyle = c;
        g.globalAlpha = 0.5;
        g.beginPath();
        g.arc(b.x - Math.cos(ang) * r * 1.8, b.y - Math.sin(ang) * r * 1.8 + r * 0.4,
              r * 0.5 + Math.sin(t * 9) * r * 0.12, 0, TAU);
        g.fill();
        break;
      }
      case 'light': {
        g.globalAlpha = 0.4;
        g.beginPath();
        g.arc(b.x, b.y, r * 2.4, 0, TAU);
        g.stroke();
        break;
      }
      case 'dark': {
        g.globalAlpha = 0.5;
        g.fillStyle = c;
        g.beginPath();
        g.ellipse(b.x - Math.cos(ang) * r * 1.6, b.y - Math.sin(ang) * r * 1.6,
                  r * 1.5, r * 0.85, ang, 0, TAU);
        g.fill();
        break;
      }
      case 'wind': {
        g.lineWidth = 1.3;
        g.globalAlpha = 0.6;
        for (let i = 0; i < 2; i++) {
          const a = ang + (i ? 0.9 : -0.9);
          g.beginPath();
          g.arc(b.x, b.y, r * (1.6 + i * 0.5), a, a + 1.1);
          g.stroke();
        }
        break;
      }
      case 'water': {
        g.fillStyle = c;
        g.globalAlpha = 0.45;
        g.beginPath();
        g.arc(b.x - Math.cos(ang) * r * 1.5, b.y - Math.sin(ang) * r * 1.5,
              r * 0.45, 0, TAU);
        g.fill();
        break;
      }
      case 'blood': {
        g.fillStyle = c;
        g.globalAlpha = 0.5;
        g.beginPath();
        g.moveTo(b.x, b.y);
        g.lineTo(b.x - Math.cos(ang) * r * 2.2 + Math.cos(ang + 1.57) * r,
                 b.y - Math.sin(ang) * r * 2.2 + Math.sin(ang + 1.57) * r);
        g.lineTo(b.x - Math.cos(ang) * r * 2.6, b.y - Math.sin(ang) * r * 2.6);
        g.lineTo(b.x - Math.cos(ang) * r * 2.2 - Math.cos(ang + 1.57) * r,
                 b.y - Math.sin(ang) * r * 2.2 - Math.sin(ang + 1.57) * r);
        g.closePath();
        g.fill();
        break;
      }
      case 'nature': {
        g.fillStyle = c;
        g.globalAlpha = 0.55;
        g.save();
        g.translate(b.x - Math.cos(ang) * r * 1.6, b.y - Math.sin(ang) * r * 1.6);
        g.rotate(ang + Math.sin(t * 7) * 0.5);
        g.beginPath();
        g.ellipse(0, 0, r * 1.1, r * 0.45, 0, 0, TAU);
        g.fill();
        g.restore();
        break;
      }
      case 'earth':
      case 'gold':
      case 'steel': {
        g.lineWidth = 1.2;
        g.globalAlpha = 0.55;
        g.beginPath();
        g.moveTo(b.x - Math.cos(ang) * r * 1.2, b.y - Math.sin(ang) * r * 1.2);
        g.lineTo(b.x - Math.cos(ang) * r * 2.2 + j0(t, b.uid),
                 b.y - Math.sin(ang) * r * 2.2 + j0(t, b.uid + 1));
        g.stroke();
        break;
      }
      default:
        break;
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
