// 言葉の意味が、そのまま武器の性質になるか。   node test/meaning.test.js
//
// 「意味」は語の登録 (words.core.js) にある属性 (el) と効果 (fx) を指す。
// ここで見るのは、文にその語を置いたとき
//
//   動詞   … その語の意味する攻撃の型 (斬る→斬撃 / 貫く→貫通 / 爆ぜる→爆発) になるか
//   属性語 … 文の属性が語の属性になり、その属性の状態 (炎上・凍結・感電・毒) が付くか
//   効果語 … 効果が 1 つ以上、武器の性能に足されるか
//   武器語 … 形と攻撃の型が語の意味どおりか (基本武器は素振りで撃てるかも見る)
//
// を、実際に文を組んで resolve() した結果で確かめる。語を足したのに
// 何も変わらないなら、その語の意味は武器に届いていない (バグ)。
//
// 乱数は最初に固定する。必ず先頭に置くこと。
import './seed.mjs';
import { Run } from '../js/game/run.js';
import { makeWord, WORDS, ELEMENTS, WEAPON_WORDS } from '../js/data/words.js';
import { WeaponInst } from '../js/game/weapon.js';
import { VERB_SHAPE, FORM_SHAPE, defForForm, ELEMENT_KIND, ELEMENT_SHAPE } from '../js/data/weapons.js';
import { connectorsAfter, formAfter } from '../js/data/words.connect.js';
import { makeRng } from '../js/core/util.js';
import { PHRASE_BONUS } from '../js/data/words.phrase.js';
import { makeEnemy } from '../js/game/entities.js';
import { fireWeapon } from '../js/game/combat.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const sec = (t) => console.log(`\n== ${t} ==`);
const audio = new Proxy({}, { get: () => () => {} });
const run = new Run({
  stageId: 1, audio, save: { d: {} }, weaponIds: ['sword'], lexiconSize: 12,
  rng: makeRng(31337),
});
const ps = run.player.stats;

/**
 * 文を組んで解決する。接続詞は直前の語に付く (push では入らない)。
 * @param {Array<[string, string?]>} spec
 */
function resolve(spec) {
  const w = new WeaponInst('sword', 1);
  for (const [text, conn] of spec) {
    w.sentence.push(makeWord(text));
    if (conn) w.sentence.setConnAt(w.sentence.count - 1, conn);
  }
  return w.resolve(ps);
}

/** その語が述語 (動詞の形) になれる送り仮名を 1 つ返す。 */
function predicateOf(text) {
  for (const k of connectorsAfter([text])) {
    const f = formAfter([text], k);
    if (f && f.form.pred) return k;
  }
  return null;
}

const fxKeys = (r) => Object.keys(r.evalResult?.fx || {}).filter((k) => k !== 'power');
const bare = resolve([['刃']]);

// ─────────────────────────────────────────────────────────────────────────────
sec('動詞の意味が攻撃の型になる');
{
  const verbs = Object.keys(WORDS).filter((t) => WORDS[t].cat === 'verb');
  const noPred = [];
  const mismatched = [];
  const inert = [];
  for (const t of verbs) {
    const k = predicateOf(t);
    if (!k) { noPred.push(t); continue; }
    const r = resolve([[t, k], ['刃']]);
    ok(r.active, `「${t}${k}刃」が武器にならない (${r.reason})`);
    const expected = VERB_SHAPE[t];
    if (expected) {
      if (r.kind !== expected) mismatched.push(`${t}${k}: ${r.kind} (意味は ${expected})`);
    } else if (!fxKeys(r).length && r.kind === bare.kind) {
      inert.push(`${t}${k}`);
    }
  }
  // 述語になれる形が 1 つも無い動詞は、文の述語として使えない。
  ok(!noPred.length, `述語の形が無い動詞: ${noPred.join(' ')}`);
  // VERB_SHAPE にある語は、その型になっているはず。
  ok(!mismatched.length, `意味と型が違う動詞: ${mismatched.join(' / ')}`);
  // 型を持たない動詞でも、効果 (fx) で意味を表しているはず。
  ok(!inert.length, `型も効果も変えない動詞: ${inert.join(' ')}`);
  console.log(`  動詞 ${verbs.length} 語 / 型が食い違う ${mismatched.length}`
    + ` / 型も効果も無い ${inert.length} / 述語になれない ${noPred.length}`);
}

// ─────────────────────────────────────────────────────────────────────────────
sec('属性語の意味が文の属性と状態になる');
{
  const elements = Object.keys(WORDS).filter((t) => WORDS[t].cat === 'element' || WORDS[t].cat === 'phenom');
  const wrongEl = [];
  const noStatus = [];
  for (const t of elements) {
    const el = WORDS[t].el;
    // 現象語 (渦・乱) は属性を持たない。状態異常も無いので対象外。
    if (!el) continue;
    const r = resolve([[t, 'の'], ['刃']]);
    if (r.element !== el) wrongEl.push(`${t}: ${r.element} (意味は ${el})`);
    const status = ELEMENTS[el]?.status;
    if (status && status !== 'none' && !(r.stats[status] > 0)) {
      noStatus.push(`${t}: ${status} が付かない (${el})`);
    }
  }
  ok(!wrongEl.length, `属性が違う語: ${wrongEl.join(' / ')}`);
  ok(!noStatus.length, `状態異常が付かない語: ${noStatus.join(' / ')}`);
  console.log(`  属性語 ${elements.length} 語 (現象語を除く) / 属性違い ${wrongEl.length} / 状態なし ${noStatus.length}`);
}

// ─────────────────────────────────────────────────────────────────────────────
sec('効果語の意味が性能に乗る');
{
  const mods = Object.keys(WORDS).filter((t) => WORDS[t].cat === 'modifier');
  const inert = [];
  for (const t of mods) {
    // 連体「な」で受けられる語だけを見る。受けられない語は別の並びで確かめる。
    const w = new WeaponInst('sword', 1);
    w.sentence.push(makeWord(t));
    if (!w.sentence.setConnAt(0, 'な').ok) continue;
    w.sentence.push(makeWord('刃'));
    const r = w.resolve(ps);
    if (!r.valid) continue;
    if (!fxKeys(r).length) inert.push(t);
  }
  ok(!inert.length, `武器に何も足さない効果語: ${inert.join(' ')}`);
  console.log(`  効果語 ${mods.length} 語 / 効果なし ${inert.length}`);
}

// ─────────────────────────────────────────────────────────────────────────────
sec('武器語の意味が形と攻撃の型になる');
{
  const bad = [];
  const badKind = [];
  for (const t of WEAPON_WORDS) {
    // 武器語はそれ単体が武器名になる。素振り (末尾語 1 つ) で撃てること。
    const def = defForForm(t);
    const w = new WeaponInst(def.id, 1);
    w.sentence.push(makeWord(def.tail));
    const r = w.resolve(ps);
    ok(r.active, `「${t}」が単体で武器にならない (${r.reason})`);
    const want = FORM_SHAPE[t];
    if (!want) { bad.push(t); continue; }
    if (r.shape !== want[0]) bad.push(`${t}: 形 ${r.shape} (意味は ${want[0]})`);
    if (r.kind !== want[1]) badKind.push(`${t}: 型 ${r.kind} (意味は ${want[1]})`);
  }
  ok(!bad.length, `形が違う武器語: ${bad.join(' / ')}`);
  ok(!badKind.length, `型が違う武器語: ${badKind.join(' / ')}`);
  console.log(`  武器語 ${WEAPON_WORDS.length} 語 / 形違い ${bad.length} / 型違い ${badKind.length}`);
}

// ─────────────────────────────────────────────────────────────────────────────
sec('意味が武器の数字に出る (足すと上がる)');
{
  // 効果の向き。数値が増えるほど「意味どおり強くなる」キーだけを見る。
  const UP = ['dmg', 'rate', 'crit', 'critDmg', 'pierce', 'count', 'speed', 'size',
    'area', 'knock', 'lifesteal', 'regen', 'burn', 'chill', 'shock', 'poison',
    'freeze', 'explode', 'chain', 'homing', 'bounce', 'split', 'spread', 'arc',
    'duration', 'armor', 'magnet'];
  const mods = Object.keys(WORDS).filter((t) => WORDS[t].cat === 'modifier');
  for (const t of mods) {
    const w = new WeaponInst('sword', 1);
    w.sentence.push(makeWord(t));
    if (!w.sentence.setConnAt(0, 'な').ok) continue;
    w.sentence.push(makeWord('刃'));
    const r = w.resolve(ps);
    if (!r.valid) continue;
    const keys = fxKeys(r).filter((k) => UP.includes(k));
    const grew = keys.some((k) => (r.stats[k] || 0) > (bare.stats[k] || 0));
    ok(grew, `「${t}」の効果が数字に出ない (${keys.join(',') || 'キーなし'})`);
  }
  console.log(`  ${mods.length} 語を確認`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 語彙監査 (Ver.1.73)。「言葉の意味が武器の効果になっていない」ズレの回帰防止。
//   観点 1: 矛盾 (意味と逆方向の効果)
//   観点 2: 看板効果の欠落 (その語なら当然あるべき効果が無い)
//   観点 3: 属性の付け間違い
//   観点 4: 意味の未表現 (意味の強い語が dmg だけで終わっている)
// chill は冷気そのものではなく「敵を遅くする」効果キーとして使う
// (静・減・衰など既存の語も減速の意味で使っている)。束縛・捕縛の語が
// 敵を遅くするのもこのキーで表す。slowImmune は「自分が遅くならない」
// プレイヤー側の効果で、語の意味として持つ語は無い (部品・パッシブの領分)。
// ─────────────────────────────────────────────────────────────────────────────
sec('監査: 矛盾ペアの禁止 (観点1)');
{
  const BURN_OK = new Set(['沸', '燃', '焼', '焦', '蒸', '擦', '煉', '干', '日']);
  const POISON_OK = new Set(['呪', '穢', '爛', '侵', '溶', '吐', '浸', '錆', '祟', '濁', '屍', '蛇', '憂', '罪', '苦', '邪', '枯', '犯']);
  const HEAVY = ['鉄', '鋼', '岩', '石', '土', '地', '陸', '原', '崖', '鉱'];
  const bad = [];
  for (const [t, w] of Object.entries(WORDS)) {
    if (w.cat === 'connect') continue;
    const fx = w.fx || {};
    if ((fx.slowImmune || 0) > 0) bad.push(`${t}: slowImmune (自分の減速無効は語の意味に無い)`);
    if ((fx.burn || 0) > 0 && w.el !== 'fire' && w.el !== 'blood' && !BURN_OK.has(t)) {
      bad.push(`${t}: burn が火・血の属性でも熱・摩擦の語でもない`);
    }
    if ((fx.poison || 0) > 0 && w.el !== 'poison' && w.el !== 'nature' && !POISON_OK.has(t)) {
      bad.push(`${t}: poison が毒・自然の属性でも腐食・呪いの語でもない`);
    }
  }
  for (const t of HEAVY) {
    const fx = WORDS[t]?.fx || {};
    if ((fx.speed || 0) > 0) bad.push(`${t}: 重い素材なのに speed が正`);
  }
  ok(!bad.length, `矛盾ペア: ${bad.join(' / ')}`);
  console.log(`  全 ${Object.keys(WORDS).length} 語を走査 / 矛盾 ${bad.length}`);
}

sec('監査: 看板効果の必須 (観点2)');
{
  const bad = [];
  // 束縛・捕縛の語は敵を遅くする (chill) を必ず持つ。
  for (const t of ['縛', '捕', '封', '拘', '網', '嚇']) {
    if (!((WORDS[t]?.fx?.chill || 0) > 0)) bad.push(`${t}: 束縛の語なのに chill が無い`);
  }
  const SIGN = {
    '吸': (fx) => (fx.lifesteal || 0) > 0 && (fx.magnet || 0) > 0,
    '癒': (fx) => (fx.regen || 0) > 0,
    '聖': (fx) => (fx.regen || 0) > 0,
    '毒': (fx) => (fx.poison || 0) > 0,
    '磁': (fx) => (fx.magnet || 0) > 0,
    '引': (fx) => (fx.magnet || 0) > 0,
    '導': (fx) => (fx.homing || 0) > 0,
    '追': (fx) => (fx.homing || 0) > 0,
    '貫': (fx) => (fx.pierce || 0) > 0,
    '穿': (fx) => (fx.pierce || 0) > 0,
  };
  for (const [t, need] of Object.entries(SIGN)) {
    if (!need(WORDS[t]?.fx || {})) bad.push(`${t}: 看板効果が無い`);
  }
  ok(!bad.length, `看板効果の欠落: ${bad.join(' / ')}`);
  console.log(`  束縛 6 語 + 看板 ${Object.keys(SIGN).length} 語を確認 / 欠落 ${bad.length}`);
}

sec('監査: 1.73 で直した語の効果 (観点1〜4)');
{
  // has: そのキーを持ち値が下限以上 / lacks: そのキーを持たない /
  // neg: そのキーが負 / el: 属性。
  const FIXED = {
    '創': { el: 'blood', has: { lifesteal: 0.025, crit: 0.04 }, lacks: ['burn'] },
    '霧': { el: 'water', has: { chill: 0.15 }, lacks: ['poison'] },
    '峰': { el: 'earth' }, '嶺': { el: 'earth' },
    '聖': { has: { regen: 0.5 } },
    '輝': { has: { crit: 0.03 }, lacks: ['burn'] },
    '赤': { has: { lifesteal: 0.015 }, lacks: ['burn'] },
    '鉄': { has: { armor: 1 }, neg: ['speed'] },
    '鉱': { has: { size: 0.1 }, lacks: ['speed'] },
    '苔': { has: { regen: 0.3 }, lacks: ['chill'] },
    '香': { has: { regen: 0.8 }, lacks: ['poison'] },
    '網': { has: { chill: 0.15 }, lacks: ['slowImmune'] },
    '端': { has: { pierce: 1 }, lacks: ['armor'] },
    '昂': { has: { rate: 0.25 } },
    '霓': { has: { chain: 1 }, lacks: ['pierce'] },
    '汰': { has: { area: 6 }, lacks: ['speed'] },
    '侵': { has: { poison: 2 }, lacks: ['burn'] },
    '焦': { has: { area: 4 }, lacks: ['poison'] },
    '溶': { has: { poison: 2 }, lacks: ['chill'] },
    '融': { has: { regen: 0.5, area: 6 }, lacks: ['chill'] },
    '吐': { has: { poison: 2, knock: 30 }, lacks: ['explode'] },
    '掴': { has: { magnet: 0.45, chill: 0.1 }, lacks: ['size', 'speed'] },
    '嚇': { has: { knock: 40 }, lacks: ['slowImmune'] },
    '縛': { has: { chill: 0.3 }, lacks: ['slowImmune', 'magnet'] },
    '浴': { has: { duration: 0.6 }, lacks: ['burn'] },
    '封': { has: { chill: 0.18 }, lacks: ['slowImmune'] },
    '捕': { has: { chill: 0.2 }, lacks: ['slowImmune'] },
    '拘': { has: { chill: 0.2 } },
    '傷': { has: { lifesteal: 0.02 } },
    '痛': { has: { crit: 0.07 } },
    '怒': { has: { rate: 0.3, knock: 20 } },
    '憤': { has: { rate: 0.25, knock: 30 } },
    '罪': { has: { poison: 1.5 } },
    '逆': { has: { bounce: 1 } },
    '独': { has: { atkMul: 0.04 } },
    '厨': { has: { regen: 1 } },
    '宗': { has: { regen: 0.4 } },
    '底': { has: { armor: 2 } },
    '元': { has: { regen: 0.4 } },
    '賊': { has: { magnet: 0.25 } },
    '倣': { has: { homing: 0.25 } },
    '獣': { has: { crit: 0.04 } },
    '失': { has: { chill: 0.12 } },
    '尽': { has: { rate: 0.2 } },
    '干': { has: { burn: 1.5 } },
    '残': { has: { duration: 0.6 } },
    '消': { has: { pierce: 1 } },
    '犯': { has: { poison: 1.5 } },
    '造': { has: { count: 1 } },
    '閉': { has: { shield: 10 } },
    '闢': { has: { area: 8 } },
    '縄': { has: { chill: 0.15 } },
    '綱': { has: { magnet: 0.3 }, lacks: ['knock'] },
    '凪': { has: { chill: 0.12, regen: 0.3 }, lacks: ['speed'] },
    '秋': { has: { chill: 0.06 }, lacks: ['poison'] },
  };
  const bad = [];
  for (const [t, exp] of Object.entries(FIXED)) {
    const w = WORDS[t];
    if (!w) { bad.push(`${t}: 語が無い`); continue; }
    const fx = w.fx || {};
    if (exp.el && w.el !== exp.el) bad.push(`${t}: 属性 ${w.el} (期待 ${exp.el})`);
    for (const [k, min] of Object.entries(exp.has || {})) {
      if (!((fx[k] || 0) >= min - 1e-9)) bad.push(`${t}: ${k} が ${fx[k] ?? 0} (期待 ${min} 以上)`);
    }
    for (const k of exp.lacks || []) if (fx[k] !== undefined && fx[k] !== 0) bad.push(`${t}: ${k} が残っている`);
    for (const k of exp.neg || []) if (!((fx[k] || 0) < 0)) bad.push(`${t}: ${k} が負でない`);
  }
  ok(!bad.length, `修正語の効果: ${bad.join(' / ')}`);
  console.log(`  ${Object.keys(FIXED).length} 語を確認 / 不一致 ${bad.length}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 文レベル検証 (1.73 で追加)。語単体の fx ではなく、その語を含む成立文を
// evaluate → WeaponInst.resolve まで通し、最終ステータスに効果が届くかを見る。
// ─────────────────────────────────────────────────────────────────────────────
/** その語を含む代表文 (末尾は刃) を組んで resolve する。 */
function sentenceWith(t) {
  const wd = WORDS[t];
  const build = (conn) => {
    const w = new WeaponInst('sword', 1);
    w.sentence.push(makeWord(t));
    if (conn) w.sentence.setConnAt(0, conn);
    w.sentence.push(makeWord('刃'));
    return w;
  };
  if (wd.cat === 'verb') {
    const p = predicateOf(t);
    const w = p && build(p);
    return w ? w.resolve(ps) : null;
  }
  if (wd.cat === 'modifier') {
    for (const k of connectorsAfter([t])) {
      const w = build(k);
      if (!w) continue;
      const r = w.resolve(ps);
      if (r.valid) return r;
    }
    return null;
  }
  const w = build('no');
  return w ? w.resolve(ps) : null;
}

sec('文レベル: 直した語の効果が最終ステータスに届く');
{
  // up: 素の刃より上がる / absent: 素の刃と同じ (= 付かない) / el: 文の主属性。
  const SENT = {
    '創': { up: ['crit', 'lifesteal'], absent: ['burn'], el: 'blood' },
    '霧': { up: ['chill', 'area'], absent: ['poison'], el: 'water' },
    '峰': { up: ['pierce'], el: 'earth' },
    '嶺': { up: ['range'], el: 'earth' },
    '聖': { up: ['regen', 'pierce'], el: 'light' },
    '輝': { up: ['crit'], absent: ['burn'], el: 'light' },
    '赤': { up: ['lifesteal'], absent: ['burn'], el: 'blood' },
    '鉄': { up: ['armor', 'size'], el: 'steel' },
    '鉱': { up: ['size', 'pierce'], el: 'steel' },
    '苔': { up: ['regen', 'poison'], el: 'nature' },
    '香': { up: ['regen', 'area'], absent: ['poison'] },
    '網': { up: ['chill', 'area'], absent: ['slowImmune'] },
    '端': { up: ['pierce'], absent: ['armor'] },
    '昂': { up: ['rate'] },
    '霓': { up: ['chain'], el: 'light' },
    '汰': { up: ['area', 'chill'], el: 'water' },
    '侵': { up: ['poison'], absent: ['burn'] },
    '焦': { up: ['area', 'burn'], absent: ['poison'] },
    '溶': { up: ['poison'], absent: ['chill'] },
    '融': { up: ['area', 'regen'], absent: ['chill'] },
    '吐': { up: ['poison', 'knock', 'area'], absent: ['explode'] },
    '掴': { up: ['magnet', 'chill'] },
    '嚇': { up: ['knock', 'chill'], absent: ['slowImmune'] },
    '縛': { up: ['chill'], absent: ['slowImmune'] },
    '浴': { up: ['area', 'duration'], absent: ['burn'] },
    '封': { up: ['chill'], absent: ['slowImmune'] },
    '捕': { up: ['chill'], absent: ['slowImmune'] },
    '拘': { up: ['chill'] },
    '傷': { up: ['lifesteal'] },
    '痛': { up: ['crit'] },
    '怒': { up: ['rate', 'knock'] },
    '憤': { up: ['rate', 'knock'] },
    '罪': { up: ['poison'] },
    '逆': { up: ['bounce'] },
    '独': { up: ['dmg'] },
    '厨': { up: ['regen'] },
    '宗': { up: ['regen'] },
    '底': { up: ['armor'] },
    '元': { up: ['regen'] },
    '賊': { up: ['magnet'] },
    '倣': { up: ['homing'] },
    '獣': { up: ['crit'] },
    '失': { up: ['chill'] },
    '尽': { up: ['rate'] },
    '干': { up: ['burn'] },
    '残': { up: ['duration'] },
    '消': { up: ['pierce'] },
    '犯': { up: ['poison'] },
    '造': { up: ['count'] },
    '閉': { up: ['shield'] },
    '闢': { up: ['area'] },
    '縄': { up: ['chill', 'area'] },
    '綱': { up: ['magnet'], absent: ['knock'] },
    '凪': { up: ['chill', 'regen', 'armor'] },
    '秋': { up: ['chill', 'regen'], absent: ['poison'] },
  };
  let cases = 0;
  const bad = [];
  for (const [t, exp] of Object.entries(SENT)) {
    const r = sentenceWith(t);
    if (!r || !r.valid) { bad.push(`${t}: 文が成立しない`); continue; }
    cases++;
    for (const k of exp.up || []) {
      if (!((r.stats[k] || 0) > (bare.stats[k] || 0))) bad.push(`${t}: ${k} が最終ステータスに届かない (${r.stats[k] ?? 0} <= ${bare.stats[k] ?? 0})`);
    }
    for (const k of exp.absent || []) {
      if ((r.stats[k] || 0) !== (bare.stats[k] || 0)) bad.push(`${t}: 消したはずの ${k} が文に残る`);
    }
    if (exp.el && r.element !== exp.el) bad.push(`${t}: 文の主属性 ${r.element} (期待 ${exp.el})`);
  }
  ok(!bad.length, `文レベルの効果: ${bad.join(' / ')}`);
  console.log(`  ${cases} 文を確認 / 不一致 ${bad.length}`);
}

sec('文レベル: 属性変更が主属性・副属性に出る');
{
  const bad = [];
  const r1 = resolve([['炎', 'no'], ['霧', 'no'], ['刃']]);
  if (!(r1.element === 'fire' && r1.subElement === 'water')) bad.push(`炎+霧: ${r1.element}/${r1.subElement} (期待 fire/water)`);
  const r2 = resolve([['霧', 'no'], ['炎', 'no'], ['刃']]);
  if (!(r2.element === 'water' && r2.subElement === 'fire')) bad.push(`霧+炎: ${r2.element}/${r2.subElement} (期待 water/fire)`);
  const r3 = resolve([['創', 'no'], ['刃']]);
  if (r3.element !== 'blood') bad.push(`創: ${r3.element} (期待 blood)`);
  const r4 = resolve([['峰', 'no'], ['刃']]);
  if (r4.element !== 'earth') bad.push(`峰: ${r4.element} (期待 earth)`);
  ok(!bad.length, `属性の文レベル確認: ${bad.join(' / ')}`);
  console.log(`  4 文を確認 / 不一致 ${bad.length}`);
}

sec('文レベル: 状態異常が sim で敵に付く');
{
  // 状態異常は文の属性で決まる (combat.js)。動詞の状態は対応する属性語と
  // 組にした文で撃ち、敵に実際に付くところまで見る。
  const hit = (spec) => {
    const r2 = new Run({ stageId: 1, audio, save: { d: {} }, weaponIds: ['sword'], lexiconSize: 12, rng: makeRng(777) });
    const wi = r2.weapons[0];
    for (const [text, conn] of spec) {
      wi.sentence.push(makeWord(text));
      if (conn) wi.sentence.setConnAt(wi.sentence.count - 1, conn);
    }
    const res = wi.resolve(r2.player.stats);
    const e = makeEnemy('bat', r2.player.x + 55, r2.player.y);
    e.hp = 1e9; e.maxHp = 1e9;
    r2.enemies.push(e);
    fireWeapon(r2, wi, res);
    for (let i = 0; i < 30; i++) r2.bulletTick(1 / 60);
    return { res, e };
  };
  const bad = [];
  const mist = hit([['霧', 'no'], ['刃']]);
  if (!(mist.e.chill > 0)) bad.push('霧の刃で chill が付かない');
  const waterOnly = hit([['水', 'no'], ['刃']]);
  const bind = hit([['水', 'no'], ['縛', predicateOf('縛')], ['刃']]);
  if (!(bind.e.chill > (waterOnly.e.chill || 0) + 0.2)) bad.push(`縛の chill が敵に届かない (縛 ${bind.e.chill} / 水のみ ${waterOnly.e.chill})`);
  const melt = hit([['毒', 'no'], ['溶', predicateOf('溶')], ['刃']]);
  if (!(melt.e.poisonT > 0 && melt.e.poison >= 4)) bad.push(`溶の毒が敵に付かない (poison ${melt.e.poison})`);
  const dry = hit([['炎', 'no'], ['干', predicateOf('干')], ['刃']]);
  if (!(dry.e.burnT > 0 && dry.e.burn >= 2.5)) bad.push(`干の炎上が敵に付かない (burn ${dry.e.burn})`);
  ok(!bad.length, `状態異常の実適用: ${bad.join(' / ')}`);
  console.log(`  5 文 (基準含む) を実戦確認 / 不一致 ${bad.length}`);
}

sec('文レベル: 熟語経由でも効果が変わる');
{
  const bad = [];
  // 辞書熟語の fx は構成語から自動生成される (words.compounds.js)。
  // 元語を直したので、熟語側にも新しい効果が伝わっているはず。
  const checks = [
    ['冬霧', (fx) => (fx.chill || 0) > 0 && !fx.poison, '霧の毒が残る/減速が無い'],
    ['呪縛', (fx) => (fx.chill || 0) > 0 && !fx.slowImmune, '縛の slowImmune が残る/減速が無い'],
    ['地縛霊', (fx) => !fx.slowImmune, 'slowImmune が残る'],
    ['剣聖', (fx) => (fx.regen || 0) > 0, '聖の回復が伝わっていない'],
    ['真赤', (fx) => !fx.burn, '赤の炎上が残る'],
    ['濃霧', (fx) => (fx.chill || 0) > 0 && !fx.poison, '霧の毒が残る/減速が無い'],
  ];
  for (const [p, need, why] of checks) {
    const e = PHRASE_BONUS[p];
    if (!e) { bad.push(`${p}: 熟語が無い`); continue; }
    if (!need(e.fx || {})) bad.push(`${p}: ${why}`);
  }
  // 文でも: 冬霧は並べただけの霧冬より減速が強く、剣聖は聖単独より回復が強い。
  const fwd = resolve([['冬'], ['霧'], ['刃']]);
  const rev = resolve([['霧'], ['冬'], ['刃']]);
  if (!((fwd.stats.chill || 0) > (rev.stats.chill || 0))) bad.push('冬霧の熟語ボーナスが文に出ない');
  const ks = resolve([['剣'], ['聖', 'no'], ['刃']]);
  const sOnly = resolve([['聖', 'no'], ['刃']]);
  if (!((ks.stats.regen || 0) > (sOnly.stats.regen || 0))) bad.push('剣聖の熟語ボーナスが文に出ない');
  const zb = resolve([['呪'], ['縛'], ['刃']]);
  if (!((zb.stats.chill || 0) > 0 && (zb.stats.slowImmune || 0) === (bare.stats.slowImmune || 0))) bad.push('呪縛の文で減速が付かない/slowImmune が混ざる');
  ok(!bad.length, `熟語経由の効果: ${bad.join(' / ')}`);
  console.log(`  熟語 ${checks.length} 件 + 文 3 件を確認 / 不一致 ${bad.length}`);
}

sec('文レベル: 1.75 で足した属性語が文と特殊武器に届く');
{
  // 語: [属性, 文で素の刃より上がる看板ステータス]
  const NEW = {
    '雹': ['ice', 'chill'], '霰': ['ice', 'chill'], '冽': ['ice', 'chill'], '霙': ['ice', 'chill'],
    '銭': ['gold', 'magnet'], '錦': ['gold', 'magnet'], '璧': ['gold', 'magnet'],
    '脈': ['blood', 'lifesteal'], '滴': ['blood', 'lifesteal'], '臓': ['blood', 'lifesteal'],
    '疫': ['poison', 'poison'], '腐': ['poison', 'poison'], '痺': ['poison', 'poison'],
    '銅': ['steel', 'pierce'], '錫': ['steel', 'armor'], '鉛': ['steel', 'knock'],
    '霆': ['thunder', 'shock'],
    // 風の speed は斬撃型の最終ステータスでは固定 (既存の風・颯・雲も同じ)。
    // 看板は fx 側の speed で見て、最終ステータスでは各語の副効果で確かめる。
    '凛': ['wind', 'chill'], '爽': ['wind', 'crit'], '薫': ['wind', 'area'],
  };
  const bad = [];
  let cases = 0;
  for (const [t, [el, key]] of Object.entries(NEW)) {
    const w = WORDS[t];
    if (!w) { bad.push(`${t}: 語が無い`); continue; }
    if (w.cat !== 'element' || w.el !== el) bad.push(`${t}: 分類 ${w.cat}/${w.el} (期待 element/${el})`);
    // 「Xの刃」: 文の主属性がその語の属性になり、看板効果が最終ステータスに乗る。
    const r = sentenceWith(t);
    if (!r || !r.valid) { bad.push(`${t}: 文が成立しない`); continue; }
    cases++;
    if (r.element !== el) bad.push(`${t}: 文の主属性 ${r.element} (期待 ${el})`);
    if (!((r.stats[key] || 0) > (bare.stats[key] || 0))) bad.push(`${t}: ${key} が最終ステータスに届かない`);
    if (el === 'wind' && !((r.evalResult?.fx?.speed || 0) > 0)) bad.push(`${t}: 風の看板 speed が fx に無い`);
    // 特殊武器: 定義が引け、形と型が属性の既定 (ELEMENT_SHAPE) に解決できる。
    // 動詞を述べて解決したときの型は ELEMENT_KIND になる (下の発動確認で見る)。
    const def = defForForm(t);
    if (!def.special) bad.push(`${t}: 特殊武器にならない`);
    if (def.shape !== ELEMENT_SHAPE[el][0] || def.kind !== ELEMENT_SHAPE[el][1]) {
      bad.push(`${t}: 特殊武器の形/型 ${def.shape}/${def.kind} (期待 ${ELEMENT_SHAPE[el][0]}/${ELEMENT_SHAPE[el][1]})`);
    }
    // 動詞を述べた文では特殊武器として発動する (燃やすX)。
    const sp = resolve([['燃', 'やす'], [t]]);
    if (!(sp.special === true && sp.tail === t && sp.kind === ELEMENT_KIND[el])) {
      bad.push(`${t}: 「燃やす${t}」で特殊武器が発動しない (special=${sp.special} tail=${sp.tail} kind=${sp.kind})`);
    }
  }
  // 動詞の形を持つ新語は、その形でも文にできる (腐る刃・痺れる刃)。
  for (const t of ['腐', '痺']) {
    const p = predicateOf(t);
    const r = p && resolve([[t, p], ['刃']]);
    if (!r || !r.valid || !(r.stats.poison > (bare.stats.poison || 0))) bad.push(`${t}: 「${t}${p}刃」で毒が届かない`);
    else cases++;
  }
  // 属性別の語数 (1.75 の追加後)。
  const counts = {};
  for (const w of Object.values(WORDS)) if (w.cat === 'element') counts[w.el] = (counts[w.el] || 0) + 1;
  const want = { ice: 8, gold: 7, blood: 9, poison: 9, steel: 9, thunder: 10, wind: 12 };
  for (const [el, n] of Object.entries(want)) {
    if (counts[el] !== n) bad.push(`${el}: ${counts[el]} 語 (期待 ${n})`);
  }
  ok(!bad.length, `1.75 の属性語: ${bad.join(' / ')}`);
  console.log(`  新語 ${Object.keys(NEW).length} 語 / 文 ${cases} 件を確認 / 不一致 ${bad.length}`);
}

sec('文レベル: 1.75 の新語でも融合が発動する');
{
  const bad = [];
  // 氷の新語 + 風 → 吹雪。融合は属性ペアで決まるので、新語でも自動で効くはず。
  const bliz = resolve([['雹', 'no'], ['風', 'no'], ['刃']]);
  if (!(bliz.element === 'ice' && bliz.subElement === 'wind')) bad.push(`雹+風: 属性 ${bliz.element}/${bliz.subElement}`);
  if (bliz.fusion?.id !== 'blizzard' || bliz.stats.fusion !== 'blizzard') bad.push(`雹+風: 融合 ${bliz.fusion?.id} (期待 blizzard)`);
  // 雷の新語 + 水 → 感電。
  const cond = resolve([['霆', 'no'], ['水', 'no'], ['刃']]);
  if (!(cond.element === 'thunder' && cond.subElement === 'water')) bad.push(`霆+水: 属性 ${cond.element}/${cond.subElement}`);
  if (cond.fusion?.id !== 'conduct' || cond.stats.fusion !== 'conduct') bad.push(`霆+水: 融合 ${cond.fusion?.id} (期待 conduct)`);
  ok(!bad.length, `新語の融合: ${bad.join(' / ')}`);
  console.log(`  2 文 (吹雪・感電) を確認 / 不一致 ${bad.length}`);
}

console.log(`\n---- 合格 ${pass} / 不合格 ${fail} ----`);
process.exit(fail ? 1 : 0);
