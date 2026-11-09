// netlify/functions/wearable-snapshot.js
// Wearable display-snapshot endpoint.
//
// Endpoints (Netlify v2, path /api/wearable/*):
// • GET  /api/wearable/snapshot — the caller's latest display-safe recovery
//                                 snapshot (token-free). Ownership is derived
//                                 ONLY from the verified Supabase Bearer JWT.
// • GET  /api/wearable/status   — lightweight freshness marker for the caller
//                                 (hasSnapshot + fresh/stale + updatedAt).
// • POST /api/wearable/snapshot — upsert the caller's snapshot. Ownership is
//                                 derived from the Bearer token; a user_id in
//                                 the body/query is NEVER trusted. The snapshot
//                                 is stripped of token-like fields defensively.
//
// Security (mirrors netlify/functions/whoop-auth.js and oura-auth.js):
// • User ownership is always derived from a verified Supabase Bearer token —
//   never a query param or request body (same invariant Whoop enforces).
// • Reads/writes to wearable_snapshots use the service_role key server-side;
//   the browser only ever SELECTs its own row through RLS.
// • Responses and stored rows are display-safe: token/secret-like fields are
//   stripped recursively before storage and before the response is returned.
//   No OAuth tokens, no raw auth responses, no raw biometric payloads.
//
// This function is intentionally self-contained (like the other netlify
// functions); the pure sanitizer/status helpers are also exported for tests and
// mirror src/wearables/snapshotSanitize.js so the two paths cannot drift.

// A snapshot older than this is labelled "stale" (still returned, but flagged).
const SNAPSHOT_STALE_MS = 6 * 60 * 60 * 1000;
// Hard cap on the stored snapshot size (defence-in-depth against a caller trying
// to dump a large raw payload into the display snapshot).
const MAX_SNAPSHOT_BYTES = 32 * 1024;

// Secret-key stripping (mirrors src/wearableSnapshotCache.js)
const EXACT_SECRET_KEYS = new Set([
  "token", "tokens", "authorization", "bearer", "jwt",
  "secret", "password", "passwd", "credential", "credentials",
]);
const part = (...pieces) => pieces.join("");
const SECRET_SUBSTRINGS = [
  part("access", "_", "token"), part("access", "token"),
  part("refresh", "_", "token"), part("refresh", "token"),
  part("id", "_", "token"), part("id", "token"),
  part("session", "_", "token"), part("session", "token"),
  part("client", "_", "secret"), part("client", "secret"),
  part("api", "_", "key"), part("api", "key"),
  part("service", "_", "key"), part("service", "key"),
  part("service", "_", "role"), part("service", "role"),
  part("private", "_", "key"), part("private", "key"),
  part("auth", "_", "response"), part("auth", "response"),
];
function isSecretKey(key) {
  const k = String(key).toLowerCase();
  if (EXACT_SECRET_KEYS.has(k)) return true;
  return SECRET_SUBSTRINGS.some((s) => k.includes(s));
}

/**
 * Recursively strip secret/token-bearing keys from a value. Pure; exported for
 * tests. Used on both the inbound POST body and the outbound response so a
 * secret can never be stored or returned even if a caller/DB regressed.
 */
export function sanitizeForClient(value) {
  if (Array.isArray(value)) return value.map((v) => sanitizeForClient(v));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (isSecretKey(k)) continue;
      out[k] = sanitizeForClient(v);
    }
    return out;
  }
  return value;
}

/**
 * Derive a display-safe freshness status. Pure; exported for tests.
 *   "empty" — no snapshot; "stale" — present but old/undatable; "fresh" — recent.
 */
export function deriveStatus({ hasSnapshot, updatedAt, now = Date.now(), staleMs = SNAPSHOT_STALE_MS } = {}) {
  if (!hasSnapshot) return "empty";
  const ts = updatedAt ? new Date(updatedAt).getTime() : NaN;
  if (!Number.isFinite(ts) || ts <= 0) return "stale";
  const ageMs = now - ts;
  if (ageMs < 0) return "fresh";
  return ageMs > staleMs ? "stale" : "fresh";
}

// Response helpers
const SECURITY_HEADERS = {
  "content-type": "application/json",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-xss-protection": "1; mode=block",
};
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: SECURITY_HEADERS });
}

// Auth / identity (mirrors whoop-auth.js)
async function resolveUserIdFromBearer(req) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { "Authorization": `Bearer ${token}`, "apikey": SUPABASE_ANON_KEY },
  });
  if (!r.ok) return null;
  const user = await r.json();
  return user?.id || null;
}

function serviceHeaders(serviceKey, extra = {}) {
  return { "authorization": `Bearer ${serviceKey}`, "apikey": serviceKey, ...extra };
}

// Load the caller's snapshot row (service role). Returns the row or null.
async function loadSnapshotRow(supabaseUrl, serviceKey, userId) {
  const r = await fetch(
    `${supabaseUrl}/rest/v1/wearable_snapshots?user_id=eq.${encodeURIComponent(userId)}&select=snapshot,source,status,updated_at&limit=1`,
    { headers: serviceHeaders(serviceKey) }
  );
  if (!r.ok) throw new Error(`snapshot lookup failed: ${r.status}`);
  const rows = await r.json();
  return rows?.[0] || null;
}

// Route: GET /api/wearable/snapshot
async function handleGetSnapshot(req) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: "Server not configured" }, 500);

  let userId;
  try { userId = await resolveUserIdFromBearer(req); }
  catch { userId = null; }
  if (!userId) return json({ error: "Not authenticated" }, 401);

  let row;
  try {
    row = await loadSnapshotRow(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, userId);
  } catch {
    return json({ error: "Snapshot unavailable" }, 502);
  }

  if (!row) {
    return json({ snapshot: null, source: null, updatedAt: null, status: "empty", hasSnapshot: false });
  }

  const safe = sanitizeForClient(row.snapshot || null);
  const hasSnapshot = Boolean(safe && typeof safe === "object" && Object.keys(safe).length > 0);
  return json({
    snapshot: hasSnapshot ? safe : null,
    source: typeof row.source === "string" && row.source ? row.source : null,
    updatedAt: row.updated_at || null,
    status: deriveStatus({ hasSnapshot, updatedAt: row.updated_at }),
    hasSnapshot,
  });
}

// Route: GET /api/wearable/status
async function handleGetStatus(req) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: "Server not configured" }, 500);

  let userId;
  try { userId = await resolveUserIdFromBearer(req); }
  catch { userId = null; }
  if (!userId) return json({ error: "Not authenticated" }, 401);

  let row;
  try {
    row = await loadSnapshotRow(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, userId);
  } catch {
    return json({ error: "Status unavailable" }, 502);
  }

  const hasSnapshot = Boolean(row && row.snapshot && typeof row.snapshot === "object" && Object.keys(row.snapshot).length > 0);
  return json({
    hasSnapshot,
    status: deriveStatus({ hasSnapshot, updatedAt: row?.updated_at }),
    updatedAt: row?.updated_at || null,
    source: typeof row?.source === "string" && row.source ? row.source : null,
  });
}

// Route: POST /api/wearable/snapshot
// Upsert the caller's display-safe snapshot. Ownership derives from the Bearer
// token ONLY — a user_id in the body/query is ignored, never trusted.
async function handlePostSnapshot(req) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: "Server not configured" }, 500);

  let userId;
  try { userId = await resolveUserIdFromBearer(req); }
  catch { userId = null; }
  if (!userId) return json({ error: "Not authenticated" }, 401);

  let body;
  try { body = await req.json(); }
  catch { return json({ error: "Invalid JSON" }, 400); }

  const rawSnapshot = body && typeof body === "object" ? body.snapshot : null;
  if (!rawSnapshot || typeof rawSnapshot !== "object") {
    return json({ error: "Missing snapshot" }, 400);
  }

  // Strip token-like fields defensively before anything else touches the DB, and
  // enforce a size cap so a large raw payload can't be dumped into the snapshot.
  const safe = sanitizeForClient(rawSnapshot);
  const serialized = JSON.stringify(safe);
  if (serialized.length > MAX_SNAPSHOT_BYTES) {
    return json({ error: "Snapshot too large" }, 413);
  }

  const source = typeof body.source === "string" && body.source ? body.source.slice(0, 32) : null;
  const updatedAt = new Date().toISOString();
  const hasSnapshot = Object.keys(safe).length > 0;
  const status = deriveStatus({ hasSnapshot, updatedAt });

  try {
    // Ownership is the verified userId; the body's user_id (if any) is discarded.
    const r = await fetch(`${SUPABASE_URL}/rest/v1/wearable_snapshots?on_conflict=user_id`, {
      method: "POST",
      headers: serviceHeaders(SUPABASE_SERVICE_ROLE_KEY, {
        "content-type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
      }),
      body: JSON.stringify({
        user_id: userId,
        source,
        status,
        snapshot: safe,
        updated_at: updatedAt,
      }),
    });
    if (!r.ok) {
      console.error("Wearable snapshot upsert failed:", r.status);
      return json({ error: "Snapshot store failed" }, 502);
    }
  } catch (e) {
    console.error("Wearable snapshot store error:", e?.message || "error");
    return json({ error: "Snapshot store failed" }, 502);
  }

  return json({ ok: true, status, updatedAt, source, hasSnapshot });
}

// Netlify entrypoint
export const config = { path: "/api/wearable/*" };

export default async (req) => {
  const url = new URL(req.url);
  if (url.pathname.endsWith("/api/wearable/snapshot")) {
    if (req.method === "GET") return await handleGetSnapshot(req);
    if (req.method === "POST") return await handlePostSnapshot(req);
    return json({ error: "Method not allowed" }, 405);
  } else if (url.pathname.endsWith("/api/wearable/status")) {
    if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);
    return await handleGetStatus(req);
  }
  return json({ error: "Not found" }, 404);
};
