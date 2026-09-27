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
  console.log(`== 攻撃种別のラベル ==\n  ${kinds.size} 種類 / 日本語なし ${missing.length} / ラベル無し ${notJa.length}`);
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

  const problems = [];
  for (const f of ['README.md', 'index.html']) {
    const text = await readFile(join(ROOT, f), 'utf8');
    for (const line of text.split('\n')) {
      // 例の行 … <code> を含む行にある 「語」 だけが語を名乗る。
      if (!line.includes('<code>') && !line.includes('| `')) continue;
      for (const g of line.matchAll(/「([^」]+)」/g)) {
        const w = g[1];
        if (WORDS[w] || TAILS.has(w) || STARTERS.has(w)) continue;
        // 文の断片や熟語は segment が効けば正当例。
        if (PHRASE_KEYS.has(w) || segment(w)?.length) continue;
        problems.push(`${f}: 「${w}」`);
      }
      // テーブルや <code> の中の語そのもの。
      for (const g of line.matchAll(/<code>([^<]+)<\/code>|`([^`]+)`/g)) {
        const w = (g[1] || g[2] || '').trim();
        if (!/^[぀-ヿ一-鿿]{1,5}$/.test(w)) continue;
        if (WORDS[w] || TAILS.has(w) || STARTERS.has(w)) continue;
        if (PHRASE_KEYS.has(w) || segment(w)?.length) continue;
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

// 末尾語 -> 攻撃タイプの表 (FORM_INFO) が辞書に追従していること。
// ここが古くなると、末尾語を摆いた武器が攻撃しなくなる。
{
  const { WORDS } = await import(new URL('../js/data/words.js', import.meta.url));
  const { WEAPONS, KIND_LABEL } = await import(new URL('../js/data/weapons.js', import.meta.url));
  const src = await readFile(join(ROOT, 'js/game/weapon.js'), 'utf8');
  const body = src.slice(src.indexOf('const FORM_INFO'));
  const entries = [...body.matchAll(/([\p{Script=Han}]+):\s*\['(\w+)',\s*'(\w+)'\]/gu)]
    .map((m) => ({ text: m[1], shape: m[2], kind: m[3] }));

  const dead = entries.filter((e) => !WORDS[e.text]);
  const noLabel = [...new Set(entries.map((e) => e.kind))].filter((k) => !KIND_LABEL[k]);
  const known = new Set(entries.map((e) => e.text));
  const noInfo = Object.values(WEAPONS).map((w) => w.tail).filter((t) => !known.has(t));

  console.log(`== 末尾語表 ==\n  ${entries.length} 語 / 辞書に無い ${dead.length} / 攻撃名なし ${noLabel.length} / 末尾語医薬品なし ${noInfo.length}`);
  if (dead.length) console.log('  辞書に無い: ' + dead.map((e) => e.text).join(' '));
  if (noLabel.length) console.log('  攻撃名なし: ' + noLabel.join(' '));
  if (noInfo.length) console.log('  未登録: ' + noInfo.join(' '));
  if (dead.length || noLabel.length || noInfo.length) {
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

// 接続詞の結合元が正しく读到こと。
// CONNECT_SOURCES は「1 語 = 1 接続詞」の object なので、同じ語を 2 回書くと
// 後ろので上書きされる (強 が ク でも イ でも 結べるのに イ だけ残った、之类)。
// ここでは「配列になっているか」と「結合できる組の数」で 그것を検出する。
{
  const { CONNECTORS, CONNECT_SOURCES } = await import(new URL('../js/data/words.connect.js', import.meta.url));
  const { WORDS, DRAWABLE_ALL, drawWord } = await import(new URL('../js/data/words.js', import.meta.url));

  // 定義にDuplicate なキーがないか (静かに上書きされる)。
  const src = await readFile(join(ROOT, 'js/data/words.connect.js'), 'utf8');
  const body = src.slice(src.indexOf('export const CONNECT_SOURCES = {'));
  const keys = [...body.matchAll(/^\s{2}([\p{Script=Han}]+):/gmu)].map((m) => m[1]);
  const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
  const unknown = keys.filter((k) => !WORDS[k]);
  const badConn = Object.values(CONNECT_SOURCES)
    .flatMap((v) => [].concat(v))
    .filter((c) => !CONNECTORS[c]);

  // 結合できる (語 x 接続詞) の組が十分あるか。
  let pairs = 0;
  for (const w of DRAWABLE_ALL) {
    const v = CONNECT_SOURCES[w];
    if (!v) continue;
    for (const c of [].concat(v)) if (CONNECTORS[c]) pairs++;
  }
  const words_ = Object.keys(CONNECT_SOURCES).length;
  const rate = pairs / (DRAWABLE_ALL.length * Object.keys(CONNECTORS).length);

  // 接続詞の出る確率。語が増えても下がり続けないように watched している。
  let conn = 0, total = 0;
  for (let i = 0; i < 6000; i++) {
    const w = drawWord(makeRng(i * 2654435761 % 4294967296));
    if (!w) continue;
    total++;
    if (WORDS[w.text].cat === 'connect') conn++;
  }
  const drawRate = conn / Math.max(1, total);

  console.log(`== 接続詞 ==\n  接続詞 ${Object.keys(CONNECTORS).length} 種類`
    + ` / 結合元 ${words_} 語 / 結合できる組 ${pairs} (${(rate * 100).toFixed(1)}%)`
    + `\n  抽選に混ざる割合 ${(drawRate * 100).toFixed(1)}%`
    + `\n  重複キー ${new Set(dup).size} / 語に無い ${unknown.length} / 接続詞に無い ${new Set(badConn).size}`);
  for (const d of new Set(dup)) console.log(`\x1b[31m  キーが重複: ${d}\x1b[0m`);
  for (const u of unknown) console.log(`\x1b[31m  辞書に無い結合元: ${u}\x1b[0m`);
  for (const b of new Set(badConn)) console.log(`\x1b[31m  接続詞に無い: ${b}\x1b[0m`);

  // 下限: 結合元が 100 語を下回ると「引いても宙に浮く」が増える。
  if (words_ < 100) console.log(`\x1b[31m  結合元が ${words_} 語しかない。很高的aes 語が宙に浮く。\x1b[0m`);
  if (drawRate < 0.06) console.log(`\x1b[31m  接続詞の出る確率が低い: ${(drawRate * 100).toFixed(1)}%\x1b[0m`);
  if (drawRate > 0.20) console.log(`\x1b[31m  接続詞が出すぎ: ${(drawRate * 100).toFixed(1)}%\x1b[0m`);

  if (dup.length || unknown.length || badConn.length || words_ < 100
      || drawRate < 0.06 || drawRate > 0.20) {
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
