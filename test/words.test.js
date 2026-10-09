// 語辞書と文判定の単体テスト。  node test/words.test.js
import { WORDS, DRAWABLE, DRAWABLE_ALL, SIMPLE_POOL, CONNECTOR_SET, CONNECTOR_LIST, segment, evaluate, makeWord, drawWord, WORDS_BY_CAT, DUPLICATES, PHRASE_BONUS, CONNECTORS, findCompound } from '../js/data/words.js';
import { canConnect, connectorFor, formOf, POS, connectorsAfter, formAfter, COMPOUND_POOLS } from '../js/data/words.connect.js';
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
// 形態語 (末尾語) は語彙から引けない。辞書には分割用として残る。
ok(!DRAWABLE.some((w) => WORDS[w].cat === 'form'), 'DRAWABLE に形態語が混じっている');
ok(!DRAWABLE_ALL.some((w) => WORDS[w].cat === 'form'), 'DRAWABLE_ALL に形態語が混じっている');
ok(!SIMPLE_POOL.some((w) => WORDS[w].cat === 'form'), 'SIMPLE_POOL に形態語が混じっている');
ok(WORDS['剣'] && WORDS['銃'] && WORDS['環'], '末尾語が辞書から消えている');
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
// 送り仮名は 1 つの接続詞として割れる (複数字でも)。
for (const [s, want] of [
  ['爆ぜる', ['爆', 'ぜる']], ['斬られた', ['斬', 'られた']], ['斬された', ['斬', 'された']],
  ['妙な', ['妙', 'な']], ['静かな', ['静', 'かな']], ['確かな', ['確', 'かな']],
  ['滑らかな', ['滑', 'らかな']], ['凍える', ['凍', 'える']], ['大きな', ['大', 'きな']],
  ['明るい', ['明', 'るい']], ['呪いの', ['呪', 'いの']], ['穏やかな', ['穏', 'やかな']],
]) {
  ok(JSON.stringify(segment(s)) === JSON.stringify(want), `${s} -> ${JSON.stringify(segment(s))}`);
}
// 「確か」「静か」「滑らか」を 2 語の辞書項目には置かない。
for (const w of ['静か', '確か', '滑らか', '適切', '確実', '緻密', '妖艶', '華美', '豪快', '良質', '明快', '優美']) {
  ok(!WORDS[w], `「${w}」が辞書にある (1 漢字語 + 送り仮名で作るので不要)`);
}
// 分割は辞書引きなので「斬 + された」は割れる。結べるかはプールで見る。
ok(!canConnect(WORDS['斬'], 'された'), '「斬された」が結べてしまう');
ok(!canConnect(WORDS['静'], 'な'), '「静」に「な」が付いてしまう (静な は無い)');
ok(canConnect(WORDS['静'], 'かな'), '「静」に「かな」が付かない (静かな が作れない)');
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
ok(!r.idiom, `2 文字の熟語が乗る: ${r.idiom?.phrase}`);

r = E('毒', '蝕', '弾');
ok(r.valid, '「毒蝕弾」が不成立');
ok(r.idiom?.phrase === '毒蝕弾', `熟語が乗らない: ${r.idiom?.phrase}`);
ok(r.grade === 'idiom', `評価 ${r.grade}`);

r = E('火', '弾');
ok(r.valid, '「火弾」が不成立');

r = E('の', 'い', 'な');
ok(!r.valid, '接続詞だけの文が成立してしまった');
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
r = E('焔', '裂', '徹', '弾');
ok(r.valid, '複合文が不成立');
ok(r.fx.burn > 0, `burn=${r.fx.burn}`);

ok(r.fx.split >= 3, `split=${r.fx.split}`);
ok(r.fx.pierce >= 2, `pierce=${r.fx.pierce}`);
ok(r.fx.dmg > 0, `dmg=${r.fx.dmg}`);
ok(typeof r.fx.power === 'number' && r.fx.power > 1, `power=${r.fx.power}`);

sec('長文');
const long = ['炎', '巨', '裂', '律', '導', '弾', '矢'];
r = E(...long);
ok(r.valid, `長文が不成立: ${r.reasonText}`);
ok(r.content >= 6, `実効語数 ${r.content}`);

sec('属性の判定');
ok(E('火', '弾').element === 'fire', '火');
ok(E('氷', '弾').element === 'ice', '氷');
ok(E('電', '弾').element === 'thunder', '電');
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
  // 形態語 (末尾語) は語彙から引けない。末尾語を含む熟語は対象外。
  // 動詞は語彙から引ける (DRAWABLE_ALL)。爆発 = 爆 + 発 のような二字熟語に要る。
  const avail = new Set([...DRAWABLE_ALL, ...CONNECTOR_SET]);
  const unreachable = [];
  for (const key of Object.keys(PHRASE_BONUS)) {
    const segs = segment(key);
    if (!segs) { unreachable.push(`${key} (分割不能)`); continue; }
    if (segs.some((w) => WORDS[w]?.cat === 'form')) continue;
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

sec('熟語を作ると文の力が上がる (熟語ボーナス)');
{
  const PHRASE_BONUS_VALUE = 0.2;
  // 熟語が乗れば、それだけ 文の力 に固定で足される。
  const hit = evaluate([makeWord('毒'), makeWord('蝕'), makeWord('弾')], { tail: '弾' });
  ok(hit.valid, `「毒蝕弾」が不成立: ${hit.reasonText}`);
  ok(hit.idiom?.phrase === '毒蝕弾', `熟語が乗らない: ${hit.idiom?.phrase}`);
  ok(hit.phraseBonus === PHRASE_BONUS_VALUE,
    `熟語ボーナスが ${hit.phraseBonus} (期待 ${PHRASE_BONUS_VALUE})`);

  // 熟語的效果 (fx) も一緒に乗る。
  const same = evaluate([makeWord('毒'), makeWord('蝕'), makeWord('弾')], { tail: '弾' });
  const plain = evaluate([makeWord('毒'), makeWord('烈'), makeWord('弾')], { tail: '弾' });
  ok(same.fx.poison > plain.fx.poison || same.fx.pierce > plain.fx.pierce,
    `熟語の効果が入っていない: ${JSON.stringify(same.fx)} / ${JSON.stringify(plain.fx)}`);
  ok(same.fx.power > plain.fx.power, `熟語のほうが力が強い: ${same.fx.power} / ${plain.fx.power}`);

  // 熟語じゃない文には乗らない。
  ok(plain.idiom === null, `熟語でないのに乗った: ${plain.idiom?.phrase}`);
  ok(plain.phraseBonus === 0, `熟語でないのにボーナスがある: ${plain.phraseBonus}`);

  // 不成文では何も乗らない。
  const broken = evaluate([makeWord('毒')], { tail: '弾' });
  ok(!broken.valid, '不成文の判定が変わった');
  ok(broken.phraseBonus === 0, '不成文に熟語ボーナスがある');

  // すべての熟語について、ボーナスが fx.power に含まれていること。
  let missing = 0;
  for (const key of Object.keys(PHRASE_BONUS)) {
    const segs = segment(key);
    if (!segs) { missing++; continue; }
    const r = evaluate(segs.map(makeWord), { minContent: 2 });
    if (!r.valid) continue;                       // 文として成立しないものは対象外
    if (r.idiom?.phrase !== key) continue;        // 別の並びで評価されたものは対象外
    if (Math.abs(r.phraseBonus - PHRASE_BONUS[key].power) > 1e-9) missing++;
  }
  ok(missing === 0, `熟語ボーナスが見えない熟語が ${missing} 個`);
}

sec('二字熟語 (発電・電熱 …) と熟語の接続詞');
{
  const EV = (ws, tail) => evaluate(ws.map(makeWord), tail ? { tail } : {});
  const two = Object.keys(PHRASE_BONUS).filter((k) => PHRASE_BONUS[k].tier === 2);
  const three = Object.keys(PHRASE_BONUS).filter((k) => PHRASE_BONUS[k].tier === 3);
  ok(two.length >= 30 && two.length <= 60, `二字熟語の数 ${two.length}`);
  ok(three.every((k) => k.length >= 3), '三字熟語に 2 文字のものがある');
  for (const k of two) {
    const p = PHRASE_BONUS[k];
    ok(k.length === 2, `二字熟語「${k}」が 2 文字でない`);
    // 形を表す語 (刃・弾・球・光・雷…) は二字熟語に使わない (火球のずれの再発防止)。
    ok([...k].every((c) => WORDS[c] && WORDS[c].cat !== 'form'), `二字熟語「${k}」に形の語`);
    // 効果は三字熟語より小さい。
    ok(p.power < PHRASE_BONUS['毒蝕弾'].power && p.natural < PHRASE_BONUS['毒蝕弾'].natural,
      `二字熟語「${k}」の加点が三字熟語以上`);
  }
  // 熟語の接続詞プールの形は全部、接続詞の一覧にある。
  for (const k of Object.keys(COMPOUND_POOLS)) {
    for (const e of COMPOUND_POOLS[k].pool) ok(!!CONNECTORS[e.k], `熟語「${k}」の形「${e.k}」が接続詞に無い`);
  }

  // 電熱 … 二字熟語として検出される。
  let r = EV(['電', '熱', '剣'], '剣');
  ok(r.valid, `「電熱剣」が不成立: ${r.reasonText}`);
  ok(r.idiom?.phrase === '電熱', `電熱が熟語にならない: ${r.idiom?.phrase}`);
  ok(Math.abs(r.phraseBonus - 0.1) < 1e-9, `二字熟語のボーナス ${r.phraseBonus}`);
  ok(findCompound('炎電熱剣')?.phrase === '電熱', 'findCompound が電熱を拾わない');

  // 発電する剣 … 熟語「発電」に する が付く。述語・連体。熟語ボーナスも乗る。
  r = EV(['発', '電', 'する', '剣'], '剣');
  ok(r.valid, `「発電する剣」が不成立: ${r.reasonText}`);
  ok(r.idiom?.phrase === '発電', `発電が熟語にならない: ${r.idiom?.phrase}`);
  const c = r.compounds.find((x) => x.connector === 'する');
  ok(c && c.phrase && c.source === '発電' && c.role === 'adn' && c.pred,
    `する が熟語「発電」に付いていない: ${JSON.stringify(c)}`);
  ok(r.predicated, '発電する が述語にならない');
  ok(r.phraseBonus > 0 && r.fx.shock > 0, `発電の効果が乗らない: ${r.phraseBonus} / ${r.fx.shock}`);
  ok(r.fx.power > EV(['電', '剣'], '剣').fx.power, '発電する剣が電剣より弱い');

  // 電する … 熟語になっていなければ不成立のまま。
  r = EV(['電', 'する', '剣'], '剣');
  ok(!r.valid && r.reason === 'floatconn', `「電する剣」が成立してしまう: ${r.reason}`);
  r = EV(['炎', 'の', '電', 'する', '剣'], '剣');
  ok(!r.valid && r.reason === 'floatconn', `「炎の電する剣」が成立してしまう: ${r.reason}`);
  // 接続詞を挟むと熟語ではない (発の電する)。
  r = EV(['発', 'の', '電', 'する', '剣'], '剣');
  ok(!r.valid, '「発の電する剣」が成立してしまう');
  ok(!canConnect(WORDS['電'], 'する'), '電 に する が付いてしまう');
  ok(canConnect(WORDS['電'], 'する', ['発']), '発電 に する が付かない');
  ok(connectorsAfter(['発', '電'])[0] === 'する', `発電 の接続詞の先頭が する でない: ${connectorsAfter(['発', '電'])}`);
  ok(connectorsAfter(['電']).every((k) => k !== 'する'), '電 だけで する が出る');
  ok(formAfter(['炎', '発', '電'], 'する')?.source === '発電', '語列の末尾の熟語を拾わない');

  // 熟語の形の前後の規則も効く。
  r = EV(['炎', 'の', '爆', '発', 'する', '剣'], '剣');
  ok(r.valid, `「炎の爆発する剣」が不成立: ${r.reasonText}`);
  r = EV(['氷', 'を', '凍', '結', 'する', '剣'], '剣');
  ok(r.valid, `「氷を凍結する剣」が不成立: ${r.reasonText}`);
  ok(r.naturalParts.some((p) => p.key === 'object'), '「〜を凍結する」が目的語にならない');
  r = EV(['凍', '結', 'された', '剣'], '剣');
  ok(r.valid && r.idiom?.phrase === '凍結', `「凍結された剣」: ${r.reasonText} / ${r.idiom?.phrase}`);
  // された を持たない熟語には付かない。
  r = EV(['発', '電', 'された', '剣'], '剣');
  ok(!r.valid, '「発電された剣」が成立してしまう');

  // 最長一致: 三字熟語が二字熟語より勝つ。
  ok(EV(['凍', '結', '環'], '環').idiom?.phrase === '凍結環', '凍結環 より 凍結 が勝った');
  ok(EV(['大', '地', '震'], '震').idiom?.phrase === '大地震', '大地震 より 二字熟語が勝った');
  ok(EV(['感', '電', '弾'], '弾').idiom?.phrase === '感電弾', '感電弾 より 感電 が勝った');

  // 鍛冶の文: 「発」「電」と並べると「電」の接続詞に する が出る (先頭)。
  const { Sentence } = await import('../js/game/sentence.js');
  const sen = new Sentence();
  sen.push(makeWord('発')); sen.push(makeWord('電'));
  ok(sen.connOptions(1)[0] === 'する', `電 の接続詞の先頭が する でない: ${sen.connOptions(1)}`);
  ok(sen.connForm(1, 'する')?.source === '発電', 'connForm が熟語を返さない');
  ok(sen.setConnAt(1, 'する').ok, '発電 に する を置けない');
  ok(sen.text === '発電する', `文面 ${sen.text}`);
  // 間に接続詞を挟むと熟語でなくなる → する は出ない。
  const sen2 = new Sentence();
  sen2.push(makeWord('発')); sen2.push(makeWord('電'));
  sen2.setConnAt(0, 'の');
  ok(!sen2.connOptions(1).includes('する'), '発の電 に する が出る');
  ok(!sen2.setConnAt(1, 'する').ok, '発の電 に する が置けてしまう');
  // 10 文字の上限は熟語の形にも効く。
  const sen3 = new Sentence();
  for (const w of ['炎', '氷', '毒', '霧', '風', '砂', '発', '電']) sen3.push(makeWord(w));
  sen3.push(makeWord('鉄'));
  ok(sen3.len === 9, `長さ ${sen3.len}`);
  ok(!sen3.connOptions(7).includes('する'), '10 文字を超えるのに する が出る');
}

sec('接続詞は語彙から引けない (鍛冶のプールで無限)');
{
  // 接続詞は 3 択に出ない。鍛冶下部の接続詞プールから無限に置く。
  const connInPool = DRAWABLE_ALL.filter((w) => WORDS[w].cat === 'connect');
  ok(connInPool.length === 0, `DRAWABLE_ALL に接続詞が混じっている: ${connInPool.join('/')}`);
  ok(DRAWABLE_ALL.length === DRAWABLE.length + WORDS_BY_CAT.verb.length,
    `DRAWABLE_ALL = DRAWABLE + 動詞になるはず: ${DRAWABLE_ALL.length} / ${DRAWABLE.length} + ${WORDS_BY_CAT.verb.length}`);
  ok(!DRAWABLE.includes('の'), 'DRAWABLE に接続詞が混じっている');

  // 実際に引けないこと。4000 回引いても接続詞は 0。
  const seen = new Map();
  for (let i = 0; i < 4000; i++) {
    const w = drawWord(makeRng(i * 2654435761 % 4294967296));
    if (w) seen.set(w.cat, (seen.get(w.cat) || 0) + 1);
  }
  ok(!seen.get('connect'), `4000 回の抽選に接続詞が混じった: ${JSON.stringify([...seen])}`);
  const total = [...seen.values()].reduce((a, b) => a + b, 0);
  ok(total === 4000, `抽選が 4000 回行われていない: ${total}`);
  console.log(`  4000 回の抽選: 接続詞 0 / 実質語 100% (接続詞はプールから無限)`);
}

sec('助詞と助動詞はもう無い');
{
  // 昔の助詞・助動詞の語は辞書から消えている。
  const gone = ['は', 'が', 'で', 'と', 'も', 'や', 'だけ', 'ほど', 'ずつ',
    'より', 'こそ', 'さえ', 'など', 'ながら', 'ばかり', 'さらに', 'なり', 'べし'];
  for (const w of gone) ok(!WORDS[w], `旧接続語「${w}」が辞書に残っている`);
  // 「の」「を」「に」「へ」「する」は接続詞としてだけ残る。
  // 実質語 (名詞・動詞) にはならないので、語彙には出ない。
  const connOnly = ['の', 'を', 'に', 'へ', 'する'];
  for (const w of connOnly) {
    ok(!!WORDS[w], `接続詞「${w}」が辞書に無い`);
    ok(CONNECTOR_SET.has(w), `「${w}」が接続詞として登録されていない`);
    ok(!DRAWABLE.includes(w) && !DRAWABLE_ALL.includes(w),
      `接続詞「${w}」が語彙に出ている`);
  }
  ok(WORDS_BY_CAT.grammar === undefined, 'grammar カテゴリが残っている');
  ok(WORDS_BY_CAT.aux === undefined, 'aux カテゴリが残っている');
}

sec('語ごとの接続詞プール');
{
  const content = Object.keys(WORDS).filter((w) => !CONNECTOR_SET.has(w));
  const conns = Object.keys(CONNECTORS);

  // 全語に品詞とプールがある。
  for (const w of content) {
    ok(!!WORDS[w].pos && Object.values(POS).includes(WORDS[w].pos), `「${w}」の品詞が不明: ${WORDS[w].pos}`);
    ok(Array.isArray(WORDS[w].pool), `「${w}」にプールが無い`);
  }
  // canConnect はプールにあるかどうかだけ。connectorFor はプールの順そのまま。
  for (const w of content) {
    const pool = WORDS[w].pool.map((e) => e.k);
    ok(JSON.stringify(connectorFor(WORDS[w])) === JSON.stringify(pool), `「${w}」の connectorFor がプールと違う`);
    for (const c of conns) {
      ok(canConnect(WORDS[w], c) === pool.includes(c), `「${w}」+「${c}」の canConnect がプールと違う`);
    }
    // 形には役割がある。格は next を持つ。
    for (const e of WORDS[w].pool) {
      ok(['adn', 'adv', 'case'].includes(e.role), `「${w}${e.k}」の役割が不明: ${e.role}`);
      if (e.role === 'case') ok(['noun', 'verb', 'pred'].includes(e.next), `「${w}${e.k}」の格に next が無い`);
      ok(e.k.length <= 3, `「${w}${e.k}」の送り仮名が長すぎる`);
    }
  }
  // 名詞は共通の NOUN_POOL (の・を・に・へ)。
  ok(JSON.stringify(connectorFor(WORDS['焔'])) === JSON.stringify(['の', 'を', 'に', 'へ']),
    `「焔」のプール: ${connectorFor(WORDS['焔'])}`);
  // 生の {text} でも同じプールを引く (辞書の外の呼び出し)。
  ok(canConnect({ text: '焔' }, 'を'), '「焔を」が結べない');
  ok(!canConnect({ text: 'の' }, 'の'), '接続詞どうしで結合できてしまう');
  ok(!canConnect(null, 'の'), '直前の語が無いのに結合できてしまう');
  ok(!canConnect(WORDS['焔'], '焔'), '語を接続詞として結べてしまう');

  // 旧例外表・旧ハックは残っていない。
  for (const k of ['せし']) ok(!CONNECTORS[k], `旧接続詞「${k}」が残っている`);
  ok(JSON.stringify(CONNECTOR_LIST.slice().sort()) === JSON.stringify(conns.slice().sort()),
    'CONNECTOR_LIST と CONNECTORS が不一致');

  const has = (w, c) => ok(canConnect(WORDS[w], c), `「${w}${c}」が結べない`);
  const hasNot = (w, c) => ok(!canConnect(WORDS[w], c), `「${w}${c}」が結べている (日本語に無い)`);

  // ユーザーが挙げた不自然な形は全部消えている。
  hasNot('斬', 'された'); hasNot('回', 'せし'); hasNot('凍', 'ける'); hasNot('跨', 'く');
  hasNot('滑', 'かな'); hasNot('冷', 'つ');
  // 代わりに本当の送り仮名がある。
  has('斬', 'る'); has('斬', 'られた'); has('斬', 'り');
  has('凍', 'る'); has('凍', 'える');
  has('滑', 'らかな'); has('静', 'かな'); has('妙', 'な'); has('妙', 'に');
  has('速', 'く'); has('速', 'い'); has('跨', 'ぐ'); has('冷', 'たい'); has('冷', 'える');
  has('回', 'る'); has('回', 'す'); has('回', 'り'); has('回', 'された');
  has('呪', 'う'); has('呪', 'われた'); has('呪', 'いの');
  has('大', 'きな'); has('小', 'さな'); has('明', 'るい'); has('爆', 'ぜる');
  has('急', 'な'); has('急', 'に'); has('急', 'ぐ');
  // 品詞を混ぜない。
  hasNot('妙', 'い'); hasNot('強', 'な'); hasNot('静', 'な'); hasNot('巨', 'な');
  hasNot('焔', 'する'); hasNot('焔', 'かな'); hasNot('焔', 'く'); hasNot('強', 'かな');
  hasNot('融', 'く'); hasNot('嚇', 'む'); hasNot('潰', 'ける'); hasNot('穿', 'く'); hasNot('焦', 'ける');
  hasNot('温', 'つ'); hasNot('重', 'つ'); hasNot('通', 'い');
  // 同じ送り仮名でも役割は語ごと。
  ok(formOf(WORDS['速'], 'く').role === 'adv', '「速く」が連用でない');
  ok(formOf(WORDS['貫'], 'く').role === 'adn', '「貫く」が連体でない');
  ok(formOf(WORDS['妙'], 'に').role === 'adv', '「妙に」が連用でない');
  ok(formOf(WORDS['焔'], 'に').role === 'case', '「焔に」が格でない');

  // 「語 + 接続詞」が 1 語に潰れない (送り仮名ごとに 1 つの接続詞として割れる)。
  for (const w of content) {
    for (const c of connectorFor(WORDS[w])) {
      const segs = segment(w + c);
      ok(segs && segs.length === 2 && segs[0] === w && segs[1] === c,
        `「${w}+${c}」が合成語として分割できない: ${JSON.stringify(segs)}`);
    }
  }

  // 行き止まりを作らない。どの語も 1 つ以上の形を持つ。
  const dead = content.filter((w) => connectorFor(WORDS[w]).length === 0);
  ok(dead.length === 0, `接続詞が付かない語がある: ${dead.join(' ')}`);

  console.log(`  語 ${content.length} / 接続詞 ${conns.length} 種 / 結合できる組 ${content.reduce((s, w) => s + connectorFor(WORDS[w]).length, 0)}`);
}

sec('プールの形で文が読めること');
{
  const E2 = (...ws) => evaluate(ws.map(makeWord), { minContent: 2, tail: ws[ws.length - 1] });
  const good = [
    ['斬', 'られた', '刃'],                       // 斬られた刃
    ['凍', 'える', '刃'],                         // 凍える刃
    ['滑', 'らかな', '刃'],                       // 滑らかな刃
    ['焔', 'を', '斬', 'る', '刃'],               // 焔を斬る刃
    ['霜', 'を', '蝕', 'む', '刃'],               // 霜を蝕む刃
    ['踏', 'む', '焔', 'を', '斬', 'る', '刃'],   // 踏む焔を斬る刃
    ['溶', 'ける', '毒', 'を', '斬', 'る', '刃'], // 溶ける毒を斬る刃
    ['察', 'する', '毒', 'を', '斬', 'る', '刃'], // 察する毒を斬る刃
    ['小', 'さな', '焔', 'を', '斬', 'る', '刃'], // 小さな焔を斬る刃
    ['大', 'きな', '焔', 'の', '刃'],             // 大きな焔の刃
    ['急', 'に', '斬', 'る', '妙', 'な', '刃'],   // 急に斬る妙な刃
    ['急', 'な', '焔', 'を', '斬', 'る', '刃'],   // 急な焔を斬る刃
    ['速', 'く', '斬', 'る', '妙', 'な', '刃'],   // 速く斬る妙な刃
    ['毒', 'を', '回', 'す', '妙', 'な', '刃'],   // 毒を回す妙な刃
    ['毒', 'を', '回', 'り', '斬', 'る', '刃'],   // 毒を回り斬る刃
    ['静', 'かな', '焔', 'を', '斬', 'る', '刃'], // 静かな焔を斬る刃
    ['確', 'かな', '毒', 'を', '斬', 'る', '刃'], // 確かな毒を斬る刃
    ['穏', 'やかな', '焔', 'の', '弾'],           // 穏やかな焔の弾
    ['貫', 'く', '毒', 'を', '斬', 'る', '刃'],   // 貫く毒を斬る刃
    ['呪', 'いの', '毒', 'を', '斬', 'る', '刃'], // 呪いの毒を斬る刃
    ['呪', 'いを', '斬', 'る', '刃'],             // 呪いを斬る刃
    ['必', 'ず', '斬', 'る', '刃'],               // 必ず斬る刃
    ['焔', 'に', '強', 'い', '刃'],               // 焔に強い刃
    ['冷', 'たい', '毒', 'の', '弾'],             // 冷たい毒の弾
    ['雷', 'の', '響', 'く', '刃'],               // 雷の響く刃
    ['焔', 'の', '斬', 'られた', '剣'],           // 焔の斬られた剣 (「の」は連体節の主語にもなる)
  ];
  for (const ws of good) {
    const r = E2(...ws);
    ok(r.valid, `「${ws.join('')}」が不成立: ${r.reasonText}`);
  }
  const bad = [
    [['斬', 'された', '刃'], 'floatconn'],         // 斬された … 斬 のプールに された は無い
    [['凍', 'ける', '刃'], 'floatconn'],           // 凍ける
    [['滑', 'かな', '刃'], 'floatconn'],           // 滑かな
    [['跨', 'く', '刃'], 'floatconn'],             // 跨く
    [['冷', 'つ', '刃'], 'floatconn'],             // 冷つい
    [['回', 'せし', '刃'], 'unseg'],               // せし は辞書から消えた
    [['速', 'く', '焔', 'の', '刃'], 'connnoun'],  // 速く焔 … 連用のあとに名詞
    [['妙', 'に', '刃'], 'connnoun'],              // 妙に刃
    [['焔', 'を', '剣'], 'noobject'],              // 焔を剣
    [['焔', 'を', '強', 'い', '剣'], 'noobject'],  // 焔を強い剣 … を は動作が要る
    [['斬', 'る', '速', 'く', '斬', 'る', '剣'], 'connnoun'], // 斬る速く … 連体のあとに連用
    [['焔', 'の', '斬', '剣'], 'connnoun'],        // の のあとに裸の動詞
  ];
  const ER = (...ws) => evaluate(ws.map((t) => ({ text: t })), { minContent: 2, tail: ws[ws.length - 1] });
  for (const [ws, why] of bad) {
    const r = ER(...ws);
    ok(!r.valid && r.reason === why, `「${ws.join('')}」→ valid=${r.valid} reason=${r.reason} (期待 ${why})`);
  }
  // 同じ接続詞の重複は成立。ただし減点。
  const dup = E2('風', 'の', '潮', 'の', '銃');
  ok(dup.valid, `「風の潮の銃」が不成立: ${dup.reasonText}`);
  ok(dup.naturalParts.some((p) => p.key === 'dupconn'), '「風の潮の銃」に重複の減点が無い');
  const single = E2('風', 'の', '潮', '銃');
  ok(!single.naturalParts.some((p) => p.key === 'dupconn'), '重複していないのに減点がある');
  console.log(`  ${good.length} 通り成立 / ${bad.length} 通りは理由つきで落ちる / 重複は減点`);
}

sec('枠は語だけ、接続詞はあいだに置き換える');
{
  const { composeSegments, composeText } = await import('../js/data/words.js');
  const slots = [makeWord('弾'), makeWord('焔')];
  const connects = [makeWord('く'), makeWord('の')];
  const segs = composeSegments(slots, connects, makeWord('銃'));
  ok(segs.map((w) => w.text).join('/') === '弾/く/焔/の/銃',
    `文の並びが違う: ${segs.map((w) => w.text).join('/')}`);
  ok(composeText(slots, connects, makeWord('銃')) === '弾く焔の銃',
    `文面が違う: ${composeText(slots, connects, makeWord('銃'))}`);
  // 4 枠 + 3 接続詞でも語は 4 つ。接続詞が枠を潰さない。
  const four = [1, 2, 3, 4].map(() => makeWord('刃'));
  const three = [1, 2, 3].map(() => makeWord('の'));
  ok(composeSegments(four, three, makeWord('剣')).length === 8,
    '接続詞が枠の数だけ増える');
}

sec('日本語として読めない文は落ちること');
{
  const E2 = (...ws) => evaluate(ws.map((w) => ({ text: w })));

  // ここで落ちているのが昔バグった例。
  // 「刃剣」「貫を剣」「焔貫を剛された刃剣」のような形は日本語に無い。
  let r = evaluate(
    ['焔', '貫', 'を', '剛', 'られた', '刃', '剣'].map(makeWord),
    { minContent: 4, tail: '剣' },
  );
  ok(!r.valid, `「焔貫を剛られた刃剣」が成立してしまった: ${r.reasonText}`);

  // 用言・形が末尾語を直接修飾できない。
  r = evaluate(['斬', '剣'].map(makeWord), { minContent: 2, tail: '剣' });
  ok(!r.valid && r.reason === 'tailverb', `「斬剣」の理由 ${r.reason}`);

  r = evaluate(['刃', '剣'].map(makeWord), { minContent: 2, tail: '剣' });
  ok(!r.valid && r.reason === 'tailform', `「刃剣」の理由 ${r.reason}`);

  // 接続詞を挟んでも「刃剣」は日本語に無い。
  r = evaluate(
    ['焔', 'を', '斬', 'られた', '刃', '剣'].map(makeWord),
    { minContent: 4, tail: '剣' },
  );
  ok(!r.valid && r.reason === 'tailform',
    `「焔を斬られた刃剣」が成立した: ${r.valid}`);

  // 名詞句の頭が属性・効果なら通る。
  r = evaluate(
    ['焔', 'を', '斬', 'られた', '剛', '剣'].map(makeWord),
    { minContent: 4, tail: '剣' },
  );
  ok(r.valid, `「焔を斬られた剛剣」が不成立: ${r.reasonText}`);

  // 「〜を」は目的語を取る。後ろに動詞 (=動作) が無ければ落ちる。
  r = evaluate(['焔', 'を', '剣'].map(makeWord), { minContent: 2, tail: '剣' });
  ok(!r.valid && r.reason === 'noobject', `「焔を剣」の理由 ${r.reason}`);

  // 動詞のあとに名詞が直接来るものは無い。「焔を斬剣」 ✗ →「斬る剣」 ✓
  r = evaluate(['焔', 'を', '斬', '剣'].map(makeWord), { minContent: 3, tail: '剣' });
  ok(!r.valid, '「焔を斬剣」が成立してしまった');

  // 正しい言い方なら通る。
  r = evaluate(['焔', 'を', '斬', 'る', '剣'].map(makeWord), { minContent: 3, tail: '剣' });
  ok(r.valid, `「焔を斬る剣」が不成立: ${r.reasonText}`);
  r = evaluate(['焔', 'を', '斬', 'られた', '剣'].map(makeWord), { minContent: 3, tail: '剣' });
  ok(r.valid, `「焔を斬られた剣」が不成立: ${r.reasonText}`);
  // 「斬された」は斬のプールに無い。宙に浮く。
  r = evaluate(['焔', 'を', '斬', 'された', '剣'].map(makeWord), { minContent: 3, tail: '剣' });
  ok(!r.valid && r.reason === 'floatconn', `「焔を斬された剣」の理由 ${r.reason}`);

  // 連用形の接続詞のあとに名詞は来ない。「焔の硬く剣」 ✗ →「焔の硬い剣」 ✓
  r = evaluate(['焔', 'の', '硬', 'く', '剣'].map(makeWord), { minContent: 3, tail: '剣' });
  ok(!r.valid && r.reason === 'connnoun', `「焔の硬く剣」の理由 ${r.reason}`);
  r = evaluate(['焔', 'の', '硬', 'い', '剣'].map(makeWord), { minContent: 3, tail: '剣' });
  ok(r.valid, `「焔の硬い剣」が不成立: ${r.reasonText}`);

  // 形容は連体形。「焔を斬る硬く剣」 ✗ →「焔を斬る硬い剣」 ✓
  r = evaluate(['焔', 'を', '斬', 'る', '硬', 'く', '剣'].map(makeWord),
    { minContent: 3, tail: '剣' });
  ok(!r.valid && r.reason === 'connnoun', `「焔を斬る硬く剣」の理由 ${r.reason}`);
  r = evaluate(['焔', 'を', '斬', 'る', '硬', 'い', '剣'].map(makeWord),
    { minContent: 3, tail: '剣' });
  ok(r.valid, `「焔を斬る硬い剣」が不成立: ${r.reasonText}`);

  // 接続詞が直前の語に結べないものは壊れた文。「焔剛された剣」 ✗
  r = evaluate(['焔', '剛', 'された', '剣'].map(makeWord), { minContent: 3, tail: '剣' });
  ok(!r.valid && r.reason === 'floatconn', `「焔剛された剣」の理由 ${r.reason}`);

  r = evaluate(['焔', 'の', '斬', 'られた', '剣'].map(makeWord), { minContent: 3, tail: '剣' });
  ok(r.valid, `「焔の斬られた剣」が不成立: ${r.reasonText}`);

  // 属性語を頭に置くと、主題が立って最も自然。
  r = evaluate(['青', '焔', 'を', '斬', 'られた', '刃'].map(makeWord),
    { minContent: 3, tail: '刃' });
  ok(r.valid, `「青焔を斬られた刃」が不成立: ${r.reasonText}`);
  ok(r.naturalParts.some((p) => p.key === 'topic'), '属性で始まる文に主題の加点が無い');

  // 連用形「〜に」(妙に) のあとに名詞は来ない。格の「〜に」と区別する。
  r = evaluate(['焔', 'の', '妙', 'に', '剣'].map(makeWord), { minContent: 3, tail: '剣' });
  ok(!r.valid && r.reason === 'connnoun', `「焔の妙に剣」の理由 ${r.reason}`);
  // 同じ「に」を 2 回 (格と連用)。不成立ではなく減点。
  r = evaluate(['焔', 'に', '妙', 'に', '斬', 'る', '剣'].map(makeWord), { minContent: 3, tail: '剣' });
  ok(r.valid && r.naturalParts.some((p) => p.key === 'dupconn'), `「焔に妙に斬る剣」が減点つきで成立しない: ${r.reasonText}`);
  r = evaluate(['妙', 'に', '斬', 'る', '剣'].map(makeWord), { minContent: 2, tail: '剣' });
  ok(r.valid, `「妙に斬る剣」が不成立: ${r.reasonText}`);

  // 「響く刃」は動詞の「〜く」が連体形なので、名詞を修飾できる。
  r = evaluate(['雷', 'の', '響', 'く', '刃'].map(makeWord), { minContent: 3, tail: '刃' });
  ok(r.valid, `「雷の響く刃」が不成立: ${r.reasonText}`);

  console.log('  読めない文は落ちる / 正しい言い方だけが通る');
}

sec('自然さと完成度で力が決まること');
{
  const P = (tail, ...ws) => evaluate([...ws, tail].map(makeWord), { minContent: 3, tail });
  // 同じ実数 (3 語) でも、自然な文のほうが強い。
  const plain = P('剣', '刃', '必');               // 刃必剣 … 形で始まり羅列
  const bare = P('剣', '焔', '妙');            // 焔妙剣 … 形容が落のまま
  const attr = P('剣', '焔', '妙', 'な');       // 焔妙な剣 … 連体形がある
  const full = P('剣', '焔', 'を', '斬', 'る');  // 焔を斬る剣 … 一文として閉じている
  ok(plain.valid && bare.valid && attr.valid && full.valid, '比較用の文が成立していない');
  ok(bare.fx.power > plain.fx.power,
    `属性で始まらないと強くならない: ${plain.fx.power} -> ${bare.fx.power}`);
  ok(attr.fx.power > bare.fx.power,
    `形容の連体形にしないと強くならない: ${bare.fx.power} -> ${attr.fx.power}`);
  ok(full.fx.power > attr.fx.power,
    `完成した一文のほうが強い: ${attr.fx.power} -> ${full.fx.power}`);

  // 形容の語幹のまま末尾語に置くと減点される。
  ok(bare.naturalParts.some((p) => p.key === 'bareadj'),
    '形容が連体形でない減点が無い');
  ok(!attr.naturalParts.some((p) => p.key === 'bareadj'),
    '「妙な剣」に形容の減点が付いている');

  // 判定の内訳が見える。
  ok(full.naturalParts.some((p) => p.key === 'object'), '目的語が数えられていない');
  ok(full.naturalParts.some((p) => p.key === 'predicated'), '述語が数えられていない');
  ok(plain.naturalParts.some((p) => p.key === 'topicform'), '形で始まる減点が無い');  // 修飾が 4 つ重なると名詞の列になる。
  const list = P('剣', '焔', '妙', 'な', '必', '律', '巨', '撃');
  ok(list.valid, '修飾 4 連結が成立していない');
  ok(list.naturalParts.some((p) => p.key === 'enumeration'), '羅列の減点が無い');
  ok(list.natural < attr.natural,
    `羅列のほうが自然: ${list.natural} vs ${attr.natural}`);

  // 宙に浮く接続詞は文を壊す。結べた形しか作れない。
  const float = P('剣', '焔', 'の', '妙', 'く'); // 妙(な形容) には く が付かない
  ok(!float.valid, `宙に浮く接続詞で成立してしまった: ${float.reasonText}`);
  const bound = P('剣', '焔', 'の', '硬', 'い');
  ok(bound.valid && bound.fx.power > attr.fx.power,
    `結べた接続詞のほうが強い: ${attr.fx.power} -> ${bound.fx.power}`);

  // 述語を置いたあとに残る語が末尾語を修飾しない (ぶら下がる) と減点。
  //   「焔を斬る妙刃」… な形容詞の語幹「妙」では刃を修飾できない。
  //   「焔を斬る硬刃」   … い形容詞の語幹複合は刃を修飾するので減点しない。
  const dangling = P('剣', '焔', 'を', '斬', 'る', '妙');
  ok(dangling.valid, `「焔を斬る妙剣」が不成立: ${dangling.reasonText}`);
  ok(dangling.naturalParts.some((p) => p.key === 'dangling'), '述語のぶら下げ減点が無い');
  const tailmod = P('剣', '焔', 'を', '斬', 'る', '硬');
  ok(tailmod.valid && !tailmod.naturalParts.some((p) => p.key === 'dangling'),
    '末尾語を修飾する語がぶら下がり扱いされた');
  ok(full.fx.power > dangling.fx.power,
    `ぶら下げると強くならない: ${dangling.fx.power} -> ${full.fx.power}`);

  // 評価も自然さで上がる。
  const gradeOf = (r) => r.grade;
  ok(gradeOf(full) === 'great', `完成した一文が絶句にならない: ${full.grade}`);
  ok(gradeOf(attr) === 'idiom', `属性文が名文にならない: ${attr.grade}`);
  ok(gradeOf(plain) === 'plain', `読めない並びが名文以上になった: ${plain.grade}`);

  console.log(`  文の力 「刃必剣」=${plain.fx.power.toFixed(2)}`
    + ` / 「焔妙な剣」=${attr.fx.power.toFixed(2)}`
    + ` / 「焔を斬る剣」=${full.fx.power.toFixed(2)}`);
}

sec('接続詞の規則');
{
  const E2 = (...ws) => evaluate(ws.map((w) => ({ text: w })));

  // 例1 … 接続詞なし。4 つの修飾語 + 末尾語。
  let r = E2('焔', '妙', '貫', '疾', '剣');
  ok(r.valid, `例1 が不成立: ${r.reasonText}`);
  ok(r.compounds.length === 0, `例1 に合成がある: ${r.compounds.map((c) => c.text)}`);
  ok(r.segments.join('/') === '焔/妙/貫/疾/剣', `例1 の分割 ${r.segments.join('/')}`);

  // 例2 … 焔の爆ぜる妙な剛剣。格 → 連体節 → 連体 の順。
  r = E2('焔', 'の', '爆', 'ぜる', '妙', 'な', '剛', '剣');
  ok(r.valid, `例2 が不成立: ${r.reasonText}`);
  ok(r.compounds.map((c) => c.text).join(',') === '焔の,爆ぜる,妙な',
    `例2 の合成 ${r.compounds.map((c) => c.text).join(',')}`);
  ok(r.conn.floats.length === 0, `例2 に宙に浮く接続詞がある: ${r.conn.floats}`);

  // な形容詞の「〜な」は名詞を修飾できる。
  r = E2('焔', 'を', '斬', 'る', '妙', 'な', '剛', '剣');
  ok(r.valid, `な形容詞の連体が成立しない: ${r.reasonText}`);

  // 「巨な刃」は日本語に無い。な形容のなは「巨」には付かない。
  r = E2('焔', 'を', '斬', 'る', '巨', 'な', '剣');
  ok(!r.valid, `「巨な」が成立してしまった: ${r.reasonText}`);

  // 例3 … のが 2 回。日本語として読めるので成立。重複は減点。
  r = E2('風', 'の', '潮', 'の', '銃');
  ok(r.valid, `例3「風の潮の銃」が不成立: ${r.reasonText}`);
  ok(r.naturalParts.some((p) => p.key === 'dupconn'), '例3 に重複の減点が無い');

  // NG2 … 接続詞どうしが直接隣れる (「焔を斬られたの剣」)。
  //   順序 (昇順 / 降順) はどちらも成立する。接続詞の連続だけが壊れる。
  r = E2('焔', 'を', '斬', 'られた', 'の', '剣');
  ok(!r.valid, 'NG2 が成立してしまった');
  ok(r.reason === 'floatconn', `NG2 の理由 ${r.reason}`);
  ok(/「の」/.test(r.reasonText), `NG2 の説明 ${r.reasonText}`);

  // NG3 … その語のプールに無い接続詞。「焔剛された剣」 ✗
  r = E2('焔', '剛', 'された', '剣');
  ok(!r.valid && r.reason === 'floatconn', `NG3 の理由 ${r.reason}`);

  // NG3b … い形容詞に「〜な」は付かない。「速な剣」 ✗
  r = E2('焔', '速', 'な', '剣');
  ok(!r.valid && r.reason === 'floatconn', `NG3b の理由 ${r.reason}`);

  // NG3c … プールに する が無い語には付かない。「焔する剣」 ✗
  r = E2('焔', 'する', '剛', '剣');
  ok(!r.valid && r.reason === 'floatconn', `NG3c の理由 ${r.reason}`);

  // NG3d … 「強つ」は強のプールに無い。 ✗
  r = E2('焔', '強', 'つ', '剛', '剣');
  ok(!r.valid && r.reason === 'floatconn', `NG3d の理由 ${r.reason}`);

  // NG4 … 連用形のあとに名詞。「焔の硬く剣」 ✗
  r = E2('焔', 'の', '硬', 'く', '剣');
  ok(!r.valid && r.reason === 'connnoun', `NG4 の理由 ${r.reason}`);

  // NG5 … 「〜を」のあとに動詞が無い。「焔を剣」 ✗
  r = E2('焔', 'を', '剣');
  ok(!r.valid && r.reason === 'noobject', `NG5 の理由 ${r.reason}`);

  console.log('  例1・例2 成立 / NG1〜NG5 不成立');
}

sec('接続詞の順序 (両方向を許す)');
{
  const E2 = (...ws) => evaluate(ws.map((w) => ({ text: w })));
  // 降順 (格 -> 説明 -> 述語) も成立。
  ok(E2('焔', 'の', '爆', 'ぜる', '剣').valid, 'の -> ぜる が通らない');
  ok(E2('焔', 'の', '燃', 'える', '妙', 'な', '剣').valid, 'の -> える が通らない');
  ok(E2('焔', 'の', '撃', 'つ', '剣').valid, 'の -> つ が通らない');
  ok(E2('焔', 'を', '斬', 'られた', '潮', 'の', '剣').valid, 'られた -> の が通らない');
  // 昇順 (述語 -> 格) も成立。「圧する毒の針」のように自然な並び。
  ok(E2('圧', 'する', '毒', 'の', '針').valid, 'する -> の が通らない');
  ok(E2('爆', 'ぜる', '焔', 'の', '剣').valid, 'ぜる -> の (体言) が通らない');
  // 形容の接続詞 (く・い・な・つ) は日本語では置く場所が自由。
  //   い形容詞の連体は「い」、な形容詞の連体は「な」。
  ok(E2('速', 'い', '焔', 'を', '斬', 'る', '妙', 'な', '剣').valid,
    '「速い…妙な」の形容の連体が通らない');
  ok(!E2('速', 'く', '焔', 'を', '斬', 'る', '妙', 'な', '剣').valid,
    '連用形「速く」のあとに名詞「焔」が通ってしまう');
  ok(E2('焔', 'を', '斬', 'る', '妙', 'な', '剣').valid,
    '「焔を斬る妙な剣」が通らない');
  // 接続詞どうしが直接隣れる並びだけは落ちる (直前の語に結べない = 宙に浮く)。
  ok(!E2('焔', 'する', 'の', '剣').valid, 'するの の連続が通ってしまう');
  // 同じ接続詞の 2 回目は不成立ではなく減点。
  const d2 = E2('火', 'の', '焔', 'の', '弾');
  ok(d2.valid && d2.naturalParts.some((p) => p.key === 'dupconn'), '「火の焔の弾」が減点つきで成立しない');
  ok(d2.natural < E2('火', 'の', '焔', '弾').natural + 0.55, '重複の減点が効いていない');
}

sec('接続詞は文を成立させない');
{
  const E2 = (...ws) => evaluate(ws.map((w) => ({ text: w })));
  let r = E2('の', 'い', 'な');
  ok(!r.valid, '接続詞だけの文が成立している');
  r = E2('火', 'の', 'の');
  ok(!r.valid, '実質語 1 つに接続詞を足しても成立している');
  r = E2('火', 'の', '球');
  ok(r.valid, '「火の球」が不成立');
  ok(r.segments.length === 3, `分割数 ${r.segments.length}`);
  // 合成できたぶんだけ文の力が上がる。
  const short = E2('火', '弾');
  const bound = E2('火', 'の', '弾');
  ok(bound.fx.power > short.fx.power, `文の力: ${short.fx.power} -> ${bound.fx.power}`);
  // 結べない接続詞 (宙に浮く) は文を壊す。「火の斬く弾」 ✗
  const float = E2('火', 'の', '斬', 'く', '弾');
  ok(!float.valid, '宙に浮く接続詞で成立してしまった');
  console.log(`  文の力 「火弾」=${short.fx.power.toFixed(2)} / 「火の弾」=${bound.fx.power.toFixed(2)} / 「火の斬く弾」= 不成文`);
}

sec('文が実際に読める形で作れること');
{
  const E2 = (...ws) => evaluate(ws.map((w) => ({ text: w })));
  const cases = [
    [['力', '刃', '火', '球'], true],
    [['志', '弾', '電', '矢'], true],
    [['火', 'の', '弾', '疾速'], true],
    [['力', '刃', '弾'], true],
    [['力', '弾', '刃'], true],
    [['力', 'の'], false],
    [['力'], false],
  ];
  for (const [ws, want] of cases) {
    const r = E2(...ws);
    ok(r.valid === want, `「${ws.join('')}」valid=${r.valid} (期待 ${want})`);
  }
}

console.log(`\n---- 合格 ${pass} / 不合格 ${fail} ----`);
process.exit(fail ? 1 : 0);
