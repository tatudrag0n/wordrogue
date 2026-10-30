// 部位強化メニューのテスト。      node test/grow.menu.test.js
//
// 部位は **言葉鍛冶と同じ 1 文**。10 文字まで、語の数に上限はない。
// 操作も鍛冶と同じ土台 (senpad.js) なので、タップで選ぶ・行をタップで置く・
// ドラッグで並べ替える・接続詞の一覧から選ぶ・戻す、をここで通す。
// ブラウザ実機 (browser.test.js) が無い環境でも「取り外せない」「接続詞が選べない」
// 「10 文字を超える」に戻らないための守衛。
import { installMiniDom, pointer, centerOf } from './minidom.mjs';

// Menus は import 時に document を触るので、グローバルを先に差し替える。
const dom = installMiniDom();

const { Menus } = await import('../js/ui/menus.js');
const { Save, PARTS, PART_MAX_LEN } = await import('../js/core/save.js');
const { evaluatePart, partConnChoices, partCanSetConn, partWordForms } = await import('../js/game/parts.js');
const { resolvePlayerStats, partEffectRows, partTotalRows, isPartUsable } = await import('../js/game/stats.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const sec = (t) => console.log(`\n== ${t} ==`);

// ── メニューが要求する DOM をぜんぶ作る ──────────────────────────────────
const IDS = [
  'title', 'stages', 'stageList', 'loadout', 'loadoutList', 'loadoutCount', 'loadoutGo',
  'loadoutTitle', 'loadoutSub', 'result', 'resultStats', 'resultTitle', 'resultSub',
  'resultNext', 'resultRetry', 'resultStages', 'howto', 'settings',
  'dict', 'dictSearch', 'dictTabs', 'dictList', 'dictCount',
  'words', 'wordsInk',
  'grow', 'growInk', 'gachaBtn', 'gachaTenBtn', 'gachaResult', 'growParts', 'growSelNote', 'growWords',
  'growWordsNote', 'btnGrowUndo',
  'deckWords', 'deckCount',
  'btnStart', 'btnStages', 'btnHowto', 'btnGrow', 'btnWords', 'btnDict', 'btnSettings',
  'recBest', 'recClear', 'recKills', 'recRuns', 'recBroken',
  // 初回の説明 (js/ui/tips.js)。実画面では index.html の #tabHelp。
  'tabHelp', 'tabHelpTitle', 'tabHelpLead', 'tabHelpBody', 'tabHelpClose', 'tabHelpOk',
];
for (const id of [...IDS, 'growTotal']) {
  const e = dom.doc.createElement('div');
  e.setAttribute('id', id);
  dom.doc.body.append(e);
}

const save = new Save();
save.reset();
// テストを決定的にする。語は抽選に頼らず入れる。
save.data.collection = ['妙', '骨', '癒', '磁', '力', '強', '斬', '炎', '弾'];
save.data.parts = {};
for (const p of PARTS) save.data.parts[p.id] = [];
// 十連用の幕を置いてから Menus を生成し、実画面と同じ要素を取得させる。
const set = (id, tag = 'div') => {
  const e = dom.doc.createElement(tag);
  e.setAttribute('id', id);
  return e;
};
const veil = set('gachaVeil');
veil.hidden = true;
const reels = set('gachaReels');
for (let i = 0; i < 3; i++) reels.append(dom.doc.createElement('span'));
const card = set('gachaCard');
for (const id of ['gachaWord', 'gachaCat', 'gachaEff', 'gachaSeal', 'gachaNew', 'gachaLotList']) card.append(set(id));
veil.append(reels, card);
for (const id of ['gachaNote', 'gachaAgain', 'gachaClose', 'gachaX']) veil.append(set(id, 'button'));
dom.doc.body.append(veil);

// #tabHelp は最初は伏せておく (HTML の hidden と同じ)。
dom.doc.getElementById('tabHelp').hidden = true;
// 各タブ右上の「?」。実画面では index.html の [data-help]。
const helpBtn = set('fakeGrowHelp', 'button');
helpBtn.dataset.help = 'grow';
dom.doc.body.append(helpBtn);

const menu = new Menus({ save, audio: null });
menu.show('grow');

const q = (sel, root = dom.doc) => [...root.querySelectorAll(sel)];
const partsBox = () => q('#growParts .grow-part');
const nameOf = (id) => PARTS.find((p) => p.id === id).name;
/** 部位のコマ (毎回選び直す — 再描画でノードが入れ替わる) */
const boxOf = (id) => partsBox().find((b) => b.querySelector('.grow-part-name').textContent === nameOf(id));
const rowOf = (id) => boxOf(id).querySelector('.sen-row');
const chipsOf = (id) => q('.sen-word', boxOf(id));
const wordsBox = () => q('#growWords .grow-word');
const wordBtn = (t) => wordsBox().find((b) => b.textContent.trim().startsWith(t));
const click = (node) => node.dispatchEvent({ type: 'click' });
/** タップ (pointerdown → pointerup)。鍛冶と同じ経路を通す。 */
const tap = (node) => {
  if (!node) throw new Error('tap: ノードが無い');
  const c = centerOf(node);
  node.dispatchEvent(pointer('pointerdown', c.x, c.y));
  node.dispatchEvent(pointer('pointerup', c.x, c.y));
};
/** ドラッグ (pointerdown → move → up)。ドラッグ直後のタップ抑止が解けるまで待つ。 */
const dragTo = async (node, target) => {
  const a = centerOf(node);
  const b = centerOf(target);
  node.dispatchEvent(pointer('pointerdown', a.x, a.y));
  dom.win.dispatchEvent(pointer('pointermove', b.x, b.y));
  dom.win.dispatchEvent(pointer('pointerup', b.x, b.y));
  await new Promise((r) => setTimeout(r, 0));
};
/** 所持語を選んで部位の行へ置く (タップ操作)。 */
const place = (partId, text) => {
  tap(wordBtn(text));
  tap(rowOf(partId));
};

// 説明は初めて開いたときだけ。以後は「?」から開き直す。
sec('タブの説明は初回だけ出す (2 回目は「?」から)');
{
  const help = dom.doc.getElementById('tabHelp');
  ok(!help.hidden, '初めて開いたのに説明が出ない');
  ok(/強化/.test(dom.doc.getElementById('tabHelpTitle').textContent), '説明の見出しが違う');
  ok(q('#tabHelpBody li').length >= 2, '説明の項目が無い');
  ok(save.seenTip('grow'), '見た記録が残らない');

  menu.tips.close();
  ok(help.hidden, '説明が閉じない');

  menu.show('grow');
  ok(help.hidden, '2 回目にも説明が出る (タブが説明で埋まる)');

  helpBtn.dispatchEvent({ type: 'click' });
  ok(!help.hidden, '「?」から説明を開き直せない');
  menu.tips.close();
  console.log('  初回だけ表示 / 閉じる / 2 回目は出ない / 「?」で開き直せる');
}

// 十連の結果表示は実際の click ハンドラーから検証する。
sec('十連ボタンで10件を抽選し、結果一覧を開示する');
{
  save.addInk(1000);
  menu.renderGrow();
  click(dom.doc.getElementById('gachaTenBtn'));
  ok(menu._lastGacha?.results?.length === 10, `十連結果数: ${menu._lastGacha?.results?.length}`);
  ok(!veil.hidden && menu._gachaSpinning, '十連の演出幕が開かない');
  menu._clearGachaTimers();
  menu._finishGacha(menu._lastGacha, true);
  menu._clearGachaTimers();
  menu._revealGacha(menu._lastGacha);
  ok(!dom.doc.getElementById('gachaLotList').hidden, '十連一覧が表示されない');
  ok(q('.gacha-lot-item', dom.doc.getElementById('gachaLotList')).length === 10,
    `十連の表示行が10件でない: ${q('.gacha-lot-item', dom.doc.getElementById('gachaLotList')).length}`);
  menu.closeGacha();
  save.data.ink = 1;
  menu.renderGrow();
  click(dom.doc.getElementById('gachaTenBtn'));
  ok(menu._lastGacha?.results?.length === 10, '不足表示テスト前に十連結果が無い');
  ok(/250/.test(dom.doc.getElementById('gachaResult').textContent), '不足時に必要言玉が表示されない');
  ok(save.ink === 1, '不足状態で言玉が減った');
  save.data.ink = 1000;
  menu.closeGacha();
  console.log('  クリック → 10回抽選 → 10行表示 / 言玉不足は無消費で必要額を表示');
}

sec('7 部位が縦に並び、どの部位も 10 文字の 1 文');
{
  const parts = partsBox();
  ok(parts.length === 7, `部位のコマが ${parts.length} 個`);
  for (const b of parts) {
    ok(q('.sen-row', b).length === 1, '部位に文の行が無い');
    ok(/0 \/ 10 文字/.test(b.textContent), `文字数の表示が 10 文字でない: ${b.textContent.slice(0, 40)}`);
    ok(!!q('.grow-part-clear', b)[0], '「空にする」が無い');
  }
  ok(PART_MAX_LEN === 10, `部位の上限が ${PART_MAX_LEN} 文字`);
  // 並びは縦 1 列 (人型配置ではない)。
  ok(parts.every((b) => b.parentNode === dom.doc.getElementById('growParts')), '部位が 1 列に並んでいない');
  // 所持語は「体に効く語」だけを出す。武器の文で使う語 (炎・弾) は隠す。
  const usable = save.collection.filter((t) => isPartUsable(t));
  ok(wordsBox().length === usable.length,
    `所持語が体に効く語だけになっていない: ${wordsBox().length} / ${usable.length}`);
  ok(!wordsBox().some((b) => /^(炎|弾)$/.test(b.textContent.trim())), '武器の文で使う語が出ている');
  ok(/隠している/.test(dom.doc.getElementById('growWordsNote').textContent), '隠した語の説明が出ない');
  console.log(`  部位 ${parts.length} / 上限 ${PART_MAX_LEN} 文字 / 所持語 ${wordsBox().length} / 隠した ${save.collection.length - usable.length}`);
}

sec('所持語をタップして選び、部位の行をタップで置く。行の語をタップで接続詞が回る');
{
  tap(wordBtn('妙'));
  ok(q('#growWords .grow-word.sel').length === 1, '選んだ語が sel にならない');
  ok(/妙/.test(dom.doc.getElementById('growSelNote').textContent), '選択中の説明が出ない');

  tap(rowOf('head'));
  ok(save.partRaw('head')[0]?.text === '妙', `行のタップで入らない: ${JSON.stringify(save.partRaw('head'))}`);
  ok(chipsOf('head').length === 1, '語のチップが出ない');
  ok(/1 \/ 10 文字/.test(boxOf('head').textContent), '文字数が増えない');
  ok(!dom.doc.getElementById('btnGrowUndo').disabled, '戻すが押せない');

  // 語のチップをタップ → 接続詞が 1 つ進む (その語の送り仮名だけ)。
  const before = save.partRaw('head')[0].conn;
  tap(chipsOf('head')[0]);
  const after = save.partRaw('head')[0].conn;
  ok(after && after !== before, `語のタップで接続詞が回らない: ${before} -> ${after}`);
  ok(partWordForms('妙').includes(after), `語の送り仮名でない接続詞になった: ${after}`);

  // 戻す (直前の接続詞の切り替えを戻す)。
  click(dom.doc.getElementById('btnGrowUndo'));
  ok(save.partRaw('head')[0]?.conn === before, '「戻す」で接続詞が戻らない');

  // 選んだ語をもう一度押すと選択が外れる。
  tap(wordBtn('妙'));
  ok(q('#growWords .grow-word.sel').length === 1, '語をもう一度選べない');
  tap(wordBtn('妙'));
  ok(q('#growWords .grow-word.sel').length === 0, '選んだ語をもう一度押しても外れない');

  // 一覧のスクロール位置は描き直しても保つ。ここが 0 に戻ると、
  // 下のほうの語を選ぶたびに先頭へ跳ねて使えなくなる。
  const box = dom.doc.getElementById('growWords');
  box.scrollTop = 120;
  tap(wordBtn('妙'));
  ok(box.scrollTop === 120, `語を選ぶと一覧が先頭へ戻る: ${box.scrollTop}`);
  tap(wordBtn('妙'));
  ok(box.scrollTop === 120, `語の選択を外すと一覧が先頭へ戻る: ${box.scrollTop}`);
  box.scrollTop = 0;
  console.log(`  選ぶ → 行 → 入る / 語タップで接続詞 ${before || 'なし'} → ${after} / 戻すで復帰 / スクロール位置を保持`);
}

sec('ドラッグで置く・並べ替える・別の部位へ移す・所持語へ戻す');
{
  // 所持語 → 部位の行 (落とした位置に入る)。
  await dragTo(wordBtn('骨'), rowOf('head'));
  ok(save.partRaw('head').some((e) => e.text === '骨'), `ドラッグで入らない: ${JSON.stringify(save.partRaw('head'))}`);
  // 行の後ろ半分へ落とすと、語の後ろに入る。
  const chips = chipsOf('head');
  ok(chips.length >= 2, `2 語目が入っていない: ${chips.length}`);
  const beforeText = save.partRaw('head').map((e) => e.text).join('');
  // 先頭の語を語彙へ戻す → 残りが前へ詰まる。
  await dragTo(chipsOf('head')[0], dom.doc.getElementById('growWords'));
  ok(save.partRaw('head').map((e) => e.text).join('') === beforeText.slice(1),
    `所持語へ戻せない: ${JSON.stringify(save.partRaw('head'))}`);
  // 部位どうしの移動。
  const moved = save.partRaw('head')[0]?.text;
  await dragTo(chipsOf('head')[0], rowOf('chst'));
  ok(save.partRaw('chst').some((e) => e.text === moved) && !save.partRaw('head').length,
    `別の部位へ移せない: 頭 ${JSON.stringify(save.partRaw('head'))} / 胸 ${JSON.stringify(save.partRaw('chst'))}`);
  // 空にする。
  click(q('.grow-part-clear', boxOf('chst'))[0]);
  ok(save.partRaw('chst').filter(Boolean).length === 0, '空にできない');
  console.log(`  ${beforeText} → 戻す → ${moved} を胸へ → 空にする`);
}

sec('文は 10 文字まで。語の数に上限はない');
{
  save.partClear('lfot');
  // 1 文字の語を 10 個並べる。11 個目 (11 文字目) は入らない。
  const one = save.collection.filter((t) => t.length === 1 && isPartUsable(t));
  ok(one.length > 0, '1 文字の語が 1 つも無い');
  let n = 0;
  while (n < PART_MAX_LEN) {
    if (!save.partInsert('lfot', save.partRaw('lfot').length, one[0]).ok) break;
    n++;
  }
  const len = save.partRaw('lfot').reduce((a, e) => a + e.text.length + (e.conn ? e.conn.length : 0), 0);
  ok(len === PART_MAX_LEN, `10 文字まで並べられない: ${len}`);
  const extra = save.partInsert('lfot', 0, one[0]);
  ok(extra.ok === false && extra.reason === 'len', `11 文字目が入ってしまう: ${JSON.stringify(extra)}`);
  ok(save.partRaw('lfot').length === PART_MAX_LEN, `語の数に上限がある: ${save.partRaw('lfot').length} 語`);
  ok(partConnChoices(save.partRaw('lfot'), 0).length >= 0, '長い並びで接続詞の候補が壊れる');
  // 画面: 文字数が 10 / 10 になり、それ以上は理由つきで断る。
  menu.renderGrow();
  ok(/10 \/ 10 文字/.test(boxOf('lfot').textContent), '画面の文字数が 10 / 10 でない');
  tap(wordBtn('癒'));
  tap(rowOf('lfot'));
  ok(/10 文字まで/.test(dom.doc.getElementById('growSelNote').textContent),
    `入らない理由が出ない: ${dom.doc.getElementById('growSelNote').textContent}`);
  save.partClear('lfot');
  console.log(`  ${n} 語で 10 文字 / 11 語目は理由つきで拒否 / 10 語以上並べられる`);
}

sec('接続詞の一覧は、その語の送り仮名だけ (戦闘中の文と同じ)');
{
  // 癒 (プール: す / える / して / えて) に、ほかの語の送り仮名は付かない。
  const words = [{ text: '癒', conn: null }];
  const all = partConnChoices(words, 0);
  ok(all.length === partWordForms('癒').length,
    `候補が語の送り仮名に限られていない: ${all.map((c) => c.text)}`);
  ok(!all.some((c) => c.text === 'の'), '癒 に の が出ている');
  ok(partCanSetConn(words, 0, 'の') === false, '癒 に の を付けられてしまう');
  ok(partCanSetConn(words, 0, 'す') === true, '癒 に す を付けられない');

  // 付けられない形はセーブにも入らない (構造として弾く)。
  save.partClear('head');
  save.partInsert('head', 0, '癒');
  save.setPartConn('head', 0, 'の');
  ok(save.partRaw('head')[0].conn !== 'の', '付けられない形がセーブに入った');

  // 画面: 接続詞のマスをタップすると、鍛冶と同じ一覧 (body の .conn-picker) が開く。
  menu.renderGrow();
  tap(q('.sen-conn', boxOf('head'))[0]);
  const menuEl = q('.conn-picker')[0];
  ok(!!menuEl, '接続詞の一覧が開かない');
  const picks = q('.conn-pick', menuEl).map((x) => x.textContent.trim());
  ok(picks[0] === 'なし', `先頭がなしでない: ${picks}`);
  ok(picks.slice(1).every((t) => partWordForms('癒').includes(t)),
    `語の送り仮名でない候補が出ている: ${picks}`);
  ok(picks.length === partWordForms('癒').length + 1, `候補数が違う: ${picks}`);
  // 「す」(癒す) を選ぶと文が成る。
  click(q('.conn-pick', menuEl).find((x) => x.textContent.trim() === 'す'));
  ok(save.partRaw('head')[0].conn === 'す', `接続詞がセーブに入らない: ${JSON.stringify(save.partRaw('head'))}`);
  ok(!q('.conn-picker').length, '接続詞を選んでも一覧が閉じない');
  const p = evaluatePart(save.partRaw('head').filter(Boolean));
  ok(p.valid && p.text === '癒す', `部位の文が読めない: ${p.text} / ${p.reasonText}`);
  ok(/癒す/.test(boxOf('head').textContent), '文の評価が更新されない');
  console.log(`  癒 の候補 ${picks.join(' ')} / 「${p.text}」 文の力 ${p.power.toFixed(2)}`);
}

sec('部位の文は能力に乗り、不成文は何も乗せない');
{
  const save2 = new Save();
  save2.reset();
  save2.data.collection = ['癒', '骨', '妙'];
  save2.data.parts = {};
  for (const p of PARTS) save2.data.parts[p.id] = [];
  save2.setPart('chst', 0, '癒');
  save2.setPart('chst', 1, '骨');
  save2.setPart('head', 0, '妙');
  const rows = resolvePlayerStats(save2.partEntries(), {});
  ok(rows.partCount === 3, `部位の語を数えていない: ${rows.partCount}`);
  ok(rows.partRows.length === 2, `文の行が ${rows.partRows.length} 件`);
  const chst = rows.partRows.find((r) => r.name === '胸');
  ok(chst && chst.text === '癒骨' && chst.gain > 1, `2 語の文の力が乗らない: ${JSON.stringify(chst)}`);
  const one = rows.partRows.find((r) => r.name === '頭');
  ok(one && Math.abs(one.gain - 1) < 0.001, `1 語の倍率が ${one?.gain}`);
  console.log(`  胸「${chst.text}」 ×${chst.gain.toFixed(2)} / 頭「${one.text}」 ×${one.gain.toFixed(2)}`);
}

sec('部位の効きが数字で出る (何がどれだけ変わるか)');
{
  save.partClear('chst');
  save.partInsert('chst', 0, '癒');
  save.partInsert('chst', 1, '骨');
  menu.renderGrow();
  const rows = partEffectRows(save.partEntries(), 'chst');
  ok(Array.isArray(rows), 'partEffectRows が配列を返さない');
  const total = partTotalRows(save.partEntries());
  ok(total.length > 0, `部位の合計が出ない: ${JSON.stringify(total)}`);
  const hp = total.find((r) => r.key === 'maxHp');
  ok(hp && /^\+\d+$/.test(hp.text), `合計の体力が数値で出ない: ${JSON.stringify(hp)}`);

  const totalEl = q('#growTotal')[0] || dom.doc.getElementById('growTotal');
  ok(/部位の合計/.test(totalEl.textContent), '合計の見出しが出ない');
  ok(q('.eff', totalEl).length > 0, '合計の効果チップが出ない');
  ok(q('.grow-part-eff .eff', boxOf('chst')).length > 0, '部位ごとの効果チップが出ない');
  console.log(`  合計 ${q('.eff', totalEl).map((x) => x.textContent).join(' ')}`);
}

sec('武器の文で使う語は一覧に出さず、意味の効く部位は語を示す');
{
  ok(!wordsBox().some((x) => x.textContent.trim().startsWith('炎')), '武器の文で使う語が一覧に出ている');
  ok(!wordsBox().some((x) => x.textContent.trim().startsWith('弾')), '武器の文で使う語が一覧に出ている');

  // 速 は体に直接は効かないが、足で意味が効く。一覧に出て、効く部位が出る。
  if (!save.ownsWord('速')) save.data.collection.push('速');
  menu.renderGrow();
  const w = wordBtn('速');
  ok(!!w, '所持語に「速」が無い');
  ok(/足/.test(w.textContent), `効く部位が語に出ていない: ${w.textContent}`);
  tap(w);
  ok(/足/.test(dom.doc.getElementById('growSelNote').textContent), '効く部位の説明が出ない');
  tap(rowOf('lfot'));
  ok(q('.grow-part-eff .eff', boxOf('lfot')).length > 0, '速い足の効果が出ない');
  tap(wordBtn('速'));   // 選択解除
  console.log('  速 → 効く部位つきで表示 / 足に入れて効果が出る');
}

sec('恒久強化は無い。語彙の枠は頭の賢い語から');
{
  ok(typeof menu.renderArchive === 'undefined', '恒久強化の描画が残っている');
  ok(q('.up-row').length === 0 && q('.up-buy').length === 0, '恒久強化の行が描かれている');

  save.partClear('head');
  if (!save.ownsWord('賢')) save.data.collection.push('賢');
  menu.renderGrow();
  const before = resolvePlayerStats(save.partEntries()).lexicon;
  place('head', '賢');
  const after = resolvePlayerStats(save.partEntries()).lexicon;
  ok(after > before, `賢い頭で語彙が広がらない: ${before} -> ${after}`);

  const totalEl = dom.doc.getElementById('growTotal');
  ok(q('.eff', totalEl).some((x) => /語彙/.test(x.textContent)), '合計に語彙が出ない');
  console.log(`  頭「賢」→ 語彙 +${after} 枠 / 合計 ${q('.eff', totalEl).map((x) => x.textContent.replace(/\s+/g, '')).join(' ')}`);
}

console.log(`\n---- 合格 ${pass} / 不合格 ${fail} ----`);
process.exit(fail ? 1 : 0);
