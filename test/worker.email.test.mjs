// worker/src/index.js のフィードバック通知メールを検証する。
// D1 と Email Service は差し替え可能な偽物にして、Worker を直接 fetch で叩く。
import { readFileSync } from 'node:fs';
import worker from '../worker/src/index.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };

const OWNER = 'owner@example.com';
const FROM = 'feedback@mct-official.com';

/**
 * D1 の最小限の代役。prepare().bind().first()/run()/all() だけ返す。
 * ip_hash で絞る問い合わせ (IP 単位のレート制限) と、
 * 全体を数える問い合わせ (通知の 1 時間上限) を別々に返す。
 */
function makeDb({ ipCount = 0, totalCount = 0, lastId = 42 } = {}) {
  const calls = [];
  const db = {
    calls,
    prepare(sql) {
      const api = {
        bind(...args) { calls.push({ sql, args }); return api; },
        async first() { return { c: sql.includes('ip_hash') ? ipCount : totalCount }; },
        async run() { return { meta: { last_row_id: lastId } }; },
        async all() { return { results: [] }; },
      };
      return api;
    },
  };
  return db;
}

/** Email Service バインディングの代役。送った message を記録する。 */
function makeEmail(onSend) {
  const sent = [];
  return {
    sent,
    async send(message) {
      sent.push(message);
      if (onSend) return onSend(message);
      return { messageId: 'test-message-id' };
    },
  };
}

function makeEnv(overrides = {}) {
  return {
    DB: makeDb(),
    TURNSTILE_SECRET: '',
    ADMIN_TOKEN: 'admin-token',
    ALLOWED_ORIGINS: 'https://example.com',
    SITE_URL: 'https://wordrogue.pages.dev',
    FEEDBACK_EMAIL_FROM: FROM,
    FEEDBACK_EMAIL_FROM_NAME: 'Wordrogue',
    FEEDBACK_EMAIL_TO: OWNER,
    EMAIL: makeEmail(),
    ...overrides,
  };
}

function postSubmit(body) {
  return new Request('https://api.example.com/api/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.5' },
    body: JSON.stringify(body),
  });
}

/** 送信を実行し、レスポンスと本文を返す。ctx 省略時は通知の完了まで待つ。 */
async function submit(body, env, ctx = {}) {
  const res = await worker.fetch(postSubmit(body), env, ctx);
  return { res, data: await res.json().catch(() => null) };
}

/** console.error を集めながら fn を実行する。 */
async function withErrorLog(fn) {
  const logged = [];
  const orig = console.error;
  console.error = (...a) => logged.push(a.join(' '));
  try {
    const value = await fn();
    return { value, logged };
  } finally {
    console.error = orig;
  }
}

const WORD = { type: 'word', payload: { word: '氷刃', category: 'noun', element: '水', note: '', name: '' } };
const BUG = {
  type: 'bug',
  payload: {
    title: '敵が消えない',
    description: 'ボス撃破後に残ります',
    environment: 'Chrome 120 / Windows',
    name: 'テスター',
    userAgent: 'Mozilla/5.0 (test)',
  },
};

// ── 1. 語の投稿: 1 通だけ送られ、中身が揃っている ────────────────────────
{
  const env = makeEnv();
  const { res, data } = await submit(WORD, env);
  ok(res.status === 201, '語の投稿は 201 で受付ける');
  ok(data && data.ok === true && data.id === 42, '保存した id を返す');
  ok(env.EMAIL.sent.length === 1, 'メールを 1 通だけ送る');
  const m = env.EMAIL.sent[0] || {};
  ok(m.to === OWNER, '宛先は FEEDBACK_EMAIL_TO');
  ok(m.from && m.from.email === FROM, '差出人は FEEDBACK_EMAIL_FROM');
  ok(m.from && m.from.name === 'Wordrogue', '差出人名は FEEDBACK_EMAIL_FROM_NAME');
  ok(m.subject === '[Wordrogue] 語の投稿 #42', '件名に種別と id が入る');
  ok(typeof m.text === 'string' && m.text.includes('氷刃'), '本文に語が入る');
  ok(m.text.includes('属性: 水'), '本文に属性が入る');
  ok(m.text.includes('https://wordrogue.pages.dev/admin.html'), '本文に管理画面の URL が入る');
  ok(typeof m.html === 'string' && m.html.includes('氷刃'), 'HTML 版にも語が入る');
  ok(m.html.includes('<a href="https://wordrogue.pages.dev/admin.html">'), 'HTML から管理画面へリンクする');
  ok(!JSON.stringify(data).includes(OWNER), 'レスポンスに通知先アドレスを漏らさない');
}

// ── 2. 不具合報告: 種別ごとの項目が本文に出る ───────────────────────────
{
  const env = makeEnv();
  await submit(BUG, env);
  const m = env.EMAIL.sent[0] || {};
  ok(m.subject === '[Wordrogue] 不具合報告 #42', '不具合報告の件名');
  ok((m.text || '').includes('タイトル: 敵が消えない'), '本文にタイトルが入る');
  ok((m.text || '').includes('詳細: ボス撃破後に残ります'), '本文に詳細が入る');
  ok((m.text || '').includes('User-Agent: Mozilla/5.0 (test)'), '本文に User-Agent が入る');
}

// ── 3. 空の項目は本文に出さない ─────────────────────────────────────────
{
  const env = makeEnv();
  await submit(WORD, env);
  const m = env.EMAIL.sent[0] || {};
  ok(!(m.text || '').includes('メモ:'), '空のメモは本文に出さない');
  ok(!(m.text || '').includes('投稿者:'), '空の投稿者名は本文に出さない');
}

// ── 4. HTML はエスケープする ────────────────────────────────────────────
{
  const env = makeEnv();
  const payload = { ...BUG.payload, title: `<script>alert("x")</script> 'y' & z` };
  await submit({ type: 'bug', payload }, env);
  const m = env.EMAIL.sent[0] || {};
  ok(!(m.html || '').includes('<script>'), 'HTML に生のタグを出さない');
  ok((m.html || '').includes('&lt;script&gt;'), 'HTML は < をエスケープして出す');
  ok((m.html || '').includes('&quot;x&quot;'), 'HTML は " をエスケープして出す');
  ok((m.html || '').includes('&#39;y&#39;'), "HTML は ' をエスケープして出す");
  ok((m.html || '').includes('&amp;'), 'HTML は & をエスケープして出す');
}

// ── 5. 送信に失敗しても受付は成功のまま ─────────────────────────────────
{
  const env = makeEnv({
    EMAIL: makeEmail(() => {
      const e = new Error('delivery failed');
      e.code = 'E_DELIVERY_FAILED';
      throw e;
    }),
  });
  // ctx を渡さないので通知は await される。マイクロタスク順序に依存しない。
  const { value: out, logged } = await withErrorLog(() => submit(WORD, env, {}));
  ok(out.res.status === 201, 'メール失敗でも 201 を返す');
  ok(out.data && out.data.ok === true, 'メール失敗でも受理は成功');
  ok(logged.some((l) => l.includes('E_DELIVERY_FAILED')), 'メール失敗はログに残す');
}

// ── 6. 通知の設定が無ければ送らない (壊れない) ──────────────────────────
{
  const noBinding = makeEnv({ EMAIL: undefined });
  const a = await submit(WORD, noBinding);
  ok(a.res.status === 201, 'EMAIL バインディング無しでも受付ける');

  const noTo = makeEnv({ FEEDBACK_EMAIL_TO: '' });
  const b = await submit(WORD, noTo);
  ok(b.res.status === 201, '宛先未設定でも受付ける');
  ok(noTo.EMAIL.sent.length === 0, '宛先未設定なら送らない');

  const noFrom = makeEnv({ FEEDBACK_EMAIL_FROM: '' });
  const c = await submit(WORD, noFrom);
  ok(c.res.status === 201, '差出人未設定でも受付ける');
  ok(noFrom.EMAIL.sent.length === 0, '差出人未設定なら送らない');

  const noName = makeEnv({ FEEDBACK_EMAIL_FROM_NAME: '' });
  await submit(WORD, noName);
  ok((noName.EMAIL.sent[0] || {}).from.name === 'Wordrogue', '差出人名の既定は Wordrogue');
}

// ── 7. 送れない入力ではメールを送らない ─────────────────────────────────
{
  const hp = makeEnv();
  const { res, data } = await submit({ ...WORD, hp: 'http://spam.example' }, hp);
  ok(res.status === 201 && data && data.id === 0, 'ハニーポットは成功したふりをする');
  ok(hp.EMAIL.sent.length === 0, 'ハニーポットではメールを送らない');
  ok(hp.DB.calls.length === 0, 'ハニーポットでは DB に書かない');

  const tooLong = makeEnv();
  const r2 = await submit({ type: 'word', payload: { word: 'あ'.repeat(21) } }, tooLong);
  ok(r2.res.status === 400, '長すぎる語は 400');
  ok(tooLong.EMAIL.sent.length === 0, '不正入力ではメールを送らない');

  const unknown = makeEnv();
  const r3 = await submit({ type: 'bogus', payload: {} }, unknown);
  ok(r3.res.status === 400, '未知の種別は 400');
  ok(unknown.EMAIL.sent.length === 0, '未知の種別ではメールを送らない');

  const limited = makeEnv({ DB: makeDb({ ipCount: 5 }) });
  const r4 = await submit(WORD, limited);
  ok(r4.res.status === 429, 'IP 単位の上限で 429');
  ok(limited.EMAIL.sent.length === 0, 'レート制限されたらメールを送らない');

  // Turnstile の siteverify は失敗させ、トークン付きの送信が 403 になることを見る。
  const env = makeEnv();
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ success: false }), { status: 200 });
  let r5;
  try {
    r5 = await submit({ ...WORD, turnstileToken: 'dummy' }, env);
  } finally {
    globalThis.fetch = origFetch;
  }
  ok(r5.res.status === 403, 'Turnstile 失敗は 403');
  ok(env.EMAIL.sent.length === 0, 'Turnstile 失敗ではメールを送らない');
}

// ── 8. 1 時間の通知上限を超えたら送らない (受付は成功) ──────────────────
{
  const env = makeEnv({ DB: makeDb({ ipCount: 0, totalCount: 30 }) });
  const { value: out, logged } = await withErrorLog(() => submit(WORD, env, {}));
  ok(out.res.status === 201, '通知上限を超えても受付は 201');
  ok(env.EMAIL.sent.length === 0, '通知上限を超えたらメールを送らない');
  ok(logged.some((l) => l.includes('hourly_limit')), '通知上限はログに残す');

  // 上限未満なら送る。
  const under = makeEnv({ DB: makeDb({ ipCount: 0, totalCount: 29 }) });
  await submit(WORD, under);
  ok(under.EMAIL.sent.length === 1, '上限未満なら送る');
}

// ── 9. messageId が返らなくても壊れない ─────────────────────────────────
{
  const env = makeEnv({ EMAIL: makeEmail(async () => undefined) });
  const { res } = await submit(WORD, env);
  ok(res.status === 201, 'messageId 無しでも 201');
  ok(env.EMAIL.sent.length === 1, 'messageId 無しでも送信自体は行う');
}

// ── 10. waitUntil に渡して、応答を待たせない ────────────────────────────
{
  // 解決しない Promise を返す Email を渡しても、fetch は返ってくること。
  const hang = { sent: [], send() { this.sent.push(1); return new Promise(() => {}); } };
  const env = makeEnv({ EMAIL: hang });
  const pending = [];
  const ctx = { waitUntil(p) { pending.push(p); } };
  const { res } = await submit(WORD, env, ctx);
  ok(res.status === 201, '送信が終わらなくても応答は返る');
  ok(pending.length === 1, '通知は ctx.waitUntil に預ける');
  ok(hang.sent.length === 1, '預けた通知は送信を開始している');

  // ctx が無いときは await して完了させ、結果を返す。
  const env2 = makeEnv();
  await submit(WORD, env2, {});
  ok(env2.EMAIL.sent.length === 1, 'ctx が無くても通知は完了する');
}

// ── 11. /api/health が通知の設定状況を返す ──────────────────────────────
{
  const on = makeEnv();
  const a = await worker.fetch(new Request('https://api.example.com/api/health'), on, {});
  const ja = await a.json();
  ok(ja.ok === true && ja.feedback_email.configured === true, 'health は通知の設定済みを返す');
  ok(!JSON.stringify(ja).includes(OWNER), 'health に宛先アドレスを出さない');

  const off = makeEnv({ EMAIL: undefined });
  const b = await worker.fetch(new Request('https://api.example.com/api/health'), off, {});
  const jb = await b.json();
  ok(jb.feedback_email.configured === false, 'health は未設定を返す');
}

// ── 12. wrangler.toml の宛先とコードの宛先がずれていないか ──────────────
{
  // 同じ宛先を vars と allowlist の 2 箇所に書いているので、片方だけ直すと
  // E_RECIPIENT_NOT_ALLOWED で全通知が止まる。設定の食い違いをここで捕まえる。
  const toml = readFileSync(new URL('../worker/wrangler.toml', import.meta.url), 'utf8');
  const to = /^\s*FEEDBACK_EMAIL_TO\s*=\s*"([^"]+)"/m.exec(toml);
  const allow = /allowed_destination_addresses\s*=\s*\[\s*"([^"]+)"/m.exec(toml);
  const from = /^\s*FEEDBACK_EMAIL_FROM\s*=\s*"([^"]+)"/m.exec(toml);
  ok(!!to, 'wrangler.toml に FEEDBACK_EMAIL_TO がある');
  ok(!!allow, 'wrangler.toml に allowed_destination_addresses がある');
  ok(!!from, 'wrangler.toml に FEEDBACK_EMAIL_FROM がある');
  ok(to && allow && to[1] === allow[1], `通知先が allowlist と一致する: ${to && to[1]} / ${allow && allow[1]}`);
  ok(!!toml.match(/\[\[send_email\]\][\s\S]*?name\s*=\s*"EMAIL"/), 'send_email バインディング名は EMAIL');
}

// ── 13. ランキング (score / leaderboard) ────────────────────────────────
{
  const env = makeEnv();
  const post = (body) => worker.fetch(new Request('https://api.example.com/api/score', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), env, {});
  const good = await post({ stage: 1, score: 12345, dmg: 999, kills: 10, level: 5, cleared: true, name: 'テスト', weapons: [{ name: '刃', dmg: 999 }] });
  ok(good.status === 201, `score 提出が 201 でない: ${good.status}`);
  const gj = await good.json();
  ok(gj.ok && gj.rank >= 1, `score 提出の応答が不正: ${JSON.stringify(gj)}`);

  const bad = await post({ score: 100 }); // stage 無し
  ok(bad.status === 400, `stage 無しは 400: ${bad.status}`);

  const limited = makeEnv({ DB: makeDb({ ipCount: 1 }) });
  const lr = await worker.fetch(new Request('https://api.example.com/api/score', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.7' },
    body: JSON.stringify({ stage: 1, score: 1 }),
  }), limited, {});
  ok(lr.status === 429, `レート制限が 429 でない: ${lr.status}`);

  const lb = await worker.fetch(new Request('https://api.example.com/api/leaderboard?stage=1&limit=5'), env, {});
  const lbj = await lb.json();
  ok(lb.status === 200 && lbj.ok && Array.isArray(lbj.rows), `leaderboard 応答が不正: ${lb.status}`);
}

console.log(`\n---- 合格 ${pass} / 不合格 ${fail} ----`);
process.exit(fail ? 1 : 0);
