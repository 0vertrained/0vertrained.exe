// netlify/functions/whoop-auth.js
import { PROVIDERS, resolveProviderTokens, persistProviderTokens, getProviderConnectionSummary } from "./_provider-standard.js";

// ─────────────────────────────────────────────────────────────────────────────
// Whoop OAuth flow + manual sync handler (V2.9 Whoop Foundation)
//
// Endpoints (Netlify v2, path /api/whoop/*):
// • GET  /api/whoop/auth       — verifies Supabase Bearer, mints 8-char state,
//                                stores it server-side, returns/redirects to the
//                                Whoop authorize URL.
// • GET  /api/whoop/callback   — exchanges code for tokens. User ownership is
//                                derived ONLY from the whoop_oauth_state row, never
//                                from query params.
// • GET  /api/whoop/status     — safe token/sync status, no tokens exposed.
// • POST /api/whoop/sync       — caller-authenticated manual 14-day sync.
// • POST /api/whoop/disconnect — deletes the caller's Whoop tokens + data.
//
// Security (mirrors netlify/functions/oura-auth.js):
// • User ownership is derived from a verified Supabase Bearer token, never query
//   params or request body, for auth/status/sync/disconnect.
// • The callback trusts ONLY the whoop_oauth_state table for ownership.
// • Self-generated CSRF state is exactly 8 URL-safe chars (Whoop requirement),
//   stored via service_role with a 10-minute TTL and best-effort deleted.
// • WHOOP_CLIENT_SECRET lives only in Netlify env vars (never browser / never
//   VITE_*). Tokens are stored via the service_role key (server-to-server).
// • We never log access_token, refresh_token, client_secret, Authorization
//   headers, raw Whoop payloads, or full failing rows.
// ─────────────────────────────────────────────────────────────────────────────

const WHOOP_AUTH_URL = "https://api.prod.whoop.com/oauth/oauth2/auth";
const WHOOP_TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";
const WHOOP_API_BASE = "https://api.prod.whoop.com/developer/v2";

// Whoop user-data scopes for the Foundation sprint. `offline` is required to
// receive a refresh token so manual sync can run after the access token expires.
const WHOOP_SCOPES = "read:recovery read:sleep read:cycles read:workout offline";

const STATE_TTL_MS = 10 * 60 * 1000;
const STATE_LEN = 8;
// Treat an access token with <= 5 minutes of life left as due for refresh so
// /status can self-heal before the token actually expires (no reconnect prompt).
// Exported so the scheduled prefetch reuses the exact same near-expiry policy.
export const TOKEN_NEAR_EXPIRY_MS = 5 * 60 * 1000;
// Default sync window (days). Exported so the scheduled hourly prefetch reuses the
// same conservative 14-day window instead of hard-coding a divergent value.
export const SYNC_DAYS = 14;
export const MAX_SYNC_DAYS = 30; // upper bound for the initial-backfill (?days=30) button
const MAX_PAGES = 10; // conservative pagination bound per endpoint

// ─── Redaction helpers ───────────────────────────────────────────────────────
// Mirrors the Oura redaction. PostgREST error bodies may echo a failing row that
// contains the Whoop JSON payload, so we keep code/message/hint but redact
// tokens and payload/row detail. Never log biometric data.
function redactSensitive(text) {
  if (!text) return text;
  let out = String(text).replace(
    /("?(?:access_token|refresh_token|client_secret|service_role_key|service_role|apikey|authorization|bearer)"?\s*[:=]\s*"?)([^",&}\s]+)/gi,
    (_m, prefix) => `${prefix}[REDACTED]`
  );
  out = out.replace(/("payload"\s*:\s*)(\{.*?\}|\[.*?\]|".*?")/gis, '$1"[REDACTED_PAYLOAD]"');
  out = out.replace(/("details"\s*:\s*")([^"\\]*(?:\\.[^"\\]*)*)"/gi, (_m, prefix, details) => {
    const d = String(details || "");
    return /failing row|payload|access_token|refresh_token/i.test(d)
      ? `${prefix}[REDACTED_ROW_DETAILS]"`
      : `${prefix}${d}"`;
  });
  return out;
}

// Safely read a failed response body for logging: never throws, redacts
// sensitive/biometric detail, truncates so logs stay small.
async function readErrorBody(response, maxLen = 800) {
  try {
    const text = await response.text();
    if (!text) return "";
    const redacted = redactSensitive(text);
    return redacted.length > maxLen ? `${redacted.slice(0, maxLen)}…[truncated]` : redacted;
  } catch {
    return "<unreadable body>";
  }
}

// ─── Response helpers ────────────────────────────────────────────────────────
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

function redirect(location, status = 302) {
  return new Response(null, {
    status,
    headers: {
      location,
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "strict-origin-when-cross-origin",
    },
  });
}

// ─── Auth / identity ─────────────────────────────────────────────────────────
async function resolveUserIdFromBearer(req) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "apikey": SUPABASE_ANON_KEY,
    },
  });
  if (!r.ok) return null;
  const user = await r.json();
  return user?.id || null;
}

// Generate exactly 8 URL-safe chars. Whoop requires the self-generated state be
// eight characters long; we use an unambiguous URL-safe alphabet.
function generateState() {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const bytes = new Uint8Array(STATE_LEN);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < STATE_LEN; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

// ─── Supabase (service_role) helpers ─────────────────────────────────────────
function serviceHeaders(serviceKey, extra = {}) {
  return {
    "authorization": `Bearer ${serviceKey}`,
    "apikey": serviceKey,
    ...extra,
  };
}

async function storeState(supabaseUrl, serviceKey, state, userId) {
  const expiresAt = new Date(Date.now() + STATE_TTL_MS).toISOString();
  const r = await fetch(`${supabaseUrl}/rest/v1/whoop_oauth_state`, {
    method: "POST",
    headers: serviceHeaders(serviceKey, {
      "content-type": "application/json",
      "Prefer": "return=minimal",
    }),
    body: JSON.stringify({ state, user_id: userId, expires_at: expiresAt }),
  });
  return r.ok;
}

// Look up + consume a state row. Returns the user_id if the state is valid and
// unexpired, else null. The row is best-effort deleted regardless so it can be
// used exactly once. Expired rows are also swept opportunistically.
async function consumeState(supabaseUrl, serviceKey, state) {
  let userId = null;
  try {
    const r = await fetch(
      `${supabaseUrl}/rest/v1/whoop_oauth_state?state=eq.${encodeURIComponent(state)}&select=user_id,expires_at&limit=1`,
      { headers: serviceHeaders(serviceKey) }
    );
    if (r.ok) {
      const rows = await r.json();
      const row = rows?.[0];
      if (row && new Date(row.expires_at) > new Date()) {
        userId = row.user_id;
      }
    }
  } catch {
    userId = null;
  }
  // Best-effort delete of the consumed row + any expired rows.
  try {
    await fetch(`${supabaseUrl}/rest/v1/whoop_oauth_state?state=eq.${encodeURIComponent(state)}`, {
      method: "DELETE",
      headers: serviceHeaders(serviceKey, { "Prefer": "return=minimal" }),
    });
    await fetch(`${supabaseUrl}/rest/v1/whoop_oauth_state?expires_at=lt.${encodeURIComponent(new Date().toISOString())}`, {
      method: "DELETE",
      headers: serviceHeaders(serviceKey, { "Prefer": "return=minimal" }),
    });
  } catch {
    /* best-effort */
  }
  return userId;
}

// ─── Route: GET /api/whoop/auth ──────────────────────────────────────────────
async function handleAuth(req) {
  const WHOOP_CLIENT_ID = process.env.WHOOP_CLIENT_ID;
  const WHOOP_REDIRECT_URI = process.env.WHOOP_REDIRECT_URI;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!WHOOP_CLIENT_ID || !WHOOP_REDIRECT_URI || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "Whoop not configured" }, 500);
  }

  let userId;
  try { userId = await resolveUserIdFromBearer(req); }
  catch { userId = null; }
  if (!userId) return json({ error: "Not authenticated" }, 401);

  const state = generateState();
  const stored = await storeState(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, state, userId);
  if (!stored) {
    console.error("Whoop auth: failed to persist oauth state");
    return json({ error: "Could not start Whoop connection" }, 502);
  }

  const authorizeUrl = new URL(WHOOP_AUTH_URL);
  authorizeUrl.searchParams.set("client_id", WHOOP_CLIENT_ID);
  authorizeUrl.searchParams.set("redirect_uri", WHOOP_REDIRECT_URI);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", WHOOP_SCOPES);
  authorizeUrl.searchParams.set("state", state);

  const wantsJson = (req.headers.get("accept") || "").includes("application/json");
  return wantsJson ? json({ url: authorizeUrl.toString() }) : redirect(authorizeUrl.toString());
}

// ─── Route: GET /api/whoop/callback ──────────────────────────────────────────
async function handleCallback(req) {
  const WHOOP_CLIENT_ID = process.env.WHOOP_CLIENT_ID;
  const WHOOP_CLIENT_SECRET = process.env.WHOOP_CLIENT_SECRET;
  const WHOOP_REDIRECT_URI = process.env.WHOOP_REDIRECT_URI;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!WHOOP_CLIENT_ID || !WHOOP_CLIENT_SECRET || !WHOOP_REDIRECT_URI || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "Server not configured" }, 500);
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) return redirect(`/?whoop_error=${encodeURIComponent(error)}#/settings`);
  if (!code || !state) return json({ error: "Missing code or state" }, 400);
  if (state.length !== STATE_LEN) return json({ error: "Invalid state" }, 400);

  // Ownership is derived ONLY from the server-side state table, never the query.
  const userId = await consumeState(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, state);
  if (!userId) return json({ error: "Invalid or expired state" }, 400);

  let tokenData;
  try {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: WHOOP_CLIENT_ID,
      client_secret: WHOOP_CLIENT_SECRET,
      redirect_uri: WHOOP_REDIRECT_URI,
    });
    const r = await fetch(WHOOP_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body,
    });
    if (!r.ok) {
      console.error("Whoop token exchange failed:", r.status);
      return redirect(`/?whoop_error=token_exchange_failed_${r.status}#/settings`);
    }
    tokenData = await r.json();
  } catch (e) {
    console.error("Whoop token exchange error:", e?.message || "network error");
    return redirect(`/?whoop_error=network_error#/settings`);
  }

  const accessToken = tokenData.access_token;
  const refreshToken = tokenData.refresh_token;
  const expiresIn = tokenData.expires_in || 3600;
  const scope = tokenData.scope || WHOOP_SCOPES;
  if (!accessToken || !refreshToken) {
    return redirect(`/?whoop_error=invalid_token_response#/settings`);
  }

  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  // V14 · Encrypted-only persistence — same stance as Oura: connected_accounts
  // is the sole token store, a successful persist deletes any surviving
  // whoop_tokens row, and a missing TOKEN_ENCRYPTION_KEY fails closed with an
  // actionable error instead of ever writing plaintext.
  const persisted = await persistProviderTokens(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    userId,
    provider: PROVIDERS.WHOOP,
    accessToken,
    refreshToken,
    expiresAt,
    scopes: String(scope || WHOOP_SCOPES).split(/\s+/).filter(Boolean),
  });
  if (!persisted.ok) {
    console.error("Failed to store Whoop tokens:", persisted.reason);
    return redirect(persisted.reason === "encryption_not_configured"
      ? `/?whoop_error=token_storage_unconfigured#/settings`
      : `/?whoop_error=storage_failed#/settings`);
  }

  // Best-effort immediate 14-day sync so the UI is not empty right after OAuth.
  let immediateSyncOk = false;
  try {
    await syncUserData(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, userId, accessToken);
    immediateSyncOk = true;
  } catch (e) {
    console.warn("Immediate Whoop sync failed:", e?.message || "error");
  }

  await logSyncEvent(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    userId,
    source: "whoop",
    eventType: "connect",
    status: immediateSyncOk ? "success" : "partial",
    message: immediateSyncOk ? "Whoop connected and initial sync completed." : "Whoop connected, but initial sync failed — try syncing manually.",
  });

  return redirect(`/?whoop=connected#/settings`);
}

// ─── Route: GET /api/whoop/status ────────────────────────────────────────────
async function handleStatus(req) {
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "Server not configured" }, 500);
  }

  let userId;
  try { userId = await resolveUserIdFromBearer(req); }
  catch { userId = null; }
  if (!userId) return json({ error: "Not authenticated" }, 401);

  // V14 · Presence-only summary: encrypted connected_accounts first, legacy
  // fallback, no decryption required.
  let tokenData;
  try {
    const summary = await getProviderConnectionSummary(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, userId, PROVIDERS.WHOOP);
    tokenData = summary.connected
      ? { expires_at: summary.expiresAt, refresh_token: summary.hasRefreshToken, token_encryption_configured: summary.tokenEncryptionConfigured }
      : null;
  } catch {
    return json({ error: "Token status unavailable" }, 502);
  }

  let lastSynced = null;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/whoop_data?user_id=eq.${encodeURIComponent(userId)}&select=synced_at&order=synced_at.desc&limit=1`,
      { headers: serviceHeaders(SUPABASE_SERVICE_ROLE_KEY) }
    );
    if (r.ok) {
      const rows = await r.json();
      lastSynced = rows?.[0]?.synced_at || null;
    } else {
      console.warn("Whoop status sync lookup failed:", r.status);
    }
  } catch {
    lastSynced = null;
  }

  let syncStatus = "never";
  if (lastSynced) {
    const hoursSinceSync = (Date.now() - new Date(lastSynced).getTime()) / 3600000;
    syncStatus = hoursSinceSync < 24 ? "recent" : hoursSinceSync < 72 ? "stale" : "failed";
  }

  // Self-heal an expired / near-expired access token so a normal, expected token
  // lifetime never surfaces as a "reconnect" prompt. A refresh only rotates the
  // stored tokens (handled inside refreshAccessToken) — we never return tokens.
  let expiresAt = tokenData?.expires_at || null;
  let isExpired = expiresAt ? new Date(expiresAt) <= new Date() : false;
  if (tokenData) {
    const remainingMs = expiresAt ? new Date(expiresAt).getTime() - Date.now() : -Infinity;
    const needsRefresh = remainingMs <= TOKEN_NEAR_EXPIRY_MS;
    if (needsRefresh && tokenData.refresh_token) {
      // V14 · refreshAccessToken resolves its own refresh token from the
      // encrypted store — no plaintext flows through the status handler.
      const refreshed = await refreshAccessToken(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, userId);
      if (refreshed) {
        // Refresh succeeded and rotated tokens were persisted — report healthy.
        expiresAt = refreshed.expiresAt || expiresAt;
        isExpired = false;
      } else {
        // Refresh genuinely failed — the user must reconnect. Do not claim
        // disconnected: the token row still exists.
        isExpired = true;
        syncStatus = "refresh_failed";
      }
    } else if (needsRefresh && !tokenData.refresh_token) {
      // No refresh token on file — only a reconnect can recover this.
      isExpired = true;
      syncStatus = "refresh_failed";
    }
  }

  return json({
    connected: !!tokenData,
    expiresAt,
    isExpired,
    lastSynced,
    syncStatus,
  });
}

// ─── Route: POST /api/whoop/disconnect ───────────────────────────────────────
async function handleDisconnect(req) {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "Server not configured" }, 500);
  }

  let userId;
  try { userId = await resolveUserIdFromBearer(req); }
  catch { userId = null; }
  if (!userId) return json({ error: "Not authenticated" }, 401);

  try {
    for (const table of ["whoop_data", "whoop_tokens", "whoop_oauth_state"]) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?user_id=eq.${encodeURIComponent(userId)}`, {
        method: "DELETE",
        headers: serviceHeaders(SUPABASE_SERVICE_ROLE_KEY, { "Prefer": "return=minimal" }),
      });
      // V14 · 404 = the table no longer exists (migration_v31 dropped the
      // plaintext token tables). Nothing to delete is a success, not a failure.
      if (!r.ok && r.status !== 404) {
        console.error(`Whoop disconnect failed for ${table}:`, r.status);
        await logSyncEvent(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
          userId, source: "whoop", eventType: "disconnect", status: "failed",
          message: `Disconnect failed at ${table} (status ${r.status}).`,
        });
        return json({ error: "Disconnect failed" }, 502);
      }
    }
    // Best-effort cleanup for the provider-standard mirror. Do not fail legacy
    // disconnect if the migration has not been applied yet.
    await fetch(`${SUPABASE_URL}/rest/v1/connected_accounts?user_id=eq.${encodeURIComponent(userId)}&provider=eq.whoop`, {
      method: "DELETE",
      headers: serviceHeaders(SUPABASE_SERVICE_ROLE_KEY, { "Prefer": "return=minimal" }),
    }).catch(() => null);
  } catch {
    await logSyncEvent(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      userId, source: "whoop", eventType: "disconnect", status: "failed",
      message: "Disconnect failed — network error.",
    });
    return json({ error: "Disconnect failed" }, 502);
  }

  await logSyncEvent(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    userId, source: "whoop", eventType: "disconnect", status: "success",
    message: "Whoop disconnected. Tokens and data removed.",
  });

  return json({ ok: true });
}

// ─── Route: POST /api/whoop/sync ─────────────────────────────────────────────
async function handleSync(req) {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "Server not configured" }, 500);
  }

  // Ownership from the verified Bearer token only — never the request body.
  let userId;
  try { userId = await resolveUserIdFromBearer(req); }
  catch { userId = null; }
  if (!userId) return json({ error: "Not authenticated" }, 401);

  // Optional backfill window from the query string (?days=30). Clamp to a safe
  // range; the body is never trusted for anything, including the window.
  let syncDays = SYNC_DAYS;
  try {
    const requested = parseInt(new URL(req.url).searchParams.get("days") || "", 10);
    if (Number.isFinite(requested)) {
      syncDays = Math.min(MAX_SYNC_DAYS, Math.max(1, requested));
    }
  } catch { syncDays = SYNC_DAYS; }

  // V14 · Load tokens via the encrypted store (one-shot legacy migration).
  const resolved = await resolveProviderTokens(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { userId, provider: PROVIDERS.WHOOP });
  if (!resolved.ok) {
    if (resolved.reason === "encryption_not_configured") {
      return json({ error: "Server token storage not configured (TOKEN_ENCRYPTION_KEY)." }, 503);
    }
    return json({ error: "Whoop not connected" }, 404);
  }
  if (!resolved.refreshToken) {
    return json({ error: "Whoop not connected" }, 404);
  }

  // Refresh once if the access token is expired; persist the rotated token
  // immediately (Whoop rotates refresh tokens — avoid concurrent refreshes).
  let accessToken = resolved.accessToken;
  if (!accessToken || new Date(resolved.expiresAt || 0) <= new Date()) {
    const refreshed = await refreshAccessToken(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, userId);
    if (!refreshed) return json({ error: "Token refresh failed" }, 502);
    accessToken = refreshed.accessToken;
  }

  let summary;
  try {
    summary = await syncUserData(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, userId, accessToken, syncDays);
  } catch (e) {
    console.error("Whoop sync error:", e?.message || "error");
    await logSyncEvent(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      userId, source: "whoop", eventType: "sync", status: "failed",
      message: e?.message || "Sync failed.", days: syncDays,
    });
    return json({ error: "Sync failed" }, 502);
  }

  // Determine sync status for the event log: success, partial (some failures
  // or cycle-only), or failed. This drives the debug timeline in Settings.
  const { status: syncStatus, message: syncMessage, counts: c } = classifyWhoopSync(summary, syncDays);

  await logSyncEvent(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    userId, source: "whoop", eventType: "sync", status: syncStatus,
    counts: c, message: syncMessage, days: syncDays,
  });

  return json({
    ok: summary.failures.length === 0,
    connected: true,
    synced: summary.synced,
    stored: summary.stored,
    counts: summary.counts,
    failures: summary.failures,
    lastSynced: summary.lastSynced,
    days: syncDays,
  });
}

// ─── Route: GET /api/whoop/counts ────────────────────────────────────────────
// Per-type record counts for the Settings surface. Ownership is derived from the
// verified Bearer token. Returns only aggregate counts + timestamps — never raw
// biometric payloads.
async function handleCounts(req) {
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "Server not configured" }, 500);
  }

  let userId;
  try { userId = await resolveUserIdFromBearer(req); }
  catch { userId = null; }
  if (!userId) return json({ error: "Not authenticated" }, 401);

  const counts = { cycle: 0, sleep: 0, recovery: 0, workout: 0 };
  let lastSynced = null;
  let latestDate = null;
  try {
    // Select only non-sensitive columns (never payload) and aggregate in-process.
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/whoop_data?user_id=eq.${encodeURIComponent(userId)}&select=date,data_type,synced_at`,
      { headers: serviceHeaders(SUPABASE_SERVICE_ROLE_KEY) }
    );
    if (!r.ok) {
      console.error("Whoop counts lookup failed:", r.status);
      return json({ error: "Counts unavailable" }, 502);
    }
    const rows = await r.json();
    for (const row of rows || []) {
      if (Object.prototype.hasOwnProperty.call(counts, row.data_type)) counts[row.data_type] += 1;
      if (row.date && (!latestDate || row.date > latestDate)) latestDate = row.date;
      if (row.synced_at && (!lastSynced || row.synced_at > lastSynced)) lastSynced = row.synced_at;
    }
  } catch {
    return json({ error: "Counts unavailable" }, 502);
  }

  return json({ ...counts, lastSynced, latestDate });
}

// ─── Sync event logging (V3.4) ───────────────────────────────────────────────
// Writes a privacy-safe metadata-only row to wearable_sync_events after each
// sync / connect / disconnect / token_refresh. Never logs raw payloads, tokens,
// or biometric values — only aggregate counts + a short message.
export async function logSyncEvent(supabaseUrl, serviceKey, { userId, source, eventType, status, counts = {}, message = "", days = null } = {}) {
  if (!supabaseUrl || !serviceKey || !userId || !source || !eventType || !status) return;
  try {
    await fetch(`${supabaseUrl}/rest/v1/wearable_sync_events`, {
      method: "POST",
      headers: serviceHeaders(serviceKey, {
        "content-type": "application/json",
        "Prefer": "return=minimal",
      }),
      body: JSON.stringify({
        user_id: userId,
        source,
        event_type: eventType,
        status,
        counts,
        message: String(message).slice(0, 300),
        days: Number.isFinite(days) ? days : null,
      }),
    });
  } catch {
    // Best-effort — never let event logging break a sync.
  }
}

// ─── Token refresh ───────────────────────────────────────────────────────────
export async function refreshAccessToken(supabaseUrl, serviceKey, userId) {
  const WHOOP_CLIENT_ID = process.env.WHOOP_CLIENT_ID;
  const WHOOP_CLIENT_SECRET = process.env.WHOOP_CLIENT_SECRET;
  if (!WHOOP_CLIENT_ID || !WHOOP_CLIENT_SECRET) {
    console.error("Whoop refresh: credentials not configured");
    return null;
  }
  // V14 · Resolve the refresh token from the encrypted store (one-shot legacy
  // migration). Resolution fails BEFORE the provider call when the encryption
  // key is missing — Whoop rotates refresh tokens on every refresh, so a
  // rotation we can't store would sever the connection permanently.
  const resolved = await resolveProviderTokens(supabaseUrl, serviceKey, { userId, provider: PROVIDERS.WHOOP });
  if (!resolved.ok || !resolved.refreshToken) {
    await logSyncEvent(supabaseUrl, serviceKey, {
      userId, source: "whoop", eventType: "token_refresh", status: "failed",
      message: resolved.reason === "encryption_not_configured"
        ? "Token refresh blocked: TOKEN_ENCRYPTION_KEY is not configured."
        : "Token refresh failed: no refresh token on file.",
    });
    return null;
  }
  const refreshToken = resolved.refreshToken;
  try {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: WHOOP_CLIENT_ID,
      client_secret: WHOOP_CLIENT_SECRET,
      scope: WHOOP_SCOPES,
    });
    const r = await fetch(WHOOP_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body,
    });
    if (!r.ok) {
      console.error("Whoop token refresh failed:", r.status);
      return null;
    }
    const data = await r.json();
    const newAccess = data.access_token;
    // Whoop rotates the refresh token on refresh; persist the new one if given.
    const newRefresh = data.refresh_token || refreshToken;
    const expiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString();
    if (!newAccess) return null;

    // Persist immediately before using it so a rotated refresh token is never lost.
    // V14 · Encrypted-only. A failed store after a Whoop rotation means the
    // stored refresh token is now stale — report failure so the UI surfaces a
    // reconnect rather than pretending health.
    const persisted = await persistProviderTokens(supabaseUrl, serviceKey, {
      userId,
      provider: PROVIDERS.WHOOP,
      accessToken: newAccess,
      refreshToken: newRefresh,
      expiresAt,
      scopes: String(data.scope || WHOOP_SCOPES).split(/\s+/).filter(Boolean),
    });
    if (!persisted.ok) {
      await logSyncEvent(supabaseUrl, serviceKey, {
        userId, source: "whoop", eventType: "token_refresh", status: "failed",
        message: `Refreshed but storage failed (${persisted.reason}).`,
      });
      return null;
    }
    await logSyncEvent(supabaseUrl, serviceKey, {
      userId, source: "whoop", eventType: "token_refresh", status: "success",
      message: "Access token refreshed.",
    });
    // Return the rotated access token plus its new expiry so callers (e.g.
    // /status) can report health without re-reading the token row. The refresh
    // token itself is never returned — it lives only encrypted in connected_accounts.
    return { accessToken: newAccess, expiresAt };
  } catch (e) {
    console.error("Whoop token refresh error:", e?.message || "error");
    await logSyncEvent(supabaseUrl, serviceKey, {
      userId, source: "whoop", eventType: "token_refresh", status: "failed",
      message: e?.message || "Token refresh failed.",
    });
    return null;
  }
}

// ─── Sync core ───────────────────────────────────────────────────────────────
// Whoop v2 collection endpoints. Sleep + workout live under /activity.
const WHOOP_ENDPOINTS = [
  { dataType: "recovery", path: "/recovery" },
  { dataType: "sleep", path: "/activity/sleep" },
  { dataType: "cycle", path: "/cycle" },
  { dataType: "workout", path: "/activity/workout" },
];

// Fetch a Whoop collection with conservative pagination. Handles the documented
// `{ records: [...], next_token }` shape plus common `nextToken`/`next` variants
// without ever looping more than MAX_PAGES times.
async function fetchCollection(path, accessToken, startISO, endISO) {
  const records = [];
  let nextToken = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({ start: startISO, end: endISO, limit: "25" });
    if (nextToken) params.set("nextToken", nextToken);
    const r = await fetch(`${WHOOP_API_BASE}${path}?${params}`, {
      headers: { "Authorization": `Bearer ${accessToken}` },
    });
    if (!r.ok) {
      console.warn(`Whoop fetch ${path} failed:`, r.status);
      break;
    }
    const payload = await r.json();
    const pageRecords = Array.isArray(payload?.records)
      ? payload.records
      : Array.isArray(payload)
      ? payload
      : [];
    for (const rec of pageRecords) records.push(rec);
    nextToken = payload?.next_token || payload?.nextToken || payload?.next || null;
    if (!nextToken || pageRecords.length === 0) break;
  }
  return records;
}

// Convert an ISO/date-ish string to a YYYY-MM-DD date key, or null.
function toDateKey(value) {
  if (!value) return null;
  const s = String(value);
  // Fast path for ISO timestamps / plain dates.
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

// V16.7 · Local calendar date for a UTC timestamp using the record's own
// timezone_offset ("-05:00" style). The old UTC-prefix keying mis-dated every
// record whose timestamp crosses UTC midnight before local midnight — for a
// UTC−5 athlete that is anything after 7 p.m.: on the reporting user's export,
// 9 of 20 workouts (every evening lifting session) were keyed to the NEXT day,
// shifting day-strain and load attribution by one and compounding with the
// strain-summing bug (the "17.9 strain-sum vs 4.1 actual day-strain" day was
// two evening workouts leaking in from the previous local day). Falls back to
// the raw UTC date when the offset is absent or malformed.
export function toLocalDateKey(value, timezoneOffset) {
  if (!value) return null;
  const parsed = Date.parse(String(value));
  if (Number.isNaN(parsed)) return toDateKey(value);
  const m = typeof timezoneOffset === "string" ? timezoneOffset.match(/^([+-])(\d{2}):(\d{2})$/) : null;
  if (!m) return toDateKey(value);
  const sign = m[1] === "-" ? -1 : 1;
  const offsetMs = sign * (Number(m[2]) * 60 + Number(m[3])) * 60 * 1000;
  const local = new Date(parsed + offsetMs);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, "0")}-${String(local.getUTCDate()).padStart(2, "0")}`;
}

// Determine the calendar date for a Whoop record from the best available field.
// `score_state` is a status string, not a date, so it is intentionally ignored.
// Order prefers the record's own window, then creation/update, then nested
// cycle/sleep windows. Every candidate is shifted into the record's own
// timezone when it declares one (V16.7).
export function pickRecordDate(rec) {
  // V15.6 (audit F5) · Main-sleep records (nap === false) key on their END —
  // the wake date — matching Oura's day convention. A 22:30 start was keying
  // the night to the PREVIOUS calendar day, skewing every cross-source join
  // by one. Naps keep start-date; cycles are dated by local start.
  if (rec && rec.nap === false && rec.end) {
    const key = toLocalDateKey(rec.end, rec.timezone_offset);
    if (key) return key;
  }
  if (!rec || typeof rec !== "object") return null;
  const candidates = [
    rec.start,
    rec.end,
    rec.created_at,
    rec.updated_at,
    rec.cycle?.start,
    rec.sleep?.start,
    rec.during?.start,
    rec.date,
  ];
  for (const c of candidates) {
    const key = toLocalDateKey(c, rec.timezone_offset);
    if (key) return key;
  }
  return null;
}

// V16.7 · Cycles get their own rule. A Whoop cycle runs sleep-onset →
// sleep-onset and is displayed under the day you WAKE inside it, but its
// `start` is the previous evening (the export's cycles start ~23:00 local).
// Wake-day from the bedtime: local(start) + 1 day when the cycle began in the
// evening (local hour ≥ 15:00), local(start) itself when it began after
// midnight. Keying on local(end) instead is tempting but breaks whenever the
// NEXT bedtime crosses local midnight (a 00:30 next-sleep start files the
// whole waking day one late — two cycles in the export do exactly this). The
// old UTC-prefix keying happened to equal this rule at UTC−5 but inverts for
// eastern offsets (a 23:00 JST bedtime keys to the bed day, not the wake day).
export function pickCycleDate(rec) {
  if (!rec || typeof rec !== "object") return null;
  if (rec.start) {
    const parsed = Date.parse(String(rec.start));
    const m = typeof rec.timezone_offset === "string" ? rec.timezone_offset.match(/^([+-])(\d{2}):(\d{2})$/) : null;
    if (!Number.isNaN(parsed) && m) {
      const sign = m[1] === "-" ? -1 : 1;
      const offsetMs = sign * (Number(m[2]) * 60 + Number(m[3])) * 60 * 1000;
      const local = new Date(parsed + offsetMs);
      const bumped = local.getUTCHours() >= 15 ? new Date(local.getTime() + 24 * 60 * 60 * 1000) : local;
      return `${bumped.getUTCFullYear()}-${String(bumped.getUTCMonth() + 1).padStart(2, "0")}-${String(bumped.getUTCDate()).padStart(2, "0")}`;
    }
  }
  return pickRecordDate(rec);
}

// external_id is the record id when present, else '' (single-per-day types).
function pickExternalId(rec) {
  const id = rec?.id ?? rec?.cycle_id ?? rec?.sleep_id ?? rec?.activity_id;
  return id === undefined || id === null ? "" : String(id);
}

// Dedupe by the Supabase conflict key so a single POST never violates the unique
// index. Later records win (they carry the freshest payload).
function dedupeRows(rows) {
  const byKey = new Map();
  for (const row of rows) {
    byKey.set(`${row.user_id}|${row.date}|${row.data_type}|${row.external_id}`, row);
  }
  return [...byKey.values()];
}

// Upsert rows batched by data_type so one malformed type cannot sink the rest.
async function storeWhoopBatches(supabaseUrl, serviceKey, rows) {
  const byType = new Map();
  for (const row of dedupeRows(rows)) {
    if (!byType.has(row.data_type)) byType.set(row.data_type, []);
    byType.get(row.data_type).push(row);
  }
  let stored = 0;
  const failures = [];
  for (const [dataType, batch] of byType) {
    try {
      const r = await fetch(
        `${supabaseUrl}/rest/v1/whoop_data?on_conflict=user_id,date,data_type,external_id`,
        {
          method: "POST",
          headers: serviceHeaders(serviceKey, {
            "content-type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
          }),
          body: JSON.stringify(batch),
        }
      );
      if (!r.ok) {
        const detail = await readErrorBody(r);
        console.error(`Whoop storage failed data_type=${dataType} status=${r.status} rows=${batch.length} body=${detail}`);
        failures.push({ dataType, status: r.status });
        continue;
      }
      stored += batch.length;
    } catch (e) {
      console.error(`Whoop storage error data_type=${dataType} rows=${batch.length}: ${e?.message || e}`);
      failures.push({ dataType, error: true });
    }
  }
  return { stored, failures };
}

// Fetch last SYNC_DAYS from each endpoint (best-effort), build rows, and upsert.
// Returns a safe summary — never raw payloads.
export async function syncUserData(supabaseUrl, serviceKey, userId, accessToken, days = SYNC_DAYS) {
  const windowDays = Math.min(MAX_SYNC_DAYS, Math.max(1, Number.isFinite(days) ? days : SYNC_DAYS));
  const end = new Date();
  const start = new Date(end.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const startISO = start.toISOString();
  const endISO = end.toISOString();
  const syncedAt = new Date().toISOString();

  const rows = [];
  const counts = {};
  const fetchFailures = [];

  // V16.7 · Two-pass build. Recovery records carry NO window and NO
  // timezone_offset of their own — only created_at (UTC) and a cycle_id. The
  // old single pass dated them off created_at's UTC prefix, which keys any
  // recovery scored after 7 p.m. local (UTC−5) to the NEXT day. A recovery is
  // definitionally about its cycle, so pass one fetches everything and builds
  // a cycle_id → local-date map; pass two dates each recovery via its cycle
  // and falls back to created_at only when the cycle is outside the window.
  const recordsByType = new Map();
  for (const { dataType, path } of WHOOP_ENDPOINTS) {
    try {
      recordsByType.set(dataType, await fetchCollection(path, accessToken, startISO, endISO));
    } catch (e) {
      console.warn(`Whoop sync fetch error ${dataType}:`, e?.message || "error");
      fetchFailures.push({ dataType, error: true });
    }
  }

  const cycleDates = new Map();
  for (const rec of recordsByType.get("cycle") || []) {
    const id = rec?.id;
    const date = pickCycleDate(rec);
    if (id != null && date) cycleDates.set(String(id), date);
  }

  for (const { dataType } of WHOOP_ENDPOINTS) {
    if (!recordsByType.has(dataType)) continue;
    let kept = 0;
    for (const rec of recordsByType.get(dataType)) {
      const date = dataType === "cycle"
        ? pickCycleDate(rec)
        : (dataType === "recovery" && rec?.cycle_id != null && cycleDates.get(String(rec.cycle_id)))
          || pickRecordDate(rec);
      if (!date) continue; // skip rows we cannot date confidently
      rows.push({
        user_id: userId,
        date,
        data_type: dataType,
        external_id: pickExternalId(rec),
        payload: rec,
        synced_at: syncedAt,
      });
      kept += 1;
    }
    counts[dataType] = kept;
  }

  let stored = 0;
  let storeFailures = [];
  if (rows.length > 0) {
    const result = await storeWhoopBatches(supabaseUrl, serviceKey, rows);
    stored = result.stored;
    storeFailures = result.failures;
  }

  return {
    synced: rows.length,
    stored,
    counts,
    failures: [...fetchFailures, ...storeFailures],
    lastSynced: syncedAt,
  };
}

// Classify a syncUserData() summary into a wearable_sync_events status + message.
// Shared by the manual sync route (/api/whoop/sync) and the scheduled hourly
// prefetch so the two never drift and neither ever fakes a success:
//   • failed  — endpoint failures AND nothing stored.
//   • partial — some endpoint failures, OR only cycle data was available.
//   • success — records stored with no failures.
// Exported (pure) for reuse and direct unit testing.
export function classifyWhoopSync(summary = {}, syncDays = SYNC_DAYS) {
  const counts = summary.counts || {};
  const failCount = Array.isArray(summary.failures) ? summary.failures.length : 0;
  const stored = Number.isFinite(summary.stored) ? summary.stored : 0;
  const synced = Number.isFinite(summary.synced) ? summary.synced : 0;
  const cycleOnly = (counts.cycle || 0) > 0 && !(counts.sleep || counts.recovery || counts.workout);

  let status = "success";
  let message = `Synced ${synced} record(s) over ${syncDays} days.`;
  if (failCount > 0 && stored === 0) {
    status = "failed";
    message = "Sync failed — no records stored.";
  } else if (failCount > 0 || cycleOnly) {
    status = "partial";
    message = cycleOnly
      ? "Sync succeeded, but only cycle data was available."
      : `Synced ${stored} record(s) with ${failCount} endpoint failure(s).`;
  }
  return { status, message, counts };
}

// ─── Route: GET /api/whoop/events ────────────────────────────────────────────
// Returns the most recent wearable_sync_events rows for the caller (Whoop only
// for this endpoint; Oura events would use /api/oura/events). Owner-derived via
// Bearer token. Returns only metadata — no raw payloads, no tokens.
async function handleEvents(req) {
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "Server not configured" }, 500);
  }

  let userId;
  try { userId = await resolveUserIdFromBearer(req); }
  catch { userId = null; }
  if (!userId) return json({ error: "Not authenticated" }, 401);

  // Optional ?limit query (default 20, capped at 50).
  let limit = 20;
  try {
    const requested = parseInt(new URL(req.url).searchParams.get("limit") || "", 10);
    if (Number.isFinite(requested)) limit = Math.min(50, Math.max(1, requested));
  } catch { limit = 20; }

  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/wearable_sync_events?user_id=eq.${encodeURIComponent(userId)}&source=eq.whoop&order=created_at.desc&limit=${limit}&select=id,source,event_type,status,counts,message,days,created_at`,
      { headers: serviceHeaders(SUPABASE_SERVICE_ROLE_KEY) }
    );
    if (!r.ok) {
      console.error("Whoop events lookup failed:", r.status);
      return json({ error: "Events unavailable" }, 502);
    }
    const rows = await r.json();
    return json({ events: Array.isArray(rows) ? rows : [] });
  } catch {
    return json({ error: "Events unavailable" }, 502);
  }
}

// ─── Netlify entrypoint ──────────────────────────────────────────────────────
export const config = { path: "/api/whoop/*" };

export default async (req) => {
  const url = new URL(req.url);
  if (url.pathname.endsWith("/api/whoop/auth")) {
    return await handleAuth(req);
  } else if (url.pathname.endsWith("/api/whoop/callback")) {
    return await handleCallback(req);
  } else if (url.pathname.endsWith("/api/whoop/status")) {
    return await handleStatus(req);
  } else if (url.pathname.endsWith("/api/whoop/sync")) {
    return await handleSync(req);
  } else if (url.pathname.endsWith("/api/whoop/counts")) {
    return await handleCounts(req);
  } else if (url.pathname.endsWith("/api/whoop/events")) {
    return await handleEvents(req);
  } else if (url.pathname.endsWith("/api/whoop/disconnect")) {
    return await handleDisconnect(req);
  } else {
    return json({ error: "Not found" }, 404);
  }
};
