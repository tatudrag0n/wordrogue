// ============================================================================
// ワードローグ — プレイヤー能力の解決
//
// プレイヤーの強化はメインメニューの「部位強化」で行う (戦闘中には行わない)。
// 頭・右手・左手・胸・胴・左足・右足の 7 部位に語を入れると、
// その語の効果のうち、プレイヤーに効くキーがそのまま能力に乗る。
// 体に効く専用語という分類は無い — どの語も武器の文で使える語で、
// 体に効くかは語が持つキーで決まる。
//   語の player (`p.` で宣言した効果) … 体だけに効く (体力・移動・攻撃・経験値 …)
//   語の fx (武器側の効果)            … うち PART_KEYS にあるものは体にも効く
// セーブの恒久強化 (書庫) もここで重ねる。
//
// 部位は **1 文として数える** (武器と同じ)。1 部位に 2 語まで入れられて、
// 語の直後には接続詞が選べる。
//   癒 + 骨       … 2 語が並ぶだけ。文の力は少しだけ乗る。
//   発 + 電する   … 熟語「発電」が成立して、部位まるごとの効果が伸びる。
// 不成文の部位 (接続詞が結べていない等) は何も効かない。
//
// **文の力は体そのものにも乗る。** 体に効くキーを持たない語でも、正しく文にすれば
// わずかに攻撃と体力が上がる (文力ボーナス)。接続詞を足して文を整える意味を
// どの語でも持たせるためで、倍率は体じゅうで頭打ちにする。
//
// 戦闘中の語彙 (言葉デッキから来る) はステータスに影響しない。
// ============================================================================

import { WORDS, ELEMENTS, CONNECTOR_SET, CONNECTORS } from '../data/words.js?v=1.35';
import { clamp } from '../core/util.js';
import { evaluatePart, normPartEntries } from './parts.js';
import { rankMul } from '../data/ranks.js?v=1.35';

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
  rateMul: 1,      // 攻撃速度倍率 (部位の意味から)
};

/**
 * 語が `p.` で宣言する、プレイヤー専用のキー。
 * 武器の側では読まれない (weapon.js が捨てる) ので、弾速や大きさと同じ名前にしない。
 */
const SELF_KEYS = new Set([
  'hp', 'spd', 'atk', 'armor', 'crit', 'critDmg', 'regen', 'lifesteal',
  'luck', 'magnet', 'xp', 'size', 'shield',
]);

/**
 * 部位に入れたとき、武器側の効果のうち体にも効くキー。
 * 速さ・大きさ・攻撃倍率は武器側のものなので、ここには入れない。
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

// ─────────────────────────────────────────────────────────────────────────────
// 語の意味と部位の対応
//
// 「速い足」は移動が速くなる、「硬い胴」は装甲が上がる、「賢い頭」は
// 経験値が増える — 語の意味が部位の働きに直結するようにする。
// これは語の効果 (fx) の置き換えではなく **上乗せ** で、どの語も
// 意味の分だけ必ずプラスに働く (弱くなるだけの対応は作らない)。
//
// 効果は文の力 (gain) で伸び、部位が不成文なら gain=0 で何も乗らない。
// 移動と攻撃速度は積み上げに上限を置いて、語を並べても破綻しない。
// ─────────────────────────────────────────────────────────────────────────────
const TRAIT_WORDS = {
  speed: new Set([
    '速', '疾', '迅', '颯', '翔', '風', '軽', '突', '駆', '跳', '浮', '昇', '旋', '舞', '閃', '光', '天',
  ]),
  power: new Set([
    '強', '力', '剛', '鋭', '覇', '威', '撃', '打', '昂', '豪', '壮', '酷', '魔', '血', '蓮', '骨', '魂',
  ]),
  mind: new Set([
    '賢', '智', '感', '心', '霊', '瞬', '虚', '幻', '神', '聖', '真', '静', '巧', '志', '気',
  ]),
  guard: new Set([
    '硬', '厚', '固', '厳', '甲', '盾', '壁', '鉄', '鋼', '岩', '石', '地', '防', '護', '守', '網', '錬', '峰', '嶺', '銀',
  ]),
  life: new Set([
    '魂', '血', '癒', '陽', '花', '草', '樹', '芽', '蓮', '温', '甘', '潤', '再', '回', '露',
  ]),
  rate: new Set([
    '速', '軽', '捷', '瞬', '疾', '迅', '閃', '早', '活', '連', '律', '斉',
  ]),
};

/** 部位ごとの意味の効き方。値は 1 語あたりの基本量 (gain 倍する)。 */
const PART_TRAITS = {
  leg: [['speed', { spd: 0.10 }], ['guard', { armor: 0.02 }], ['life', { maxHp: 2 }]],
  arm: [['power', { atkMul: 0.03 }], ['rate', { rateMul: 0.03 }]],
  hand: [['power', { atkMul: 0.025, crit: 0.01 }], ['rate', { rateMul: 0.025 }], ['speed', { spd: 0.02 }]],
  head: [['mind', { xpMul: 0.06, crit: 0.015 }], ['guard', { armor: 0.01 }]],
  chest: [['life', { maxHp: 4, regen: 0.08 }], ['guard', { armor: 0.015 }], ['power', { atkMul: 0.02 }]],
  trunk: [['guard', { armor: 0.02, shield: 2 }], ['life', { maxHp: 2 }], ['power', { atkMul: 0.015 }]],
};

/** 部位 ID と名前から、意味対応の種類を決める。 */
function partKindOf(id, name) {
  const key = `${id || ''}${name || ''}`;
  if (/fot|足/.test(key)) return 'leg';
  if (/arm|腕/.test(key)) return 'arm';
  if (/hnd|手/.test(key)) return 'hand';
  if (/head|頭/.test(key)) return 'head';
  if (/chst|胸/.test(key)) return 'chest';
  if (/trnk|胴/.test(key)) return 'trunk';
  return '';
}

/**
 * 語の意味を部位の能力へ足す。
 * @returns {boolean} 何か効いたか
 */
function applyPartMeaning(s, kind, text, gain) {
  const rules = PART_TRAITS[kind];
  if (!rules || !(gain > 0) || !text) return false;
  let used = false;
  for (const [trait, fx] of rules) {
    if (!TRAIT_WORDS[trait].has(text)) continue;
    for (const [k, v] of Object.entries(fx)) {
      if (k === 'spd') s.spdTrait = (s.spdTrait || 0) + v * gain;
      else if (k === 'rateMul') s.rateMul = (s.rateMul || 1) + v * gain;
      else if (k === 'xpMul') s.xpMul += v * gain;
      else s[k] = (s[k] || 0) + v * gain;
    }
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
 * @param {boolean} selfSide 語の `p.` 側か (hp / xp / spd の向きが違う)
 * @param {number} [armorScale] 語データの装甲を割合へ直す倍率
 * @returns {boolean} 何か効いたか
 */
function applyPartSrc(s, src, keys, gain, selfSide, armorScale = 1) {
  let used = false;
  for (const [k, v] of Object.entries(src || {})) {
    if (typeof v !== 'number') continue;
    if (selfSide) {
      if (!SELF_KEYS.has(k)) continue;
      if (k === 'hp') s.maxHp += v * gain;
      else if (k === 'xp') s.xpMul += v * gain;
      else if (k === 'spd') s.spd *= 1 + v * gain;
      else s[k] = (s[k] || 0) + v * gain;
      used = true;
      continue;
    }
    if (!keys.has(k)) continue;
    if (k === 'hp') s.maxHp += v * gain;
    // 語データの装甲は「点」で書かれている (硬 = 2)。体の装甲は割合なので、
    // 1 点 = 3% として足す。1 語で 75% に張り付くのを防ぐ。
    else if (k === 'armor') s.armor += v * gain * armorScale;
    else s[k] = (s[k] || 0) + v * gain;
    used = true;
  }
  return used;
}

/**
 * 部位に入れた語とセーブの恒久強化からプレイヤー能力を集計する。
 * @param {Array} parts 部位。次のどれでも受けつける。
 *   ・{ name, words:[{text,conn}] }   … 部位ごとの文 (いまの形)
 *   ・'癒' / { text:'癒' }             … 語 1 つ (古い呼び出し。1 語 = 1 部位)
 * @param {Object} meta セーブ側の恒久強化
 * @returns {typeof BASE_PLAYER}
 */
export function resolvePlayerStats(parts, meta = {}, opt = {}) {
  const s = { ...BASE_PLAYER };
  s.maxHp += meta.hp || 0;
  s.atkMul += meta.atk || 0;
  s.xpMul += meta.xp || 0;
  // 恒久強化の装甲は「段階数」。1 段階 = 8% として割合へ直す。
  // 以前は段階数をそのまま足していたので、1 回買うだけで 75% 上限に
  // 張り付いていた。段階を重ねる意味を持たせる。
  s.armor += (meta.armor || 0) * 0.08;
  s.magnet += meta.magnet || 0;
  s.crit += meta.crit || 0;

  s.partCount = 0;
  s.partTexts = [];
  s.partRows = [];      // 部位ごとの表示 (文・grade・文の力)
  s.partBroken = [];    // 不成文の部位
  s.partPowerBonus = 0; // 文の力から来たボーナス (文力 - 1 の合計)
  s.spdTrait = 0;       // 足の「速さ」の意味から来た移動上昇 (乗算でまとめる)
  s.handElement = null;
  s.handStatus = null;

  for (const raw of parts || []) {
    const isPart = raw && typeof raw === 'object' && Array.isArray(raw.words);
    const words = isPart ? raw.words : [raw];
    const name = isPart ? (raw.name || raw.id || '') : '';
    const id = isPart ? (raw.id || raw.name || '') : '';
    const kind = partKindOf(id, name);
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
      // 語そのものの効果。`p.` で置いた体側の効果と、武器側の効果のうち体に効くもの。
      // 語のランク (言葉くじの重複で上がる) ぶん、体に効く量も伸ばす。
      const rgain = gain * rankMul(info.text);
      const selfOk = info.player ? applyPartSrc(s, info.player, SELF_KEYS, rgain, true) : false;
      const ok = applyPartSrc(s, info.fx || {}, PART_KEYS, rgain, false, 0.03) || selfOk;
      // 語の意味と部位の対応 (速い足 → 移動、硬い胴 → 装甲、賢い頭 → 経験値)。
      const meaningOk = applyPartMeaning(s, kind, info.text, rgain);
      if (ok || meaningOk) { used++; s.partTexts.push(info.text); }
      // 語の直後の接続詞。部位ではプレイヤーに効くキーだけを通す。
      if (e.conn) {
        if (applyPartSrc(s, CONNECTORS[e.conn.text]?.fx || {}, PART_KEYS, gain, false)) used++;
      }
    }
    // 熟語が成立していれば、その効果も乗る (発電 = 感電など)。
    if (p.idiom) {
      if (applyPartSrc(s, p.idiom.fx || {}, PART_KEYS, gain, false, 0.03)) used++;
    }
    // どんな語でも何かしら体に効くように、直接効果が無ければ汎用ボーナスを与える
    // 武器系語（炎・弾・強など）も部位で無効にならないようにする。
    // 文の力があればそちらで体に乗るので、力が無いときだけ最低保証を入れる。
    if (used === 0 && p.sen.count > 0 && p.power <= 1.01) {
      const fb = gain > 0 ? gain : 0.6;
      s.maxHp += 8 * fb;
      s.atkMul += 0.02 * fb;
      used = 1;
      const first = p.sen.entries[0]?.word?.text;
      if (first && !s.partTexts.includes(first)) s.partTexts.push(first);
    } else if (used === 0 && p.sen.count > 0) {
      // 力はあるが直接効果が無い場合もカウントして部位が「効いた」扱いにする
      used = 1;
      const first = p.sen.entries[0]?.word?.text;
      if (first && !s.partTexts.includes(first)) s.partTexts.push(first);
    }
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

  // 意味から来た移動上昇は最後にまとめて掛ける。上限を置いて、
  // 「速い足」を並べまくっても移動が壊れないようにする。
  s.spd *= 1 + Math.min(0.9, s.spdTrait || 0);
  delete s.spdTrait;
  s.rateMul = Math.max(1, Math.min(1.8, s.rateMul || 1));

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
  { key: 'atk', label: '攻撃', fmt: (d) => `${d > 0 ? '+' : ''}${(d * 100).toFixed(0)}%` },
  { key: 'atkMul', label: '攻撃', fmt: (d) => `${d > 0 ? '+' : ''}${(d * 100).toFixed(0)}%` },
  { key: 'armor', label: '装甲', fmt: (d) => `${d > 0 ? '+' : ''}${(d * 100).toFixed(0)}%` },
  { key: 'crit', label: '会心', fmt: (d) => `${d > 0 ? '+' : ''}${(d * 100).toFixed(0)}%` },
  { key: 'spd', label: '移動', fmt: (d) => `${d > 0 ? '+' : ''}${Math.round(d)}` },
  { key: 'rateMul', label: '攻撃速度', fmt: (d) => `${d > 0 ? '+' : ''}${(d * 100).toFixed(0)}%` },
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
  if (s.rateMul > 1.02) rows.push({ key: 'rateMul', label: '攻撃速度', value: pct(s.rateMul), kind: 'up' });
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
