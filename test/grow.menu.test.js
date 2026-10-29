// 部位強化メニューのテスト。      node test/grow.menu.test.js
//
// 部位は 1 文 (2 語まで + 接続詞)。語を置いて・外して・接続詞を選ぶまでを、
// 最小 DOM 上で Menus クラスごと通す。ブラウザ実機 (browser.test.js) が無い環境でも
// 「取り外せない」「接続詞が選べない」に戻らないための守衛。
import { installMiniDom } from './minidom.mjs';

// Menus は import 時に document を触るので、グローバルを先に差し替える。
const dom = installMiniDom();

const { Menus } = await import('../js/ui/menus.js');
const { Save, PARTS, PART_SLOTS } = await import('../js/core/save.js');
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
  'growWordsNote',
  'deckWords', 'deckCount',
  'btnStart', 'btnStages', 'btnHowto', 'btnGrow', 'btnWords', 'btnDict', 'btnSettings',
  'recBest', 'recClear', 'recKills', 'recRuns', 'recBroken',
];
for (const id of [...IDS, 'growTotal']) {
  const e = dom.doc.createElement('div');
  e.setAttribute('id', id);
  dom.doc.body.append(e);
}

const save = new Save();
save.reset();
// テストを決定的にする。語は抽選に頼まず入れる。
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

const menu = new Menus({ save, audio: null });
menu.show('grow');

const q = (sel, root = dom.doc) => [...root.querySelectorAll(sel)];
const partsBox = () => q('#growParts .grow-part');
const nameOf = (id) => PARTS.find((p) => p.id === id).name;
/** 部位のコマ (毎回選び直す — 再描画でノードが入れ替わる) */
const boxOf = (id) => partsBox().find((b) => b.querySelector('.grow-part-name').textContent === nameOf(id));
const wordsBox = () => q('#growWords .grow-word');
const click = (node) => node.dispatchEvent({ type: 'click' });

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

sec('部位が 7 コマ出て、各コマに枠が PART_SLOTS 個ある');
{
  const parts = partsBox();
  ok(parts.length === 7, `部位のコマが ${parts.length} 個`);
  for (const b of parts) {
    const cells = q('.grow-slot', b);
    ok(cells.length === PART_SLOTS, `枠の数が ${cells.length}`);
    ok(q('.grow-part-note.empty', b).length === 1, '空の部位の説明が出ていない');
  }
  // 所持語は「体に効く語」だけを出す。武器の文で使う語 (炎・弾) は隠す。
  const usable = save.collection.filter((t) => isPartUsable(t));
  ok(wordsBox().length === usable.length,
    `所持語が体に効く語だけになっていない: ${wordsBox().length} / ${usable.length}`);
  ok(wordsBox().length < save.collection.length, '武器の文で使う語まで出ている');
  ok(!wordsBox().some((b) => /^(炎|弾)$/.test(b.textContent.trim())), '武器の文で使う語が出ている');
  const noteEl = dom.doc.getElementById('growWordsNote');
  ok(noteEl && /隠している/.test(noteEl.textContent),
    `隠した語の説明が出ない: ${noteEl && noteEl.textContent}`);
  console.log(`  部位 ${parts.length} / 枠 ${PART_SLOTS} / 所持語 ${wordsBox().length} / 隠した ${save.collection.length - usable.length}`);
}

sec('語を選んで枠を押し → 入る。もう一度押すと外れる');
{
  const word = wordsBox().find((b) => b.textContent.trim().startsWith('妙'));
  ok(!!word, '所持語に「妙」が無い');
  click(word);
  ok(q('#growWords .grow-word.sel').length === 1, '選んだ語が sel にならない');
  ok(/妙/.test(dom.doc.getElementById('growSelNote').textContent), '選択中の変化が説明に出ない');

  const gap = q('.grow-slot.empty', boxOf('head'))[0];
  click(gap);
  ok(save.partSlotText('head', 0) === '妙', '枠に入れてもセーブに入らない');
  ok(q('.gs-word', boxOf('head')).length === 1, '語のチップが出ない');
  ok(!!q('.gs-out', boxOf('head'))[0], '✕ が出ていない (取り外せない不具合)');

  // 選んだ語が入っている枠の語を押す = 外す。
  click(q('.gs-word', boxOf('head'))[0]);
  ok(!save.partSlot('head', 0), '同じ語を押しても外れない (取り外せない不具合)');

  // 語の選択もトグル (押すと外れる) — 押せるものだけが選べる状態になる。
  click(wordsBox().find((b) => b.textContent.trim().startsWith('妙')));
  ok(q('#growWords .grow-word.sel').length === 0, '選んだ語をもう一度押しても外れない');

  // 枠の ✕ でも外れる。
  click(wordsBox().find((b) => b.textContent.trim().startsWith('癒')));
  click(q('.grow-slot.empty', boxOf('head'))[0]);
  ok(save.partSlotText('head', 0) === '癒', '別の語を枠に押し直して入れない');
  const growWords = dom.doc.getElementById('growWords');
  ok(q('.grow-word-used', growWords).length >= 1,
    `所持語に「部位に入っている」目印が無い: ${save.partWordList().join('')} / ${q('.grow-word', growWords).length} chips`);
  click(q('.gs-out', boxOf('head'))[0]);
  ok(!save.partSlot('head', 0), '✕ で外れない');
  console.log('  選ぶ → 枠 → 入る → 同じ語でもう一度 → 外れる → ✕ でも外れる');
}

sec('部位の 2 語は 1 文。接続詞の一覧が枠の下に出る');
{
  const set = (partId, text) => {
    click(wordsBox().find((x) => x.textContent.trim().startsWith(text)));
    click(q('.grow-slot.empty', boxOf(partId))[0]);
  };
  set('chst', '磁');
  set('chst', '力');
  ok(save.partSlotText('chst', 0) === '磁' && save.partSlotText('chst', 1) === '力',
    `2 語が入らない: ${JSON.stringify(save.partRaw('chst'))}`);
  ok(/磁力/.test(q('.grow-part-note', boxOf('chst'))[0].textContent),
    '熟語で文になったことが説明に出ない');

  // 熟語 + 接続詞 は文末が接続詞になる。部位は 2 語までなので、
  // 語で閉じる並び (妙な骨) で接続詞の効果を見る。
  // 前の枠から外しても、残りは前へ詰まる (✕ が効かなくならない)。
  click(q('.gs-out', boxOf('chst'))[0]);
  click(q('.gs-out', boxOf('chst'))[0]);
  ok(save.partRaw('chst').filter(Boolean).length === 0, '部位の語を外せない');
  set('chst', '妙');
  set('chst', '骨');
  ok(save.partSlotText('chst', 0) === '妙' && save.partSlotText('chst', 1) === '骨',
    `並びを入れ替えられない: ${JSON.stringify(save.partRaw('chst'))}`);

  // 接続詞の一覧を開く → 「な」を選ぶ → 妙な骨 になる。
  click(q('.gs-conn', boxOf('chst'))[0]);
  const menuEl = q('.grow-conn-menu', boxOf('chst'))[0];
  ok(!!menuEl, '接続詞の一覧が開かない');
  const picks = q('.grow-conn-pick', menuEl);
  ok(picks.some((x) => x.textContent.trim() === 'な'),
    `「な」が一覧に無い: ${picks.map((x) => x.textContent.trim())}`);
  ok(picks.some((x) => x.classList.contains('ok') && /な/.test(x.textContent)),
    '文が成る形に ✓ (ok) が付かない');
  click(picks.find((x) => x.textContent.trim() === 'な'));
  const raw = save.partRaw('chst').filter(Boolean);
  ok(raw.some((e) => e.conn === 'な'), `接続詞がセーブに入らない: ${JSON.stringify(save.partRaw('chst'))}`);
  const p = evaluatePart(save.partRaw('chst').filter(Boolean));
  ok(p.valid && p.text === '妙な骨', `部位の文が読めない: ${p.text} / ${p.reasonText}`);
  ok(/妙な骨/.test(q('.grow-part-note', boxOf('chst'))[0].textContent), '文の評価が更新されない');
  ok(q('.gs-conn.filled', boxOf('chst')).length === 1, '接続詞のマスが filled にならない');

  // 選び直しても文は壊れない (一覧に出るのは「付けられる形」だけ)。
  ok(p.valid, `接続詞を付けたら不成文になった: ${p.reasonText}`);
  // 一覧は語を選ぶと閉じる。もう一度マスをタップすると開き、もう一度で閉じる。
  ok(!q('.grow-conn-menu', boxOf('chst')).length, '接続詞を選んでも一覧が開いたまま');
  click(q('.gs-conn', boxOf('chst'))[0]);
  ok(q('.grow-conn-menu', boxOf('chst')).length === 1, '接続詞の一覧を開けない');
  click(q('.gs-conn', boxOf('chst'))[0]);
  ok(!q('.grow-conn-menu', boxOf('chst')).length, '一覧を閉じられない');
  console.log(`  「${p.text}」 文の力 ${p.power.toFixed(2)} / 効き ×${p.gain.toFixed(2)}`);
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
  // 部位の語が 1 語でも効きは落ちない (1 語 = 倍率 1.00)
  const one = rows.partRows.find((r) => r.name === '頭');
  ok(one && Math.abs(one.gain - 1) < 0.001, `1 語の倍率が ${one?.gain}`);
  console.log(`  胸「${chst.text}」 ×${chst.gain.toFixed(2)} / 頭「${one.text}」 ×${one.gain.toFixed(2)}`);
}

sec('部位の接続詞は、その語の送り仮名だけ (戦闘中の文と同じ)');
{
  // 癒 (プール: す / える / して / えて) に、ほかの語の送り仮名は付かない。
  const words = [{ text: '癒', conn: null }, { text: '骨', conn: null }];
  const all = partConnChoices(words, 0);
  ok(all.length === partWordForms('癒').length,
    `候補が語の送り仮名に限られていない: ${all.map((c) => c.text)}`);
  ok(all.every((c) => c.source === 'word'), '語の形でない候補が混ざっている');
  ok(all.some((c) => c.valid) && all.some((c) => !c.valid),
    `成る形 / 成らない形が出ていない: ${all.map((c) => c.text + (c.valid ? 'ok' : 'no')).join(' ')}`);
  ok(!all.some((c) => c.text === 'の'), '癒 に の が出ている');
  ok(partCanSetConn(words, 0, 'の') === false, '癒 に の を付けられてしまう');
  ok(partCanSetConn(words, 0, 'す') === true, '癒 に す を付けられない');

  // 付けられない形はセーブにも入らない (構造として弾く)。
  save.setPart('head', 0, '癒');
  save.setPartConn('head', 0, 'の');
  ok(save.partRaw('head')[0].conn !== 'の', '付けられない形がセーブに入った');

  // UI: 一覧に出るのは 無し + その語の送り仮名だけ。✓ / ✕ は結果の印。
  menu.renderGrow();
  click(q('.gs-conn', boxOf('head'))[0]);
  const menuEl = q('.grow-conn-menu', boxOf('head'))[0];
  ok(!!menuEl, '接続詞の一覧が開かない');
  const picks = q('.grow-conn-pick', menuEl);
  const labels = picks.map((x) => x.textContent.replace(/[✓✕]/g, '').trim());
  ok(labels[0] === '無し', `先頭が無しでない: ${labels}`);
  ok(labels.slice(1).every((t) => partWordForms('癒').includes(t)),
    `語の送り仮名でない候補が出ている: ${labels}`);
  ok(!q('.grow-conn-more', menuEl).length, '「ほかの接続詞」がまだ残っている');
  ok(!q('.grow-conn-all', menuEl).length, '自由な接続詞の一覧が残っている');
  ok(q('.grow-conn-pick.ok', menuEl).length >= 1 && q('.grow-conn-pick.no', menuEl).length >= 1,
    '成る形 / 成らない形の印が出ていない');

  // 成る形を選ぶと文が成る。先頭の ok は す (癒す)。
  click(q('.grow-conn-pick.ok', menuEl)[0]);
  const p = evaluatePart(save.partRaw('head').filter(Boolean));
  ok(p.valid, `選んだ形で文が成らない: ${p.text} / ${p.reasonText}`);
  ok(q('.gs-conn.filled', boxOf('head')).length === 1, '接続詞のマスが filled にならない');
  click(q('.gs-out', boxOf('head'))[0]);
  console.log(`  癒 の候補 ${labels.join(' ')} / 成る形 ${all.filter((c) => c.valid).map((c) => c.text).join(' ')}`);
}

sec('部位の効きが数字で出る (何がどれだけ変わるか)');
{
  const rows = partEffectRows(save.partEntries(), 'chst');
  ok(Array.isArray(rows), 'partEffectRows が配列を返さない');
  const total = partTotalRows(save.partEntries());
  ok(total.length > 0, `部位の合計が出ない: ${JSON.stringify(total)}`);
  const hp = total.find((r) => r.key === 'maxHp');
  ok(hp && /^\+\d+$/.test(hp.text), `合計の体力が数値で出ない: ${JSON.stringify(hp)}`);

  // 画面: 合計の行と、部位ごとの効果チップ。
  const totalEl = q('#growTotal')[0] || dom.doc.getElementById('growTotal');
  ok(/部位の合計/.test(totalEl.textContent), '合計の見出しが出ない');
  ok(q('.eff', totalEl).length > 0, '合計の効果チップが出ない');
  const eff = q('.grow-part-eff .eff', boxOf('chst'));
  ok(eff.length > 0, '部位ごとの効果チップが出ない');
  console.log(`  合計 ${q('.eff', totalEl).map((x) => x.textContent).join(' ')}`);
}

sec('武器の文で使う語は一覧に出さず、意味の効く部位は語を示す');
{
  // 炎 (dmg/burn) と 弾 は武器の文で使う語。部位では何も起きないので出さない。
  ok(!wordsBox().some((x) => x.textContent.trim().startsWith('炎')), '武器の文で使う語が一覧に出ている');
  ok(!wordsBox().some((x) => x.textContent.trim().startsWith('弾')), '武器の文で使う語が一覧に出ている');

  // 速 は体に直接は効かないが、足・腕・手で意味が効く。一覧に出て、効く部位が出る。
  if (!save.ownsWord('速')) save.data.collection.push('速');
  menu.renderGrow();
  const w = wordsBox().find((x) => x.textContent.trim().startsWith('速'));
  ok(!!w, '所持語に「速」が無い');
  ok(/足/.test(w.textContent), `効く部位が語に出ていない: ${w.textContent}`);
  click(w);
  ok(/足/.test(dom.doc.getElementById('growSelNote').textContent),
    `効く部位の説明が出ない: ${dom.doc.getElementById('growSelNote').textContent}`);
  click(q('.grow-slot.empty', boxOf('lfot'))[0]);
  const note = q('.grow-part-note', boxOf('lfot'))[0];
  ok(q('.grow-part-eff .eff', boxOf('lfot')).length > 0,
    `速い足の効果が出ない: ${note.textContent}`);
  click(q('.gs-out', boxOf('lfot'))[0]);
  click(w);   // 選択解除
  console.log(`  速 → 効く部位つきで表示 / 足に入れて ${note.textContent.replace(/\s+/g, ' ').slice(0, 50)}`);
}

sec('恒久強化は無い。語彙の枠は頭の賢い語から');
{
  // 書庫の恒久強化 (up-row / up-buy) を作る道はもう無い。
  ok(typeof menu.renderArchive === 'undefined', '恒久強化の描画が残っている');
  ok(q('.up-row').length === 0 && q('.up-buy').length === 0, '恒久強化の行が描かれている');

  // 頭に賢い語を入れると、語彙の枠が広がって合計に出る。
  save.setPart('head', 0, null);
  save.setPart('head', 1, null);
  if (!save.ownsWord('賢')) save.data.collection.push('賢');
  menu.renderGrow();
  const before = resolvePlayerStats(save.partEntries()).lexicon;
  click(wordsBox().find((b) => b.textContent.trim().startsWith('賢')));
  click(q('.grow-slot.empty', boxOf('head'))[0]);
  const after = resolvePlayerStats(save.partEntries()).lexicon;
  ok(after > before, `賢い頭で語彙が広がらない: ${before} -> ${after}`);

  const totalEl = dom.doc.getElementById('growTotal');
  ok(q('.eff', totalEl).some((x) => /語彙/.test(x.textContent)),
    `合計に語彙が出ない: ${totalEl.textContent.replace(/\s+/g, ' ').slice(0, 80)}`);
  console.log(`  頭「賢」→ 語彙 +${after} 枠 / 合計 ${q('.eff', totalEl).map((x) => x.textContent.replace(/\s+/g, '')).join(' ')}`);
}

console.log(`\n---- 合格 ${pass} / 不合格 ${fail} ----`);
process.exit(fail ? 1 : 0);
