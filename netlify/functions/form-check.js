// netlify/functions/form-check.js
// Same-origin proxy for the hosted Form Check engine.
// Keeps upstream base URL / API key out of the Vite browser bundle.
//
// V13.5 hardening — this was the only user-facing function without an auth
// gate. It attached FORM_CHECK_API_KEY to any request from anywhere, and the
// path suffix was forwarded verbatim (URL normalization meant
// /api/form-check/../admin reached ${base}/admin on the upstream host).
//  • Every request now requires a valid Supabase JWT, verified server-side
//    exactly like coach.js / log-error.js. The engine burns real compute per
//    clip; anonymous access was a cost-abuse and SSRF hole.
//  • The upstream path is allowlist-only. Unknown or traversal-shaped
//    suffixes are rejected before any upstream contact.
//  • Oversized bodies are rejected up front via content-length, matching the
//    coach.js pattern (generous ceiling — clips are legitimately large).

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
};

// The complete set of engine routes the app uses. Extend deliberately — every
// entry here is reachable by any signed-in user with your API key attached.
const ALLOWED_UPSTREAM_PATHS = new Set(["/analyze"]);

// Content-length ceiling. Form-check clips are short webm captures; 100 MB is
// far above any legitimate clip while still bounding abuse. Platform limits
// apply beneath this either way.
const MAX_BODY_BYTES = Number.parseInt(process.env.FORM_CHECK_MAX_BYTES || "", 10) || 100 * 1024 * 1024;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...SECURITY_HEADERS, "content-type": "application/json" },
  });
}

// Resolve the /api/form-check/* suffix to a vetted upstream path, or null.
// Exact-match against the allowlist — no prefixes, no traversal, no query
// smuggling into the path.
export function resolveUpstreamPath(requestUrl) {
  let pathname;
  try {
    pathname = new URL(requestUrl).pathname;
  } catch {
    return null;
  }
  const suffix = pathname.replace(/^\/api\/form-check/, "") || "/";
  return ALLOWED_UPSTREAM_PATHS.has(suffix) ? suffix : null;
}

export function requestTooLarge(req, maxBytes = MAX_BODY_BYTES) {
  const len = Number(req.headers.get("content-length") || 0);
  return Number.isFinite(len) && len > maxBytes;
}

export const config = { path: "/api/form-check/*" };

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (requestTooLarge(req)) return json({ error: "Clip too large for form check." }, 413);

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const base = (process.env.FORM_CHECK_API_BASE || "").replace(/\/$/, "");
  if (!base || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return json({ error: "Form check engine not configured" }, 500);
  }

  // ── Bearer token — verified against Supabase before any upstream work ─────
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return json({ error: "Sign in to use Form Check." }, 401);

  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { "Authorization": `Bearer ${token}`, "apikey": SUPABASE_ANON_KEY },
    });
    if (!r.ok) return json({ error: "Invalid or expired session" }, 401);
    const user = await r.json();
    if (!user?.id) return json({ error: "Could not resolve user" }, 401);
  } catch {
    return json({ error: "Auth verification failed" }, 502);
  }

  // ── Allowlisted upstream path only ─────────────────────────────────────────
  const path = resolveUpstreamPath(req.url);
  if (!path) return json({ error: "Unknown form check route." }, 404);

  const upstreamUrl = `${base}/api/form-check${path}`;
  const headers = new Headers();
  const contentType = req.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  const apiKey = process.env.FORM_CHECK_API_KEY;
  if (apiKey) headers.set("X-FormCheck-Key", apiKey);

  let upstream;
  try {
    upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers,
      body: req.body,
      duplex: "half",
    });
  } catch (e) {
    console.error("form-check proxy upstream error:", e?.message || e);
    return json({ error: "Couldn't reach the form check engine." }, 502);
  }

  const bodyText = await upstream.text().catch(() => "");
  const responseHeaders = { ...SECURITY_HEADERS, "content-type": upstream.headers.get("content-type") || "application/json" };
  if (!upstream.ok) {
    let safe = { error: `Form check engine returned ${upstream.status}.` };
    try {
      const parsed = JSON.parse(bodyText || "{}");
      safe = { error: parsed?.error || parsed?.detail || safe.error };
    } catch {
      // Keep generic message.
    }
    return new Response(JSON.stringify(safe), { status: upstream.status, headers: responseHeaders });
  }

  return new Response(bodyText, { status: upstream.status, headers: responseHeaders });
};
