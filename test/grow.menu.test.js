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
const { evaluatePart } = await import('../js/game/parts.js');
const { resolvePlayerStats } = await import('../js/game/stats.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const sec = (t) => console.log(`\n== ${t} ==`);

// ── メニューが要求する DOM をぜんぶ作る ──────────────────────────────────
const IDS = [
  'title', 'stages', 'stageList', 'loadout', 'loadoutList', 'loadoutCount', 'loadoutGo',
  'loadoutTitle', 'loadoutSub', 'result', 'resultStats', 'resultTitle', 'resultSub',
  'resultNext', 'resultRetry', 'resultStages', 'howto', 'settings',
  'dict', 'dictSearch', 'dictTabs', 'dictList', 'dictCount',
  'archive', 'archiveInk', 'archiveUpgrades', 'archiveWords',
  'grow', 'growInk', 'gachaBtn', 'gachaResult', 'growParts', 'growSelNote', 'growWords',
  'deckWords', 'deckCount',
  'btnStart', 'btnStages', 'btnHowto', 'btnGrow', 'btnArchive', 'btnDict', 'btnSettings',
  'recBest', 'recClear', 'recKills', 'recRuns', 'recBroken',
];
for (const id of IDS) {
  const e = dom.doc.createElement('div');
  e.setAttribute('id', id);
  dom.doc.body.append(e);
}

const save = new Save();
save.reset();
// テストを決定的にする。語は抽選に頼まず入れる。
save.data.collection = ['頑', '健', '癒', '発', '電', '強', '弾'];
save.data.parts = {};
for (const p of PARTS) save.data.parts[p.id] = [];

const menu = new Menus({ save, audio: null });
menu.show('grow');

const q = (sel, root = dom.doc) => [...root.querySelectorAll(sel)];
const partsBox = () => q('#growParts .grow-part');
const nameOf = (id) => PARTS.find((p) => p.id === id).name;
/** 部位のコマ (毎回選び直す — 再描画でノードが入れ替わる) */
const boxOf = (id) => partsBox().find((b) => b.querySelector('.grow-part-name').textContent === nameOf(id));
const wordsBox = () => q('#growWords .grow-word');
const click = (node) => node.dispatchEvent({ type: 'click' });

sec('部位が 9 コマ出て、各コマに枠が PART_SLOTS 個ある');
{
  const parts = partsBox();
  ok(parts.length === 9, `部位のコマが ${parts.length} 個`);
  for (const b of parts) {
    const cells = q('.grow-slot', b);
    ok(cells.length === PART_SLOTS, `枠の数が ${cells.length}`);
    ok(q('.grow-part-note.empty', b).length === 1, '空の部位の説明が出ていない');
  }
  ok(wordsBox().length === save.collection.length, '所持語の一覧が出ない');
  console.log(`  部位 ${parts.length} / 枠 ${PART_SLOTS} / 所持語 ${wordsBox().length}`);
}

sec('語を選んで枠を押し → 入る。もう一度押すと外れる');
{
  const word = wordsBox().find((b) => b.textContent.trim().startsWith('頑'));
  ok(!!word, '所持語に「頑」が無い');
  click(word);
  ok(q('#growWords .grow-word.sel').length === 1, '選んだ語が sel にならない');
  ok(/頑/.test(dom.doc.getElementById('growSelNote').textContent), '選択中の変化が説明に出ない');

  const gap = q('.grow-slot.empty', boxOf('head'))[0];
  click(gap);
  ok(save.partSlotText('head', 0) === '頑', '枠に入れてもセーブに入らない');
  ok(q('.gs-word', boxOf('head')).length === 1, '語のチップが出ない');
  ok(!!q('.gs-out', boxOf('head'))[0], '✕ が出ていない (取り外せない不具合)');

  // 選んだ語が入っている枠の語を押す = 外す。
  click(q('.gs-word', boxOf('head'))[0]);
  ok(!save.partSlot('head', 0), '同じ語を押しても外れない (取り外せない不具合)');

  // 語の選択もトグル (押すと外れる) — 押せるものだけが選べる状態になる。
  click(wordsBox().find((b) => b.textContent.trim().startsWith('頑')));
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
  set('chst', '発');
  set('chst', '電');
  ok(save.partSlotText('chst', 0) === '発' && save.partSlotText('chst', 1) === '電',
    `2 語が入らない: ${JSON.stringify(save.partRaw('chst'))}`);
  ok(/発電/.test(q('.grow-part-note', boxOf('chst'))[0].textContent),
    '熟語で文になったことが説明に出ない');

  // 接続詞の一覧を開く → 「する」を選ぶ → 発電する になる。
  click(q('.gs-conn', boxOf('chst'))[1]);
  const menuEl = q('.grow-conn-menu', boxOf('chst'))[0];
  ok(!!menuEl, '接続詞の一覧が開かない');
  const picks = q('.grow-conn-pick', menuEl);
  ok(picks.some((x) => x.textContent.trim() === 'する'),
    `「する」が一覧に無い: ${picks.map((x) => x.textContent.trim())}`);
  click(picks.find((x) => x.textContent.trim() === 'する'));
  const raw = save.partRaw('chst').filter(Boolean);
  ok(raw.some((e) => e.conn === 'する'), `接続詞がセーブに入らない: ${JSON.stringify(save.partRaw('chst'))}`);
  const p = evaluatePart(save.partRaw('chst').filter(Boolean));
  ok(p.valid && p.text === '発電する', `部位の文が読めない: ${p.text} / ${p.reasonText}`);
  ok(/発電する/.test(q('.grow-part-note', boxOf('chst'))[0].textContent), '文の評価が更新されない');
  ok(q('.gs-conn.filled', boxOf('chst')).length === 1, '接続詞のマスが filled にならない');

  // 選び直しても文は壊れない (一覧に出るのは「付けられる形」だけ)。
  ok(p.valid, `接続詞を付けたら不成文になった: ${p.reasonText}`);
  // 一覧は語を選ぶと閉じる。もう一度マスをタップすると開き、もう一度で閉じる。
  ok(!q('.grow-conn-menu', boxOf('chst')).length, '接続詞を選んでも一覧が開いたまま');
  click(q('.gs-conn', boxOf('chst'))[1]);
  ok(q('.grow-conn-menu', boxOf('chst')).length === 1, '接続詞の一覧を開けない');
  click(q('.gs-conn', boxOf('chst'))[1]);
  ok(!q('.grow-conn-menu', boxOf('chst')).length, '一覧を閉じられない');
  console.log(`  「${p.text}」 文の力 ${p.power.toFixed(2)} / 効き ×${p.gain.toFixed(2)}`);
}

sec('部位の文は能力に乗り、不成文は何も乗せない');
{
  const save2 = new Save();
  save2.reset();
  save2.data.collection = ['頑', '健'];
  save2.data.parts = {};
  for (const p of PARTS) save2.data.parts[p.id] = [];
  save2.setPart('chst', 0, '頑');
  save2.setPart('chst', 1, '健');
  save2.setPart('head', 0, '頑');
  const rows = resolvePlayerStats(save2.partEntries(), {});
  ok(rows.partCount === 3, `部位の語を数えていない: ${rows.partCount}`);
  ok(rows.partRows.length === 2, `文の行が ${rows.partRows.length} 件`);
  const chst = rows.partRows.find((r) => r.name === '胸');
  ok(chst && chst.text === '頑健' && chst.gain > 1, `2 語の文の力が乗らない: ${JSON.stringify(chst)}`);
  // 部位の語が 1 語でも効きは落ちない (1 語 = 倍率 1.00)
  const one = rows.partRows.find((r) => r.name === '頭');
  ok(one && Math.abs(one.gain - 1) < 0.001, `1 語の倍率が ${one?.gain}`);
  console.log(`  胸「${chst.text}」 ×${chst.gain.toFixed(2)} / 頭「${one.text}」 ×${one.gain.toFixed(2)}`);
}

console.log(`\n---- 合格 ${pass} / 不合格 ${fail} ----`);
process.exit(fail ? 1 : 0);
