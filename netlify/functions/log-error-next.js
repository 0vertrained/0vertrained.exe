// netlify/functions/log-error-next.js
// v20 · Client error sink for the /next app. Unlike the legacy sink this one
// accepts anonymous reports (the v20 app is guest-first, and a crash before
// sign-in is exactly the report we most want), so the abuse surface is bounded
// by three caps instead of a JWT gate:
//   · signed-in  → LOG_ERROR_DAILY_CAP rows per user per rolling 24 h
//   · anonymous  → 20 rows per ip_hash per UTC day (one noisy client)
//               AND 2,000 anonymous rows per UTC day (one botnet)
// Every cap answers 200 so the client's fire-and-forget logger never retries
// a capped report, and every cap FAILS OPEN: a counting hiccup must not
// silently swallow a genuine crash. The only hard failure is the insert.
//
// Required env: NEXT_SUPABASE_URL, NEXT_SUPABASE_ANON_KEY,
//               NEXT_SUPABASE_SERVICE_ROLE_KEY
// Optional:     LOG_ERROR_DAILY_CAP (default 200),
//               ERROR_REPORTING_ENABLED ("false" is the kill switch)

import { clamp, clientIp, ipHash, json, readNextEnv, serviceHeaders, verifyBearer } from "./_next-env.js";

// 16 KB covers a message + stack + component stack at their clamps several
// times over; anything larger is a mistake or an attack and is dropped, not
// rejected with 413 — the client would only retry or mask the original error.
const MAX_BODY_BYTES = 16 * 1024;
const ANON_IP_DAILY_CAP = 20;
const ANON_GLOBAL_DAILY_CAP = 2000;
const DEFAULT_USER_DAILY_CAP = 200;

const dropped = (reason) => json(reason ? { ok: true, dropped: true, reason } : { ok: true, dropped: true });

// PostgREST returns the exact total in Content-Range on a HEAD request without
// transferring rows ("0-0/123"). Null means "could not count" so the caller
// can fail open; a non-2xx carries no Content-Range and lands there too.
async function countRows(env, filter) {
  try {
    const r = await fetch(`${env.url}/rest/v1/client_errors?${filter}&select=id`, {
      method: "HEAD",
      headers: { ...serviceHeaders(env.serviceRoleKey, "count=exact"), "Range-Unit": "items", Range: "0-0" },
    });
    const total = Number((r.headers.get("content-range") || "").split("/").pop());
    return Number.isFinite(total) ? total : null;
  } catch {
    return null;
  }
}

const hit = (total, cap) => total !== null && total >= cap;

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Kill switch: checked before anything else so an incident can stop the
  // sink without touching the database or the client build.
  if (process.env.ERROR_REPORTING_ENABLED === "false") return dropped();

  const env = readNextEnv();
  if (!env) return json({ error: "Server not configured" }, 500);

  // Body cap. Content-Length is checked first so an oversized body is never
  // read; the byte count after reading catches a missing or dishonest header.
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return dropped("too-large");
  let text;
  try { text = await req.text(); } catch { return json({ error: "Invalid JSON" }, 400); }
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return dropped("too-large");

  let body;
  try { body = JSON.parse(text); } catch { return json({ error: "Invalid JSON" }, 400); }
  if (typeof body?.message !== "string" || !body.message.trim()) return json({ error: "Missing message" }, 400);

  // Identity. A Bearer header that fails verification (expired tab, revoked
  // session) falls back to the anonymous path rather than 401: the report is
  // still worth keeping, and the anonymous caps are the stricter ones anyway.
  const userId = req.headers.has("authorization") ? await verifyBearer(req, env) : null;

  const now = new Date();
  const dateKey = now.toISOString().slice(0, 10);
  const dayStart = encodeURIComponent(`${dateKey}T00:00:00.000Z`);
  // No address at all (local dev, an unusual proxy) shares one "unknown"
  // bucket so an address-less path can never become an uncapped channel.
  const anonHash = userId ? null : ipHash(clientIp(req) || "unknown", dateKey, env.serviceRoleKey);

  if (userId) {
    const cap = Math.max(1, parseInt(process.env.LOG_ERROR_DAILY_CAP || "", 10) || DEFAULT_USER_DAILY_CAP);
    const since = encodeURIComponent(new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString());
    const total = await countRows(env, `user_id=eq.${encodeURIComponent(userId)}&created_at=gte.${since}`);
    if (hit(total, cap)) return json({ ok: true, capped: true });
  } else {
    // Both anonymous counts are independent, so they run in parallel. The
    // global count covers anonymous rows only (user_id is null): signed-in
    // users have their own cap and must not be starved by an anonymous flood,
    // nor the reverse.
    const [perIp, global] = await Promise.all([
      countRows(env, `ip_hash=eq.${anonHash}&created_at=gte.${dayStart}`),
      countRows(env, `user_id=is.null&created_at=gte.${dayStart}`),
    ]);
    if (hit(perIp, ANON_IP_DAILY_CAP) || hit(global, ANON_GLOBAL_DAILY_CAP)) {
      return json({ ok: true, capped: true });
    }
  }

  const row = {
    user_id: userId,
    ip_hash: anonHash,
    message: clamp(body.message, 500),
    stack: clamp(body.stack, 4000),
    component_stack: clamp(body.component_stack, 2000),
    url: clamp(body.url, 300),
    version: clamp(body.version, 20),
    ref: clamp(body.ref, 40),
    user_agent: clamp(req.headers.get("user-agent"), 300),
  };

  try {
    const r = await fetch(`${env.url}/rest/v1/client_errors`, {
      method: "POST",
      headers: serviceHeaders(env.serviceRoleKey, "return=minimal"),
      body: JSON.stringify(row),
    });
    if (!r.ok) return json({ error: "Failed to store error" }, 502);
  } catch {
    return json({ error: "Failed to store error" }, 502);
  }
  return json({ ok: true });
};

// Without a route, /api/next/log-error would fall through netlify.toml's SPA
// rewrite and return index.html.
export const config = { path: "/api/next/log-error" };
