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
    /** 属性ごとの発射音・命中音の間引き。同時に鳴りすぎないようにする。 */
    this._castAt = new Map();
    this._hitAt = new Map();
    this._mediaBuffers = {};
    this._mediaNames = ['slot','phrase','broken','levelup','gacha_spin','gacha_reveal','boss_warn','win','lose','explode','hurt','pickup','hit','slash','shoot','kill','xp','conn','combo','dash','heal','ui_open','ui_close','ui_select','ui_deny','heartbeat','tick_urgent','boss','gacha_shine','gacha_tick','gacha_lock','cast','elem_hit'];
    this._bgmEl = null;
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
    // 音が重なっても割れないように、最後に軽く潰す。
    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.knee.value = 18;
    this.comp.ratio.value = 5;
    this.comp.attack.value = 0.003;
    this.comp.release.value = 0.22;
    this.master.connect(this.comp);
    this.comp.connect(this.ctx.destination);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.9;
    this.sfxGain.connect(this.master);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.16;
    this.musicGain.connect(this.master);

    // 空間の余韻。短いディレイを薄く返して、紙の奥で鳴っている感じにする。
    this.space = this.ctx.createGain();
    this.space.gain.value = 0.16;
    const delay = this.ctx.createDelay(0.5);
    delay.delayTime.value = 0.17;
    const fb = this.ctx.createGain();
    fb.gain.value = 0.22;
    const tone = this.ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2600;
    this.space.connect(delay);
    delay.connect(tone);
    tone.connect(fb);
    fb.connect(delay);
    tone.connect(this.master);

    // ノイズバッファ (打撃・爆発用)
    const len = this.ctx.sampleRate * 1.2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._noise = buf;
    this._loadMedia();
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

  /** 単音を鳴らす。space は薄く返す余韻の量 (0..1)。 */
  tone({ freq = 440, type = 'square', dur = 0.12, vol = 0.2, slide = 0, delay = 0, dest = null, space = 0 }) {
    if (!this.on) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t0 + dur);
    this._env(g, t0, Math.min(0.012, dur * 0.2), dur, vol);
    osc.connect(g).connect(dest || this.sfxGain);
    if (space > 0 && this.space) {
      const send = this.ctx.createGain();
      send.gain.value = space;
      g.connect(send).connect(this.space);
    }
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  /** ノイズを鳴らす。space は薄く返す余韻の量 (0..1)。 */
  noise({ dur = 0.15, vol = 0.2, hp = 200, lp = 8000, delay = 0, space = 0 }) {
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
    if (space > 0 && this.space) {
      const send = this.ctx.createGain();
      send.gain.value = space;
      g.connect(send).connect(this.space);
    }
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  /** 同じ属性の音を短い間隔で重ねない。 */
  _throttle(map, key, gap) {
    if (!this.ctx) return false;
    const now = this.ctx.currentTime;
    const last = map.get(key) || 0;
    if (now - last < gap) return false;
    map.set(key, now);
    return true;
  }

  _loadMedia() {
    if (!this.ctx) return;
    const base = 'assets/sfx/';
    for (const name of this._mediaNames) {
      fetch(base + name + '.wav').then(r => r.ok ? r.arrayBuffer() : Promise.reject()).then(ab => this.ctx.decodeAudioData(ab)).then(buf => { this._mediaBuffers[name] = buf; }).catch(() => {});
    }
    try {
      const el = document.createElement('audio');
      el.src = 'assets/bgm/main.wav';
      el.loop = true;
      el.volume = 0.3;
      this._bgmEl = el;
    } catch {}
  }

  playMedia(name) {
    const buf = this._mediaBuffers[name];
    if (!buf || !this.on) return false;
    try {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const g = this.ctx.createGain();
      g.gain.value = 0.6;
      src.connect(g).connect(this.sfxGain);
      src.start();
      return true;
    } catch { return false; }
  }

  // ── ゲーム用の効果音 ─────────────────────────────────────────────────────
  _xpAt = -1;   // 最後に経験値の音を鳴らした時刻
  hit()     { if (this.playMedia('hit')) return; this.noise({ dur: 0.07, vol: 0.10, hp: 900, lp: 5200 }); }
  slash()   { if (this.playMedia('slash')) return; this.noise({ dur: 0.11, vol: 0.11, hp: 1600, lp: 7000 }); this.tone({ freq: 900, type: 'sawtooth', dur: 0.06, vol: 0.05, slide: 0.4 }); }
  shoot()   { if (this.playMedia('shoot')) return; this.tone({ freq: 1500, type: 'square', dur: 0.05, vol: 0.05, slide: 0.35 }); }
  explode() { if (this.playMedia('explode')) return; this.noise({ dur: 0.34, vol: 0.24, hp: 60, lp: 3000 }); this.tone({ freq: 130, type: 'sine', dur: 0.28, vol: 0.16, slide: 0.3 }); }
  hurt()    { if (this.playMedia('hurt')) return; this.tone({ freq: 260, type: 'sawtooth', dur: 0.2, vol: 0.16, slide: 0.42 }); this.noise({ dur: 0.16, vol: 0.12, hp: 200, lp: 2600 }); }
  kill()    { if (this.playMedia('kill')) return; this.tone({ freq: 700, type: 'square', dur: 0.07, vol: 0.07, slide: 1.5 }); }
  pickup()  { if (this.playMedia('pickup')) return; this.tone({ freq: 880, type: 'sine', dur: 0.09, vol: 0.10 }); this.tone({ freq: 1320, type: 'sine', dur: 0.11, vol: 0.08, delay: 0.06 }); }
  /**
   * 経験値を拾ったとき。同時に何十個も届くので、
   * 小音量にして、短い間隔では 1 回にまとめる。
   */
  xp(step = 0) { if (this.playMedia('xp')) return;
    const now = this.ctx ? this.ctx.currentTime : 0;
    if (now - this._xpAt < 0.055) return;
    this._xpAt = now;
    // 続けて拾うほど半音ずつ上がる。拾い続けたくなる手応えにする。
    const n = Math.min(8, Math.max(0, step | 0));
    this.tone({ freq: 1560 * 2 ** (n / 12), type: 'sine', dur: 0.05, vol: 0.035 });
  }
  levelup() { if (this.playMedia('levelup')) return; [0, 4, 7, 12].forEach((n, i) => this.tone({ freq: hz(69 + n), type: 'triangle', dur: 0.18, vol: 0.12, delay: i * 0.07 })); }

  // ── 属性の音 ─────────────────────────────────────────────────────────────
  /**
   * 武器を撃った音。属性ごとに音色を変える。
   * 「風なら風の音」がするように、ノイズの帯域と音程を属性で分ける。
   * @param {string} el 属性
   * @param {string} kind 攻撃の型 (slash / shot / bomb / beam …)
   */
  cast(el = 'none', kind = 'shot') {
    if (!this.on) return;
    if (this.playMedia('cast')) return;
    if (!this._throttle(this._castAt, `${el}|${kind}`, 0.05)) return;
    const slash = kind === 'slash' || kind === 'whip';
    const heavy = kind === 'bomb' || kind === 'beam';
    switch (el) {
      case 'fire':
        this.noise({ dur: heavy ? 0.2 : 0.13, vol: 0.05, hp: 620, lp: heavy ? 2600 : 4200, space: 0.08 });
        this.tone({ freq: 150, type: 'sine', dur: 0.14, vol: 0.045, slide: 0.55 });
        break;
      case 'ice':
        this.tone({ freq: hz(96), type: 'sine', dur: 0.1, vol: 0.035, slide: 1.4 });
        this.tone({ freq: hz(103), type: 'triangle', dur: 0.12, vol: 0.022, delay: 0.035, space: 0.16 });
        this.noise({ dur: 0.08, vol: 0.025, hp: 5200, lp: 12000 });
        break;
      case 'thunder':
        this.noise({ dur: 0.07, vol: 0.045, hp: 3200, lp: 12000 });
        this.tone({ freq: 1700, type: 'sawtooth', dur: 0.06, vol: 0.03, slide: 0.35 });
        break;
      case 'poison':
        this.tone({ freq: 210, type: 'triangle', dur: 0.12, vol: 0.04, slide: 0.62 });
        this.noise({ dur: 0.1, vol: 0.022, hp: 500, lp: 2000 });
        break;
      case 'light':
        this.tone({ freq: hz(93), type: 'sine', dur: 0.15, vol: 0.04, slide: 1.15, space: 0.2 });
        this.tone({ freq: hz(100), type: 'sine', dur: 0.1, vol: 0.022, delay: 0.04, space: 0.2 });
        break;
      case 'dark':
        this.tone({ freq: 92, type: 'sine', dur: 0.22, vol: 0.05, slide: 0.72, space: 0.1 });
        this.noise({ dur: 0.16, vol: 0.022, hp: 300, lp: 1400 });
        break;
      case 'wind':
        this.noise({ dur: slash ? 0.2 : 0.16, vol: 0.05, hp: 900, lp: 5200, space: 0.08 });
        this.tone({ freq: slash ? 420 : 560, type: 'sine', dur: 0.13, vol: 0.022, slide: 2.2 });
        break;
      case 'water':
        this.tone({ freq: 640, type: 'sine', dur: 0.1, vol: 0.04, slide: 0.5 });
        this.noise({ dur: 0.12, vol: 0.03, hp: 500, lp: 3200 });
        break;
      case 'nature':
        this.noise({ dur: 0.12, vol: 0.032, hp: 1200, lp: 5200 });
        this.tone({ freq: 680, type: 'triangle', dur: 0.08, vol: 0.025, slide: 1.25 });
        break;
      case 'earth':
      case 'steel':
      case 'gold':
        this.noise({ dur: 0.12, vol: 0.04, hp: 400, lp: el === 'steel' ? 7000 : 2200 });
        this.tone({ freq: el === 'gold' ? 2100 : 180, type: el === 'gold' ? 'sine' : 'square', dur: 0.07, vol: 0.03, slide: 0.6 });
        break;
      case 'blood':
        this.tone({ freq: 160, type: 'sawtooth', dur: 0.1, vol: 0.04, slide: 0.55 });
        this.noise({ dur: 0.1, vol: 0.028, hp: 300, lp: 1800 });
        break;
      default:
        this.noise({ dur: 0.07, vol: 0.025, hp: 2000, lp: 9000 });
        break;
    }
    if (slash) this.noise({ dur: 0.1, vol: 0.025, hp: 2400, lp: 9000 });
  }

  /**
   * 属性の当たり音。命中の手応えを属性ごとに変える。
   * 連射で鳴りすぎないよう 0.055 秒で間引く。
   */
  elemHit(el = 'none') {
    if (!this.on) return;
    if (this.playMedia('elem_hit')) return;
    if (!this._throttle(this._hitAt, el, 0.055)) return;
    switch (el) {
      case 'fire':
        this.noise({ dur: 0.08, vol: 0.05, hp: 500, lp: 2400 });
        break;
      case 'ice':
        this.tone({ freq: 2400, type: 'sine', dur: 0.04, vol: 0.025, slide: 0.8 });
        break;
      case 'thunder':
        this.noise({ dur: 0.05, vol: 0.045, hp: 4000, lp: 12000 });
        break;
      case 'wind':
        this.noise({ dur: 0.09, vol: 0.04, hp: 1400, lp: 5200 });
        this.tone({ freq: 760, type: 'sine', dur: 0.05, vol: 0.018, slide: 1.8 });
        break;
      case 'poison':
        this.tone({ freq: 260, type: 'triangle', dur: 0.07, vol: 0.028, slide: 0.7 });
        break;
      case 'light':
        this.tone({ freq: hz(96), type: 'sine', dur: 0.08, vol: 0.03, space: 0.18 });
        break;
      case 'dark':
        this.tone({ freq: 110, type: 'sine', dur: 0.1, vol: 0.035, slide: 0.65 });
        break;
      case 'water':
        this.noise({ dur: 0.07, vol: 0.03, hp: 600, lp: 2800 });
        break;
      case 'nature':
        this.noise({ dur: 0.07, vol: 0.025, hp: 1600, lp: 6400 });
        break;
      case 'steel':
      case 'gold':
        this.tone({ freq: el === 'gold' ? 2600 : 1800, type: 'triangle', dur: 0.05, vol: 0.022, slide: 0.9 });
        break;
      case 'earth':
        this.noise({ dur: 0.08, vol: 0.04, hp: 300, lp: 1500 });
        break;
      case 'blood':
        this.noise({ dur: 0.06, vol: 0.03, hp: 350, lp: 2000 });
        break;
      default:
        this.noise({ dur: 0.06, vol: 0.035, hp: 1200, lp: 7000 });
        break;
    }
  }

  // ── UI の音 ──────────────────────────────────────────────────────────────
  /** 画面を開く。紙をめくるような短い上昇。 */
  uiOpen() { if (this.playMedia('ui_open')) return;
    this.noise({ dur: 0.09, vol: 0.022, hp: 2200, lp: 9000 });
    this.tone({ freq: hz(79), type: 'triangle', dur: 0.07, vol: 0.035 });
    this.tone({ freq: hz(86), type: 'triangle', dur: 0.09, vol: 0.028, delay: 0.045, space: 0.1 });
  }

  /** 画面を閉じる。下降。 */
  uiClose() { if (this.playMedia('ui_close')) return;
    this.tone({ freq: hz(84), type: 'triangle', dur: 0.07, vol: 0.03 });
    this.tone({ freq: hz(77), type: 'triangle', dur: 0.1, vol: 0.024, delay: 0.04 });
    this.noise({ dur: 0.07, vol: 0.016, hp: 1800, lp: 6000, delay: 0.02 });
  }

  /** 選ぶ。小さな木の音。 */
  uiSelect() { if (this.playMedia('ui_select')) return;
    this.tone({ freq: 880, type: 'sine', dur: 0.05, vol: 0.035 });
    this.noise({ dur: 0.03, vol: 0.02, hp: 3000, lp: 9000 });
  }

  /** できない操作。低く短く断る。 */
  uiDeny() { if (this.playMedia('ui_deny')) return;
    this.tone({ freq: 150, type: 'square', dur: 0.09, vol: 0.035, slide: 0.8 });
  }

  /** 連斬の音。n が増えるほど少し高くなる。 */
  combo(n = 0) {
    if (!this.on) return;
    if (this.playMedia('combo')) return;
    if (!this._throttle(this._hitAt, 'combo', 0.09)) return;
    const step = Math.min(12, Math.max(0, n | 0));
    this.tone({ freq: hz(72 + Math.min(14, step * 2)), type: 'triangle', dur: 0.07, vol: 0.03 });
  }

  /** ボス出現の警告。遠くで鳴る低いサイレン。 */
  bossWarn() { if (this.playMedia('boss_warn')) return;
    this.tone({ freq: 180, type: 'sawtooth', dur: 0.5, vol: 0.09, slide: 0.75, space: 0.2 });
    this.tone({ freq: 120, type: 'sine', dur: 0.8, vol: 0.08, delay: 0.16, slide: 0.9 });
    this.noise({ dur: 0.8, vol: 0.05, hp: 120, lp: 900, space: 0.2 });
  }

  /** ダッシュの風切り音。 */
  dash() { if (this.playMedia('dash')) return;
    this.noise({ dur: 0.2, vol: 0.075, hp: 700, lp: 4200 });
    this.tone({ freq: 300, type: 'sine', dur: 0.16, vol: 0.05, slide: 2.1 });
  }

  /** 回復。 */
  heal() { if (this.playMedia('heal')) return;
    [0, 7, 12].forEach((n, i) => this.tone({
      freq: hz(76 + n), type: 'sine', dur: 0.16, vol: 0.06, delay: i * 0.05,
    }));
  }

  /** 部位に語を置く音。紙の上に置いた軽い音。 */
  slot() { if (this.playMedia('slot')) return;
    this.tone({ freq: 540, type: 'triangle', dur: 0.07, vol: 0.06 });
    this.noise({ dur: 0.045, vol: 0.035, hp: 2400, lp: 7000 });
  }

  /** 接続詞を選んだ音。 */
  conn() { if (this.playMedia('conn')) return;
    this.tone({ freq: 720, type: 'triangle', dur: 0.08, vol: 0.05 });
    this.tone({ freq: 1080, type: 'sine', dur: 0.1, vol: 0.04, delay: 0.05 });
  }

  /** 低体力の鼓動。level は 0..1 で、減るほど強く速くなる。 */
  heartbeat(level = 0.5) { if (this.playMedia('heartbeat')) return;
    const v = 0.045 + Math.min(1, Math.max(0, level)) * 0.05;
    this.tone({ freq: 64, type: 'sine', dur: 0.12, vol: v });
    this.tone({ freq: 52, type: 'sine', dur: 0.15, vol: v * 0.8, delay: 0.13 });
  }

  /** 残り時間の刻み。最後の数秒を急かす短い音。 */
  tickUrgent() { if (this.playMedia('tick_urgent')) return;
    this.tone({ freq: 1240, type: 'square', dur: 0.035, vol: 0.028 });
  }

  /** くじで新しい語を引いたときの、きらめき。 */
  gachaShine() { if (this.playMedia('gacha_shine')) return;
    [96, 100, 103, 108, 112].forEach((n, i) => this.tone({
      freq: hz(n), type: 'sine', dur: 0.16, vol: 0.03, delay: 0.16 + i * 0.055,
    }));
  }

  // ── 言葉くじ ─────────────────────────────────────────────────────────────
  /** リールが回り始める音。 */
  gachaSpin() { if (this.playMedia('gacha_spin')) return;
    this.tone({ freq: 300, type: 'triangle', dur: 0.28, vol: 0.07, slide: 2.6 });
    this.noise({ dur: 0.42, vol: 0.05, hp: 1200, lp: 7200 });
  }

  /** リールの目が流れる音。i で音程を少し上げる。 */
  gachaTick(i = 0) { if (this.playMedia('gacha_tick')) return;
    const n = [84, 86, 88, 91][Math.abs(i) % 4];
    this.tone({ freq: hz(n), type: 'square', dur: 0.025, vol: 0.018 });
  }

  /** リールが 1 列ずつ止まる音。 */
  gachaLock(i = 0) { if (this.playMedia('gacha_lock')) return;
    this.tone({ freq: hz(79 + i * 5), type: 'triangle', dur: 0.14, vol: 0.085 });
    this.noise({ dur: 0.07, vol: 0.045, hp: 2400, lp: 9000 });
  }

  /**
   * くじの開示。新しい語なら明るく、重複なら柔らかく返す。
   * @param {boolean} dup すでに持っている語か
   */
  gachaReveal(dup = false) { if (this.playMedia('gacha_reveal')) return;
    if (dup) {
      [0, 5, 9].forEach((n, i) => this.tone({
        freq: hz(69 + n), type: 'triangle', dur: 0.22, vol: 0.065, delay: i * 0.075,
      }));
      this.tone({ freq: hz(93), type: 'sine', dur: 0.4, vol: 0.025, delay: 0.16 });
      return;
    }
    [0, 7, 12, 16, 19, 24].forEach((n, i) => this.tone({
      freq: hz(72 + n), type: 'triangle', dur: 0.3, vol: 0.075, delay: i * 0.055,
    }));
    this.noise({ dur: 0.55, vol: 0.035, hp: 5200, lp: 12000, delay: 0.04 });
    this.tone({ freq: hz(48), type: 'sine', dur: 0.5, vol: 0.05 });
  }

  /** 文が成立したとき。気持ちよい 2 音。 */
  phrase() { if (this.playMedia('phrase')) return;
    this.tone({ freq: hz(76), type: 'triangle', dur: 0.13, vol: 0.11 });
    this.tone({ freq: hz(83), type: 'triangle', dur: 0.18, vol: 0.09, delay: 0.07 });
  }
  /** 文が崩れたとき。 */
  broken() { if (this.playMedia('broken')) return;
    this.tone({ freq: 190, type: 'sawtooth', dur: 0.16, vol: 0.10, slide: 0.6 });
  }
  boss() { if (this.playMedia('boss')) return;
    [0, -5, -12].forEach((n, i) => this.tone({ freq: hz(45 + n), type: 'sawtooth', dur: 0.5, vol: 0.16, delay: i * 0.16 }));
    this.noise({ dur: 0.8, vol: 0.14, hp: 40, lp: 1200 });
  }
  win() { if (this.playMedia('win')) return;
    [0, 4, 7, 12, 16, 19].forEach((n, i) => this.tone({ freq: hz(69 + n), type: 'triangle', dur: 0.32, vol: 0.12, delay: i * 0.11 }));
  }
  lose() { if (this.playMedia('lose')) return;
    [0, -3, -7, -12].forEach((n, i) => this.tone({ freq: hz(64 + n), type: 'sawtooth', dur: 0.42, vol: 0.14, delay: i * 0.19 }));
  }

  /**
   * BGM。簡単な和音を繰り返し、強度で戦況に追従させる。
   * @param {number} intensity 0..1
   */
  musicTick(dt, intensity = 0) {
    if (!this.on || !this.enabled) return;
    if (this._bgmEl) {
      if (this._bgmEl.paused) this._bgmEl.play().catch(()=>{});
      this._bgmEl.volume = Math.max(0.05, Math.min(0.6, 0.25 + intensity * 0.35));
      return;
    }
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
