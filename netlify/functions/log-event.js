// netlify/functions/log-event.js
// V17.0 · Funnel event sink for the beta go/no-go call. Same doctrine as
// log-error.js: JWT-verified (anonymous sinks are abuse magnets), every field
// clamped server-side, per-user daily flood cap, and 200s on every tolerable
// failure so the client's fire-and-forget logger never retries. If the
// `events` table hasn't been created yet (migrations/V17_0_events.sql), this
// endpoint no-ops with 200 — telemetry must never precede the product.
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
  const name = clamp(body?.name, 64).trim();
  if (!name || !/^[a-z0-9_:-]+$/i.test(name)) return json({ error: "Missing or invalid event name" }, 400);

  const svc = {
    "apikey": SERVICE_ROLE_KEY,
    "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };

  // Per-user daily flood cap (funnel steps are a handful per user, ever).
  const DAILY_CAP = Math.max(1, parseInt(process.env.LOG_EVENT_DAILY_CAP || "50", 10) || 50);
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const head = await fetch(
      `${SUPABASE_URL}/rest/v1/events?user_id=eq.${userId}&created_at=gte.${since}&select=id`,
      { method: "HEAD", headers: { ...svc, "Prefer": "count=exact", "Range": "0-0" } }
    );
    const total = parseInt((head.headers.get("content-range") || "").split("/")[1] || "0", 10);
    if (Number.isFinite(total) && total >= DAILY_CAP) return json({ ok: true, capped: true });
  } catch { /* fail open */ }

  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/events`, {
      method: "POST",
      headers: { ...svc, "Prefer": "return=minimal" },
      body: JSON.stringify({ user_id: userId, name, client_at: clamp(body?.at, 40) || null }),
    });
    // 404/42P01 → table not created yet: tolerate silently (see header note).
    if (!r.ok && r.status !== 404) {
      const detail = await r.text().catch(() => "");
      if (!/does not exist|42P01/.test(detail)) return json({ ok: false }, 200);
    }
  } catch { /* tolerate */ }

  return json({ ok: true });
};
