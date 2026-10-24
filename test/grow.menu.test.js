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
const { evaluatePart, partConnChoices } = await import('../js/game/parts.js');
const { resolvePlayerStats, partEffectRows, partTotalRows } = await import('../js/game/stats.js');

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
for (const id of [...IDS, 'growTotal']) {
  const e = dom.doc.createElement('div');
  e.setAttribute('id', id);
  dom.doc.body.append(e);
}

const save = new Save();
save.reset();
// テストを決定的にする。語は抽選に頼まず入れる。
save.data.collection = ['妙', '骨', '癒', '発', '電', '強', '弾', '斬', '炎'];
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
  ok(picks.some((x) => x.classList.contains('ok') && /する/.test(x.textContent)),
    '文が成る形に ✓ (ok) が付かない');
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

sec('部位はどの接続詞でも選べる。成る / 成らない が一覧に出る');
{
  // 癒 + 斬 は、癒 に付く送り仮名 (す・える) が両方とも文を壊す並び。
  // プールを絞ると「1 つも選べない」状態になるので、部位は自由に選べる。
  const words = [{ text: '癒', conn: null }, { text: '斬', conn: null }];
  const ownC = partConnChoices(words, 0).filter((c) => c.source === 'word');
  const own = ownC.map((c) => `${c.text}${c.valid ? '✓' : '✕'}`);
  ok(ownC.length >= 2, `癒 の形が出ない: ${own}`);
  ok(ownC.every((c) => !c.valid), `癒 の形が文を壊さない: ${own}`);
  ok(partConnChoices(words, 0).length > 100, '自由に選べる候補が出ていない');

  // UI: 癒 + 斬 を入れて接続詞の一覧を開くと、その語の形が ✕ 付きで出る。
  const pick = (t) => wordsBox().find((b) => b.textContent.trim().startsWith(t));
  click(pick('癒'));
  click(q('.grow-slot.empty', boxOf('head'))[0]);
  click(pick('斬'));
  click(q('.grow-slot.empty', boxOf('head'))[0]);
  ok(save.partSlotText('head', 0) === '癒' && save.partSlotText('head', 1) === '斬',
    `2 語が入らない: ${JSON.stringify(save.partRaw('head'))}`);
  ok(q('.grow-part-note.bad', boxOf('head')).length === 0, 'まだ不成文になっている');

  click(q('.gs-conn', boxOf('head'))[0]);
  const menuEl = q('.grow-conn-menu', boxOf('head'))[0];
  ok(!!menuEl, '接続詞の一覧が開かない');
  const noChips = q('.grow-conn-pick.no', menuEl);
  ok(noChips.length >= 2, `不成文になる形 (✕) が出ていない: ${noChips.length}`);
  // ✕ の形でも選べる。選んだあとに不成文と理由、直し方が出る。
  click(noChips[0]);
  const placed = save.partRaw('head').filter(Boolean)[0];
  ok(placed && placed.conn, `✕ の形が選べない: ${JSON.stringify(save.partRaw('head'))}`);
  const note0 = q('.grow-part-note.bad', boxOf('head'))[0];
  ok(!!note0, '不成文の理由が出ない');
  ok(/不成文/.test(note0.textContent), `不成文の表示が違う: ${note0.textContent}`);
  ok(!!q('.grow-part-fix', boxOf('head'))[0], '直し方が出ない');
  // 「ほかの接続詞」を開くと全部選べる。
  click(q('.gs-conn', boxOf('head'))[0]);
  const more = q('.grow-conn-more', boxOf('head'))[0];
  ok(!!more, '「ほかの接続詞」が無い');
  click(more);
  ok(q('.grow-conn-all .grow-conn-pick', boxOf('head')).length > 20,
    `ほかの接続詞が開かない: ${q('.grow-conn-all .grow-conn-pick', boxOf('head')).length}`);
  // 片方を直すと文が成る (癒 の枠を外して 斬 だけにする)。
  click(q('.gs-out', boxOf('head'))[0]);
  ok(evaluatePart(save.partRaw('head').filter(Boolean)).valid, '語を外しても不成文のまま');
  click(q('.gs-out', boxOf('head'))[0]);
  console.log(`  「癒」の形 ${own.join(' ')} / ほかを開いて全件表示 / 外して回復`);
}

sec('部位の効きが数字で出る (何がどれだけ変わるか)');
{
  const rows = partEffectRows(save.partEntries(), 'chst', {});
  ok(Array.isArray(rows), 'partEffectRows が配列を返さない');
  const total = partTotalRows(save.partEntries(), {});
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

sec('体に効かない語は、そう表示する');
{
  // 炎 は武器向けの語 (dmg/burn)。体に直接は効かない。
  // ただし文が成れば「文の力」ぶんだけは強くなる (どの語でも同じ)。
  const w = wordsBox().find((b) => b.textContent.trim().startsWith('炎'));
  ok(!!w, '所持語に「炎」が無い');
  ok(w.classList.contains('no-eff'), '直接効かない語に印が付かない');
  click(w);
  ok(/体に直接は効かない/.test(dom.doc.getElementById('growSelNote').textContent),
    `効かない説明が出ない: ${dom.doc.getElementById('growSelNote').textContent}`);
  click(q('.grow-slot.empty', boxOf('larm'))[0]);
  const note = q('.grow-part-note', boxOf('larm'))[0];
  // 文の力ぶんの効果は出る (体力/攻撃の数字が付く)。
  ok(q('.grow-part-eff .eff', boxOf('larm')).length > 0,
    `文の力ぶんの効果が出ない: ${note.textContent}`);
  // 部位の効きは、直接効く語でも文の力ぶんでも数字のチップで出る。
  click(q('.gs-out', boxOf('larm'))[0]);
  click(w);   // 選択解除
  console.log(`  炎 → 「体に直接は効かない」+ 文の力ぶん ${note.textContent.replace(/\s+/g, ' ').slice(0, 60)}`);
}

console.log(`\n---- 合格 ${pass} / 不合格 ${fail} ----`);
process.exit(fail ? 1 : 0);
