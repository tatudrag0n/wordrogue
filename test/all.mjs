// 辞書の健全性と文判定のテスト。      node test/words.test.js
// 1 ステージの完走シミュレーション。   node test/sim.test.js
// ブラウザ実機テスト (Chrome が必要)。  node test/browser.test.js
//
//   全部まとめて:  npm test
//   ブラウザテストだけ:  npm run test:browser

import { spawn, spawnSync } from 'node:child_process';
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
