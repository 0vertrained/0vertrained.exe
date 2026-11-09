// netlify/functions/push-subscribe.js
// Stores / removes a user's Web Push subscription. Auth pattern matches
// coach.js: verify the Supabase JWT server-side, never trust a user_id from
// the body. Writes go through the service-role key so RLS can stay strict
// (no public writes to push_subscriptions).
//
// Required env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE_KEY) {
    return json({ error: "Server not configured" }, 500);
  }

  // ── Bearer token ──────────────────────────────────────────────────────────
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return json({ error: "Missing authorization token" }, 401);

  // ── Verify JWT against Supabase ───────────────────────────────────────────
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

  // ── Payload ───────────────────────────────────────────────────────────────
  let body;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const { action, subscription } = body || {};
  const endpoint = subscription?.endpoint;
  if (!endpoint || typeof endpoint !== "string") return json({ error: "Missing subscription endpoint" }, 400);

  const rest = (path, init) =>
    fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      ...init,
      headers: {
        "apikey": SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
        "content-type": "application/json",
        ...(init?.headers || {}),
      },
    });

  if (action === "unsubscribe") {
    const r = await rest(`push_subscriptions?user_id=eq.${userId}&endpoint=eq.${encodeURIComponent(endpoint)}`, { method: "DELETE" });
    if (!r.ok) return json({ error: "Failed to remove subscription" }, 502);
    return json({ ok: true, removed: true });
  }

  // Courier prefs: per-TYPE toggles applied across ALL the user's
  // devices (a preference is a person's, not a phone's). Booleans only;
  // anything else is ignored. If migrations/V17_3_courier.sql hasn't run,
  // PostgREST 400s on the unknown columns — surfaced as a soft failure the
  // card can explain, never a crash.
  if (action === "prefs") {
    const patch = {};
    if (typeof body?.edition_enabled === "boolean") patch.edition_enabled = body.edition_enabled;
    if (typeof body?.transitions_enabled === "boolean") patch.transitions_enabled = body.transitions_enabled;
    if (typeof body?.reminders_enabled === "boolean") patch.reminders_enabled = body.reminders_enabled;
    if (!Object.keys(patch).length) return json({ error: "No valid preference fields" }, 400);
    const r = await rest(`push_subscriptions?user_id=eq.${userId}`, {
      method: "PATCH",
      headers: { "Prefer": "return=minimal" },
      body: JSON.stringify(patch),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      console.error(`push-subscribe prefs failed ${r.status}: ${detail.slice(0, 200)}`);
      return json({ error: "Preferences not available yet" }, 502);
    }
    return json({ ok: true, prefs: patch });
  }

  // Default: subscribe (upsert on endpoint)
  const keys = subscription?.keys || {};
  if (!keys.p256dh || !keys.auth) return json({ error: "Malformed subscription keys" }, 400);

  // Per-subscription reminder prefs (migration_v28). tz_offset_minutes
  // uses Date#getTimezoneOffset() semantics (UTC-6 Central → 360) and is
  // clamped server-side to the real-world offset range. Both fields are
  // optional — omitted means the column defaults (enabled, Central) apply, so
  // clients that predate this change keep exactly the old behavior.
  const rawOffset = Number(body?.tz_offset_minutes);
  const tzOffset = Number.isFinite(rawOffset)
    ? Math.max(-840, Math.min(840, Math.trunc(rawOffset)))
    : undefined;
  const remindersEnabled = typeof body?.reminders_enabled === "boolean" ? body.reminders_enabled : undefined;

  const r = await rest("push_subscriptions?on_conflict=endpoint", {
    method: "POST",
    headers: { "Prefer": "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      user_id: userId,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      ...(tzOffset !== undefined ? { tz_offset_minutes: tzOffset } : {}),
      ...(remindersEnabled !== undefined ? { reminders_enabled: remindersEnabled } : {}),
      updated_at: new Date().toISOString(),
    }),
  });
  if (!r.ok) {
    // Detail stays in the function log (same stance as coach.js) —
    // PostgREST errors can echo table/column internals the client shouldn't see.
    const detail = await r.text().catch(() => "");
    console.error(`push-subscribe store failed ${r.status}: ${detail.slice(0, 200)}`);
    return json({ error: "Failed to store subscription" }, 502);
  }
  return json({ ok: true });
};

// Routed. Without a path the client's POST to /api/push-subscribe fell through
// to the SPA rewrite (/* → /index.html, 200), so nothing ever reached this
// function. Same pattern as coach.js.
export const config = { path: "/api/push-subscribe" };
