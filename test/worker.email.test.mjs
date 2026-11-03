// worker/src/index.js のフィードバック通知メールを検証する。
// D1 と Email Service は差し替え可能な偽物にして、Worker を直接 fetch で叩く。
import worker from '../worker/src/index.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };

const OWNER = 'owner@example.com';
const FROM = 'feedback@mct-official.com';

/** D1 の最小限の代役。prepare().bind().first()/run()/all() だけ返す。 */
function makeDb({ count = 0, lastId = 42 } = {}) {
  const calls = [];
  const db = {
    calls,
    prepare(sql) {
      const api = {
        bind(...args) { calls.push({ sql, args }); return api; },
        async first() { return { c: count }; },
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

/** 送信を実行し、レスポンスと本文を返す。ctx 省略時は同期的に完了させる。 */
async function submit(body, env, ctx = { waitUntil() {} }) {
  const res = await worker.fetch(postSubmit(body), env, ctx);
  return { res, data: await res.json().catch(() => null) };
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
  ok(m.subject === '[Wordrogue] 語の投稿 #42', '件名に種別と id が入る');
  ok(typeof m.text === 'string' && m.text.includes('氷刃'), '本文に語が入る');
  ok(m.text.includes('属性: 水'), '本文に属性が入る');
  ok(typeof m.html === 'string' && m.html.includes('氷刃'), 'HTML 版にも語が入る');
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
  const payload = { ...BUG.payload, title: '<script>alert(1)</script>' };
  await submit({ type: 'bug', payload }, env);
  const m = env.EMAIL.sent[0] || {};
  ok(!(m.html || '').includes('<script>'), 'HTML に生のタグを出さない');
  ok((m.html || '').includes('&lt;script&gt;'), 'HTML はエスケープして出す');
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
  const origError = console.error;
  const logged = [];
  console.error = (...a) => logged.push(a.join(' '));
  let out;
  try {
    out = await submit(WORD, env);
  } finally {
    console.error = origError;
  }
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
}

// ── 7. ハニーポット・不正入力では送らない ───────────────────────────────
{
  const env = makeEnv();
  const { res, data } = await submit({ ...WORD, hp: 'http://spam.example' }, env);
  ok(res.status === 201 && data && data.id === 0, 'ハニーポットは成功したふりをする');
  ok(env.EMAIL.sent.length === 0, 'ハニーポットではメールを送らない');
  ok(env.DB.calls.length === 0, 'ハニーポットでは DB に書かない');

  const env2 = makeEnv();
  const r2 = await submit({ type: 'word', payload: { word: 'あ'.repeat(21) } }, env2);
  ok(r2.res.status === 400, '長すぎる語は 400');
  ok(env2.EMAIL.sent.length === 0, '不正入力ではメールを送らない');

  const env3 = makeEnv();
  const r3 = await submit({ type: 'bogus', payload: {} }, env3);
  ok(r3.res.status === 400, '未知の種別は 400');
  ok(env3.EMAIL.sent.length === 0, '未知の種別ではメールを送らない');
}

// ── 8. waitUntil に渡して、応答を待たせない ─────────────────────────────
{
  const env = makeEnv();
  const pending = [];
  const ctx = { waitUntil(p) { pending.push(p); } };
  const { res } = await submit(WORD, env, ctx);
  ok(res.status === 201, 'ctx ありでも 201');
  ok(pending.length === 1, '通知は ctx.waitUntil に預ける');
  const result = await pending[0];
  ok(result && result.sent === true, '預けた通知は送信成功を返す');
  ok(env.EMAIL.sent.length === 1, '預けた通知で 1 通送られる');
}

console.log(`\n---- 合格 ${pass} / 不合格 ${fail} ----`);
process.exit(fail ? 1 : 0);
