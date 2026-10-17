// ============================================================================
// ワードローグ — プレイヤー能力の解決
//
// プレイヤーの強化はメインメニューの「部位強化」で行う (戦闘中には行わない)。
// 頭・右腕・左腕・右手・左手・右足・左足・胸・胴の 9 部位に語を入れると、
// その語の効果 (buff 語の player、それ以外の語は fx のうちプレイヤーに
// 効くもの) がそのまま能力に乗る。セーブの恒久強化 (書庫) もここで重ねる。
//
// 部位は **1 文として数える** (武器と同じ)。1 部位に 2 語まで入れられて、
// 語の直後には接続詞が選べる。
//   頑・健        … 2 語が並ぶだけ。文の力は少しだけ乗る。
//   発 + 電する   … 熟語「発電」が成立して、部位まるごとの効果が伸びる。
// 不成文の部位 (接続詞が結べていない等) は何も効かない。
//
// **文の力は体そのものにも乗る。** 語が buff でなくても、正しく文にすれば
// わずかに攻撃と体力が上がる (文力ボーナス)。接続詞を足して文を整える意味を
// どの語でも持たせるためで、倍率は体じゅうで頭打ちにする。
//
// 戦闘中の語彙 (言葉デッキから来る) はステータスに影響しない。
// ============================================================================

import { WORDS, ELEMENTS, CONNECTOR_SET, CONNECTORS } from '../data/words.js';
import { clamp } from '../core/util.js';
import { evaluatePart, normPartEntries } from './parts.js';

/** 素の能力。 */
export const BASE_PLAYER = {
  maxHp: 100,
  spd: 122,        // px/s
  atk: 1,          // 攻撃倍率
  atkMul: 1,       // 攻撃倍率
  xpMul: 1,
  hpMul: 1,
  armor: 0,        // 被ダメージ軽減 (割合)
  crit: 0.05,
  critDmg: 1.5,    // 会心倍率
  magnet: 1.0,     // ピックアップ回収半径倍率
  regen: 0,        // hp/s
  lifesteal: 0,
  luck: 0,
  size: 1,         // 当たり判定サイズ倍率
  shield: 0,       // 吸収シールド (被弾時に消費)
  slowImmune: 0,   // 1 で完全免疫
  reflect: 0,      // 被弾を返す割合
};

/** buff 語がプレイヤーに与えるキー一覧。 */
const BUFF_KEYS = new Set([
  'hp', 'spd', 'atk', 'armor', 'crit', 'regen', 'lifesteal',
  'luck', 'magnet', 'xp', 'size', 'shield',
]);

/**
 * buff 以外の語を部位に入れたとき、プレイヤーに効くキー。
 * 動詞の spd は弾速、大きさと攻撃は武器側のものなので、ここには入れない。
 */
const PART_KEYS = new Set([
  'hp', 'armor', 'crit', 'regen', 'lifesteal', 'luck', 'magnet', 'shield',
]);

/**
 * 文の力 → 体のボーナス。
 * 成立した部位 1 つぶんの (文の力 - 1) を積み上げて、攻撃と体力に足す。
 * 属性語のように語そのものに player 効果が無い語でも、接続詞を足して
 * 文を整えれば体が強くなる。倍率は上限を置いて破綻させない。
 */
export const PART_POWER = {
  atk: 0.25,      // (文の力 - 1) あたりの攻撃倍率
  hp: 12,         // (文の力 - 1) あたりの最大体力
  atkMax: 0.6,    // 全部位を合わせた上限
  hpMax: 40,
};

/**
 * buff 語の効果をプレイヤー能力へ写す。
 * 語データの hp は絶対値、spd と xp は割合なので、行き先のキーが違う。
 * @returns {boolean} 何か効いたか
 */
function applyBuffFx(s, src) {
  let used = false;
  for (const [k, v] of Object.entries(src)) {
    if (typeof v !== 'number' || !BUFF_KEYS.has(k)) continue;
    if (k === 'hp') s.maxHp += v;
    else if (k === 'xp') s.xpMul += v;
    else if (k === 'spd') s.spd *= 1 + v;
    else s[k] = (s[k] || 0) + v;
    used = true;
  }
  return used;
}

/**
 * 部位 1 つぶんの効果をプレイヤー能力に足す。
 * @param {object} s 集計中の能力
 * @param {object} src 語・接続詞・熟語の効果
 * @param {Set<string>} keys 通すキー
 * @param {number} gain 文の力による倍率
 * @param {boolean} buffForm buff 語の形か (hp / xp / spd の向きが違う)
 * @returns {boolean} 何か効いたか
 */
function applyPartSrc(s, src, keys, gain, buffForm) {
  let used = false;
  for (const [k, v] of Object.entries(src || {})) {
    if (typeof v !== 'number') continue;
    if (buffForm) {
      if (!BUFF_KEYS.has(k)) continue;
      if (k === 'hp') s.maxHp += v * gain;
      else if (k === 'xp') s.xpMul += v * gain;
      else if (k === 'spd') s.spd *= 1 + v * gain;
      else s[k] = (s[k] || 0) + v * gain;
      used = true;
      continue;
    }
    if (!keys.has(k)) continue;
    if (k === 'hp') s.maxHp += v * gain;
    else s[k] = (s[k] || 0) + v * gain;
    used = true;
  }
  return used;
}

/**
 * 部位に入れた語とセーブの恒久強化からプレイヤー能力を集計する。
 * @param {Array} parts 部位。次のどれでも受けつける。
 *   ・{ name, words:[{text,conn}] }   … 部位ごとの文 (いまの形)
 *   ・'頑' / { text:'頑' }             … 語 1 つ (古い呼び出し。1 語 = 1 部位)
 * @param {Object} meta セーブ側の恒久強化
 * @returns {typeof BASE_PLAYER}
 */
export function resolvePlayerStats(parts, meta = {}, opt = {}) {
  const s = { ...BASE_PLAYER };
  s.maxHp += meta.hp || 0;
  s.atkMul += meta.atk || 0;
  s.xpMul += meta.xp || 0;
  s.armor += meta.armor || 0;
  s.magnet += meta.magnet || 0;
  s.crit += meta.crit || 0;

  s.partCount = 0;
  s.partTexts = [];
  s.partRows = [];      // 部位ごとの表示 (文・grade・文の力)
  s.partBroken = [];    // 不成文の部位
  s.partPowerBonus = 0; // 文の力から来たボーナス (文力 - 1 の合計)
  s.handElement = null;
  s.handStatus = null;

  for (const raw of parts || []) {
    const isPart = raw && typeof raw === 'object' && Array.isArray(raw.words);
    const words = isPart ? raw.words : [raw];
    const name = isPart ? (raw.name || raw.id || '') : '';
    const id = isPart ? (raw.id || raw.name || '') : '';
    const p = evaluatePart(normPartEntries(words));
    if (!p.sen.count) continue;

    const isHand = id === 'rhnd' || id === 'lhnd' || /手/.test(name);
    // 手の部位に属性語があれば、その属性を手の属性として記録する (右手優先)。
    if (isHand && !s.handElement) {
      for (const e of (p.sen.entries || [])) {
        const info = WORDS[e.word.text];
        const el = info && info.el;
        if (el && el !== 'none') {
          s.handElement = el;
          const status = ELEMENTS[el] && ELEMENTS[el].status;
          if (status && status !== 'none') {
            const HAND_STATUS_VALUE = { burn: 2, chill: 0.15, shock: 0.12, poison: 2 };
            s.handStatus = { [status]: HAND_STATUS_VALUE[status] || 1 };
          }
          break;
        }
      }
    }
    const gain = p.gain;
    let used = 0;
    // 語そのものの効果。
    for (const e of p.sen.entries) {
      const info = WORDS[e.word.text];
      if (!info) continue;
      const isBuff = info.cat === 'buff';
      const ok = isBuff
        ? applyPartSrc(s, info.player || info.fx || {}, BUFF_KEYS, gain, true)
        : applyPartSrc(s, info.fx || {}, PART_KEYS, gain, false);
      if (ok) { used++; s.partTexts.push(info.text); }
      // 語の直後の接続詞。部位ではプレイヤーに効くキーだけを通す。
      if (e.conn) {
        if (applyPartSrc(s, CONNECTORS[e.conn.text]?.fx || {}, PART_KEYS, gain, false)) used++;
      }
    }
    // 熟語が成立していれば、その効果も乗る (発電 = 感電など)。
    if (p.idiom) applyPartSrc(s, p.idiom.fx || {}, PART_KEYS, gain, false);
    // 文の力そのものを体に写す。
    s.partPowerBonus += Math.max(0, p.power - 1);
    s.partCount += used;
    s.partRows.push({
      name, id, text: p.text, grade: p.ev.grade, gradeName: p.gradeInfo?.name || '',
      power: p.power, gain, idiom: p.idiom?.name || null,
      /** 語・接続詞から来た効果があったか (0 なら表示用の語)。 */
      effects: used,
      powerAtk: Math.min(PART_POWER.atkMax, Math.max(0, p.power - 1) * PART_POWER.atk),
      powerHp: Math.min(PART_POWER.hpMax, Math.max(0, p.power - 1) * PART_POWER.hp),
    });
  }

  // 文の力ぶんのボーナス。ここも上限を置く。
  // opt.powerBonus === false で切れる (語そのものの効きだけを見たいとき)。
  const withPower = opt.powerBonus !== false;
  s.partPowerAtk = withPower ? Math.min(PART_POWER.atkMax, s.partPowerBonus * PART_POWER.atk) : 0;
  s.partPowerHp = withPower ? Math.min(PART_POWER.hpMax, s.partPowerBonus * PART_POWER.hp) : 0;
  s.atkMul += s.partPowerAtk;
  s.maxHp += s.partPowerHp;

  // 補正と上限。
  s.armor = clamp(s.armor, 0, 0.75);
  s.crit = clamp(s.crit, 0, 1);
  s.critDmg = Math.max(1, s.critDmg);
  s.size = clamp(s.size, 0.55, 2.2);
  s.magnet = clamp(s.magnet, 0.3, 6);
  s.spd = clamp(s.spd, 40, 420);
  s.maxHp = Math.max(10, s.maxHp * s.hpMul);
  s.hpMul = 1;
  s.atk = Math.max(0.1, s.atk);
  s.atkMul = Math.max(0.1, s.atkMul);
  s.xpMul = Math.max(0.1, s.xpMul);
  s.lifesteal = clamp(s.lifesteal, 0, 1.2);
  s.luck = clamp(s.luck, 0, 3);

  return s;
}

/**
 * 部位の効きを「差分」で見せるための表。
 * key は resolvePlayerStats の戻り値、label は画面の名前、
 * fmt は増加分の見せ方 (d = 増減量、v = その能力の絶対値)。
 */
const EFFECT_ROWS = [
  { key: 'maxHp', label: '体力', fmt: (d) => `${d > 0 ? '+' : ''}${Math.round(d)}` },
  { key: 'atkMul', label: '攻撃', fmt: (d) => `${d > 0 ? '+' : ''}${(d * 100).toFixed(0)}%` },
  { key: 'armor', label: '装甲', fmt: (d) => `${d > 0 ? '+' : ''}${(d * 100).toFixed(0)}%` },
  { key: 'crit', label: '会心', fmt: (d) => `${d > 0 ? '+' : ''}${(d * 100).toFixed(0)}%` },
  { key: 'spd', label: '移動', fmt: (d) => `${d > 0 ? '+' : ''}${Math.round(d)}` },
  { key: 'regen', label: '回復', fmt: (d) => `${d > 0 ? '+' : ''}${d.toFixed(1)}/s` },
  { key: 'lifesteal', label: '吸血', fmt: (d) => `${d > 0 ? '+' : ''}${(d * 100).toFixed(0)}%` },
  { key: 'shield', label: '盾', fmt: (d) => `${d > 0 ? '+' : ''}${Math.round(d)}` },
  { key: 'magnet', label: '吸引', fmt: (d) => `${d > 0 ? '+' : ''}${(d * 100).toFixed(0)}%` },
  { key: 'xpMul', label: '経験値', fmt: (d) => `${d > 0 ? '+' : ''}${(d * 100).toFixed(0)}%` },
  { key: 'critDmg', label: '会心威力', fmt: (d) => `${d > 0 ? '+' : ''}${d.toFixed(2)}倍` },
  { key: 'size', label: '大きさ', fmt: (d) => `${d > 0 ? '+' : ''}${(d * 100).toFixed(0)}%` },
  { key: 'luck', label: '幸運', fmt: (d) => `${d > 0 ? '+' : ''}${d.toFixed(2)}` },
];

/** 数値の差が、画面に出す意味を持つか。丸めると 0 になる差は出さない。 */
function diffShown(key, d) {
  const a = Math.abs(d);
  if (a < 1e-9) return false;
  if (key === 'maxHp' || key === 'spd' || key === 'shield') return Math.round(a) > 0;
  if (key === 'regen') return Math.round(a * 10) > 0;
  if (key === 'luck') return Math.round(a * 100) > 0;
  return Math.round(a * 100) > 0;   // % と倍で見せるもの
}

/** 2 つの能力の差を、画面に出す行にする。 */
function diffRows(a, b) {
  const out = [];
  for (const r of EFFECT_ROWS) {
    const d = (a[r.key] || 0) - (b[r.key] || 0);
    if (!diffShown(r.key, d)) continue;
    out.push({ key: r.key, label: r.label, delta: d, text: r.fmt(d) });
  }
  return out;
}

/**
 * 部位 1 つだけを取り替えたときの能力の差。
 * 「この部位を入れると何がどれだけ変わるか」をそのまま出す。
 * @param {Array} parts save.partEntries() の形
 * @param {string} partId 取り替える部位
 * @param {Object} [meta] 書庫の恒久強化
 * @returns {Array<{key:string, label:string, delta:number, text:string}>}
 */
export function partEffectRows(parts, partId, meta = {}) {
  const list = (parts || []).filter(Boolean);
  const withPart = resolvePlayerStats(list, meta);
  const rest = list.filter((p) => (p.id || p.name) !== partId);
  const without = resolvePlayerStats(rest, meta);
  return diffRows(withPart, without);
}

/**
 * 全部位を合わせた効き (素の能力との差)。
 * @returns {Array<{key:string, label:string, delta:number, text:string}>}
 */
export function partTotalRows(parts, meta = {}) {
  return diffRows(resolvePlayerStats((parts || []).filter(Boolean), meta), resolvePlayerStats([], meta));
}

/**
 * 語 1 つを部位に入れたときの効き (差分)。文の力ぶんも含む。
 * @param {string} text
 * @param {Object} [meta]
 */
export function wordEffectRows(text, meta = {}) {
  return partEffectRows([{ id: 'tmp', name: 'tmp', words: [{ text, conn: null }] }], 'tmp', meta);
}

/**
 * 語 1 つを部位に入れたときの **語そのもの** の効き。
 * 文の力ぶんのボーナスを切って測るので、「この語が体に直接効くか」が分かる。
 * 属性語・武器語は 0 件になる (武器の文で使う語)。
 * @param {string} text
 * @param {Object} [meta]
 */
export function wordDirectEffectRows(text, meta = {}) {
  const part = { id: 'tmp', name: 'tmp', words: [{ text, conn: null }] };
  const withPart = resolvePlayerStats([part], meta, { powerBonus: false });
  const without = resolvePlayerStats([], meta, { powerBonus: false });
  return diffRows(withPart, without);
}

/** 語彙の中で重複している語をまとめる (表示用)。 */export function lexiconSummary(lexicon) {
  const count = new Map();
  for (const w of lexicon) {
    if (!w) continue;
    count.set(w.text, (count.get(w.text) || 0) + 1);
  }
  return [...count.entries()].map(([text, n]) => ({ text, n, word: w(lexicon, text) }))
    .filter((x) => x.word);
}

const w = (lexicon, text) => lexicon.find((x) => x && x.text === text);

/** 語彙の中で「文に使える」語 (接続詞でないもの) の数。 */
export function lexiconContentCount(lexicon) {
  let n = 0;
  for (const x of lexicon) {
    if (x && !CONNECTOR_SET.has(x.text)) n++;
  }
  return n;
}

/**
 * HUD に出す能力表示の並びを決める。
 * 値が 0 のものは入れない。
 * @param {typeof BASE_PLAYER} s
 * @returns {Array<{key:string,label:string,value:string,kind:string}>}
 */
export function statRows(s) {
  const pct = (v) => `${Math.round(v * 100)}%`;
  const rows = [];

  rows.push({ key: 'atk', label: '攻撃', value: pct(s.atk * s.atkMul), kind: 'up' });
  rows.push({ key: 'spd', label: '移動', value: String(Math.round(s.spd)), kind: '' });
  rows.push({ key: 'hp', label: '体力', value: String(Math.round(s.maxHp)), kind: '' });
  rows.push({ key: 'crit', label: '会心', value: pct(s.crit), kind: '' });
  rows.push({ key: 'critDmg', label: '会心威力', value: `${s.critDmg.toFixed(2)}倍`, kind: '' });
  rows.push({ key: 'armor', label: '減傷', value: pct(s.armor), kind: s.armor > 0 ? 'up' : '' });

  // 0 のものは省略する。回復や吸血など、取ったときだけ効くもの。
  if (s.regen > 0) rows.push({ key: 'regen', label: '回復', value: `${s.regen.toFixed(1)}/s`, kind: 'up' });
  if (s.lifesteal > 0) rows.push({ key: 'lifesteal', label: '吸血', value: pct(s.lifesteal), kind: 'up' });
  if (s.shield > 0) rows.push({ key: 'shield', label: 'シールド', value: String(Math.round(s.shield)), kind: 'up' });
  if (s.magnet > 1.02) rows.push({ key: 'magnet', label: '吸引', value: `${s.magnet.toFixed(1)}倍`, kind: 'up' });
  if (s.xpMul > 1.02) rows.push({ key: 'xpMul', label: '経験値', value: pct(s.xpMul), kind: 'up' });
  if (s.slowImmune >= 1) rows.push({ key: 'slowImmune', label: '減速耐性', value: 'あり', kind: 'up' });
  if (Math.abs(s.size - 1) > 0.02) {
    rows.push({ key: 'size', label: '大きさ', value: `${s.size.toFixed(2)}倍`, kind: '' });
  }

  return rows;
}

/** 1 行のテキストに落とす版 (ログやテスト用)。 */
export function statLine(s) {
  return statRows(s).map((r) => `${r.label} ${r.value}`).join('  ');
}

export { BUFF_KEYS };
