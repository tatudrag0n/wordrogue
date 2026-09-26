// ============================================================================
// ワードローグ — 汎用ユーティリティ
// ============================================================================

export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const sign = Math.sign;

/** 最短の角度差 (-PI..PI)。 */
export function angleDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export const dist2 = (ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay;
  return dx * dx + dy * dy;
};
export const dist = (ax, ay, bx, by) => Math.sqrt(dist2(ax, ay, bx, by));

/** フレームレート非依存の指数減衰補間。 */
export const approach = (cur, target, rate, dt) =>
  cur + (target - cur) * (1 - Math.exp(-rate * dt));

// ─────────────────────────────────────────────────────────────────────────────
// 乱数。mulberry32。シードを固定すれば同じ列を再現できる。
// ─────────────────────────────────────────────────────────────────────────────
export function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.seed = s;
  next.int = (n) => Math.floor(next() * n);
  next.range = (a, b) => a + next() * (b - a);
  next.pick = (arr) => arr[Math.floor(next() * arr.length)];
  next.chance = (p) => next() < p;
  next.sign = () => (next() < 0.5 ? -1 : 1);
  next.angle = () => next() * TAU;
  next.shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  return next;
}

/** 実行時の既定乱数。 */
export const rng = makeRng((Math.random() * 0xffffffff) >>> 0);

// ─────────────────────────────────────────────────────────────────────────────
// オブジェクトプール
// ─────────────────────────────────────────────────────────────────────────────
export class Pool {
  /** @param {() => any} factory @param {(o:any) => void} reset */
  constructor(factory, reset, initial = 64) {
    this.factory = factory;
    this.reset = reset;
    this.free = [];
    for (let i = 0; i < initial; i++) this.free.push(factory());
  }
  take() {
    const o = this.free.pop() || this.factory();
    this.reset?.(o);
    return o;
  }
  give(o) {
    this.free.push(o);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 数学ヘルパ
// ─────────────────────────────────────────────────────────────────────────────
export const easeOutCubic = (t) => 1 - (1 - t) ** 3;
export const easeInCubic = (t) => t * t * t;
export const easeOutBack = (t) => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2;
export const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** 数値を日本語表記 (万/億)。 */
export function fmtNum(n) {
  n = Math.floor(n);
  if (n >= 1e8) return (n / 1e8).toFixed(1).replace(/\.0$/, '') + '億';
  if (n >= 1e4) return (n / 1e4).toFixed(1).replace(/\.0$/, '') + '万';
  return String(n);
}

/** 秒を分秒に。 */
export function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// DOM ヘルパ
// ─────────────────────────────────────────────────────────────────────────────
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (v !== null && v !== undefined && v !== false) {
      node.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); return node; };

/** 次フレームで呼ぶ。 */
export const nextFrame = (fn) => requestAnimationFrame(() => requestAnimationFrame(fn));
