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
  // 素振り (武器名 1 語) で始まるので、ドラッグテスト用に語を足す。
  const wi = run.weapons[0];
  wi.sentence.clear();
  for (const w of ['炎', '剛', '速']) wi.sentence.push(makeWord(w));
  // 語彙にも語を入れる (ドラッグ元)。
  for (const t of ['火', '電', '速', '剛', '氷', '雷', '毒', '土']) run.addWord(makeWord(t), true);
  const forge = new Forge(run, { onChange: () => {}, onClose: () => {}, audio: null });
  forge.open();
  return { run, forge };
};

/** ノードを指してドラッグする。step 回 pointermove を挟む。 */
const drag = (node, toNode, { steps = 3, drop = true } = {}) => {
  const a = centerOf(node);
  const b = centerOf(toNode);
  return dragToPoint(node, b.x, b.y, { steps, drop });
};

/** 座標を指定してドラッグする。自由配置の行では位置が意味を持つ。 */
const dragToPoint = (node, x, y, { steps = 3, drop = true } = {}) => {
  const a = centerOf(node);
  node.dispatchEvent(pointer('pointerdown', a.x, a.y));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    dom.win.dispatchEvent(pointer('pointermove', a.x + (x - a.x) * t, a.y + (y - a.y) * t));
  }
  // 本物のブラウザと同じく、pointerup は掴んだ要素の上で起きる。
  // ここから window まで伝わり、window 登録のハンドラも動く。
  if (drop) node.dispatchEvent(pointer('pointerup', x, y));
  return { a, b: { x, y } };
};

/** タップ。pointerup は pointerdown と同じ要素で起こす。 */
const tap = (node) => {
  const p = centerOf(node);
  node.dispatchEvent(pointer('pointerdown', p.x, p.y));
  node.dispatchEvent(pointer('pointerup', p.x, p.y));
};

/** ドラッグ直後の suppressClick が切れるまで待つ。 */
const settle = () => new Promise((r) => setTimeout(r, 5));

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
const rowOf = (forge) => weaponRow(forge).querySelector('.sen-row');
const itemsOf = (forge) => [...rowOf(forge).children]
  .filter((n) => n.classList.contains('sen-item'));
const chipsOf = (forge) => [
  ...weaponRow(forge).querySelectorAll('.sen-word:not(.sen-tail)'),
];
const lexWords = () => [...dom.doc.querySelectorAll('#forgeLexicon .pword:not(.empty)')];
const lexiconBox = () => dom.doc.getElementById('forgeLexicon');
/**
 * 最小 DOM は flex を実際に並べないので、文の語を横一列に置いて
 * x 座標のドロップ判定を本物の画面と同じ条件にする。
 */
const layoutRow = (forge) => {
  const row = rowOf(forge);
  const items = itemsOf(forge);
  const base = row.getBoundingClientRect();
  let x = base.left;
  for (const item of items) {
    item.__setRect({ left: x, top: base.top, width: 64, height: 30 });
    const chip = item.querySelector('.sen-word');
    if (chip?.__setRect) chip.__setRect({ left: x, top: base.top, width: 46, height: 30 });
    x += 64;
  }
  row.__setRect({ left: base.left, top: base.top, width: Math.max(140, x - base.left), height: 36 });
  return items;
};
/** 文の行の末尾 (語の後ろ) の座標。 */
const rowEnd = (forge) => {
  layoutRow(forge);
  const r = rowOf(forge).getBoundingClientRect();
  return { x: r.left + r.width - 1, y: r.top + r.height / 2 };
};
/** 文の語の左端寄り。その語の手前へ落とす。 */
const beforeWord = (chip) => {
  const r = chip.getBoundingClientRect();
  return { x: r.left + Math.max(1, r.width * 0.2), y: r.top + r.height / 2 };
};

sec('語彙から文の行のどこへ落としても入る');
{
  const { run, forge } = openForge();
  const wi = run.weapons[0];
  const before = wi.sentence.text;
  const lex = lexWords()[0];
  const text = lex.querySelector('span').textContent;
  const end = rowEnd(forge);
  dragToPoint(lex, end.x, end.y);
  ok(wi.sentence.text !== before, `文が変わらない: ${before} -> ${wi.sentence.text}`);
  ok(wi.sentence.text.includes(text), `語が入っていない: ${wi.sentence.text} (${text})`);
  ok(!run.lexicon.includes(lex), '語彙に語が残っている');
  ok(forge.dragFrom === null, 'dragFrom が残った');
  console.log(`  行の余白へ「${text}」-> 「${wi.sentence.text}」`);
}

sec('文の行の上なら語の無い見出しへ落としても入る');
{
  const { run, forge } = openForge();
  const wi = run.weapons[0];
  const lex = lexWords()[0];
  const text = lex.querySelector('span').textContent;
  layoutRow(forge);
  const row = rowOf(forge).getBoundingClientRect();
  // 見出し (文の行の外) の座標。
  const head = weaponRow(forge).querySelector('.wrow-head').getBoundingClientRect();
  dragToPoint(lex, row.left + 8, head.top + head.height / 2);
  ok(wi.sentence.text.includes(text), `見出しへのドロップで入らない: ${wi.sentence.text}`);
  console.log(`  語の無い見出しへ「${text}」-> 文の先頭に入った`);
}

sec('語の上に落としても置き換えない (手前に差し込む)');
{
  const { run, forge } = openForge();
  const wi = run.weapons[0];
  const before = wi.sentence.words.map((w) => w.text);
  layoutRow(forge);
  const target = chipsOf(forge)[1] || chipsOf(forge)[0];
  const targetText = target.querySelector('span').textContent;
  // 語彙の語を、文の 2 番目の語の左半分へ落とす。
  const lex = lexWords()[0];
  const text = lex.querySelector('span').textContent;
  const p = beforeWord(target);
  dragToPoint(lex, p.x, p.y);
  const after = wi.sentence.words.map((w) => w.text);
  ok(after.length === before.length + 1,
    `語が差し込まれていない: ${before.join('')} -> ${after.join('')}`);
  ok(after.includes(targetText), `落とした先の語が消えた: ${after.join('')}`);
  const at = after.indexOf(targetText);
  ok(at > 0 && after[at - 1] === text,
    `落とした語が手前に来ていない: ${after.join('')} (落とした語 ${text})`);
  ok(before.every((t) => after.includes(t)), `元の語が消えた: ${after.join('')}`);
  console.log(`  「${before.join('')}」の「${targetText}」の手前へ「${text}」-> 「${after.join('')}」`);
}

sec('語と語のあいだに ✕ も隙間も置かない / 一文プレビューを出さない');
{
  const { run, forge } = openForge();
  const wi = run.weapons[0];
  const row = rowOf(forge);
  const kids = [...row.children];
  const items = kids.filter((n) => n.classList.contains('sen-item'));
  ok(kids.every((n) => n.classList.contains('sen-item') || n.classList.contains('sen-tail')),
    `語以外の子要素がある: ${kids.map((n) => n.className).join(' / ')}`);
  ok(!row.querySelector('.sen-gap'), '語のあいだに隙間が残っている');
  ok(!row.querySelector('.sen-out'), '✕ ボタンが残っている');
  ok(items.length === wi.sentence.count,
    `語の数と表示が合わない: ${items.length} / ${wi.sentence.count}`);
  ok(!weaponRow(forge).querySelector('.sentence'), '一文プレビューが残っている');
  ok(!weaponRow(forge).querySelector('.sn-text'), '一文プレビューの文面が残っている');
  console.log(`  語 ${items.length} / 子要素は語だけ / プレビュー無し`);
}

sec('「静かに燃える聖なる炎」が絶句と表示される');
{
  const { run, forge } = openForge();
  const wi = run.weapons[0];
  wi.sentence.entries = [
    { word: makeWord('静'), conn: makeWord('かに') },
    { word: makeWord('燃'), conn: makeWord('える') },
    { word: makeWord('聖'), conn: makeWord('なる') },
    { word: makeWord('炎'), conn: null },
  ];
  wi._sig = null;
  forge.render();
  const res = wi.resolve(run.player.stats);
  ok(res.valid && res.active, `文が成立しない: ${res.reasonText}`);
  ok(res.grade === 'great', `文の評価が絶句でない: ${res.grade} / ${res.evalResult.natural}`);
  const grade = weaponRow(forge).querySelector('.wrow-grade').textContent.trim();
  ok(grade === '絶句', `画面の評価が絶句でない: ${grade}`);
  ok(!weaponRow(forge).querySelector('.sn-text, .sentence, .sen-gap, .sen-out'),
    '文の下のプレビュー / ✕ / 隙間が残っている');
  console.log(`  「${res.fullText}」自然さ ${res.evalResult.natural.toFixed(2)} / ${grade}`);
}

sec('文の中の語をドラッグで並べ替えられる');
{
  const { run, forge } = openForge();
  const wi = run.weapons[0];
  const text0 = wi.sentence.text;
  const chips = chipsOf(forge);
  ok(chips.length >= 3, `語が足りない: ${chips.length}`);
  const first = chips[0].querySelector('span').textContent;
  const before = [...wi.sentence.words].map((w) => w.text);
  // 行の末尾へ運ぶ (特定のマスを狙わない)。
  const end = rowEnd(forge);
  dragToPoint(chips[0], end.x, end.y);
  const after = wi.sentence.text;
  ok(after !== text0, `文が変わらない: ${text0} -> ${after}`);
  ok(wi.sentence.count === chips.length, `語が失われた: ${wi.sentence.count} / ${chips.length}`);
  ok(wi.sentence.text.startsWith(first) === false, '先頭が動いていない');
  ok(wi.sentence.text.endsWith(first), `末尾に移っていない: ${after}`);
  const now = wi.sentence.words.map((w) => w.text);
  ok(before.every((t) => now.includes(t)), `語が置き換わった: ${before.join('')} -> ${now.join('')}`);
  ok(wi.sentence.len <= wi.sentence.maxLen, `10 文字を超えた: ${wi.sentence.len}`);
  console.log(`  「${text0}」-> 「${after}」`);
}

sec('文 → 文も置き換えず、落とした位置へ差し込む');
{
  const { run, forge } = openForge();
  const wi = run.weapons[0];
  const before = wi.sentence.words.map((w) => w.text);
  layoutRow(forge);
  ok(before.length >= 3, `語が足りない: ${before.length}`);
  const last = before[before.length - 1];
  const firstChip = chipsOf(forge)[0];
  const p = beforeWord(firstChip);
  dragToPoint(chipsOf(forge).at(-1), p.x, p.y);
  const after = wi.sentence.words.map((w) => w.text);
  ok(after.length === before.length, `語が増減した: ${before.join('')} -> ${after.join('')}`);
  ok(after[0] === last, `先頭へ差し込まれていない: ${after.join('')}`);
  ok(before.every((t) => after.includes(t)), `語が置き換わった: ${after.join('')}`);
  console.log(`  「${before.join('')}」の末尾語を先頭へ -> 「${after.join('')}」`);
}

sec('文の語を語彙へドラッグで戻せる');
{
  const { run, forge } = openForge();
  const free0 = run.lexiconFreeCount;
  const chip = chipsOf(forge)[0];
  const text = chip.querySelector('span').textContent;
  // 語彙の箱の、語と語のあいだの余白へ落とす。
  drag(chip, lexiconBox());
  ok(!wi_holds(run, text), `文に語が残っている: ${wi_holds(run, text)}`);
  ok(run.lexiconFreeCount === free0 - 1, `空きが増えていない: ${free0} -> ${run.lexiconFreeCount}`);
  ok(run.lexicon.some((w) => w && w.text === text), '語彙に戻っていない');
  console.log(`  「${text}」-> 語彙の箱 / 空き ${free0} -> ${run.lexiconFreeCount}`);
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

sec('語彙の語をタップすると Arm & 行の余白タップで末尾に置ける');
{
  const { run, forge } = openForge();
  const wi = run.weapons[0];
  const before = wi.sentence.count;
  const lex = lexWords()[0];
  const text = lex.querySelector('span').textContent;
  tap(lex);
  ok(forge.armed, 'Arm されない');
  // 描き直されるので文の行を取り直す。行の余白 = 末尾へ。
  tap(rowOf(forge));
  ok(wi.sentence.count === before + 1, `語が入らない: ${before} -> ${wi.sentence.count}`);
  ok(wi.sentence.text.endsWith(text), `語が末尾に入っていない: ${wi.sentence.text}`);
  ok(forge.armed === null, 'Arm が残る');
  console.log(`  Arm「${text}」-> 行の余白タップ -> 「${wi.sentence.text}」`);
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
    const end = rowEnd(forge);
    dragToPoint(lex, end.x, end.y);
  }
  const full = wi.sentence.len;
  // 残った語をすべて試しても 10 文字を超えない。
  for (const lex of lexWords().slice(0, 6)) {
    const end = rowEnd(forge);
    dragToPoint(lex, end.x, end.y);
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

sec('文の語を長押しすると接続詞の一覧が出る (スクロールで選ぶ)');
{
  const { run, forge } = openForge();
  const wi = run.weapons[0];
  const text0 = wi.sentence.text;
  const first = chipsOf(forge)[0].querySelector('span').textContent;
  await longPress(chipsOf(forge)[0]);
  const menu = dom.doc.querySelector('.conn-picker');
  ok(menu && menu.classList.contains('conn-picker'), '長押しで接続詞メニューが開かない');
  const head = menu.querySelector('.conn-picker-head').textContent;
  ok(head.startsWith(first), `見出しがその語でない: "${head}" (期待 ${first} …)`);
  ok(wi.sentence.text === text0, `長押しで文が変わった: ${wi.sentence.text}`);
  // いま付いている接続詞 (無ければ「なし」) を選ぶと、文は変わらずに閉じる。
  const cur = [...menu.querySelectorAll('.conn-pick')].find((b) => b.classList.contains('cur'));
  ok(!!cur, 'いまの状態の候補がメニューに無い');
  cur.dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {} });
  ok(wi.sentence.text === text0, `同じ接続詞を選んだのに文が変わった: ${wi.sentence.text}`);
  ok(!dom.doc.querySelector('.conn-picker'), '選んだのにメニューが残る');
  console.log(`  長押し「${first}」→ 一覧「${head}」→ 文は「${wi.sentence.text}」のまま`);
}

sec('文の語はドラッグで語彙へ戻せる');
{
  const { run, forge } = openForge();
  const wi = run.weapons[0];
  const free0 = run.lexiconFreeCount;
  const text = chipsOf(forge)[0].querySelector('span').textContent;
  drag(chipsOf(forge)[0], lexiconBox());
  await settle();
  ok(wi.sentence.words.every((w) => w.text !== text), `文に語が残っている: ${wi.sentence.text}`);
  ok(run.lexicon.some((w) => w && w.text === text), '語彙に戻っていない');
  ok(run.lexiconFreeCount === free0 - 1, `空きが増えていない: ${free0} -> ${run.lexiconFreeCount}`);
  ok(forge.dragFrom === null, 'dragFrom が残った');
  console.log(`  文の語をドラッグ -> 語彙へ戻った (空き ${free0} -> ${run.lexiconFreeCount})`);
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
  // 語 + 接続詞 の 1 組が薄くなる。
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
  tap(rowOf(forge));
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

sec('約束された剣 を UI から作れる (熟語自身の受身)');
{
  const { run, forge } = openForge();
  const wi = run.weapons[0];
  wi.sentence.clear();
  for (const t of ['約', '束', '剣']) wi.sentence.push(makeWord(t));
  wi._sig = null;
  forge.render();
  const place = { kind: 'slot', wi, wIdx: 0, index: 1 };
  const chip = dom.doc.querySelectorAll('.sen-conn')[1];
  const menu = forge.openConnPicker(place, chip);
  const head = menu.querySelector('.conn-picker-head').textContent;
  ok(head.includes('熟語「約束」'), `見出しに熟語が出ない: ${head}`);
  const picks = [...menu.querySelectorAll('.conn-pick')].map((b) => b.textContent);
  ok(picks.includes('された'), `された が候補に無い: ${picks.join(',')}`);
  ok(!picks.includes('る'), `末尾の 1 字 (束る) の活用が混ざる: ${picks.join(',')}`);
  ok(!picks.includes('す'), `末尾の 1 字 (束す) の活用が混ざる: ${picks.join(',')}`);
  const btn = [...menu.querySelectorAll('.conn-pick')].find((b) => b.textContent === 'された');
  btn.dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {} });
  ok(wi.sentence.text === '約束された剣', `約束された剣 にならない: ${wi.sentence.text}`);
  const res = wi.resolve(run.player.stats);
  ok(res.valid, `約束された剣 が不成文: ${res.reasonText}`);
  ok(res.active, '約束された剣 が攻撃しない');
  ok(res.evalResult.idiom?.phrase === '約束', `熟語として評価されない: ${res.evalResult.idiom?.phrase}`);
  console.log(`  メニュー「${head}」→ 「${wi.sentence.text}」 ${res.gradeInfo.name}`);
}

sec('熟語が成立すると、構成する語が光る');
{
  const { run, forge } = openForge();
  const wi = run.weapons[0];
  const setSen = (...ws) => {
    wi.sentence.clear();
    for (const t of ws) wi.sentence.push(makeWord(t));
    if (ws.length > 3) wi.sentence.setConnAt(2, 'の');
    wi._sig = null;
    forge.render();
  };
  const litTexts = () => chipsOf(forge)
    .filter((c) => c.classList.contains('idiom-word'))
    .map((c) => (c.querySelector('span')?.textContent || c.textContent).trim());

  // 熟語でない文では光らない。開いた直後の初回描画でも弾まない。
  setSen('焔', '硬', '刃');
  ok(litTexts().length === 0, `熟語でないのに光っている: ${litTexts().join(',')}`);
  ok(!weaponRow(forge).classList.contains('idiom-born'), '初回描画で成立演出が出た');

  // 毒蝕弾の硬刃。熟語 (毒・蝕・弾) の 3 語だけが光り、成立の瞬間は行が弾む。
  setSen('毒', '蝕', '弾', '硬', '刃');
  ok(wi.sentence.text === '毒蝕弾の硬刃', `文が違う: ${wi.sentence.text}`);
  ok(litTexts().join('') === '毒蝕弾', `光る語が熟語と違う: ${litTexts().join(',')}`);
  ok(weaponRow(forge).classList.contains('idiom-born'), '成立した瞬間に行が光らない');

  // 同じ熟語のまま描き直しても、成立演出は繰り返さない。
  forge.render();
  ok(!weaponRow(forge).classList.contains('idiom-born'), '再描画でも成立演出が繰り返された');
  ok(litTexts().join('') === '毒蝕弾', `光り続けていない: ${litTexts().join(',')}`);
  console.log(`  毒蝕弾の硬刃 → 光る語「${litTexts().join('・')}」`);
}

sec('語彙の＋で属性語から特殊武器の文を作る');
{
  const { run, forge } = openForge();
  // 語彙を空にしてから 光 (属性語) を 1 つ置く。
  run.lexicon.fill(null);
  run.lexicon[0] = makeWord('光');
  forge.render();
  ok(!!run.lexicon[0] && run.lexicon[0].text === '光', '語彙に光を置けない');
  ok(run.canCraftFromWord(run.lexicon[0]) === true, '属性語から文を作れない');

  const chip = lexWords()[0];
  ok(!!chip, '語彙に「光」が出ない');
  const plus = chip.querySelector('.pword-craft');
  ok(!!plus && !plus.classList.contains('disabled'), '語彙に＋ ボタンが無い');

  const w0 = run.weapons.length;
  tap(plus);
  ok(run.weapons.length === w0 + 1, `＋ で新しい文が増えない: ${w0} -> ${run.weapons.length}`);
  const wi = run.weapons[run.weapons.length - 1];
  ok(wi.sentence.words.some((w) => w.text === '光'), `作った文に「光」が無い: ${wi.sentence.text}`);
  ok(!run.lexicon.some((w) => w && w.text === '光'), '語彙から「光」が消えていない');
  let res = wi.resolve(run.player.stats);
  ok(!res.active && !res.valid, `語 1 つなのに扱いが違う: ${res.reason}`);
  wi.sentence.push(makeWord('氷'));
  res = wi.resolve(run.player.stats);
  ok(res.valid && !res.active && res.pending,
    `動詞待ちになっていない: valid=${res.valid} active=${res.active} pending=${res.pending}`);
  ok(res.stats.dmg === 0, `動詞待ちで威力が付いている: ${res.stats.dmg}`);

  // 増えた行にも文の操作が一通り揃っている。
  forge.selWeapon = wi;
  forge.selIndex = wi.sentence.count;
  forge.render();
  const rows = [...dom.doc.querySelectorAll('#forgeWeapons .wrow')];
  const newRow = rows.find((r) => r.textContent.includes('光'));
  ok(!!newRow, '作った文が武器欄に出ない');
  ok(!!newRow.querySelector('.sen-row'), '新しい文の行が無い');
  ok(!newRow.querySelector('.sen-gap'), '新しい文に隙間が残っている');
  console.log(`  ＋ →「${wi.sentence.text}」(${run.weapons.length} 本目)`);
}

sec('物の語 (弾・環・玉) は武器語ではない — ＋ も付かない');
{
  const { run, forge } = openForge();
  run.lexicon.fill(null);
  for (const t of ['弾', '環', '玉', '壁', '剣']) run.giveWord(makeWord(t), true);
  forge.render();
  const chips = lexWords();
  ok(chips.length >= 4, `語彙が足りない: ${chips.length}`);
  for (const c of chips) {
    const t = c.querySelector('span').textContent;
    if (t === '剣') { ok(!!c.querySelector('.pword-craft'), `武器語「${t}」に＋ が無い`); continue; }
    ok(!c.querySelector('.pword-craft'), `物の語「${t}」に＋ が付いている`);
  }
  // 物の語の語彙は文の中にも置ける (ただの語)。置いた語は取り外せる。
  const wi = run.weapons[0];
  const tama = chips.find((c) => c.querySelector('span').textContent === '弾');
  ok(!!tama, '語彙に「弾」が無い');
  const before = wi.sentence.count;
  const end = rowEnd(forge);
  dragToPoint(tama, end.x, end.y);
  await settle();
  ok(wi.sentence.count === before + 1, `物の語が文に置けない: ${wi.sentence.text}`);
  forge.render();
  // 取り外しは語彙の箱へのドラッグで行う (別テストで確認)。

  // 文まるごと外す (.wrow-drop) と、語が語彙に戻る。
  // 武器語「剣」の文を 1 本作って、そこに行き着く。
  const kenChip = lexWords().find((c) => c.querySelector('span').textContent === '剣');
  ok(!!kenChip, '語彙に「剣」が無い');
  await settle();
  tap(kenChip.querySelector('.pword-craft'));
  ok(run.weapons.length === 2, `「剣」から文が増えない: ${run.weapons.length}`);
  await settle();
  forge.render();
  const drop = [...dom.doc.getElementById('forgeWeapons').querySelectorAll('.wrow-drop')][0];
  ok(!!drop, '文を外すボタンが無い');
  const w0 = run.weapons.length;
  const lexBefore = run.lexicon.filter(Boolean).length;
  ok(!!drop, '文を外すボタンが無い');
  await settle();
  tap(drop);
  ok(run.weapons.length === w0 - 1, `文が外れない: ${w0} -> ${run.weapons.length}`);
  ok(run.lexicon.filter(Boolean).length >= lexBefore, '外した文の語が語彙に戻っていない');
  ok(run.lexicon.some((w) => w && w.text === '剣'), '「剣」が語彙に戻らない');
  console.log(`  「弾」は語彙から引けて文に置ける / 文は ${run.weapons.length} 本`);
}

sec('文末は語で閉じる。接続詞で終わる文は不成文');
{
  const { run, forge } = openForge();
  const wi = run.weapons[0];
  wi.sentence.clear();
  for (const w of ['氷', '斬']) wi.sentence.push(makeWord(w));
  wi.sentence.setConnAt(0, 'を');
  wi.sentence.setConnAt(1, 'る');
  wi._sig = null;
  const r1 = wi.resolve(run.player.stats);
  ok(!r1.valid, '「氷を斬る」が成立してしまった');
  ok(r1.reason === 'tailconn', '理由が tailconn でない: ' + r1.reason);

  // 語を足して文末を閉じれば成立する。
  wi.sentence.clear();
  for (const w of ['氷', '斬', '針']) wi.sentence.push(makeWord(w));
  wi.sentence.setConnAt(0, 'を');
  wi.sentence.setConnAt(1, 'る');
  wi._sig = null;
  const r2 = wi.resolve(run.player.stats);
  ok(r2.valid && r2.active, '「氷を斬る針」が不成文: ' + r2.reasonText);
  ok(r2.element === 'ice', '属性が ice でない: ' + r2.element);
  ok(r2.stats.dmg > 0, 'dmg が 0 以下: ' + r2.stats.dmg);

  // 現象語の特殊武器も、動詞の述語 + 末尾の語で成立する。
  wi.sentence.clear();
  for (const w of ['焔', '燃', '渦']) wi.sentence.push(makeWord(w));
  wi.sentence.setConnAt(1, 'える');
  wi._sig = null;
  const r3 = wi.resolve(run.player.stats);
  ok(r3.valid && r3.active, '「焔燃える渦」が不成文: ' + r3.reasonText);
  ok(r3.special === true && r3.tail === '渦', '特殊武器「渦」が発動しない: '
    + `special=${r3.special} tail=${r3.tail}`);
  ok(r3.kind === 'orbit', 'kind が orbit でない: ' + r3.kind);
  console.log('  文末が接続詞 (る・える) の文は不成文 / 語を足すと成立');
}

console.log(`\n---- 合格 ${pass} / 不合格 ${fail} ----`);
process.exit(fail ? 1 : 0);
