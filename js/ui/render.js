// ============================================================================
// ワードローグ — 画面描画 (Canvas 2D)
//
// 外部画像ファイルを一切使わない。全部その場で描く。
// ============================================================================

import { TAU, clamp, lerp, dist2 } from '../core/util.js';
import { ELEMENTS } from '../data/words.js?v=1.49';
import { motionPose, motionKey, WEAPON_MOTIONS } from '../game/motions.js?v=1.49';

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
   *   紙色 (pale) … 刃や柄の面。墨 (ink) … 輪郭と陰。色 (color) … 金具・巻き。
   * 刃の厚みは薄い影 (ink3) を片側だけに置いて出し、鋼の面をつくる。
   * 真上から見た形で描く (銃・鋏は軸を挟んで対称、鋸は歯が片側だけ)。
   */
  drawWeaponGlyph(g, glyph, scale = 1, color = '#d4a94e', alpha = 1) {
    const s = Math.max(0.4, scale);
    const ink = 'rgba(28, 35, 49, .92)';
    const ink2 = 'rgba(28, 35, 49, .42)';
    const ink3 = 'rgba(28, 35, 49, .13)';
    const pale = 'rgba(255, 253, 247, .96)';
    g.save();
    g.scale(s, s);
    g.globalAlpha *= alpha;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = ink;
    g.lineWidth = 1.2;
    g.fillStyle = pale;

    // ── 部品 ──────────────────────────────────────────────
    /** 細い柄。墨の芯に色の巻き。 */
    const grip = (x0, x1, w = 1.2, wraps = 3) => {
      g.strokeStyle = ink;
      g.lineWidth = w * 2;
      g.beginPath(); g.moveTo(x0, 0); g.lineTo(x1, 0); g.stroke();
      g.strokeStyle = color;
      g.lineWidth = w;
      for (let i = 0; i < wraps; i++) {
        const x = x0 + ((i + 0.7) / (wraps + 0.4)) * (x1 - x0);
        g.beginPath(); g.moveTo(x - 1.1, -w * 1.5); g.lineTo(x + 0.5, w * 1.5); g.stroke();
      }
      g.strokeStyle = ink;
      g.lineWidth = 1.2;
    };

    /** 太い柄。紙色の帯に色の巻き締め。 */
    const wrapGrip = (x0, x1, h) => {
      g.fillStyle = pale;
      g.beginPath();
      g.moveTo(x0, -h); g.lineTo(x1, -h * 0.92); g.lineTo(x1, h * 0.92); g.lineTo(x0, h);
      g.closePath(); g.fill(); g.stroke();
      g.fillStyle = ink3;
      g.beginPath();
      g.moveTo(x0, 0); g.lineTo(x1, 0); g.lineTo(x1, h * 0.92); g.lineTo(x0, h);
      g.closePath(); g.fill();
      g.strokeStyle = color;
      g.lineWidth = 1;
      const n = Math.max(2, Math.round((x1 - x0) / 3.6));
      for (let i = 0; i < n; i++) {
        const x = x0 + ((i + 0.5) / n) * (x1 - x0);
        g.beginPath();
        g.moveTo(x - 1.15, -h * 0.82); g.lineTo(x + 1.15, h * 0.82);
        g.stroke();
      }
      g.strokeStyle = ink;
      g.lineWidth = 1.2;
    };

    /** 金具の帯。 */
    const band = (x, halfH, w = 2) => {
      g.fillStyle = color;
      g.fillRect(x, -halfH, w, halfH * 2);
      g.strokeRect(x, -halfH, w, halfH * 2);
      g.fillStyle = pale;
    };

    /** 二重刃の剣身。稜線と片側の影で鋼の面を見せる。 */
    const swordBlade = (len, halfW) => {
      g.fillStyle = pale;
      g.beginPath();
      g.moveTo(2, -halfW);
      g.quadraticCurveTo(len * 0.72, -halfW, len, 0);
      g.quadraticCurveTo(len * 0.72, halfW, 2, halfW);
      g.closePath();
      g.fill(); g.stroke();
      g.fillStyle = ink3;
      g.beginPath();
      g.moveTo(2.4, 0.1);
      g.quadraticCurveTo(len * 0.72, halfW * 0.25, len - 0.4, 0);
      g.quadraticCurveTo(len * 0.72, halfW, 2.4, halfW - 0.2);
      g.closePath();
      g.fill();
      g.strokeStyle = ink2;
      g.lineWidth = 0.8;
      g.beginPath(); g.moveTo(3.4, 0); g.lineTo(len - 2.6, 0); g.stroke();
      g.lineWidth = 1.2;
      g.strokeStyle = ink;
    };

    switch (glyph) {
      case '刃': {
        // 片刃の厚い刃。刀 (細く反る) と剣 (諸刃) と見分けがつく、
        // 背が直線で刃だけが膨らむ山刀の形。
        g.fillStyle = pale;
        g.beginPath();
        g.moveTo(2, -2.8);
        g.lineTo(25.5, -2.3);
        g.lineTo(30, 0.9);
        g.quadraticCurveTo(19, 4.4, 2, 3);
        g.closePath();
        g.fill(); g.stroke();
        g.fillStyle = ink3;
        g.beginPath();
        g.moveTo(2.6, 0.8);
        g.quadraticCurveTo(19, 3.5, 29.2, 0.85);
        g.quadraticCurveTo(19, 2.5, 2.6, 1.6);
        g.closePath();
        g.fill();
        // 刃文。刃のすぐ内側に細い一線。
        g.strokeStyle = ink2;
        g.lineWidth = 0.85;
        g.beginPath();
        g.moveTo(3.4, 1.2);
        g.quadraticCurveTo(16, 2.9, 28, 0.6);
        g.stroke();
        // 背の面取り。
        g.beginPath();
        g.moveTo(3, -1.9); g.lineTo(24.8, -1.5);
        g.stroke();
        g.strokeStyle = ink;
        g.lineWidth = 1.2;
        band(0, 3.3, 1.7);
        wrapGrip(-9.4, -0.2, 2.3);
        // 髷を留める穴 (目釘)。
        g.fillStyle = ink;
        g.beginPath(); g.arc(-6.2, 0, 0.85, 0, TAU); g.fill();
        g.fillStyle = pale;
        break;
      }
      case '刀': {
        // 反りの強い日本刀。剣 (諸刃) と見分けがつくよう、
        // 片刃の曲線と刃文・丸鍔で描く。
        g.fillStyle = pale;
        g.beginPath();
        g.moveTo(2, -1.9);
        g.quadraticCurveTo(17, -6.2, 29.5, -0.5);
        g.quadraticCurveTo(20, 2.8, 2, 1.9);
        g.closePath();
        g.fill(); g.stroke();
        // 影は刃側 (下) だけ。
        g.fillStyle = ink3;
        g.beginPath();
        g.moveTo(2.6, 0.6);
        g.quadraticCurveTo(19, 2.5, 28.6, -0.5);
        g.quadraticCurveTo(19.5, 1.6, 2.6, 1.2);
        g.closePath();
        g.fill();
        // 刃文 (波)。
        g.strokeStyle = ink2;
        g.lineWidth = 0.85;
        g.beginPath();
        g.moveTo(3, 0.7);
        g.quadraticCurveTo(9, 2.1, 14.5, 0.75);
        g.quadraticCurveTo(20, -0.55, 27.2, -0.65);
        g.stroke();
        // 鎬と切っ先 (かさぶた)。
        g.beginPath();
        g.moveTo(3, -1.15);
        g.quadraticCurveTo(17, -4.2, 27.6, -0.7);
        g.stroke();
        // 鍔 (丸) と柄。
        g.fillStyle = color;
        g.beginPath(); g.ellipse(1.1, 0, 1.35, 3.6, 0, 0, TAU); g.fill(); g.stroke();
        g.fillStyle = pale;
        band(-1.1, 2.5, 1.4);
        wrapGrip(-9.8, -1.4, 2.15);
        break;
      }
      case '剣': {
        swordBlade(29, 2.6);
        // 横の鍔 (クロスガード)。先端だけふくらませる。
        g.beginPath(); g.moveTo(1.1, -5.4); g.lineTo(1.1, 5.4); g.stroke();
        g.fillStyle = color;
        for (const side of [-1, 1]) {
          g.beginPath(); g.arc(1.1, side * 5.4, 1.25, 0, TAU); g.fill();
        }
        g.beginPath(); g.arc(1.1, 0, 1.7, 0, TAU); g.fill();
        g.fillStyle = pale;
        wrapGrip(-9.2, -0.2, 2.2);
        // 鎬頭 (ポンメル)。
        g.fillStyle = color;
        g.beginPath(); g.arc(-10.2, 0, 2.15, 0, TAU); g.fill(); g.stroke();
        g.fillStyle = pale;
        break;
      }
      case '斧': {
        // 柄の先に、鎌形に開く大斧。刃の峰で影をつけ、
        // 柄頭 (カラー) で頭と柄をつなぐ。
        // 柄。
        g.fillStyle = pale;
        g.beginPath();
        g.moveTo(-13.5, -1.9); g.lineTo(11, -2.1); g.lineTo(11, 2.1); g.lineTo(-13.5, 1.9);
        g.closePath(); g.fill(); g.stroke();
        g.fillStyle = ink3;
        g.beginPath();
        g.moveTo(-13.5, 0.1); g.lineTo(11, 0.1); g.lineTo(11, 2.1); g.lineTo(-13.5, 1.9);
        g.closePath(); g.fill();
        wrapGrip(-12, 5.5, 2.15);
        band(6.4, 2.7, 2.6);
        // 頭。細い喉から角が立ち、+X へわずかに膨らむ刃になる。
        g.fillStyle = pale;
        g.beginPath();
        g.moveTo(9.2, -2.6);
        g.lineTo(14.2, -3.4);
        g.quadraticCurveTo(19, -8.8, 23.6, -12.8);
        g.lineTo(26.6, -8.2);
        g.quadraticCurveTo(29.6, -3.4, 29.6, 0);
        g.quadraticCurveTo(29.6, 3.4, 26.6, 8.2);
        g.lineTo(23.6, 12.8);
        g.quadraticCurveTo(19, 8.8, 14.2, 3.4);
        g.lineTo(9.2, 2.6);
        g.closePath();
        g.fill(); g.stroke();
        // 刃の峰 (刃先に沿った面取りだけ)。
        g.strokeStyle = ink2;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(25.4, -7);
        g.quadraticCurveTo(27.6, -3.2, 27.6, 0);
        g.quadraticCurveTo(27.6, 3.2, 25.4, 7);
        g.stroke();
        g.strokeStyle = ink;
        g.lineWidth = 1.2;
        break;
      }
      case '槌': {
        // 柄の先に角のない八角の頭。面取りの稜で重さを出す。
        g.fillStyle = pale;
        g.beginPath();
        g.moveTo(-13, -2); g.lineTo(8.6, -2.2); g.lineTo(8.6, 2.2); g.lineTo(-13, 2);
        g.closePath(); g.fill(); g.stroke();
        g.fillStyle = ink3;
        g.beginPath();
        g.moveTo(-13, 0.1); g.lineTo(8.6, 0.1); g.lineTo(8.6, 2.2); g.lineTo(-13, 2);
        g.closePath(); g.fill();
        wrapGrip(-11.6, 3.5, 2.2);
        band(4.4, 2.8, 2.4);
        // 頭 (八角柱を真上から)。
        g.fillStyle = pale;
        g.beginPath();
        g.moveTo(8, -7.2);
        g.lineTo(20.4, -7.2);
        g.lineTo(23.8, -3.6);
        g.lineTo(23.8, 3.6);
        g.lineTo(20.4, 7.2);
        g.lineTo(8, 7.2);
        g.closePath();
        g.fill(); g.stroke();
        // 打ち面の縁と中央。
        g.strokeStyle = ink2;
        g.lineWidth = 0.95;
        g.beginPath();
        g.moveTo(19.6, -5.6); g.lineTo(19.6, 5.6);
        g.moveTo(10.2, -5.2); g.lineTo(10.2, 5.2);
        g.stroke();
        g.strokeStyle = ink;
        g.lineWidth = 1.2;
        band(12.4, 7.2, 2);
        break;
      }
      case '槍': {
        // 長い柄の先に、細い直線の穂先。房で「槍」を見せる。
        g.fillStyle = pale;
        g.beginPath();
        g.moveTo(-15, -1.2); g.lineTo(15.6, -1.35); g.lineTo(15.6, 1.35); g.lineTo(-15, 1.2);
        g.closePath(); g.fill(); g.stroke();
        g.fillStyle = ink3;
        g.beginPath();
        g.moveTo(-15, 0.1); g.lineTo(15.6, 0.1); g.lineTo(15.6, 1.35); g.lineTo(-15, 1.2);
        g.closePath(); g.fill();
        grip(-13.5, 9.5, 1.15, 5);
        band(13.2, 2.1, 2.2);
        // 穂先 (柳葉)。
        g.fillStyle = pale;
        g.beginPath();
        g.moveTo(15.4, -1.4);
        g.quadraticCurveTo(23, -4.8, 32, 0);
        g.quadraticCurveTo(23, 4.8, 15.4, 1.4);
        g.closePath();
        g.fill(); g.stroke();
        g.strokeStyle = ink2;
        g.lineWidth = 0.85;
        g.beginPath(); g.moveTo(16.4, 0); g.lineTo(30.4, 0); g.stroke();
        g.strokeStyle = ink;
        g.lineWidth = 1.2;
        // 房。
        for (const side of [-1, 1]) {
          for (let i = 0; i < 2; i++) {
            g.beginPath();
            g.moveTo(14.2 + i * 1.1, side * 1.8);
            g.lineTo(11.6 + i * 1.4, side * 5.4);
            g.stroke();
          }
        }
        break;
      }
      case '矛': {
        // 短い太い柄の先に、葉より幅広い穂。石突と反りの鈎が付く。
        g.fillStyle = pale;
        g.beginPath();
        g.moveTo(-8.4, -1.7); g.lineTo(11.4, -1.9); g.lineTo(11.4, 1.9); g.lineTo(-8.4, 1.7);
        g.closePath(); g.fill(); g.stroke();
        g.fillStyle = ink3;
        g.beginPath();
        g.moveTo(-8.4, 0.1); g.lineTo(11.4, 0.1); g.lineTo(11.4, 1.9); g.lineTo(-8.4, 1.7);
        g.closePath(); g.fill();
        wrapGrip(-7, 5.4, 1.95);
        band(6.2, 2.6, 2.3);
        // 穂先 (幅広の葉)。
        g.fillStyle = pale;
        g.beginPath();
        g.moveTo(10.8, -2.1);
        g.quadraticCurveTo(17.6, -7.8, 24, -6.2);
        g.quadraticCurveTo(28.6, -3.4, 30.4, 0);
        g.quadraticCurveTo(28.6, 3.4, 24, 6.2);
        g.quadraticCurveTo(17.6, 7.8, 10.8, 2.1);
        g.closePath();
        g.fill(); g.stroke();
        g.fillStyle = ink3;
        g.beginPath();
        g.moveTo(11.2, 0.15);
        g.quadraticCurveTo(18, 2.4, 30, 0);
        g.quadraticCurveTo(24, 5.4, 11.2, 2);
        g.closePath();
        g.fill();
        g.strokeStyle = ink2;
        g.lineWidth = 0.85;
        g.beginPath(); g.moveTo(11.8, 0); g.lineTo(29, 0); g.stroke();
        g.strokeStyle = ink;
        g.lineWidth = 1.2;
        // 反りの鈎 (上側だけ、塗りで太く) と石突。
        g.fillStyle = pale;
        g.beginPath();
        g.moveTo(9.8, -2.4);
        g.quadraticCurveTo(3.6, -7.2, -1.6, -9.6);
        g.quadraticCurveTo(3, -4.8, 6.4, -1.2);
        g.closePath();
        g.fill(); g.stroke();
        g.beginPath();
        g.moveTo(-8.4, 0); g.lineTo(-12.2, 0); g.stroke();
        g.fillStyle = color;
        g.beginPath(); g.arc(-12.6, 0, 1.5, 0, TAU); g.fill();
        g.fillStyle = pale;
        break;
      }
      case '弓': {
        // 反りの強い弓。弦を張り、矢を番えた形で描く。
        // 弓把 (中央の握り) は色の巻き。
        g.strokeStyle = ink;
        g.lineWidth = 1.9;
        g.beginPath();
        g.moveTo(0.4, -15.2);
        g.quadraticCurveTo(-7.2, -8.6, -6.2, -2.2);
        g.quadraticCurveTo(-6, 2.4, -6.2, 2.2);
        g.quadraticCurveTo(-7.2, 8.6, 0.4, 15.2);
        g.stroke();
        // 弦。
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(0.4, -15.2); g.lineTo(0.4, 15.2);
        g.stroke();
        // 弓弭 (先端の彎り)。
        g.lineWidth = 1.6;
        g.beginPath();
        g.moveTo(0.4, -15.2); g.quadraticCurveTo(2.6, -16.4, 3.4, -14.6);
        g.moveTo(0.4, 15.2); g.quadraticCurveTo(2.6, 16.4, 3.4, 14.6);
        g.stroke();
        // 握りの巻き。
        g.fillStyle = color;
        g.beginPath();
        g.moveTo(-6.4, -2.6); g.lineTo(-4.6, -2.8); g.lineTo(-4.6, 2.8); g.lineTo(-6.4, 2.6);
        g.closePath(); g.fill(); g.stroke();
        g.fillStyle = pale;
        // 番えた矢 (+X へ向かう)。
        g.beginPath();
        g.moveTo(-1.6, -0.85); g.lineTo(18.2, -0.85); g.lineTo(18.2, 0.85); g.lineTo(-1.6, 0.85);
        g.closePath(); g.fill(); g.stroke();
        // 矢尻。
        g.beginPath();
        g.moveTo(17.6, -2.5); g.lineTo(24.4, 0); g.lineTo(17.6, 2.5); g.closePath();
        g.fill(); g.stroke();
        // 矢羽 (二枚)。
        g.strokeStyle = ink2;
        g.lineWidth = 0.95;
        g.beginPath();
        g.moveTo(-1.2, -0.6); g.lineTo(-5.2, -3.6);
        g.moveTo(-1.2, 0.6); g.lineTo(-5.2, 3.6);
        g.moveTo(-3.4, -0.6); g.lineTo(-6.6, -2.4);
        g.moveTo(-3.4, 0.6); g.lineTo(-6.6, 2.4);
        g.stroke();
        g.strokeStyle = ink;
        g.lineWidth = 1.2;
        break;
      }
      case '銃': {
        // 真上から見た拳銃。銃身 (スライド) が +X、握りは後ろ (-X) へ伸びる。
        // 銃身の軸 (y = 0) を挟んで上下対称に描く。照星・照門・スライドの刻みも対称。
        g.fillStyle = pale;
        g.beginPath();
        g.moveTo(-2.8, -3.3);
        g.lineTo(14.6, -2.8);
        g.lineTo(17.8, -1.7);
        g.lineTo(18.6, 0);
        g.lineTo(17.8, 1.7);
        g.lineTo(14.6, 2.8);
        g.lineTo(-2.8, 3.3);
        g.quadraticCurveTo(-5.4, 0, -2.8, -3.3);
        g.closePath();
        g.fill(); g.stroke();
        // スライドの面取り。
        g.strokeStyle = ink2;
        g.lineWidth = 0.9;
        for (const side of [-1, 1]) {
          g.beginPath();
          g.moveTo(-1.6, side * 2.15);
          g.lineTo(14, side * 1.85);
          g.stroke();
        }
        // スライド後部の刻み。
        for (const x of [-1.4, 0.3, 2.0]) {
          g.beginPath(); g.moveTo(x, -2.65); g.lineTo(x, 2.65); g.stroke();
        }
        g.strokeStyle = ink;
        g.lineWidth = 1.2;
        // 銃身の色の帯と銃口。
        band(3.4, 1.35, 9.4);
        g.fillStyle = ink;
        g.beginPath(); g.ellipse(17.2, 0, 0.95, 1.25, 0, 0, TAU); g.fill();
        // 照星 (前) と照門 (後ろ、左右 2 つ)。
        g.fillStyle = color;
        g.beginPath(); g.arc(12.6, 0, 0.85, 0, TAU); g.fill();
        for (const side of [-1, 1]) {
          g.beginPath(); g.arc(-3.6, side * 1.85, 0.7, 0, TAU); g.fill();
        }
        // 引き金の護環 (上下対称の閉じた輪)。
        g.strokeStyle = ink;
        g.lineWidth = 1.15;
        g.beginPath();
        g.moveTo(-6.6, -3.5);
        g.quadraticCurveTo(-10.2, -3.2, -10.2, 0);
        g.quadraticCurveTo(-10.2, 3.2, -6.6, 3.5);
        g.stroke();
        g.lineWidth = 0.85;
        g.strokeStyle = ink2;
        g.beginPath();
        g.moveTo(-6.2, -2.2);
        g.quadraticCurveTo(-8.6, -2, -8.6, 0);
        g.quadraticCurveTo(-8.6, 2, -6.2, 2.2);
        g.stroke();
        g.strokeStyle = ink;
        g.lineWidth = 1.2;
        // 撃鉄。
        g.fillStyle = pale;
        g.beginPath();
        g.moveTo(-8.2, -1.7); g.lineTo(-10.8, 0); g.lineTo(-8.2, 1.7);
        g.closePath(); g.fill(); g.stroke();
        // 握り (真上から短く見える)。
        g.beginPath();
        g.moveTo(-7.6, -3.5);
        g.lineTo(-11.2, -3.1);
        g.lineTo(-12.9, -1.3);
        g.lineTo(-12.9, 1.3);
        g.lineTo(-11.2, 3.1);
        g.lineTo(-7.6, 3.5);
        g.closePath();
        g.fill(); g.stroke();
        // 握りの面 (左右に金の鋲)。
        g.fillStyle = ink3;
        g.beginPath();
        g.moveTo(-8, -2.6);
        g.lineTo(-11.4, -2.3);
        g.lineTo(-11.4, 2.3);
        g.lineTo(-8, 2.6);
        g.closePath();
        g.fill();
        g.fillStyle = color;
        for (const side of [-1, 1]) {
          g.beginPath(); g.arc(-10.3, side * 1.7, 0.72, 0, TAU); g.fill();
        }
        g.fillStyle = pale;
        break;
      }
      case '鋏': {
        // 真上から見た鋏。要 (軸) を中心に、二枚の刃が前へ少し開き、
        // 握りの輪が後ろへ開く。軸を挟んで左右対称。
        for (const side of [-1, 1]) {
          // 刃。要から前へ、外へ開きながら細くなる楔。
          g.fillStyle = pale;
          g.beginPath();
          g.moveTo(1.0, side * 0.2);
          g.lineTo(12.2, side * 2.1);
          g.lineTo(21.4, side * 3.7);
          g.lineTo(20.2, side * 1.8);
          g.lineTo(11.4, side * 0.5);
          g.closePath();
          g.fill(); g.stroke();
          // 刃の峰 (片刃に見せる)。
          g.strokeStyle = ink2;
          g.lineWidth = 0.9;
          g.beginPath();
          g.moveTo(2.6, side * 1.15);
          g.lineTo(18.8, side * 2.8);
          g.stroke();
          // 刃の白 (鋭利さ)。
          g.strokeStyle = color;
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(3.4, side * 1.85);
          g.lineTo(19.6, side * 3.35);
          g.stroke();
          g.strokeStyle = ink;
          g.lineWidth = 1.2;
          // 柄と握りの輪。刃とは逆向きに開く。
          g.beginPath();
          g.moveTo(-0.6, side * 0.35);
          g.lineTo(-6.6, side * 2.7);
          g.stroke();
          g.beginPath();
          g.ellipse(-10, side * 4.1, 3.5, 2.4, 0, 0, TAU);
          g.stroke();
          // 輪の内側の厚み。
          g.strokeStyle = ink2;
          g.lineWidth = 0.8;
          g.beginPath();
          g.ellipse(-10, side * 4.1, 2.3, 1.35, 0, 0, TAU);
          g.stroke();
          g.strokeStyle = ink;
          g.lineWidth = 1.2;
        }
        // 要 (軸) の鋲。刃の根元の色もここで締める。
        g.fillStyle = color;
        g.beginPath(); g.arc(0, 0, 2, 0, TAU); g.fill(); g.stroke();
        g.strokeStyle = ink;
        g.lineWidth = 1;
        g.beginPath(); g.moveTo(-1.15, 0); g.lineTo(1.15, 0); g.stroke();
        g.lineWidth = 1.2;
        break;
      }
      case '鋸': {
        // 真上から見た鋸。細長い刃の片側にだけ歯を並べる
        // (両側に出すと剣に見える)。後ろに柄が付く。
        g.fillStyle = pale;
        g.beginPath();
        g.moveTo(-2.2, -3.1);
        g.lineTo(20.4, -2.3);
        g.lineTo(20.4, 0.4);
        g.lineTo(-2.2, 1.1);
        g.closePath();
        g.fill(); g.stroke();
        // 背の厚み。
        g.strokeStyle = ink2;
        g.lineWidth = 0.9;
        g.beginPath();
        g.moveTo(-1.6, -1.6); g.lineTo(19.8, -1.1);
        g.stroke();
        g.strokeStyle = ink;
        g.lineWidth = 1.2;
        // 歯 (下側だけ)。
        for (let i = 0; i < 8; i++) {
          const x = 1.2 + i * 2.35;
          g.beginPath();
          g.moveTo(x, 0.85);
          g.lineTo(x + 1.15, 3.2);
          g.lineTo(x + 2.3, 0.85);
          g.closePath();
          g.fill(); g.stroke();
        }
        // 柄。
        g.fillStyle = pale;
        g.beginPath();
        g.moveTo(-2.4, -3.3);
        g.lineTo(-11.6, -2.8);
        g.quadraticCurveTo(-13.2, 0, -11.6, 2.5);
        g.lineTo(-2.4, 1.3);
        g.closePath();
        g.fill(); g.stroke();
        g.fillStyle = ink3;
        g.beginPath();
        g.moveTo(-2.4, 0.1);
        g.lineTo(-11.6, 0.2);
        g.quadraticCurveTo(-13, 0, -11.6, 2.5);
        g.lineTo(-2.4, 1.3);
        g.closePath();
        g.fill();
        g.fillStyle = color;
        g.beginPath(); g.arc(-3.2, -1.15, 1.15, 0, TAU); g.fill();
        g.fillStyle = pale;
        break;
      }
      case '針': {
        // 細い刺し針。穂先だけを残して極限まで絞り、
        // 後ろの環に糸を通す。かすかな光で鋼を見せる。
        g.fillStyle = pale;
        g.beginPath();
        g.moveTo(-8.6, -1.6);
        g.lineTo(19.5, -0.6);
        g.lineTo(26.2, 0);
        g.lineTo(19.5, 0.6);
        g.lineTo(-8.6, 1.6);
        g.closePath();
        g.fill(); g.stroke();
        // 鎬の光。
        g.strokeStyle = ink2;
        g.lineWidth = 0.8;
        g.beginPath(); g.moveTo(-6, 0); g.lineTo(21.5, 0); g.stroke();
        g.strokeStyle = ink;
        g.lineWidth = 1.2;
        // 糸通しの環。
        g.beginPath();
        g.ellipse(-6.2, 0, 1.5, 2.6, 0, 0, TAU);
        g.stroke();
        // 柄尻の巻き。
        band(-9.2, 1.9, 1.7);
        // 糸。環から一筋が垂れて、先でゆるく戻る。
        g.strokeStyle = ink2;
        g.lineWidth = 0.95;
        g.beginPath();
        g.moveTo(-6.2, 1.2);
        g.quadraticCurveTo(-13.4, 6.2, -18.8, 3.4);
        g.quadraticCurveTo(-21.4, 1.6, -19.4, -0.4);
        g.stroke();
        g.strokeStyle = ink;
        g.lineWidth = 1.2;
        break;
      }
      case '爪': {
        // 3 本の鉤爪。湾曲した面を紙色で塗り、根元を金具で束ねる。
        for (let i = 0; i < 3; i++) {
          const y = (i - 1) * 5.4;
          const len = 20 - Math.abs(i - 1) * 3.2;
          const tipY = y + (i - 1) * 3.2;
          g.fillStyle = pale;
          g.beginPath();
          g.moveTo(-2, y - 2.1);
          g.quadraticCurveTo(len * 0.52, y - 5 - Math.abs(i - 1), len, tipY);
          g.quadraticCurveTo(len * 0.5, y - 0.6, -2, y + 2.3);
          g.closePath();
          g.fill(); g.stroke();
          // 面の稜。
          g.strokeStyle = ink2;
          g.lineWidth = 0.85;
          g.beginPath();
          g.moveTo(-0.5, y - 0.1);
          g.quadraticCurveTo(len * 0.5, y - 2.6, len - 2.2, tipY * 0.8);
          g.stroke();
          g.strokeStyle = ink;
          g.lineWidth = 1.2;
        }
        // 根元の金具と巻き。
        g.fillStyle = color;
        g.beginPath();
        g.moveTo(-6.4, -8.2); g.lineTo(-2.6, -8.8); g.lineTo(-2.6, 8.8); g.lineTo(-6.4, 8.2);
        g.closePath(); g.fill(); g.stroke();
        g.fillStyle = pale;
        wrapGrip(-12.2, -6.8, 3);
        break;
      }
      case '牙': {
        // 上下の牙。付け根を太く持ち、内側へ反って先を尖らせる。
        // 2 本の間に隙間を残し、噛みつく形として読ませる。
        for (const side of [-1, 1]) {
          g.fillStyle = pale;
          g.beginPath();
          g.moveTo(-4.6, side * 1.5);
          g.quadraticCurveTo(5.4, side * 9.4, 18.2, side * 2.2);
          g.quadraticCurveTo(3.6, side * 3.1, -4.6, side * 5.8);
          g.closePath();
          g.fill(); g.stroke();
          // 内側の筋。
          g.strokeStyle = ink2;
          g.lineWidth = 0.9;
          g.beginPath();
          g.moveTo(-3, side * 3.8);
          g.quadraticCurveTo(5, side * 5.6, 14.6, side * 2.6);
          g.stroke();
          g.strokeStyle = ink;
          g.lineWidth = 1.2;
        }
        // 牙床 (金具)。
        g.fillStyle = color;
        g.beginPath(); g.arc(-6.2, 0, 2.4, 0, TAU); g.fill(); g.stroke();
        g.fillStyle = pale;
        break;
      }
      case '拳': {
        // 握った拳を真上から。指のこぶしを輪郭に 4 つ並べ、手首を巻く。
        g.fillStyle = pale;
        g.beginPath();
        g.moveTo(2.4, -7.6);
        g.quadraticCurveTo(7.6, -10.2, 9.8, -8.2);
        g.arc(9.8, -6, 2.2, -Math.PI / 2, Math.PI / 2);
        g.arc(9.8, -2, 2.2, -Math.PI / 2, Math.PI / 2);
        g.arc(9.8, 2, 2.2, -Math.PI / 2, Math.PI / 2);
        g.arc(9.8, 6, 2.2, -Math.PI / 2, Math.PI / 2);
        g.quadraticCurveTo(7.6, 10.2, 2.4, 7.8);
        g.quadraticCurveTo(-3.2, 8.4, -4.6, 3.6);
        g.lineTo(-4.6, -3.6);
        g.quadraticCurveTo(-3.2, -8.4, 2.4, -7.6);
        g.closePath();
        g.fill(); g.stroke();
        // 手首。拳から離れないよう、巻きの下まで面を伸ばす。
        g.beginPath();
        g.moveTo(-4.8, -3.6); g.lineTo(-10.8, -3.9);
        g.lineTo(-10.8, 3.9); g.lineTo(-4.8, 3.6);
        g.closePath();
        g.fill(); g.stroke();
        // 指の境目。
        g.strokeStyle = ink2;
        g.lineWidth = 0.95;
        for (let i = 0; i < 3; i++) {
          const y = -4 + i * 4;
          g.beginPath();
          g.moveTo(8.2, y);
          g.quadraticCurveTo(3.2, y + 0.7, -0.8, y + 1.2);
          g.stroke();
        }
        // 親指 (手前側に畳む)。
        g.beginPath();
        g.moveTo(2, -7.2);
        g.quadraticCurveTo(6.2, -10, 9.8, -8.4);
        g.stroke();
        g.strokeStyle = ink;
        g.lineWidth = 1.2;
        // 手首の巻き。
        g.fillStyle = color;
        g.fillRect(-12.8, -4.2, 2.8, 8.4);
        g.strokeRect(-12.8, -4.2, 2.8, 8.4);
        g.fillStyle = pale;
        break;
      }
      case '杖': {
        // 長い柄の先に宝玉。房と巻きで「杖」と見せる。
        g.fillStyle = pale;
        g.beginPath();
        g.moveTo(-15, -1.5); g.lineTo(13.6, -1.65); g.lineTo(13.6, 1.65); g.lineTo(-15, 1.5);
        g.closePath(); g.fill(); g.stroke();
        g.fillStyle = ink3;
        g.beginPath();
        g.moveTo(-15, 0.1); g.lineTo(13.6, 0.1); g.lineTo(13.6, 1.65); g.lineTo(-15, 1.5);
        g.closePath(); g.fill();
        grip(-13.5, 8.5, 1.3, 5);
        band(9.4, 2.3, 2.3);
        // 台座 (三つ又)。
        g.strokeStyle = ink;
        g.lineWidth = 1.5;
        for (const side of [-1, 1]) {
          g.beginPath();
          g.moveTo(13, side * 1.4);
          g.quadraticCurveTo(15.4, side * 5.6, 19.4, side * 5.2);
          g.stroke();
        }
        g.lineWidth = 1.2;
        // 玉。
        g.fillStyle = pale;
        g.beginPath(); g.arc(19.2, 0, 5, 0, TAU); g.fill(); g.stroke();
        g.fillStyle = color;
        g.globalAlpha *= 0.85;
        g.beginPath(); g.arc(19.2, 0, 2.5, 0, TAU); g.fill();
        g.globalAlpha /= 0.85;
        g.strokeStyle = ink2;
        g.lineWidth = 0.9;
        g.beginPath(); g.arc(17.8, -1.6, 1.1, 0, TAU); g.stroke();
        g.strokeStyle = ink;
        g.lineWidth = 1.2;
        // 房。
        g.beginPath();
        g.moveTo(12.8, 1.8); g.lineTo(11.6, 6.4);
        g.moveTo(14, 1.9); g.lineTo(13.8, 6.6);
        g.stroke();
        g.fillStyle = color;
        g.beginPath(); g.arc(12.6, 7, 1.15, 0, TAU); g.fill();
        g.fillStyle = pale;
        break;
      }
      case '鎖': {
        // 鎖は墨の輪を連ねる。終端に分銅、手元に輪。
        g.strokeStyle = ink;
        g.lineWidth = 1.55;
        g.beginPath(); g.moveTo(-7.6, 0); g.lineTo(-3.2, 0); g.stroke();
        for (let i = 0; i < 5; i++) {
          const x = -0.4 + i * 4.5;
          const y = i % 2 ? -1.9 : 1.9;
          g.beginPath();
          g.ellipse(x, y, 2.8, 1.65, i % 2 ? 0.55 : -0.55, 0, TAU);
          g.stroke();
          // 環の厚み。
          g.lineWidth = 0.85;
          g.beginPath();
          g.ellipse(x, y, 1.75, 0.85, i % 2 ? 0.55 : -0.55, 0, TAU);
          g.stroke();
          g.lineWidth = 1.55;
        }
        // 分銅 (とげ付きの錘)。
        g.fillStyle = pale;
        g.beginPath(); g.arc(21.4, 0, 3.3, 0, TAU); g.fill(); g.stroke();
        for (let i = 0; i < 5; i++) {
          const aa = (i / 5) * TAU + 0.35;
          g.beginPath();
          g.moveTo(21.4 + Math.cos(aa) * 2.6, Math.sin(aa) * 2.6);
          g.lineTo(21.4 + Math.cos(aa) * 5.2, Math.sin(aa) * 5.2);
          g.stroke();
        }
        g.fillStyle = color;
        g.beginPath(); g.arc(21.4, 0, 1.4, 0, TAU); g.fill();
        // 手元の輪。
        g.beginPath(); g.arc(-9.4, 0, 2.1, 0, TAU); g.fill(); g.stroke();
        g.fillStyle = pale;
        break;
      }
      case '鞭': {
        // 鞭は皮の帯。柄からしなる一筋で、先が細くほどける。
        wrapGrip(-11, -1.2, 2.25);
        // 先革 (色の締め)。
        g.fillStyle = color;
        g.fillRect(-1.9, -2.6, 1.7, 5.2);
        g.strokeRect(-1.9, -2.6, 1.7, 5.2);
        g.fillStyle = pale;
        // 本革。外側へ膨らみ、+X 上でわずかに波打つ。
        g.beginPath();
        g.moveTo(-0.4, -1.75);
        g.quadraticCurveTo(11, -6.8, 23.6, 2.9);
        g.lineTo(23.6, 4.4);
        g.quadraticCurveTo(11, -2.4, -0.4, 1.75);
        g.closePath();
        g.fill(); g.stroke();
        // 編み。
        g.strokeStyle = ink2;
        g.lineWidth = 0.85;
        for (let i = 1; i <= 4; i++) {
          const f = i / 5;
          const x = f * 23.6;
          const y = -1.75 + f * f * 10.4 - f * 2.2;
          g.beginPath();
          g.moveTo(x, y - 1.15);
          g.lineTo(x + 0.7, y + 1.15);
          g.stroke();
        }
        g.strokeStyle = ink;
        g.lineWidth = 1.2;
        // 先革 (細い一筋) と先端の結び。
        g.beginPath();
        g.moveTo(23.8, 3.4);
        g.quadraticCurveTo(27.4, 6.2, 30.2, 9.2);
        g.stroke();
        g.fillStyle = color;
        g.beginPath(); g.arc(23.8, 3.6, 1.25, 0, TAU); g.fill();
        g.fillStyle = pale;
        break;
      }
      case '環': {
        // 環は太い輪に宝玉。輪の内側に光を置く。
        g.strokeStyle = pale;
        g.lineWidth = 3.6;
        g.beginPath(); g.arc(5, 0, 8, 0, TAU); g.stroke();
        g.strokeStyle = ink;
        g.lineWidth = 1;
        g.beginPath(); g.arc(5, 0, 9.85, 0, TAU); g.stroke();
        g.beginPath(); g.arc(5, 0, 6.15, 0, TAU); g.stroke();
        // 輪に 4 つの留め。
        g.fillStyle = color;
        for (let i = 0; i < 4; i++) {
          const aa = (i / 4) * TAU + Math.PI / 4;
          g.beginPath();
          g.arc(5 + Math.cos(aa) * 8, Math.sin(aa) * 8, 1.15, 0, TAU);
          g.fill();
        }
        // 中央の宝玉。
        g.beginPath(); g.arc(5, 0, 2.1, 0, TAU); g.fill();
        g.lineWidth = 1.2;
        g.beginPath(); g.arc(5, 0, 2.1, 0, TAU); g.stroke();
        g.fillStyle = pale;
        break;
      }
      case '輪': {
        // 輪は車輪。輻 (スポーク) を入れて環と分ける。
        g.strokeStyle = pale;
        g.lineWidth = 2.4;
        g.beginPath(); g.arc(5, 0, 8, 0, TAU); g.stroke();
        g.strokeStyle = ink;
        g.lineWidth = 1;
        g.beginPath(); g.arc(5, 0, 9.35, 0, TAU); g.stroke();
        g.beginPath(); g.arc(5, 0, 6.75, 0, TAU); g.stroke();
        for (let i = 0; i < 6; i++) {
          const aa = (i / 6) * TAU;
          g.beginPath();
          g.moveTo(5 + Math.cos(aa) * 2.4, Math.sin(aa) * 2.4);
          g.lineTo(5 + Math.cos(aa) * 6.9, Math.sin(aa) * 6.9);
          g.stroke();
        }
        // 軸。
        g.fillStyle = pale;
        g.beginPath(); g.arc(5, 0, 2.4, 0, TAU); g.fill(); g.stroke();
        g.fillStyle = color;
        g.beginPath(); g.arc(5, 0, 1.15, 0, TAU); g.fill();
        g.fillStyle = pale;
        break;
      }
      case '還': {
        // 還り刃。腕木型のブーメラン。外縁だけを鋼にして、
        // 戻ってくる刃だと分かるように肘 (内側) を厚く残す。
        g.fillStyle = pale;
        g.beginPath();
        g.moveTo(-13.4, -11.2);
        g.quadraticCurveTo(1.2, -8.2, 12.8, -0.2);
        g.quadraticCurveTo(1.2, 7.8, -13.4, 11.2);
        g.lineTo(-11.8, 8.9);
        g.quadraticCurveTo(0.2, 4.6, 6.2, 0);
        g.quadraticCurveTo(0.2, -4.6, -11.8, -8.9);
        g.closePath();
        g.fill(); g.stroke();
        // 外縁の鋼。
        g.strokeStyle = ink2;
        g.lineWidth = 0.95;
        g.beginPath();
        g.moveTo(-12, -10.1);
        g.quadraticCurveTo(1, -7, 10.8, -0.4);
        g.quadraticCurveTo(1, 6.6, -12, 10.1);
        g.stroke();
        // 肘の金具。
        g.strokeStyle = color;
        g.lineWidth = 1.35;
        g.beginPath();
        g.moveTo(-1.4, -3.1);
        g.quadraticCurveTo(3.4, 0, -1.4, 3.1);
        g.stroke();
        g.strokeStyle = ink;
        g.lineWidth = 1.2;
        break;
      }
      case '玉': {
        // 玉は球。影と光で丸みを出す。
        g.beginPath(); g.arc(6, 0, 7.4, 0, TAU); g.fill(); g.stroke();
        g.fillStyle = ink3;
        g.beginPath();
        g.arc(6, 0, 7.2, 0.55, 2.6);
        g.arc(6, 0, 4.7, 2.6, 0.55, true);
        g.closePath();
        g.fill();
        g.strokeStyle = ink2;
        g.lineWidth = 0.85;
        g.beginPath(); g.ellipse(6, 0, 7.1, 2.6, 0, 0, TAU); g.stroke();
        g.fillStyle = pale;
        g.beginPath(); g.arc(3.4, -2.7, 1.5, 0, TAU); g.fill();
        g.strokeStyle = color;
        g.lineWidth = 1.35;
        g.beginPath(); g.arc(6, 0, 7.3, 0.75, 2.35); g.stroke();
        g.strokeStyle = ink;
        g.lineWidth = 1.2;
        break;
      }
      case '球': {
        // 球は面取りの玉。刻面の線を入れて玉と珠と分ける。
        g.beginPath(); g.arc(6, 0, 7.5, 0, TAU); g.fill(); g.stroke();
        g.strokeStyle = ink2;
        g.lineWidth = 0.9;
        for (let i = 0; i < 3; i++) {
          const aa = (i / 3) * Math.PI + 0.35;
          g.beginPath();
          g.ellipse(6, 0, 7.3, 2.7, aa, 0, TAU);
          g.stroke();
        }
        // 中心の刻面。
        g.beginPath();
        for (let i = 0; i < 6; i++) {
          const aa = (i / 6) * TAU + 0.52;
          const x = 6 + Math.cos(aa) * 3.1, y = Math.sin(aa) * 3.1;
          if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.closePath();
        g.stroke();
        g.fillStyle = color;
        g.globalAlpha *= 0.7;
        g.fill();
        g.globalAlpha /= 0.7;
        g.strokeStyle = ink;
        g.lineWidth = 1.2;
        break;
      }
      case '珠': {
        // 珠は真珠。光の弧を二重に回し、玉より柔らかく見せる。
        g.beginPath(); g.arc(6, 0, 7, 0, TAU); g.fill(); g.stroke();
        g.strokeStyle = ink2;
        g.lineWidth = 0.95;
        g.beginPath(); g.arc(6, 0, 5.2, -2.5, -1.1); g.stroke();
        g.beginPath(); g.arc(6, 0, 6.2, -2.35, -1.25); g.stroke();
        g.strokeStyle = color;
        g.lineWidth = 1.15;
        g.globalAlpha *= 0.8;
        g.beginPath(); g.arc(6, 0, 8.4, -2.2, -1.4); g.stroke();
        g.globalAlpha /= 0.8;
        g.fillStyle = color;
        g.beginPath(); g.arc(11.4, -5.2, 1.15, 0, TAU); g.fill();
        g.fillStyle = pale;
        g.beginPath(); g.arc(3.7, -2.3, 1.35, 0, TAU); g.fill();
        g.strokeStyle = ink;
        g.lineWidth = 1.2;
        break;
      }
      case '弾': {
        // 弾は実包。筒 (莢) と弾頭に分けて描く。
        g.fillStyle = pale;
        g.beginPath();
        g.moveTo(-11.6, -3.2); g.lineTo(-1.2, -3.2); g.lineTo(-1.2, -2.5);
        g.lineTo(-11.6, -2.5);
        g.closePath(); g.fill();
        g.beginPath();
        g.moveTo(-12.2, -3.6); g.lineTo(-10.6, -3.6); g.lineTo(-10.6, 3.6); g.lineTo(-12.2, 3.6);
        g.closePath(); g.fill(); g.stroke();
        g.beginPath();
        g.moveTo(-11.6, -3.2); g.lineTo(-1.2, -3.2); g.lineTo(-1.2, 3.2); g.lineTo(-11.6, 3.2);
        g.closePath(); g.fill(); g.stroke();
        g.fillStyle = ink3;
        g.beginPath();
        g.moveTo(-11.6, 0.1); g.lineTo(-1.2, 0.1); g.lineTo(-1.2, 3.2); g.lineTo(-11.6, 3.2);
        g.closePath(); g.fill();
        // 弾頭。
        g.fillStyle = pale;
        g.beginPath();
        g.moveTo(-1, -2.7);
        g.quadraticCurveTo(6.4, -2.45, 12.8, 0);
        g.quadraticCurveTo(6.4, 2.45, -1, 2.7);
        g.closePath();
        g.fill(); g.stroke();
        g.strokeStyle = ink2;
        g.lineWidth = 0.85;
        g.beginPath(); g.moveTo(-10.6, -2.5); g.lineTo(-10.6, 2.5); g.stroke();
        g.strokeStyle = ink;
        g.lineWidth = 1.2;
        band(-8.8, 3.2, 1.8);
        break;
      }
      case '爆': {
        // 爆は焼玉弾。導火線と火花で「弾」と分ける。
        g.beginPath(); g.arc(3, 0, 7.6, 0, TAU); g.fill(); g.stroke();
        g.fillStyle = ink3;
        g.beginPath();
        g.arc(3, 0, 7.4, 0.55, 2.6);
        g.arc(3, 0, 4.9, 2.6, 0.55, true);
        g.closePath();
        g.fill();
        band(-0.6, 7.2, 1.9);
        g.strokeStyle = ink2;
        g.lineWidth = 0.95;
        g.beginPath(); g.arc(1.4, -1.8, 2, -2.4, -1.1); g.stroke();
        g.strokeStyle = ink;
        g.lineWidth = 1.2;
        // 導火線。
        g.beginPath();
        g.moveTo(3, -7.6);
        g.quadraticCurveTo(5.8, -12.6, 10.6, -12.9);
        g.stroke();
        // 火花。
        g.strokeStyle = color;
        g.lineWidth = 1.5;
        for (let i = 0; i < 4; i++) {
          const aa = (i / 4) * TAU + 0.45;
          g.beginPath();
          g.moveTo(10.6 + Math.cos(aa) * 1.3, -12.9 + Math.sin(aa) * 1.3);
          g.lineTo(10.6 + Math.cos(aa) * 3.4, -12.9 + Math.sin(aa) * 3.4);
          g.stroke();
        }
        g.fillStyle = pale;
        g.beginPath(); g.arc(10.6, -12.9, 1.5, 0, TAU); g.fill();
        g.strokeStyle = ink;
        g.lineWidth = 1.2;
        break;
      }
      case '光': {
        // 光は十字の光条。4 本の長光と 4 本の短光を細く出し、芯に玉を置く。
        for (let i = 0; i < 8; i++) {
          const aa = (i / 8) * TAU;
          const r0 = 3.4, r1 = i % 2 ? 7.4 : 14.4;
          // 芯 (色) と外側 (墨) を重ねる。
          for (const [lw, col] of [[i % 2 ? 1.6 : 2.4, color], [0.95, ink]]) {
            g.strokeStyle = col;
            g.lineWidth = lw;
            g.beginPath();
            g.moveTo(Math.cos(aa) * r0, Math.sin(aa) * r0);
            g.lineTo(Math.cos(aa) * r1, Math.sin(aa) * r1);
            g.stroke();
          }
        }
        // 光条の合間の小さな輝き。
        g.fillStyle = color;
        for (let i = 0; i < 4; i++) {
          const aa = (i / 4) * TAU + Math.PI / 4;
          g.beginPath();
          g.arc(Math.cos(aa) * 10.4, Math.sin(aa) * 10.4, 0.95, 0, TAU);
          g.fill();
        }
        g.fillStyle = pale;
        g.beginPath(); g.arc(0, 0, 4.6, 0, TAU); g.fill();
        g.strokeStyle = ink;
        g.lineWidth = 1.2;
        g.stroke();
        g.fillStyle = color;
        g.globalAlpha *= 0.85;
        g.beginPath(); g.arc(0, 0, 2.2, 0, TAU); g.fill();
        g.globalAlpha /= 0.85;
        g.fillStyle = pale;
        break;
      }
      case '雷': {
        // 雷は稲妻の折れ線。面で抜き、芯に色を残す。
        g.fillStyle = pale;
        g.beginPath();
        g.moveTo(2.8, -11);
        g.lineTo(-7.6, 1.4);
        g.lineTo(-1.8, 1.4);
        g.lineTo(-3.8, 11.4);
        g.lineTo(8.4, -1.8);
        g.lineTo(2.4, -1.8);
        g.closePath();
        g.fill(); g.stroke();
        g.fillStyle = color;
        g.globalAlpha *= 0.75;
        g.beginPath();
        g.moveTo(1.5, -6.4);
        g.lineTo(-2.6, 0.6);
        g.lineTo(0.5, 0.6);
        g.lineTo(-0.9, 6.4);
        g.lineTo(3.8, -0.6);
        g.lineTo(0.7, -0.6);
        g.closePath();
        g.fill();
        g.globalAlpha /= 0.75;
        // 脇に小さな枝。
        g.strokeStyle = ink2;
        g.lineWidth = 0.95;
        g.beginPath();
        g.moveTo(1.1, -8.8); g.lineTo(5.6, -9.8);
        g.moveTo(-3, 8.6); g.lineTo(-6.8, 9.8);
        g.stroke();
        g.strokeStyle = ink;
        g.lineWidth = 1.2;
        break;
      }
      case '渦': {
        // 渦は螺旋。二重の螺旋と外側の飛沫で回転を見せる。
        for (const [lw, col, rMax, turns, off] of [
          [1.55, color, 11, 1.85, 0],
          [0.95, ink2, 7.4, 1.35, Math.PI],
        ]) {
          g.strokeStyle = col;
          g.lineWidth = lw;
          g.beginPath();
          for (let i = 0; i <= 44; i++) {
            const f = i / 44;
            const aa = off + f * TAU * turns;
            const rr = 1.4 + f * rMax;
            const x = Math.cos(aa) * rr, y = Math.sin(aa) * rr;
            if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
          }
          g.stroke();
        }
        // 飛沫。
        g.strokeStyle = color;
        g.lineWidth = 1.05;
        g.globalAlpha *= 0.8;
        for (let i = 0; i < 3; i++) {
          const aa = i * 2.2 + 0.6;
          g.beginPath();
          g.arc(Math.cos(aa) * 12.2, Math.sin(aa) * 12.2, 1.5 + i * 0.4, aa - 1, aa + 1);
          g.stroke();
        }
        g.globalAlpha /= 0.8;
        g.fillStyle = ink;
        g.beginPath(); g.arc(0, 0, 1.15, 0, TAU); g.fill();
        g.strokeStyle = ink;
        g.lineWidth = 1.2;
        break;
      }
      case '壁': {
        // 壁は城壁の札。石積みの目地と金の帯で「護り」を示す。
        g.fillStyle = pale;
        g.beginPath();
        g.moveTo(-8, -10);
        g.lineTo(9, -10);
        g.quadraticCurveTo(14, -10, 14, -5);
        g.lineTo(14, 5);
        g.quadraticCurveTo(14, 10, 9, 10);
        g.lineTo(-8, 10);
        g.quadraticCurveTo(-11, 10, -11, 5);
        g.lineTo(-11, -5);
        g.quadraticCurveTo(-11, -10, -8, -10);
        g.closePath();
        g.fill(); g.stroke();
        // 石積みの目地。
        g.strokeStyle = ink2;
        g.lineWidth = 0.95;
        g.beginPath();
        g.moveTo(-11, -3.6); g.lineTo(14, -3.6);
        g.moveTo(-11, 3.6); g.lineTo(14, 3.6);
        g.moveTo(-3.2, -10); g.lineTo(-3.2, -3.6);
        g.moveTo(5.4, -10); g.lineTo(5.4, -3.6);
        g.moveTo(-7.4, -3.6); g.lineTo(-7.4, 3.6);
        g.moveTo(1.2, -3.6); g.lineTo(1.2, 3.6);
        g.moveTo(9.6, -3.6); g.lineTo(9.6, 3.6);
        g.moveTo(-3.2, 3.6); g.lineTo(-3.2, 10);
        g.moveTo(5.4, 3.6); g.lineTo(5.4, 10);
        g.stroke();
        // 金の帯と鋲。
        band(0.4, 10, 2.4);
        g.fillStyle = color;
        for (const [bx, by] of [[-8.4, -7.4], [11.2, -7.4], [-8.4, 7.4], [11.2, 7.4]]) {
          g.beginPath(); g.arc(bx, by, 1.05, 0, TAU); g.fill();
        }
        g.fillStyle = pale;
        g.strokeStyle = ink;
        g.lineWidth = 1.2;
        break;
      }
      default: {
        // 属性語・現象語などの特殊武器。紙の御札にその字を書く。
        const text = typeof glyph === 'string' && glyph ? glyph : '技';
        g.fillStyle = pale;
        g.beginPath();
        g.moveTo(-6.6, -11.8);
        g.lineTo(10.6, -11.8);
        g.quadraticCurveTo(13, -11.8, 13, -9.4);
        g.lineTo(13, 9.4);
        g.quadraticCurveTo(13, 11.8, 10.6, 11.8);
        g.lineTo(-6.6, 11.8);
        g.quadraticCurveTo(-9, 11.8, -9, 9.4);
        g.lineTo(-9, -9.4);
        g.quadraticCurveTo(-9, -11.8, -6.6, -11.8);
        g.closePath();
        g.fill(); g.stroke();
        // 内枠と上下の金。
        g.strokeStyle = ink2;
        g.lineWidth = 0.85;
        g.strokeRect(-7, -9.6, 18, 19.2);
        g.strokeStyle = ink;
        g.lineWidth = 1.2;
        g.fillStyle = color;
        g.fillRect(-9, -11.8, 22, 2.5);
        g.strokeRect(-9, -11.8, 22, 2.5);
        g.fillRect(-9, 9.3, 22, 2.5);
        g.strokeRect(-9, 9.3, 22, 2.5);
        g.fillStyle = pale;
        // 中央に一字。書体は明朝で墨に。
        g.fillStyle = ink;
        g.font = 'bold 13.5px "Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(text, 2, 0.6);
        // 四隅の留め。
        g.fillStyle = color;
        for (const [bx, by] of [[-7.2, -7.6], [11.2, -7.6], [-7.2, 7.6], [11.2, 7.6]]) {
          g.beginPath(); g.arc(bx, by, 0.95, 0, TAU); g.fill();
        }
        g.fillStyle = pale;
        break;
      }
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

  // 武器の種類ごとに異なる「待機モーション」。攻撃の合間にも武器が息づく。
  drawWeaponSpirits(run) {
    const g = this.ctx, p = run.player;
    const count = Math.max(1, run.weapons.length);
    for (let i = 0; i < run.weapons.length; i++) {
      const wi = run.weapons[i];
      const report = run.weaponReport?.()[i];
      const res = wi._res || report?.res;
      if (!res || !res.active) continue;

      const glyph = res.tail || wi.def.glyph || wi.def.name || '刃';
      const key = motionKey(wi, res);
      const base = WEAPON_MOTIONS[key] || WEAPON_MOTIONS.blade;
      const color = res.elementInfo?.color || '#d4a94e';
      const m = wi.motion;
      const pose = m ? motionPose(m) : null;
      const aim = m?.baseAim ?? wi.aim ?? p.faceVis ?? p.face;
      // 武器の大きさは間合いに合わせる。刃が 20px で軌跡が 100px だと、
      // 何が切っているのか読めない。持ち替えても大きさは変わらないよう、
      // 武器の間合い (range) を基準にする。
      const reachK = clamp((res.stats.range || 90) / 92, 0.8, 1.9);
      const baseScale = 1.25 + reachK * 0.85;
      const side = count === 1 ? 0 : (i === 0 ? -0.42 : i === 1 ? 0.62 : 2.35);

      // ── 軌道刃。回り続ける刃そのものが攻撃の動き。 ──
      if (res.kind === 'orbit') {
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

      // ── 手に持つ武器。攻撃中はモーションの姿勢をそのまま使う。 ──
      let angle = aim + (base.rest || 0) + side + Math.sin(run.t * 1.8 + i * 1.7) * 0.035;
      let hx = p.x + Math.cos(aim + side) * (p.r + 4);
      let hy = p.y + Math.sin(aim + side) * (p.r + 4);
      let scale = baseScale;
      let alpha = 0.86;
      let spin = 0;
      let lungeX = 0, lungeY = 0;

      if (m && pose) {
        angle = pose.angle;
        lungeX = pose.x;
        lungeY = pose.y;
        scale = baseScale * (0.94 + pose.extension * 0.22);
        alpha = 0.72 + 0.28 * pose.alpha;
        spin = pose.spin;
        if (key === 'hammer' || key === 'greatblade') {
          // 振りかぶりでは少し浮かせ、落とす瞬間に沈む。
          const lift = pose.phase === 'windup' ? -4 - pose.phaseT * 5
            : pose.phase === 'strike' ? -4 * (1 - pose.phaseT) : 0;
          hy += lift;
        }
        if (base.recoil) {
          // 銃の反動。撃った瞬間だけ手元が後ろへ下がる。
          const kick = pose.phase === 'strike' ? Math.sin(pose.phaseT * Math.PI) : 0;
          lungeX = -Math.cos(m.baseAim) * base.recoil * kick;
          lungeY = -Math.sin(m.baseAim) * base.recoil * kick;
        }
        hx = p.x + Math.cos(angle) * (p.r * 0.72) + lungeX;
        hy = p.y + Math.sin(angle) * (p.r * 0.72) + lungeY;
      } else {
        // 待機中は呼吸に合わせてごく僅かに揺らす。大きく回さない。
        hx += Math.cos(aim + side + Math.PI / 2) * Math.sin(run.t * 2.1 + i) * 1.1;
        hy += Math.sin(aim + side + Math.PI / 2) * Math.sin(run.t * 2.1 + i) * 1.1;
      }

      g.save();
      g.globalAlpha = alpha;
      // 手元から握りへ短い腕。武器が体から浮いて見えないようにする。
      // 太く描くと武器が 2 本に見えるので、細く淡く。
      const armLen = Math.hypot(hx - p.x, hy - p.y);
      if (armLen > p.r) {
        g.strokeStyle = 'rgba(28, 35, 49, .18)';
        g.lineWidth = 1.6;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(p.x + Math.cos(aim + side) * (p.r * 0.85),
          p.y + Math.sin(aim + side) * (p.r * 0.85));
        g.lineTo(hx, hy);
        g.stroke();
      }

      g.translate(hx, hy);
      g.rotate(angle + spin);
      g.shadowColor = color;
      g.shadowBlur = m ? 8 + (pose?.flash || 0) * 7 : 3;
      this.drawWeaponGlyph(g, glyph, scale, color, alpha);
      g.restore();

      // ── 撃つ・放つ武器の、筒先の光。 ──
      if (m && pose && (base.family === 'ranged' || base.family === 'cast')) {
        const reach = (base.family === 'cast' ? 18 : 27) * (scale / 2);
        const tipX = hx + Math.cos(angle) * reach * scale;
        const tipY = hy + Math.sin(angle) * reach * scale;
        if (pose.phase === 'strike' || (pose.phase === 'follow' && base.family === 'cast')) {
          g.save();
          g.globalAlpha = (0.65 + pose.flash * 0.35) * pose.alpha;
          g.fillStyle = '#fffdf7';
          g.beginPath();
          g.arc(tipX, tipY, 2.2 + pose.flash * 3.4, 0, TAU);
          g.fill();
          g.strokeStyle = color;
          g.lineWidth = 1.25;
          for (let k = 0; k < 5; k++) {
            const aa = angle + (k - 2) * 0.28;
            g.beginPath();
            g.moveTo(tipX + Math.cos(aa) * 3, tipY + Math.sin(aa) * 3);
            g.lineTo(tipX + Math.cos(aa) * (7 + pose.flash * 7), tipY + Math.sin(aa) * (7 + pose.flash * 7));
            g.stroke();
          }
          g.restore();
        }
      }

      // 刃のきらめき。打撃の瞬間だけ、刃先に細い光を走らせる。
      if (m && pose && pose.impact > 0.08 && ['slash', 'claw', 'smash', 'thrust', 'punch'].includes(m.family)) {
        const tipX = hx + Math.cos(angle) * 25 * (scale / 2);
        const tipY = hy + Math.sin(angle) * 25 * (scale / 2);
        g.save();
        g.globalAlpha = pose.impact * 0.75;
        g.strokeStyle = '#fffdf7';
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(tipX - Math.cos(angle) * 16 * (scale / 2), tipY - Math.sin(angle) * 16 * (scale / 2));
        g.lineTo(tipX + Math.cos(angle) * 5, tipY + Math.sin(angle) * 5);
        g.stroke();
        g.fillStyle = color;
        g.beginPath();
        g.arc(tipX, tipY, 1.8, 0, TAU);
        g.fill();
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
