// 語辞書と文判定の単体テスト。  node test/words.test.js
import { WORDS, DRAWABLE, DRAWABLE_ALL, CONNECTOR_SET, segment, evaluate, makeWord, drawWord, WORDS_BY_CAT, DUPLICATES, PHRASE_BONUS, CONNECTORS } from '../js/data/words.js';
import { CONNECT_SOURCES, checkConnectors } from '../js/data/words.connect.js';
import { makeRng } from '../js/core/util.js';

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
console.log(`  語合計 ${Object.keys(WORDS).length} / 引ける ${DRAWABLE.length} / 接続詞 ${CONNECTOR_SET.size}`);
console.log('  種別:', Object.entries(WORDS_BY_CAT).map(([k, v]) => `${k}=${v.length}`).join(' '));
ok(DUPLICATES.length === 0, `語の重複定義: ${JSON.stringify(DUPLICATES)}`);

sec('分割');
ok(JSON.stringify(segment('火球')) === JSON.stringify(['火', '球']), `火球 -> ${JSON.stringify(segment('火球'))}`);
ok(JSON.stringify(segment('律スル')) === JSON.stringify(['律', 'スル']),
  `律スル -> ${JSON.stringify(segment('律スル'))}`);
ok(JSON.stringify(segment('浸食サレタ')) === JSON.stringify(['浸食', 'サレタ']),
  `浸食サレタ -> ${JSON.stringify(segment('浸食サレタ'))}`);
ok(segment('あいか') === null, 'あいか が分割できてしまった');
ok(segment('ノ') !== null, 'ノ が分割できない');
ok(segment('')?.length === 0, '空文字の処理');

sec('文の成立');
// makeWord は辞書に無い語を弾く。文判定は生データを渡して試す。
const E = (...ws) => evaluate(ws.map((w) => (typeof w === 'string' ? { text: w } : w)));
const EW = (...ws) => E(...ws.map(makeWord));

let r = E('火', 'ノ', '球');
ok(r.valid, '「火ノ球」が不成立');
ok(r.segments.length === 3, `分割数 ${r.segments.length}`);
ok(r.element === 'fire', `属性 ${r.element}`);

r = E('火', '球');
ok(r.valid, '「火球」が不成立');
ok(r.idiom?.phrase === '火球', `熟語が乗らない: ${r.idiom?.phrase}`);
ok(r.grade === 'idiom', `評価 ${r.grade}`);

r = E('火', '弾');
ok(r.valid, '「火弾」が不成立');

r = E('ノ', 'イ', 'ナ');
ok(!r.valid, '接続詞だけの文が成立してしまった');
ok(r.reason === 'noparticle', `理由 ${r.reason}`);

r = E('あ', 'い');
ok(!r.valid, '分割不能な語が成立してしまった');
ok(r.reason === 'unseg', `理由 ${r.reason}`);

r = E('火', '球', 'ノ', 'あ', 'い');
ok(!r.valid, '分割不能な語が成立してしまった');
ok(r.reason === 'unseg', `理由 ${r.reason}`);

r = E('矢');
ok(!r.valid, '1 語だけの文が成立してしまった');

r = E();
ok(!r.valid, '空の文が成立してしまった');
ok(r.reason === 'empty', `理由 ${r.reason}`);

sec('効果の合算');
r = E('火', '分裂', '貫徹', '弾');
ok(r.valid, '複合文が不成立');
ok(r.fx.burn > 0, `burn=${r.fx.burn}`);

ok(r.fx.split >= 3, `split=${r.fx.split}`);
ok(r.fx.pierce >= 2, `pierce=${r.fx.pierce}`);
ok(r.fx.dmg > 0, `dmg=${r.fx.dmg}`);
ok(typeof r.fx.power === 'number' && r.fx.power > 1, `power=${r.fx.power}`);

sec('長文');
const long = ['炎', '巨大', '分裂', '回転', '誘導', '弾', '矢'];
r = E(...long);
ok(r.valid, `長文が不成立: ${r.reasonText}`);
ok(r.content >= 6, `実効語数 ${r.content}`);

sec('属性の判定');
ok(E('火', '弾').element === 'fire', '火');
ok(E('氷', '弾').element === 'ice', '氷');
ok(E('雷', '弾').element === 'thunder', '雷');
ok(E('毒', '弾').element === 'poison', '毒');
ok(E('分裂', '弾').element === 'none', '属性なし');
ok(E('火', '氷', '弾').element === 'fire', '同数のときは先頭優先');

sec('表記ゆれ(全語が単独で分割可能であること)');
for (const w of Object.keys(WORDS)) {
  const s = segment(w);
  ok(!!s, `${w} が単独で分割できない`);
}

sec('熟語はすべて到達可能であること');
{
  const avail = new Set([...DRAWABLE, ...CONNECTOR_SET]);
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

sec('接続詞も語彙から引ける');
{
  ok(DRAWABLE_ALL.length > DRAWABLE.length, 'DRAWABLE_ALL に接続詞が含まれていない');
  const connInPool = DRAWABLE_ALL.filter((w) => WORDS[w].cat === 'connect');
  ok(connInPool.length === Object.keys(CONNECTORS).length,
    `語彙に入る接続詞が少ない: ${connInPool.length}`);
  ok(!DRAWABLE.includes('ノ'), 'DRAWABLE (接続詞なし) に接続詞が混じっている');
  for (const c of Object.keys(CONNECTORS)) {
    ok(connInPool.includes(c), `接続詞「${c}」が引けない`);
  }

  // 実際に引けるか。接続詞も少しは引かれるはず。
  const seen = new Map();
  for (let i = 0; i < 4000; i++) {
    const w = drawWord(makeRng(i * 2654435761 % 4294967296));
    if (w) seen.set(w.cat, (seen.get(w.cat) || 0) + 1);
  }
  ok(seen.get('connect') > 0, `4000 回引いても接続詞が出ない: ${JSON.stringify([...seen])}`);
  const total = [...seen.values()].reduce((a, b) => a + b, 0);
  const ratio = seen.get('connect') / total;
  ok(ratio > 0.03, `接続詞の比重が低すぎる: ${(ratio * 100).toFixed(1)}%`);
  ok(ratio < 0.20, `接続詞の比重が高すぎる: ${(ratio * 100).toFixed(1)}%`);
  console.log(`  4000 回の抽選: 接続詞 ${(ratio * 100).toFixed(1)}% / 実質語 ${(100 - ratio * 100).toFixed(1)}%`);
}

sec('助詞と助動詞はもう無い');
{
  const gone = ['の', 'は', 'が', 'を', 'に', 'で', 'と', 'も', 'や', 'へ', 'だけ', 'ほど', 'ずつ',
    'より', 'こそ', 'さえ', 'など', 'ながら', 'ばかり', 'さらに', 'する', 'なり', 'べし'];
  for (const w of gone) ok(!WORDS[w], `旧接続語「${w}」が辞書に残っている`);
  ok(WORDS_BY_CAT.grammar === undefined, 'grammar カテゴリが残っている');
  ok(WORDS_BY_CAT.aux === undefined, 'aux カテゴリが残っている');
}

sec('接続詞の結合表は語が存在すること');
{
  for (const [src, v] of Object.entries(CONNECT_SOURCES)) {
    ok(WORDS[src], `結合元の語「${src}」が辞書に無い`);
    for (const c of [].concat(v)) ok(CONNECTORS[c], `接続詞「${c}」が定義されていない`);
  }
  for (const c of Object.keys(CONNECTORS)) {
    const n = Object.values(CONNECT_SOURCES).filter((x) => [].concat(x).includes(c)).length;
    ok(n > 0, `接続詞「${c}」に結合元が 1 つも無い`);
  }
  // 「結合元 + 接続詞」が 1 語に潰れないこと。
  // 潰れると合成語を作れない (呪 + イ が「呪イ」1 語になる例)。
  for (const [src, v] of Object.entries(CONNECT_SOURCES)) {
    for (const c of [].concat(v)) {
      const segs = segment(src + c);
      ok(segs && segs.length === 2 && segs[0] === src && segs[1] === c,
        `「${src}+${c}」が合成語として分割できない: ${JSON.stringify(segs)}`);
    }
  }
}

sec('接続詞の規則 (仕様書の例)');
{
  const E2 = (...ws) => evaluate(ws.map((w) => ({ text: w })));

  // 例1 … 接続詞なし。4 つの修飾語 + 末尾語。
  let r = E2('爆裂', '無双', '無敵', '疾風', '剣');
  ok(r.valid, `例1 が不成立: ${r.reasonText}`);
  ok(r.compounds.length === 0, `例1 に合成がある: ${r.compounds.map((c) => c.text)}`);
  ok(r.segments.join('/') === '爆裂/無双/無敵/疾風/剣', `例1 の分割 ${r.segments.join('/')}`);

  // 例2 … 律スル風ノ海潮神弓
  r = E2('律', 'スル', '風', 'ノ', '海潮', '神', '弓');
  ok(r.valid, `例2 が不成立: ${r.reasonText}`);
  ok(r.compounds.map((c) => c.text).join(',') === '律スル,風ノ',
    `例2 の合成 ${r.compounds.map((c) => c.text).join(',')}`);
  ok(r.conn.floats.length === 0, `例2 に宙に浮く接続詞がある: ${r.conn.floats}`);

  // 例3 … 思考セシ天下無双ノ剣。無双は ノ を結べないから ノ は宙に浮く。
  r = E2('思考', 'セシ', '天下', '無双', 'ノ', '剣');
  ok(r.valid, `例3 が不成立: ${r.reasonText}`);
  ok(r.compounds.map((c) => c.text).join(',') === '思考セシ',
    `例3 の合成 ${r.compounds.map((c) => c.text).join(',')}`);
  ok(r.conn.floats.join(',') === 'ノ', `例3 の浮遊 ${r.conn.floats.join(',')}`);

  // NG1 … ノが 2 回。
  r = E2('風', 'ノ', '海潮', 'ノ', '銃');
  ok(!r.valid, 'NG1 が成立してしまった');
  ok(r.reason === 'dupconn', `NG1 の理由 ${r.reason}`);

  // NG2 … ノ (下位) が サレタ (上位) より先。
  r = E2('雷', 'ノ', '浸食', 'サレタ', '剣');
  ok(!r.valid, 'NG2 が成立してしまった');
  ok(r.reason === 'connorder', `NG2 の理由 ${r.reason}`);
  ok(/ノ/.test(r.reasonText) && /サレタ/.test(r.reasonText), `NG2 の説明 ${r.reasonText}`);

  // 修正 … サレタ が ノ より先なら成立。
  r = E2('浸食', 'サレタ', '雷', 'ノ', '剣');
  ok(r.valid, `修正版が不成立: ${r.reasonText}`);
  ok(r.compounds.map((c) => c.text).join(',') === '浸食サレタ,雷ノ',
    `修正版の合成 ${r.compounds.map((c) => c.text).join(',')}`);

  console.log('  例1/例2/例3 成立 / NG1・NG2 不成立 / 修正版 成立');
}

sec('接続詞の優先順位');
{
  const E2 = (...ws) => evaluate(ws.map((w) => ({ text: w })));
  // 昇順 (上位 -> 下位) は成立。
  ok(E2('律', 'スル', '風', 'ノ', '剣').valid, 'スル -> ノ が通らない');
  ok(E2('思考', 'セシ', '風', 'ノ', '剣').valid, 'セシ -> ノ が通らない');
  ok(E2('風', 'ノ', '雷', 'イ', '剣').valid, 'ノ -> イ (同順位) が通らない');
  // 降順は脱落。
  ok(!E2('風', 'ノ', '律', 'スル', '剣').valid, 'ノ -> スル が通ってしまう');
  ok(!E2('風', 'イ', '浸食', 'サレタ', '剣').valid, 'イ -> サレタ が通ってしまう');
  // 同じ接続詞の 2 回目はすべて脱落。
  for (const [src, v] of Object.entries(CONNECT_SOURCES)) {
    for (const conn of [].concat(v)) {
      ok(!E2(src, conn, '火', conn, '弾').valid, `接続詞「${conn}」の 2 回目が通ってしまう`);
    }
  }
}

sec('接続詞は文を成立させない');
{
  const E2 = (...ws) => evaluate(ws.map((w) => ({ text: w })));
  let r = E2('ノ', 'イ', 'ナ');
  ok(!r.valid, '接続詞だけの文が成立している');
  r = E2('火', 'ノ', 'ノ');
  ok(!r.valid, '実質語 1 つに接続詞を足しても成立している');
  r = E2('火', 'ノ', '球');
  ok(r.valid, '「火ノ球」が不成立');
  ok(r.segments.length === 3, `分割数 ${r.segments.length}`);
  // 合成できたぶんだけ文の力が上がる。
  const short = E2('火', '弾');
  const bound = E2('火', 'ノ', '弾');
  ok(bound.fx.power > short.fx.power, `文の力: ${short.fx.power} -> ${bound.fx.power}`);
  // 結べない接続詞 (宙に浮く) は効果が薄い。
  const float = E2('火', '矢', 'ノ');
  ok(float.valid, '宙に浮く接続詞で不成立');
  console.log(`  文の力 「火弾」=${short.fx.power.toFixed(2)} / 「火ノ弾」=${bound.fx.power.toFixed(2)} / 「火矢ノ」=${float.fx.power.toFixed(2)}`);
}

sec('文が実際に読める形で作れること');
{
  const E2 = (...ws) => evaluate(ws.map((w) => ({ text: w })));
  const cases = [
    [['力', '刃', '火', '球'], true],
    [['心意', '弾', '雷', '矢'], true],
    [['火', 'ノ', '弾', '疾速'], true],
    [['力', '刃', '弾'], true],
    [['力', '弾', '刃'], true],
    [['力', 'ノ'], false],
    [['力'], false],
  ];
  for (const [ws, want] of cases) {
    const r = E2(...ws);
    ok(r.valid === want, `「${ws.join('')}」valid=${r.valid} (期待 ${want})`);
  }
}

console.log(`\n---- 合格 ${pass} / 不合格 ${fail} ----`);
process.exit(fail ? 1 : 0);
