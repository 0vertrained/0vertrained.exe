// netlify/functions/_next-env.js
// v20 · Shared helpers for the /api/next/* functions. Imported, never deployed
// (the leading underscore keeps it out of the functions-directory route test).
//
// The v20 app talks to a separate Supabase project until cutover, configured
// through NEXT_SUPABASE_* so the live v19 values can never leak in. Nothing in
// here imports the legacy functions — they stay independent on purpose.

import { createHash } from "node:crypto";

// The project URL as an origin. The dashboard also offers per-service URLs
// (…/rest/v1, …/auth/v1); pasted as-is they would double every path this
// module builds, so a trailing service segment and slashes are dropped.
export function normalizeSupabaseUrl(value) {
  return String(value ?? "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/(?:rest|auth|storage|realtime|functions)\/v1$/i, "")
    .replace(/\/+$/, "");
}

// Required server env for every /api/next/* function. Returns null when any
// value is missing so callers can answer 500 instead of calling a half-set URL.
export function readNextEnv(env = process.env) {
  const url = normalizeSupabaseUrl(env.NEXT_SUPABASE_URL);
  const anonKey = String(env.NEXT_SUPABASE_ANON_KEY ?? "").trim();
  const serviceRoleKey = String(env.NEXT_SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!url || !anonKey || !serviceRoleKey) return null;
  return { url, anonKey, serviceRoleKey };
}

// no-store: every response here is per-request (caps, rate limits, auth).
export const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });

// Service-role REST/RPC/admin headers. `prefer` is the PostgREST Prefer value
// (count=exact, return=minimal, …) and is omitted when empty.
export function serviceHeaders(key, prefer = "") {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "content-type": "application/json",
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

// Netlify's connection header first, then the first (client) hop of
// x-forwarded-for. Returns "" when no address is available.
export function clientIp(req) {
  const nf = req.headers.get("x-nf-client-connection-ip");
  const xff = (req.headers.get("x-forwarded-for") || "").split(",")[0];
  return String(nf || xff || "").trim();
}

// Anonymous reporters are keyed by sha256(ip | utc-date | salt), where the
// salt is sha256(service role key) — a value that never leaves the server. The
// date in the preimage rotates the key daily, so no stable per-address
// identifier accumulates, and the secret salt means a leaked table cannot be
// brute-forced back to IPv4 space. No raw IP is ever stored.
export function ipHash(ip, dateKey, serviceRoleKey) {
  const salt = createHash("sha256").update(String(serviceRoleKey), "utf8").digest("hex");
  return createHash("sha256").update(`${ip}|${dateKey}|${salt}`, "utf8").digest("hex");
}

// Resolves a Bearer token to a user id via GoTrue, with the anon key as the
// apikey so the project's own JWT validation applies. Null on any failure —
// a missing header, a rejected token, a network error — and never throws, so
// callers decide what "unauthenticated" means for their endpoint.
export async function verifyBearer(req, env) {
  try {
    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (!token) return null;
    const r = await fetch(`${env.url}/auth/v1/user`, {
      headers: { apikey: env.anonKey, Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return null;
    const user = await r.json();
    return typeof user?.id === "string" && user.id ? user.id : null;
  } catch {
    return null;
  }
}

// Server-side length clamp; every stored field goes through this regardless of
// what the client claims.
export const clamp = (v, n) => String(v ?? "").slice(0, n);
