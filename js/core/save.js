// ============================================================================
// ワードローグ — セーブデータ (localStorage)
//
// 走者向けの記録のみ。ランの途中状態は保存しない。
// ============================================================================

import { STAGES } from '../data/stages.js';
import { WORDS, drawWord } from '../data/words.js?v=1.40';
import { CONNECTORS } from '../data/words.connect.js';
import {
  RANKS, RANK_MAX, setRanks, rankIndex, rankOf, nextRankName,
} from '../data/ranks.js?v=1.40';

const KEY = 'wordrogue.save.v1';

const DEFAULTS = {
  version: 1,
  clearedStages: [],   // クリア済みステージ ID
  unlockedWeapons: ['sword', 'gun'],
  bestScore: 0,
  totalKills: 0,
  totalRuns: 0,
  totalBroken: 0,     // 文を崩した敵の累計
  ink: 0,              // 書庫の通貨「言玉」
  collection: null,    // 所持語 (言葉くじで増える)。null なら初期セットを付与
  ranks: {},           // 語 → ランク段階 (0 = コモン)。重複で上がる
  starterRev: 0,       // 初期セットの改訂番号。古いセーブを 1 度だけ入れ替える
  deck: null,          // 戦闘に持ち込む言葉デッキ (語の text の配列)
  parts: {},           // 部位強化 { partId: [text, text] }
  settings: { volume: 0.5, screenShake: true, showDamage: true },
  seenIntro: false,
  guide: 0,            // 初回の操作ガイド。0 = まだ見ていない
};

function deepMerge(base, patch) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = deepMerge(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** プレイヤー強化の部位。1 部位に PART_SLOTS 語まで入る。 */
/**
 * プレイヤー強化の部位。1 部位に PART_SLOTS 語まで入る。
 *
 * 並びは人型の見た目 (頭 → 手 → 胸 → 胴 → 足) に合わせてある。
 * 画面はこの順ではなく data-part で体の位置に置く。
 * 腕は手に統合した (右腕・左腕は右手・左手が受け取る)。
 */
export const PARTS = [
  { id: 'head', name: '頭' },
  { id: 'rhnd', name: '右手' },
  { id: 'lhnd', name: '左手' },
  { id: 'chst', name: '胸' },
  { id: 'trnk', name: '胴' },
  { id: 'lfot', name: '左足' },
  { id: 'rfot', name: '右足' },
];
export const PART_SLOTS = 2;    // 1 部位に入る語の数
/**
 * 部位の文の長さの上限 (接続詞込み)。
 * 部位は武器より短くする — 武器は 10 文字なので、そこを真似ない。
 */
export const PART_MAX_LEN = 8;
export const DECK_MIN = 10;     // デッキの最低語数 (戦闘開始時に満たなければ補充)
export const DECK_MAX = Infinity;     // デッキの最大語数 (上限撤廃)
export const GACHA_COST = 25;   // 言葉くじ 1 回の言玉
export const GACHA_REFUND = 5;  // すでに持っている語が出たときの返却

/**
 * 部位の並びを整える。文字列だけの古いセーブもここで吸収する。
 * 持っていない語、空の枠は落とす。
 *
 * 接続詞は辞書にある送り仮名なら何でも通す (部位は自由に選べる)。
 * 文として成り立っているかはここでは見ない — 不成文でも保存しておき、
 * 画面が「不成文」と理由を出す。読めない文字列だけを落とす。
 */
function normalizePart(arr, collection) {
  const out = [];
  for (const raw of Array.isArray(arr) ? arr : []) {
    if (!raw) continue;
    const text = typeof raw === 'string' ? raw : raw.t;
    if (!text || !collection.includes(text)) continue;
    const conn = typeof raw === 'string' ? null : raw.c || null;
    out.push({ t: text, c: conn && CONNECTORS[conn] ? conn : null });
    if (out.length >= PART_SLOTS) break;
  }
  return out;
}

/**
 * 枠の並びを詰める (空の枠を落とす)。
 * 画面は語だけを順に並べるので、保存にも穴を残さない。
 * 穴を残すと、表示の番号と保存の番号がずれて ✕ が効かなくなる。
 */
function compact(arr) {
  return arr.filter(Boolean).slice(0, PART_SLOTS);
}

/**
 * 初期所持語。最初からデッキにも入っている。
 *
 * 最初の 20 語で「属性・効果・動詞」の 3 つの役割をひととおり試せるようにする。
 *   属性 … 炎 氷 雷 毒 風 水 聖 鉄 闇 (9 種)
 *   効果 … 強 速 硬 静 妙 (攻撃・速度・装甲・冷却・会心)
 *   動詞 … 斬 燃 貫 癒
 *   体に効く語 … 骨 魂
 *
 * 雷は「電」ではなく雷そのものを初期語にする。電は発電・感電のような熟語の
 * 部品なので、くじで引く語に回した。焔は炎と同じ属性で意味が重なるため外し、
 * 代わりに闇を入れて属性の種類を増やしている。
 * 並びは属性 → 効果 → 動詞 → 体の順。デッキの初期値もこの順で埋まる。
 */
export const STARTER_WORDS = [
  '炎', '氷', '雷', '毒', '風', '水', '聖', '鉄', '闇',
  '強', '速', '硬', '静', '妙',
  '斬', '燃', '貫', '癒',
  '骨', '魂',
];

/**
 * 初期セットの改訂。
 *   2 … 電 → 雷 / 焔 → 闇 (属性の種類をそろえ、雷を雷として持たせる)
 * 古いセーブは、まだ新しい語を持っていないときだけ入れ替える。
 * くじで先に得ていた語を二重に増やさないための条件。
 */
const STARTER_REVISION = 2;
const STARTER_SWAPS = [
  ['電', '雷'],
  ['焔', '闇'],
];

export class Save {
  constructor() {
    this.data = { ...DEFAULTS };
    this.available = true;
    this.load();
    this.ensureCollection();
  }

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.data = deepMerge(DEFAULTS, JSON.parse(raw));
    } catch {
      this.available = false;
      this.data = { ...DEFAULTS };
    }
    // 古いセーブに残っている「恒久の語」と、廃止した恒久強化の記録は読み捨てる。
    // 恒久強化の効果は部位強化の語で取り直す。
    delete this.data.startingWords;
    delete this.data.meta;
    return this.data;
  }

  save() {
    if (!this.available) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      this.available = false;
    }
  }

  reset() {
    this.data = JSON.parse(JSON.stringify(DEFAULTS));
    this.save();
    this.ensureCollection();
  }

  get d() { return this.data; }

  // ── 進行状況 ─────────────────────────────────────────────────────────────
  isCleared(stageId) { return this.data.clearedStages.includes(stageId); }

  /** 選択できる最も先のステージ番号。 */
  get maxStage() {
    let max = 1;
    for (const s of STAGES) {
      if (this.isCleared(s.id)) max = Math.min(STAGES.length, s.id + 1);
    }
    return max;
  }

  /** そのステージのクリア回数。 */
  stars(stageId) { return this.data.clearedStages.filter((x) => x === stageId).length; }

  markCleared(stageId) {
    if (!this.data.clearedStages.includes(stageId)) this.data.clearedStages.push(stageId);
  }

  unlockWeapon(id) {
    if (!this.data.unlockedWeapons.includes(id)) this.data.unlockedWeapons.push(id);
  }
  hasWeapon(id) { return this.data.unlockedWeapons.includes(id); }

  // ── 書庫 (言玉) ──────────────────────────────────────────────────────────
  // 言玉は言葉くじにだけ使う。恒久強化 (言玉で能力を買う仕組み) は廃止した。
  get ink() { return this.data.ink || 0; }

  addInk(n) {
    this.data.ink = Math.max(0, (this.data.ink || 0) + n);
    this.save();
    return this.data.ink;
  }

  // ── 走者記録 ─────────────────────────────────────────────────────────────
  recordRun({ score, kills, stageId, cleared, broken = 0, ink = 0 }) {
    const d = this.data;
    d.totalRuns++;
    d.totalKills += kills;
    d.totalBroken = (d.totalBroken || 0) + broken;
    if (score > d.bestScore) d.bestScore = score;
    if (cleared) this.markCleared(stageId);
    if (ink) this.data.ink = Math.max(0, (this.data.ink || 0) + ink);
    this.save();
  }

  // ── 所持語・デッキ・部位強化 (プレイヤー強化) ──────────────────────────
  /** 旧セーブに所持語が無ければ初期セットを付与し、壊れた値を直す。 */
  ensureCollection() {
    const d = this.data;
    if (!Array.isArray(d.collection)) {
      d.collection = STARTER_WORDS.filter((t) => WORDS[t]);
    }
    d.collection = d.collection.filter((t) => WORDS[t]);
    if (!d.collection.length) d.collection = STARTER_WORDS.filter((t) => WORDS[t]);
    // 旧セーブの初期語を新しい初期語へ 1 度だけ入れ替える。
    // 所持語だけでなく、デッキと部位に入っている分も同じ語に置き換える。
    if (!(d.starterRev >= STARTER_REVISION)) {
      const lists = [d.collection];
      if (Array.isArray(d.deck)) lists.push(d.deck);
      if (d.parts && typeof d.parts === 'object' && !Array.isArray(d.parts)) {
        for (const p of PARTS) {
          if (Array.isArray(d.parts[p.id])) lists.push(d.parts[p.id]);
        }
      }
      for (const [from, to] of STARTER_SWAPS) {
        if (!WORDS[to]) continue;
        for (const list of lists) {
          const i = list.indexOf(from);
          if (i < 0 || list.includes(to)) continue;
          list[i] = to;
        }
      }
      d.starterRev = STARTER_REVISION;
    }
    // 旧セーブにも最低 20 語を保証。新しい語は初期語彙から補う。
    for (const t of STARTER_WORDS) {
      if (d.collection.length >= DECK_MIN) break;
      if (WORDS[t] && !d.collection.includes(t)) d.collection.push(t);
    }
    if (!Array.isArray(d.deck)) d.deck = d.collection.slice(0, DECK_MAX);
    d.deck = d.deck.filter((t) => d.collection.includes(t)).slice(0, DECK_MAX);
    // デッキも常に最低数を保つ。既存ユーザーは所持語から順に補充。
    for (const t of d.collection) {
      if (d.deck.length >= DECK_MIN) break;
      if (!d.deck.includes(t)) d.deck.push(t);
    }
    if (!d.parts || typeof d.parts !== 'object' || Array.isArray(d.parts)) d.parts = {};
    // 腕 (rarm / larm) は廃止して手に統合した。旧セーブの語は手へ移す。
    for (const [from, to] of [['rarm', 'rhnd'], ['larm', 'lhnd']]) {
      const old = Array.isArray(d.parts[from]) ? d.parts[from] : [];
      delete d.parts[from];
      if (!old.length) continue;
      d.parts[to] = (Array.isArray(d.parts[to]) ? d.parts[to] : []).concat(old).slice(0, PART_SLOTS);
    }
    for (const p of PARTS) {
      d.parts[p.id] = normalizePart(d.parts[p.id], d.collection);
    }
    // ランク。持っていない語の段階は捨て、段階を範囲内に丸める。
    const ranks = {};
    if (d.ranks && typeof d.ranks === 'object' && !Array.isArray(d.ranks)) {
      for (const t of d.collection) {
        const n = d.ranks[t];
        if (Number.isInteger(n) && n > 0) ranks[t] = Math.min(RANK_MAX, n);
      }
    }
    d.ranks = ranks;
    setRanks(d.ranks);
    this.save();
  }

  /** 所持語の text 一覧。 */
  get collection() { return this.data.collection || []; }
  ownsWord(text) { return this.collection.includes(text); }

  /** 語のランク段階 (0 = コモン)。 */
  rankIndex(text) { return rankIndex(text); }
  /** 語のランク定義 ({name, mul, color})。 */
  rankOf(text) { return rankOf(text); }
  /** 次のランク名。最上位なら null。 */
  nextRankName(text) { return nextRankName(text); }
  /** 戦闘デッキの text 一覧。 */
  get deck() { return this.data.deck || []; }
  inDeck(text) { return this.deck.includes(text); }

  /** 部位に入っている語 (全部位ぶんの text 一覧)。古い呼び出し用の平坦な形。 */
  partWordList() {
    const out = [];
    for (const p of PARTS) {
      for (const e of this.partRaw(p.id)) if (e && e.text) out.push(e.text);
    }
    return out;
  }

  /** 部位の語 (整えた { text, conn } の並び)。 */
  partRaw(partId) {
    return (this.data.parts?.[partId] || []).map((e) => (e ? { text: e.t, conn: e.c || null } : null));
  }

  /**
   * 部位ごとの中身。stats.js とメニューが同じものを読む。
   * @returns {Array<{id:string,name:string,words:Array<{text:string,conn:string|null}>}>}
   */
  partEntries() {
    return PARTS.map((p) => ({
      id: p.id,
      name: p.name,
      words: this.partRaw(p.id).filter(Boolean),
    }));
  }

  /** 部位の枠 1 つ。{ text, conn } か null。 */
  partSlot(partId, i) {
    const e = this.data.parts?.[partId]?.[i];
    return e ? { text: e.t, conn: e.c || null } : null;
  }

  /** 部位の枠に入っている語の text (表示用)。 */
  partSlotText(partId, i) { return this.partSlot(partId, i)?.text || null; }

  /**
   * 言葉くじ。言玉を払って戦闘と同じ語プールから 1 語引く。
   * すでに持っている語なら言玉を少し返す。
   * @returns {{ok:boolean, reason:string, word?:string, dup?:boolean, ink:number}}
   */
  drawGacha() {
    const result = this._drawGachaBatch(1);
    return result.ok ? { ...result, ...result.results[0] } : result;
  }

  /** 十連くじ。料金不足・抽選失敗なら一切消費せずに返す。 */
  drawGachaTen() {
    return this._drawGachaBatch(10);
  }

  _drawGachaBatch(count) {
    const cost = GACHA_COST * count;
    if (this.ink < cost) return { ok: false, reason: 'ink', ink: this.ink };
    const words = [];
    for (let i = 0; i < count; i++) {
      const word = drawWord(() => Math.random());
      if (!word) return { ok: false, reason: 'empty', ink: this.ink };
      words.push(word.text);
    }

    this.data.ink -= cost;
    if (!this.data.ranks || typeof this.data.ranks !== 'object') this.data.ranks = {};
    const results = words.map((text) => {
      const dup = this.ownsWord(text);
      if (!dup) {
        this.data.collection.push(text);
        this.data.ranks[text] = 0;      // 新しい語はコモンから
        return { word: text, dup, rank: 0, rankUp: false, rankName: RANKS[0].name };
      }
      // 重複はランクアップ。最上位まで来ていたら言玉を返す。
      const now = rankIndex(text);
      if (now < RANK_MAX) {
        this.data.ranks[text] = now + 1;
        return {
          word: text, dup, rank: now + 1, rankUp: true, rankName: RANKS[now + 1].name,
        };
      }
      this.data.ink += GACHA_REFUND;
      return {
        word: text, dup, rank: now, rankUp: false, rankName: RANKS[now].name, maxed: true,
      };
    });
    setRanks(this.data.ranks);
    this.save();
    return { ok: true, reason: '', results, ink: this.ink };
  }

  /** デッキへの出し入れ。@returns {boolean} いま入っているか */
  toggleDeck(text) {
    if (!this.ownsWord(text)) return false;
    const d = this.data.deck;
    const i = d.indexOf(text);
    if (i >= 0) {
      if (d.length <= DECK_MIN) return true;
      d.splice(i, 1);
    } else {
      if (d.length >= DECK_MAX) return true;
      d.push(text);
    }
    this.save();
    return d.includes(text);
  }

  /**
   * 部位の枠に語を入れる (text=null で外す)。
   * 語を変えると、その語に付けない接続詞は落ちて当然なので枠ごと買い替える。
   * @returns {boolean} 変わったか (枠が同じ語のままなら false)
   */
  setPart(partId, slot, text) {
    if (!PARTS.some((p) => p.id === partId)) return false;
    if (text && !this.ownsWord(text)) return false;
    const arr = this.data.parts[partId] || (this.data.parts[partId] = []);
    const was = arr[slot];
    if (!text) {
      if (!was) return false;            // もともと空
      arr[slot] = null;
      this.data.parts[partId] = compact(arr);
      this.save();
      return true;
    }
    // 同じ語が入っている枠をもう一度押したら、外す (取り外せない不具合の修正)。
    if (was && was.t === text) {
      arr[slot] = null;
      this.data.parts[partId] = compact(arr);
      this.save();
      return true;
    }
    if (was && !was.t) return false;
    arr[slot] = { t: text, c: null };
    this.data.parts[partId] = compact(arr);
    this.save();
    return true;
  }

  /**
   * 部位の語に接続詞を付ける (null で外す)。
   *
   * 部位は **どの接続詞でも選べる**。言葉鍛冶 (武器) はその語のプールの
   * 送り仮名だけだが、部位は語が少なく、プールを絞ると「1 つも選べない」
   * 語が出るため。文として成り立つかは選んだあとに画面が示す。
   * @returns {{ok:boolean, reason:string}}
   */
  setPartConn(partId, slot, conn) {
    const arr = this.data.parts?.[partId];
    const e = arr && arr[slot];
    if (!e || !e.t) return { ok: false, reason: 'empty' };
    if (!conn) { e.c = null; this.save(); return { ok: true, reason: 'cleared' }; }
    if (!CONNECTORS[conn]) return { ok: false, reason: 'unknown' };
    e.c = conn;
    this.save();
    return { ok: true, reason: 'placed' };
  }

  /** 部位の枠を空にする (語も接続詞も外す)。 */
  clearPart(partId, slot) { return this.setPart(partId, slot, null); }

  // ── 設定 ─────────────────────────────────────────────────────────────────
  setSetting(k, v) {
    this.data.settings[k] = v;
    this.save();
  }
  setting(k) { return this.data.settings[k]; }
}

export { KEY, DEFAULTS };
