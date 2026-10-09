// 言葉鍛冶のドラッグ & ドロップのテスト。      node test/forge.drag.test.js
//
// Chrome が無い環境でも「語を文に運べる」「文を並べ替えられる」
// 「語をタップすると接続詞が回る」ことを検証する。
// 本物のブラウザでのジェスチャ再現は browser.test.js の担当。
// こちらは pointerdown → pointermove → pointerup のコード経路を
// 最小 DOM 上で通すだけ。ドラッグの判定ロジックが壊れていないかの守衛。
import { installMiniDom, pointer, centerOf } from './minidom.mjs';

// Forge は import 時に document を触るので、グローバルを先に差し替える。
const dom = installMiniDom();

const { Run } = await import('../js/game/run.js');
const { makeRng } = await import('../js/core/util.js');
const { Forge } = await import('../js/ui/forge.js');
const { makeWord } = await import('../js/data/words.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const sec = (t) => console.log(`\n== ${t} ==`);

// ── 必要な DOM を作る ───────────────────────────────────────────────────
const mk = (id) => {
  const e = dom.doc.createElement('div');
  e.setAttribute('id', id);
  dom.doc.body.append(e);
  return e;
};
for (const id of ['forge', 'forgeClose', 'forgeBack', 'forgeWeapons', 'forgeLexicon',
  'lexiconCount', 'forgeDetail', 'forgeHint', 'btnForgeHint',
  'btnForgeForget', 'btnForgeUndo']) mk(id);

const audio = new Proxy({}, { get: () => () => {} });
const save = { d: { meta: {} }, unlockWeapon() {} };
const newRun = () => new Run({ stageId: 1, audio, save, rng: makeRng(99) });

/** 語彙を「語が 1 つ残った」状態にしてから鍛冶を開く。 */
const openForge = () => {
  const run = newRun();
  const forge = new Forge(run, { onChange: () => {}, onClose: () => {}, audio: null });
  forge.open();
  return { run, forge };
};

/** ノードを指してドラッグする。step 回 pointermove を挟む。 */
const drag = (node, toNode, { steps = 3, drop = true } = {}) => {
  const a = centerOf(node);
  const b = centerOf(toNode);
  node.dispatchEvent(pointer('pointerdown', a.x, a.y));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    dom.win.dispatchEvent(pointer('pointermove', a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t));
  }
  // 本物のブラウザと同じく、pointerup は掴んだ要素の上で起きる。
  // ここから window まで伝わり、window 登録のハンドラも動く。
  if (drop) node.dispatchEvent(pointer('pointerup', b.x, b.y));
  return { a, b };
};

/** タップ。pointerup は pointerdown と同じ要素で起こす。 */
const tap = (node) => {
  const p = centerOf(node);
  node.dispatchEvent(pointer('pointerdown', p.x, p.y));
  node.dispatchEvent(pointer('pointerup', p.x, p.y));
};

/** 長押し。押したまま待つ。タップにはしない。 */
const longPress = async (node) => {
  const p = centerOf(node);
  node.dispatchEvent(pointer('pointerdown', p.x, p.y));
  await new Promise((r) => setTimeout(r, Forge.HOLD_MS + 60));
  node.dispatchEvent(pointer('pointerup', p.x, p.y));
};

const weaponRow = (forge) => {
  const rows = dom.doc.querySelectorAll('#forgeWeapons .wrow');
  // 自身の文 (wrow-self) と「武器を追加できる」の行 (wrow-empty) を除く。
  const real = rows.filter((r) => !r.classList.contains('wrow-self') && !r.classList.contains('wrow-empty'));
  return real[0];
};
const gapsOf = (forge) => [...weaponRow(forge).querySelectorAll('.sen-gap')];
const chipsOf = (forge) => [...weaponRow(forge).querySelectorAll('.sen-word:not(.sen-tail)')];
const lexWords = () => [...dom.doc.querySelectorAll('#forgeLexicon .pword:not(.empty)')];
const outBtns = (forge) => [...weaponRow(forge).querySelectorAll('.sen-item .sen-out')];

sec('語彙から文へドラッグで語を運べる');
{
  const { run, forge } = openForge();
  const wi = run.weapons[0];
  const before = wi.sentence.text;
  const lex = lexWords()[0];
  const text = lex.querySelector('span').textContent;
  const last = gapsOf(forge).at(-1);
  drag(lex, last);
  ok(wi.sentence.text !== before, `文が変わらない: ${before} -> ${wi.sentence.text}`);
  ok(wi.sentence.text.includes(text), `語が入っていない: ${wi.sentence.text} (${text})`);
  ok(!run.lexicon.includes(lex), '語彙に語が残っている');
  ok(forge.dragFrom === null, 'dragFrom が残った');
  console.log(`  「${text}」-> 「${wi.sentence.text}」`);
}

sec('文の中の語をドラッグで並べ替えられる');
{
  const { run, forge } = openForge();
  const wi = run.weapons[0];
  const text0 = wi.sentence.text;
  const chips = chipsOf(forge);
  ok(chips.length >= 3, `語が足りない: ${chips.length}`);
  const first = chips[0].querySelector('span').textContent;
  // 最後の隙間へ運ぶ (文の並びが変わる)。
  const lastGap = gapsOf(forge).at(-1);
  drag(chips[0], lastGap);
  const after = wi.sentence.text;
  ok(after !== text0, `文が変わらない: ${text0} -> ${after}`);
  ok(wi.sentence.count === chips.length, `語が失われた: ${wi.sentence.count} / ${chips.length}`);
  ok(wi.sentence.text.startsWith(first) === false, '先頭が動いていない');
  ok(wi.sentence.text.endsWith(first), `末尾に移っていない: ${after}`);
  ok(wi.sentence.len <= wi.sentence.maxLen, `10 文字を超えた: ${wi.sentence.len}`);
  console.log(`  「${text0}」-> 「${after}」`);
}

sec('文の語を語彙へドラッグで戻せる');
{
  const { run, forge } = openForge();
  const free0 = run.lexiconFreeCount;
  const chip = chipsOf(forge)[0];
  const text = chip.querySelector('span').textContent;
  const target = lexWords()[0];
  drag(chip, target);
  ok(!wi_holds(run, text), `文に語が残っている: ${wi_holds(run, text)}`);
  ok(run.lexiconFreeCount === free0 - 1, `空きが増えていない: ${free0} -> ${run.lexiconFreeCount}`);
  ok(run.lexicon.some((w) => w && w.text === text), '語彙に戻っていない');
  console.log(`  「${text}」-> 語彙 / 空き ${free0} -> ${run.lexiconFreeCount}`);
}
function wi_holds(run, text) {
  return run.weapons.some((w) => w.sentence.words.some((x) => x.text === text));
}

sec('少し動かしただけではドラッグにならない (タップ扱い)');
{
  const { run, forge } = openForge();
  const wi = run.weapons[0];
  const words0 = wi.sentence.words.slice();
  const chip = chipsOf(forge)[0];
  const a = centerOf(chip);
  chip.dispatchEvent(pointer('pointerdown', a.x, a.y));
  dom.win.dispatchEvent(pointer('pointermove', a.x + 3, a.y + 2));
  chip.dispatchEvent(pointer('pointerup', a.x + 3, a.y + 2));
  // 3px ではドラッグにならず、通常のタップとして扱う (接続詞だけ回る)。
  ok(wi.sentence.words.length === words0.length, `語が失われた: ${wi.sentence.words.length}`);
  ok(wi.sentence.words.every((w, i) => w === words0[i]), `並びが変わった: ${wi.sentence.text}`);
  ok(forge.dragFrom === null, 'dragFrom が残った');
  console.log(`  3px なら語は動かない / 接続詞だけ回る -> 「${wi.sentence.text}」`);
}

sec('語をタップすると直後の接続詞が切り替わる');
{
  const { run, forge } = openForge();
  const wi = run.weapons[0];
  const chip = chipsOf(forge)[0];
  const text = chip.querySelector('span').textContent;
  const opts = wi.sentence.connOptions(0);
  const seen = [];
  for (let i = 0; i < opts.length + 1; i++) {
    tap(chipsOf(forge)[0]);
    seen.push(wi.sentence.at(0).conn ? wi.sentence.at(0).conn.text : null);
  }
  ok(seen.slice(0, opts.length).join() === opts.join(),
    `候補どおりに回らない: ${seen.join(',')} / ${opts.join(',')}`);
  ok(seen[opts.length] === null, `一周しても無しにならない: ${seen.join(',')}`);
  ok(wi.sentence.words[0].text === text, '語が変わった');
  console.log(`  「${text}」-> ${seen.join(' → ')}`);
}

sec('語彙の語をタップすると Arm & 隙間タップで置ける');
{
  const { run, forge } = openForge();
  const wi = run.weapons[0];
  const before = wi.sentence.count;
  const lex = lexWords()[0];
  const text = lex.querySelector('span').textContent;
  tap(lex);
  ok(forge.armed, 'Arm されない');
  // 描き直されるので語彙のセルを取り直す。
  tap(gapsOf(forge).at(-1));
  ok(wi.sentence.count === before + 1, `語が入らない: ${before} -> ${wi.sentence.count}`);
  ok(wi.sentence.text.includes(text), `語が違う: ${wi.sentence.text}`);
  ok(forge.armed === null, 'Arm が残る');
  console.log(`  Arm「${text}」-> 隙間タップ -> 「${wi.sentence.text}」`);
}

sec('10 文字を超える語はドラッグでも入らない');
{
  const { run, forge } = openForge();
  const wi = run.weapons[0];
  let guard = 0;
  while (wi.sentence.free > 0 && guard++ < 10) {
    const lex = lexWords().find((n) => {
      const t = n.querySelector('span').textContent;
      return t.length <= wi.sentence.free;
    });
    if (!lex) break;
    const last = gapsOf(forge).at(-1);
    drag(lex, last);
  }
  const full = wi.sentence.len;
  // 残った語をすべて試しても 10 文字を超えない。
  for (const lex of lexWords().slice(0, 6)) {
    const last = gapsOf(forge).at(-1);
    drag(lex, last);
  }
  ok(wi.sentence.len <= 10, `10 文字を超えた: ${wi.sentence.len}`);
  ok(wi.sentence.len >= full, `語が逆に減った: ${wi.sentence.len}`);
  console.log(`  満杯 ${wi.sentence.len} / ${wi.sentence.maxLen} 文字「${wi.sentence.text}」`);
}

sec('ドラッグを中断しても文は壊れない');
{
  const { run, forge } = openForge();
  const wi = run.weapons[0];
  const before = wi.sentence.text;
  const chip = chipsOf(forge)[0];
  const a = centerOf(chip);
  chip.dispatchEvent(pointer('pointerdown', a.x, a.y));
  dom.win.dispatchEvent(pointer('pointermove', a.x + 40, a.y));
  chip.dispatchEvent(pointer('pointercancel', a.x + 40, a.y));
  ok(forge.dragFrom === null, 'dragFrom が残った');
  ok(wi.sentence.text === before, `文が変わった: ${before} -> ${wi.sentence.text}`);
  console.log('  pointercancel で文はそのまま');
}

sec('語を選んで文の語をタップで置ける');
{
  const { run, forge } = openForge();
  const wi = run.weapons[0];
  const before = wi.sentence.count;
  const lex = lexWords()[0];
  const text = lex.querySelector('span').textContent;
  tap(lex);
  ok(forge.armed, 'Arm されない');
  // 語彙ではなく「文の語」をタップしても置ける。
  tap(chipsOf(forge)[0]);
  ok(wi.sentence.count === before + 1, `語が入らない: ${before} -> ${wi.sentence.count}`);
  ok(wi.sentence.text.includes(text), `語が違う: ${wi.sentence.text}`);
  ok(forge.armed === null, 'Arm が残る');
  ok(forge.held === null, 'held が残る');
  console.log(`  語を選択「${text}」-> 文の語をタップ -> 「${wi.sentence.text}」`);
}

sec('語を長押しで持ち上げ、タップだけで並べ替えられる');
{
  const { run, forge } = openForge();
  const wi = run.weapons[0];
  const text0 = wi.sentence.text;
  const first = chipsOf(forge)[0].querySelector('span').textContent;
  await longPress(chipsOf(forge)[0]);
  ok(forge.held, '長押しで持ち上がらない');
  ok(forge.held && forge.held.word.text === first, `持ち上がった語が違う: ${forge.held?.word.text}`);
  ok(wi.sentence.text === text0, `持ち上がりで文が変わった: ${wi.sentence.text}`);
  // 末尾の隙間をタップで移動。
  tap(gapsOf(forge).at(-1));
  ok(forge.held === null, '持ち上がりが残る');
  ok(wi.sentence.words.at(-1).text === first, `末尾に移っていない: ${wi.sentence.text}`);
  ok(wi.sentence.count === chipsOf(forge).length, `語が失われた: ${wi.sentence.count}`);
  console.log(`  長押し「${first}」-> 末尾の隙間をタップ -> 「${wi.sentence.text}」`);
}

sec('持ち上げた語は語彙のタップで戻せる');
{
  const { run, forge } = openForge();
  const wi = run.weapons[0];
  const free0 = run.lexiconFreeCount;
  const text = chipsOf(forge)[0].querySelector('span').textContent;
  await longPress(chipsOf(forge)[0]);
  ok(forge.held, '長押しで持ち上がらない');
  tap(lexWords()[0]);
  ok(forge.held === null, '持ち上がりが残る');
  ok(wi.sentence.words.every((w) => w.text !== text), `文に語が残っている: ${wi.sentence.text}`);
  ok(run.lexicon.some((w) => w && w.text === text), '語彙に戻っていない');
  ok(run.lexiconFreeCount === free0 - 1, `空きが増えていない: ${free0} -> ${run.lexiconFreeCount}`);
  console.log(`  長押し -> 語彙をタップ -> 語彙へ戻った (空き ${free0} -> ${run.lexiconFreeCount})`);
}

sec('長押しした語をもう一度タップすると元のまま');
{
  const { run, forge } = openForge();
  const wi = run.weapons[0];
  const text0 = wi.sentence.text;
  await longPress(chipsOf(forge)[0]);
  ok(forge.held, '長押しで持ち上がらない');
  tap(chipsOf(forge)[0]);
  ok(forge.held === null, '持ち上がりが残る');
  ok(wi.sentence.text === text0, `文が変わった: ${text0} -> ${wi.sentence.text}`);
  console.log('  持ち上げてから同じ語をタップで元に戻った');
}

sec('長押し時間までに動かすと持ち上がらない');
{
  const { run, forge } = openForge();
  const wi = run.weapons[0];
  const words0 = wi.sentence.words.slice();
  const chip = chipsOf(forge)[0];
  const a = centerOf(chip);
  chip.dispatchEvent(pointer('pointerdown', a.x, a.y));
  // 長押しの時間より前に動かす。動かしたらドラッグになる。
  await new Promise((r) => setTimeout(r, 60));
  dom.win.dispatchEvent(pointer('pointermove', a.x + 40, a.y));
  await new Promise((r) => setTimeout(r, Forge.HOLD_MS + 60));
  chip.dispatchEvent(pointer('pointerup', a.x + 40, a.y));
  ok(forge.held === null, `動かしたのに持ち上がった: ${forge.held?.word.text}`);
  ok(wi.sentence.words.every((w, i) => w === words0[i]), `並びが変わった: ${wi.sentence.text}`);
  console.log('  長押し時間までに動かせば持ち上がらない (ドラッグ扱い)');
}

sec('語の「✕」で語彙へ戻せる');
{
  const { run, forge } = openForge();
  const wi = run.weapons[0];
  const text0 = wi.sentence.text;
  const btns = outBtns(forge);
  ok(btns.length === wi.sentence.count, `✕ ボタンの数が文の語数と合わない: ${btns.length} / ${wi.sentence.count}`);
  const gone = wi.sentence.words[1].text;
  tap(btns[1]);
  ok(wi.sentence.words.every((w) => w.text !== gone), `文に語が残っている: ${wi.sentence.text}`);
  ok(run.lexicon.some((w) => w && w.text === gone), '語彙に戻っていない');
  ok(wi.sentence.text !== text0, '文が変わっていない');
  console.log(`  「${gone}」-> ✕ で外した / 文「${text0}」->「${wi.sentence.text}」`);
}

sec('語彙が満杯でも文から語を戻せる');
{
  const { run, forge } = openForge();
  const wi = run.weapons[0];
  // 語彙を埋める。
  const filler = ['火', '流', '風', '雷', '刃', '刀', '盾', '剛'];
  let k = 0;
  while (!run.lexiconFull && k < 40) {
    run.giveWord(makeWord(filler[k % filler.length]), true);
    k++;
  }
  ok(run.lexiconFull, '語彙を埋められなかった');
  const n0 = run.lexicon.filter(Boolean).length;
  const oldest = run.lexicon[run.oldestLexiconIndex()].text;
  const btns = outBtns(forge);
  const gone = wi.sentence.words[0].text;
  tap(btns[0]);
  ok(run.lexicon.some((w) => w && w.text === gone), '語が語彙に入っていない');
  ok(wi.sentence.words.every((w) => w.text !== gone), '文に語が残っている');
  ok(run.lexicon.filter(Boolean).length === n0, `語彙の数が変わった: ${run.lexicon.filter(Boolean).length} / ${n0}`);
  ok(!run.lexicon.some((w) => w && w.text === oldest), `最古の語が残った: ${oldest}`);
  console.log(`  満杯 (${n0}) でも戻せた / 最古の「${oldest}」を捨てた`);
}

sec('ドラッグ中は語が指の下に出る');
{
  const { run, forge } = openForge();
  const chip = chipsOf(forge)[0];
  const text = chip.querySelector('span').textContent;
  const a = centerOf(chip);
  chip.dispatchEvent(pointer('pointerdown', a.x, a.y));
  ok(!dom.doc.querySelector('.drag-ghost'), '動かさないのに影が出る');

  dom.win.dispatchEvent(pointer('pointermove', a.x + 30, a.y + 12));
  const ghost = dom.doc.querySelector('.drag-ghost');
  ok(ghost, 'ドラッグ中に影が出ない');
  ok(ghost && ghost.textContent.includes(text),
    `影が語を表示しない: "${ghost?.textContent}" / "${text}"`);
  // 語 + 接続詞 + ✕ の 1 組が薄くなる。
  ok(chip.parentNode.classList.contains('dragging'), '元の語が薄くならない');

  const left0 = parseFloat(ghost?.style.left);
  const top0 = parseFloat(ghost?.style.top);
  dom.win.dispatchEvent(pointer('pointermove', a.x + 62, a.y + 40));
  const moved = dom.doc.querySelector('.drag-ghost');
  ok(parseFloat(moved?.style.left) > left0, `影が横に追従しない: ${left0} -> ${moved?.style.left}`);
  ok(parseFloat(moved?.style.top) > top0, `影が縦に追従しない: ${top0} -> ${moved?.style.top}`);

  chip.dispatchEvent(pointer('pointerup', a.x + 62, a.y + 40));
  ok(!dom.doc.querySelector('.drag-ghost'), '指を離しても影が残る');
  ok(!chip.parentNode.classList.contains('dragging'), '指を離しても元の語が薄いまま');
  ok(forge.dragFrom === null, 'dragFrom が残った');
  console.log(`  影「${ghost?.textContent}」が ${left0} -> ${moved?.style.left} を追従 / 指を離すと消える`);
}

sec('「空にする」で文をまとめて戻せる / 入れた理由が見える');
{
  const { run, forge } = openForge();
  // 文に 2 語足す (最初の武器は 3 語から始まる)。
  const wi = run.weapons[0];
  const lex = run.lexicon.filter(Boolean);
  const before = wi.sentence.count;
  run.insertInto(wi.sentence, 0, lex[0], wi);
  run.insertInto(wi.sentence, 1, lex[1], wi);
  forge.render();
  ok(wi.sentence.count === before + 2, `文に入れていない: ${wi.sentence.count}`);

  // 文の中の語をタップすると、使える接続詞が一覧で出る。
  const chip = dom.doc.querySelectorAll('.sen-word').find((c) => c.parentNode.classList.contains('sen-item'));
  ok(chip, '文の語が見つからない');
  tap(chip);
  const detail = dom.doc.getElementById('forgeDetail').textContent;
  ok(detail.includes('使える接続詞'),
    `詳細欄に使える接続詞が出ない: "${detail}"`);
  console.log(`    ${detail.split('\n').filter(Boolean).pop()}`);

  // 「空にする」を押すと、文の語が全部語彙へ戻る。
  const btn = dom.doc.querySelector('.wrow-clear');
  ok(btn, '「空にする」ボタンが出ない');
  tap(btn);
  ok(wi.sentence.count === 0, `文が空にならない: ${wi.sentence.count}`);
  ok(dom.doc.getElementById('forgeDetail').textContent.includes('空にした'),
    '結果のメッセージが出ない');
  ok(!dom.doc.querySelector('.wrow-clear'), '空になったのにボタンが残る');
  console.log('    「空にする」→ 文が空になり、詳細欄に結果が出る');
}

sec('10 文字を超える語は入れない。理由が見える');
{
  const { run, forge } = openForge();
  const wi = run.weapons[0];
  // 10 文字いっぱいまで埋める。
  const pool = run.lexicon.filter(Boolean);
  let n = 0;
  for (const w of pool) {
    if (n >= 10) break;
    if (run.insertInto(wi.sentence, wi.sentence.count, w, wi).ok) n++;
  }
  const len = wi.sentence.len;
  const left = run.lexicon.find(Boolean);
  ok(!!left, '語彙に語が無い');
  forge.armed = left;
  forge.placeInto({ kind: 'slot', wi, wIdx: 0, index: wi.sentence.count });
  const detail = dom.doc.getElementById('forgeDetail').textContent;
  ok(wi.sentence.len === len, `文字数が変わった: ${len} -> ${wi.sentence.len}`);
  ok(detail.includes('文字まで') || detail.includes('置けなかった'),
    `理由が出ない: "${detail}"`);
  console.log(`    ${len} 文字の文に入れても変化なし / 詳細: ${detail.split('\n')[0]}`);
}

sec('接続詞を一覧から一発で選べる');
{
  const { run, forge } = openForge();
  const wi = run.weapons[0];
  const place = { kind: 'slot', wi, wIdx: 0, index: 0 };
  const chip = dom.doc.querySelectorAll('.sen-conn')[0];
  const menu = forge.openConnPicker(place, chip);
  ok(menu && menu.classList.contains('conn-picker'), '接続詞メニューが開かない');
  const picks = [...menu.querySelectorAll('.conn-pick')];
  ok(picks.length === wi.sentence.connOptions(0).length + 1,
    `候補の数が合わない: ${picks.length}`);
  const target = picks.find((b) => b.textContent !== 'なし');
  const want = target ? target.textContent : null;
  target.dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {} });
  ok(wi.sentence.at(0).conn && wi.sentence.at(0).conn.text === want,
    `接続詞が選べない: ${wi.sentence.at(0).conn?.text} (期待 ${want})`);
  ok(!dom.doc.querySelector('.conn-picker'), '選んだのにメニューが残る');
  console.log(`  メニューから「${want}」を選んだ -> 「${wi.sentence.text}」`);
}

sec('「戻す」で直前の操作を戻せる');
{
  const { run, forge } = openForge();
  const wi = run.weapons[0];
  const before = wi.sentence.text;
  tap(chipsOf(forge)[0]);
  ok(wi.sentence.text !== before, `接続詞が変わらない: ${wi.sentence.text}`);
  forge.undo();
  ok(wi.sentence.text === before, `接続詞の変更が戻らない: ${wi.sentence.text} (期待 ${before})`);
  // 語を 1 つ足して戻す。
  const lexText = lexWords()[0].querySelector('span').textContent;
  tap(lexWords()[0]);
  tap(gapsOf(forge).at(-1));
  ok(wi.sentence.text.includes(lexText), '語が入らない');
  forge.undo();
  ok(!wi.sentence.text.includes(lexText), `語の追加が戻らない: ${wi.sentence.text}`);
  console.log(`  接続詞の変更と語の追加を戻した -> 「${wi.sentence.text}」`);
}

sec('熟語の接続詞がメニューに出る (発電する)');
{
  const { run, forge } = openForge();
  const wi = run.weapons[0];
  wi.sentence.clear();
  for (const t of ['発', '電', '剣']) wi.sentence.push(makeWord(t));
  wi._sig = null;
  forge.render();
  const place = { kind: 'slot', wi, wIdx: 0, index: 1 };
  const chip = dom.doc.querySelectorAll('.sen-conn')[1];
  const menu = forge.openConnPicker(place, chip);
  const head = menu.querySelector('.conn-picker-head').textContent;
  ok(head.includes('熟語「発電」'), `見出しに熟語が出ない: ${head}`);
  const picks = [...menu.querySelectorAll('.conn-pick')].map((b) => b.textContent);
  ok(picks.includes('する'), `する が候補に無い: ${picks.join(',')}`);
  const btn = [...menu.querySelectorAll('.conn-pick')].find((b) => b.textContent === 'する');
  btn.dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {} });
  ok(wi.sentence.text === '発電する剣', `発電する剣 にならない: ${wi.sentence.text}`);
  const res = wi.resolve(run.player.stats);
  ok(res.valid && res.evalResult.idiom?.phrase === '発電', `発電する剣 が熟語つきで成立しない: ${res.reasonText}`);
  console.log(`  メニュー「${head}」→ 「${wi.sentence.text}」`);
}

console.log(`\n---- 合格 ${pass} / 不合格 ${fail} ----`);
process.exit(fail ? 1 : 0);
