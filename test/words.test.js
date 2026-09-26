// 語辞書と文判定の単体テスト。  node test/words.test.js
import { WORDS, DRAWABLE, PARTICLES, segment, evaluate, makeWord, WORDS_BY_CAT, DUPLICATES, PHRASE_BONUS } from '../js/data/words.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; }
  else { fail++; console.log('  FAIL:', msg); }
};
const sec = (t) => console.log(`\n== ${t} ==`);

sec('辞書の健全性');
ok(Object.keys(WORDS).length > 200, `語数太少: ${Object.keys(WORDS).length}`);
ok(DRAWABLE.length > 150, `引ける語が少ない: ${DRAWABLE.length}`);
for (const w of Object.keys(WORDS)) {
  ok(typeof w === 'string' && w.length > 0, `不正な語: ${JSON.stringify(w)}`);
  ok(!/[\s]/.test(w), `語に空白を含む: ${JSON.stringify(w)}`);
  ok(w.length <= 5, `語が長すぎる: ${w}(${w.length})`);
  ok(WORDS[w].player === null || WORDS[w].cat === 'buff', `player が buff でない: ${w}`);
}
console.log(`  語合計 ${Object.keys(WORDS).length} / 引ける ${DRAWABLE.length} / 文語 ${PARTICLES.size}`);
console.log('  種別:', Object.entries(WORDS_BY_CAT).map(([k, v]) => `${k}=${v.length}`).join(' '));
ok(DUPLICATES.length === 0, `語の重複定義: ${JSON.stringify(DUPLICATES)}`);

sec('分节');
ok(JSON.stringify(segment('火の球')) === JSON.stringify(['火', 'の', '球']), `火の球 -> ${JSON.stringify(segment('火の球'))}`);
ok(JSON.stringify(segment('火球')) === JSON.stringify(['火', '球']), `火球 -> ${JSON.stringify(segment('火球'))}`);
ok(JSON.stringify(segment('雷の矢')) === JSON.stringify(['雷', 'の', '矢']), `雷の矢 -> ${JSON.stringify(segment('雷の矢'))}`);
ok(segment('あいか') === null, 'あいか が分割できてしまった');
ok(segment('の') !== null, 'の が分割できない');
ok(segment('')?.length === 0, '空文字の処理');

sec('文の成立');
// makeWord は辞書に無い語を弾く。文判定は生データを渡して試す。
const E = (...ws) => evaluate(ws.map((w) => (typeof w === 'string' ? { text: w } : w)));
const EW = (...ws) => E(...ws.map(makeWord));

let r = E('火', 'の', '球');
ok(r.valid, '「火の球」が不成立');
ok(r.segments.length === 3, `分割数 ${r.segments.length}`);
ok(r.element === 'fire', `属性 ${r.element}`);

r = E('火', '球');
ok(r.valid, '「火球」が不成立');
ok(r.idiom?.phrase === '火球', `熟語が乗らない: ${r.idiom?.phrase}`);
ok(r.grade === 'idiom', `評価 ${r.grade}`);

r = E('火', 'の');
ok(!r.valid, '「火の」が成立してしまった');
ok(r.reason === 'onelexeme', `理由 ${r.reason}`);

r = E('の', 'は', 'が');
ok(!r.valid, '助詞だけの文が成立してしまった');
ok(r.reason === 'noparticle', `理由 ${r.reason}`);

r = E('あ', 'い');
ok(!r.valid, '分割不能な語が成立してしまった');
ok(r.reason === 'unseg', `理由 ${r.reason}`);

r = E('火', '球', 'の', 'あ', 'い');
ok(!r.valid, '分割不能な語が成立してしまった');
ok(r.reason === 'unseg', `理由 ${r.reason}`);

r = E('矢');
ok(!r.valid, '1 語だけの文が成立してしまった');

r = E();
ok(!r.valid, '空の文が成立してしまった');
ok(r.reason === 'empty', `理由 ${r.reason}`);

sec('効果の合算');
r = E('火', 'の', '分裂', 'の', '貫', 'の', '弾');
ok(r.valid, '複合文が不成立');
ok(r.fx.burn > 0, `burn=${r.fx.burn}`);
ok(r.fx.split >= 3, `split=${r.fx.split}`);
ok(r.fx.pierce >= 2, `pierce=${r.fx.pierce}`);
ok(r.fx.dmg > 0, `dmg=${r.fx.dmg}`);
ok(typeof r.fx.power === 'number' && r.fx.power > 1, `power=${r.fx.power}`);

sec('長文');
const long = ['炎', 'の', '巨大', 'と', '分裂', 'の', '回転', 'の', '導', '弾', 'の', '矢'];
r = E(...long);
ok(r.valid, `長文が不成立: ${r.reasonText}`);
ok(r.content >= 6, `実効語数 ${r.content}`);

sec('属性の判定');
ok(E('火', 'の', '弾').element === 'fire', '火');
ok(E('氷', 'の', '弾').element === 'ice', '氷');
ok(E('雷', 'の', '弾').element === 'thunder', '雷');
ok(E('毒', 'の', '弾').element === 'poison', '毒');
ok(E('分裂', 'の', '弾').element === 'none', '属性なし');
ok(E('火', '氷', 'の', '弾').element === 'fire', '同数のときは先頭優先');

sec('表記ゆれ(全語が単独で分割可能であること)');
for (const w of Object.keys(WORDS)) {
  const s = segment(w);
  ok(!!s, `${w} が単独で分割できない`);
}

sec('熟語はすべて到達可能であること');
{
  const avail = new Set([...DRAWABLE, ...PARTICLES]);
  const unreachable = [];
  for (const key of Object.keys(PHRASE_BONUS)) {
    const segs = segment(key);
    if (!segs) { unreachable.push(`${key} (分割不能)`); continue; }
    const missing = segs.filter((w) => !avail.has(w));
    if (missing.length) unreachable.push(`${key} (語が無い: ${missing.join('/')})`);
  }
  if (unreachable.length) console.log('  到達不能:', unreachable.join('  '));
  ok(unreachable.length === 0, `到達不能な熟語が ${unreachable.length} 個ある`);

  // 熟語は分节辞書に載せてはいけない。載せると「火」「球」の連結が分割不能になる。
  for (const key of Object.keys(PHRASE_BONUS)) {
    ok(!WORDS[key], `熟語「${key}」が語辞書に入っている`);
  }
  for (const key of Object.keys(PHRASE_BONUS)) {
    const p = PHRASE_BONUS[key];
    ok(!!p && !!p.fx && Object.keys(p.fx).length > 0, `熟語「${key}」に効果が無い`);
    ok(!!p.name && !!p.desc, `熟語「${key}」の説明が無い`);
    ok(p.phrase === key, `熟語「${key}」の phrase が一致しない`);
  }
}

console.log(`\n---- 合格 ${pass} / 不合格 ${fail} ----`);
process.exit(fail ? 1 : 0);
