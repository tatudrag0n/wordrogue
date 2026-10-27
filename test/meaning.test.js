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
import { VERB_SHAPE, FORM_SHAPE, defForForm } from '../js/data/weapons.js';
import { connectorsAfter, formAfter } from '../js/data/words.connect.js';
import { makeRng } from '../js/core/util.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const sec = (t) => console.log(`\n== ${t} ==`);
const audio = new Proxy({}, { get: () => () => {} });
const run = new Run({
  stageId: 1, audio, save: { d: { meta: {} } }, weaponIds: ['sword'], lexiconSize: 12,
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
  const mods = Object.keys(WORDS).filter((t) => WORDS[t].cat === 'modifier' || WORDS[t].cat === 'form');
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
  console.log(`  効果・形態語 ${mods.length} 語 / 効果なし ${inert.length}`);
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

console.log(`\n---- 合格 ${pass} / 不合格 ${fail} ----`);
process.exit(fail ? 1 : 0);
