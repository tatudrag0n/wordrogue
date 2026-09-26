// 辞書の健全性と文判定のテスト。      node test/words.test.js
// 1 ステージの完走シミュレーション。   node test/sim.test.js
// ブラウザ実機テスト (Chrome が必要)。  node test/browser.test.js
//
//   全部まとめて:  npm test
//   ブラウザテストだけ:  npm run test:browser

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';

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
  const server = await serve(process.cwd(), PORT);
  try {
    failed += await run('test/browser.test.js');
  } finally {
    server.close();
  }
}

console.log(failed ? '\n=== 失敗したテストがあります ===' : '\n=== すべて成功 ===');
process.exit(failed ? 1 : 0);
