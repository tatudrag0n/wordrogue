// ============================================================================
// ワードローグ — 画面描画 (Canvas 2D)
//
// 外部画像ファイルを一切使わない。全部その場で描く。
// ============================================================================

import { TAU, clamp, lerp, dist2 } from '../core/util.js';
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
   * 個別のエフェクトで例外が出ても、描画全体が止まってプレイヤーが
   * 消えないように 1 段ずつ try で包む。
   * @param {object} run
   * @param {object} stick タッチスティックの表示状態
   */
  draw(run, stick) {
    const g = this.ctx;

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

    this.begin();
    g.save();
    g.translate(-this.camX, -this.camY);

    this.step('ground', () => this.drawGround(run));
    this.step('decals', () => this.drawDecals(run));
    this.step('corpses', () => this.drawCorpses(run));
    this.step('fields', () => this.drawFields(run));
    this.step('pickups', () => this.drawPickups(run));
    this.step('slashes', () => this.drawSlashes(run));
    this.step('rings', () => this.drawRings(run));
    this.step('particles', () => this.drawParticles(run));
    this.step('boss-burst', () => this.drawBossBursts(run));
    this.step('beams', () => this.drawBeams(run));
    this.step('enemies', () => this.drawEnemies(run));
    this.step('bullets', () => this.drawBullets(run));
    this.step('player', () => this.drawPlayer(run));
    this.step('weapon-spirits', () => this.drawWeaponSpirits(run));
    this.step('lightnings', () => this.drawLightnings(run));
    this.step('texts', () => this.drawDamageTexts(run));

    g.restore();

    this.step('grain', () => this.drawGrain(run));
    this.step('vignette', () => this.drawVignette(run));
    this.step('motes', () => this.drawMotes(run));
    this.step('stick', () => this.drawStickUI(stick));
  }

  /**
   * 描画を 1 段進める。例外は記録するだけで致命的にしない。
   * ここで握り潰さないと、1 つのエフェクトの記述ミスで
   * 後ろの drawPlayer まで実行されずプレイヤーが消える。
   */
  step(name, fn) {
    try {
      fn();
    } catch (err) {
      if (!this._drawErrors) this._drawErrors = new Map();
      const n = (this._drawErrors.get(name) || 0) + 1;
      this._drawErrors.set(name, n);
      if (n === 1 && typeof console !== 'undefined') {
        console.error('[render] ' + name + ' の描画に失敗:', err);
      }
      // 状態を戻しておかないと以降の描画が全部濁る。
      this.ctx.globalAlpha = 1;
      this.ctx.globalCompositeOperation = 'source-over';
    }
  }

  /** 描画に失敗した回数。テストから監視する。 */
  get drawErrorCount() {
    let n = 0;
    if (this._drawErrors) for (const v of this._drawErrors.values()) n += v;
    return n;
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
    g.strokeStyle = 'rgba(70, 55, 30, .055)';
    g.lineWidth = 1;
    g.beginPath();
    for (let x = ox; x < this.w; x += size) { g.moveTo(x, 0); g.lineTo(x, this.h); }
    for (let y = oy; y < this.h; y += size) { g.moveTo(0, y); g.lineTo(this.w, y); }
    g.stroke();

    // 和紙の染み。視点に合わせたタイルから選ぶので、スクロールしても
    // 同じ場所に留まる。地面の色を少しだけ濁らせる。
    const tile = 620;
    const x0 = Math.floor(this.camX / tile) * tile;
    const y0 = Math.floor(this.camY / tile) * tile;
    const nx = Math.ceil(this.w / tile) + 1;
    const ny = Math.ceil(this.h / tile) + 1;
    for (let ix = 0; ix <= nx; ix++) {
      for (let iy = 0; iy <= ny; iy++) {
        const cellX = x0 / tile + ix;
        const cellY = y0 / tile + iy;
        const seed = st.id * 19.7 + cellX * 7.13 + cellY * 3.71;
        for (let k = 0; k < 2; k++) {
          const pick = hash01(seed + k * 5.3);
          if (pick > 0.7) continue;
          const x = x0 + ix * tile + hash01(seed + k * 9.1) * tile;
          const y = y0 + iy * tile + hash01(seed + k * 13.7) * tile;
          const r = 24 + hash01(seed + k * 17.3) * 58;
          g.save();
          g.translate(x, y);
          g.rotate(hash01(seed + k * 23.9) * TAU);
          g.globalAlpha = 0.03 + hash01(seed + k * 29.1) * 0.045;
          g.fillStyle = st.accent || '#3f6b3a';
          g.beginPath();
          g.ellipse(0, 0, r, r * (0.4 + hash01(seed + k * 31.7) * 0.32), 0, 0, TAU);
          g.fill();
          // 跳ねた墨の粒をひとつ。染みの縁を不揃いにする。
          g.beginPath();
          g.arc(r * (0.62 + pick * 0.5), -r * 0.24, Math.max(1, r * 0.09), 0, TAU);
          g.fill();
          g.restore();
        }
      }
    }

    // 紙の端がわずかに焼ける。暗闇ではなく「遠くが少し沈む」程度に。
    const rg = g.createRadialGradient(
      this.camX + this.w / 2, this.camY + this.h / 2, 0,
      this.camX + this.w / 2, this.camY + this.h / 2, this.viewR,
    );
    rg.addColorStop(0, 'rgba(255, 253, 246, .34)');
    rg.addColorStop(0.55, 'rgba(255, 253, 246, 0)');
    rg.addColorStop(1, 'rgba(88, 68, 38, .16)');
    g.fillStyle = rg;
    g.fillRect(this.camX, this.camY, this.w, this.h);
  }

  // 画面手前を漂う魔力の粒子。固定シードで配置し、時間だけで動かすため
  // フレームごとの乱数ちらつきや追加のゲーム状態を発生させない。
  drawMotes(run) {
    const g = this.ctx;
    const count = Math.min(34, Math.floor((this.w * this.h) / 38000));
    for (let i = 0; i < count; i++) {
      const seed = i * 127.1 + 41.7;
      const x0 = ((Math.sin(seed) * 43758.5) % 1 + 1) % 1;
      const y0 = ((Math.sin(seed * 2.3) * 17631.2) % 1 + 1) % 1;
      const phase = seed % TAU;
      const x = (x0 * this.w + Math.sin(run.t * 0.42 + phase) * 18 + this.w) % this.w;
      const y = (y0 * this.h - run.t * (8 + i % 7) + this.h * 4) % this.h;
      const pulse = 0.3 + (Math.sin(run.t * 2.1 + phase) + 1) * 0.28;
      const r = 1 + (i % 3) * 0.55;
      g.save();
      g.globalAlpha = pulse;
      g.fillStyle = run.boss ? '#f0a34b' : '#d4a94e';
      g.shadowColor = g.fillStyle;
      g.shadowBlur = 9;
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.fill();
      g.restore();
    }
  }

  drawVignette(run) {
    const g = this.ctx;
    const p = run.player;
    // 残り時間の少なさで赤く染める。
    const left = run.stage.time - run.time;
    const danger = run.stage.boss ? (run.boss ? 1 : 0) : clamp(1 - left / 20, 0, 1);
    // 体力が減るほど、鼓動のように赤い縁が脈打つ。
    const low = p.maxHp > 0 ? clamp(1 - p.hp / p.maxHp, 0, 1) : 0;
    const beat = 0.55 + 0.45 * Math.sin(run.t * 5.4);
    const lowGlow = low > 0.55 ? (low - 0.55) / 0.45 * (0.5 + beat * 0.5) : 0;
    // 被弾した瞬間は画面全体をうっすら朱に寄せる。
    const hurt = clamp(p.flash || 0, 0, 1);
    const red = Math.max(danger, lowGlow, hurt * 0.85);

    if (red > 0.02) {
      const rg = g.createRadialGradient(
        this.w / 2, this.h / 2, Math.min(this.w, this.h) * 0.28,
        this.w / 2, this.h / 2, this.viewR,
      );
      rg.addColorStop(0, 'rgba(184,51,43,0)');
      rg.addColorStop(0.72, `rgba(184,51,43,${0.05 * red})`);
      rg.addColorStop(1, `rgba(184,51,43,${0.34 * red})`);
      g.fillStyle = rg;
      g.fillRect(0, 0, this.w, this.h);
    }
    if (hurt > 0.04) {
      g.fillStyle = `rgba(196,64,45,${0.075 * hurt})`;
      g.fillRect(0, 0, this.w, this.h);
    }

    if (run.boss && run.boss.hp / run.boss.maxHp < 0.999) {
      const hp = run.boss.hp / run.boss.maxHp;
      g.fillStyle = 'rgba(184,51,43,.9)';
      g.fillRect(0, 0, this.w * hp, 4);
      g.fillStyle = 'rgba(74,56,28,.18)';
      g.fillRect(this.w * hp, 0, this.w * (1 - hp), 4);
    }
  }

  /**
   * 画面全体に薄い紙の繊維を乗せる。ワールド座標ではなく画面に固定するので、
   * スクロールしてもチラつかない。乱数は使わず、同じ繊維を毎フレーム描く。
   */
  drawGrain(run) {
    const g = this.ctx;
    const w = this.w, h = this.h;
    if (!(w > 0 && h > 0)) return;
    g.save();
    g.globalAlpha = 0.032;
    g.strokeStyle = '#4a3b22';
    g.lineWidth = 1;
    const n = Math.min(150, Math.floor((w * h) / 9000));
    for (let i = 0; i < n; i++) {
      const x = hash01(i * 1.37 + 0.3) * w;
      const y = hash01(i * 2.71 + 1.7) * h;
      const len = 4 + hash01(i * 3.19 + 0.9) * 15;
      const a = hash01(i * 4.7 + 2.1) * TAU;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
      g.stroke();
    }
    g.globalAlpha = 0.045;
    g.fillStyle = '#7a5c2e';
    for (let i = 0; i < 36; i++) {
      const x = hash01(i * 5.13 + 4.1) * w;
      const y = hash01(i * 6.31 + 0.7) * h;
      const r = 0.4 + hash01(i * 7.19) * 0.9;
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.fill();
    }
    g.restore();
    void run;
  }


  // ───────────────────────────────────────────────────────────────────────────
  // 個体
  // ───────────────────────────────────────────────────────────────────────────
  /**
   * 地面に残る墨の染み。倒した敵の数だけ戦場に履歴が残る。
   * 紙の上に吸い込まれるように薄く広がり、時間で消える。
   */
  drawDecals(run) {
    const g = this.ctx;
    for (const d of run.decals || []) {
      const k = Math.max(0, d.life / d.maxLife);
      const born = 1 - k;                        // 0 = 出た瞬間, 1 = 消える
      const spread = 1 + born * 0.3;
      const a = Math.min(0.20, k * 0.22) * (d.boss ? 1.2 : 1);
      if (a <= 0.004) continue;
      const seed = (d.seed || 0) * 37 + d.x * 0.011 + d.y * 0.007;
      g.save();
      g.globalAlpha = a;
      g.fillStyle = d.color;
      g.beginPath();
      const lumps = 10;
      for (let i = 0; i <= lumps; i++) {
        const ang = (i / lumps) * TAU;
        const rr = d.r * spread * (0.72 + hash01(seed + i * 1.71) * 0.5);
        const x = d.x + Math.cos(ang) * rr;
        const y = d.y + Math.sin(ang) * rr * 0.82;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.closePath();
      g.fill();
      // 縁から飛んだ粒。
      g.globalAlpha = a * 0.75;
      for (let i = 0; i < 4; i++) {
        const ang = hash01(seed + i * 5.3) * TAU;
        const dist = d.r * (1.05 + hash01(seed + i * 9.7) * 0.8) * spread;
        g.beginPath();
        g.arc(d.x + Math.cos(ang) * dist, d.y + Math.sin(ang) * dist * 0.8,
          Math.max(0.8, d.r * (0.06 + hash01(seed + i * 3.1) * 0.08)), 0, TAU);
        g.fill();
      }
      // 出た直後だけ、縁が少し明るい。
      if (born < 0.18) {
        g.globalAlpha = (0.18 - born) * 0.5;
        g.strokeStyle = '#fffdf7';
        g.lineWidth = 1.2;
        g.beginPath();
        g.arc(d.x, d.y, d.r * spread * 0.82, 0, TAU);
        g.stroke();
      }
      g.restore();
    }
  }

  drawCorpses(run) {
    const g = this.ctx;
    for (const c of run.corpses) {
      const k = c.life / c.maxLife;
      const t = 1 - k;
      const spread = 1 + t * 0.85;
      g.globalAlpha = k * 0.55;
      g.fillStyle = c.color;
      // 円ではなく、縁の不揃いな墨の染みとして残す。
      g.beginPath();
      const lumps = 9;
      for (let i = 0; i <= lumps; i++) {
        const a = (i / lumps) * TAU;
        const rr = c.r * spread * (0.8 + hash01(c.x * 0.021 + c.y * 0.013 + i * 1.7) * 0.42);
        const x = c.x + Math.cos(a) * rr;
        const y = c.y + Math.sin(a) * rr;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.closePath();
      g.fill();
      // 飛び散った粒。
      g.globalAlpha = k * 0.42;
      for (let i = 0; i < 3; i++) {
        const a = hash01(c.x + c.y + i * 3.1) * TAU;
        const d = c.r * (1.1 + hash01(c.x + i * 7.7) * 0.9) * spread;
        g.beginPath();
        g.arc(c.x + Math.cos(a) * d, c.y + Math.sin(a) * d, Math.max(0.8, c.r * 0.14), 0, TAU);
        g.fill();
      }
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

      // 内側をゆっくり回る破線。ただの円ではなく「術の輪」に見せる。
      g.globalAlpha = t * 0.42;
      g.lineWidth = 1.4;
      g.setLineDash([Math.max(2, f.r * 0.09), Math.max(4, f.r * 0.13)]);
      g.lineDashOffset = (f.life || 0) * 40;
      g.beginPath();
      g.arc(f.x, f.y, f.r * (1 - t * 0.25) * 0.72, 0, TAU);
      g.stroke();
      g.setLineDash([]);
    }
    g.globalAlpha = 1;
  }

  drawPickups(run) {
    const g = this.ctx;
    for (const q of run.pickups) {
      const bob = Math.sin(q.t * 6) * 2;
      // life が 0 (消えないもの) は点滅させない。
      const fade = q.life > 0 && q.life < 3 ? (Math.floor(q.life * 8) % 2 ? 0.3 : 1) : 1;
      const y = q.y + bob;

      // 吸引中は軌道が読めるように尾を引く。
      if (q.pulling) {
        const sp = Math.hypot(q.vx, q.vy);
        g.globalAlpha = fade * 0.5;
        g.strokeStyle = q.type === 'heal' ? '#2f9e44' : '#d9a406';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(q.x, y);
        g.lineTo(q.x - (q.vx / (sp || 1)) * 16, y - (q.vy / (sp || 1)) * 16);
        g.stroke();
      }

      g.globalAlpha = fade;
      g.fillStyle = q.type === 'heal' ? '#2f9e44' : '#d9a406';
      g.beginPath();
      g.arc(q.x, y, q.r, 0, TAU);
      g.fill();
      // 紙の上なので縁を墨で締める (金色の粒が地と同化しない)。
      g.globalAlpha = fade * 0.75;
      g.lineWidth = 1.3;
      g.strokeStyle = 'rgba(28, 35, 49, .5)';
      g.stroke();
      g.globalAlpha = fade;
      g.globalAlpha = fade * 0.35;
      g.beginPath();
      g.arc(q.x, y, q.r * 2.2, 0, TAU);
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
    g.globalCompositeOperation = 'source-over';
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
        g.globalAlpha = t * (0.42 - f * 0.26);
        g.fillStyle = s.color;
        g.beginPath();
        g.moveTo(s.x, s.y);
        g.arc(s.x, s.y, rr, a0, a1);
        g.closePath();
        g.fill();
      }
      // 刃先の縁。紙なので白は飛ばない。墨で引いて形を立てる。
      g.globalAlpha = t * t * 0.8;
      g.strokeStyle = 'rgba(28, 35, 49, .62)';
      g.lineWidth = 1.6;
      g.beginPath();
      g.arc(s.x, s.y, rOut * 0.99, a0, a1);
      g.stroke();
      g.globalAlpha = t * 0.6;
      g.strokeStyle = s.color;
      g.lineWidth = 4.5;
      g.beginPath();
      g.arc(s.x, s.y, rOut * 0.97, a0, a1);
      g.stroke();
      // 内側の縁を墨で締める。白い紙の上で刃の厚みが出る。
      g.globalAlpha = t * t * 0.4;
      g.strokeStyle = 'rgba(28, 35, 49, .55)';
      g.lineWidth = 1.1;
      g.beginPath();
      g.arc(s.x, s.y, rIn, a0, a1);
      g.stroke();
    }
    g.restore();
  }

  drawRings(run) {
    const g = this.ctx;
    g.save();
    g.globalCompositeOperation = 'source-over';
    for (const s of run.rings) {
      const t = s.life / s.maxLife;
      // 紙の上では「抜印」のように、白い下地へ色を乗せる。
      g.globalAlpha = t * 0.85;
      g.strokeStyle = 'rgba(255, 253, 247, .9)';
      g.lineWidth = 9 * t + 6;
      g.beginPath();
      g.arc(s.x, s.y, s.r * (1.04 - t * 0.12), 0, TAU);
      g.stroke();
      g.globalAlpha = t * 0.72;
      g.strokeStyle = s.color;
      g.lineWidth = 9 * t + 1.5;
      g.beginPath();
      g.arc(s.x, s.y, s.r * (1.04 - t * 0.12), 0, TAU);
      g.stroke();
      g.globalAlpha = t * t * 0.7;
      g.strokeStyle = 'rgba(28, 35, 49, .45)';
      g.lineWidth = 1.6;
      g.beginPath();
      g.arc(s.x, s.y, s.r * (1.04 - t * 0.12), 0, TAU);
      g.stroke();

      // 外へ逃げる二重目の輪。破線を回して余韻を出す。
      if (t > 0.25) {
        g.globalAlpha = (t - 0.25) * 0.55;
        g.strokeStyle = s.color;
        g.lineWidth = 1.2;
        g.setLineDash([Math.max(2, s.r * 0.08), Math.max(3, s.r * 0.11)]);
        g.lineDashOffset = -s.life * 90;
        g.beginPath();
        g.arc(s.x, s.y, s.r * (1.04 - t * 0.12) * 0.82, 0, TAU);
        g.stroke();
        g.setLineDash([]);
      }
    }
    g.restore();
  }

  drawParticles(run) {
    const g = this.ctx;
    g.save();
    g.lineCap = 'round';
    for (const p of run.particles || []) {
      const t = clamp(p.life / (p.maxLife || 1), 0, 1);
      const r = Math.max(0.5, p.r * (0.6 + t * 0.4));
      const shape = p.shape || 'dot';
      const ang = Math.atan2(p.vy, p.vx);
      // 火花と粒は光として、墨・破片・葉は紙に乗った色として描く。
      g.globalCompositeOperation = (shape === 'spark' || shape === 'dot') ? 'lighter' : 'source-over';
      g.globalAlpha = t * 0.9;
      g.fillStyle = p.color;

      if (shape === 'spark') {
        const sp = Math.hypot(p.vx, p.vy);
        const len = clamp(sp * 0.045, 3, 24);
        g.strokeStyle = p.color;
        g.lineWidth = Math.max(1, r * 0.9);
        g.beginPath();
        g.moveTo(p.x, p.y);
        g.lineTo(p.x - Math.cos(ang) * len, p.y - Math.sin(ang) * len);
        g.stroke();
      } else if (shape === 'shard') {
        g.save();
        g.translate(p.x, p.y);
        g.rotate(ang + (p.life || 0) * 3);
        g.beginPath();
        g.moveTo(r * 1.7, 0);
        g.lineTo(-r, -r * 0.8);
        g.lineTo(-r * 0.35, 0);
        g.lineTo(-r, r * 0.8);
        g.closePath();
        g.fill();
        g.restore();
      } else if (shape === 'ink') {
        g.save();
        g.translate(p.x, p.y);
        g.rotate((p.rot || 0) + (p.life || 0) * 1.6);
        g.beginPath();
        g.ellipse(0, 0, r * 1.15, r * (0.5 + 0.3 * Math.abs(Math.sin(p.x * 0.05 + p.life * 9))), 0, 0, TAU);
        g.fill();
        g.restore();
      } else if (shape === 'leaf') {
        g.save();
        g.translate(p.x, p.y);
        g.rotate(ang + Math.sin((p.life || 0) * 6 + p.x * 0.02) * 0.7);
        g.beginPath();
        g.ellipse(0, 0, r * 1.5, r * 0.55, 0, 0, TAU);
        g.fill();
        g.restore();
      } else {
        g.beginPath();
        g.arc(p.x, p.y, r, 0, TAU);
        g.fill();
      }
    }
    g.restore();
  }

  drawBossBursts(run) {
    const g = this.ctx;
    for (const fx of run.bossBursts || []) {
      const t = 1 - fx.life / fx.maxLife;
      const radius = 28 + t * Math.max(this.w, this.h) * 0.72;
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = (1 - t) * 0.75;
      const glow = g.createRadialGradient(fx.x, fx.y, 0, fx.x, fx.y, radius);
      glow.addColorStop(0, 'rgba(255,250,222,.95)');
      glow.addColorStop(.12, fx.color);
      glow.addColorStop(.48, 'rgba(224,138,61,.35)');
      glow.addColorStop(1, 'rgba(224,138,61,0)');
      g.fillStyle = glow;
      g.beginPath(); g.arc(fx.x, fx.y, radius, 0, TAU); g.fill();
      g.globalAlpha = (1 - t) * .9;
      g.strokeStyle = '#ffe7a1';
      g.lineWidth = 8 * (1 - t) + 1;
      g.beginPath(); g.arc(fx.x, fx.y, 20 + t * radius * .72, 0, TAU); g.stroke();
      // 放射状の光条を一斉に走らせる。
      g.globalAlpha = (1 - t) * .7;
      g.strokeStyle = '#fff4cc'; g.lineWidth = 2;
      for (let i = 0; i < 20; i++) {
        const a = i * TAU / 20 + .12;
        const inner = 34 + t * radius * .35;
        const outer = inner + 18 + (i % 4) * 8;
        g.beginPath();
        g.moveTo(fx.x + Math.cos(a) * inner, fx.y + Math.sin(a) * inner);
        g.lineTo(fx.x + Math.cos(a) * outer, fx.y + Math.sin(a) * outer);
        g.stroke();
      }
      g.restore();
    }
  }

  drawEnemies(run) {
    const g = this.ctx;
    for (const e of run.enemies) {
      if (e.spawned < 1) continue;
      const a = (e.alpha ?? 1) * clamp(e.spawned, 0, 1) * (e.burrowed ? 0.25 : 1);
      g.globalAlpha = a;

      // 足元の影。紙の上に個体が「置かれている」ことを示す。
      g.fillStyle = 'rgba(28, 35, 49, .14)';
      g.beginPath();
      g.ellipse(e.x, e.y + e.r * 0.86, e.r * 0.95, e.r * 0.3, 0, 0, TAU);
      g.fill();

      // 出現中は外へ広がる破線の輪。湧いたことが一目で分かる。
      if (e.spawned < 1) {
        const st = clamp(e.spawned, 0, 1);
        g.globalAlpha = (1 - st) * 0.8;
        g.strokeStyle = e.def.color;
        g.lineWidth = 2;
        g.setLineDash([4, 5]);
        g.lineDashOffset = -run.t * 26;
        g.beginPath();
        g.arc(e.x, e.y, e.r * (1 + (1 - st) * 2.2), 0, TAU);
        g.stroke();
        g.setLineDash([]);
        g.globalAlpha = a;
      }

      // ボスは常に薄い金の環をまとう。
      if (e.boss) {
        const pulse = 0.5 + 0.5 * Math.sin(run.t * 2.6);
        g.globalAlpha = a * (0.16 + pulse * 0.1);
        g.strokeStyle = '#e0a23a';
        g.lineWidth = 2.5;
        g.beginPath();
        g.arc(e.x, e.y, e.r + 11 + pulse * 4, 0, TAU);
        g.stroke();
        g.globalAlpha = a;
      }

      const col = e.flash > 0.05 ? '#ffffff' : e.def.color;
      g.fillStyle = col;
      // 紙地に輪郭。塗りだけでは明るい地で溶ける。
      g.strokeStyle = 'rgba(28, 35, 49, .5)';
      g.lineWidth = 1.7;
      g.lineJoin = 'round';
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
          g.stroke();
          break;
        case 'charger':
        case 'boss':
          g.rotate(e.face);
          polyPath(g, 6, e.r, e.r * 0.78);
          g.fill();
          g.stroke();
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
          g.stroke();
          break;
        default: {
          const sq = e.def.wobble ? 1 + Math.sin(e.wob) * 0.09 : 1;
          g.beginPath();
          g.arc(0, 0, e.r * sq, 0, TAU);
          g.fill();
          g.stroke();
        }
      }
      g.restore();

      // ヨコの点滅 (紙だと白は消えるので墨のHighlightにする)。
      g.globalAlpha = 0.85;
      g.fillStyle = 'rgba(28, 35, 49, .72)';
      g.beginPath();
      g.arc(e.x - e.r * 0.3, e.y - e.r * 0.3, Math.max(1.2, e.r * 0.18), 0, TAU);
      g.fill();

      // 状態異常のマーク。
      const marks = [];
      if (e.burn > 0) marks.push(['#cf4a12', e.burnT]);
      if (e.poison > 0) marks.push(['#3f7d24', e.poisonT]);
      if (e.chill > 0) marks.push(['#1b6ca8', e.chillT]);
      if (e.freeze > 0) marks.push(['#155e94', 1]);
      if (e.stun > 0) marks.push(['#b8860b', 1]);
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
        g.fillStyle = 'rgba(74,56,28,.22)';
        g.fillRect(e.x - w / 2, e.y - e.r - 14, w, 4);
        g.fillStyle = '#b8332b';
        g.fillRect(e.x - w / 2, e.y - e.r - 14, w * clamp(e.hp / e.maxHp, 0, 1), 4);
      }

      this.drawEnemySentence(e, run);
    }
    g.globalAlpha = 1;
  }

  /**
   * 敵が持つ文を頭の上に描く。斬られるたびに短くなっていく。
   * 崩れた敵は「不成文」と出る。
   */
  drawEnemySentence(e, run) {
    if (!e.words || !e.words.length) return;
    // 近い敵とボスだけ描く。全部描くと画面が読めなくなる。
    // dist2 は二乗距離なので、しきい値も二乗で比べる。
    const near = dist2(e.x, e.y, run.player.x, run.player.y) <= 280 * 280;
    if (!near && !e.boss) return;

    const g = this.ctx;
    const text = e.words.join('');
    const size = e.boss ? 16 : 13;
    const font = (px) => `700 ${px}px "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif`;
    g.save();
    // canvas の font に var() は書けない。実体名を直接入れる。
    g.font = font(size);
    g.textAlign = 'center';
    g.textBaseline = 'bottom';
    const y = e.y - e.r - (e.boss ? 22 : 16);

    // 滲み。紙なので、文字のまわりを白く抜いてから墨で書く。
    g.lineWidth = 4.5;
    g.strokeStyle = 'rgba(255, 253, 247, .95)';
    g.lineJoin = 'round';
    g.strokeText(text, e.x, y);

    if (e.broken) {
      g.fillStyle = '#b8332b';
      g.fillText(text, e.x, y);
      g.font = font(size - 1);
      const tag = '不成文';
      const ty = y - size - 4;
      g.lineWidth = 3.5;
      g.strokeText(tag, e.x, ty);
      g.fillText(tag, e.x, ty);
    } else {
      // 斬った直後は黄色く光らせる。
      g.fillStyle = e.cutFlash > 0.02 ? '#c1432b' : '#1c2331';
      g.fillText(text, e.x, y);
    }
    g.restore();
  }

  drawBullets(run) {
    const g = this.ctx;
    // 弾が多いときは細部を落として矩形描画にフォールバックする。
    const detail = run.bullets.length <= 150;
    g.save();
    g.globalCompositeOperation = 'source-over';
    for (const b of run.bullets) {
      if (b.kindName === 'orbit') {
        g.save();
        g.translate(b.x, b.y);
        g.rotate(b.spin);
        g.fillStyle = b.color || '#6b7383';
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
    const c = b.color || '#6b7383';
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
        // 鉱物系。土埃や粉の軌跡を引く。
        const wig = (n) => Math.sin(t * 30 + b.uid * 1.3 + n) * 0.5 * r * 0.8;
        g.lineWidth = 1.2;
        g.globalAlpha = 0.55;
        g.beginPath();
        g.moveTo(b.x - Math.cos(ang) * r * 1.2, b.y - Math.sin(ang) * r * 1.2);
        g.lineTo(b.x - Math.cos(ang) * r * 2.2 + wig(0), b.y - Math.sin(ang) * r * 2.2 + wig(1));
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

    // 常時ゆっくり呼吸する護りの紋環。被弾・ダッシュ演出と重ねて自機を際立たせる。
    g.save();
    const pulse = 0.5 + 0.5 * Math.sin(run.t * 2.4);
    g.globalAlpha = 0.1 + pulse * 0.12;
    g.strokeStyle = run.boss ? '#d34b35' : '#d2a448';
    g.lineWidth = 1.2 + pulse * 1.2;
    g.setLineDash([3, 8]);
    g.lineDashOffset = -run.t * 16;
    g.beginPath();
    g.arc(p.x, p.y, p.r + 10 + pulse * 3, 0, TAU);
    g.stroke();
    g.setLineDash([]);
    g.restore();

    // ダッシュの残像。
    for (const t of p.dashTrail || []) {
      const a = (t.life / t.maxLife) * 0.42;
      if (a <= 0.01) continue;
      g.save();
      g.globalAlpha = a;
      g.translate(t.x, t.y);
      g.rotate(t.a);
      g.fillStyle = '#dd7322';
      g.beginPath();
      g.arc(0, 0, p.r * 0.95, 0, TAU);
      g.fill();
      g.restore();
    }

    // ダッシュ中の風切り線。進行方向の逆へ短い線を流す。
    if (p.dashing) {
      g.save();
      g.strokeStyle = '#c9862b';
      g.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        const a = p.face + Math.PI + (i - 1) * 0.34;
        const d = p.r + 6 + i * 3;
        const len = 10 + i * 4;
        g.globalAlpha = 0.26 - i * 0.05;
        g.lineWidth = 2 - i * 0.4;
        g.beginPath();
        g.moveTo(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d);
        g.lineTo(p.x + Math.cos(a) * (d + len), p.y + Math.sin(a) * (d + len));
        g.stroke();
      }
      g.restore();
    }

    // 吸収シールド。
    if (p.shield > 0) {
      g.save();
      g.globalAlpha = 0.28 + 0.12 * Math.sin(run.t * 4);
      g.strokeStyle = 'rgba(27, 108, 168, .8)';
      g.lineWidth = 2.5;
      g.beginPath();
      g.arc(p.x, p.y, p.r + 8, 0, TAU);
      g.stroke();
      // 回る破線で「膜」が生きていることを示す。
      g.globalAlpha = 0.24 + 0.1 * Math.sin(run.t * 3 + 1);
      g.lineWidth = 1.4;
      g.setLineDash([5, 7]);
      g.lineDashOffset = -run.t * 30;
      g.beginPath();
      g.arc(p.x, p.y, p.r + 12, 0, TAU);
      g.stroke();
      g.setLineDash([]);
      g.restore();
    }

    const blink = p.invuln > 0 && Math.floor(p.invuln * 18) % 2 === 0;
    g.save();
    g.globalAlpha = blink ? 0.4 : 1;
    g.translate(p.x, p.y);
    g.rotate(p.face);

    // 自機は墨の丸。紙の上でいちばん濃く見えるように、周囲だけを白く抜く。
    g.globalAlpha = 0.9;
    g.fillStyle = 'rgba(255, 253, 247, .95)';
    g.beginPath();
    g.arc(0, 0, p.r + 3.5, 0, TAU);
    g.fill();
    g.globalAlpha = 1;
    g.fillStyle = p.flash > 0.05 ? '#b8332b' : '#1c2331';
    g.beginPath();
    g.arc(0, 0, p.r, 0, TAU);
    g.fill();

    // 進行方向のトゲ。
    g.fillStyle = '#e8b425';
    g.beginPath();
    g.moveTo(p.r * 1.5, 0);
    g.lineTo(p.r * 0.4, -p.r * 0.62);
    g.lineTo(p.r * 0.4, p.r * 0.62);
    g.closePath();
    g.fill();

    // 視線。
    g.fillStyle = '#fdfbf4';
    g.beginPath();
    g.arc(p.r * 0.45, 0, p.r * 0.24, 0, TAU);
    g.fill();
    g.restore();
    g.globalAlpha = 1;
  }

  // 武器の種類ごとに異なる「待機モーション」。攻撃の合間にも武器が息づく。
  drawWeaponSpirits(run) {
    const g = this.ctx, p = run.player;
    for (let i = 0; i < run.weapons.length; i++) {
      const wi = run.weapons[i];
      const report = run.weaponReport?.()[i];
      if (report && !report.res.active) continue;
      const phase = run.t * (wi.def.kind === 'orbit' ? 1.8 : 1.15) + i * TAU / Math.max(1, run.weapons.length);
      const radius = p.r + 17 + Math.sin(run.t * 2 + i) * 2;
      const x = p.x + Math.cos(phase) * radius;
      const y = p.y + Math.sin(phase) * radius * .58;
      g.save();
      g.translate(x, y); g.rotate(phase + Math.PI / 4);
      g.globalAlpha = .48 + .22 * Math.sin(run.t * 3 + i);
      g.strokeStyle = wi.def.kind === 'chain' || wi.def.kind === 'beam' ? '#6fb5d7' : '#d4a94e';
      g.fillStyle = 'rgba(255,248,218,.85)'; g.lineWidth = 1.5;
      g.shadowColor = g.strokeStyle; g.shadowBlur = 7;
      g.beginPath();
      if (wi.def.kind === 'shot' || wi.def.kind === 'beam') {
        g.moveTo(0, -6); g.lineTo(4, 4); g.lineTo(0, 2); g.lineTo(-4, 4); g.closePath();
        g.fill(); g.stroke();
      } else {
        g.moveTo(0, -7); g.lineTo(3, 0); g.lineTo(0, 7); g.lineTo(-3, 0); g.closePath();
        g.fill(); g.stroke();
      }
      g.restore();
    }
  }

  drawLightnings(run) {
    const g = this.ctx;
    g.save();
    g.globalCompositeOperation = 'source-over';
    g.lineCap = 'round';
    for (const l of run.lightnings) {
      const t = l.life / l.maxLife;
      const c = l.color || '#1b6ca8';
      const seg = 6;
      const dx = (l.x2 - l.x1) / seg, dy = (l.y2 - l.y1) / seg;
      const nx = -dy, ny = dx;
      const seed = l.x1 * 0.017 + l.y1 * 0.013;
      const jig = (n) => Math.sin(seed + n * 7.31 + l.life * 55) * 0.5;
      const trace = () => {
        g.beginPath();
        g.moveTo(l.x1, l.y1);
        for (let i = 1; i < seg; i++) {
          const j = jig(i) * 15;
          g.lineTo(l.x1 + dx * i + (nx / seg) * j, l.y1 + dy * i + (ny / seg) * j);
        }
        g.lineTo(l.x2, l.y2);
      };

      // 外側の滲み、色の芯、紙を抜く白い芯の 3 層。
      trace();
      g.globalAlpha = t * 0.26;
      g.strokeStyle = c;
      g.lineWidth = 9 * t + 2;
      g.stroke();
      trace();
      g.globalAlpha = t * 0.95;
      g.strokeStyle = c;
      g.lineWidth = 3.2 * t + 1;
      g.stroke();
      trace();
      g.globalAlpha = t * 0.8;
      g.strokeStyle = 'rgba(255, 253, 247, .92)';
      g.lineWidth = 1.1;
      g.stroke();

      // 途中から分かれる枝。毎フレーム同じ形になるよう乱数は使わない。
      if (t > 0.3 && hash01(seed + 2.3) > 0.42) {
        const at = 0.42 + hash01(seed + 4.1) * 0.2;
        const bx = l.x1 + (l.x2 - l.x1) * at;
        const by = l.y1 + (l.y2 - l.y1) * at;
        const side = hash01(seed + 8.7) > 0.5 ? 1 : -1;
        const len = 34 + hash01(seed + 1.9) * 46;
        g.globalAlpha = t * 0.55;
        g.strokeStyle = c;
        g.lineWidth = 1.4;
        g.beginPath();
        g.moveTo(bx, by);
        g.lineTo(bx + nx / seg * side * len * 0.55 + dx * 0.25, by + ny / seg * side * len * 0.55 + dy * 0.25);
        g.lineTo(bx + nx / seg * side * len + dx * 0.45, by + ny / seg * side * len + dy * 0.45);
        g.stroke();
      }
    }
    g.restore();
  }

  /** 光線。敵より後ろに描きたいので個別に呼ぶ。 */
  drawBeams(run) {
    const g = this.ctx;
    g.save();
    g.globalCompositeOperation = 'source-over';
    g.lineCap = 'round';
    for (const b of run.beams) {
      const t = b.life / b.maxLife;
      const ex = b.x + Math.cos(b.a) * b.len;
      const ey = b.y + Math.sin(b.a) * b.len;
      const c = b.color || '#e8a30a';
      // 紙の上では光ではなく「走った墨」と「その内側の色」。
      g.globalAlpha = t * 0.5;
      g.strokeStyle = 'rgba(28, 35, 49, .4)';
      g.lineWidth = b.w * t * 1.45;
      g.beginPath();
      g.moveTo(b.x, b.y);
      g.lineTo(ex, ey);
      g.stroke();

      g.globalAlpha = t * 0.9;
      g.strokeStyle = c;
      g.lineWidth = b.w * t * 0.76;
      g.beginPath();
      g.moveTo(b.x, b.y);
      g.lineTo(ex, ey);
      g.stroke();

      // 芯は淡く。色の帯の真ん中を白っぽく抜く。
      g.globalAlpha = t * 0.55;
      g.strokeStyle = 'rgba(255, 251, 235, .95)';
      g.lineWidth = Math.max(1, b.w * t * 0.22);
      g.beginPath();
      g.moveTo(b.x, b.y);
      g.lineTo(ex, ey);
      g.stroke();

      // 発射口の輪。撃った位置が分かる。
      g.globalAlpha = t * t * 0.65;
      g.strokeStyle = c;
      g.lineWidth = 1.8;
      g.beginPath();
      g.arc(b.x, b.y, 5 + (1 - t) * 10, 0, TAU);
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
      const label = t.text != null ? String(t.text) : String(t.v);
      const size = t.crit ? 20 : 13;
      // 出た瞬間は少し大きく、消えるにつれて元の大きさへ戻る。
      const grow = 1 + (1 - a) * (t.crit ? 0.24 : 0.08);
      g.save();
      g.translate(t.x, t.y);
      g.scale(grow, grow);
      g.globalAlpha = Math.min(1, a * 1.8);
      g.font = `800 ${size}px "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif`;
      g.lineJoin = 'round';
      g.lineWidth = 4.2;
      g.strokeStyle = 'rgba(255, 253, 247, .96)';
      g.strokeText(label, 0, 0);
      g.fillStyle = t.color || (t.crit ? '#b8332b' : '#1c2331');
      g.fillText(label, 0, 0);
      if (t.crit) {
        // 会心は下線と小さな菱形で強さを示す。
        const w = g.measureText(label).width;
        g.globalAlpha = Math.min(1, a) * 0.55;
        g.fillRect(-w / 2, size * 0.55, w, 1.6);
        for (const side of [-1, 1]) {
          g.beginPath();
          g.moveTo(side * (w / 2 + 5), 0);
          g.lineTo(side * (w / 2 + 9), -3.5);
          g.lineTo(side * (w / 2 + 13), 0);
          g.lineTo(side * (w / 2 + 9), 3.5);
          g.closePath();
          g.fill();
        }
      }
      g.restore();
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
    g.globalAlpha = 0.42;
    g.strokeStyle = '#1c2331';
    g.lineWidth = 2.5;
    g.beginPath();
    g.arc(stick.ox, stick.oy, 56, 0, TAU);
    g.stroke();

    g.globalAlpha = 0.5;
    g.fillStyle = '#1c2331';
    g.beginPath();
    g.arc(stick.ox + stick.dx * 56, stick.oy + stick.dy * 56, 20, 0, TAU);
    g.fill();
    g.restore();
  }
}

/** 0..1 の決定的な擬似乱数。同じ入力からは毎回同じ絵柄になる。 */
function hash01(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
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
