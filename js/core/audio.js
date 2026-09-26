// ============================================================================
// ワードローグ — 効果音
//
// 音声ファイルを一切使わない。Web Audio でその場で合成する。
// ============================================================================

const NOTE = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const hz = (n) => 440 * 2 ** ((n - 69) / 12);

export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.enabled = true;
    this.volume = 0.5;
    this._noise = null;
    this._musicTimer = 0;
    this._musicStep = 0;
    this._scale = [0, 2, 3, 5, 7, 8, 10];
  }

  /** 最初のユーザ操作で呼ぶ。ブラウザの自動再生規約のため。 */
  resume() {
    if (!this.ctx) this._init();
    if (this.ctx?.state === 'suspended') this.ctx.resume();
  }

  _init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    try {
      this.ctx = new AC();
    } catch { this.enabled = false; return; }

    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.9;
    this.sfxGain.connect(this.master);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.16;
    this.musicGain.connect(this.master);

    // ノイズバッファ (打撃・爆発用)
    const len = this.ctx.sampleRate * 1.2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._noise = buf;
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this.volume;
  }

  get on() { return this.enabled && this.ctx && this.ctx.state === 'running'; }

  _env(node, t0, a, d, peak = 1) {
    const g = node.gain;
    g.cancelScheduledValues(t0);
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(Math.max(0.0001, peak), t0 + a);
    g.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  }

  /** 単音を鳴らす。 */
  tone({ freq = 440, type = 'square', dur = 0.12, vol = 0.2, slide = 0, delay = 0, dest = null }) {
    if (!this.on) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t0 + dur);
    this._env(g, t0, Math.min(0.012, dur * 0.2), dur, vol);
    osc.connect(g).connect(dest || this.sfxGain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  /** ノイズを鳴らす。 */
  noise({ dur = 0.15, vol = 0.2, hp = 200, lp = 8000, delay = 0 }) {
    if (!this.on) return;
    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise;
    const g = this.ctx.createGain();
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(lp, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(80, hp), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.sfxGain);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  // ── ゲーム用の効果音 ─────────────────────────────────────────────────────
  hit()     { this.noise({ dur: 0.07, vol: 0.10, hp: 900, lp: 5200 }); }
  slash()   { this.noise({ dur: 0.11, vol: 0.11, hp: 1600, lp: 7000 }); this.tone({ freq: 900, type: 'sawtooth', dur: 0.06, vol: 0.05, slide: 0.4 }); }
  shoot()   { this.tone({ freq: 1500, type: 'square', dur: 0.05, vol: 0.05, slide: 0.35 }); }
  explode() { this.noise({ dur: 0.34, vol: 0.24, hp: 60, lp: 3000 }); this.tone({ freq: 130, type: 'sine', dur: 0.28, vol: 0.16, slide: 0.3 }); }
  hurt()    { this.tone({ freq: 260, type: 'sawtooth', dur: 0.2, vol: 0.16, slide: 0.42 }); this.noise({ dur: 0.16, vol: 0.12, hp: 200, lp: 2600 }); }
  kill()    { this.tone({ freq: 700, type: 'square', dur: 0.07, vol: 0.07, slide: 1.5 }); }
  pickup()  { this.tone({ freq: 880, type: 'sine', dur: 0.09, vol: 0.10 }); this.tone({ freq: 1320, type: 'sine', dur: 0.11, vol: 0.08, delay: 0.06 }); }
  levelup() { [0, 4, 7, 12].forEach((n, i) => this.tone({ freq: hz(69 + n), type: 'triangle', dur: 0.18, vol: 0.12, delay: i * 0.07 })); }

  /** 文が成立したとき。pleasant な 2 音。 */
  phrase() {
    this.tone({ freq: hz(76), type: 'triangle', dur: 0.13, vol: 0.11 });
    this.tone({ freq: hz(83), type: 'triangle', dur: 0.18, vol: 0.09, delay: 0.07 });
  }
  /** 文が崩れたとき。 */
  broken() {
    this.tone({ freq: 190, type: 'sawtooth', dur: 0.16, vol: 0.10, slide: 0.6 });
  }
  boss() {
    [0, -5, -12].forEach((n, i) => this.tone({ freq: hz(45 + n), type: 'sawtooth', dur: 0.5, vol: 0.16, delay: i * 0.16 }));
    this.noise({ dur: 0.8, vol: 0.14, hp: 40, lp: 1200 });
  }
  win() {
    [0, 4, 7, 12, 16, 19].forEach((n, i) => this.tone({ freq: hz(69 + n), type: 'triangle', dur: 0.32, vol: 0.12, delay: i * 0.11 }));
  }
  lose() {
    [0, -3, -7, -12].forEach((n, i) => this.tone({ freq: hz(64 + n), type: 'sawtooth', dur: 0.42, vol: 0.14, delay: i * 0.19 }));
  }

  /**
   * BGM。简单な和声进行を循环，强度随战况上升。
   * @param {number} intensity 0..1
   */
  musicTick(dt, intensity = 0) {
    if (!this.on || !this.enabled) return;
    this._musicTimer -= dt;
    if (this._musicTimer > 0) return;
    this._musicTimer = 0.34;

    const step = this._musicStep++;
    const root = intensity > 0.65 ? 45 : intensity > 0.3 ? 48 : 50;

    // 和声進行 (Am - F - C - G を回す)
    const prog = [0, -4, 3, -2];
    const bar = Math.floor(step / 8) % 4;
    const base = root + prog[bar];

    if (step % 8 === 0) {
      // 低音
      this.tone({ freq: hz(base - 12), type: 'triangle', dur: 0.9, vol: 0.5, dest: this.musicGain });
      this.tone({ freq: hz(base - 12 + 7), type: 'sine', dur: 0.9, vol: 0.22, dest: this.musicGain });
    }
    if (step % 2 === 0) {
      // アルペジオ
      const deg = this._scale[(step / 2) % this._scale.length];
      this.tone({
        freq: hz(base + 12 + deg), type: 'triangle',
        dur: 0.28, vol: 0.20 + intensity * 0.12, dest: this.musicGain,
      });
    }
    if (intensity > 0.5 && step % 4 === 2) {
      this.noise({ dur: 0.08, vol: 0.05 + intensity * 0.05, hp: 4000, lp: 12000 });
    }
  }

  musicStop() { this._musicStep = 0; }
}

export { NOTE, hz };
