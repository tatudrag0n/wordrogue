// ============================================================================
// ワードローグ — プレイヤー能力の解決
//
// 語彙の中の「身体語」と、プレイヤーの部位 (右手 / 左手 / 胴 / 頭)、
// セーブの恒久強化から最終ステータスを作る。
//
// 部位には語を 1 つずつ置ける。語の効果はそのままプレイヤーに足される。
// 手の部位 (右手 / 左手) に属性語を置くと、斬撃・薙ぎの武器がその属性を纏う。
//   例 「硬」を左手に -> 硬い左手 (減傷 +2) / 「炎」を左手に -> 炎の左手
// ============================================================================

import { WORDS, ELEMENTS, CONNECTOR_SET } from '../data/words.js';
import { clamp } from '../core/util.js';

/** プレイヤーの部位。手の部位の属性語は近接武器の属性になる。 */
export const PARTS = [
  { name: '右手', hand: true },
  { name: '左手', hand: true },
  { name: '胴', hand: false },
  { name: '頭', hand: false },
];

/** 部位の表示名に使う接頭辞。硬 → 硬い右手。それ以外は「〇〇の」。 */
const PART_PRE = {
  硬: '硬い', 強: '強い', 高: '高い', 深: '深い', 遠: '遠い', 広: '広い',
  重: '重い', 柔: '柔らかい', 鋭: '鋭い', 巧: '巧い', 明: '明るい',
  早: '早い', 遅: '遅い', 近: '近い', 長: '長い', 短: '短い', 多: '多い',
  少: '少ない',
};

/** 部位の表示名を作る。「硬」+ 右手 → 硬い右手 /「炎」+ 左手 → 炎の左手。 */
export function partLabel(i, word) {
  const part = PARTS[i] || { name: `部位${i + 1}` };
  if (!word) return part.name;
  const pre = PART_PRE[word.text];
  return pre ? `${pre}${part.name}` : `${word.text}の${part.name}`;
}

/** 手の属性が武器に与える状態異常。属性語 1 つぶんの最小限。 */
const HAND_STATUS_VALUE = { burn: 2, chill: 0.15, shock: 0.12, poison: 2 };

let statsRev = 0;

/** 素の能力。 */
export const BASE_PLAYER = {
  maxHp: 100,
  spd: 122,        // px/s
  atk: 1,          // 攻撃倍率
  atkMul: 1,       // 攻撃倍率 (文から来る)
  xpMul: 1,
  hpMul: 1,
  armor: 0,        // 被ダメージ軽減 (%)
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

/** 語彙の buff 語がプレイヤーに与えるキー一覧。 */
const BUFF_KEYS = new Set([
  'hp', 'spd', 'atk', 'armor', 'crit', 'regen', 'lifesteal',
  'luck', 'magnet', 'xp', 'size', 'shield',
]);

/**
 * 語彙と部位からプレイヤー能力を集計する。
 * @param {Array} lexicon 語彙
 * @param {Array<object>} selfSlots 部位に置いた語 (右手 / 左手 / 胴 / 頭)
 * @param {Object} meta セーブ側の恒久強化
 * @returns {typeof BASE_PLAYER}
 */
export function resolvePlayerStats(lexicon, selfSlots = [], meta = {}) {
  const s = { ...BASE_PLAYER };
  s.rev = ++statsRev;
  s.maxHp += meta.hp || 0;
  s.atkMul += meta.atk || 0;
  s.xpMul += meta.xp || 0;
  s.armor += meta.armor || 0;
  s.magnet += meta.magnet || 0;
  s.crit += meta.crit || 0;

  // 語彙の buff 語。
  for (const w of lexicon) {
    if (!w || w.cat !== 'buff' || !w.player) continue;
    for (const [k, v] of Object.entries(w.player)) {
      if (!BUFF_KEYS.has(k)) continue;
      s[k] = (s[k] || 0) + v;
    }
  }

  // 部位に置いた語。効果は BUFF_KEYS の分だけそのまま足す。
  // 手の部位の属性語は weapon.resolve が斬撃・薙ぎの武器に乗せる。
  const parts = [];
  let handElement = null;
  let handStatus = null;
  for (let i = 0; i < selfSlots.length; i++) {
    const w = selfSlots[i];
    if (!w) continue;
    for (const [k, v] of Object.entries(w.fx || {})) {
      if (!BUFF_KEYS.has(k)) continue;
      s[k] = (s[k] || 0) + v;
    }
    const part = PARTS[i] || { name: `部位${i + 1}`, hand: false };
    if (part.hand && w.el && !handElement) {
      handElement = w.el;
      const status = ELEMENTS[w.el] && ELEMENTS[w.el].status;
      if (status && status !== 'none') {
        handStatus = { [status]: HAND_STATUS_VALUE[status] || 1 };
      }
    }
    parts.push({
      index: i,
      name: part.name,
      label: partLabel(i, w),
      word: w.text,
      element: w.el || null,
      hand: !!part.hand,
    });
  }
  s.parts = parts;
  s.handElement = handElement;
  s.handStatus = handStatus;

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

/** 語彙の中で重複している語をまとめる (表示用)。 */
export function lexiconSummary(lexicon) {
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
 * 部位は hud-self 側で出るので、ここには数値だけ。
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
