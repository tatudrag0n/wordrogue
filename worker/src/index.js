/**
 * Wordrogue API
 *
 * Endpoints:
 *   POST /api/submit                     { type: "word"|"bug", payload, turnstileToken? }
 *   GET  /api/submissions?type=&status=&limit=&offset=   (X-Admin-Token)
 *   POST /api/donate/checkout            { amount, name?, message? }
 *   POST /api/stripe/webhook             (Stripe signature)
 *   GET  /api/donations?limit=&offset=   (X-Admin-Token)
 *   GET  /api/health
 *
 * Storage: D1 (binding DB)
 * Spam protection: Cloudflare Turnstile (verified when a token is supplied)
 * Payments: Stripe Checkout
 */

const ALLOWED_TYPES = new Set(["word", "bug"]);

/** 寄付の金額範囲 (JPY, 0 桁通貨なのでそのまま円)。 */
const DONATE_MIN = 100;
const DONATE_MAX = 10000;

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
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Token, Stripe-Signature",
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

function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") || request.headers.get("x-forwarded-for") || "";
}

async function handleHealth(request, env) {
  return json({ ok: true, service: "wordrogue-api", time: new Date().toISOString() });
}

// ── フィードバック ────────────────────────────────────────────────────────

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

  // ハニーポット。bot が埋めたら成功したふりをして捨てる。
  if (typeof body.hp === "string" && body.hp.trim() !== "") {
    return json({ ok: true, id: 0 }, 201, origin, env);
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

  const ip = clientIp(request);
  const ipHash = hashIp(ip);

  // Turnstile は「取れたときだけ必須」。取れない環境でも送信できるようにする。
  const token = body.turnstileToken;
  let turnstileOk = false;
  if (token) {
    turnstileOk = await verifyTurnstile(token, ip, env);
    if (!turnstileOk) {
      return json({ ok: false, error: "turnstile_failed" }, 403, origin, env);
    }
  }

  // Turnstile なしの送信は厳しめに絞る (1 時間 5 件)。
  const windowLimit = turnstileOk ? 20 : 5;
  if (ipHash) {
    const recent = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM submissions WHERE ip_hash = ? AND created_at > datetime('now','-1 hour')"
    ).bind(ipHash).first();
    if (recent && recent.c >= windowLimit) {
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

// ── 寄付 (Stripe) ─────────────────────────────────────────────────────────

async function stripePost(env, path, params) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    body.append(k, String(v));
  }
  const res = await fetch("https://api.stripe.com/v1" + path, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + env.STRIPE_SECRET_KEY,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Version": "2024-06-20",
    },
    body,
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

function stripeErrorMessage(data) {
  return (data && data.error && data.error.message) || "stripe_error";
}

function stripeErrorCode(data) {
  const msg = stripeErrorMessage(data).toLowerCase();
  if (msg.includes("cannot currently make live charges")) return "stripe_inactive";
  if (msg.includes("no valid payment method types")) return "stripe_inactive";
  if (msg.includes("api key")) return "stripe_auth";
  return "stripe_error";
}

async function handleDonateCheckout(request, env, origin) {
  if (!env.STRIPE_SECRET_KEY) {
    return json({ ok: false, error: "stripe_not_configured" }, 503, origin, env);
  }
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, error: "invalid_json" }, 400, origin, env);
  }

  const amount = Math.round(Number(body && body.amount));
  if (!Number.isFinite(amount) || amount < DONATE_MIN || amount > DONATE_MAX) {
    return json({ ok: false, error: "invalid_amount", min: DONATE_MIN, max: DONATE_MAX }, 400, origin, env);
  }
  const name = String((body && body.name) || "").trim().slice(0, 40);
  const message = String((body && body.message) || "").trim().slice(0, 300);

  const ip = clientIp(request);
  const ipHash = hashIp(ip);
  if (ipHash) {
    const recent = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM donations WHERE ip_hash = ? AND created_at > datetime('now','-1 hour')"
    ).bind(ipHash).first();
    if (recent && recent.c >= 10) {
      return json({ ok: false, error: "rate_limited" }, 429, origin, env);
    }
  }

  const base = env.SITE_URL || "https://wordrogue.pages.dev";
  const params = {
    mode: "payment",
    submit_type: "donate",
    locale: "ja",
    success_url: base + "/donate.html?thanks=1&session_id={CHECKOUT_SESSION_ID}",
    cancel_url: base + "/donate.html?cancel=1",
    customer_creation: "if_required",
    "line_items[0][price_data][currency]": "jpy",
    "line_items[0][price_data][product_data][name]": "ワードローグを支援",
    "line_items[0][price_data][product_data][description]": "開発・運営の支援として受け取ります",
    "line_items[0][price_data][unit_amount]": amount,
    "line_items[0][quantity]": 1,
    "metadata[app]": "wordrogue",
    "metadata[kind]": "donation",
    "metadata[donor_name]": name,
    "metadata[message]": message,
  };
  if (message) params["payment_intent_data[description]"] = message;

  let r;
  try {
    r = await stripePost(env, "/checkout/sessions", params);
  } catch (e) {
    return json({ ok: false, error: "stripe_unreachable" }, 502, origin, env);
  }
  if (!r.ok) {
    const code = stripeErrorCode(r.data);
    const msg = stripeErrorMessage(r.data);
    return json({ ok: false, error: code, message: msg }, 503, origin, env);
  }

  const session = r.data;
  // 記録 (webhook が来なくても「申込」は残す)。
  try {
    await env.DB.prepare(
      "INSERT INTO donations (session_id, amount, currency, name, message, status, ip_hash) VALUES (?,?,?,?,?,?,?)"
    ).bind(session.id, amount, "jpy", name, message, "pending", ipHash).run();
  } catch (e) {
    // 記録に失敗しても決済は進められる。
  }

  return json({ ok: true, id: session.id, url: session.url }, 201, origin, env);
}

async function handleDonationsList(request, env, origin) {
  const token = request.headers.get("X-Admin-Token");
  if (!token || token !== env.ADMIN_TOKEN) {
    return json({ ok: false, error: "unauthorized" }, 401, origin, env);
  }
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 200);
  const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10) || 0, 0);
  const rows = await env.DB.prepare(
    "SELECT id, session_id, amount, currency, name, message, email, status, created_at FROM donations ORDER BY id DESC LIMIT ? OFFSET ?"
  ).bind(limit, offset).all();
  return json({ ok: true, items: rows.results || [], limit, offset }, 200, origin, env);
}

/**
 * Stripe webhook の署名検証 (Web Crypto)。
 * https://docs.stripe.com/webhooks/signatures
 */
async function verifyStripeSignature(payload, sigHeader, secret) {
  if (!sigHeader || !secret) return false;
  const parts = sigHeader.split(",").reduce((acc, kv) => {
    const i = kv.indexOf("=");
    if (i > 0) acc[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
    return acc;
  }, {});
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(t + "." + payload));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  // タイミング差を避けつつ比較。
  if (hex.length !== v1.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ v1.charCodeAt(i);
  return diff === 0;
}

async function handleStripeWebhook(request, env) {
  const raw = await request.text();
  const sig = request.headers.get("Stripe-Signature");
  const ok = await verifyStripeSignature(raw, sig, env.STRIPE_WEBHOOK_SECRET);
  if (!ok) return new Response("invalid signature", { status: 400 });

  let event;
  try {
    event = JSON.parse(raw);
  } catch (e) {
    return new Response("invalid json", { status: 400 });
  }

  if (event && event.type === "checkout.session.completed") {
    const s = event.data && event.data.object;
    if (s && s.id) {
      const amount = typeof s.amount_total === "number" ? s.amount_total : null;
      const email = (s.customer_details && s.customer_details.email) || s.customer_email || null;
      await env.DB.prepare(
        `INSERT INTO donations (session_id, amount, currency, name, message, email, status)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(session_id) DO UPDATE SET
           status = 'paid',
           amount = COALESCE(excluded.amount, donations.amount),
           email = COALESCE(excluded.email, donations.email)`
      ).bind(
        s.id,
        amount,
        s.currency || "jpy",
        (s.metadata && s.metadata.donor_name) || null,
        (s.metadata && s.metadata.message) || null,
        email,
        "paid"
      ).run();
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
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
    if (url.pathname === "/api/donate/checkout" && request.method === "POST") {
      return handleDonateCheckout(request, env, origin);
    }
    if (url.pathname === "/api/stripe/webhook" && request.method === "POST") {
      return handleStripeWebhook(request, env);
    }
    if (url.pathname === "/api/donations" && request.method === "GET") {
      return handleDonationsList(request, env, origin);
    }

    return json({ ok: false, error: "not_found" }, 404, origin, env);
  },
};
