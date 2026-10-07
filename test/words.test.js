// 語辞書と文判定の単体テスト。  node test/words.test.js
import { WORDS, DRAWABLE, DRAWABLE_ALL, SIMPLE_POOL, CONNECTOR_SET, CONNECTOR_LIST, segment, evaluate, makeWord, drawWord, WORDS_BY_CAT, DUPLICATES, PHRASE_BONUS, CONNECTORS } from '../js/data/words.js';
import { checkConnectors, canConnect, connectorFor, connectorAfter, POS } from '../js/data/words.connect.js';
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
ok(JSON.stringify(segment('爆する')) === JSON.stringify(['爆', 'する']),
  `爆する -> ${JSON.stringify(segment('爆する'))}`);
ok(JSON.stringify(segment('斬された')) === JSON.stringify(['斬', 'された']),
  `斬された -> ${JSON.stringify(segment('斬された'))}`);
ok(JSON.stringify(segment('妙な')) === JSON.stringify(['妙', 'な']),
  `妙な -> ${JSON.stringify(segment('妙な'))}`);
// 「か」のな形容詞の連体形は接続詞 かな。静かな = 静 + かな。
ok(JSON.stringify(segment('静かな')) === JSON.stringify(['静', 'かな']),
  `静かな -> ${JSON.stringify(segment('静かな'))}`);
ok(JSON.stringify(segment('確かな')) === JSON.stringify(['確', 'かな']),
  `確かな -> ${JSON.stringify(segment('確かな'))}`);
ok(JSON.stringify(segment('滑かな')) === JSON.stringify(['滑', 'かな']),
  `滑かな -> ${JSON.stringify(segment('滑かな'))}`);
// 「確か」「静か」「滑らか」を 2 語の辞書項目には置かない。
for (const w of ['静か', '確か', '滑らか', '適切', '確実', '緻密', '妖艶', '華美', '豪快', '良質', '明快', '優美']) {
  ok(!WORDS[w], `「${w}」が辞書にある (1 漢字語 + かなで作るので不要)`);
}
// 「静」は な形容 (〜な) ではない。「静な」は文法で弾く。
// (分割は辞書引きなので「静 + な」が通る。結合の可否で見る。)
ok(!canConnect(WORDS['静'], 'な'), '「静」に「な」が付いてしまう (静な は無い)');
ok(!!WORDS['静'] && canConnect(WORDS['静'], 'かな'), '「静」に「かな」が付かない (静かな が作れない)');
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
  const avail = new Set([...DRAWABLE, ...CONNECTOR_SET]);
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
    if (Math.abs(r.phraseBonus - PHRASE_BONUS_VALUE) > 1e-9) missing++;
  }
  ok(missing === 0, `熟語ボーナスが見えない熟語が ${missing} 個`);
}

sec('動詞の形が使える (する / む / ける)');
{
  const conns = (w) => connectorFor(WORDS[w]);

  // 「〜する」が動詞として通用する語 (察する)。
  ok(conns('察').includes('する'), '「察する」が結べない');
  ok(!conns('焔').includes('する'), '「焔する」が結べている');

  // 「〜む」の終止形・命令形。
  for (const w of ['蝕', '踏', '挟', '掴', '嚇', '沈', '縮', '潜']) {
    ok(conns(w).includes('む'), `「${w}む」が結べない`);
  }
  for (const w of ['斬', '溶', '焼', '響', '凍']) {
    ok(!conns(w).includes('む'), `「${w}む」が結べている（日本語に無い）`);
  }

  // 上一段の「〜ける」。
  for (const w of ['溶', '凍', '融', '焼', '焦', '砕', '潰', '冷']) {
    ok(conns(w).includes('ける'), `「${w}ける」が結べない`);
  }
  for (const w of ['斬', '響', '蝕', '察']) {
    ok(!conns(w).includes('ける'), `「${w}ける」が結べている（日本語に無い）`);
  }

  // 分割と結合の形。
  ok(JSON.stringify(segment('蝕む')) === JSON.stringify(['蝕', 'む']), '蝕む が分割できない');
  ok(JSON.stringify(segment('溶ける')) === JSON.stringify(['溶', 'ける']), '溶ける が分割できない');
  ok(JSON.stringify(segment('察する')) === JSON.stringify(['察', 'する']), '察する が分割できない');

  const E2 = (...ws) => evaluate(ws.map(makeWord), { minContent: 3, tail: ws[ws.length - 1] });
  const good = [
    ['霜', 'を', '蝕', 'む', '刃'],                    // 霜を蝕む刃
    ['踏', 'む', '焔', 'を', '斬', 'る', '刃'],      // 踏む焔を斬る刃
    ['溶', 'ける', '毒', 'を', '斬', 'る', '刃'],    // 溶ける毒を斬る刃
    ['凍', 'ける', '霜', 'を', '斬', 'る', '刃'],    // 凍ける霜を斬る刃
    ['察', 'する', '毒', 'を', '斬', 'る', '刃'],    // 察する毒を斬る刃
    ['潰', 'ける', '毒', 'を', '斬', 'る', '刃'],    // 潰れる毒を斬る刃
  ];
  for (const ws of good) {
    const r = E2(...ws);
    ok(r.valid, `「${ws.join('')}」が不成立: ${r.reasonText}`);
    ok(r.predicated, `「${ws.join('')}」が述語になっていない`);
  }

  const bad = [
    ['焔', 'を', '斬', 'る', '溶', 'む'],            // 溶 + む は結べない (溶む は無い)
    ['焔', 'を', '斬', 'る', '響', 'ける'],          // 響 + ける は結べない
    ['焔', 'を', '斬', 'る', '斬', 'む'],            // 斬 + む は結べない
  ];
  for (const ws of bad) {
    const r = E2(...ws);
    ok(!r.valid, `「${ws.join('')}」が成立してしまった: ${r.reasonText}`);
  }
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

sec('接続詞は品詞で結合が決まること');
{
  const conns = Object.keys(CONNECTORS);
  const content = Object.keys(WORDS).filter((w) => !CONNECTOR_SET.has(w));

  // 全語に品詞がある。品詞が無いと結合を判断できない。
  for (const w of content) {
    ok(!!WORDS[w].pos, `「${w}」に品詞が無い`);
    ok(Object.values(POS).includes(WORDS[w].pos), `「${w}」の品詞が不明: ${WORDS[w].pos}`);
  }

  // 結合できるかどうかは「直前の語」で決まる。品詞の判定に加えて、
  // 語ごとの絞り込みがある。
  //   する … する-名詞にだけ。   焔する ✗ / 爆する ✓
  //   つ   … 付言便乗の語にだけ。 強つい ✗ / 温つい ✓
  for (const w of content) {
    for (const c of conns) {
      const want = connectorFor(WORDS[w]).includes(c);
      const got = canConnect(WORDS[w], c);
      ok(got === want,
        `「${w}」(${WORDS[w].pos}) + 「${c}」→ ${got} (期待 ${want})`);
    }
  }
  ok(!canConnect(WORDS['焔'], 'する'), '「焔する」が結べている');
  ok(canConnect(WORDS['爆'], 'する'), '「爆する」が結べない');
  ok(!canConnect(WORDS['強'], 'つ'), '「強つい」が結べている');
  ok(canConnect(WORDS['温'], 'つ'), '「温つい」が結べない');
  ok(!canConnect({ text: 'の', pos: null }, 'の'), '接続詞どうしで結合できてしまう');
  ok(!canConnect(null, 'の'), '直前の語が無いのに結合できてしまう');

  // 日本語として正しい相性。
  ok(canConnect({ text: '焔', pos: POS.noun }, 'を'), '「焔を」が結べない');
  ok(canConnect({ text: '斬', pos: POS.verb }, 'された'), '「斬された」が結べない');
  ok(canConnect({ text: '強', pos: POS.adj }, 'く'), '「強く」が結べない');
  ok(canConnect({ text: '妙', pos: POS.naadj }, 'な'), '「妙な」が結べない');
  ok(canConnect({ text: '妙', pos: POS.naadj }, 'に'), '「妙に」(妙に) が結べない');
  ok(canConnect({ text: '焔', pos: POS.noun }, 'に'), '「焔に」が結べない');
  // 音響系の用言には く も付く。「響く」= 響く。
  ok(canConnect(WORDS['響'], 'く'), '「響く」が結べない');
  ok(!canConnect(WORDS['斬'], 'く'), '「斬く」が結べている');
  // 日本語として誤った相性。
  // い形容詞と な形容詞 を混ぜない。
  ok(!canConnect({ text: '妙', pos: POS.naadj }, 'された'), '「妙された」が結べている');
  ok(!canConnect({ text: '妙', pos: POS.naadj }, 'い'), '「妙い」が結べている');
  ok(!canConnect({ text: '強', pos: POS.adj }, 'な'), '「強な」が結べている');
  // 「貫く」(つらぬく) は五段の「〜く」。「貫」はする-体言だが く も付く。
  ok(canConnect(WORDS['貫'], 'く'), '「貫く」が結べない');
  ok(canConnect(WORDS['貫'], 'する'), '「貫する」が結べない');
  ok(!canConnect({ text: '焔', pos: POS.noun }, 'く'), '「焔く」が結べている');

  // 「語 + 接続詞」が 1 語に潰れないこと。
  // 潰れると合成語にならない (呪 + い が「呪い」1 語になる例)。
  for (const w of content) {
    for (const c of conns) {
      const segs = segment(w + c);
      ok(segs && segs.length === 2 && segs[0] === w && segs[1] === c,
        `「${w}+${c}」が合成語として分割できない: ${JSON.stringify(segs)}`);
    }
  }
  // 語と接続詞の入れ替えも許さない。
  ok(connectorFor({ text: '焔', pos: POS.noun }).includes('を'), '「焔」に「を」を結べない');
  ok(!connectorFor({ text: 'を' }).includes('焔'), '接続詞に語を結べている');
}

sec('語ごとに付けられる接続詞が全部出ること');
{
  // 鍛冶の候補は CONNECTOR_LIST から引かれる。表がずれると
  // 「結合できるのに UI に出ない」語が生まれるので一致を保つ。
  ok(JSON.stringify(CONNECTOR_LIST.slice().sort()) === JSON.stringify(Object.keys(CONNECTORS).sort()),
    `CONNECTOR_LIST と CONNECTORS が不一致: ${CONNECTOR_LIST} / ${Object.keys(CONNECTORS)}`);

  const has = (w, c) => {
    ok(connectorFor(WORDS[w]).includes(c), `「${w}」+「${c}」が結べない`);
  };
  const hasNot = (w, c) => {
    ok(!connectorFor(WORDS[w]).includes(c), `「${w}」+「${c}」が結べている`);
  };

  // 小さい / 小さく / 大きい / 大きく
  has('小', 'い'); has('小', 'く'); has('大', 'い'); has('大', 'く');
  // 急く / 急い / 急な / 急に
  has('急', 'く'); has('急', 'い'); has('急', 'な'); has('急', 'に');
  // 瞬く / 沸く / 吐く / 穿く / 融く / 散く / 響く
  has('瞬', 'く'); has('沸', 'く'); has('吐', 'く');
  has('穿', 'く'); has('融', 'く'); has('散', 'く'); has('響', 'く');
  // 貫く / 焼く / 叩く / 浮く / 溶く / 跨く / 轟く / 裂く / 砕く
  has('貫', 'く'); has('焼', 'く'); has('叩', 'く'); has('浮', 'く'); has('溶', 'く');
  has('跨', 'く'); has('轟', 'く'); has('裂', 'く'); has('砕', 'く');
  // 呪いは い で名詞になる (呪いの刃)。
  has('呪', 'い'); has('呪', 'の');
  // 回る / 回り / 回す / 回された
  has('回', 'る'); has('回', 'り'); has('回', 'せし'); has('回', 'された');
  // 遠い / 遠く
  has('通', 'い'); has('通', 'く');
  // 冷たい / 冷たく / 冷つい / 重い / 重く / 重つい
  has('冷', 'い'); has('冷', 'く'); has('冷', 'つ');
  has('重', 'い'); has('重', 'く'); has('重', 'つ');
  // 「〜する」が通用する効果語
  has('導', 'する'); has('圧', 'する'); has('律', 'する');
  has('執', 'する'); has('反', 'する'); has('徹', 'する');

  // 品詞の相性は変えない。
  hasNot('斬', 'く');      // 「斬く」は無い
  hasNot('妙', 'い');      // 「妙い」は無い
  // 「Xな」が日本語に無い語には な を結ばない。
  hasNot('静', 'な'); hasNot('剛', 'な'); hasNot('巨', 'な');   // 静な✗ / 剛な✗ / 巨な✗
  hasNot('豪', 'な'); hasNot('精', 'な'); hasNot('滑', 'な');   // 豪な✗ / 精な✗ / 滑な✗
  // 1 漢字で「な」が直接付くのはこの 2 語だけ。
  has('妙', 'な'); has('妙', 'に'); has('急', 'な'); has('急', 'に');
  hasNot('強', 'な');      // 「強な」は無い
  // 2 漢字のな形容詞は辞書に置かない。1 漢字語 + 接続詞 かな で作る。
  for (const w of ['静か', '確か']) {
    ok(!WORDS[w], `「${w}」は接続詞 かな で作る語なので辞書に無い`);
  }
  // かな … 語幹が「〜か」になる な形容詞にだけ付く。
  //   静かな(静か) / 確かな(確か) / 滑かな(滑らか) / 適かな(適切) …
  for (const w of ['静', '確', '滑', '適', '華', '豪', '精', '良', '明', '優', '巧']) {
    has(w, 'かな');
    hasNot(w, 'な');      // 「静な」「確な」は無い。かなで書く。
    ok(!!(WORDS[w].fx && Object.keys(WORDS[w].fx).length), `「${w}」に効果が無い`);
  }
  // 語幹が「〜か」にならない な形容詞には かな が付かない。
  hasNot('強', 'かな'); hasNot('頑', 'かな'); hasNot('神', 'かな');  // 強固 頑強 神速
  hasNot('端', 'かな'); hasNot('冷', 'かな'); hasNot('巨', 'かな');  // 端正 冷徹 巨大
  hasNot('焔', 'かな'); hasNot('刃', 'かな');                        // 「焔か」「刃か」は無い
  hasNot('静', 'く'); hasNot('静', 'い');      // 静は い形容の語幹ではない
  // 「1 漢字語どうしの連結」(華麗 精密 端正) はな形容詞にしない。
  // 置くと「華」「麗」の連結が分割で「華麗」になり、品詞と効果が替わる。
  for (const w of ['華麗', '精密', '端正', '頑強', '神速']) {
    ok(!WORDS[w], `1 漢字語どうしの連結「${w}」が語になっている`);
  }
  hasNot('焔', 'する');    // 「焔する」は無い
  hasNot('巨', 'な');      // な形容詞は「巨大」であって「巨」ではない。「巨な」は無い
  has('巨', 'の'); has('巨', 'に');   // 体言として「巨の刃」「焔を巨に」
  hasNot('強', 'つ');      // 「強つい」は無い
  // 「する」-名詞にも「付言便乗」の無い語には付かない。
  // 品詞が当たっても語ごとの絞り込みで弾く (品詞判定より先に評価する)。
  hasNot('弾', 'つ'); hasNot('刃', 'つ'); hasNot('焔', 'つ');
  hasNot('焔', 'する'); hasNot('刃', 'する'); hasNot('烈', 'する');

  // 文の中でも実際に並べられること。連用形・続用形のあとは動詞か形容が要る。
  const E2 = (...ws) => evaluate(ws.map(makeWord), { minContent: 3, tail: ws[ws.length - 1] });
  const good = [
    ['小', 'い', '焔', 'を', '斬', 'る', '刃'],   // 小さい焔を斬る刃
    ['大', 'い', '焔', 'を', '斬', 'る', '刃'],   // 大きい焔を斬る刃
    ['急', 'く', '斬', 'る', '妙', 'な', '刃'],   // 急く斬る妙な刃
    ['急', 'な', '焔', 'を', '斬', 'る', '刃'],   // 急な焔を斬る刃
    ['急', 'に', '斬', 'る', '妙', 'な', '刃'],   // 急に斬る妙な刃
    ['瞬', 'く', '斬', 'る', '妙', 'な', '刃'],   // 瞬く斬る妙な刃
    ['通', 'い', '焔', 'を', '斬', 'る', '刃'],   // 遠い焔を斬る刃
    ['通', 'く', '斬', 'る', '妙', 'な', '刃'],   // 遠く斬る妙な刃
    ['冷', 'つ', '焔', 'を', '斬', 'る', '刃'],   // 冷つい焔を斬る刃
    ['重', 'い', '焔', 'を', '斬', 'る', '刃'],   // 重い焔を斬る刃
    ['沸', 'く', '斬', 'る', '妙', 'な', '刃'],   // 沸く斬る妙な刃
    ['穿', 'く', '斬', 'る', '妙', 'な', '刃'],   // 穿く斬る妙な刃
    ['融', 'く', '斬', 'る', '妙', 'な', '刃'],   // とかく斬る妙な刃
    ['散', 'く', '斬', 'る', '妙', 'な', '刃'],   // ちかく斬る妙な刃
    ['毒', 'を', '回', 'る', '妙', 'な', '刃'],   // 毒を回る妙な刃
    ['毒', 'を', '回', 'せし', '妙', 'な', '刃'], // 毒を回す妙な刃
    ['毒', 'を', '回', 'り', '妙', 'な', '刃'],   // 毒を回り
    ['導', 'する', '毒', 'を', '斬', 'る', '刃'], // 導する毒を斬る刃
    ['圧', 'する', '毒', 'を', '斬', 'る', '刃'], // 圧する毒を斬る刃
    ['静', 'かな', '焔', 'を', '斬', 'る', '刃'], // 静かな(静か) 焔を斬る刃
    ['確', 'かな', '毒', 'を', '斬', 'る', '刃'], // 確かな(確か) 毒を斬る刃
    ['滑', 'かな', '焔', 'を', '斬', 'る', '刃'], // 滑かな(滑らか) 焔を斬る刃
    ['適', 'かな', '毒', 'を', '斬', 'る', '刃'], // 適かな(適切) 毒を斬る刃
    ['巧', 'かな', '毒', 'を', '斬', 'る', '刃'], // 巧かな(巧妙) 毒を斬る刃
    ['良', 'かな', '焔', 'の', '弾'],            // 良かな(良質) 焔の弾
    ['瞬', 'く', '焔', 'を', '斬', 'る', '刃'],   // 瞬く焔 … 動詞の「〜く」は連体形
    ['貫', 'く', '毒', 'を', '斬', 'る', '刃'],   // 貫く毒を斬る刃
    ['呪', 'い', 'の', '毒', 'を', '斬', 'る', '刃'], // 呪いの毒を斬る刃 … い が名詞を作る
    ['呪', 'い', 'を', '斬', 'る', '刃'],         // 呪いを斬る刃
  ];
  for (const ws of good) {
    const r = E2(...ws);
    ok(r.valid, `「${ws.join('')}」が不成立: ${r.reasonText}`);
  }

  // 連用形「〜く」/ 続用形「〜り」のあとは名詞を置けない (規則 4)。
  const bad = [
    ['急', 'く', '焔', 'を', '斬', 'る', '刃'],   // 急く焔 … い形容の連用形の名詞修飾
    ['回', 'り', '毒', 'の', '弾'],               // 回り毒 … 続用形の名詞修飾
    ['妙', 'に', '刃'],                           // 妙に刃
    ['静', 'かな', 'された', '焔', 'を', '斬', 'る', '刃'], // 静かされた焔 … な形容に「された」は無い
    ['滑', 'かな', 'く', '焔', 'を', '斬', 'る', '刃'],   // 滑かなく焔 … 接続詞どうしの隣接
    ['焔', 'かな', 'を', '斬', 'る', '刃'],            // 焔かなを斬る刃 …「焔か」は無い
    ['強', 'かな', '毒', 'を', '斬', 'る', '刃'],       // 強かな … 「強か」は無い (強固)
  ];
  for (const ws of bad) {
    const r = E2(...ws);
    ok(!r.valid, `「${ws.join('')}」が成立してしまった`);
  }

  // 行き止まりを作らない。接続詞が 1 つも付かない語は無い。
  const dead = Object.entries(WORDS)
    .filter(([t, w]) => w.cat !== 'connect' && connectorFor(w).length === 0)
    .map(([t]) => t);
  ok(dead.length === 0, `接続詞が付かない語がある: ${dead.join(' ')}`);

  console.log(`  ${good.length} 通りの新しい言い方が通り / ${bad.length} 通りは規則で落ちる`);
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
    ['焔', '貫', 'を', '剛', 'された', '刃', '剣'].map(makeWord),
    { minContent: 4, tail: '剣' },
  );
  ok(!r.valid, `「焔貫を剛された刃剣」が成立してしまった: ${r.reasonText}`);

  // 用言・形が末尾語を直接修飾できない。
  r = evaluate(['斬', '剣'].map(makeWord), { minContent: 2, tail: '剣' });
  ok(!r.valid && r.reason === 'tailverb', `「斬剣」の理由 ${r.reason}`);

  r = evaluate(['刃', '剣'].map(makeWord), { minContent: 2, tail: '剣' });
  ok(!r.valid && r.reason === 'tailform', `「刃剣」の理由 ${r.reason}`);

  // 接続詞を挟んでも「刃剣」は日本語に無い。
  r = evaluate(
    ['焔', 'を', '斬', 'された', '刃', '剣'].map(makeWord),
    { minContent: 4, tail: '剣' },
  );
  ok(!r.valid && r.reason === 'tailform',
    `「焔を斬された刃剣」が成立した: ${r.valid}`);

  // 名詞句の頭が属性・効果なら通る。
  r = evaluate(
    ['焔', 'を', '斬', 'された', '剛', '剣'].map(makeWord),
    { minContent: 4, tail: '剣' },
  );
  ok(r.valid, `「焔を斬された剛剣」が不成立: ${r.reasonText}`);

  // 「〜を」は目的語を取る。後ろに動詞 (=動作) が無ければ落ちる。
  r = evaluate(['焔', 'を', '剣'].map(makeWord), { minContent: 2, tail: '剣' });
  ok(!r.valid && r.reason === 'noobject', `「焔を剣」の理由 ${r.reason}`);

  // 動詞のあとに名詞が直接来るものは無い。「焔を斬剣」 ✗ →「斬る剣」 ✓
  r = evaluate(['焔', 'を', '斬', '剣'].map(makeWord), { minContent: 3, tail: '剣' });
  ok(!r.valid, '「焔を斬剣」が成立してしまった');

  // 正しい言い方なら通る。
  r = evaluate(['焔', 'を', '斬', 'る', '剣'].map(makeWord), { minContent: 3, tail: '剣' });
  ok(r.valid, `「焔を斬る剣」が不成立: ${r.reasonText}`);
  r = evaluate(['焔', 'を', '斬', 'された', '剣'].map(makeWord), { minContent: 3, tail: '剣' });
  ok(r.valid, `「焔を斬された剣」が不成立: ${r.reasonText}`);

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

  r = evaluate(['焔', 'の', '斬', 'された', '剣'].map(makeWord), { minContent: 3, tail: '剣' });
  ok(r.valid, `「焔の斬された剣」が不成立: ${r.reasonText}`);

  // 属性語を頭に置くと、主題が立って最も自然。
  r = evaluate(['青', '焔', 'を', '斬', 'された', '刃'].map(makeWord),
    { minContent: 3, tail: '刃' });
  ok(r.valid, `「青焔を斬された刃」が不成立: ${r.reasonText}`);
  ok(r.naturalParts.some((p) => p.key === 'topic'), '属性で始まる文に主題の加点が無い');

  // 連用形「〜に」(妙に) のあとに名詞は来ない。格の「〜に」と区別する。
  r = evaluate(['焔', 'の', '妙', 'に', '剣'].map(makeWord), { minContent: 3, tail: '剣' });
  ok(!r.valid && r.reason === 'connnoun', `「焔の妙に剣」の理由 ${r.reason}`);
  r = evaluate(['焔', 'に', '妙', 'に', '斬', 'る', '剣'].map(makeWord), { minContent: 3, tail: '剣' });
  ok(!r.valid, 'には 1 回まで');
  r = evaluate(['妙', 'に', '斬', 'る', '剣'].map(makeWord), { minContent: 2, tail: '剣' });
  ok(r.valid, `「妙に斬る剣」が不成立: ${r.reasonText}`);

  // 音響系の連用。「響く」は副詞として動詞を修飾する。名詞は修飾しない。
  r = evaluate(['雷', 'の', '響', 'く', '斬', 'る', '刃'].map(makeWord), { minContent: 3, tail: '刃' });
  ok(r.valid, `「雷の響く斬る刃」が不成立: ${r.reasonText}`);
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
  const list = P('剣', '焔', '妙', 'な', '必', '貫', '巨', '侵');
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

  // 例2 … 焔の爆する妙な剛剣。格 → 説明 → 連体 の順。
  r = E2('焔', 'の', '爆', 'する', '妙', 'な', '剛', '剣');
  ok(r.valid, `例2 が不成立: ${r.reasonText}`);
  ok(r.compounds.map((c) => c.text).join(',') === '焔の,爆する,妙な',
    `例2 の合成 ${r.compounds.map((c) => c.text).join(',')}`);
  ok(r.conn.floats.length === 0, `例2 に宙に浮く接続詞がある: ${r.conn.floats}`);

  // な形容詞の「〜な」は名詞を修飾できる。
  r = E2('焔', 'を', '斬', 'る', '妙', 'な', '剛', '剣');
  ok(r.valid, `な形容詞の連体が成立しない: ${r.reasonText}`);

  // 「巨な刃」は日本語に無い。な形容のなは「巨」には付かない。
  r = E2('焔', 'を', '斬', 'る', '巨', 'な', '剣');
  ok(!r.valid, `「巨な」が成立してしまった: ${r.reasonText}`);

  // NG1 … のが 2 回。
  r = E2('風', 'の', '潮', 'の', '銃');
  ok(!r.valid, 'NG1 が成立してしまった');
  ok(r.reason === 'dupconn', `NG1 の理由 ${r.reason}`);

  // NG2 … 接続詞どうしが直接隣れる (「焔を斬されたの剣」)。
  //   順序 (昇順 / 降順) はどちらも成立する。接続詞の連続だけが壊れる。
  r = E2('焔', 'を', '斬', 'された', 'の', '剣');
  ok(!r.valid, 'NG2 が成立してしまった');
  ok(r.reason === 'floatconn', `NG2 の理由 ${r.reason}`);
  ok(/された|の/.test(r.reasonText), `NG2 の説明 ${r.reasonText}`);

  // NG3 … 用言に付かない接続詞。「焔剛された剣」 ✗
  r = E2('焔', '剛', 'された', '剣');
  ok(!r.valid && r.reason === 'floatconn', `NG3 の理由 ${r.reason}`);

  // NG3b … い形容詞に「〜な」は付かない。「速な剣」 ✗
  r = E2('焔', '速', 'な', '剣');
  ok(!r.valid && r.reason === 'floatconn', `NG3b の理由 ${r.reason}`);

  // NG3c … する-名詞でない語に「する」は付かない。「焔する剣」 ✗
  r = E2('焔', 'する', '剛', '剣');
  ok(!r.valid && r.reason === 'floatconn', `NG3c の理由 ${r.reason}`);

  // NG3d … 付言便乗の語だけに「つ」は付く。「強つい」 ✗
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
  ok(E2('焔', 'の', '爆', 'する', '剣').valid, 'の -> する が通らない');
  ok(E2('焔', 'の', '燃', 'せし', '妙', 'な', '剣').valid, 'の -> せし が通らない');
  ok(E2('焔', 'の', '温', 'つ', '剣').valid, 'の -> つ が通らない');
  ok(E2('焔', 'を', '斬', 'された', '潮', 'の', '剣').valid, 'された -> の が通らない');
  // 昇順 (述語 -> 格) も成立。「侵蝕する毒の針」のように自然な並び。
  ok(E2('侵', 'する', '毒', 'の', '針').valid, 'する -> の が通らない');
  ok(E2('爆', 'する', '焔', 'の', '剣').valid, 'する -> の (体言) が通らない');
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
  // 同じ接続詞の 2 回目はすべて脱落。
  for (const conn of Object.keys(CONNECTORS)) {
    ok(!E2('火', conn, '焔', conn, '弾').valid, `接続詞「${conn}」の 2 回目が通ってしまう`);
  }
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
