// ============================================================================
// ワードローグ — 画面描画 (Canvas 2D)
//
// 外部画像ファイルを一切使わない。全部その場で描く。
// ============================================================================

import { TAU, clamp, lerp, dist2 } from '../core/util.js';
import { ELEMENTS } from '../data/words.js?v=1.49';
import { KIND_GLYPH } from '../data/weapons.js?v=1.49';
import { motionPose } from '../game/motions.js?v=1.49';

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
    // 基準のカメラは少しだけ遅れて追う。動いた瞬間の「重さ」が出て、
    // シェイクはその上に別で足すので、揺れが smoothing に殺されない。
    const p = run.player;
    let sx = 0, sy = 0;
    if (run.shakeAmt > 0) {
      const s = run.shakeAmt;
      sx = (Math.random() - 0.5) * s;
      sy = (Math.random() - 0.5) * s;
    }
    // 庭の外へはカメラが出さない。庭が画面より小さければ、庭を丸ごと
    // 中央に見せる (箱庭としての外形が最初から見える)。
    const a = stageArena(run);
    const tx = p.x - this.w / 2;
    const ty = p.y - this.h / 2;
    if (this._camBX == null) { this._camBX = tx; this._camBY = ty; }
    this._camBX += (tx - this._camBX) * 0.28;
    this._camBY += (ty - this._camBY) * 0.28;
    this._camBX = clampCam(this._camBX, a.w, this.w);
    this._camBY = clampCam(this._camBY, a.h, this.h);
    this.camX = this._camBX + sx;
    this.camY = this._camBY + sy;

    this.begin();
    g.save();
    g.translate(-this.camX, -this.camY);
    // 壁より外側は描かない。外は闇なので、壁の帯までが世界の限界。
    g.beginPath();
    g.rect(-a.w / 2 - WALL, -a.h / 2 - WALL, a.w + WALL * 2, a.h + WALL * 2);
    g.clip();

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
    this.step('helpers', () => this.drawHelpers(run));
    this.step('lightnings', () => this.drawLightnings(run));
    this.step('texts', () => this.drawDamageTexts(run));

    g.restore();

    this.step('screen-flash', () => this.drawScreenFlash(run));
    this.step('grain', () => this.drawGrain(run));
    this.step('vignette', () => this.drawVignette(run));
    this.step('motes', () => this.drawMotes(run));
    this.step('stick', () => this.drawStickUI(stick));
  }

  /**
   * レベルアップ・ボス出現の一瞬の色。画面全体をうっすら染める。
   * 加算はしない。紙に色が乗って、すぐ乾くように。
   */
  drawScreenFlash(run) {
    const f = run.screenFlash;
    if (!f || f.life <= 0) return;
    const t = Math.max(0, f.life / (f.maxLife || 1));
    const g = this.ctx;
    g.save();
    g.globalAlpha = 0.16 * t;
    g.fillStyle = f.color;
    g.fillRect(0, 0, this.w, this.h);
    const rg = g.createRadialGradient(
      this.w / 2, this.h / 2, 0,
      this.w / 2, this.h / 2, this.viewR,
    );
    rg.addColorStop(0, 'rgba(255, 253, 247, .5)');
    rg.addColorStop(0.65, 'rgba(255, 253, 247, 0)');
    rg.addColorStop(1, 'rgba(28, 35, 49, .05)');
    g.globalAlpha = 0.22 * t;
    g.fillStyle = rg;
    g.fillRect(0, 0, this.w, this.h);
    g.restore();
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
    const a = stageArena(run);
    const x0 = -a.w / 2, y0 = -a.h / 2, x1 = a.w / 2, y1 = a.h / 2;

    // 庭の外は闇。箱庭が「囲われている」ことをまず見せる。
    g.fillStyle = mixHex(st.accent || '#3f6b3a', '#0f0c09', 0.74);
    g.fillRect(this.camX, this.camY, this.w, this.h);

    g.save();
    g.beginPath();
    g.rect(x0, y0, a.w, a.h);
    g.clip();

    g.fillStyle = st.ground;
    g.fillRect(x0, y0, a.w, a.h);

    // グリッド。庭の座標に固定して引くので、壁までずっと続いている。
    const size = 96;
    g.strokeStyle = 'rgba(70, 55, 30, .055)';
    g.lineWidth = 1;
    g.beginPath();
    for (let x = Math.ceil(x0 / size) * size; x < x1; x += size) { g.moveTo(x, y0); g.lineTo(x, y1); }
    for (let y = Math.ceil(y0 / size) * size; y < y1; y += size) { g.moveTo(x0, y); g.lineTo(x1, y); }
    g.stroke();


    // 和紙の染み。視点に合わせたタイルから選ぶので、スクロールしても
    // 同じ場所に留まる。地面の色を少しだけ濁らせる。
    const tile = 620;
    const tx0 = Math.floor(this.camX / tile) * tile;
    const ty0 = Math.floor(this.camY / tile) * tile;
    const nx = Math.ceil(this.w / tile) + 1;
    const ny = Math.ceil(this.h / tile) + 1;
    for (let ix = 0; ix <= nx; ix++) {
      for (let iy = 0; iy <= ny; iy++) {
        const cellX = tx0 / tile + ix;
        const cellY = ty0 / tile + iy;
        const seed = st.id * 19.7 + cellX * 7.13 + cellY * 3.71;
        for (let k = 0; k < 2; k++) {
          const pick = hash01(seed + k * 5.3);
          if (pick > 0.7) continue;
          const x = tx0 + ix * tile + hash01(seed + k * 9.1) * tile;
          const y = ty0 + iy * tile + hash01(seed + k * 13.7) * tile;
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

    // 庭の意匠。畝・花・木・池・石・垣・砂・灯籠・骨・石畳を床に描く。
    // 当たり判定は持たない景色 (壁だけが当たり判定を持つ)。
    this.drawGarden(run, a);

    // 壁の内側に落ちる影。床が壁に埋まっているように見せる。
    const shadeW = 74;
    const gTop = g.createLinearGradient(0, y0, 0, y0 + shadeW);
    gTop.addColorStop(0, 'rgba(24, 18, 12, .34)');
    gTop.addColorStop(1, 'rgba(24, 18, 12, 0)');
    g.fillStyle = gTop; g.fillRect(x0, y0, a.w, shadeW);
    const gBot = g.createLinearGradient(0, y1, 0, y1 - shadeW);
    gBot.addColorStop(0, 'rgba(24, 18, 12, .34)');
    gBot.addColorStop(1, 'rgba(24, 18, 12, 0)');
    g.fillStyle = gBot; g.fillRect(x0, y1 - shadeW, a.w, shadeW);
    const gL = g.createLinearGradient(x0, 0, x0 + shadeW, 0);
    gL.addColorStop(0, 'rgba(24, 18, 12, .34)');
    gL.addColorStop(1, 'rgba(24, 18, 12, 0)');
    g.fillStyle = gL; g.fillRect(x0, y0, shadeW, a.h);
    const gR = g.createLinearGradient(x1, 0, x1 - shadeW, 0);
    gR.addColorStop(0, 'rgba(24, 18, 12, .34)');
    gR.addColorStop(1, 'rgba(24, 18, 12, 0)');
    g.fillStyle = gR; g.fillRect(x1 - shadeW, y0, shadeW, a.h);

    // 紙の端がわずかに焼ける。暗闇ではなく「遠くが少し沈む」程度に。
    const rg = g.createRadialGradient(
      this.camX + this.w / 2, this.camY + this.h / 2, 0,
      this.camX + this.w / 2, this.camY + this.h / 2, this.viewR,
    );
    rg.addColorStop(0, 'rgba(255, 253, 246, .34)');
    rg.addColorStop(0.55, 'rgba(255, 253, 246, 0)');
    rg.addColorStop(1, 'rgba(88, 68, 38, .16)');
    g.fillStyle = rg;
    g.fillRect(x0, y0, a.w, a.h);

    g.restore();

    this.drawWall(run, a);
  }

  /**
   * 箱庭の壁。床の外側半分と内側半分にまたがる帯を描く。
   * 四隅には柱。壁の内側は床の影で沈んでいる (drawGround)。
   */
  drawWall(run, a) {
    const g = this.ctx;
    const st = run.stage;
    const x0 = -a.w / 2, y0 = -a.h / 2;
    const dark = mixHex(st.accent || '#3f6b3a', '#0d0a07', 0.5);
    const body = mixHex(st.accent || '#3f6b3a', '#231c13', 0.28);
    const cap = mixHex(st.accent || '#3f6b3a', '#fff4e2', 0.42);

    // 外側へ落ちる影。
    g.save();
    g.globalAlpha = 0.5;
    g.strokeStyle = 'rgba(0, 0, 0, .55)';
    g.lineWidth = WALL * 2 + 14;
    g.strokeRect(x0, y0, a.w, a.h);
    g.restore();

    // 帯 (壁そのもの)。
    g.strokeStyle = dark;
    g.lineWidth = WALL * 2;
    g.strokeRect(x0, y0, a.w, a.h);
    g.strokeStyle = body;
    g.lineWidth = WALL * 1.2;
    g.strokeRect(x0, y0, a.w, a.h);

    // 内側と外側の縁を明るく走らせる。帯に厚みが出る。
    g.strokeStyle = cap;
    g.globalAlpha = 0.5;
    g.lineWidth = 2;
    g.strokeRect(x0 + WALL / 2, y0 + WALL / 2, a.w - WALL, a.h - WALL);
    g.globalAlpha = 1;
    g.strokeStyle = 'rgba(0, 0, 0, .45)';
    g.lineWidth = 2;
    g.strokeRect(x0 - WALL / 2, y0 - WALL / 2, a.w + WALL, a.h + WALL);

    // 四隅の柱。
    const r = WALL * 1.15;
    for (const [cx, cy] of [[x0, y0], [x0 + a.w, y0], [x0, y0 + a.h], [x0 + a.w, y0 + a.h]]) {
      g.beginPath();
      g.arc(cx, cy, r, 0, TAU);
      g.fillStyle = dark;
      g.fill();
      g.beginPath();
      g.arc(cx - r * 0.2, cy - r * 0.2, r * 0.58, 0, TAU);
      g.fillStyle = cap;
      g.globalAlpha = 0.55;
      g.fill();
      g.globalAlpha = 1;
    }

    // 壁の内側に沿って一本、明るい縁。床と壁の境をはっきりさせる。
    g.strokeStyle = 'rgba(255, 250, 236, .3)';
    g.lineWidth = 2;
    g.strokeRect(x0 + WALL + 1, y0 + WALL + 1, a.w - (WALL + 1) * 2, a.h - (WALL + 1) * 2);
  }

  /**
   * 庭の意匠。ステージごとに 1 度だけ配置を決め、以後は同じ庭を描く。
   * 乱数はステージ ID から引くので、起動するたびに庭が変わりません。
   */
  gardenItems(run) {
    const st = run.stage;
    if (this._garden && this._garden.id === st.id) return this._garden.items;
    const a = stageArena(run);
    const items = [];
    const area = (a.w * a.h) / (1600 * 1100);
    let k = 0;
    for (const kind of st.garden || []) {
      const n = Math.max(4, Math.round((GARDEN_COUNT[kind] || 14) * area));
      for (let i = 0; i < n; i++) {
        const s = st.id * 13.7 + k * 91.3 + i * 7.77 + 3.1;
        const pad = 90;
        const x = (hash01(s + 1.1) - 0.5) * (a.w - pad * 2);
        const y = (hash01(s + 2.3) - 0.5) * (a.h - pad * 2);
        items.push({ kind, x, y, s });
      }
      k++;
    }
    this._garden = { id: st.id, items };
    return items;
  }

  /** 床に描く景色。どれも足場ではなく、床の模様として置く。 */
  drawGarden(run, a) {
    const g = this.ctx;
    const st = run.stage;
    const accent = st.accent || '#3f6b3a';
    const deep = mixHex(accent, '#14110c', 0.4);
    const pale = mixHex(st.ground || '#e8e2d2', '#ffffff', 0.55);
    for (const it of this.gardenItems(run)) {
      const r0 = hash01(it.s + 4.7);
      const r1 = hash01(it.s + 8.9);
      const r2 = hash01(it.s + 12.3);
      g.save();
      g.translate(it.x, it.y);
      g.rotate(r0 * TAU);
      switch (it.kind) {
        case 'rows': { // 畝。短い線を並べる。
          g.strokeStyle = deep; g.globalAlpha = 0.2; g.lineWidth = 4;
          g.beginPath();
          for (let i = -2; i <= 2; i++) { g.moveTo(-46, i * 15); g.lineTo(46, i * 15); }
          g.stroke();
          break;
        }
        case 'flower': { // 花。小さな点の群れ。
          const col = mixHex(st.color || '#c9971f', '#fff3f6', 0.35);
          g.fillStyle = col; g.globalAlpha = 0.55;
          for (let i = 0; i < 9; i++) {
            const a1 = hash01(it.s + i * 3.7) * TAU;
            const d = 8 + hash01(it.s + i * 5.1) * 52;
            g.beginPath();
            g.arc(Math.cos(a1) * d, Math.sin(a1) * d, 2.6 + hash01(it.s + i) * 2.4, 0, TAU);
            g.fill();
          }
          break;
        }
        case 'grove': { // 木。濃い円と、その下に出る影。
          g.globalAlpha = 0.26;
          g.fillStyle = '#1e2a18';
          g.beginPath(); g.ellipse(14, 16, 44, 30, 0, 0, TAU); g.fill();
          g.globalAlpha = 0.5;
          g.fillStyle = deep;
          g.beginPath(); g.arc(0, 0, 34 + r1 * 14, 0, TAU); g.fill();
          g.globalAlpha = 0.3;
          g.fillStyle = pale;
          g.beginPath(); g.arc(-9, -9, 14, 0, TAU); g.fill();
          break;
        }
        case 'bamboo': { // 竹。縦の筋と節。
          g.globalAlpha = 0.4; g.strokeStyle = deep; g.lineWidth = 6;
          g.beginPath();
          for (let i = -2; i <= 2; i++) { g.moveTo(i * 22, -54); g.lineTo(i * 22, 54); }
          g.stroke();
          g.globalAlpha = 0.55; g.lineWidth = 2;
          g.beginPath();
          for (let i = -2; i <= 2; i++) for (const yy of [-26, 14]) { g.moveTo(i * 22 - 5, yy); g.lineTo(i * 22 + 5, yy); }
          g.stroke();
          break;
        }
        case 'rock': { // 石。角のある塊と影。
          g.globalAlpha = 0.24; g.fillStyle = '#241d15';
          g.beginPath(); g.ellipse(8, 9, 30, 21, 0, 0, TAU); g.fill();
          g.globalAlpha = 0.62; g.fillStyle = mixHex(accent, '#8d8577', 0.55);
          g.beginPath();
          const rr = 22 + r2 * 14;
          polyPath(g, 5 + Math.floor(r1 * 3), rr, rr * 0.78);
          g.fill();
          g.globalAlpha = 0.3; g.fillStyle = pale;
          g.beginPath(); g.ellipse(-6, -7, 9, 6, 0, 0, TAU); g.fill();
          break;
        }
        case 'hedge': { // 垣。太い帯で囲う。
          g.globalAlpha = 0.5; g.strokeStyle = deep; g.lineWidth = 26;
          g.lineCap = 'round';
          g.beginPath();
          g.moveTo(-70, -26); g.lineTo(70, -26);
          g.moveTo(-70, 26); g.lineTo(70, 26);
          g.stroke();
          g.globalAlpha = 0.3; g.strokeStyle = pale; g.lineWidth = 7;
          g.beginPath(); g.moveTo(-66, -32); g.lineTo(66, -32); g.stroke();
          g.lineCap = 'butt';
          break;
        }
        case 'gravel': { // 砂。白い面に耙の跡。
          g.globalAlpha = 0.5; g.fillStyle = pale;
          g.beginPath(); g.ellipse(0, 0, 66, 48, 0, 0, TAU); g.fill();
          g.globalAlpha = 0.3; g.strokeStyle = deep; g.lineWidth = 1.6;
          g.beginPath();
          for (let i = -3; i <= 3; i++) { g.moveTo(-58, i * 12); g.lineTo(58, i * 12); }
          g.stroke();
          break;
        }
        case 'pond': { // 池。水の色と、二重の波紋。
          g.globalAlpha = 0.75;
          g.fillStyle = mixHex(st.color || '#4a7f97', '#0d2b3a', 0.45);
          g.beginPath(); g.ellipse(0, 0, 78 + r1 * 30, 54 + r2 * 20, 0, 0, TAU); g.fill();
          g.globalAlpha = 0.35; g.strokeStyle = '#eaf6ff'; g.lineWidth = 2;
          g.beginPath(); g.ellipse(0, 0, 44, 30, 0, 0, TAU); g.stroke();
          g.beginPath(); g.ellipse(0, 0, 22, 15, 0, 0, TAU); g.stroke();
          break;
        }
        case 'tiles': { // 石畳。四角い石を敷く。
          g.globalAlpha = 0.4; g.fillStyle = deep;
          for (let i = -1; i <= 1; i++) {
            for (let j = -1; j <= 1; j++) {
              g.fillRect(i * 40 - 17, j * 40 - 17, 34, 34);
            }
          }
          g.globalAlpha = 0.2; g.fillStyle = pale;
          g.fillRect(-17 - 40, -17, 34, 34); g.fillRect(-17 + 40, -17, 34, 34);
          break;
        }
        case 'bones': { // 骨。白い棒と小さな環。
          g.globalAlpha = 0.5; g.strokeStyle = '#efe7d6'; g.lineWidth = 5; g.lineCap = 'round';
          g.beginPath();
          g.moveTo(-30, -8); g.lineTo(26, 10);
          g.moveTo(-18, 16); g.lineTo(14, -18);
          g.stroke();
          g.beginPath(); g.arc(30, 14, 9, 0, TAU); g.lineWidth = 3; g.stroke();
          g.lineCap = 'butt';
          break;
        }
        case 'lantern': { // 灯籠。円の基壇と、灯の点。
          g.globalAlpha = 0.24; g.fillStyle = '#241d15';
          g.beginPath(); g.ellipse(6, 8, 26, 18, 0, 0, TAU); g.fill();
          g.globalAlpha = 0.7; g.fillStyle = mixHex(accent, '#cfc6b4', 0.6);
          g.beginPath(); g.arc(0, 0, 20, 0, TAU); g.fill();
          g.globalAlpha = 0.8; g.fillStyle = '#3a3128';
          g.beginPath(); g.arc(0, 0, 11, 0, TAU); g.fill();
          g.globalAlpha = 0.9; g.fillStyle = '#f4c04f';
          g.beginPath(); g.arc(0, 0, 5, 0, TAU); g.fill();
          break;
        }
        default: break;
      }
      g.restore();
    }
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
      const isHeal = q.type === 'heal';
      const isChest = q.type === 'chest';
      g.fillStyle = isHeal ? '#2f9e44' : '#d9a406';
      if (isChest) {
        // 中ボスの宝箱。蓋と留め具がある箱にして、経験値の星と区別する。
        const s = q.r;
        g.save();
        g.translate(q.x, y);
        g.rotate(-0.05 + Math.sin(q.t * 2.2) * 0.05);
        g.fillStyle = '#b8730a';
        g.fillRect(-s * 1.15, -s * 0.55, s * 2.3, s * 1.45);
        g.fillStyle = '#e8b425';
        g.fillRect(-s * 1.15, -s * 1.05, s * 2.3, s * 0.62);
        g.fillStyle = '#6b4a17';
        g.fillRect(-s * 0.16, -s * 0.22, s * 0.32, s * 0.52);
        g.fillStyle = '#fff3c4';
        g.fillRect(-s * 0.06, -s * 0.05, s * 0.12, s * 0.16);
        g.restore();
      } else if (isHeal) {
        // 回復は十字。ひと目で「拾うと治る」と分かる形にする。
        const s = q.r;
        g.save();
        g.translate(q.x, y);
        g.rotate(0.2 + Math.sin(q.t * 2) * 0.08);
        g.beginPath();
        g.rect(-s * 0.38, -s, s * 0.76, s * 2);
        g.rect(-s, -s * 0.38, s * 2, s * 0.76);
        g.fill();
        g.restore();
      } else {
        // 経験値は回る四芒の星。ただの点より、拾いたくなる形。
        g.save();
        g.translate(q.x, y);
        g.rotate(q.t * 1.6);
        g.beginPath();
        for (let i = 0; i < 8; i++) {
          const ang = i * Math.PI / 4;
          const rr = i % 2 === 0 ? q.r * 1.45 : q.r * 0.62;
          g.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
        }
        g.closePath();
        g.fill();
        g.restore();
      }
      // 紙の上なので縁を墨で締める (金色の粒が地と同化しない)。
      g.globalAlpha = fade * 0.75;
      g.lineWidth = 1.3;
      g.strokeStyle = 'rgba(28, 35, 49, .5)';
      g.beginPath();
      g.arc(q.x, y, isChest ? q.r * 1.55 : q.r, 0, TAU);
      g.stroke();
      g.globalAlpha = fade * 0.3;
      g.beginPath();
      g.arc(q.x, y, isChest ? q.r * 2.1 : q.r * (1.8 + Math.sin(q.t * 4) * 0.2), 0, TAU);
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
      // 新しい攻撃は武器ごとの軌道 (予備動作 → 打撃 → 振り抜け) で描く。
      // 古い形 (モーションを持たないエフェクト) は従来の描画のまま。
      if (s.motion && s.motion.family !== 'ranged' && s.motion.family !== 'cast') {
        this.drawMotionSlash(s, run);
        continue;
      }
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

      // ── 属性の刃。同じ扇形でも、風は風の弧、炎は火の粉を纏う。 ──
      const el = s.el || 'none';
      if (el === 'wind') {
        for (let i = 0; i < 3; i++) {
          const rr = rOut * (0.98 - i * 0.17);
          const off = Math.sin(t * 9 + i * 1.7) * 0.05;
          g.globalAlpha = t * (0.5 - i * 0.12);
          g.strokeStyle = i === 0 ? 'rgba(255, 253, 247, .92)' : s.color;
          g.lineWidth = 2.2 - i * 0.55;
          g.beginPath();
          g.arc(s.x, s.y, rr, a0 + off + i * 0.06, a1 + off + i * 0.06);
          g.stroke();
        }
        // 刃先から抜ける風の筋。
        g.globalAlpha = t * 0.4;
        for (let i = 0; i < 2; i++) {
          const aa = a1 - i * 0.12;
          g.beginPath();
          g.moveTo(s.x + Math.cos(aa) * rOut * 0.9, s.y + Math.sin(aa) * rOut * 0.9);
          g.quadraticCurveTo(
            s.x + Math.cos(aa + 0.18) * rOut * 1.08, s.y + Math.sin(aa + 0.18) * rOut * 1.08,
            s.x + Math.cos(aa + 0.3) * rOut * 1.02, s.y + Math.sin(aa + 0.3) * rOut * 1.02,
          );
          g.stroke();
        }
      } else if (el === 'fire') {
        g.fillStyle = s.color;
        for (let i = 0; i < 6; i++) {
          const aa = a0 + (a1 - a0) * (i / 5);
          const rr = rOut * (0.9 + 0.08 * Math.sin(t * 20 + i));
          g.globalAlpha = t * (0.45 + 0.25 * Math.sin(t * 17 + i * 2));
          g.beginPath();
          g.arc(s.x + Math.cos(aa) * rr, s.y + Math.sin(aa) * rr, 1.6 + (i % 2), 0, TAU);
          g.fill();
        }
        if (s.flame) {
          // 火炎放射は刃先の火花ではなく、扇の内側を走る炎の筋で見せる。
          for (let i = 0; i < 9; i++) {
            const f = (i + 0.5) / 9;
            const aa = a0 + (a1 - a0) * f;
            const end = rOut * (0.58 + 0.32 * Math.sin(t * 18 + i * 2.3));
            g.globalAlpha = t * 0.55;
            g.strokeStyle = i % 2 ? '#fff1a8' : s.color;
            g.lineWidth = 2 + (i % 3);
            g.beginPath();
            g.moveTo(s.x + Math.cos(aa) * rIn, s.y + Math.sin(aa) * rIn);
            g.quadraticCurveTo(s.x + Math.cos(aa + 0.07) * end * 0.55, s.y + Math.sin(aa + 0.07) * end * 0.55,
              s.x + Math.cos(aa - 0.04) * end, s.y + Math.sin(aa - 0.04) * end);
            g.stroke();
          }
        }
      } else if (el === 'ice') {
        g.strokeStyle = s.color;
        g.lineWidth = 1.2;
        for (let i = 0; i < 4; i++) {
          const aa = a0 + (a1 - a0) * (i + 0.5) / 4;
          const rr = rOut * 0.96;
          const x = s.x + Math.cos(aa) * rr, y = s.y + Math.sin(aa) * rr;
          g.globalAlpha = t * 0.55;
          g.beginPath();
          g.moveTo(x + Math.cos(aa) * 6, y + Math.sin(aa) * 6);
          g.lineTo(x + Math.cos(aa + 2.2) * 3, y + Math.sin(aa + 2.2) * 3);
          g.lineTo(x + Math.cos(aa - 2.2) * 3, y + Math.sin(aa - 2.2) * 3);
          g.closePath();
          g.stroke();
        }
      } else if (el === 'thunder') {
        g.strokeStyle = s.color;
        g.lineWidth = 1.6;
        g.globalAlpha = t * 0.7;
        g.beginPath();
        const n = 10;
        for (let i = 0; i <= n; i++) {
          const aa = a0 + (a1 - a0) * i / n;
          const rr = rOut * (0.96 + Math.sin(i * 4.7 + t * 30) * 0.035);
          const x = s.x + Math.cos(aa) * rr, y = s.y + Math.sin(aa) * rr;
          if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.stroke();
      } else if (el === 'light') {
        g.strokeStyle = s.color;
        g.lineWidth = 1;
        for (let i = 0; i < 5; i++) {
          const aa = a0 + (a1 - a0) * (i + 0.5) / 5;
          g.globalAlpha = t * 0.45;
          g.beginPath();
          g.moveTo(s.x + Math.cos(aa) * rOut * 0.98, s.y + Math.sin(aa) * rOut * 0.98);
          g.lineTo(s.x + Math.cos(aa) * rOut * 1.12, s.y + Math.sin(aa) * rOut * 1.12);
          g.stroke();
        }
      } else if (el === 'dark') {
        g.globalAlpha = t * 0.35;
        g.strokeStyle = s.color;
        g.lineWidth = 5 * t;
        g.beginPath();
        g.arc(s.x, s.y, rOut * 0.9, a0 + 0.08, a1 + 0.08);
        g.stroke();
      } else if (el === 'water') {
        g.globalAlpha = t * 0.4;
        g.strokeStyle = s.color;
        g.lineWidth = 1;
        for (let i = 0; i < 2; i++) {
          g.beginPath();
          g.arc(s.x, s.y, rOut * (0.86 + i * 0.13), a0 + 0.06, a1 - 0.06);
          g.stroke();
        }
      } else if (el === 'nature') {
        g.fillStyle = s.color;
        for (let i = 0; i < 4; i++) {
          const aa = a0 + (a1 - a0) * (i + 0.5) / 4;
          const rr = rOut * 0.94;
          g.globalAlpha = t * 0.5;
          g.save();
          g.translate(s.x + Math.cos(aa) * rr, s.y + Math.sin(aa) * rr);
          g.rotate(aa + Math.sin(t * 7 + i) * 0.6);
          g.beginPath();
          g.ellipse(0, 0, 4, 1.6, 0, 0, TAU);
          g.fill();
          g.restore();
        }
      } else if (el === 'earth' || el === 'steel' || el === 'gold') {
        g.fillStyle = s.color;
        for (let i = 0; i < 5; i++) {
          const aa = a0 + (a1 - a0) * (i + 0.5) / 5;
          g.globalAlpha = t * 0.35;
          g.fillRect(
            s.x + Math.cos(aa) * rOut * 1.02, s.y + Math.sin(aa) * rOut * 1.02,
            1.6, 3.2,
          );
        }
      } else if (el === 'blood') {
        g.fillStyle = s.color;
        for (let i = 0; i < 3; i++) {
          const aa = a0 + (a1 - a0) * (i + 0.5) / 3;
          const rr = rOut * 1.01;
          g.globalAlpha = t * 0.4;
          g.beginPath();
          g.ellipse(s.x + Math.cos(aa) * rr, s.y + Math.sin(aa) * rr, 1.5, 3.5, aa, 0, TAU);
          g.fill();
        }
      }
    }
    g.restore();
  }

  drawRings(run) {
    const g = this.ctx;
    g.save();
    g.globalCompositeOperation = 'source-over';
    for (const s of run.rings) {
      // 鞭の渦。手元から外へらせん状に走る鞭の線。
      if (s.spiral) {
        this.drawWhipSpiral(s, run);
        continue;
      }
      if (s.motion && s.motion.family === 'whip') {
        this.drawWhipMotion(s, run);
        continue;
      }
      const t = s.life / s.maxLife;
      const el = s.el || 'none';
      const thin = !!s.thin;
      g.save();
      if (s.dash) {
        g.setLineDash([5, 8]);
        g.lineDashOffset = -s.life * 160;
      }
      // 紙の上では「抜印」のように、白い下地へ色を乗せる。
      g.globalAlpha = t * (thin ? 0.55 : 0.85);
      g.strokeStyle = 'rgba(255, 253, 247, .9)';
      g.lineWidth = (thin ? 4 : 9) * t + (thin ? 2 : 6);
      g.beginPath();
      g.arc(s.x, s.y, s.r * (1.04 - t * 0.12), 0, TAU);
      g.stroke();
      g.globalAlpha = t * (thin ? 0.55 : 0.72);
      g.strokeStyle = s.color;
      g.lineWidth = (thin ? 2.5 : 9) * t + (thin ? 1 : 1.5);
      g.beginPath();
      g.arc(s.x, s.y, s.r * (1.04 - t * 0.12), 0, TAU);
      g.stroke();
      g.setLineDash([]);
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

      // ── 属性の輪。風は弧がほどけ、炎は縁で火の粉が舞う。 ──
      const rr = s.r * (1.04 - t * 0.12);
      if (el === 'wind') {
        g.strokeStyle = 'rgba(255, 253, 247, .8)';
        g.lineWidth = 1.4;
        for (let i = 0; i < 3; i++) {
          const a0 = run.t * (1.2 + i * 0.4) + i * 2.3;
          g.globalAlpha = (t - 0.1) * 0.4;
          g.beginPath();
          g.arc(s.x, s.y, rr * (0.9 + i * 0.06), a0, a0 + 0.9 + i * 0.2);
          g.stroke();
          g.beginPath();
          g.arc(s.x, s.y, rr * (0.9 + i * 0.06) + 5, a0 + 0.2, a0 + 0.7);
          g.stroke();
        }
      } else if (el === 'fire') {
        g.fillStyle = s.color;
        for (let i = 0; i < 7; i++) {
          const aa = run.t * 1.1 + i * TAU / 7;
          g.globalAlpha = (t - 0.1) * (0.4 + 0.2 * Math.sin(run.t * 15 + i));
          g.beginPath();
          g.arc(s.x + Math.cos(aa) * rr, s.y + Math.sin(aa) * rr, 1.4 + (i % 2), 0, TAU);
          g.fill();
        }
      } else if (el === 'ice') {
        g.strokeStyle = s.color;
        g.lineWidth = 1.2;
        for (let i = 0; i < 6; i++) {
          const aa = i * TAU / 6 + 0.2;
          const x = s.x + Math.cos(aa) * rr, y = s.y + Math.sin(aa) * rr;
          g.globalAlpha = (t - 0.1) * 0.55;
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x + Math.cos(aa) * 5, y + Math.sin(aa) * 5);
          g.stroke();
        }
      } else if (el === 'thunder') {
        g.strokeStyle = s.color;
        g.lineWidth = 1.3;
        for (let i = 0; i < 3; i++) {
          const a0 = i * 2.1 + run.t * 3;
          g.globalAlpha = (t - 0.1) * 0.55;
          g.beginPath();
          for (let k = 0; k < 4; k++) {
            const aa = a0 + k * 0.09;
            const rad = rr + (k % 2 ? 5 : -2);
            const x = s.x + Math.cos(aa) * rad, y = s.y + Math.sin(aa) * rad;
            if (k === 0) g.moveTo(x, y); else g.lineTo(x, y);
          }
          g.stroke();
        }
      } else if (el === 'light') {
        g.strokeStyle = s.color;
        g.lineWidth = 1;
        for (let i = 0; i < 8; i++) {
          const aa = i * TAU / 8 + run.t * 0.4;
          g.globalAlpha = (t - 0.1) * 0.4;
          g.beginPath();
          g.moveTo(s.x + Math.cos(aa) * rr, s.y + Math.sin(aa) * rr);
          g.lineTo(s.x + Math.cos(aa) * (rr + 7), s.y + Math.sin(aa) * (rr + 7));
          g.stroke();
        }
      } else if (el === 'water') {
        g.strokeStyle = s.color;
        g.lineWidth = 1;
        g.globalAlpha = (t - 0.1) * 0.4;
        g.beginPath();
        g.arc(s.x, s.y, rr + 5 + (1 - t) * 12, 0, TAU);
        g.stroke();
      } else if (el === 'dark') {
        g.strokeStyle = 'rgba(28, 35, 49, .5)';
        g.lineWidth = 5 * t;
        g.globalAlpha = (t - 0.1) * 0.3;
        g.beginPath();
        g.arc(s.x + 3, s.y - 2, rr, 0, TAU);
        g.stroke();
      }
      g.restore();
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
      } else if (shape === 'gust') {
        // 風の弧。進行方向へしなる短い曲線。
        const sway = Math.sin((p.life || 0) * 14 + p.x * 0.03) * r * 1.2;
        g.globalAlpha = t * 0.65;
        g.strokeStyle = p.color;
        g.lineWidth = Math.max(1, r * 0.7);
        g.beginPath();
        g.moveTo(p.x - Math.cos(ang) * 6, p.y - Math.sin(ang) * 6);
        g.quadraticCurveTo(
          p.x + Math.cos(ang + 1.57) * sway, p.y + Math.sin(ang + 1.57) * sway,
          p.x + Math.cos(ang) * 7, p.y + Math.sin(ang) * 7,
        );
        g.stroke();
      } else if (shape === 'bubble') {
        g.globalAlpha = t * 0.65;
        g.strokeStyle = p.color;
        g.lineWidth = 1;
        g.beginPath();
        g.arc(p.x, p.y, r, 0, TAU);
        g.stroke();
        g.globalAlpha = t * 0.4;
        g.beginPath();
        g.arc(p.x - r * 0.3, p.y - r * 0.3, r * 0.28, 0, TAU);
        g.fillStyle = p.color;
        g.fill();
      } else if (shape === 'crystal') {
        g.save();
        g.translate(p.x, p.y);
        g.rotate(ang + (p.life || 0) * 2.5);
        g.beginPath();
        g.moveTo(r * 1.5, 0);
        g.lineTo(0, -r * 0.7);
        g.lineTo(-r * 1.5, 0);
        g.lineTo(0, r * 0.7);
        g.closePath();
        g.fill();
        g.restore();
      } else if (shape === 'ember') {
        g.globalAlpha = t * (0.6 + 0.3 * Math.sin(p.x * 0.1 + (p.life || 0) * 20));
        g.beginPath();
        g.arc(p.x, p.y, r, 0, TAU);
        g.fill();
        g.globalAlpha = t * 0.4;
        g.strokeStyle = p.color;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(p.x, p.y);
        g.lineTo(p.x - p.vx * 0.02, p.y - p.vy * 0.02);
        g.stroke();
      } else if (shape === 'smoke') {
        g.globalAlpha = t * 0.32;
        g.beginPath();
        g.ellipse(p.x, p.y, r * (1.8 - t * 0.6), r * (1.2 - t * 0.3), ang, 0, TAU);
        g.fill();
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

      // 状態異常のオーラ。燃えている・凍っているが、色だけでなく形で分かる。
      this.drawEnemyAura(g, e, run);

      // 突進の予兆。止まって狙っている間だけ、薄い朱の線を引く。
      if (e.charging > 0) {
        g.save();
        g.globalAlpha = a * (0.28 + 0.18 * Math.sin(run.t * 20));
        g.strokeStyle = '#c1432b';
        g.lineWidth = 2;
        g.setLineDash([5, 6]);
        g.beginPath();
        g.moveTo(e.x, e.y);
        g.lineTo(e.x + Math.cos(e.face) * (e.r + 96), e.y + Math.sin(e.face) * (e.r + 96));
        g.stroke();
        g.setLineDash([]);
        g.restore();
      }

      const col = e.flash > 0.05 ? '#ffffff' : e.def.color;
      g.fillStyle = col;
      // 紙地に輪郭。塗りだけでは明るい地で溶ける。
      g.strokeStyle = 'rgba(28, 35, 49, .5)';
      g.lineWidth = 1.7;
      g.lineJoin = 'round';
      g.save();
      // 被弾の瞬間は小さく跳ねる。当たった手応えを形にする。
      const fl = clamp(e.flash || 0, 0, 1);
      const jit = fl * 1.6;
      g.translate(
        e.x + Math.sin(run.t * 72 + e.uid) * jit,
        e.y + Math.cos(run.t * 61 + e.uid) * jit,
      );
      g.scale(1 + fl * 0.09, 1 + fl * 0.09);

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

      // 状態異常の印。色の点だけだと意味が読めないので、一字を添える。
      const marks = [];
      if (e.burn > 0) marks.push(['#cf4a12', '燃']);
      if (e.poison > 0) marks.push(['#3f7d24', '毒']);
      if (e.chill > 0) marks.push(['#1b6ca8', '氷']);
      if (e.freeze > 0) marks.push(['#155e94', '凍']);
      if (e.stun > 0) marks.push(['#b8860b', '痺']);
      for (let i = 0; i < marks.length; i++) {
        const [c, glyph] = marks[i];
        const mx = e.x - e.r + i * 11;
        const my = e.y - e.r - 7;
        g.globalAlpha = 0.45 + 0.4 * Math.abs(Math.sin(e.t * 8 + i));
        g.fillStyle = '#fffdf7';
        g.beginPath();
        g.arc(mx, my, 5.2, 0, TAU);
        g.fill();
        g.fillStyle = c;
        g.font = '700 7px "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(glyph, mx, my + 0.5);
      }
      g.globalAlpha = 1;

      // 傷ついた通常敵には、頭上の文と被らない位置に細い HP バー。
      if (!e.boss && e.hp < e.maxHp && dist2(e.x, e.y, run.player.x, run.player.y) < 260 * 260) {
        const bw = Math.max(20, e.r * 2);
        const hpk = clamp(e.hp / e.maxHp, 0, 1);
        g.globalAlpha = a * 0.5;
        g.fillStyle = 'rgba(74,56,28,.28)';
        g.fillRect(e.x - bw / 2, e.y + e.r + 5, bw, 2.4);
        g.fillStyle = hpk > 0.5 ? '#3f7d24' : hpk > 0.25 ? '#c2870a' : '#b8332b';
        g.fillRect(e.x - bw / 2, e.y + e.r + 5, bw * hpk, 2.4);
      }

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
   * 状態異常を、色ではなく形で見せる。
   *   燃 = 揺れる炎の舌 / 毒 = 浮かぶ泡 / 氷 = 霜の結晶 / 凍 = 氷の膜
   *   痺 = 走る電気 / 不成文 = ひび割れ
   * 乱数は使わず、e.uid と run.t で決めるので毎フレーム同じ形が動く。
   */
  drawEnemyAura(g, e, run) {
    const a = clamp((e.alpha ?? 1) * clamp(e.spawned, 0, 1), 0, 1);
    if (a <= 0.01) return;
    const t = run.t;
    g.save();
    g.globalAlpha = a;

    if (e.burn > 0) {
      const n = 3;
      for (let i = 0; i < n; i++) {
        const ph = t * 9 + i * 2.1 + e.uid;
        const x = e.x + Math.sin(ph) * e.r * 0.55 * (i - 1);
        const y = e.y - e.r * (0.55 + i * 0.12) - Math.abs(Math.sin(ph)) * e.r * 0.35;
        const h = e.r * (0.45 + 0.2 * Math.sin(ph * 1.3));
        g.globalAlpha = a * (0.34 - i * 0.06);
        g.fillStyle = i === 0 ? '#d9480f' : '#e8762a';
        g.beginPath();
        g.moveTo(x, y + h * 0.4);
        g.quadraticCurveTo(x - e.r * 0.28, y, x, y - h * 0.6);
        g.quadraticCurveTo(x + e.r * 0.3, y, x, y + h * 0.4);
        g.fill();
      }
    }

    if (e.poison > 0) {
      for (let i = 0; i < 3; i++) {
        const ph = t * 1.7 + i * 2.3 + e.uid;
        const rise = (ph % 1) * e.r * 1.6;
        const x = e.x + Math.sin(ph * 2.1) * e.r * 0.6;
        const y = e.y + e.r * 0.2 - rise;
        g.globalAlpha = a * (0.32 * (1 - rise / (e.r * 1.7)));
        g.strokeStyle = '#3f7d24';
        g.lineWidth = 1;
        g.beginPath();
        g.arc(x, y, 1.6 + i * 0.5, 0, TAU);
        g.stroke();
      }
    }

    if (e.chill > 0) {
      for (let i = 0; i < 4; i++) {
        const ang = t * 0.6 + i * TAU / 4 + e.uid;
        const x = e.x + Math.cos(ang) * e.r * 0.8;
        const y = e.y + Math.sin(ang) * e.r * 0.8;
        g.globalAlpha = a * (0.25 + 0.12 * Math.sin(t * 3 + i));
        g.strokeStyle = '#1b6ca8';
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(x - 2.2, y); g.lineTo(x + 2.2, y);
        g.moveTo(x, y - 2.2); g.lineTo(x, y + 2.2);
        g.stroke();
      }
    }

    if (e.freeze > 0) {
      g.globalAlpha = a * 0.38;
      g.strokeStyle = '#155e94';
      g.lineWidth = 1.6;
      g.beginPath();
      const n = 8;
      for (let i = 0; i <= n; i++) {
        const ang = i / n * TAU;
        const rr = e.r * (1.28 + 0.05 * Math.sin(i * 3.3 + e.uid));
        const x = e.x + Math.cos(ang) * rr;
        const y = e.y + Math.sin(ang) * rr;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.closePath();
      g.stroke();
      g.globalAlpha = a * 0.18;
      g.fillStyle = '#a5d8ff';
      g.fill();
    }

    if (e.stun > 0) {
      g.globalAlpha = a * (0.45 + 0.25 * Math.sin(t * 30));
      g.strokeStyle = '#b8860b';
      g.lineWidth = 1.2;
      g.beginPath();
      for (let i = 0; i < 5; i++) {
        const ang = t * 7 + i * 1.3 + e.uid;
        const r0 = e.r * 1.05, r1 = e.r * 1.35;
        const x0 = e.x + Math.cos(ang) * r0, y0 = e.y + Math.sin(ang) * r0;
        const x1 = e.x + Math.cos(ang + 0.3) * r1, y1 = e.y + Math.sin(ang + 0.3) * r1;
        if (i === 0) g.moveTo(x0, y0); else g.lineTo(x0, y0);
        g.lineTo(x1, y1);
      }
      g.stroke();
    }

    if (e.broken) {
      g.globalAlpha = a * 0.55;
      g.strokeStyle = 'rgba(28, 35, 49, .64)';
      g.lineWidth = 1.2;
      for (let i = 0; i < 2; i++) {
        const ang = i * 1.9 + e.uid * 0.3;
        g.beginPath();
        g.moveTo(e.x + Math.cos(ang) * e.r * 0.9, e.y + Math.sin(ang) * e.r * 0.9);
        g.lineTo(e.x + Math.cos(ang + 0.5) * e.r * 0.35, e.y + Math.sin(ang + 0.5) * e.r * 0.35);
        g.lineTo(e.x + Math.cos(ang + 0.9) * e.r * 0.15, e.y + Math.sin(ang + 0.9) * e.r * 0.15);
        g.stroke();
      }
    }
    g.restore();
  }

  /**
   * 敵が持つ文を頭の上に描く。斬られるたびに短くなっていく。
   * 崩れた敵は「不成文」と出る。
   */
  drawEnemySentence(e, run) {
    if (!e.words || !e.words.length) return;
    // 近い敵・中ボス・ボスだけ描く。全部描くと画面が読めなくなる。
    // dist2 は二乗距離なので、しきい値も二乗で比べる。
    const near = dist2(e.x, e.y, run.player.x, run.player.y) <= 280 * 280;
    if (!near && !e.boss && !e.midBoss) return;

    const g = this.ctx;
    const text = e.words.join('');
    const size = e.boss ? 16 : e.midBoss ? 15 : 13;
    const font = (px) => `700 ${px}px "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif`;
    g.save();

    // 突進の予備動作。赤い輪で「来る」ことを先に伝える。
    if (e.windup > 0 || e.charging > 0) {
      g.globalAlpha = e.windup > 0 ? 0.85 : 0.5;
      g.strokeStyle = '#c1432b';
      g.lineWidth = 2.2;
      g.beginPath();
      g.arc(e.x, e.y, e.r + 7 + Math.sin(e.t * 18) * 1.5, 0, TAU);
      g.stroke();
      g.globalAlpha = 1;
    }

    // canvas の font に var() は書けない。実体名を直接入れる。
    g.font = font(size);
    g.textAlign = 'center';
    g.textBaseline = 'bottom';
    const y = e.y - e.r - (e.boss ? 22 : e.midBoss ? 20 : 16);

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
        // 風。尾をまっすぐ引かず、進行方向へしなる弧を重ねる。
        // 渦・風切り・舞い上がる埃の 3 つで「風の弾」に見せる。
        const perp = ang + Math.PI / 2;
        for (let i = 0; i < 3; i++) {
          const ph = t * 13 + i * 1.9 + b.uid * 0.7;
          const off = Math.sin(ph) * r * (0.7 + i * 0.5);
          const back = r * (1.4 + i * 1.5);
          const x = b.x - Math.cos(ang) * back + Math.cos(perp) * off;
          const y = b.y - Math.sin(ang) * back + Math.sin(perp) * off;
          g.globalAlpha = 0.4 - i * 0.08;
          g.strokeStyle = i === 0 ? 'rgba(255, 253, 247, .95)' : c;
          g.lineWidth = Math.max(0.8, 2.2 - i * 0.5);
          g.beginPath();
          g.arc(x, y, r * (0.9 + i * 0.35), ang - 2.2, ang - 1.1);
          g.stroke();
        }
        // 先端の渦。
        g.globalAlpha = 0.55;
        g.strokeStyle = c;
        g.lineWidth = 1.2;
        g.beginPath();
        g.arc(b.x + Math.cos(ang) * r * 0.6, b.y + Math.sin(ang) * r * 0.6,
          r * 1.3, t * 8, t * 8 + 3.4);
        g.stroke();
        g.beginPath();
        g.arc(b.x + Math.cos(ang) * r * 0.6, b.y + Math.sin(ang) * r * 0.6,
          r * 1.7, t * 8 + 2.4, t * 8 + 4.8);
        g.stroke();
        // 風切り線。進行方向へ 2 本。
        g.globalAlpha = 0.35;
        g.strokeStyle = 'rgba(255, 253, 247, .9)';
        g.lineWidth = 1;
        for (let i = 0; i < 2; i++) {
          const s = (i ? 1 : -1) * r * 1.3;
          g.beginPath();
          g.moveTo(b.x + Math.cos(ang) * r * 1.2 + Math.cos(perp) * s,
            b.y + Math.sin(ang) * r * 1.2 + Math.sin(perp) * s);
          g.lineTo(b.x + Math.cos(ang) * r * 3.4 + Math.cos(perp) * s * 1.4,
            b.y + Math.sin(ang) * r * 3.4 + Math.sin(perp) * s * 1.4);
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
    const speed = Math.hypot(p.vx, p.vy);
    const moveK = clamp(speed / 280, 0, 1);
    const face = p.faceVis ?? p.face;

    // 足元の影。紙に落ちる影で、自機が「置かれている」ことを示す。
    g.save();
    g.fillStyle = 'rgba(28, 35, 49, .16)';
    g.beginPath();
    g.ellipse(p.x + moveK * 3, p.y + p.r * 0.92, p.r * 0.95, p.r * 0.32, 0, 0, TAU);
    g.fill();
    g.restore();

    // 手の属性のオーラ。炎の右手なら、自機のまわりがうっすらその色になる。
    const handEl = p.stats?.handElement;
    if (handEl && ELEMENTS[handEl] && handEl !== 'none') {
      const c = ELEMENTS[handEl].color;
      g.save();
      g.globalAlpha = 0.1 + 0.05 * Math.sin(run.t * 3.2);
      const rg = g.createRadialGradient(p.x, p.y, p.r * 0.5, p.x, p.y, p.r + 15);
      rg.addColorStop(0, c);
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = rg;
      g.beginPath();
      g.arc(p.x, p.y, p.r + 15, 0, TAU);
      g.fill();
      g.restore();
    }

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
      g.ellipse(0, 0, p.r * 0.95, p.r * 0.8, 0, 0, TAU);
      g.fill();
      g.restore();
    }

    // ダッシュ中の風切り線。進行方向の逆へ短い線を流す。
    if (p.dashing) {
      g.save();
      g.strokeStyle = '#c9862b';
      g.lineCap = 'round';
      for (let i = 0; i < 5; i++) {
        const a = face + Math.PI + (i - 2) * 0.28;
        const d = p.r + 5 + (i % 2) * 4;
        const len = 12 + i * 5;
        g.globalAlpha = 0.3 - Math.abs(i - 2) * 0.05;
        g.lineWidth = 2 - (i % 2) * 0.5;
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
    // 歩くと上下に小さく弾み、ダッシュでは進行方向へ伸びる。
    const bobY = Math.sin(p.anim * 11) * 1.2 * moveK;
    const stretch = 1 + moveK * 0.08 + (p.dashing ? 0.08 : 0);
    g.translate(p.x, p.y + bobY);
    g.rotate(face);
    g.scale(stretch, 1 / stretch * (1 - moveK * 0.02));

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

    // 撃った瞬間の光。筒先ではなく、身体のまわりに短い弧を描く。
    if (p.castFlash > 0) {
      const k = clamp(p.castFlash / 0.18, 0, 1);
      const dir = p.castDir ?? face;
      g.save();
      g.globalAlpha = k * (p.castKind === 'slash' ? 0.5 : 0.36);
      g.strokeStyle = p.castColor || '#e8b425';
      g.lineWidth = 2.4 * k + 0.6;
      g.lineCap = 'round';
      g.beginPath();
      g.arc(p.x, p.y, p.r + 6 + (1 - k) * 10, dir - 0.42, dir + 0.42);
      g.stroke();
      g.globalAlpha = k * 0.5;
      g.fillStyle = '#fffdf7';
      g.beginPath();
      g.arc(p.x + Math.cos(dir) * (p.r + 8), p.y + Math.sin(dir) * (p.r + 8), 1.8 * k + 0.5, 0, TAU);
      g.fill();
      g.restore();
    }
  }

  /**
   * 武器 1 つの絵。原点が握り、+X が切っ先。
   * 画像ファイルを使わず、墨の線と紙色の面だけで描く。
   */
  drawWeaponGlyph(g, glyph, scale = 1, color = '#d4a94e', alpha = 1) {
    const s = Math.max(0.4, scale);
    const ink = 'rgba(28, 35, 49, .92)';
    const pale = 'rgba(255, 253, 247, .96)';
    g.save();
    g.scale(s, s);
    g.globalAlpha *= alpha;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = ink;
    g.lineWidth = 1.2;
    g.fillStyle = pale;

    const blade = (len, width = 2.4, curve = 0.08) => {
      g.beginPath();
      g.moveTo(2, -width);
      g.quadraticCurveTo(len * 0.72, -width + curve, len, 0);
      g.quadraticCurveTo(len * 0.72, width + curve, 2, width);
      g.closePath();
      g.fill();
      g.stroke();
      g.beginPath();
      g.moveTo(1.5, -width * 1.35);
      g.lineTo(1.5, width * 1.35);
      g.stroke();
      g.beginPath();
      g.moveTo(-7, 0);
      g.lineTo(1.5, 0);
      g.stroke();
      // 柄巻き。
      g.globalAlpha *= 0.6;
      for (let i = 0; i < 3; i++) {
        g.beginPath();
        g.moveTo(-6 + i * 2, -1.1);
        g.lineTo(-4.8 + i * 2, 1.1);
        g.stroke();
      }
    };

    switch (glyph) {
      case '刀':
        // 反りの強い日本刀。剣 (諸刃) と見分けがつくよう、片刃の曲線で描く。
        g.beginPath();
        g.moveTo(2, -2.1);
        g.quadraticCurveTo(17, -5.4, 29, -0.4);
        g.quadraticCurveTo(20, 3.2, 2, 2.1);
        g.closePath();
        g.fill(); g.stroke();
        g.beginPath(); g.moveTo(1.5, -3.1); g.lineTo(1.5, 3.1); g.stroke();
        g.beginPath(); g.moveTo(-8, 0.4); g.lineTo(1.5, 0.4); g.stroke();
        g.globalAlpha *= 0.6;
        for (let i = 0; i < 3; i++) {
          g.beginPath(); g.moveTo(-7 + i * 2, -1); g.lineTo(-5.8 + i * 2, 1.6); g.stroke();
        }
        break;
      case '剣':
        g.fillStyle = color;
        blade(25, 2.3, 0.04);
        break;
      case '斧': {
        // 柄の先に、背の平らな大斧。刃こぼれは墨の線で刻む。
        g.beginPath(); g.moveTo(-11, 4); g.lineTo(11, -2); g.stroke();
        g.fillStyle = pale;
        g.beginPath();
        g.moveTo(6, -6);
        g.quadraticCurveTo(17, -15, 24, -3);
        g.quadraticCurveTo(17, 4, 7, 3);
        g.closePath();
        g.fill(); g.stroke();
        g.strokeStyle = color;
        g.lineWidth = 1.4;
        g.beginPath();
        g.moveTo(14, -9);
        g.quadraticCurveTo(19, -5, 16.5, -0.5);
        g.stroke();
        break;
      }
      case '槌': {
        // 柄の先に四角い頭。柄と頭をつなげて描き、宙に浮いて見せない。
        g.save();
        g.rotate(-0.22);
        g.beginPath(); g.moveTo(-13, 3); g.lineTo(13, 0); g.stroke();
        g.fillStyle = pale;
        g.fillRect(6, -9, 11, 18);
        g.strokeRect(6, -9, 11, 18);
        g.fillStyle = color;
        g.fillRect(9, -6.5, 3.2, 13);
        g.strokeStyle = ink;
        g.lineWidth = 1;
        g.beginPath(); g.moveTo(-13, 3); g.lineTo(-16, 4); g.stroke();
        g.restore();
        break;
      }
      case '槍': {
        // 直線の穂先。柄の長い突き武器。
        g.beginPath(); g.moveTo(-12, 0); g.lineTo(21, 0); g.stroke();
        g.fillStyle = pale;
        g.beginPath();
        g.moveTo(20, -3.2); g.lineTo(31, 0); g.lineTo(20, 3.2); g.closePath();
        g.fill(); g.stroke();
        g.strokeStyle = color;
        for (let i = 0; i < 3; i++) {
          g.beginPath(); g.moveTo(12 + i * 2.5, -3); g.lineTo(12 + i * 2.5, 3); g.stroke();
        }
        break;
      }
      case '矛': {
        // 矛は穂先が葉型で、柄が短く、石突が付く。
        g.beginPath(); g.moveTo(-4, 0); g.lineTo(14, 0); g.stroke();
        g.fillStyle = pale;
        g.beginPath();
        g.moveTo(13, -4.4);
        g.quadraticCurveTo(22, -4.2, 28, 0);
        g.quadraticCurveTo(22, 4.2, 13, 4.4);
        g.quadraticCurveTo(15, 0, 13, -4.4);
        g.closePath();
        g.fill(); g.stroke();
        g.fillStyle = color;
        g.beginPath(); g.arc(15, 0, 1.5, 0, TAU); g.fill();
        g.strokeStyle = ink;
        g.beginPath(); g.moveTo(-4, 0); g.lineTo(-7, 2.6); g.stroke();
        break;
      }
      case '弓': {
        g.strokeStyle = ink;
        g.lineWidth = 1.5;
        g.beginPath(); g.arc(2, 0, 12, -1.15, 1.15); g.stroke();
        g.strokeStyle = color;
        g.lineWidth = 1;
        g.beginPath(); g.moveTo(6.5, -11); g.lineTo(-3, 0); g.lineTo(6.5, 11); g.stroke();
        g.strokeStyle = ink;
        g.beginPath(); g.moveTo(-2, -2); g.lineTo(12, 0); g.lineTo(-2, 2); g.stroke();
        break;
      }
      case '銃': {
        // 真上から見た拳銃。銃身 (スライド) が +X、握りは後ろ (-X) へ伸びる。
        // 横から見た絵にしないよう、銃身の軸を挟んで上下対称に描く。
        // 照星・照門と、スライド後部の刻みで「上から見ている」ことを示す。
        g.fillStyle = pale;
        g.beginPath();
        g.moveTo(-9.0, -3.4);
        g.lineTo(-2.4, -3.0);
        g.lineTo(15.4, -2.5);
        g.lineTo(18.0, -1.5);
        g.lineTo(18.0, 1.5);
        g.lineTo(15.4, 2.5);
        g.lineTo(-2.4, 3.0);
        g.lineTo(-9.0, 3.4);
        g.quadraticCurveTo(-11.6, 0, -9.0, -3.4);
        g.closePath();
        g.fill(); g.stroke();
        // スライド後部の刻み。
        g.lineWidth = 0.8;
        for (let i = 0; i < 3; i++) {
          const x = -4.2 + i * 1.9;
          g.beginPath(); g.moveTo(x, -2.7); g.lineTo(x, 2.7); g.stroke();
        }
        g.lineWidth = 1.2;
        // 銃身の色の帯。
        g.fillStyle = color;
        g.fillRect(2.0, -1.3, 12.0, 2.6);
        // 銃口。
        g.fillStyle = ink;
        g.beginPath(); g.ellipse(17.3, 0, 0.9, 1.2, 0, 0, TAU); g.fill();
        // 照星 (前) と照門 (後ろ、左右 2 つ)。
        g.fillStyle = color;
        g.beginPath(); g.arc(13.4, 0, 0.8, 0, TAU); g.fill();
        g.beginPath(); g.arc(-5.6, -1.7, 0.6, 0, TAU); g.fill();
        g.beginPath(); g.arc(-5.6, 1.7, 0.6, 0, TAU); g.fill();
        break;
      }
      case '鋏': {
        // 真上から見た鋏。要 (軸) を中心に、二枚の刃が前へ少し開き、
        // 握りの輪が後ろへ開く。上下 (左右) を対称に描く。
        for (const side of [-1, 1]) {
          // 刃。要から前へ、外へ開きながら細くなる楔。
          g.fillStyle = pale;
          g.beginPath();
          g.moveTo(1.0, side * 0.2);
          g.lineTo(12.0, side * 2.2);
          g.lineTo(20.6, side * 3.6);
          g.lineTo(19.6, side * 1.9);
          g.lineTo(11.4, side * 0.5);
          g.closePath();
          g.fill(); g.stroke();
          // 刃の峰 (片刃に見せる)。
          g.strokeStyle = color;
          g.lineWidth = 0.9;
          g.beginPath();
          g.moveTo(2.4, side * 1.2);
          g.lineTo(18.2, side * 2.9);
          g.stroke();
          g.strokeStyle = ink;
          g.lineWidth = 1.2;
          // 柄と握りの輪。刃とは逆向きに開く。
          g.beginPath();
          g.moveTo(-0.4, side * 0.3);
          g.lineTo(-6.4, side * 2.6);
          g.stroke();
          g.beginPath();
          g.ellipse(-9.8, side * 4.0, 3.4, 2.3, 0, 0, TAU);
          g.stroke();
        }
        // 要 (軸) の鋲。
        g.fillStyle = color;
        g.beginPath(); g.arc(0, 0, 1.9, 0, TAU); g.fill(); g.stroke();
        break;
      }
      case '鋸': {
        // 真上から見た鋸。細長い刃の片側に歯を並べ、後ろに柄が付く。
        // 歯を片側だけに出すことで、剣や鉈と見分けがつく。
        g.fillStyle = pale;
        g.beginPath();
        g.moveTo(-2.0, -3.0);
        g.lineTo(20.0, -2.2);
        g.lineTo(20.0, 0.2);
        g.lineTo(-2.0, 1.0);
        g.closePath();
        g.fill(); g.stroke();
        // 歯。
        for (let i = 0; i < 7; i++) {
          const x = 3.4 + i * 2.4;
          g.beginPath();
          g.moveTo(x, 0.9);
          g.lineTo(x + 1.1, 3.0);
          g.lineTo(x + 2.2, 0.9);
          g.closePath();
          g.fill(); g.stroke();
        }
        // 柄。
        g.beginPath();
        g.moveTo(-2.2, -3.2);
        g.lineTo(-11.4, -2.6);
        g.quadraticCurveTo(-12.6, 0, -11.4, 2.2);
        g.lineTo(-2.2, 1.2);
        g.closePath();
        g.fill(); g.stroke();
        g.fillStyle = color;
        g.beginPath(); g.arc(-3.0, -1.2, 1.1, 0, TAU); g.fill();
        break;
      }
      case '針': {
        g.fillStyle = pale;
        g.beginPath(); g.moveTo(-7, 0); g.lineTo(19, -0.8); g.lineTo(24, 0);
        g.lineTo(19, 0.8); g.closePath(); g.fill(); g.stroke();
        g.fillStyle = color;
        g.beginPath(); g.arc(-6, 0, 2, 0, TAU); g.fill();
        break;
      }
      case '爪': {
        // 3 本の鉤爪。先を尖らせ、墨で縁を締める。
        for (const [lw, col] of [[3.8, ink], [2.1, pale]]) {
          g.strokeStyle = col;
          g.lineWidth = lw;
          g.lineCap = 'round';
          for (let i = 0; i < 3; i++) {
            const y0 = -6 + i * 6;
            g.beginPath();
            g.moveTo(-1, y0);
            g.quadraticCurveTo(10, y0 - 3.5, 15 - i, y0 + 3.2 + i * 1.1);
            g.lineTo(22 - i * 2.4, y0 - 1.5 + i * 1.6);
            g.stroke();
          }
        }
        g.fillStyle = color;
        g.beginPath(); g.arc(-3, 0, 1.7, 0, TAU); g.fill();
        break;
      }
      case '牙': {
        // 上下の牙。付け根は太く、先へ細く尖らせる。
        g.fillStyle = pale;
        for (const side of [-1, 1]) {
          g.beginPath();
          g.moveTo(-6, side * 1.4);
          g.quadraticCurveTo(4, side * 6.4, 20, side * 0.6);
          g.quadraticCurveTo(5, side * 2.4, -6, side * 3.4);
          g.closePath();
          g.fill(); g.stroke();
          g.strokeStyle = color;
          g.lineWidth = 0.9;
          g.beginPath();
          g.moveTo(-4, side * 2.2);
          g.quadraticCurveTo(6, side * 4.2, 17, side * 1.1);
          g.stroke();
          g.strokeStyle = ink;
          g.lineWidth = 1.2;
        }
        g.fillStyle = color;
        g.beginPath(); g.arc(-8, 0, 1.7, 0, TAU); g.fill();
        break;
      }
      case '拳': {
        // 握った拳。こぶしの山を 3 つ並べる。
        g.fillStyle = pale;
        g.beginPath();
        g.moveTo(-2, -6.5);
        g.quadraticCurveTo(7, -8.5, 10.5, -4);
        g.quadraticCurveTo(12.5, 0, 9.5, 4.5);
        g.quadraticCurveTo(5, 8, -2, 6.5);
        g.quadraticCurveTo(-5, 0, -2, -6.5);
        g.closePath();
        g.fill(); g.stroke();
        g.strokeStyle = ink;
        g.lineWidth = 1.1;
        for (let i = 0; i < 3; i++) {
          g.beginPath();
          g.arc(4.5, -4 + i * 4, 3.4, -1.2, 1.2);
          g.stroke();
        }
        g.fillStyle = color;
        g.beginPath(); g.arc(-1, -4, 1.5, 0, TAU); g.fill();
        break;
      }
      case '杖': {
        g.beginPath(); g.moveTo(-12, 3); g.lineTo(17, -3); g.stroke();
        g.fillStyle = pale;
        g.beginPath(); g.arc(19, -4, 4.5, 0, TAU); g.fill(); g.stroke();
        g.fillStyle = color;
        g.globalAlpha *= 0.8;
        g.beginPath(); g.arc(19, -4, 2.2, 0, TAU); g.fill();
        break;
      }
      case '鎖': {
        // 鎖は墨の輪を連ねる。紙色だけでは紙に溶けるので墨で描く。
        g.strokeStyle = ink;
        g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(-8, 0); g.lineTo(2, 0); g.stroke();
        for (let i = 0; i < 5; i++) {
          g.beginPath();
          g.ellipse(4 + i * 4.4, (i % 2 ? -2 : 2), 2.6, 1.5, i % 2 ? 0.5 : -0.5, 0, TAU);
          g.stroke();
        }
        g.fillStyle = color;
        g.beginPath(); g.arc(-2, 0, 1.5, 0, TAU); g.fill();
        break;
      }
      case '鞭': {
        // 鞭は皮の帯。墨の縁で紙から起こす。
        g.strokeStyle = ink;
        g.lineWidth = 3.6;
        g.beginPath(); g.moveTo(-8, 0); g.lineTo(2, 0); g.stroke();
        g.strokeStyle = pale;
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(2, 0);
        for (let i = 1; i <= 4; i++) g.lineTo(2 + i * 4, (i % 2 ? -3 : 3));
        g.stroke();
        g.strokeStyle = color;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(2, 0);
        for (let i = 1; i <= 4; i++) g.lineTo(2 + i * 4, (i % 2 ? -3 : 3));
        g.stroke();
        break;
      }
      case '環': {
        // 環は太い輪に宝玉。
        g.strokeStyle = pale; g.lineWidth = 3.4;
        g.beginPath(); g.arc(5, 0, 8, 0, TAU); g.stroke();
        g.strokeStyle = ink; g.lineWidth = 1;
        g.beginPath(); g.arc(5, 0, 8, 0, TAU); g.stroke();
        g.fillStyle = color;
        g.beginPath(); g.arc(5, 0, 1.8, 0, TAU); g.fill();
        break;
      }
      case '輪': {
        // 輪は車輪。輻 (スポーク) を入れて環と分ける。
        g.strokeStyle = pale; g.lineWidth = 2.4;
        g.beginPath(); g.arc(5, 0, 8, 0, TAU); g.stroke();
        g.strokeStyle = ink; g.lineWidth = 1;
        g.beginPath(); g.arc(5, 0, 8, 0, TAU); g.stroke();
        for (let i = 0; i < 6; i++) {
          const aa = (i / 6) * TAU;
          g.beginPath();
          g.moveTo(5, 0);
          g.lineTo(5 + Math.cos(aa) * 8, Math.sin(aa) * 8);
          g.stroke();
        }
        break;
      }
      case '還':
      case '玉':
      case '球': {
        g.fillStyle = pale;
        g.beginPath(); g.arc(7, 0, 6, 0, TAU); g.fill(); g.stroke();
        g.fillStyle = color;
        g.globalAlpha *= 0.75;
        g.beginPath(); g.arc(7, 0, 3, 0, TAU); g.fill();
        break;
      }
      case '弾':
      case '爆': {
        g.fillStyle = pale;
        g.beginPath(); g.ellipse(4, 0, 7, 4.5, 0, 0, TAU); g.fill(); g.stroke();
        g.fillStyle = color;
        g.beginPath(); g.arc(-1, -1, 1.8, 0, TAU); g.fill();
        break;
      }
      case '光': {
        // 光は十字の光条。
        g.strokeStyle = color;
        g.lineWidth = 1.6;
        for (let i = 0; i < 4; i++) {
          const aa = (i / 4) * TAU + Math.PI / 4;
          const len = i % 2 ? 9 : 15;
          g.beginPath();
          g.moveTo(Math.cos(aa) * 3, Math.sin(aa) * 3);
          g.lineTo(Math.cos(aa) * len, Math.sin(aa) * len);
          g.stroke();
        }
        g.fillStyle = pale;
        g.beginPath(); g.arc(0, 0, 4.6, 0, TAU); g.fill(); g.stroke();
        break;
      }
      case '雷': {
        // 雷は稲妻の折れ線。
        g.fillStyle = pale;
        g.beginPath();
        g.moveTo(2, -8); g.lineTo(-5, 1); g.lineTo(-0.5, 1);
        g.lineTo(-2, 9); g.lineTo(7, -1); g.lineTo(2, -1);
        g.closePath();
        g.fill(); g.stroke();
        g.fillStyle = color;
        g.globalAlpha *= 0.7;
        g.beginPath();
        g.moveTo(1, -5); g.lineTo(-2, 0); g.lineTo(1, 0); g.lineTo(0, 5);
        g.lineTo(3.6, 0); g.lineTo(1, 0);
        g.closePath(); g.fill();
        break;
      }
      case '渦': {
        // 渦は螺旋。
        g.strokeStyle = color;
        g.lineWidth = 1.4;
        g.beginPath();
        for (let i = 0; i <= 40; i++) {
          const f = i / 40;
          const aa = f * TAU * 1.8;
          const rr = 1.5 + f * 10;
          const x = Math.cos(aa) * rr, y = Math.sin(aa) * rr;
          if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.stroke();
        break;
      }
      case '鉄球': {
        // 鎖の先の鉄の塊。球そのものが武器。
        g.strokeStyle = ink;
        g.lineWidth = 1.4;
        for (let i = 0; i < 4; i++) {
          g.beginPath();
          g.arc(-9 - i * 3.6, Math.sin(i * 1.9) * 1.4, 1.5, 0, TAU);
          g.stroke();
        }
        g.fillStyle = pale;
        g.beginPath(); g.arc(6, 0, 8.4, 0, TAU); g.fill(); g.stroke();
        g.strokeStyle = 'rgba(28, 35, 49, .5)';
        g.lineWidth = 1;
        g.beginPath(); g.arc(6, 0, 5.4, 0.6, 2.4); g.stroke();
        g.fillStyle = color;
        g.globalAlpha *= 0.75;
        g.beginPath(); g.arc(8.5, 1.5, 2.6, 0, TAU); g.fill();
        break;
      }
      case '双剣': {
        // 二刀。同じ形の刃を上下に並べる。
        g.save();
        g.translate(0, -3.4);
        g.fillStyle = color;
        blade(21, 1.9, 0.03);
        g.restore();
        g.save();
        g.translate(0, 3.4);
        g.fillStyle = color;
        blade(21, 1.9, 0.03);
        g.restore();
        break;
      }
      case '分身': {
        // 式神。炎の形をした小さな霊。
        g.fillStyle = pale;
        g.beginPath();
        g.moveTo(9, 0);
        g.quadraticCurveTo(4, -9, -3, -6);
        g.quadraticCurveTo(-11, -2, -6, 0);
        g.quadraticCurveTo(-11, 2, -3, 6);
        g.quadraticCurveTo(4, 9, 9, 0);
        g.closePath();
        g.fill(); g.stroke();
        g.fillStyle = color;
        g.globalAlpha *= 0.8;
        g.beginPath();
        g.ellipse(1, 0, 3.4, 4.4, 0, 0, TAU);
        g.fill();
        break;
      }
      default:
        blade(23, 2.2, 0.06);
        break;
    }
    g.restore();
  }

  /**
   * 打撃の軌跡。**当たり判定の扇 (m.arc) と間合い (m.reach) の内側だけ**を描く。
   * 武器種 (style) ごとに軌跡の作り方を変える。
   *   wave    … 刃を離れた三日月が、扇の外周まで飛ぶ (刃)
   *   sweep   … 扇の端から端へ、左右に振り抜く (刀)
   *   forward … 正面へ短く斬り込み、前へ線が走る (剣)
   *   arc / claw / smash / punch / bite     … それぞれの弧
   *   thrust  … 突きは弧ではなく、前へ伸びる線 (槍・矛)
   * 予備動作では軌跡を出さず、打撃の瞬間から墨と色が走る。
   */
  drawMotionSlash(s, run) {
    const g = this.ctx;
    const m = s.motion;
    const pose = motionPose(m);
    if (!pose) return;
    const family = m.family || 'slash';
    const style = m.style || 'arc';
    const color = s.color || m.color || '#d4a94e';
    // 描画に使う半径と扇は、当たり判定とまったく同じ値。
    const reach = Math.max(18, m.reach || s.r || 40);
    const arc = Number(m.arc) > 0.02 ? m.arc : (Number(s.arc) > 0.02 ? s.arc : Math.PI / 1.5);
    const aFrom = m.baseAim + m.from;
    const aTo = m.baseAim + m.to;
    const dir = Math.sign(aTo - aFrom) || 1;
    const head = pose.angle;
    const fade = pose.phase === 'recover' ? 1 - pose.phaseT : 1;

    g.save();
    g.globalCompositeOperation = 'source-over';
    g.lineCap = 'round';
    g.lineJoin = 'round';

    // 構え。まだ切っていないので、刃先がきらめくだけ。
    if (pose.phase === 'windup') {
      const a = aFrom;
      g.globalAlpha = 0.38 * pose.phaseT;
      g.fillStyle = '#fffdf7';
      g.beginPath();
      g.arc(s.x + Math.cos(a) * reach * 0.66, s.y + Math.sin(a) * reach * 0.66,
        1.2 + pose.phaseT * 1.8, 0, TAU);
      g.fill();
      g.restore();
      return;
    }
    if (fade <= 0.01) {
      g.restore();
      return;
    }

    if (family === 'thrust') {
      // 突き。角度を振らず、前へ伸びる線で見せる。
      const ext = clamp(pose.extension, 0.4, 1.1);
      const r0 = reach * 0.3 * ext;
      const r1 = reach * ext;
      const a = head;
      for (const [lw, col, al] of [
        [6.5, 'rgba(28, 35, 49, .38)', 0.5],
        [4.0, 'rgba(255, 253, 247, .9)', 0.8],
        [1.8, color, 0.92],
      ]) {
        g.globalAlpha = al * fade;
        g.strokeStyle = col;
        g.lineWidth = lw;
        g.beginPath();
        g.moveTo(s.x + Math.cos(a) * r0, s.y + Math.sin(a) * r0);
        g.lineTo(s.x + Math.cos(a) * r1, s.y + Math.sin(a) * r1);
        g.stroke();
      }
      g.globalAlpha = 0.8 * fade * (0.4 + pose.impact);
      g.fillStyle = '#fffdf7';
      g.beginPath();
      g.arc(s.x + Math.cos(a) * r1, s.y + Math.sin(a) * r1, 2 + pose.impact * 2, 0, TAU);
      g.fill();
      g.restore();
      return;
    }

    // 当たる範囲。扇の外周を細い一線で示す。軌跡はこの内側だけを走る。
    g.globalAlpha = 0.15 * fade * (1 + pose.flash * 0.5);
    g.strokeStyle = color;
    g.lineWidth = 1;
    g.beginPath();
    g.arc(s.x, s.y, reach, m.baseAim - arc / 2, m.baseAim + arc / 2);
    g.stroke();
    if (style !== 'wave') {
      // 扇の両端に、刃が通る目安の刻み。
      g.globalAlpha = 0.22 * fade;
      for (const sgn of [-1, 1]) {
        const a = m.baseAim + sgn * arc / 2;
        g.beginPath();
        g.moveTo(s.x + Math.cos(a) * reach * 0.88, s.y + Math.sin(a) * reach * 0.88);
        g.lineTo(s.x + Math.cos(a) * reach, s.y + Math.sin(a) * reach);
        g.stroke();
      }
    }

    if (style === 'wave') {
      this.drawWaveTrail(g, s, m, pose, reach, arc, color, fade);
    } else if (style === 'sweep') {
      this.drawSweepTrail(g, s, m, pose, reach, color, aFrom, head, dir, fade);
    } else {
      this.drawArcTrail(g, s, m, pose, reach, color, aFrom, head, dir, style, family, fade);
    }

    // 刃先の光。打撃中ほど強い。
    if (!(style === 'wave' && pose.fly < 0.9) && (pose.phase === 'strike' || pose.impact > 0.03)) {
      const tipR = reach * 0.985;
      g.globalAlpha = (0.5 + pose.impact * 0.4) * fade;
      g.fillStyle = '#fffdf7';
      g.beginPath();
      g.arc(s.x + Math.cos(head) * tipR, s.y + Math.sin(head) * tipR,
        2.2 + pose.impact * 2.6, 0, TAU);
      g.fill();
      g.globalAlpha *= 0.5;
      g.strokeStyle = color;
      g.lineWidth = 1.2;
      g.beginPath();
      g.arc(s.x, s.y, tipR, head - 0.16 * dir, head + 0.09 * dir, dir < 0);
      g.stroke();
    }

    // 槌・大剣は地面を打つ。着弾の輪を足す (扇の内側に置く)。
    if ((style === 'smash') && pose.impact > 0.02) {
      g.globalAlpha = pose.impact * 0.5;
      g.strokeStyle = 'rgba(120, 92, 48, .8)';
      g.lineWidth = 1.5 + pose.impact * 2;
      g.beginPath();
      g.ellipse(s.x + Math.cos(m.baseAim) * reach * 0.62,
        s.y + Math.sin(m.baseAim) * reach * 0.62,
        reach * 0.17 * (1.5 - pose.impact), reach * 0.075 * (1.5 - pose.impact), m.baseAim, 0, TAU);
      g.stroke();
    }

    // 属性の名残。軌跡の縁に小さな粒を散らす (扇の内側)。
    if (pose.phase === 'strike') {
      const el = m.el || 'none';
      const n = el === 'none' ? 2 : 5;
      for (let i = 0; i < n; i++) {
        const aa = head - dir * (i + 1) * 0.08;
        const rr = reach * (0.8 + (i % 3) * 0.06);
        g.globalAlpha = (0.45 - i * 0.06) * fade;
        g.fillStyle = i === 0 ? '#fffdf7' : color;
        g.beginPath();
        g.arc(s.x + Math.cos(aa) * rr, s.y + Math.sin(aa) * rr, 1.1 + (i % 2), 0, TAU);
        g.fill();
      }
    }
    g.restore();
  }

  /** 弧の帯を、墨の縁・紙を抜く白・武器色の芯の 3 層で引く。 */
  bandArc(x, y, r, from, to, wK, color, alpha) {
    if (!(alpha > 0.002) || Math.abs(to - from) < 1e-4) return;
    const g = this.ctx;
    const ccw = to < from;
    const layers = [
      [12.5 * wK, 'rgba(28, 35, 49, .5)', 0.52],
      [8.8 * wK, 'rgba(255, 253, 247, .92)', 0.8],
      [4.2 * wK, color, 0.86],
    ];
    for (const [lw, col, k] of layers) {
      g.globalAlpha = alpha * k;
      g.strokeStyle = col;
      g.lineWidth = Math.max(0.5, lw);
      g.beginPath();
      g.arc(x, y, r, from, to, ccw);
      g.stroke();
    }
  }

  /**
   * 刃 (style: wave) の斬撃波。刃を離れた三日月が、手元から扇の外周 = 間合いまで
   * 飛びながら広がる。飛び切ったとき、弧の角度は扇 (arc)、半径は間合い (reach) に
   * ちょうど重なるので、見えた範囲がそのまま当たる範囲になる。
   */
  drawWaveTrail(g, s, m, pose, reach, arc, color, fade) {
    const fly = clamp(pose.fly || 0, 0, 1);
    const grow = clamp(fly * 1.5, 0, 1);
    const r = reach * (0.18 + 0.82 * fly);
    const span = arc * (1 - (1 - grow) ** 3);
    const from = m.baseAim - span / 2;
    const to = m.baseAim + span / 2;
    // 飛んだ跡を薄く残す。切った範囲がそのまま読める。
    g.globalAlpha = 0.09 * fade * fly;
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(s.x, s.y);
    g.arc(s.x, s.y, r, from, to);
    g.closePath();
    g.fill();
    // 三日月。頭ほど濃く、後ろの波ほど薄く小さく。
    for (let i = 2; i >= 0; i--) {
      const rr = r * (1 - i * 0.11);
      const w = span * (1 - i * 0.1);
      const al = (i === 0 ? 0.95 : 0.4 / i) * fade * (0.3 + 0.7 * fly);
      this.bandArc(s.x, s.y, rr, m.baseAim - w / 2, m.baseAim + w / 2,
        0.95 - i * 0.18, color, al);
    }
    // 波の先端だけ、紙から浮かせる白。
    if (span > 0.01) {
      g.globalAlpha = 0.7 * fade * fly;
      g.strokeStyle = 'rgba(255, 253, 247, .95)';
      g.lineWidth = 1.4;
      g.beginPath();
      g.arc(s.x, s.y, r * 1.005, from, to);
      g.stroke();
    }
    // 飛び出す瞬間、手元に残る残光。
    g.globalAlpha = (1 - fly) * 0.5 * fade;
    g.fillStyle = '#fffdf7';
    g.beginPath();
    g.arc(s.x, s.y, 2 + (1 - fly) * 5, 0, TAU);
    g.fill();
  }

  /**
   * 刀 (style: sweep) の薙ぎ。扇の端から端まで、左右へ振り抜く。
   * 尾は薄く、刃先ほど濃い帯で、通り過ぎた範囲をそのまま見せる。
   */
  drawSweepTrail(g, s, m, pose, reach, color, aFrom, head, dir, fade) {
    const wK = 1.3;
    // 薙いだ面。刃が通った角度のあいだだけ、薄く色を敷く。
    if (Math.abs(head - aFrom) > 1e-4) {
      g.globalAlpha = 0.08 * fade;
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(s.x, s.y);
      g.arc(s.x, s.y, reach, aFrom, head, head < aFrom);
      g.closePath();
      g.fill();
    }
    this.taperArc(s.x, s.y, reach * 0.99, aFrom, head, wK, color, 0.95 * fade, 9);
    // 振り抜けの残響。扇の内側に細い二本目。
    this.taperArc(s.x, s.y, reach * 0.62, aFrom, head, 0.32, color, 0.3 * fade, 7);
    // 刃の通り道を、扇の外周に沿って墨で締める。
    g.globalAlpha = 0.35 * fade;
    g.strokeStyle = 'rgba(28, 35, 49, .5)';
    g.lineWidth = 1.2;
    g.beginPath();
    g.arc(s.x, s.y, reach * 0.99, aFrom, head, head < aFrom);
    g.stroke();
    // 振り切った側の土煙。左右どちらへ振ったかが読める。
    if (pose.phase !== 'strike') {
      g.globalAlpha = 0.3 * fade;
      g.fillStyle = 'rgba(120, 92, 48, .7)';
      for (let i = 0; i < 3; i++) {
        const a = head + dir * (0.05 + i * 0.09);
        g.beginPath();
        g.arc(s.x + Math.cos(a) * reach * 0.94, s.y + Math.sin(a) * reach * 0.94,
          1.2 + i * 0.7, 0, TAU);
        g.fill();
      }
    }
  }

  /**
   * 標準の弧 (style: arc / claw / smash / punch / bite)。
   * 振り始めから刃先までを削って描く。
   */
  drawArcTrail(g, s, m, pose, reach, color, aFrom, head, dir, style, family, fade) {
    const passes = family === 'claw' ? Math.max(1, m.passes) : 1;
    const wK = family === 'claw' ? 0.34
      : family === 'punch' || family === 'bite' ? 0.55
        : style === 'smash' ? 1.35 : 0.95;
    // 重い一振り (剣・槌) は、振り始めから刃先まで扇を丸ごと見せる。
    // 速い連撃 (爪・牙・拳・汎用の刃) は、短い残像の streak で速さを出す。
    const heavy = style === 'forward' || style === 'smash';
    if (heavy && Math.abs(head - aFrom) > 1e-4) {
      // 切った面を薄く敷く。扇の内側だけ。
      g.globalAlpha = 0.07 * fade;
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(s.x, s.y);
      g.arc(s.x, s.y, reach, aFrom, head, head < aFrom);
      g.closePath();
      g.fill();
    }
    // 爪は 3 本。鉤爪の間隔を空けて、通った跡を並べる。
    for (let p = 0; p < passes; p++) {
      const lag = p * 0.13;
      const h = head - dir * lag;
      const tail = heavy
        ? Math.abs(h - aFrom)
        : Math.min(0.62 + (family === 'claw' ? 0.3 : 0.12), Math.abs(h - aFrom));
      const from = h - dir * tail;
      this.taperArc(s.x, s.y, reach * (1 - p * 0.05), from, h, wK * (1 - p * 0.1), color,
        (0.95 - p * 0.12) * fade, heavy ? 9 : 6);
    }
    // 剣は「前へ出る」動きで見せる。弧に加えて、正面へ短い一線と、
    // 刃先が前方 (照準の方向) へ走る光。刀の左右の薙ぎと動きが分かれる。
    if (style === 'forward') {
      const a = m.baseAim;
      const run0 = pose.phase === 'windup' ? 0.3 : 0.3 + 0.66 * clamp(pose.t, 0, 1);
      g.globalAlpha = 0.5 * fade;
      g.strokeStyle = 'rgba(255, 253, 247, .95)';
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(s.x + Math.cos(a) * reach * 0.26, s.y + Math.sin(a) * reach * 0.26);
      g.lineTo(s.x + Math.cos(a) * reach * run0, s.y + Math.sin(a) * reach * run0);
      g.stroke();
      g.globalAlpha = 0.7 * fade;
      g.strokeStyle = color;
      g.lineWidth = 0.8;
      g.beginPath();
      g.moveTo(s.x + Math.cos(a) * reach * 0.3, s.y + Math.sin(a) * reach * 0.3);
      g.lineTo(s.x + Math.cos(a) * reach * (run0 - 0.03), s.y + Math.sin(a) * reach * (run0 - 0.03));
      g.stroke();
      // 前へ走る刃先。
      const tipR = reach * run0;
      g.globalAlpha = (0.55 + pose.flash * 0.4) * fade;
      g.fillStyle = '#fffdf7';
      g.beginPath();
      g.arc(s.x + Math.cos(a) * tipR, s.y + Math.sin(a) * tipR, 1.8 + pose.flash * 2.2, 0, TAU);
      g.fill();
    }
  }

  /** 振り始めから刃先までの帯。頭ほど濃く太く、尾ほど薄く細い。 */
  taperArc(x, y, r, from, head, wK, color, alpha, segs = 7) {
    const span = head - from;
    if (!(alpha > 0.002) || Math.abs(span) < 1e-4) return;
    for (let i = 0; i < segs; i++) {
      const t0 = i / segs;
      const t1 = (i + 1) / segs;
      const mid = (t0 + t1) / 2;
      const b0 = from + span * t0;
      const b1 = from + span * t1;
      const k = 0.35 + 0.65 * mid;
      this.bandArc(x, y, r, b0, b1, wK * (0.55 + 0.45 * mid), color, alpha * k);
    }
  }

  /**
   * 鞭の渦 (kind: whip)。手元から外へらせん状に伸びる鞭の線。
   * 当たり (spiralTick) は、この帯の先端の位置で刻まれる。
   */
  drawWhipSpiral(s, run) {
    const g = this.ctx;
    const maxLife = s.maxLife || 0.6;
    const p = clamp(1 - s.life / maxLife, 0, 1);
    const fade = p < 0.85 ? 1 : 1 - (p - 0.85) / 0.15;
    const turns = s.turns || 2.2;
    const reach = s.reach || 100;
    const color = s.color || '#d4a94e';
    // 渦の先端から、少し後ろまでを描く。尻尾ほど細く薄い。
    const head = p;
    const tail = Math.max(0, head - 0.5);
    const pt = (f) => {
      const a = (s.baseAim || 0) + turns * TAU * f;
      const r = reach * f;
      return { x: s.x + Math.cos(a) * r, y: s.y + Math.sin(a) * r };
    };
    g.save();
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const N = 30;
    // 墨の縁 → 紙を抜く白 → 色の芯。鞭のしなりを 3 本のらせんで作る。
    for (const [lw, col, al] of [
      [6.2, 'rgba(28, 35, 49, .48)', 0.5],
      [4.4, 'rgba(255, 253, 247, .92)', 0.82],
      [2.1, color, 0.9],
    ]) {
      g.globalAlpha = al * fade;
      g.strokeStyle = col;
      g.lineWidth = lw;
      g.beginPath();
      for (let i = 0; i <= N; i++) {
        const f = tail + (head - tail) * (i / N);
        const q = pt(f);
        if (i === 0) g.moveTo(q.x, q.y); else g.lineTo(q.x, q.y);
      }
      g.stroke();
    }
    // 鞭先。先ほど濃く、光る。
    const tip = pt(head);
    g.globalAlpha = (0.75 + 0.25 * Math.sin(run.t * 30)) * fade;
    g.fillStyle = '#fffdf7';
    g.beginPath();
    g.arc(tip.x, tip.y, 2.4, 0, TAU);
    g.fill();
    g.globalAlpha = 0.55 * fade;
    g.strokeStyle = color;
    g.lineWidth = 1.3;
    g.beginPath();
    g.arc(tip.x, tip.y, 4.6, 0, TAU);
    g.stroke();
    // 通った跡。渦全体を、うっすらと一本で締める。
    g.globalAlpha = 0.14 * fade;
    g.strokeStyle = color;
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 0; i <= 60; i++) {
      const f = (i / 60) * head;
      const q = pt(f);
      if (i === 0) g.moveTo(q.x, q.y); else g.lineTo(q.x, q.y);
    }
    g.stroke();
    g.restore();
  }

  /** 鞭・鎖の一振り。輪ではなく、しなる線として描く。 */
  drawWhipMotion(s, run) {
    const g = this.ctx;
    const m = s.motion;
    const pose = motionPose(m);
    if (!pose) return;
    const fade = pose.phase === 'recover' ? 1 - pose.phaseT * 0.7 : 1;
    const color = s.color || m.color || '#d4a94e';
    const dir = Math.sign(m.to - m.from) || 1;
    // 振り始めから現在までの角度。鞭は腕より先に走る。
    const sweep = pose.phase === 'windup'
      ? 0.25 + pose.phaseT * 0.35
      : (pose.phase === 'strike' ? 0.6 + pose.swing * 4.3 : 4.9 + pose.follow * 0.5);
    const a0 = m.baseAim + m.from;
    const reach = Math.max(28, s.r * (0.72 + 0.28 * Math.min(1, sweep / 5)));
    const link = m.key === 'chain';

    const point = (f) => {
      const aa = a0 + dir * sweep * f;
      const rr = reach * (0.32 + 0.68 * f);
      const wob = Math.sin(f * Math.PI * (link ? 4 : 3) + run.t * 9) * reach * 0.035 * f;
      return { x: s.x + Math.cos(aa) * (rr + wob), y: s.y + Math.sin(aa) * (rr + wob), a: aa };
    };

    if (pose.phase !== 'windup') {
      g.save();
      g.lineCap = 'round';
      g.lineJoin = 'round';
      // 墨の縁 → 紙の白 → 色の芯。鞭のしなりを 3 本の曲線で作る。
      for (const [lw, col, al] of [
        [7.5, 'rgba(28, 35, 49, .42)', 0.55],
        [4.6, 'rgba(255, 253, 247, .95)', 0.85],
        [2.3, color, 0.9],
      ]) {
        g.globalAlpha = al * fade;
        g.strokeStyle = col;
        g.lineWidth = lw;
        g.beginPath();
        for (let i = 0; i <= 18; i++) {
          const pt = point(i / 18);
          if (i === 0) g.moveTo(pt.x, pt.y); else g.lineTo(pt.x, pt.y);
        }
        g.stroke();
      }

      if (link) {
        g.globalAlpha = 0.75 * fade;
        g.strokeStyle = 'rgba(28, 35, 49, .85)';
        g.lineWidth = 1;
        for (let i = 2; i <= 16; i += 2) {
          const pt = point(i / 18);
          g.beginPath();
          g.ellipse(pt.x, pt.y, 2.4, 1.2, pt.a, 0, TAU);
          g.stroke();
        }
      }

      // 鞭先。
      const tip = point(1);
      g.globalAlpha = 0.75 * fade;
      g.fillStyle = '#fffdf7';
      g.beginPath();
      g.arc(tip.x, tip.y, 2.1 + pose.flash * 1.4, 0, TAU);
      g.fill();
      g.restore();
    }

    // 外周の薄い波紋。輪ではなく、届いた範囲の余韻。
    if (pose.phase === 'strike' || pose.phase === 'follow') {
      g.save();
      g.globalAlpha = 0.16 * fade;
      g.strokeStyle = color;
      g.lineWidth = 1.2;
      g.setLineDash([4, 9]);
      g.beginPath();
      g.arc(s.x, s.y, reach, a0, a0 + dir * sweep, dir < 0);
      g.stroke();
      g.setLineDash([]);
      g.restore();
    }
  }

  // 武器の攻撃の実体。プレイヤーは武器を持たない — 手元に絵はなく、
  // 軌道刃 (orbit)・鉄球 (flail)・城壁 (aura) のように、それ自体が攻撃の
  // ものだけを描く。それ以外の攻撃は、斬撃・弾・光線・渦の演出が担う。
  drawWeaponSpirits(run) {
    const g = this.ctx, p = run.player;
    for (let i = 0; i < run.weapons.length; i++) {
      const wi = run.weapons[i];
      const report = run.weaponReport?.()[i];
      const res = wi._res || report?.res;
      if (!res || !res.active) continue;

      const glyph = KIND_GLYPH[res.kind] || res.tail || wi.def.glyph || wi.def.name || '刃';
      const color = res.elementInfo?.color || '#d4a94e';

      // ── 鉄球。鎖についた鉄の塊が、体のまわりを旋回する。 ──
      if (res.kind === 'flail') {
        const balls = wi.flailBalls || [];
        for (const ball of balls) {
          const dx = ball.x - p.x, dy = ball.y - p.y;
          const dl = Math.hypot(dx, dy) || 1;
          // 鎖。手元から球まで、小さな輪を並べる。遠心力で少し外に膨らむ。
          g.save();
          g.globalAlpha = 0.55;
          g.strokeStyle = 'rgba(28, 35, 49, .58)';
          g.lineWidth = 1.3;
          const nx = -dy / dl, ny = dx / dl;
          const seg = 6;
          for (let k = 1; k <= seg; k++) {
            const f = k / seg;
            const wob = Math.sin(f * Math.PI) * dl * 0.035;
            g.beginPath();
            g.arc(p.x + dx * f + nx * wob, p.y + dy * f + ny * wob, 1.5, 0, TAU);
            g.stroke();
          }
          g.restore();
          // 球。回転に合わせてくるりと向きが変わる。
          g.save();
          g.translate(ball.x, ball.y);
          g.rotate((ball.a || 0) + run.t * 4);
          g.shadowColor = color;
          g.shadowBlur = 6;
          this.drawWeaponGlyph(g, glyph, 1.2, color, 0.95);
          g.restore();
        }
        continue;
      }

      // ── 軌道刃。回り続ける刃そのものが攻撃の動き。 ──
      if (res.kind === 'orbit') {
        const reachK = clamp((res.stats.range || 90) / 92, 0.8, 1.9);
        const n = Math.max(1, Math.round((res.stats.orbit || 1) + 1));
        const radius = (44 + (res.stats.area || 0)) * (p.stats.size || 1)
          * (0.7 + (res.stats.size || 1) * 0.4);
        for (let k = 0; k < n; k++) {
          const a = wi.orbitAngle + (k / n) * TAU;
          const orbitScale = Math.sin(run.t * 7 + k) * 0.08;
          g.save();
          g.translate(p.x + Math.cos(a) * radius, p.y + Math.sin(a) * radius);
          g.rotate(a + run.t * 5.5);
          g.scale(0.95 + orbitScale, 0.95 + orbitScale);
          g.shadowColor = color;
          g.shadowBlur = 5;
          this.drawWeaponGlyph(g, glyph, 0.9 + reachK * 0.5, color, 0.9);
          g.restore();
        }
        continue;
      }

      // ── 常時展開する城壁。武器は体のまわりに浮かぶ護符。 ──
      if (res.kind === 'aura') {
        const reachK = clamp((res.stats.range || 90) / 92, 0.8, 1.9);
        const aim = wi.aim ?? p.faceVis ?? p.face;
        const radius = (p.stats.size || 1) * (p.r + 15);
        g.save();
        g.globalAlpha = 0.3 + 0.1 * Math.sin(run.t * 2.8 + i);
        g.strokeStyle = color;
        g.lineWidth = 1.2;
        g.setLineDash([2, 7]);
        g.lineDashOffset = -run.t * 18;
        g.beginPath();
        g.arc(p.x, p.y, radius, 0, TAU);
        g.stroke();
        g.setLineDash([]);
        g.globalAlpha = 0.58 + 0.12 * Math.sin(run.t * 3 + i);
        const a = aim + Math.PI * 0.5 + Math.sin(run.t * 1.3 + i) * 0.3;
        g.translate(p.x + Math.cos(a) * radius, p.y + Math.sin(a) * radius);
        g.rotate(a + Math.sin(run.t * 2) * 0.25);
        this.drawWeaponGlyph(g, glyph, 0.72 + reachK * 0.3, color, 0.9);
        g.restore();
        continue;
      }
    }
  }

  /**
   * 自律する分身 (式神)。敵を追いかけて自分で斬る。プレイヤーのそばに
   * いるときは漂い、敵へ向かうときは体を伸ばして走る。
   */
  drawHelpers(run) {
    const g = this.ctx;
    for (const h of run.helpers) {
      const born = clamp((h.born || 0) * 3, 0, 1);
      const speed = Math.hypot(h.vx, h.vy);
      const stretch = 1 + clamp(speed / 420, 0, 0.5);
      g.save();
      g.translate(h.x, h.y);
      g.rotate(h.face || 0);
      g.scale(stretch, 1 / stretch);
      // 墨の体。紙の上で白く縁取りして浮かせる。
      g.globalAlpha = 0.82 * born;
      g.fillStyle = 'rgba(255, 253, 247, .92)';
      g.beginPath();
      g.ellipse(0, 0, h.r + 2.6, (h.r + 2.6) / stretch, 0, 0, TAU);
      g.fill();
      g.globalAlpha = 0.9 * born;
      g.fillStyle = '#1c2331';
      g.beginPath();
      g.ellipse(0, 0, h.r, h.r / stretch, 0, 0, TAU);
      g.fill();
      // 攻撃の瞬間は色の芯が光る。
      if (h.atkT > 0) {
        g.globalAlpha = clamp(h.atkT / 0.18, 0, 1) * 0.85;
        g.fillStyle = h.color || '#d4a94e';
        g.beginPath();
        g.ellipse(0, 0, h.r * 0.62, (h.r * 0.62) / stretch, 0, 0, TAU);
        g.fill();
      }
      g.restore();
      // 進行方向の目。
      g.save();
      g.globalAlpha = 0.9 * born;
      g.fillStyle = '#fdfbf4';
      g.beginPath();
      g.arc(h.x + Math.cos(h.face || 0) * h.r * 0.45,
        h.y + Math.sin(h.face || 0) * h.r * 0.45, h.r * 0.22, 0, TAU);
      g.fill();
      g.restore();
      // 残像の尾。速く走っているときだけ伸びる。
      if (speed > 130) {
        g.save();
        g.globalAlpha = clamp(speed / 700, 0, 0.4) * born;
        g.strokeStyle = h.color || '#d4a94e';
        g.lineWidth = 1.6;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(h.x - Math.cos(h.face || 0) * h.r, h.y - Math.sin(h.face || 0) * h.r);
        g.lineTo(h.x - Math.cos(h.face || 0) * (h.r + speed * 0.05),
          h.y - Math.sin(h.face || 0) * (h.r + speed * 0.05));
        g.stroke();
        g.restore();
      }
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

      // 属性の細部。風は線がしなり、光は光条が走る。
      const el = b.el || 'none';
      if (el === 'wind') {
        g.globalAlpha = t * 0.4;
        g.strokeStyle = 'rgba(255, 253, 247, .9)';
        g.lineWidth = 1;
        for (let i = 0; i < 2; i++) {
          const off = (i ? 1 : -1) * (b.w * 0.7 + 3);
          g.beginPath();
          for (let k = 0; k <= 8; k++) {
            const f = k / 8;
            const wob = Math.sin(f * 9 + run.t * 11 + i) * b.w * 0.22;
            const px = b.x + Math.cos(b.a) * b.len * f - Math.sin(b.a) * (off + wob);
            const py = b.y + Math.sin(b.a) * b.len * f + Math.cos(b.a) * (off + wob);
            if (k === 0) g.moveTo(px, py); else g.lineTo(px, py);
          }
          g.stroke();
        }
      } else if (el === 'fire') {
        g.fillStyle = c;
        for (let i = 0; i < 5; i++) {
          const f = (i + 0.5) / 5;
          const wob = Math.sin(run.t * 14 + i * 2.7) * b.w * 0.45;
          g.globalAlpha = t * 0.4;
          g.beginPath();
          g.arc(
            b.x + Math.cos(b.a) * b.len * f - Math.sin(b.a) * wob,
            b.y + Math.sin(b.a) * b.len * f + Math.cos(b.a) * wob,
            1.4 + (i % 2), 0, TAU,
          );
          g.fill();
        }
      } else if (el === 'light') {
        g.strokeStyle = 'rgba(255, 253, 247, .9)';
        g.lineWidth = 1;
        for (let i = 0; i < 4; i++) {
          const f = (i + 0.5) / 4;
          const x = b.x + Math.cos(b.a) * b.len * f;
          const y = b.y + Math.sin(b.a) * b.len * f;
          g.globalAlpha = t * 0.3;
          g.beginPath();
          g.moveTo(x - Math.sin(b.a) * b.w, y + Math.cos(b.a) * b.w);
          g.lineTo(x + Math.sin(b.a) * b.w, y - Math.cos(b.a) * b.w);
          g.stroke();
        }
      }
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

/** 箱庭の壁の厚み (境界から外へ)。床の帯はこれの半分だけ内側に伸びる。 */
const WALL = 26;

/** 描画側が見る庭の大きさ。中心が原点で、x = ±w/2 が壁。 */
function stageArena(run) {
  const a = run && run.stage && run.stage.arena;
  if (a && a.w > 0 && a.h > 0) return { w: a.w, h: a.h };
  return { w: 4800, h: 3600 };
}

/** カメラを庭の内側に留める。庭が画面より小さければ庭を中央に見せる。 */
function clampCam(v, span, view) {
  if (span <= view) return (span - view) / 2;
  return clamp(v, -span / 2, span / 2 - view);
}

/** 2 色を混ぜる (#rrggbb)。庭の外の闇も壁の色も、その場でここからつくる。 */
function mixHex(a, b, t) {
  const px = (h) => {
    const s = h.replace('#', '');
    const n = parseInt(s.length === 3 ? s.split('').map((c) => c + c).join('') : s, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const A = px(a), B = px(b);
  const c = A.map((v, i) => Math.round(v + (B[i] - v) * clamp(t, 0, 1)));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

/** 意匠 1 種あたりの基本個数。庭の面積に比例して増える。 */
const GARDEN_COUNT = {
  rows: 9, flower: 14, grove: 11, bamboo: 10, rock: 13,
  hedge: 9, gravel: 11, pond: 5, tiles: 10, bones: 11, lantern: 9,
};

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
