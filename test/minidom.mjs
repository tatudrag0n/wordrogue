// ============================================================================
// ワードローグ — テスト用の最小 DOM
//
// Chrome が無い環境でも「言葉鍛冶のドラッグ & ドロップ」を検証するための
// 必要だけの DOM 実装。ブラウザテストの代わりにはならない
// (本物の画面・ジェスチャは再現しない) が、
// pointerdown → pointermove → pointerup の流れと配置計算は本物と同じ経路を通す。
//
// 使い方:
//   import { installMiniDom } from './minidom.mjs';
//   installMiniDom();
//   const { Forge } = await import('../js/ui/forge.js');   // 先にグローバル-being 設定する
// ============================================================================

/** 幅和高さを機械的に並べる。y は親ごとに 1 行ずつ増える。 */
const CELL_W = 60;
const CELL_H = 30;
const GAP_X = 6;
const ROW_Y = 40;

/** セレクタ 1 つにマッチするか。class / id / tag / 属性 / :not() と空白のみ対応。 */
function matches(node, sel) {
  for (const part of splitSel(sel)) {
    if (!matchesChain(node, part)) return false;
  }
  return true;
}

/** 「A B C」は「A の中の B の中の C」。 */
function matchesChain(node, sel) {
  const parts = sel.trim().split(/\s+/).filter(Boolean);
  let n = node;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (!n || n.nodeType !== 1) return false;
    if (!matchOne(n, parts[i])) return false;
    if (i === 0) return true;
    n = n.parentNode;
  }
  return true;
}

function splitSel(sel) {
  // 「A, B」形式。:not(...) の中はカンマを含まないので単純な分割で足りる。
  const out = [];
  let depth = 0, cur = '';
  for (const ch of sel) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function matchOne(node, sel) {
  const not = sel.match(/:not\(([^)]*)\)/);
  if (not) {
    if (matchOne(node, not[1].trim())) return false;
    sel = sel.replace(not[0], '').trim();
    if (!sel) return true;
  }
  const attrEq = sel.match(/\[([a-z-]+)(?:="([^"]*)")?\]/i);
  if (attrEq) {
    const v = attrEq[2];
    if (v === undefined) { if (!(attrEq[1] in node.attrs)) return false; }
    else if (node.attrs[attrEq[1]] !== v) return false;
    sel = sel.replace(attrEq[0], '').trim();
    if (!sel) return true;
  }
  for (const c of sel) {
    if (c === '.') continue;
  }
  const tokens = sel.split(/(?=[.#])/).filter(Boolean);
  for (const t of tokens) {
    if (t[0] === '.') { if (!node.classList.contains(t.slice(1))) return false; }
    else if (t[0] === '#') { if (node.attrs.id !== t.slice(1)) return false; }
    else if (node.tagName.toLowerCase() !== t.toLowerCase()) return false;
  }
  return true;
}

class TextNode {
  constructor(text) { this.nodeType = 3; this.text = String(text); this.parentNode = null; }
  get textContent() { return this.text; }
}

class Element {
  constructor(tag) {
    this.nodeType = 1;
    this.tagName = String(tag).toUpperCase();
    this.attrs = {};
    this.childNodes = [];
    this.parentNode = null;
    this.style = {};
    this.hidden = false;
    this.disabled = false;
    this.draggable = false;
    this._listeners = [];
    this._rect = null;
    this._o = null;
    this._h = null;
    this.classList = makeClassList(this);
    this.dataset = makeDataset(this);
  }

  get className() { return this.attrs.class || ''; }
  set className(v) { this.attrs.class = String(v); }
  get textContent() {
    return this.childNodes.map((c) => c.textContent).join('');
  }
  set textContent(v) {
    this.childNodes = [];
    if (v !== '' && v !== null && v !== undefined) this.append(new TextNode(v));
  }
  get children() { return this.childNodes.filter((c) => c.nodeType === 1); }
  get firstChild() { return this.childNodes[0] || null; }

  append(...nodes) {
    let changed = false;
    for (const n of nodes.flat()) {
      if (n === null || n === undefined || n === false) continue;
      const node = n instanceof Element || n instanceof TextNode ? n : new TextNode(String(n));
      if (node.parentNode) node.parentNode.removeChild(node);
      node.parentNode = this;
      this.childNodes.push(node);
      changed = true;
    }
    if (changed) this.invalidate();
    return this;
  }
  removeChild(node) {
    const i = this.childNodes.indexOf(node);
    if (i >= 0) this.childNodes.splice(i, 1);
    node.parentNode = null;
    this.invalidate();
    return node;
  }
  /** レイアウトのキャッシュを捨てる。 */
  invalidate() {
    let n = this;
    while (n) { n._o = null; n._h = null; n = n.parentNode; }
    return this;
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
    if (k === 'id' && globalThis.document) globalThis.document._register(this);
  }
  getAttribute(k) { return this.attrs[k] ?? null; }

  /**
   * 自分の左上。lazy に計算する: 自分の左上 = 親の左上 + 前の兄弟たちの下端。
   * 高さは子の分まで自動で伸びるので、入れ子が親の外にはみ出さない。
   */
  origin() {
    if (this._origin) return this._origin;
    if (this._o) return this._o;
    const p = this.parentNode;
    if (!p) return { left: 0, top: 0 };
    const po = p.origin();
    const own = p._size?.height ?? CELL_H;
    let y = po.top + own + GAP_X;
    for (const c of p.children) {
      if (c === this) { this._o = { left: po.left, top: y }; return this._o; }
      y = Math.max(y, c.origin().top + c.height() + GAP_X);
    }
    this._o = { left: po.left, top: y };
    return this._o;
  }

  /** 自分の高さ (子のぶんまで自動で伸びる)。 */
  height() {
    if (this._h !== null && this._h !== undefined) return this._h;
    const o = this.origin();
    const own = this._size?.height ?? CELL_H;
    let bottom = o.top + own;
    for (const c of this.children) {
      const cr = c.getBoundingClientRect();
      bottom = Math.max(bottom, cr.top + cr.height);
    }
    this._h = bottom - o.top;
    return this._h;
  }

  getBoundingClientRect() {
    const o = this.origin();
    const own = this._size || { width: CELL_W, height: CELL_H };
    let right = o.left + own.width;
    let bottom = o.top + own.height;
    for (const c of this.children) {
      const cr = c.getBoundingClientRect();
      right = Math.max(right, cr.left + cr.width);
      bottom = Math.max(bottom, cr.top + cr.height);
    }
    return { left: o.left, top: o.top, width: right - o.left, height: bottom - o.top };
  }
  /** テストから明示的に位置を固定したいとき用。 */
  __setRect(rect) {
    this._origin = { left: rect.left, top: rect.top };
    this._size = { width: rect.width, height: rect.height };
    this.invalidate();
    return this;
  }

  addEventListener(type, fn, opts) {
    this._listeners.push({ type, fn, capture: opts === true || (opts && opts.capture) });
  }
  removeEventListener(type, fn) {
    const i = this._listeners.findIndex((l) => l.type === type && l.fn === fn);
    if (i >= 0) this._listeners.splice(i, 1);
  }
  dispatchEvent(ev) { return dispatchOn(this, ev); }

  closest(sel) {
    let n = this;
    while (n) {
      if (n.nodeType === 1 && matches(n, sel)) return n;
      n = n.parentNode;
    }
    return null;
  }
  querySelector(sel) { return queryAll(this, sel)[0] || null; }
  querySelectorAll(sel) { return queryAll(this, sel); }
}

function makeClassList(node) {
  const list = () => (node.attrs.class || '').split(/\s+/).filter(Boolean);
  const write = (a) => { node.attrs.class = [...new Set(a)].join(' '); };
  return {
    add: (...c) => write([...list(), ...c]),
    remove: (...c) => write(list().filter((x) => !c.includes(x))),
    toggle: (c, on) => {
      const has = list().includes(c);
      const want = on === undefined ? !has : !!on;
      if (want) write([...list(), c]); else write(list().filter((x) => x !== c));
      return want;
    },
    contains: (c) => list().includes(c),
  };
}

function makeDataset(node) {
  return new Proxy({}, {
    get: (_, k) => node.attrs['data-' + String(k).replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())],
    set: (_, k, v) => {
      node.attrs['data-' + String(k).replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())] = String(v);
      return true;
    },
  });
}

function walk(root, out = []) {
  for (const c of root.childNodes || []) {
    if (c.nodeType !== 1) continue;
    out.push(c);
    walk(c, out);
  }
  return out;
}

function queryAll(root, sel) {
  const sels = splitSel(sel);
  return walk(root).filter((n) => sels.some((s) => matches(n, s)));
}

/** イベントを階層的に流す。capture → target → bubble。 */
function dispatchOn(target, ev) {
  ev.target = target;
  ev.preventDefault = () => { ev.defaultPrevented = true; };
  ev.stopPropagation = () => { ev._stopped = true; };
  const chain = [];
  let n = target;
  while (n) { chain.push(n); n = n.parentNode; }
  chain.push(globalThis.window);
  // ターゲット位相。capture / bubble 登録どちらもここで 1 回だけ流す。
  for (const l of target._listeners || []) {
    if (l.type !== ev.type) continue;
    l.fn.call(target, ev);
    if (ev._stopped) return !ev.defaultPrevented;
  }
  // capture は window から親まで。ターゲット自身は上で処理済みなので外す。
  for (let i = chain.length - 1; i >= 1; i--) {
    const node = chain[i];
    const caps = (node._listeners || []).filter((l) => l.type === ev.type && l.capture);
    for (const l of caps) l.fn.call(node, ev);
    if (ev._stopped) return !ev.defaultPrevented;
  }
  // バブルは document / window まで流れる。
  // ターゲット自身は上のループで 1 回だけ流しているので、ここでは外す。
  for (let i = chain.length - 1; i >= 1; i--) {
    const node = chain[i];
    const bubs = (node._listeners || []).filter((l) => l.type === ev.type && !l.capture);
    for (const l of bubs) l.fn.call(node, ev);
    if (ev._stopped) return !ev.defaultPrevented;
  }
  return !ev.defaultPrevented;
}

/** グローバルにこの DOM を差し込む。 */
export function installMiniDom() {
  const doc = {
    _listeners: [],
    _byId: new Map(),
    _register(el) {
      if (el.attrs.id) this._byId.set(el.attrs.id, el);
    },
    createElement: (tag) => new Element(tag),
    createTextNode: (t) => new TextNode(t),
    addEventListener(type, fn, opts) { this._listeners.push({ type, fn, opts }); },
    removeEventListener() {},
    getElementById(id) { return this._byId.get(id) || null; },
    querySelector: (sel) => queryAll(doc.body, sel)[0] || null,
    querySelectorAll: (sel) => queryAll(doc.body, sel),
    /** 座標の下の要素。後から append されたもの (手前) を優先する。 */
    elementFromPoint(x, y) {
      const all = walk(doc.body);
      for (let i = all.length - 1; i >= 0; i--) {
        const r = all[i].getBoundingClientRect();
        if (x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height) return all[i];
      }
      return null;
    },
  };
  doc.body = new Element('body');
  doc.body.__setRect({ left: 0, top: 0, width: 800, height: 600 });
  doc.documentElement = new Element('html');

  const win = {
    listeners: [],
    addEventListener(type, fn, opts) {
      win.listeners.push({ type, fn, opts });
      win._listeners.push({ type, fn, opts });
    },
    removeEventListener(type, fn) {
      // listeners と _listeners は同じものを二重に持つので、両方から外す。
      // 片方だけ外すと、階層.dispatchEvent から消えず同じ関数が再度呼ばれる。
      for (const arr of [win.listeners, win._listeners]) {
        const i = arr.findIndex((l) => l.type === type && l.fn === fn);
        if (i >= 0) arr.splice(i, 1);
      }
    },
    dispatchEvent(ev) {
      for (const l of [...win.listeners]) {
        if (l.type !== ev.type) continue;
        l.fn.call(win, ev);
        if (ev._stopped) break;
      }
      return !ev.defaultPrevented;
    },
  };
  win._listeners = [];

  globalThis.document = doc;
  globalThis.window = win;
  globalThis.Node = Element;
  globalThis.Element = Element;
  globalThis.CSS = { escape: (s) => String(s).replace(/[^\w-]/g, (c) => '\\' + c) };
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  return { doc, win, Element, TextNode };
}

/** pointer 系イベントを作る。 */
export function pointer(type, x, y, extra = {}) {
  return {
    type,
    clientX: x,
    clientY: y,
    pointerId: extra.pointerId ?? 1,
    pointerType: extra.pointerType || 'touch',
    isPrimary: true,
    button: extra.button ?? 0,
    bubbles: true,
    cancelable: true,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this._stopped = true; },
  };
}

/** node の中心の座標。 */
export function centerOf(node) {
  const r = node.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
