// ============================================================================
// ワードローグ — 語彙と熟語の総当たり検査
//
//   node tools/bruteforce.mjs
//
// すべての語について、10 文字以内で作れる structural に可能な文を総当たりし、
// **1 本も成立する文が作れない語・熟語** を洗い出す。ゲーム内の判定と同じ
// evaluate (minContent:2, 形語の隣接禁止) を使う。
//
// 掃 描:
//   1. 2 語の全組合せ (全語 × 全語 × 全接続詞)
//   2. 語ごとの 3〜4 語の構造テンプレート (述語・修飾・受身・連用の各位置)
//   3. 熟語の全埋め込み (直接・前後・格・述語化)
//   4. 部位強化 (implicitTail) の閉じ形
//   5. README / index.html / weapons.js の例文が実際に成立するか
//   6. データの整合性 (プールの過剰定義・熟語の活用漏れ)
//
// メモリ抑止のため、掃描をシャードに分け、シャードごとに words.js を
// クエリ違いで再 import して segCache を使い捨てる。
// ============================================================================

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SELF = fileURLToPath(import.meta.url);

// ─────────────────────────────────────────────────────────────────────────────
// 共通 (親・ワーカー両方で使う)
// ─────────────────────────────────────────────────────────────────────────────

/** 1 語の「文としての振る舞い」の署名。これが同じ語は文の成立で区別が付かない。 */
function behaviorSig(pos, pool, flags) {
  const forms = pool.map((f) => f.k + ':' + f.role + (f.next ? '>' + f.next : '')
    + (f.pred ? '*' : '') + (f.adj ? '+' : '') + (f.passive ? 'p' : '') + (f.intr ? 'x' : ''));
  return pos + '|' + forms.sort().join(',')
    + '|' + (flags.shape ? 's' : '') + (flags.animate ? 'a' : '') + (flags.weapon ? 'w' : '');
}

const ANIMATE = new Set(['神', '魔', '魂', '霊', '賢', '己', '心', '影', '死', '冥', '覇']);

/**
 * 評価して、武器の文として成立するか。ゲームと同じ判定は
 * evaluate (minContent:2) だけ。形語の隣接は evaluate 内部で落とし、
 * 武器語が無い文も基本武器の既定の型で発動する (weapon.js resolve)。
 */
function weaponCheck(evaluate, makeWord, texts) {
  const r = evaluate(texts.map(makeWord), { minContent: 2 });
  return r.valid ? { ok: true } : { ok: false, reason: r.reason };
}

// ─────────────────────────────────────────────────────────────────────────────
// ワーカー
// ─────────────────────────────────────────────────────────────────────────────

async function worker(mode, shard, shards) {
  // クエリ違いで再 import すると segCache が空の新しいインスタンスになる。
  const fresh = `?shard=${process.pid}-${shard}`;
  const words = await import(`../js/data/words.js${fresh}`);
  const {
    WORDS, CONNECTOR_SET, evaluate, makeWord, segment, findCompound, PHRASE_BONUS,
    isShapeWord,
  } = words;
  const { poolOfText, compoundPoolOf, posOfText, COMPOUND_POOLS } = await import(`../js/data/words.pool.js${fresh}`);
  const emit = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');

  const all = Object.keys(WORDS).filter((t) => !CONNECTOR_SET.has(t));
  const check = (texts) => weaponCheck(evaluate, makeWord, texts);

  // 役割ごとに形を代表化 (署名が同じ形は 1 つだけ試す)。
  const dedup = (forms) => {
    const seen = new Set();
    const out = [];
    for (const f of forms) {
      const key = f.role + (f.next ? '>' + f.next : '') + (f.pred ? '*' : '')
        + (f.adj ? '+' : '') + (f.passive ? 'p' : '') + (f.intr ? 'x' : '');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(f);
    }
    return out;
  };
  const adnForms = (t) => dedup(poolOfText(t).filter((f) => f.role === 'adn' || (f.role === 'case' && f.next === 'noun')));
  const predForms = (t) => dedup(poolOfText(t).filter((f) => f.pred || (f.role === 'adv' && !f.adj)));
  const advForms = (t) => dedup(poolOfText(t).filter((f) => f.role === 'adv'));
  const caseForms = (t) => dedup(poolOfText(t).filter((f) => f.role === 'case' && (f.next === 'verb' || f.next === 'pred')));

  // 述語になれる語の代表 (署名ごとに 1 語)。
  const predWords = all.filter((t) => {
    if (!WORDS[t]) return false;
    return posOfText(t) === '用言' || poolOfText(t).some((f) => f.pred || (f.role === 'adv' && !f.adj));
  });
  const predClasses = new Map();
  for (const t of predWords) {
    const s = 'V|' + behaviorSig(posOfText(t), poolOfText(t), { shape: isShapeWord(t), animate: ANIMATE.has(t), weapon: false });
    if (!predClasses.has(s)) predClasses.set(s, t);
  }
  const V_REPS = [...predClasses.values()];
  // 述語の受け先になる名詞の代表。形語 (剣) と非形語 (炎) の両方。
  const C_REPS = ['炎', '剣'];

  // 前に置く語の代表 (署名ごとに 1 語 + 主体になれる語を全員)。
  const headClasses = new Map();
  for (const t of all) {
    const s = 'A|' + behaviorSig(posOfText(t), poolOfText(t), { shape: isShapeWord(t), animate: ANIMATE.has(t), weapon: false });
    if (!headClasses.has(s)) headClasses.set(s, t);
  }
  const A_REPS = [...new Set([...headClasses.values(), ...ANIMATE])];

  const cap = (arr, n) => (arr.length > n ? arr.slice(0, n) : arr);

  // ── 1. 2 語の全組合せ ──
  if (mode === 'pairs') {
    let total = 0, valid = 0;
    const okB = new Set();
    const deadA = [];
    for (let i = shard; i < all.length; i += shards) {
      const a = all[i];
      let aOk = false;
      const conns = ['', ...poolOfText(a).map((f) => f.k)];
      for (const c of conns) {
        for (const b of all) {
          const texts = c ? [a, c, b] : [a, b];
          if (texts.join('').length > 10) continue;
          total++;
          if (check(texts).ok) {
            valid++;
            aOk = true;
            okB.add(b);
          }
        }
      }
      if (!aOk) deadA.push(a);
    }
    // okB: どのシャードかで後置語として成立した語。deadA: 自分が先頭の
    // シャードで 1 本も作れなかった語。成立語 = (all − deadA 全体) ∪ okB。
    emit({ t: 'pairsDone', shard, total, valid, deadA, okB: [...okB] });
    return;
  }

  // ── 2. 語ごとの構造テンプレート ──
  if (mode === 'words') {
    for (let i = shard; i < all.length; i += shards) {
      const w = all[i];
      let found = 0, example = null;
      const reasons = Object.create(null);
      const trySentence = (texts) => {
        if (texts.join('').length > 10) return;
        const r = check(texts);
        if (r.ok) {
          found++;
          if (!example) example = texts.join('');
        } else {
          reasons[r.reason] = (reasons[r.reason] || 0) + 1;
        }
      };

      // (a) 語から始めて述語で受ける。X を/に Vる C
      const vreps = cap(V_REPS, 40);
      for (const c of ['', ...poolOfText(w).map((f) => f.k)]) {
        for (const v of vreps) {
          const fs = [{ k: '' }, ...predForms(v).map((f) => ({ k: f.k }))];
          for (const f of fs) {
            for (const d of C_REPS) {
              const texts = [w];
              if (c) texts.push(c);
              texts.push(v);
              if (f.k) texts.push(f.k);
              texts.push(d);
              trySentence(texts);
            }
          }
          if (found > 40) break;
        }
        if (found > 40) break;
      }

      // (b) 語を修飾される名詞として後ろに置く。A の X な C
      if (found <= 40) {
        const cws = ['', ...adnForms(w).map((f) => f.k)];
        for (const a of A_REPS) {
          for (const ca of adnForms(a)) {
            for (const cw of cws) {
              for (const d of C_REPS) {
                const texts = [a, ca.k, w];
                if (cw) texts.push(cw);
                texts.push(d);
                trySentence(texts);
              }
            }
          }
          if (found > 40) break;
        }
      }

      // (c) 語を述語 (動詞) として使う。A を X る C
      if (found <= 40) {
        const fs = [{ k: '' }, ...predForms(w).map((f) => ({ k: f.k }))];
        const bareVerb = posOfText(w) === '用言';
        for (const a of cap(A_REPS, 60)) {
          for (const ca of caseForms(a)) {
            for (const f of (bareVerb ? fs : fs.slice(1))) {
              for (const d of C_REPS) {
                const texts = [a, ca.k, w];
                if (f.k) texts.push(f.k);
                texts.push(d);
                trySentence(texts);
              }
              if (!f.k && !bareVerb) break;
            }
          }
          if (found > 40) break;
        }
      }

      // (d) 連用形で受ける。A を Xり Vる C
      if (found <= 40) {
        for (const f of advForms(w).filter((x) => x.pred)) {
          for (const v of cap(V_REPS, 12)) {
            for (const fv of predForms(v)) {
              for (const d of C_REPS) {
                trySentence([w, f.k, v, fv.k, d]);
              }
            }
          }
        }
      }

      emit({ t: 'word', w, found, example, reasons });
    }
    return;
  }

  // ── 3. 熟語の埋め込み ──
  if (mode === 'compounds') {
    const keys = Object.keys(PHRASE_BONUS);
    const vreps = cap(V_REPS, 10);
    const headReps = cap(A_REPS, 24);
    for (let i = shard; i < keys.length; i += shards) {
      const key = keys[i];
      const segs = segment(key);
      if (!segs) { emit({ t: 'compound', key, ok: false, idiom: false, reason: 'unseg' }); continue; }
      let found = 0, idiom = 0, example = null, reasons = Object.create(null);
      const tryC = (texts, extra = 0) => {
        if (texts.join('').length > 10) return;
        const r = check(texts);
        if (r.ok) {
          found++;
          if (!example) example = texts.join('');
          if (findCompound(texts.join(''))?.phrase === key) idiom++;
        } else if (extra) {
          reasons[r.reason] = (reasons[r.reason] || 0) + 1;
        }
      };
      tryC(segs);
      // うしろに語を足す / 格で受ける / 熟語自身の活用 (発電する) を受ける。
      for (const x of all) tryC([...segs, x]);
      const ownPool = compoundPoolOf(key) || [];
      const suffixForms = dedup([...ownPool, ...poolOfText(key), ...poolOfText(segs[segs.length - 1])]
        .filter((e) => e.role === 'case' || ownPool.includes(e)));
      for (const f of suffixForms) {
        // 名詞を受ける形 (格「の」・連体) は名詞へ。それ以外 (格「を/に」・連用) は述語へ。
        if (f.role === 'case' ? f.next === 'noun' : f.role === 'adn') {
          for (const d of C_REPS) tryC([...segs, f.k, d], 1);
        } else {
          for (const v of vreps) {
            for (const fv of predForms(v)) {
              for (const d of C_REPS) tryC([...segs, f.k, v, fv.k, d], 1);
            }
          }
        }
      }
      // 前に語を置く。A の 熟語 / Aの 熟語 を Vる D
      for (const x of all) tryC([x, 'の', ...segs]);
      for (const a of headReps) {
        for (const ca of adnForms(a)) tryC([a, ca.k, ...segs]);
      }
      for (const a of cap(headReps, 12)) {
        for (const v of vreps) {
          for (const fv of predForms(v)) {
            for (const d of C_REPS) tryC([a, 'の', ...segs, 'を', v, fv.k, d]);
          }
        }
      }
      emit({ t: 'compound', key, ok: found > 0, idiom: idiom > 0, found, example, reasons });
    }
    return;
  }

  // ── 4. 部位強化の閉じ形 ──
  if (mode === 'parts') {
    for (let i = shard; i < all.length; i += shards) {
      const w = all[i];
      // 部位は語 1 つでも成立する (minContent:1)。ここでは接続詞で閉じる形を見る。
      let closing = null;
      for (const f of poolOfText(w)) {
        if (f.role !== 'adn' && !(f.role === 'case' && f.next === 'noun')) continue;
        const r = evaluate([makeWord(w), makeWord(f.k)], { minContent: 1, implicitTail: true });
        if (r.valid) { closing = f.k; break; }
      }
      if (!closing) emit({ t: 'part', w });
    }
    return;
  }

  // ── 5. すべての形が、その役割の自然な文脈で成立するか ──
  //   連体 / 格「の」 … 名詞を受ける (強い刃 / 炎の剣)
  //   格「を」     … 後ろの他動詞を受ける (焔を斬る剣)
  //   格「に/へ」… 自動詞か形容を受ける (焔に走る剣)
  //   連用         … 後ろの述語に係る (速く斬る剣)
  //   述語         … 連体修飾か目的語文 (斬る刃 / 炎を斬る剣)
  // 形が 1 つも文脈で成立しないなら、その形は実質使えない (接続詞不足とは逆の、
  // 文法・データの不整合)。
  if (mode === 'forms') {
    const TAILS = ['剣', '炎', '影'];
    const INTR = [['燃', 'える'], ['走', 'る'], ['鳴', 'る']];
    const TRANS = [['斬', 'る'], ['殺', 'す']];
    const battery = (head, f) => {
      const out = [];
      const h = [...head, f.k];
      if (f.role === 'adn' || (f.role === 'case' && f.next === 'noun')) {
        for (const t of TAILS) out.push([...h, t]);
      } else if (f.role === 'case' && f.next === 'verb') {
        for (const [v, fv] of TRANS) out.push([...h, v, fv, '剣']);
      } else if (f.role === 'case' && f.next === 'pred') {
        for (const [v, fv] of INTR) out.push([...h, v, fv, '剣']);
        if (ANIMATE.has(head[0])) for (const [v, fv] of TRANS) out.push([...h, v, fv, '剣']);
      } else if (f.role === 'adv') {
        for (const [v, fv] of [...INTR, ...TRANS]) out.push([...h, v, fv, '剣']);
      }
      return out;
    };
    for (let i = shard; i < all.length; i += shards) {
      const w = all[i];
      for (const f of poolOfText(w)) {
        let ok = 0, ex = null, tested = 0;
        const reasons = Object.create(null);
        for (const texts of battery([w], f)) {
          if (texts.join('').length > 10) continue;
          tested++;
          const r = check(texts);
          if (r.ok) { ok++; if (!ex) ex = texts.join(''); }
          else reasons[r.reason] = (reasons[r.reason] || 0) + 1;
        }
        if (tested && !ok) emit({ t: 'form', w, k: f.k, role: f.role + (f.next ? '>' + f.next : ''), reasons });
      }
    }
    // 熟語自身の活用 (発電する・約束された) も同じく。
    const keys = Object.keys(COMPOUND_POOLS).filter((_, idx) => idx % shards === shard);
    for (const key of keys) {
      const segs = segment(key);
      if (!segs) continue;
      for (const f of compoundPoolOf(key)) {
        let ok = 0, tested = 0;
        const reasons = Object.create(null);
        for (const texts of battery(segs, f)) {
          if (texts.join('').length > 10) continue;
          tested++;
          const r = check(texts);
          if (r.ok) ok++;
          else reasons[r.reason] = (reasons[r.reason] || 0) + 1;
        }
        if (tested && !ok) emit({ t: 'form', w: key + '(熟語)', k: f.k, role: f.role + (f.next ? '>' + f.next : ''), reasons });
      }
    }
    return;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 親: シャードをぶん回して集計する
// ─────────────────────────────────────────────────────────────────────────────

const runShards = (mode, shards, domain) => new Promise((resolve, reject) => {
  const kids = [];
  const out = { lines: [], done: 0 };
  for (let s = 0; s < shards; s++) {
    const kid = spawn(process.execPath, [SELF, '--worker', mode, String(s), String(shards)],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
    let buf = '';
    kid.stdout.on('data', (d) => {
      buf += d;
      let at;
      while ((at = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, at).trim();
        buf = buf.slice(at + 1);
        if (line) out.lines.push(line);
      }
    });
    kid.on('exit', (code) => {
      if (code) reject(new Error(`${mode} shard ${s} exited ${code}`));
      if (++out.done === shards) resolve(out.lines);
    });
    kids.push(kid);
  }
});

async function parent() {
  const shards = Math.min(8, Math.max(2, (await import('node:os')).cpus().length - 1));
  // 引数で実行する掃描を絞れる。  node tools/bruteforce.mjs forms gaps
  const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const want = (m) => !only.length || only.includes(m);
  const run = (m) => (want(m) ? runShards(m, shards) : Promise.resolve([]));
  console.log(`== 総当たり検査 ==\n  シャード ${shards}${only.length ? ` / 掃描 ${only.join(',')}` : ''}`);

  // 親プロセスでも辞書を読む (集計と整合性検査用)。
  const { WORDS, CONNECTOR_SET, segment, PHRASE_BONUS, WEAPON_WORDS } =
    await import('../js/data/words.js');
  const all = Object.keys(WORDS).filter((t) => !CONNECTOR_SET.has(t));
  console.log(`  実質語 ${all.length} / 熟語 ${Object.keys(PHRASE_BONUS).length} / 武器語 ${WEAPON_WORDS.length}`);

  // 1. 2 語の全組合せ
  if (want('pairs')) {
    const lines = await run('pairs');
    const okB = new Set();
    const deadA = [];
    let total = 0, valid = 0;
    for (const l of lines) {
      const o = JSON.parse(l);
      if (o.t !== 'pairsDone') continue;
      total += o.total; valid += o.valid;
      for (const w of o.okB) okB.add(w);
      deadA.push(...o.deadA);
    }
    const dead = all.filter((w) => !okB.has(w) && deadA.includes(w));
    console.log(`\n== 2 語の全組合せ ==\n  評価 ${total} / 成立 ${valid} / 2 語では作れない語 ${dead.length}`);
    if (dead.length) console.log('  ' + dead.join(' '));
    global.__dead2 = dead;
  }

  // 2. 語ごとの構造テンプレート
  if (want('words')) {
    const lines = await run('words');
    const found = new Map();
    const examples = new Map();
    const reasons = new Map();
    for (const l of lines) {
      const o = JSON.parse(l);
      if (o.t !== 'word') continue;
      found.set(o.w, o.found);
      if (o.example) examples.set(o.w, o.example);
      if (Object.keys(o.reasons).length) reasons.set(o.w, o.reasons);
    }
    const dead = all.filter((w) => !(found.get(w) > 0));
    console.log(`\n== 3〜4 語の構造掃描 ==\n  語 ${found.size} / どの形でも成立しない語 ${dead.length}`);
    for (const w of dead) {
      console.log(`\x1b[31m  「${w}」: ${JSON.stringify(reasons.get(w) || {})} (2 語掃描: ${global.__dead2.includes(w) ? '不成立' : '成立'})\x1b[0m`);
    }
    const fragile = all.filter((w) => (found.get(w) || 0) <= 3);
    console.log(`  成立が少ない語 (≤3 形): ${fragile.length}`);
    for (const w of fragile) console.log(`\x1b[33m  「${w}」 ${found.get(w)} 形 例:${examples.get(w) || '-'}\x1b[0m`);
    global.__deadWords = dead;
  }

  // 3. 熟語の埋め込み
  if (want('compounds')) {
    const lines = await run('compounds');
    const broken = [], shadowed = [];
    let ok = 0, idiomOk = 0, total = 0;
    for (const l of lines) {
      const o = JSON.parse(l);
      if (o.t !== 'compound') continue;
      total++;
      if (o.ok) {
        ok++;
        if (o.idiom) idiomOk++;
        else shadowed.push(`${o.key} (例:${o.example})`);
      } else {
        broken.push(`${o.key} (${o.reason || JSON.stringify(o.reasons || {})})`);
      }
    }
    console.log(`\n== 熟語の埋め込み ==\n  熟語 ${total} / 文に組める ${ok} / 熟語ボーナスが乗る ${idiomOk} / 組めない ${broken.length}`);
    for (const b of broken) console.log(`\x1b[31m  ${b}\x1b[0m`);
    if (shadowed.length) {
      console.log(`  成立するが別の熟語が優先される ${shadowed.length}`);
      for (const s of shadowed.slice(0, 30)) console.log(`\x1b[33m  ${s}\x1b[0m`);
    }
    global.__brokenCompounds = broken;
  }

  // 4. 部位の閉じ形
  if (want('parts')) {
    const lines = await run('parts');
    const noClose = lines.map((l) => JSON.parse(l)).filter((o) => o.t === 'part').map((o) => o.w);
    console.log(`\n== 部位の接続詞で閉じる形 ==\n  閉じる形が無い語 ${noClose.length} (語 1 つの部位は成立するので参考)`);
    if (noClose.length) console.log('  ' + noClose.join(' '));
  }

  // 5. すべての形が役割どおりの文脈で成立するか。
  //    「〜い」の形を持つのに「〜い刃」が作れない、のような不整合を見つける。
  if (want('forms')) {
    const lines = await run('forms');
    const bad = lines.map((l) => JSON.parse(l)).filter((o) => o.t === 'form');
    console.log(`\n== 形の文脈 ==\n  どの文脈でも成立しない形 ${bad.length}`);
    for (const b of bad) {
      console.log(`\x1b[31m  「${b.w}」+「${b.k}」 (${b.role}): ${JSON.stringify(b.reasons)}\x1b[0m`);
    }
  }

  // 6. 形の揃い。品詞から期待される形が無いと、自然な文が作れない
  //    (以前「激」に しい/しく が無く「激しい刃」が作れなかったのと同じ類)。
  if (want('gaps')) {
    const { WORD_POOLS, poolOfText, posOfText } = await import('../js/data/words.pool.js');
    const gap = { た形: [], 連用: [], 連体: [], 名詞格: [] };
    // 用言の連用形 (送り仮名) を基本形から導く。吸い尽くす・吐き出す の
    // ような動詞の連用が無いと、自然な文が作れない (って では代わらない)。
    const RENYOU = { る: 'り', つ: 'ち', く: 'き', ぐ: 'ぎ', す: 'し', ぬ: 'に', ぶ: 'び', む: 'み', う: 'い' };
    // 連用を導けない語: 見る は一段で語幹がかなに現れない (見み は誤り)。
    // 聖 は に を格として既に持つ (同じかなを 2 形にできない)。
    const NO_RENYOU = new Set(['見', '聖']);
    const renyouOf = (pool) => {
      for (const f of pool) {
        if (f.role !== 'adn' || f.passive) continue;
        const k = f.k;
        if (k === 'わる') return 'わり'; // 終わる・代わる (わ行五段)
        if (k === 'する') return 'し';
        if (k === 'る') return 'り';
        const last = k[k.length - 1];
        if (last !== 'る' && RENYOU[last]) return k.slice(0, -1) + RENYOU[last]; // 五段: 滅ぼす→滅ぼし
        if (/る$/.test(k) && k.length >= 2) return k.slice(0, -1); // 一段: 壊れる→壊れ
      }
      return null;
    };
    for (const w of all) {
      const pool = poolOfText(w);
      const pos = posOfText(w);
      if (pos === '用言') {
        // 受身 (〜れた / 〜された) はた形ではない。主動の過去が要る。
        // 助けた・見た のような p 付きの主動過去、盗んだ のような だ 終わりも数える。
        if (!pool.some((f) => f.role === 'adn' && f.pred && /[ただ]$/.test(f.k)
          && !(f.passive && /れた$|された$/.test(f.k)))) gap['た形'].push(w);
        const ry = NO_RENYOU.has(w) ? null : renyouOf(pool);
        if (ry && !pool.some((f) => f.role === 'adv' && f.k === ry)) gap['連用'].push(w);
      }
      if (pos === '形容' || pos === '形動') {
        if (!pool.some((f) => f.role === 'adn' && f.adj)) gap['連体'].push(w);
        if (!NO_RENYOU.has(w) && !pool.some((f) => f.role === 'adv' && f.adj)) gap['連用'].push(w);
      }
      if (pos === '体言' && WORD_POOLS[w]
        && !pool.some((f) => f.role === 'case')) gap['名詞格'].push(w);
    }
    // 動詞語幹の名詞 (撃・守・望 …) は格を持たないのが設計 (「撃の剣」は不自然)。
    // 本来の名詞 (愛・空・凪 …) だけが問題になる。
    console.log(`\n== 形の揃い ==\n  `
      + Object.entries(gap).map(([k, v]) => `${k} ${v.length}`).join(' / ')
      + `\n  (名詞格は動詞語幹の名詞が大半で設計どおり。本来の名詞のみ列挙)`);
    for (const [k, v] of Object.entries(gap)) {
      if (!v.length) continue;
      if (k === '名詞格') {
        const { NOUN_POOL } = await import('../js/data/words.pool.js');
        const verbStem = v.filter((w) => poolOfText(w).some((f) => f.role === 'adn' || f.role === 'adv'));
        const realNoun = v.filter((w) => !verbStem.includes(w));
        if (realNoun.length) console.log(`\x1b[31m  ${k} (本来の名詞): ${realNoun.join(' ')}\x1b[0m`);
        console.log(`  ${k} (動詞語幹・参考): ${verbStem.join(' ')}`);
      } else {
        console.log(`  ${k}: ${v.join(' ')}`);
      }
    }
  }

  // 7. 例文の検査 (README / index.html / docs の文の例)
  {
    const { evaluate, makeWord, findCompound } =
      await import('../js/data/words.js');
    const { WEAPONS } = await import('../js/data/weapons.js');
    const check = (texts) => weaponCheck(evaluate, makeWord, texts);
    // 断片 (接続詞の説明・UI の名前・1 語の引用) では、tailconn / onelexeme /
    // noparticle になるのは当然。構造の壊れ (floatconn 等) だけを問題にする。
    const FRAGMENT = new Set(['noparticle', 'onelexeme', 'tailconn']);
    const bad = [], info = [];
    for (const f of ['README.md', 'index.html', 'docs/dictionary.md']) {
      const text = await readFile(join(ROOT, f), 'utf8');
      for (const line of text.split('\n')) {
        // 故意に壊した例 (✗ / 不可 / NG / 不成立) は検査しない。
        if (line.includes('不成立') || line.includes('NG') || line.includes('✗') || line.includes('不可')) continue;
        for (const g of line.matchAll(/「([^」]{2,10})」/g)) {
          const s = g[1];
          if (s.startsWith('〜')) continue;
          const segs = segment(s);
          if (!segs) continue;
          const r = check(segs);
          if (r.ok) continue;
          const entry = `${f}: 「${s}」 (${r.reason})`;
          if (FRAGMENT.has(r.reason)) info.push(entry);
          else bad.push(entry);
        }
      }
    }
    // 武器の初期語。文ではなく語 (素振りの候補) なので、語彙にあることだけ見る。
    for (const w of Object.values(WEAPONS)) {
      for (const sw of [w.startWord, w.startWord2]) {
        if (sw && !WORDS[sw]) bad.push(`weapons.js: ${w.name} startWord「${sw}」が語彙に無い`);
      }
    }
    console.log(`\n== 例文の成立 ==\n  作れない例 ${bad.length} / 断片の引用 (参考) ${info.length}`);
    for (const b of bad) console.log(`\x1b[31m  ${b}\x1b[0m`);
    for (const b of info) console.log(`\x1b[33m  ${b}\x1b[0m`);
  }

  // 8. 整合性
  {
    const { WORD_POOLS, COMPOUND_POOLS } = await import('../js/data/words.pool.js');
    const { COMPOUND_FORM_SPECS } = await import('../js/data/words.compound-forms.js');
    const poolDefined = [];
    for (const t of Object.keys(WORD_POOLS)) if (!WORDS[t]) poolDefined.push(t);
    const straySpec = Object.keys(COMPOUND_FORM_SPECS).filter((k) => !PHRASE_BONUS[k]);
    const noPool = Object.keys(COMPOUND_POOLS).filter((k) => !PHRASE_BONUS[k]);
    const unseg = Object.keys(PHRASE_BONUS).filter((k) => !segment(k));
    console.log(`\n== 整合性 ==\n  語の無いプール ${poolDefined.length} / 熟語の無い活用 ${straySpec.length}`
      + ` / 熟語の無いプール ${noPool.length} / 分割できない熟語 ${unseg.length}`);
    for (const x of [...poolDefined, ...straySpec, ...noPool, ...unseg]) console.log(`\x1b[31m  ${x}\x1b[0m`);
  }

  console.log('\n== 終了 ==');
}

const isWorker = process.argv.includes('--worker');
if (isWorker) {
  const i = process.argv.indexOf('--worker');
  await worker(process.argv[i + 1], Number(process.argv[i + 2]), Number(process.argv[i + 3]));
} else {
  await parent();
}
