// BGM ファイルの健全性と、生成ツール (tools/bgm.py) の決定性のテスト。
//   node test/audio.test.mjs
//
// BGM は tools/bgm.py が作るステレオ WAV。ここでは「配るファイルが
// 壊れていないこと」と「同じ種から同じファイルが出来ること」を見る。
// 生成の再実行は 1 曲だけに絞る (全曲だと遅い)。
import { spawnSync } from 'node:child_process';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const sec = (t) => console.log(`\n== ${t} ==`);

/** WAV のヘッダと中身の統計を読む (16bit PCM 前提)。 */
async function readWav(path) {
  const buf = await readFile(path);
  ok(buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE',
    `${path} が WAV でない`);
  const ch = buf.readUInt16LE(22);
  const rate = buf.readUInt32LE(24);
  const bits = buf.readUInt16LE(34);
  // data チャンクを探す (fmt 以外のチャンクが挟まってもよいように走査)。
  let off = 12, dataOff = -1, dataLen = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const len = buf.readUInt32LE(off + 4);
    if (id === 'data') { dataOff = off + 8; dataLen = len; break; }
    off += 8 + len + (len % 2);
  }
  ok(dataOff > 0, `${path} に data チャンクが無い`);
  const n = Math.floor(dataLen / (2 * ch));
  let ss = 0, peak = 0;
  for (let i = 0; i < n * ch; i++) {
    const v = buf.readInt16LE(dataOff + i * 2) / 32768;
    ss += v * v;
    const a = Math.abs(v);
    if (a > peak) peak = a;
  }
  return { ch, rate, bits, dur: n / rate, rms: Math.sqrt(ss / (n * ch)), peak };
}

const NAMES = [...Array(19)].map((_, i) => `stage${i + 1}`).concat(['boss']);

sec('BGM ファイル: 形式と音量がそろっている');
{
  const stats = [];
  for (const name of NAMES) {
    const s = await readWav(join(ROOT, 'assets', 'bgm', `${name}.wav`));
    ok(s.ch === 2, `${name} がステレオでない: ${s.ch}ch`);
    ok(s.rate === 32000, `${name} のサンプリングレート: ${s.rate}`);
    ok(s.bits === 16, `${name} のビット数: ${s.bits}`);
    ok(s.dur >= 10 && s.dur <= 20, `${name} の長さ: ${s.dur.toFixed(1)}s`);
    ok(s.peak > 0.5 && s.peak <= 0.99, `${name} のピーク: ${s.peak.toFixed(2)}`);
    ok(s.rms > 0.08 && s.rms < 0.25, `${name} の RMS: ${s.rms.toFixed(3)}`);
    stats.push(s);
  }
  const rmss = stats.map((s) => s.rms);
  const ratio = Math.max(...rmss) / Math.min(...rmss);
  ok(ratio < 1.6, `曲ごとの RMS のばらつきが大きい: ${ratio.toFixed(2)} 倍`);
}

sec('BGM 生成: 同じ種からは同じファイルが出来る');
{
  const py = spawnSync('python3', ['-c', 'pass'], { encoding: 'utf8' });
  if (py.status !== 0) {
    console.log('  python3 が無いので生成テストは飛ばす');
  } else {
    const dirs = [];
    try {
      const bufs = [];
      for (let k = 0; k < 2; k++) {
        const dir = await mkdtemp(join(tmpdir(), 'wr-bgm-'));
        dirs.push(dir);
        const r = spawnSync('python3',
          [join(ROOT, 'tools', 'bgm.py'), '--only', 'stage1', '--out', dir],
          { encoding: 'utf8', timeout: 120000 });
        ok(r.status === 0, `bgm.py の実行に失敗: ${(r.stderr || '').slice(0, 200)}`);
        bufs.push(await readFile(join(dir, 'stage1.wav')));
      }
      ok(bufs[0].equals(bufs[1]), '再生成した stage1.wav が一致しない (決定的でない)');
    } finally {
      for (const d of dirs) await rm(d, { recursive: true, force: true });
    }
  }
}

console.log(`\n== 結果 ==\n  合格 ${pass} / 不合格 ${fail}`);
process.exit(fail ? 1 : 0);
