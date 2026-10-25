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
}

console.log(`\n---- 合格 ${pass} / 不合格 ${fail} ----`);
process.exit(fail ? 1 : 0);
