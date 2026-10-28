/**
 * Wordrogue submission API
 *
 * Endpoints:
 *   POST /api/submit   { type: "word"|"bug", payload: {...}, turnstileToken: string }
 *   GET  /api/submissions?type=&status=&limit=&offset=   (requires X-Admin-Token header)
 *   GET  /api/health
 *
 * Storage: D1 (binding DB)
 * Spam protection: Cloudflare Turnstile (server-side verification)
 */

const ALLOWED_TYPES = new Set(["word", "bug"]);

function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  let ok = allowed.includes(origin) ? origin : null;
  if (!ok && origin) {
    // Allow Cloudflare Pages preview/deploy domains and localhost variants.
    try {
      const u = new URL(origin);
      if (u.hostname.endsWith(".pages.dev") || u.hostname === "localhost" || u.hostname === "127.0.0.1") {
        ok = origin;
      }
    } catch (e) {}
  }
  if (!ok) ok = allowed[0] || "*";
  return {
    "Access-Control-Allow-Origin": ok,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Token",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(data, status = 200, origin = null, env = null) {
  const headers = { "Content-Type": "application/json; charset=utf-8" };
  if (origin && env) Object.assign(headers, corsHeaders(origin, env));
  return new Response(JSON.stringify(data), { status, headers });
}

async function verifyTurnstile(token, ip, env) {
  if (!token) return false;
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  let res;
  try {
    res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
    });
  } catch (e) {
    return false;
  }
  if (!res.ok) return false;
  const data = await res.json().catch(() => null);
  return !!(data && data.success);
}

function hashIp(ip) {
  // Lightweight, non-reversible-ish bucketing for rate limiting / dedup.
  if (!ip) return null;
  // Use a simple FNV-1a over the ip + a salt-ish constant; not cryptographic.
  let h = 2166136261;
  const s = ip + "|wordrogue";
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

async function handleHealth(request, env) {
  return json({ ok: true, service: "wordrogue-api", time: new Date().toISOString() });
}

async function handleSubmit(request, env, origin) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, error: "invalid_json" }, 400, origin, env);
  }
  const type = body && body.type;
  if (!ALLOWED_TYPES.has(type)) {
    return json({ ok: false, error: "invalid_type" }, 400, origin, env);
  }
  const payload = body && body.payload;
  if (!payload || typeof payload !== "object") {
    return json({ ok: false, error: "invalid_payload" }, 400, origin, env);
  }
  // Basic validation per type
  if (type === "word") {
    const word = String(payload.word || "").trim();
    if (!word || word.length > 20) {
      return json({ ok: false, error: "invalid_word" }, 400, origin, env);
    }
  } else {
    const title = String(payload.title || "").trim();
    if (!title || title.length > 200) {
      return json({ ok: false, error: "invalid_title" }, 400, origin, env);
    }
  }

  const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("x-forwarded-for") || "";
  const turnstileOk = await verifyTurnstile(body.turnstileToken, ip, env);
  if (!turnstileOk) {
    return json({ ok: false, error: "turnstile_failed" }, 403, origin, env);
  }

  const ipHash = hashIp(ip);
  // Light rate limit: max 20 submissions per ip_hash per hour
  if (ipHash) {
    const recent = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM submissions WHERE ip_hash = ? AND created_at > datetime('now','-1 hour')"
    ).bind(ipHash).first();
    if (recent && recent.c >= 20) {
      return json({ ok: false, error: "rate_limited" }, 429, origin, env);
    }
  }

  const payloadStr = JSON.stringify(payload);
  if (payloadStr.length > 20000) {
    return json({ ok: false, error: "payload_too_large" }, 413, origin, env);
  }

  const stmt = env.DB.prepare(
    "INSERT INTO submissions (type, payload, turnstile_ok, ip_hash) VALUES (?, ?, ?, ?)"
  ).bind(type, payloadStr, turnstileOk ? 1 : 0, ipHash);
  const result = await stmt.run();
  const id = result && result.meta && result.meta.last_row_id;

  return json({ ok: true, id }, 201, origin, env);
}

async function handleList(request, env, origin) {
  const token = request.headers.get("X-Admin-Token");
  if (!token || token !== env.ADMIN_TOKEN) {
    return json({ ok: false, error: "unauthorized" }, 401, origin, env);
  }
  const url = new URL(request.url);
  const type = url.searchParams.get("type");
  const status = url.searchParams.get("status");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 200);
  const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10) || 0, 0);

  let sql = "SELECT id, type, payload, status, turnstile_ok, ip_hash, created_at FROM submissions";
  const conds = [];
  const binds = [];
  if (type) { conds.push("type = ?"); binds.push(type); }
  if (status) { conds.push("status = ?"); binds.push(status); }
  if (conds.length) sql += " WHERE " + conds.join(" AND ");
  sql += " ORDER BY id DESC LIMIT ? OFFSET ?";
  binds.push(limit, offset);

  const stmt = env.DB.prepare(sql).bind(...binds);
  const rows = await stmt.all();
  const items = (rows.results || []).map((r) => ({
    id: r.id,
    type: r.type,
    payload: safeParse(r.payload),
    status: r.status,
    turnstile_ok: !!r.turnstile_ok,
    created_at: r.created_at,
  }));
  return json({ ok: true, items, limit, offset }, 200, origin, env);
}

function safeParse(s) {
  try { return JSON.parse(s); } catch (e) { return s; }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");

    if (request.method === "OPTIONS") {
      const headers = origin ? corsHeaders(origin, env) : {};
      return new Response(null, { status: 204, headers });
    }

    // Route
    if (url.pathname === "/api/health" && request.method === "GET") {
      return handleHealth(request, env);
    }
    if (url.pathname === "/api/submit" && request.method === "POST") {
      return handleSubmit(request, env, origin);
    }
    if (url.pathname === "/api/submissions" && request.method === "GET") {
      return handleList(request, env, origin);
    }

    return json({ ok: false, error: "not_found" }, 404, origin, env);
  },
};
