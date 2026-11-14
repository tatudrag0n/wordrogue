// ============================================================================
// ワードローグ — ランキング API クライアント
//
// Cloudflare Worker (wordrogue-api) とだけ通信する。
// オフライン/失敗時は静かに諦め、ローカルランキングだけを見せる。
// ============================================================================

const API = 'https://wordrogue-api.tatudragon0327.workers.dev';

async function req(path, opt = {}, timeout = 6000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(API + path, { ...opt, signal: ctl.signal });
    return await r.json();
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(t);
  }
}

/** スコアを送信。{ ok, id, rank } を返す (失敗時 ok:false)。 */
export function submitScore(rec) {
  return req('/api/score', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rec),
  });
}

/** ランキング取得。stage を渡すとステージ別。失敗時 []。 */
export async function fetchLeaderboard({ stage = 0, limit = 20 } = {}) {
  const q = new URLSearchParams({ limit: String(limit) });
  if (stage) q.set('stage', String(stage));
  const j = await req('/api/leaderboard?' + q.toString());
  return j && j.ok && Array.isArray(j.rows) ? j.rows : [];
}