// 辞書の健全性と文判定のテスト。      node test/words.test.js
// 1 ステージの完走シミュレーション。   node test/sim.test.js
// ブラウザ実機テスト (Chrome が必要)。  node test/browser.test.js
//
//   全部まとめて:  npm test
//   ブラウザテストだけ:  npm run test:browser

import { spawn, spawnSync } from 'node:child_process';
import { makeRng } from '../js/core/util.js';
import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** js/ と test/ の全ファイルを構文検査する。書き損じの早期検出用。 */
async function collect(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await collect(p, out);
    else if (/\.(js|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

const files = [
  ...(await collect(join(ROOT, 'js'))),
  ...(await collect(join(ROOT, 'test'))),
];
let syntaxBad = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) {
    syntaxBad++;
    console.log(`\x1b[31m構文エラー\x1b[0m ${f.replace(ROOT, '')}`);
    console.log((r.stderr || '').split('\n').slice(0, 4).join('\n'));
  }
}
console.log(`== 構文検査 ==\n  ${files.length} ファイル / 不正 ${syntaxBad}`);
if (syntaxBad) {
  console.log('\n=== 失敗したテストがあります ===');
  process.exit(1);
}

// 日本語ファイルが壊れていないか。U+FFFD は文字化けで、
// 編集中に混入するとそのまま画面に出る。HTML / CSS / MD まで含めて全部見る。
{
  const textExt = /\.(js|mjs|html|css|md)$/;
  const targets = [...files];
  for (const dir of ['css', 'test']) {
    for (const e of await readdir(join(ROOT, dir), { withFileTypes: true })) {
      if (e.isFile() && textExt.test(e.name)) targets.push(join(ROOT, dir, e.name));
    }
  }
  for (const e of await readdir(ROOT, { withFileTypes: true })) {
    if (e.isFile() && textExt.test(e.name)) targets.push(join(ROOT, e.name));
  }

  const broken = [];
  for (const f of targets) {
    const text = await readFile(f, 'utf8');
    const n = (text.match(/\uFFFD/g) || []).length;
    if (n) broken.push(`${f.replace(ROOT, '')} (${n})`);
  }
  console.log(`== 文字化け検査 ==\n  ${targets.length} ファイル / U+FFFD ${broken.length}`);
  for (const b of broken) console.log(`\x1b[31m  ${b}\x1b[0m`);
  if (broken.length) {
    console.log('\n=== 失敗したテストがあります ===');
    process.exit(1);
  }
}

// 攻撃の種類にはすべて日本語のラベルがあるはず。raw な kind が
// UI に出ると「boomerang」のような英字が出るので、ここで止める。
{
  const { WEAPONS, KIND_LABEL } = await import(new URL('../js/data/weapons.js', import.meta.url));
  const kinds = new Set(Object.values(WEAPONS).map((d) => d.kind));
  const missing = [...kinds].filter((k) => !KIND_LABEL[k]);
  const notJa = [...kinds].filter((k) => KIND_LABEL[k] && !/[぀-ヿ一-鿿]/.test(KIND_LABEL[k]));
  console.log(`== 攻撃種別のラベル ==\n  ${kinds.size} 種類 / 日本語なし ${missing.length} / ラベル無し ${notJa.length}`);
  if (missing.length) console.log('  ' + missing.join(', '));
  if (missing.length || notJa.length) {
    console.log('\n=== 失敗したテストがあります ===');
    process.exit(1);
  }
}

// 語の効果キーにはすべて日本語のラベルがある。無いと辞書に
// 「magnet 0.5」のように生のキーがそのまま出る。
{
  const { WORDS } = await import(new URL('../js/data/words.js', import.meta.url));
  const { FX_LABEL, PS_LABEL } = await import(new URL('../js/ui/labels.js', import.meta.url));
  const keys = new Set();
  const pkeys = new Set();
  for (const k in WORDS) {
    const w = WORDS[k];
    // 「自身」向けの語は fx と player が同じ内容。player 側だけで見る。
    if (w.cat !== 'buff') for (const a in (w.fx || {})) keys.add(a);
    for (const a in (w.player || {})) pkeys.add(a);
  }
  const missFx = [...keys].filter((k) => !FX_LABEL[k]);
  const missPs = [...pkeys].filter((k) => !PS_LABEL[k]);
  const notJa = (k) => !/[぀-ヿ一-鿿]/.test(k);
  const badJa = [...keys, ...pkeys]
    .filter((k) => (FX_LABEL[k] || PS_LABEL[k]) && notJa(FX_LABEL[k] || PS_LABEL[k]));
  console.log(`== 効果キーのラベル ==\n  武器 ${keys.size} / 自身 ${pkeys.size} / 未定義 ${missFx.length + missPs.length} / 日本語なし ${badJa.length}`);
  if (missFx.length) console.log('  武器: ' + missFx.join(', '));
  if (missPs.length) console.log('  自身: ' + missPs.join(', '));
  if (badJa.length) console.log('  日本語なし: ' + badJa.join(', '));
  if (missFx.length || missPs.length || badJa.length) {
    console.log('\n=== 失敗したテストがあります ===');
    process.exit(1);
  }
}

// 画面や README に出ている例が、実装と矛盾しないこと。
// 前回「刃」+「利」-> 刃利剣 や「迅」のように、辞書に無い語を書いていた。
{
  const { WORDS, PHRASE_BONUS, segment } = await import(new URL('../js/data/words.js', import.meta.url));
  const { WEAPONS } = await import(new URL('../js/data/weapons.js', import.meta.url));
  const { SELF_TAIL } = await import(new URL('../js/game/stats.js', import.meta.url));
  const PHRASE_KEYS = new Set(Object.keys(PHRASE_BONUS));
  // 文の例に現れるので、語とみなしてよいやつ。
  const TAILS = new Set([SELF_TAIL, ...Object.values(WEAPONS).map((w) => w.tail)]);
  const STARTERS = new Set(Object.values(WEAPONS)
    .flatMap((w) => [w.startWord, w.startWord2]).filter(Boolean));
  // 記号。枠のあいだ (接続詞の位置) を示すもので、語ではない。
  const MARKS = new Set(['・', '＿', '·', '+']);

  // 文の例かどうか。
  // 説明文ではな形容詞の連体形を「〜な」（自然な日本語）で書くが、
  // ゲームが作る文面は接続詞の `な` / `かな` になる。
  //   妙な刃 = 妙 + な + 刃 / 静かな刃 = 静 + かな + 刃
  // どちらも同じ文なので、「な」を な / かな に置き換えた分割が通るなら例として認める。
  const segOf = (w) => segment(w)
    || segment(w.replace(/な/g, 'な'))
    || segment(w.replace(/な/g, 'かな'));

  const problems = [];
  for (const f of ['README.md', 'index.html']) {
    const text = await readFile(join(ROOT, f), 'utf8');
    for (const line of text.split('\n')) {
      // 例の行 … <code> を含む行にある 「語」 だけが語を名乗る。
      if (!line.includes('<code>') && !line.includes('| `')) continue;
      // 「不成立」と書いた行はわざと壊した例 (`業火を剛剣`) なので検査しない。
      if (line.includes('不成立') || line.includes('NG')) continue;
      for (const g of line.matchAll(/「([^」]+)」/g)) {
        const w = g[1];
        // 接続詞の意味の説明 (「〜に」など) は語ではない。
        if (w.startsWith('〜')) continue;
        if (WORDS[w] || TAILS.has(w) || STARTERS.has(w)) continue;
        // 文の断片や熟語は segment が効けば正当例。
        if (PHRASE_KEYS.has(w) || segOf(w)?.length) continue;
        problems.push(`${f}: 「${w}」`);
      }
      // テーブルや <code> の中の語そのもの。
      for (const g of line.matchAll(/<code>([^<]+)<\/code>|`([^`]+)`/g)) {
        const w = (g[1] || g[2] || '').trim();
        if (!/^[぀-ヿ一-鿿]{1,5}$/.test(w)) continue;
        if (MARKS.has(w)) continue;
        if (WORDS[w] || TAILS.has(w) || STARTERS.has(w)) continue;
        if (PHRASE_KEYS.has(w) || segOf(w)?.length) continue;
        problems.push(`${f}: \`${w}\``);
      }
    }
  }
  console.log(`== 例の整合性 ==\n  辞書に無い語 ${problems.length}`);
  for (const p of problems) console.log(`\x1b[33m  ${p}\x1b[0m`);
  if (problems.length) {
    console.log('\n=== 失敗したテストがあります ===');
    process.exit(1);
  }
}

// 武器語 -> 攻撃タイプの表 (FORM_SHAPE) が辞書に追従していること。
// ここが古くなると、武器語を置いた武器が攻撃しなくなる。
{
  const { WORDS, WORDS_BY_CAT } = await import(new URL('../js/data/words.js', import.meta.url));
  const { FORM_SHAPE, KIND_LABEL } = await import(new URL('../js/data/weapons.js', import.meta.url));
  const entries = Object.entries(FORM_SHAPE).map(([text, v]) => ({ text, shape: v[0], kind: v[1] }));

  const dead = entries.filter((e) => !WORDS[e.text]);
  const notForm = entries.filter((e) => WORDS[e.text] && WORDS[e.text].cat !== 'form');
  const noLabel = [...new Set(entries.map((e) => e.kind))].filter((k) => !KIND_LABEL[k]);
  const known = new Set(entries.map((e) => e.text));
  const noInfo = WORDS_BY_CAT.form.filter((t) => !known.has(t));

  console.log(`== 武器語表 ==\n  ${entries.length} 語 / 辞書に無い ${dead.length} / 攻撃名なし ${noLabel.length} / 未登録 ${noInfo.length}`);
  if (dead.length) console.log('  辞書に無い: ' + dead.map((e) => e.text).join(' '));
  if (notForm.length) console.log('  武器語でない: ' + notForm.map((e) => e.text).join(' '));
  if (noLabel.length) console.log('  攻撃名なし: ' + noLabel.join(' '));
  if (noInfo.length) console.log('  未登録: ' + noInfo.join(' '));
  if (dead.length || notForm.length || noLabel.length || noInfo.length) {
    console.log('\n=== 失敗したテストがあります ===');
    process.exit(1);
  }
}

// ステージのウェーブが実在する敵を指していること。
//  bosses も、解放される武器のステージ番号も範囲内であること。
{
  const { STAGES } = await import(new URL('../js/data/stages.js', import.meta.url));
  const { ENEMIES, BOSS_IDS } = await import(new URL('../js/data/enemies.js', import.meta.url));
  const { WEAPONS } = await import(new URL('../js/data/weapons.js', import.meta.url));

  const maxStage = STAGES.length;
  const unknown = [];
  for (const s of STAGES) {
    for (const w of s.waves) {
      for (const [id, n] of w.list) {
        if (!ENEMIES[id]) unknown.push(`${s.name}: 敵「${id}」が無い`);
        else if (!Number.isInteger(n) || n <= 0) unknown.push(`${s.name}: 敵「${id}」の数が不正 (${n})`);
      }
      if (w.at < 0 || w.at > s.time) unknown.push(`${s.name}: ウェーブ時刻 ${w.at} が範囲外`);
    }
    if (s.boss && !BOSS_IDS.includes(s.boss)) unknown.push(`${s.name}: ボス「${s.boss}」が無い`);
    if (!s.waves.length) unknown.push(`${s.name}: ウェーブが空`);
  }
  const badUnlock = Object.values(WEAPONS)
    .filter((w) => w.unlock && (w.unlock.stage < 1 || w.unlock.stage > maxStage))
    .map((w) => `${w.name}: 解放ステージ ${w.unlock.stage} が範囲外`);

  // 武器が 1 つも無いステージがあると、中間が飛ばされる。
  const covered = new Set(Object.values(WEAPONS).map((w) => (w.unlock ? w.unlock.stage : 1)));
  for (let i = 1; i <= maxStage; i++) {
    if (!covered.has(i)) unknown.push(`ステージ ${i}: 解放される武器が無い`);
  }

  const all = [...unknown, ...badUnlock];
  console.log(`== ステージ ==\n  ${STAGES.length} 面 / 敵 ${Object.keys(ENEMIES).length} 種 / 問題 ${all.length}`);
  for (const p of all) console.log(`\x1b[31m  ${p}\x1b[0m`);
  if (all.length) {
    console.log('\n=== 失敗したテストがあります ===');
    process.exit(1);
  }
}

// 接続詞の文法。
//   ・どの語も、自分の品詞に合う接続詞を 1 つ以上持つ (行き止まりが無い)
//   ・接続詞は枠を潰さない (「語 + 接続詞」が 1 語に潰れない)
//   ・述語になる接続詞は全部連体形。「〜を」は目的語を取る。
{
  const {
    CONNECTORS, canConnect, isAdnominal, PREDICATE_CONNECTORS,
    NON_ADNOMINAL_CONNECTORS,
  } = await import(new URL('../js/data/words.connect.js', import.meta.url));
  const { WORDS, CONNECTOR_SET, segment, drawWord } = await import(new URL('../js/data/words.js', import.meta.url));

  const connNames = Object.keys(CONNECTORS);
  const content = Object.keys(WORDS).filter((w) => !CONNECTOR_SET.has(w));

  // どの語も、自分の品詞に合う接続詞を 1 つ以上持つ。
  const deadEnd = [];
  // 「語 + 接続詞」が 1 語に潰れないこと (合成語にならず、辞書の別の語に食われる)。
  const collapsed = [];
  let bindable = 0;
  for (const w of content) {
    const mine = connNames.filter((c) => canConnect(WORDS[w], c));
    bindable += mine.length;
    if (!mine.length) deadEnd.push(`${w}(${WORDS[w].pos})`);
    for (const c of mine) {
      const segs = segment(w + c);
      if (!segs || segs.length !== 2 || segs[0] !== w || segs[1] !== c) {
        collapsed.push(`${w}+${c} -> ${segs ? segs.join('/') : 'null'}`);
      }
    }
  }
  const pairs = content.length * connNames.length;

  // 接続詞の形が日本語として破綻していないこと。
  //   名詞を修飾できないのは「連用形・続用形」だけのはず。
  //   「な」は な形容詞 の連体形「〜な」なので名詞を修飾できる。
  const shapeErrors = [];
  // 名詞を修飾しない形。連用形 (く・にの連用「静かに」) と続用形 (せし・り)。
  const NOT_ADN = ['く', 'せし', 'り'];
  for (const c of NOT_ADN) {
    if (!NON_ADNOMINAL_CONNECTORS.has(c)) shapeErrors.push(`${c}: 名詞を修飾できるはず`);
  }
  for (const c of NON_ADNOMINAL_CONNECTORS) {
    if (!NOT_ADN.includes(c)) shapeErrors.push(`${c}: 連用形・断定形・続用形ではない`);
    if (isAdnominal(c)) shapeErrors.push(`${c}: 連体形なのに非連体`);
  }
  // 述語のうち、連体形でもあるもの (「〜された」「〜る」「〜する」) は末尾語を修飾できる。
  for (const c of ['された', 'われた', 'られた', 'る', 'する']) {
    if (!PREDICATE_CONNECTORS.has(c)) shapeErrors.push(`${c}: 述語に入れていない`);
    if (!isAdnominal(c)) shapeErrors.push(`${c}: 連体形でない`);
  }

  // 接続詞は 3 択の抽選に出ない。鍛冶下部の接続詞プールから無限に置く。
  let conn = 0, total = 0;
  for (let i = 0; i < 6000; i++) {
    const w = drawWord(makeRng(i * 2654435761 % 4294967296));
    if (!w) continue;
    total++;
    if (WORDS[w.text].cat === 'connect') conn++;
  }
  const drawRate = conn / Math.max(1, total);

  console.log(`== 接続詞 ==\n  接続詞 ${connNames.length} 種類 / 実質語 ${content.length} 語`
    + ` / 結合できる組 ${bindable} (${((bindable / pairs) * 100).toFixed(1)}%)`
    + `\n  抽選に混ざる割合 ${(drawRate * 100).toFixed(1)}% (プールから無限)`
    + `\n  合成に潰れる ${collapsed.length} / 行き止まり ${deadEnd.length} / 形の誤り ${shapeErrors.length}`);
  for (const x of deadEnd.slice(0, 20)) console.log(`\x1b[31m  どの接続詞も結べない: ${x}\x1b[0m`);
  for (const x of collapsed.slice(0, 20)) console.log(`\x1b[31m  1 語に潰れる: ${x}\x1b[0m`);
  for (const x of shapeErrors.slice(0, 20)) console.log(`\x1b[31m  形が誤り: ${x}\x1b[0m`);

  if (drawRate > 0) console.log(`\x1b[31m  抽選に接続詞が混ざっている: ${(drawRate * 100).toFixed(1)}%\x1b[0m`);

  if (collapsed.length || deadEnd.length || shapeErrors.length || drawRate > 0) {
    console.log('\n=== 失敗したテストがあります ===');
    process.exit(1);
  }
}

// 語彙は 1 文字の漢字だけ。かなも 2 字以上の語も入れない。
//
// 2 漢字のな形容詞 (滑らか 適切 確実…) も入れない。
// 「静かな」「確かな」「滑らかな」は 1 漢字語 + 接続詞 かな で作る。
//   静 + かな = 静かな刃 / 確 + かな = 確かな刃 / 滑 + かな = 滑かな刃
// 接続詞はひらがな。実質語にはかなも 2 文字も現れない (接続詞は別に数える)。
{
  const { WORDS, CONNECTOR_SET } = await import(new URL('../js/data/words.js', import.meta.url));
  const KANA = /[ぁ-んァ-ヶー]/;
  const long = [];
  const kana = [];
  for (const w of Object.keys(WORDS)) {
    if (CONNECTOR_SET.has(w)) continue;      // 接続詞はひらがな (された かな など)
    if (KANA.test(w)) kana.push(w);
    if (w.length > 1) long.push(w);
  }
  console.log(`== 語彙 ==\n  実質語 ${Object.keys(WORDS).length - CONNECTOR_SET.size} 語`
    + ` / かな ${kana.length} / 2 字以上 ${long.length}`);
  for (const w of kana.slice(0, 20)) console.log(`\x1b[31m  かなの語: ${w}\x1b[0m`);
  for (const w of long.slice(0, 20)) console.log(`\x1b[31m  2 字以上: ${w}\x1b[0m`);

  if (kana.length || long.length) {
    console.log('\n=== 失敗したテストがあります ===');
    process.exit(1);
  }
}

// 1 文字の語は「単独で日本語の語になる」ものだけ。
//
// 以前は熟語の部品 (袈・裟・以・攻・一・千・角…) を語として置いていたため、
// 語彙に引かれると「袈刺青硬剣」のような意味の無い名前になっていた。
// 部品は辞書に置かず、熟語は中身のある語だけで組む。
{
  const { WORDS, ADJ_STEMS, NA_ADJ_STEMS, segment } = await import(new URL('../js/data/words.js', import.meta.url));
  const { PHRASE_BONUS } = await import(new URL('../js/data/words.phrase.js', import.meta.url));

  // 単独で 1 文字の語として許すもの。形容語幹 (「〜い」「〜な」になる) か、
  // 立派な名詞。1 文字の語を足すときはこのリストにも足すこと。
  const OK_ONE = new Set([
    // 属性 (全部 1 文字の漢字)
    '火', '炎', '焔', '創', '炭', '烈', '煙', '灰',
    '氷', '雪', '霜', '冬',
    '電', '震', '磁',
    '毒', '液', '蝕', '霧', '菌', '瘴',
    '聖', '神', '輝', '耀', '陽', '霞', '皓', '青', '白', '赤',
    '闇', '暗', '黒', '夜', '死', '魔', '影', '漆',
    '土', '砂', '塵', '地', '陸', '崖', '原',
    '風', '嵐', '突', '旋', '疾', '翔',
    '草', '樹', '苔', '芽', '緑', '根', '花',
    '鉄', '鋼', '銀', '錬', '峰', '嶺', '鉱',
    '血', '呪', '蓮', '紅',
    '水', '波', '流', '泡', '淵', '露', '潮', '浪',
    '金', '財', '宝',
    // 武器語 (形を表す語)
    '刃', '剣', '刀', '斧', '槍', '矛', '戈', '牙', '爪',
    '弾', '銃', '玉', '矢', '針', '弓', '球', '珠', '還', '光', '雷',
    '塊', '岩', '石', '環', '輪', '鞭', '鎖', '壁', '網', '盾',
    // 効果語 (体言のもの)
    // 「巨」は体言として許可する。な形容詞は「巨大」であって「巨」ではない。
    //   「巨な」は日本語に無いので `巨` はな形容の語幹表に入れず、接続詞は の・に・へ・を だけ。
    //   単独でも名詞（きょ = 大きいもの）だし、接尾語としても使う（巨刃 / 巨剛）。
    //   「続」「穿」「回」と同じ扱い。巨 + 大 + 刃 と並べれば「巨大な刃」になる。
    '冷', '宏', '巨', '心', '圧', '律', '斉', '引', '導', '徹', '執', '瞬', '会',
    '必', '急', '反', '退', '衰', '合', '再', '回', '続', '減', '特', '囲',
    '捷', '衆', '昂', '威', '打', '防', '程', '撃', '連', '固', '湧', '潤',
    '発', '穢', '優', '護', '結', '穿', '通',
    // 効果語 (接頭語・接尾語として使う語。な形容詞ではない)
    //
    //   これらは「X な」が日本語に無いので `NA_ADJ_STEMS` には置かない。
    //   静な ✗ (静か) / 剛な ✗ (剛刃) / 豪な ✗ (豪快) / 滑な ✗ (滑らか)
    //   名詞・接尾語として扱い、接続詞は の・に・へ・を にする。
    //   1 文字でも日本語の成分語として実際に使われるので許可する。
    //   「袈」「裟」のような熟語の部品だけの語ではない (静寂 / 剛硬鋼 / 豪快 …)。
    '静', '穏', '無', '厳', '敵', '奇', '豪', '雅', '華', '麗', '精', '密',
    '真', '素', '正', '賢', '酷', '確', '活', '端', '滑', '準', '霊', '適',
    '剛', '壮', '清',
    // 自身
    '人', '頑', '健', '躯', '柄', '走', '鎧', '甲', '王', '戒', '符', '薬',
    '癒', '晶', '書', '察', '永', '楽', '幸',
    // 核語
    '志', '力', '巧', '守', '感', '智',
  ]);

  // 動詞 (「斬」「貫」) と接続詞は 1 文字が普通なので対象外。
  // -fragment な体言・効果語だけを調べた。
  const NOUNISH = new Set(['element', 'form', 'modifier', 'buff']);
  const stray = Object.keys(WORDS).filter((w) => w.length === 1
    && NOUNISH.has(WORDS[w].cat)
    && !ADJ_STEMS.has(w) && !NA_ADJ_STEMS.has(w) && !OK_ONE.has(w));

  // 熟語は「辞書にある語だけで」完全に分割できること。
  const broken = Object.keys(PHRASE_BONUS).filter((k) => !segment(k));

  console.log(`== 1 文字の語 ==\n  許可して無い ${stray.length} / 作れない熟語 ${broken.length}`);
  for (const w of stray) console.log(`\x1b[31m  1 文字の断片: ${w}\x1b[0m`);
  for (const k of broken) console.log(`\x1b[31m  熟語が組めない: ${k}\x1b[0m`);

  if (stray.length || broken.length) {
    console.log('\n=== 失敗したテストがあります ===');
    process.exit(1);
  }
}

const PORT = Number(process.env.PORT || 8099);
const startServer = process.env.NO_SERVE !== '1';

const run = (file) => new Promise((res) => {
  const p = spawn(process.execPath, [file], { stdio: 'inherit' });
  p.on('exit', (code) => res(code ?? 1));
});

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/** 依存なしの静的ファイルサーバ。ブラウザテスト用に使う。 */
function serve(root, port) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let p = decodeURIComponent(url.pathname);
      if (p === '/') p = '/index.html';
      // ルート外に出るパスは拒む。
      const full = join(root, normalize(p).replace(/^([/\\])+/, ''));
      if (!full.startsWith(root)) { res.writeHead(403).end('forbidden'); return; }
      const s = await stat(full);
      if (s.isDirectory()) { res.writeHead(404).end('not found'); return; }
      const buf = await readFile(full);
      res.writeHead(200, {
        'content-type': MIME[extname(full).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(buf);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((res) => {
    server.listen(port, () => res(server));
  });
}

let failed = 0;

failed += await run('test/words.test.js');
failed += await run('test/sim.test.js');
failed += await run('test/forge.drag.test.js');

if (startServer) {
  const server = await serve(ROOT, PORT);
  // サーバが応答するまで待つ。すぐテストを走らせると
  // ページを取得できず「Failed to fetch」になる。
  let up = false;
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/index.html`);
      if (r.ok) { up = true; break; }
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  if (!up) {
    console.log('サーバが起動しなかった。ブラウザテストをスキップする。');
    server.close();
  } else {
    try {
      failed += await run('test/browser.test.js');
    } finally {
      server.close();
    }
  }
}

console.log(failed ? '\n=== 失敗したテストがあります ===' : '\n=== すべて成功 ===');
process.exit(failed ? 1 : 0);
