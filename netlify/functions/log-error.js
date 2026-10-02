// netlify/functions/log-error.js
// V9 · Client error sink. JWT-verified (same pattern as coach.js /
// push-subscribe.js) — anonymous error sinks are abuse magnets, so pre-auth
// client errors queue client-side and flush after login instead. Every field
// is clamped server-side regardless of what the client claims.
//
// Required env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const clamp = (v, n) => String(v ?? "").slice(0, n);

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE_KEY) {
    return json({ error: "Server not configured" }, 500);
  }

  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return json({ error: "Missing authorization token" }, 401);

  let userId;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { "Authorization": `Bearer ${token}`, "apikey": SUPABASE_ANON_KEY },
    });
    if (!r.ok) return json({ error: "Invalid or expired session" }, 401);
    const user = await r.json();
    userId = user?.id || null;
  } catch {
    return json({ error: "Auth verification failed" }, 502);
  }
  if (!userId) return json({ error: "Could not resolve user" }, 401);

  let body;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  if (!body?.message) return json({ error: "Missing message" }, 400);

  // V13.6 · Per-user daily flood cap. This endpoint is JWT-gated but was
  // otherwise uncapped, so one authenticated client (a crash loop, or a
  // malicious user) could bloat client_errors without bound. Count this user's
  // rows in the last 24h via a HEAD request (PostgREST returns the total in
  // Content-Range without transferring rows) and drop new errors past the
  // ceiling. Returns 200 so the client's fire-and-forget logger never treats a
  // cap as a failure to retry. Fails OPEN — a counting hiccup should not
  // silently swallow a genuine error report.
  const DAILY_ERROR_CAP = Math.max(1, parseInt(process.env.LOG_ERROR_DAILY_CAP || "200", 10) || 200);
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const countRes = await fetch(
      `${SUPABASE_URL}/rest/v1/client_errors?user_id=eq.${encodeURIComponent(userId)}&created_at=gte.${encodeURIComponent(since)}&select=id`,
      {
        method: "HEAD",
        headers: {
          "apikey": SERVICE_ROLE_KEY,
          "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
          "Prefer": "count=exact",
          "Range-Unit": "items",
          "Range": "0-0",
        },
      },
    );
    const contentRange = countRes.headers.get("content-range") || "";
    const total = Number(contentRange.split("/").pop());
    if (Number.isFinite(total) && total >= DAILY_ERROR_CAP) {
      return json({ ok: true, capped: true });
    }
  } catch {
    // Fail open — proceed to insert.
  }

  const row = {
    user_id: userId,
    message: clamp(body.message, 500),
    stack: clamp(body.stack, 4000),
    component_stack: clamp(body.component_stack, 2000),
    source: clamp(body.source, 40),
    path: clamp(body.path, 200),
    app_version: clamp(body.app_version, 20),
    user_agent: clamp(req.headers.get("user-agent"), 300),
  };

  const r = await fetch(`${SUPABASE_URL}/rest/v1/client_errors`, {
    method: "POST",
    headers: {
      "apikey": SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      "Prefer": "return=minimal",
    },
    body: JSON.stringify(row),
  });
  if (!r.ok) return json({ error: "Failed to store error" }, 502);
  return json({ ok: true });
};

// v19.2.1 · Without a route, /api/log-error fell through netlify.toml's SPA
// rewrite and returned index.html, so these calls never reached the function.
export const config = { path: "/api/log-error" };
