// ============================================================================
// ワードローグ — 文の全パターン監査
//
// 「想定されうる文」を機械的に列挙して、次を確かめる。
//   1. 自然な文が不成文になっていない (curated corpus)
//   2. 不自然な文が成立していない (curated corpus + 文法の不変条件)
//   3. 全語 × 全接続詞形 × 全語 の 2 語パターンが、規則どおりに落ちる
//   4. 全語と全接続詞形に、文を作れる相手が最低 1 つある (行き止まりなし)
//   5. 「〜を」+自動詞、「〜の」+他動詞 (主体になれない語)、文末接続詞は
//      どの組み合わせでも成立しない
//   6. 語の意味と部位の能力が結びついている (速い足 → 移動 など)
//   7. デバフだけの語が無い
//
// 3 語以上は、代表語の全 3 語組 + 中間の全接続詞形で標本検査する。
// 2 語の全列挙が隣接する語と接続詞の全パターンを覆うので、
// 3 語以上で新しく壊れるのは、この標本と curated corpus で拾う。
// ============================================================================

import {
  WORDS, CONNECTOR_SET, evaluate, makeWord,
} from '../js/data/words.js';
import { connectorFor } from '../js/data/words.connect.js';
import { WeaponInst } from '../js/game/weapon.js';
import { evaluatePart } from '../js/game/parts.js';
import { resolvePlayerStats, BASE_PLAYER } from '../js/game/stats.js';
import { ELEMENTS } from '../js/data/words.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => {
  if (cond) pass++;
  else { fail++; console.log('  FAIL:', msg); }
};
const sec = (t) => console.log(`\n== ${t} ==`);

/** 最後に件数をまとめて報告するためのカウンタ。 */
let twoWordPatterns = 0;
let threeWordPatterns = 0;

/** 語の並び (接続詞は直前の語に付く) から WeaponInst の評価を作る。 */
const weaponEval = (tokens) => {
  const wi = new WeaponInst('sword');
  for (const t of tokens) {
    if (!WORDS[t]) return { valid: false, reason: 'unknown', reasonText: `未知の語: ${t}` };
    if (CONNECTOR_SET.has(t)) {
      const last = wi.sentence.entries[wi.sentence.entries.length - 1];
      if (!last) return { valid: false, reason: 'conn' };
      last.conn = makeWord(t);
    } else {
      wi.sentence.entries.push({ word: makeWord(t), conn: null });
    }
  }
  return wi.evaluate();
};

/** 部位の語 ([{text,conn}]) を作る。 */
const partWords = (first, conn) => [{ text: first, conn: conn || null }];

// ─────────────────────────────────────────────────────────────────────────────
sec('自然な文が不成文になっていない');
// 日本語として自然で、そのままゲームの武器名にできる文。
// 文末は必ず語で閉じる。接続詞はその語の直後。
const NATURAL = [
  ['焔', 'を', '斬', 'る', '剣'],
  ['焔', 'を', '斬', 'られた', '剣'],
  ['凍', 'える', '刃'],
  ['滑', 'らかな', '刃'],
  ['静', 'かな', '刃'],
  ['呪', 'いの', '毒', 'を', '斬', 'る', '刃'],
  ['必', 'ず', '斬', 'る', '刃'],
  ['焔', 'に', '強', 'い', '剣'],
  ['風', 'の', '潮', 'の', '銃'],
  ['光', 'の', '速', 'い', '矢'],
  ['雷', 'を', '貫', 'く', '針'],
  ['闇', 'を', '裂', 'く', '刃'],
  ['血', 'を', '吸', 'う', '剣'],
  ['岩', 'を', '砕', 'く', '槌'],
  ['風', 'を', '斬', 'る', '刃'],
  ['速', 'く', '翔', 'ける', '剣'],
  ['深', 'く', '斬', 'る', '刃'],
  ['無', 'の', '剣'],
  ['虚', '無', 'の', '剣'],
  ['煉', '獄', 'の', '剣'],
  ['獄', '炎', '剣'],
  ['迅', '雷', '刃'],
  ['絶', '影', '刃'],
  ['冥', '暗', '刃'],
  ['羅', '刹', '牙'],
  ['終', 'える', '剣'],
  ['光', 'り', '輝', 'く', '剣'],
  ['貫', 'き', '通', 'す', '剣'],
  ['斬', 'り', '裂', 'く', '剣'],
  ['舞', 'い', '散', 'る', '剣'],
  ['踏', 'み', '潰', 'す', '剣'],
  ['突', 'き', '刺', 'す', '剣'],
  ['穿', 'ち', '貫', 'く', '剣'],
  ['神', 'の', '斬', 'る', '剣'],
  ['炎', 'の', '爆', '発', 'する', '剣'],
  ['焔', 'の', '燃', 'える', '剣'],
  ['風', 'に', '舞', 'う', '剣'],
  ['闇', 'に', '溶', 'ける', '刃'],
  ['焔', 'へ', '翔', 'ける', '剣'],
  ['氷', 'を', '凍', '結', 'する', '剣'],
  ['焔', 'を', '斬', 'って', '燃', 'える', '刃'],
  ['炎', 'を', '溶', 'かす', '剣'],
  ['焔', 'を', '燃', 'やす', '剣'],
  ['天', '焦', 'がす', '滅', '亡', 'の', '光'],
  ['静', 'かに', '燃', 'える', '聖', 'なる', '炎'],

  // 連用修飾語は目的語句の前後どちらにも置ける。
  // どちらも「目的語 → 後方の他動詞」の係りが解決する。
  ['敵', 'を', '深', 'く', '斬', 'る', '剣'],
  ['深', 'く', '敵', 'を', '斬', 'る', '剣'],
  ['敵', 'を', '静', 'かに', '斬', 'る', '剣'],
  ['静', 'かに', '敵', 'を', '斬', 'る', '剣'],
  ['敵', 'を', '必', 'ず', '斬', 'る', '剣'],
  ['必', 'ず', '敵', 'を', '斬', 'る', '剣'],
  ['敵', 'を', '強', 'く', '斬', 'る', '剣'],
  ['強', 'く', '敵', 'を', '斬', 'る', '剣'],
  ['敵', 'を', '深', 'く', '静', 'かに', '斬', 'る', '剣'],
  ['深', 'く', '静', 'かに', '敵', 'を', '斬', 'る', '剣'],
  ['敵', 'を', '深', 'く', '斬', 'り', '裂', 'く', '剣'],
  ['深', 'く', '敵', 'を', '斬', 'り', '裂', 'く', '剣'],
  ['敵', 'を', '深', 'く', '貫', 'く', '剣'],
  ['深', 'く', '敵', 'を', '貫', 'く', '剣'],
  ['敵', 'の', '剣', 'を', '深', 'く', '斬', 'る', '剣'],
  ['深', 'く', '敵', 'の', '剣', 'を', '斬', 'る', '剣'],
  ['敵', 'に', '深', 'く', '刺', 'す', '剣'],
  ['敵', 'を', '深', 'く', '刺', 'す', '剣'],

  // 連用修飾の重なり、必ず + 深く、の目的語、に + 連用。
  ['敵', 'を', '必', 'ず', '深', 'く', '斬', 'る', '剣'],
  ['必', 'ず', '深', 'く', '敵', 'を', '斬', 'る', '剣'],
  ['敵', 'を', '静', 'かに', '深', 'く', '斬', 'る', '剣'],
  ['静', 'かに', '深', 'く', '敵', 'を', '斬', 'る', '剣'],
  ['敵', 'を', '鋭', 'く', '斬', 'る', '剣'],
  ['鋭', 'く', '敵', 'を', '斬', 'る', '剣'],
  ['敵', 'を', '確', 'かに', '斬', 'る', '剣'],
  ['確', 'かに', '敵', 'を', '斬', 'る', '剣'],
  ['敵', 'を', '深', 'く', '討', 'つ', '剣'],
  ['深', 'く', '敵', 'を', '討', 'つ', '剣'],
  ['敵', 'を', '深', 'く', '屠', 'る', '剣'],
  ['深', 'く', '敵', 'を', '屠', 'る', '剣'],
  ['敵', 'の', '剣', 'を', '必', 'ず', '斬', 'る', '剣'],
  ['必', 'ず', '敵', 'の', '剣', 'を', '斬', 'る', '剣'],
  ['敵', 'の', '剣', 'を', '深', 'く', '刺', 'す', '剣'],
  ['深', 'く', '敵', 'の', '剣', 'を', '刺', 'す', '剣'],
  ['敵', 'に', '必', 'ず', '刺', 'す', '剣'],
  ['必', 'ず', '敵', 'に', '刺', 'す', '剣'],
  ['敵', 'に', '静', 'かに', '刺', 'す', '剣'],
  ['静', 'かに', '敵', 'に', '刺', 'す', '剣'],
  ['敵', 'を', '深', 'く', '斬', 'り', '裂', 'く', '刃'],
  ['深', 'く', '敵', 'を', '斬', 'り', '裂', 'く', '刃'],
  ['敵', 'を', '斬', 'り', '裂', 'く', '剣'],
  ['深', 'く', '敵', 'に', '刺', 'す', '剣'],
  ['敵', 'へ', '深', 'く', '翔', 'ける', '剣'],
  ['敵', 'に', '強', 'く', '刺', 'す', '剣'],
];
for (const tokens of NATURAL) {
  const r = weaponEval(tokens);
  ok(r.valid, `自然な「${tokens.join('')}」が落ちた: ${r.reasonText || r.reason}`);
}

// ─────────────────────────────────────────────────────────────────────────────
sec('不自然な文が成立していない');
const UNNATURAL = [
  ['焔', 'を', '燃', 'える', '剣'],       // 自動詞 + を
  ['焔', 'を', '凍', 'える', '剣'],
  ['焔', 'を', '舞', 'う', '剣'],
  ['焔', 'を', '翔', 'ける', '剣'],
  ['焔', 'を', '輝', 'く', '剣'],
  ['焔', 'を', '響', 'く', '剣'],
  ['焔', 'を', '溶', 'ける', '剣'],
  ['焔', 'の', '斬', 'る', '剣'],         // 焔は斬る主体になれない
  ['風', 'の', '斬', 'る', '剣'],
  ['速', 'く', '剣'],
  ['妙', 'に', '剣'],
  ['焔', 'を', '剣'],
  ['焔', 'を', '斬', 'る'],               // 文末が接続詞
  ['風', 'の', '潮', 'の'],
  ['斬', 'された', '刃'],                 // 斬 に された は無い
  ['静', 'に', '剣'],                     // 静 に は無い
  ['焔', 'する', '剣'],                   // 焔 に する は無い
  ['焔', 'に', '剣'],
  ['斬', 'る', '速', 'く', '斬', 'る', '剣'],
  ['刃', '剣'],                           // 形の語どうしが隣り合う
  ['焔', 'を', '燃', 'える', '刃'],
  ['氷', 'を', '溶', 'ける', '剣'],

  // 係り先が最後まで解決しない形は、連用形 + 名詞でも通さない。
  ['敵', 'を', '深', 'く'],                 // 文末が接続詞
  ['深', 'く', '敵'],                       // 連用形の係り先が無い
  ['敵', 'を', '深', 'く', '剣'],           // 「を」の述語が無い
  ['深', 'く', '剣'],                       // 連用形 + 名詞だけ
  ['深', 'く', '敵', 'の', '剣'],           // 連用形 + の名詞句 + 名詞 (述語なし)
  ['敵', 'を', '深', 'く', '斬', 'る'],     // 文末が接続詞
  ['深', 'く', '敵', 'を', '斬', 'る'],     // 文末が接続詞
  ['敵', 'を', '深', 'く', '燃', 'える', '剣'], // 自動詞 + を
  ['深', 'く', '敵', 'を', '燃', 'える', '剣'], // 連用形を挟んでも自動詞 + を
  ['敵', 'を', '静', 'かに', '燃', 'える', '剣'],
  ['敵', 'を', '必', 'ず', '燃', 'える', '剣'],
  ['深', 'く', '敵', 'を', '斬', 'る', '刃', '剣'], // 形の語が隣り合う
  ['敵', 'を', '深', 'く', '斬', 'る', '弾', '剣'], // 形の語が隣り合う
  ['敵', 'を', '深', 'く', '剣', 'を'],     // 文末が接続詞
  ['深', 'く', '敵', 'を'],                   // 連用形 + 目的語だけ
];
for (const tokens of UNNATURAL) {
  const r = weaponEval(tokens);
  ok(!r.valid, `不自然な「${tokens.join('')}」が成立した: ${r.reasonText || r.reason}`);
}

// ─────────────────────────────────────────────────────────────────────────────
sec('部位の文 (「速い足」など) が成る');
const PART_NATURAL = [
  ['速', 'い'], ['静', 'かな'], ['賢', 'い'], ['硬', 'い'],
  ['風', 'の'], ['駆', 'ける'], ['焔', 'の'], ['強', 'い'], ['呪', 'いの'],
  ['発', 'する'],
];
for (const [w, c] of PART_NATURAL) {
  const r = evaluatePart(partWords(w, c));
  ok(r.valid, `部位「${w}${c}」が不成文: ${r.reasonText}`);
}
const PART_UNNATURAL = [
  ['速', 'く'], ['焔', 'を'], ['妙', 'に'],
];
for (const [w, c] of PART_UNNATURAL) {
  const r = evaluatePart(partWords(w, c));
  ok(!r.valid, `部位「${w}${c}」が成立した: ${r.text}`);
}
{
  const r = evaluatePart([{ text: '発', conn: null }, { text: '電', conn: 'する' }]);
  ok(!r.valid, '部位「発電する」が成立した (名詞で閉じる必要がある)');
}
{
  const r = evaluatePart([{ text: '刃', conn: null }, { text: '剣', conn: null }]);
  ok(!r.valid, '部位「刃剣」が成立した (形の語どうしは隣り合えない)');
}

// ─────────────────────────────────────────────────────────────────────────────
sec('語の意味が部位の能力になる');
{
  const base = resolvePlayerStats([]);
  const leg = resolvePlayerStats([{ id: 'rfot', name: '右足', words: partWords('速', 'い') }]);
  ok(leg.spd > base.spd + 5, `速い足で移動が上がらない: ${base.spd} -> ${leg.spd}`);
  const windLeg = resolvePlayerStats([{ id: 'lfot', name: '左足', words: partWords('風', 'の') }]);
  ok(windLeg.spd > base.spd + 5, `風の足で移動が上がらない: ${base.spd} -> ${windLeg.spd}`);
  const head = resolvePlayerStats([{ id: 'head', name: '頭', words: partWords('賢', 'い') }]);
  ok(head.xpMul > base.xpMul, `賢い頭で経験値が上がらない: ${head.xpMul}`);
  const arm = resolvePlayerStats([{ id: 'rarm', name: '右腕', words: partWords('速', null) }]);
  ok(arm.rateMul > base.rateMul, `速い腕で攻撃速度が上がらない: ${arm.rateMul}`);
  const trunk = resolvePlayerStats([{ id: 'trnk', name: '胴', words: partWords('硬', 'い') }]);
  ok(trunk.armor > base.armor, `硬い胴で装甲が上がらない: ${trunk.armor}`);
  const hand = resolvePlayerStats([{ id: 'rhnd', name: '右手', words: partWords('炎', 'の') }]);
  ok(hand.handElement === 'fire', `炎の右手が武器の属性にならない: ${hand.handElement}`);
  const broken = resolvePlayerStats([{ id: 'rfot', name: '右足', words: partWords('速', 'く') }]);
  ok(Math.abs(broken.spd - base.spd) < 1e-6, `不成文の部位が効いている: ${base.spd} -> ${broken.spd}`);

  // 基本武器から作った文は、その語 1 つで武器として成立する。
  const basicOne = new WeaponInst('form:剣');
  basicOne.sentence.entries = [{ word: makeWord('剣'), conn: null }];
  ok(basicOne.resolve({ ...BASE_PLAYER }).active, '「剣」1 語の基本武器が撃てない');
  // 特殊武器は 1 語ではまだ文にならない (動詞を述べる前の状態)。
  const specialOne = new WeaponInst('form:光');
  specialOne.sentence.entries = [{ word: makeWord('光'), conn: null }];
  ok(!specialOne.resolve({ ...BASE_PLAYER }).active, '「光」1 語で特殊武器が発動した');

  // 手の属性が武器の属性・状態異常として乗る。
  const makeWeapon = () => {
    const wi = new WeaponInst('form:剣');
    wi.sentence.entries = [{ word: makeWord('剣'), conn: null }];
    return wi;
  };
  const res = makeWeapon().resolve({ ...BASE_PLAYER, handElement: 'fire', handStatus: { burn: 2 } });
  ok(res.active && res.element === 'fire', `炎の右手が武器の属性に乗らない: ${res.element}`);
  ok(res.stats.burn >= 2, `炎の右手が武器の炎上に乗らない: ${res.stats.burn}`);

  // 速い腕が実際の攻撃間隔に乗る。
  const normal = makeWeapon().resolve({ ...BASE_PLAYER });
  const fast = makeWeapon().resolve({ ...BASE_PLAYER, rateMul: 1.25 });
  ok(fast.stats.rate > normal.stats.rate, `速い腕が武器の攻撃速度に乗らない: ${normal.stats.rate} -> ${fast.stats.rate}`);

  // 動詞の意味が特殊武器の攻撃の型になる。
  //   「光を斬る」は光線ではなく斬撃、「風を貫く」は貫通。
  const special = (head, tokens) => {
    const wi = new WeaponInst(`form:${head}`);
    const entries = [];
    for (const t of tokens) {
      if (CONNECTOR_SET.has(t)) entries[entries.length - 1].conn = makeWord(t);
      else entries.push({ word: makeWord(t), conn: null });
    }
    wi.sentence.entries = entries;
    return wi.resolve({ ...BASE_PLAYER });
  };
  ok(special('光', ['光', 'を', '斬', 'る', '光']).kind === 'slash',
    `「光を斬る光」が斬撃にならない: ${special('光', ['光', 'を', '斬', 'る', '光']).kind}`);
  ok(special('風', ['風', 'を', '貫', 'く', '風']).kind === 'pierce',
    `「風を貫く風」が貫通にならない: ${special('風', ['風', 'を', '貫', 'く', '風']).kind}`);
  ok(special('光', ['光', 'を', '焦', 'がす', '光']).kind === 'beam',
    `「光を焦がす光」が光線のままにならない: ${special('光', ['光', 'を', '焦', 'がす', '光']).kind}`);

  // 熟語 (貫通・爆裂) も述語になる。語 1 つの品詞ではなく、熟語の語幹で見る。
  ok(special('光', ['光', 'を', '貫', '通', 'する', '光']).kind === 'pierce',
    `「光を貫通する光」が貫通にならない: ${special('光', ['光', 'を', '貫', '通', 'する', '光']).kind}`);
  // 武器語があっても、述語の動詞が「何をする攻撃か」を決める。
  const tailed = new WeaponInst('form:刃');
  tailed.sentence.entries = [
    { word: makeWord('貫'), conn: null },
    { word: makeWord('通'), conn: makeWord('する') },
    { word: makeWord('刃'), conn: null },
  ];
  const tailedRes = tailed.resolve({ ...BASE_PLAYER });
  ok(tailedRes.kind === 'pierce', `「貫通する刃」が斬撃のまま: ${tailedRes.kind}`);
  // 武器語も属性語も無い文は、頭の熟語が何をする文かを決める。
  const blank = new WeaponInst('sword');
  blank.sentence.entries = [
    { word: makeWord('爆'), conn: null },
    { word: makeWord('裂'), conn: null },
  ];
  const blankRes = blank.resolve({ ...BASE_PLAYER });
  ok(blankRes.kind === 'bomb', `「爆裂」が爆発にならない: ${blankRes.kind}`);
}

// ─────────────────────────────────────────────────────────────────────────────
sec('デバフだけの語が無い');
{
  const negatives = [];
  for (const [text, w] of Object.entries(WORDS)) {
    if (w.cat === 'connect') continue;
    const values = [...Object.values(w.fx || {}), ...Object.values(w.player || {})];
    if (!values.some((v) => typeof v === 'number' && v > 0)) negatives.push(text);
  }
  ok(negatives.length === 0, `弱くなるだけの語: ${negatives.join(' ')}`);
  const connNeg = [];
  for (const [text, c] of Object.entries(WORDS)) {
    if (c.cat !== 'connect') continue;
    const vals = Object.values(c.fx || {});
    if (vals.length && !vals.some((v) => v > 0)) connNeg.push(text);
  }
  ok(connNeg.length === 0, `弱くなるだけの接続詞: ${connNeg.join(' ')}`);
  // 追加した語が辞書にあること。
  for (const w of [
    '獄', '冥', '羅', '刹', '覇', '虚', '幻', '閃', '絶', '終', '劫',
    '迅', '颯', '煉', '燼', '煌', '戮', '屠', '討', '刈', '祓', '祟',
    '葬', '刺', '刻', '駆', '研',
  ]) ok(!!WORDS[w], `追加語「${w}」が辞書に無い`);
  for (const w of Object.keys(ELEMENTS)) ok(ELEMENTS[w].color, `属性 ${w} の色が無い`);
}

// ─────────────────────────────────────────────────────────────────────────────
sec('全 2 語パターンの列挙');
{
  const content = Object.keys(WORDS).filter((w) => WORDS[w].cat !== 'connect');
  const reachWord = new Set();
  const reachForm = new Set();
  let patterns = 0;
  let valid = 0;
  let trailing = 0;
  let intransValid = 0;
  let subjectValid = 0;
  let unknownReason = 0;
  const KNOWN_REASONS = new Set([
    'empty', 'onelexeme', 'unseg', 'noparticle', 'fewwords', 'tailverb',
    'tailparticle', 'tailform', 'connorder', 'floatconn', 'tailconn',
    'connnoun', 'noobject', 'intransitive', 'subjectverb',
  ]);

  for (const a of content) {
    const forms = connectorFor({ text: a });
    // 文末が接続詞の文は、どの語でも成立しない。
    for (const k of forms) {
      const r = evaluate([makeWord(a), makeWord(k)]);
      patterns++;
      if (r.valid) {
        trailing++;
        ok(false, `文末接続詞「${a}${k}」が成立した`);
      }
    }
    for (const b of content) {
      const bare = evaluate([makeWord(a), makeWord(b)]);
      patterns++;
      if (bare.valid) { valid++; reachWord.add(a); reachWord.add(b); }
      for (const k of forms) {
        const r = evaluate([makeWord(a), makeWord(k), makeWord(b)]);
        patterns++;
        if (r.valid) {
          valid++;
          reachWord.add(a);
          reachWord.add(b);
          reachForm.add(`${a}|${k}`);
          // ── 不変条件: 成立した文に、禁止した形が混ざっていないこと。
          const segs = r.segments;
          const last = segs[segs.length - 1];
          if (CONNECTOR_SET.has(last)) trailing++;
          // 「を」の直後が自動詞の形なら、成立していてはいけない。
          for (let i = 0; i + 1 < segs.length; i++) {
            if (segs[i] !== 'を') continue;
            const c = (r.compounds || []).find((x) => x.idx === i);
            if (!c) continue;
            const next = segs[i + 1];
            const nf = (r.compounds || []).find((x) => x.idx === i + 2);
            if (next && nf && WORDS[next]?.cat === 'verb' && nf.intr) intransValid++;
          }
          // 「の」の直後が他動詞の能動連体で、主体が無生物なら成立しない。
          for (let i = 0; i + 1 < segs.length; i++) {
            if (segs[i] !== 'の') continue;
            const c = (r.compounds || []).find((x) => x.idx === i);
            if (!c) continue;
            const next = segs[i + 1];
            const nf = (r.compounds || []).find((x) => x.idx === i + 2);
            if (next && nf && nf.pred && !nf.intr && !nf.passive
              && !['神', '魔', '魂', '霊', '賢', '己', '心', '影', '死', '冥', '覇'].includes(segs[i - 1])) {
              subjectValid++;
            }
          }
        } else if (!KNOWN_REASONS.has(r.reason)) {
          unknownReason++;
        }
      }
    }
  }

  ok(trailing === 0, `成立した文末接続詞が ${trailing} 件ある`);
  ok(intransValid === 0, `「〜を」+自動詞が ${intransValid} 件成立している`);
  ok(subjectValid === 0, `無生物「〜の」+他動詞が ${subjectValid} 件成立している`);
  ok(unknownReason === 0, `未知の不成文理由が ${unknownReason} 件ある`);
  ok(reachWord.size === content.length, `文を作れない語が ${content.length - reachWord.size} 語ある`);
  let unreachableForm = 0;
  for (const a of content) {
    for (const k of connectorFor({ text: a })) {
      if (!reachForm.has(`${a}|${k}`)) unreachableForm++;
    }
  }
  ok(unreachableForm === 0, `文を作れない接続詞形が ${unreachableForm} 件ある`);

  // 自然さの指標 (natural × 0.38 + 熟語) が高い文のほうが、必ず強い。
  // 2 語の列挙を先頭 4000 組だけ確かめる (全件は同じ式なので標本でよい)。
  let inversions = 0;
  let checked = 0;
  for (const a of content) {
    if (checked >= 200) break;
    for (const b of content) {
      const bare = evaluate([makeWord(a), makeWord(b)]);
      if (!bare.valid) continue;
      for (const k of connectorFor({ text: a })) {
        const r = evaluate([makeWord(a), makeWord(k), makeWord(b)]);
        if (!r.valid) continue;
        const ea = bare.natural * 0.38 + bare.phraseBonus;
        const eb = r.natural * 0.38 + r.phraseBonus;
        if (ea > eb + 1e-9 && bare.fx.power < r.fx.power - 1e-9) inversions++;
        checked++;
        if (checked >= 4000) break;
      }
      if (checked >= 4000) break;
    }
  }
  ok(inversions === 0, `自然さと威力が逆転した組が ${inversions} 件ある`);
  console.log(`  走査 ${patterns} パターン / 成立 ${valid} / 語 ${content.length}`
    + ` / 接続詞形 ${reachForm.size} / 逆転 ${inversions}`);
  twoWordPatterns = patterns;
}

// ─────────────────────────────────────────────────────────────────────────────
sec('自動詞・他動詞の全組み合わせ');
{
  const content = Object.keys(WORDS).filter((w) => WORDS[w].cat !== 'connect');
  let checked = 0;
  let bad = 0;
  for (const a of content) {
    for (const b of content) {
      for (const form of WORDS[b].pool || []) {
        if (!form.intr) continue;
        // 自動詞の形を「〜を」で受けて、名詞で閉じた文。
        const r = evaluate([
          makeWord(a), makeWord('を'), makeWord(b), makeWord(form.k), makeWord('剣'),
        ]);
        checked++;
        if (r.valid && r.reason !== 'tailconn') {
          // 名詞で閉じているので tailconn 以外で成立したら規則漏れ。
          bad++;
          if (bad <= 3) console.log(`  漏れ: ${a}を${b}${form.k}剣`);
        }
      }
    }
  }
  ok(bad === 0, `自動詞の「を」受けが ${bad} 件成立している`);
  console.log(`  自動詞の形 ${checked} 通り`);
}

// ─────────────────────────────────────────────────────────────────────────────
sec('3 語の標本 (代表語 × 中間の全接続詞形)');
{
  const SAMPLE = [
    '炎', '氷', '風', '雷', '光', '闇', '毒', '水', '岩', '草',
    '剣', '銃', '環', '弾', '矢', '杖', '鞭', '拳', '牙', '爪',
    '斬', '燃', '凍', '舞', '吸', '裂', '刺', '葬', '絶', '終',
    '速', '強', '静', '妙', '硬', '賢', '魂', '無', '神', '覇',
  ].filter((w) => WORDS[w]);
  let patterns = 0;
  let bad = 0;
  for (const a of SAMPLE) {
    for (const b of SAMPLE) {
      for (const c of SAMPLE) {
        for (const k of connectorFor({ text: b })) {
          const r = evaluate([makeWord(a), makeWord(b), makeWord(k), makeWord(c)]);
          patterns++;
          if (!r.valid) continue;
          const segs = r.segments;
          const last = segs[segs.length - 1];
          if (CONNECTOR_SET.has(last)) bad++;
          for (let i = 0; i + 1 < segs.length; i++) {
            if (segs[i] !== 'を') continue;
            const nf = (r.compounds || []).find((x) => x.idx === i + 2);
            if (nf && nf.intr) bad++;
          }
        }
      }
    }
  }
  ok(bad === 0, `3 語の標本で禁止形が ${bad} 件成立している`);
  console.log(`  走査 ${patterns} パターン`);
  threeWordPatterns = patterns;
}

// ─────────────────────────────────────────────────────────────────────────────
// 連用修飾・目的語・述語の順序テンプレート
//
// 「深く敵を斬る剣」と「敵を深く斬る剣」は同じ文の語順違い。どちらも
// 目的語の係り先 (斬る) と連用修飾の係り先 (斬る) が解決する。
//
// 3 語の全列挙 (連用形 × 目的語 × 他動詞) は 64 × 147 × 81 = 76 万通り
// あり、全文を evaluate すると 1 分以上かかる。ここでは役割クラスごとに
// 軸を全列挙し、残りの軸を代表語にして全順序テンプレートを覆う
// (テストが遅くなりすぎるときの許容範囲)。2 語と主要 3 語は全列挙のまま。
//
//   ADV  … 連用修飾語になる形 (深く・静かに・必ず・強く…)
//   OBJ  … 目的語になれる名詞句 (敵を・剣を…)
//   VERB … 他動詞の述語になる形 (斬る・貫く…)
//   VADV … 他動詞の連用形 (斬り・突き…) = 複合動詞の前半
//   INTR … 自動詞の連用形 (震えて・光り…) = 目的語を受けない
// ─────────────────────────────────────────────────────────────────────────────
sec('連用修飾・目的語・述語の全順序テンプレート');
{
  const content = Object.keys(WORDS).filter((w) => WORDS[w].cat !== 'connect');
  const ADV = [];
  const OBJ = [];
  const VERB = [];
  const VADV = [];
  const INTR = [];
  const POSS = [];
  const CASE = [];
  for (const w of content) {
    const info = WORDS[w];
    for (const e of info.pool || []) {
      const r = { word: w, k: e.k, text: w + e.k };
      if (e.role !== 'adv') continue;
      if (e.intr) INTR.push(r);
      else if (e.pred || info.cat === 'verb') VADV.push(r);
      else ADV.push(r);
    }
    const of = (info.pool || []).find((e) => e.role === 'case' && e.next === 'verb');
    if (of) OBJ.push({ word: w, k: of.k, text: w + of.k });
    const poss = (info.pool || []).find((e) => e.role === 'case' && e.next === 'noun');
    if (poss) POSS.push({ word: w, k: poss.k, text: w + poss.k });
    const cs = (info.pool || []).find((e) => e.role === 'case' && e.next === 'pred');
    if (cs) CASE.push({ word: w, k: cs.k, text: w + cs.k });
    const vf = (info.pool || []).find((e) => e.role === 'adn' && e.pred && !e.intr);
    if (vf) VERB.push({ word: w, k: vf.k, text: w + vf.k });
  }

  // 語のインスタンスは使い回す。数万回 makeWord すると uid と GC が重い。
  const inst = new Map();
  const mw = (t) => {
    let w = inst.get(t);
    if (!w) { w = makeWord(t); inst.set(t, w); }
    return w;
  };
  const tokens = (...parts) => parts.flatMap(
    (p) => (typeof p === 'string' ? [mw(p)] : [mw(p.word), mw(p.k)]),
  );
  const textOf = (ts) => ts.map((t) => t.text).join('');
  const rep = (arr, names, label) => {
    const out = names.map((n) => arr.find((r) => r.text === n)).filter(Boolean);
    const missing = names.filter((n) => !out.some((r) => r.text === n));
    ok(out.length === names.length, `${label} の代表語が無い: ${missing.join(' ')}`);
    return out;
  };
  const REP_ADV = rep(ADV, ['深く', '静かに', '必ず', '強く', '速く', '妙に', '確かに', '鋭く'], 'ADV');
  const REP_OBJ = rep(OBJ, ['敵を', '剣を', '焔を', '岩を', '毒を', '影を', '魂を', '水を'], 'OBJ');
  const REP_VERB = rep(VERB, ['斬る', '貫く', '刺す', '裂く', '砕く', '焼く', '焦がす', '溶かす', '吸う', '討つ', '屠る', '研ぐ'], 'VERB');
  const REP_VADV = rep(VADV, ['斬り', '突き', '穿ち', '踏み', '打ち', '討ち', '刈り', '貫き'], 'VADV');
  const REP_INTR = rep(INTR, ['燃えて', '凍えて', '舞い', '溶けて', '震えて', '光り'], 'INTR');
  const REP_POSS = rep(POSS, ['敵の', '剣の', '焔の', '岩の', '毒の', '影の', '魂の', '水の'], 'POSS');
  const REP_CASE = rep(CASE, ['敵に', '剣に', '焔に', '岩に'], 'CASE');
  const HEAD = rep(OBJ, ['剣を', '炎を', '毒を', '刃を'], 'HEAD');

  let validCases = 0;
  let invalidCases = 0;
  let skipped = 0;
  let skippedFour = 0;
  let fourPlus = 0;          // 検査した 4 語以上 (実質語で数える)
  let validFour = 0;
  let invalidFour = 0;
  let sectionFail = 0;
  const templates = new Set();
  const vars = { adv: ADV.length, obj: OBJ.length, verb: VERB.length, vadv: VADV.length, intr: INTR.length };

  const run = (ts) => {
    const contentN = ts.filter((t) => !CONNECTOR_SET.has(t.text)).length;
    const isFour = contentN >= 4;
    const text = textOf(ts);
    if (text.length > 10) {
      skipped++;
      if (isFour) skippedFour++;
      return null;
    }
    return { text, isFour, r: evaluate(ts, { minContent: 2 }) };
  };
  const good = (ts, label, partKeys) => {
    const z = run(ts);
    if (!z) return null;
    validCases++;
    if (z.isFour) { fourPlus++; validFour++; }
    if (!z.r.valid) {
      sectionFail++;
      if (sectionFail <= 25) console.log(`  FAIL: ${label}「${z.text}」が不成立: ${z.r.reasonText}`);
      return z.r;
    }
    pass++;
    if (partKeys) {
      for (const k of partKeys) {
        if (z.r.naturalParts.some((p) => p.key === k)) pass++;
        else {
          sectionFail++;
          if (sectionFail <= 25) console.log(`  FAIL: ${label}「${z.text}」に ${k} の加点が無い`);
        }
      }
    }
    return z.r;
  };
  const bad = (ts, label) => {
    const z = run(ts);
    if (!z) return null;
    invalidCases++;
    if (z.isFour) { fourPlus++; invalidFour++; }
    if (z.r.valid) {
      sectionFail++;
      if (sectionFail <= 25) console.log(`  FAIL: ${label}「${z.text}」が成立した`);
    } else pass++;
    return z.r;
  };
  const addTemplate = (name) => { templates.add(name); };

  // ── 1. Adv* + O を + V + 名詞 / O を + Adv* + V + 名詞 ──
  // ADV を全列挙し、O と V を代表語にする。逆に O / V も全列挙する。
  addTemplate('Adv* + Oを + V + 名詞', 0);
  addTemplate('Oを + Adv* + V + 名詞', 0);
  const partValue = (r, key) => (r
    ? r.naturalParts.filter((p) => p.key === key).reduce((s, p) => s + p.v, 0)
    : 0);
  for (const a of ADV) {
    for (const o of OBJ) {
      const after = tokens(a, o, { word: '斬', k: 'る' }, '剣');
      const before = tokens(o, a, { word: '斬', k: 'る' }, '剣');
      const r1 = good(after, 'Adv+Oを+斬る', ['adverbial', 'object']);
      const r2 = good(before, 'Oを+Adv+斬る', ['adverbial', 'object']);
      // 連用修飾と目的語の加点は、語順が入れ替わっても同じ値で乗る。
      // (文頭の属性・形・効果の主題点は語順で変わるのが仕様。ここでは見ない)
      ok(partValue(r1, 'adverbial') === partValue(r2, 'adverbial')
        && partValue(r1, 'object') === partValue(r2, 'object'),
        `「${textOf(after)}」と「${textOf(before)}」で連用・目的語の加点が違う`);
    }
  }
  // ADV は全列挙、目的語と動詞は代表語。逆に VERB は代表 ADV で全列挙する。
  for (const a of ADV) {
    for (const v of REP_VERB) {
      good(tokens(a, REP_OBJ[0], v, '剣'), 'Adv+Oを+V', ['adverbial', 'object']);
      good(tokens(REP_OBJ[0], a, v, '剣'), 'Oを+Adv+V', ['adverbial', 'object']);
    }
  }
  for (const a of REP_ADV) {
    for (const v of VERB) {
      good(tokens(a, REP_OBJ[0], v, '剣'), '代表Adv+Oを+全V', ['adverbial', 'object']);
      good(tokens(REP_OBJ[0], a, v, '剣'), 'Oを+代表Adv+全V', ['adverbial', 'object']);
    }
  }
  for (const o of OBJ) {
    for (const v of REP_VERB) {
      good(tokens(REP_ADV[0], o, v, '剣'), '深く+全Oを+V', ['adverbial', 'object']);
      good(tokens(o, REP_ADV[0], v, '剣'), '全Oを+深く+V', ['adverbial', 'object']);
    }
  }
  console.log(`  ADV ${vars.adv} 形 / OBJ ${vars.obj} 語 / VERB ${vars.verb} 形`
    + ` / ここまで 成立 ${validCases} / 飛ばした(>10字) ${skipped}`);

  // ── 2. 連用形を含む複合動詞 (斬り裂く) ──
  // VADV を全列挙し、O と V を代表語にする。O / V 側も全列挙する。
  addTemplate('Oを + VADV + V + 名詞', 0);
  addTemplate('VADV + Oを + V + 名詞', 0);
  for (const r of VADV) {
    for (const o of REP_OBJ) {
      for (const v of REP_VERB.slice(0, 4)) {
        good(tokens(o, r, v, '剣'), 'Oを+VADV+V', ['adverbial', 'object']);
        good(tokens(r, o, v, '剣'), 'VADV+Oを+V', ['adverbial', 'object']);
      }
    }
  }
  for (const r of REP_VADV) {
    for (const o of OBJ) {
      good(tokens(o, r, { word: '裂', k: 'く' }, '剣'), 'Oを+代表VADV+裂く', ['adverbial', 'object']);
      good(tokens(r, o, { word: '裂', k: 'く' }, '剣'), '代表VADV+Oを+裂く', ['adverbial', 'object']);
    }
  }
  for (const r of REP_VADV) {
    for (const v of VERB) {
      good(tokens(REP_OBJ[0], r, v, '剣'), 'Oを+代表VADV+全V', ['adverbial', 'object']);
      good(tokens(r, REP_OBJ[0], v, '剣'), '代表VADV+Oを+全V', ['adverbial', 'object']);
    }
  }
  console.log(`  VADV ${vars.vadv} 形 / ここまで 成立 ${validCases}`);

  // ── 3. 連用修飾が 2 つ・3 つ重なる全順序 ──
  addTemplate('Adv1 Adv2 + Oを + V + 名詞', 0);
  addTemplate('Oを + Adv1 Adv2 + V + 名詞', 0);
  addTemplate('Adv1 Adv2 Adv3 + Oを + V + 名詞', 0);
  addTemplate('Oを + Adv1 Adv2 Adv3 + V + 名詞', 0);
  const A2 = REP_ADV.slice(0, 4);
  const O2 = REP_OBJ.slice(0, 4);
  const V2 = REP_VERB.slice(0, 6);
  for (const a1 of A2) {
    for (const a2 of A2) {
      for (const o of O2) {
        for (const v of V2) {
          good(tokens(a1, a2, o, v, '剣'), 'Adv1 Adv2 + Oを + V', ['adverbial', 'object']);
          good(tokens(o, a1, a2, v, '剣'), 'Oを + Adv1 Adv2 + V', ['adverbial', 'object']);
            }
      }
    }
  }
  const A3 = REP_ADV.slice(0, 3);
  const O3 = REP_OBJ.slice(0, 3);
  const V3 = REP_VERB.slice(0, 4);
  for (const a1 of A3) {
    for (const a2 of A3) {
      for (const a3 of A3) {
        for (const o of O3) {
          for (const v of V3) {
            good(tokens(a1, a2, a3, o, v, '剣'), 'Adv1 Adv2 Adv3 + Oを + V', ['adverbial', 'object']);
            good(tokens(o, a1, a2, a3, v, '剣'), 'Oを + Adv1 Adv2 Adv3 + V', ['adverbial', 'object']);
                }
        }
      }
    }
  }

  // ── 4. Adv* + O の + 名詞 + を + V + 名詞 ──
  addTemplate('Adv* + Oの + 名詞を + V + 名詞', 0);
  addTemplate('Oの + 名詞を + Adv* + V + 名詞', 0);
  for (const a of A2) {
    for (const p of REP_POSS.slice(0, 6)) {
      for (const h of HEAD) {
        for (const v of V2) {
          good(tokens(a, p, h, v, '剣'), 'Adv + Oの + 名詞を + V', ['adverbial', 'object', 'genitive']);
          good(tokens(p, h, a, v, '剣'), 'Oの + 名詞を + Adv + V', ['adverbial', 'object', 'genitive']);
            }
      }
    }
  }

  // ── 5. Adv* + O に + V + 名詞 (に/への連用修飾) ──
  addTemplate('Adv* + Oに + V + 名詞', 0);
  addTemplate('Oに + Adv* + V + 名詞', 0);
  for (const a of REP_ADV) {
    for (const c of CASE) {
      good(tokens(a, c, { word: '刺', k: 'す' }, '剣'), 'Adv + Oに + 刺す', ['adverbial']);
      good(tokens(c, a, { word: '刺', k: 'す' }, '剣'), 'Oに + Adv + 刺す', ['adverbial']);
    }
  }
  for (const a of ADV) {
    for (const c of REP_CASE) {
      good(tokens(a, c, { word: '刺', k: 'す' }, '剣'), '全Adv + Oに + 刺す', ['adverbial']);
      good(tokens(c, a, { word: '刺', k: 'す' }, '剣'), 'Oに + 全Adv + 刺す', ['adverbial']);
    }
  }

  // ── 6. 連用形 + 複合動詞の全順序 (Adv / VADV / O の 6 通り) ──
  addTemplate('Adv + VADV + Oを + V (6 順序)', 0);
  const parts3 = (a, r, o) => [a, r, o];
  const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  for (const a of REP_ADV.slice(0, 4)) {
    for (const r of REP_VADV.slice(0, 4)) {
      for (const o of REP_OBJ.slice(0, 4)) {
        for (const v of REP_VERB.slice(0, 4)) {
          if (r.word === v.word) continue;
          for (const p of perms) {
            const ps = parts3(a, r, o);
            good(tokens(ps[p[0]], ps[p[1]], ps[p[2]], v, '剣'), 'Adv/VADV/O の全順序', ['adverbial', 'object']);
          }
        }
      }
    }
  }

  // ── 7. 不成立のままにする形 ──
  // 連用形の後に名詞だけ (述語が無い)。
  for (const a of ADV) {
    bad(tokens(a, '剣'), '連用形 + 名詞');
    for (const o of REP_OBJ.slice(0, 4)) {
      bad(tokens(a, o, '剣'), '連用形 + 目的語 + 名詞');
    }
  }
  // 目的語の後に述語が無い。
  for (const o of OBJ) {
    bad(tokens(o, '剣'), '目的語 + 名詞');
  }
  // 連用形 + の名詞句 + 名詞 (述語なし)。
  for (const a of ADV) {
    for (const p of REP_POSS.slice(0, 4)) {
      bad(tokens(a, p, '剣'), '連用形 + の名詞句 + 名詞');
    }
  }
  // に/へ の後に述語が無い。
  for (const c of CASE) {
    for (const a of REP_ADV.slice(0, 4)) {
      bad(tokens(c, a, '剣'), 'に + 連用形 + 名詞');
    }
  }
  // 自動詞の連用形は目的語を受けない。
  for (const n of INTR) {
    for (const o of REP_OBJ) {
      bad(tokens(o, n, { word: '斬', k: 'る' }, '剣'), '目的語 + 自動詞の連用形');
    }
  }
  // 他動詞の連用形だけで文を閉じない (後ろに述語が必要)。
  for (const r of VADV) {
    bad(tokens(r, '剣'), '連用形だけで閉じる');
    for (const o of REP_OBJ) {
      bad(tokens(o, r, '剣'), '目的語 + 連用形で閉じる');
    }
  }
  // 自動詞 + を (連用修飾を挟んでも同じ)。
  for (const o of REP_OBJ) {
    for (const n of REP_INTR) {
      bad(tokens(o, n, '剣'), '目的語 + 自動詞の連用形 + 名詞');
    }
    for (const a of REP_ADV) {
      bad(tokens(o, a, { word: '燃', k: 'える' }, '剣'), '目的語 + 連用形 + 自動詞');
    }
  }

  ok(sectionFail === 0, `順序テンプレートで ${sectionFail} 件の不成立/成立の誤り`);
  console.log(`  全テンプレート 検査 ${validCases + invalidCases}`
    + ` (成立 ${validCases} / 不成立 ${invalidCases}) / テンプレート ${templates.size} 種`
    + ` / 4 語以上 生成 ${fourPlus + skippedFour} (検査 ${fourPlus} / >10字 ${skippedFour})`);
  // 代表語が全クラスを覆っていること (数字の取りこぼし防止)。
  console.log(`  役割クラス: ADV ${vars.adv} 形 / OBJ ${vars.obj} 語 / VERB ${vars.verb} 形`
    + ` / VADV ${vars.vadv} 形 / INTR ${vars.intr} 形 / POSS ${POSS.length} / CASE ${CASE.length}`);

  // ── 8. 自然さの順序と topic の監査 ──
  sec('自然さの加点が語順に依らないこと');
  const E = (...ws) => evaluate(ws.map((t) => ({ text: t })), { minContent: 2 });
  const base = E('敵', 'を', '斬', 'る', '剣');
  const deepAfter = E('敵', 'を', '深', 'く', '斬', 'る', '剣');
  const deepBefore = E('深', 'く', '敵', 'を', '斬', 'る', '剣');
  ok(deepAfter.valid && deepBefore.valid, '深く + 敵を + 斬る が両方成立しない');
  ok(deepAfter.natural >= base.natural,
    `「敵を深く斬る剣」の自然さが「敵を斬る剣」より低い: ${deepAfter.natural} < ${base.natural}`);
  ok(Math.abs(deepAfter.natural - deepBefore.natural) < 1e-9,
    `「敵を深く斬る剣」と「深く敵を斬る剣」の自然さが逆転: ${deepAfter.natural} / ${deepBefore.natural}`);
  ok(deepAfter.naturalParts.some((p) => p.key === 'adverbial')
    && deepAfter.naturalParts.some((p) => p.key === 'object'),
    '「敵を深く斬る剣」に連用修飾・目的語の加点が無い');
  ok(deepBefore.naturalParts.some((p) => p.key === 'adverbial')
    && deepBefore.naturalParts.some((p) => p.key === 'object'),
    '「深く敵を斬る剣」に連用修飾・目的語の加点が無い');

  // 分類が効果語でも、格で名詞句として使われている文頭は減点しない。
  // 敵 だけでなく、プールが名詞だけの効果語すべてを監査する。
  const nounOnly = content.filter((w) => {
    const pool = WORDS[w].pool || [];
    return pool.length === 4
      && pool.every((e, i) => ['の', 'を', 'に', 'へ'][i] === e.k)
      && pool.every((e, i) => e.role === 'case'
        && e.next === ['noun', 'verb', 'pred', 'pred'][i]);
  });
  const modifierNouns = nounOnly.filter((w) => WORDS[w].cat === 'modifier');
  let topicBad = 0;
  for (const w of modifierNouns) {
    const r = E(w, 'を', '斬', 'る', '剣');
    if (!r.valid || r.naturalParts.some((p) => p.key === 'topicmod')) {
      topicBad++;
      if (topicBad <= 8) console.log(`  FAIL: 名詞用法の「${w}を」に効果語の減点: ${r.reasonText || ''}`);
    }
  }
  ok(topicBad === 0, `名詞用法の効果語に topicmod の減点が ${topicBad} 件`);
  console.log(`  名詞だけのプール ${nounOnly.length} 語`
    + ` (効果語 ${modifierNouns.length} 語: ${modifierNouns.join(' ')})`);

  // 不自然な文が自然な文より強くならないこと (代表的な比較)。
  const pairs = [
    [deepAfter, E('敵', 'を', '斬', 'る', '剣')],
    [E('敵', 'を', '深', 'く', '静', 'かに', '斬', 'る', '剣'), E('敵', 'を', '深', 'く', '斬', 'る', '剣')],
    [E('敵', 'を', '深', 'く', '斬', 'り', '裂', 'く', '剣'), E('敵', 'を', '深', 'く', '斬', 'る', '剣')],
  ];
  for (const [strong, weak] of pairs) {
    ok(strong.valid && weak.valid, `比較用の文が不成立: ${strong.text} / ${weak.text}`);
    ok(strong.fx.power >= weak.fx.power,
      `自然な文が弱い: ${strong.text} ${strong.fx.power} < ${weak.text} ${weak.fx.power}`);
  }

  console.log(`\n  === 文法監査の件数 ===`);
  console.log(`  自然文コーパス ${NATURAL.length} 件 / 不自然文コーパス ${UNNATURAL.length} 件`);
  console.log(`  2 語パターン ${twoWordPatterns} / 3 語標本 ${threeWordPatterns}`
    + ` / 4 語以上テンプレート 生成 ${fourPlus + skippedFour} 件`
    + ` (検査 ${fourPlus} / >10字 ${skippedFour})`);
  console.log(`  4 語以上の内訳: 成立 ${validFour} / 不成立 ${invalidFour}`
    + ` / 順序テンプレート ${templates.size} 種`);
  console.log(`  全テンプレート検査 ${validCases + invalidCases}`
    + ` (成立 ${validCases} / 不成立 ${invalidCases} / >10字 ${skipped})`);
}

console.log(`\n---- 合格 ${pass} / 不合格 ${fail} ----`);
process.exit(fail ? 1 : 0);
