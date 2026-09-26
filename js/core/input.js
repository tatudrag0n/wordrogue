// ============================================================================
// ワードローグ — 入力
//
// キーボード / ゲームパッド / タッチスティックに対応。
// ゲーム画面を長押ししながら動かすとスティックが現れる。
// ============================================================================

import { clamp, TAU } from './util.js';

export class Input {
  /** @param {HTMLElement} surface スティックの操作面にする要素 */
  constructor(surface) {
    this.surface = surface;
    this.keys = new Set();

    // アナログ移動量 (-1..1)
    this.ax = 0;
    this.ay = 0;

    // タッチスティック
    this.stick = { active: false, id: -1, ox: 0, oy: 0, x: 0, y: 0, dx: 0, dy: 0 };
    this.radius = 56;

    /** 押された瞬間だけ true になるフレームフラグ。UI 側で消費する。 */
    this.pressed = new Set();

    this._bind();
  }

  _bind() {
    const kd = (e) => {
      // 入力欄にフォーカスしているときは-operated しない。
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      const k = e.key.toLowerCase();
      if (!this.keys.has(k)) this.pressed.add(k);
      this.keys.add(k);
      if (PREVENT.has(k)) e.preventDefault();
    };
    const ku = (e) => {
      const k = e.key.toLowerCase();
      this.keys.delete(k);
      if (PREVENT.has(k)) e.preventDefault();
    };
    window.addEventListener('keydown', kd, { passive: false });
    window.addEventListener('keyup', ku);
    window.addEventListener('blur', () => { this.keys.clear(); this._resetStick(); });
  }

  _resetStick() {
    const s = this.stick;
    s.active = false; s.id = -1; s.dx = 0; s.dy = 0;
    this.surface?.classList.remove('touching');
  }

  /** pointer イベントでスティックを操作する。game が開始线条で呼ぶ。 */
  attachTouch() {
    const surf = this.surface;
    if (!surf) return;
    const onDown = (e) => {
      if (this.stick.active) return;
      // ステージ中のボタンなど UI の操作は無視。
      if (e.target.closest('button, a, .no-stick')) return;
      const s = this.stick;
      s.active = true;
      s.id = e.pointerId;
      s.ox = e.clientX; s.oy = e.clientY;
      s.x = e.clientX; s.y = e.clientY;
      s.dx = 0; s.dy = 0;
      surf.classList.add('touching');
      surf.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    };
    const onMove = (e) => {
      const s = this.stick;
      if (!s.active || s.id !== e.pointerId) return;
      s.x = e.clientX; s.y = e.clientY;
      let vx = s.x - s.ox, vy = s.y - s.oy;
      const len = Math.hypot(vx, vy);
      if (len > this.radius) {
        // 範囲外ならスティックの起点を引きずって動き続ける。
        vx = (vx / len) * this.radius;
        vy = (vy / len) * this.radius;
        s.ox = s.x - vx;
        s.oy = s.y - vy;
      }
      s.dx = vx / this.radius;
      s.dy = vy / this.radius;
      e.preventDefault();
    };
    const onUp = (e) => {
      const s = this.stick;
      if (s.id !== e.pointerId) return;
      this._resetStick();
    };
    surf.addEventListener('pointerdown', onDown, { passive: false });
    surf.addEventListener('pointermove', onMove, { passive: false });
    surf.addEventListener('pointerup', onUp);
    surf.addEventListener('pointercancel', onUp);
    surf.addEventListener('pointerleave', onUp);
  }

  /** ゲームループ先頭で呼ぶ。 */
  update() {
    let x = 0, y = 0;
    if (this.keys.has('a') || this.keys.has('arrowleft')) x -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) x += 1;
    if (this.keys.has('w') || this.keys.has('arrowup')) y -= 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) y += 1;

    if (x === 0 && y === 0 && this.stick.active) {
      x = this.stick.dx;
      y = this.stick.dy;
    }

    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }

    // ゲームパッド
    const pad = navigator.getGamepads?.()[0];
    if (pad && len === 0) {
      const dz = 0.24;
      let gx = pad.axes[0] || 0, gy = pad.axes[1] || 0;
      if (Math.abs(gx) > dz) x = gx;
      if (Math.abs(gy) > dz) y = gy;
    }

    this.ax = clamp(x, -1, 1);
    this.ay = clamp(y, -1, 1);
  }

  /** 移動中かどうか。 */
  get moving() { return Math.hypot(this.ax, this.ay) > 0.08; }
  get angle() { return Math.atan2(this.ay, this.ax); }

  down(...ks) { return ks.some((k) => this.keys.has(k)); }
  hit(k) { return this.pressed.has(k); }

  /** フレーム末で呼ぶ。押下フラグを消す。 */
  flush() { this.pressed.clear(); }

  /** スティック描画用の状態。 */
  stickState() {
    const s = this.stick;
    return s.active
      ? { active: true, ox: s.ox, oy: s.oy, dx: s.dx, dy: s.dy }
      : { active: false };
  }
}

const PREVENT = new Set([
  'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'tab', '/',
]);

export { TAU };
