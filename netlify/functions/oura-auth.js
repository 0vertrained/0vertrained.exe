// netlify/functions/oura-auth.js
import { PROVIDERS, storeProviderOAuthState, consumeProviderOAuthState, randomState, resolveProviderTokens, persistProviderTokens, getProviderConnectionSummary } from "./_provider-standard.js";

// ─────────────────────────────────────────────────────────────────────────────
// Oura OAuth flow handler (PHASE 2)
//
// Endpoints:
// • GET /api/oura/auth — initiates OAuth flow, redirects to Oura authorize URL
// • GET /api/oura/callback — handles OAuth callback, exchanges code for tokens
// • GET /api/oura/status — returns safe token/sync status without exposing tokens
// • POST /api/oura/disconnect — deletes the caller's Oura tokens and cached data
//
// Security:
// • User ownership is derived from a verified Supabase Bearer token, never query params.
// • OAuth state is a single-use, expiring row in provider_oauth_state
//   (consumed and deleted on callback), not a self-verifying signed token.
// • Client secret only in Netlify env vars (never browser).
// • Tokens stored in Supabase via service_role key (server-to-server).
// ─────────────────────────────────────────────────────────────────────────────

const OURA_AUTH_URL = "https://cloud.ouraring.com/oauth/authorize";
const OURA_TOKEN_URL = "https://api.ouraring.com/oauth/token";
const OURA_API_BASE = "https://api.ouraring.com/v2/usercollection";


const STATE_TTL_MS = 10 * 60 * 1000;
// Treat an access token with <= 5 minutes of life left as due for refresh so
// /status can self-heal before the token actually expires (no reconnect prompt).
const TOKEN_NEAR_EXPIRY_MS = 5 * 60 * 1000;

// ─── Sync diagnostics helpers ────────────────────────────────────────────────
// These make failed Supabase/PostgREST writes debuggable without leaking
// secrets. If you are chasing an "Oura data sync storage failed" log line, this
// is where the sanitized status + response body come from. Duplicated verbatim
// in netlify/functions/oura-sync.js (no shared serverless utils dir exists yet).

// Mask values of known-sensitive keys in any text we are about to log. PostgREST
// error bodies may include a `details` field with a failing row, which can contain
// the Oura JSON payload. Keep code/message/hint, but redact tokens and row/payload
// detail so logs are useful without dumping biometric data.
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
// sensitive/biometric payload details, and truncates so logs stay small.
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

function mergePayloadData(existingPayload, nextPayload) {
  const existingData = Array.isArray(existingPayload?.data) ? existingPayload.data : [];
  const nextData = Array.isArray(nextPayload?.data) ? nextPayload.data : [];
  if (existingData.length || nextData.length) {
    const merged = [];
    const seen = new Set();
    for (const doc of [...existingData, ...nextData]) {
      const key = doc && typeof doc === "object" ? (doc.id || JSON.stringify(doc)) : String(doc);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(doc);
    }
    return { ...(existingPayload || {}), ...(nextPayload || {}), data: merged };
  }
  return nextPayload || existingPayload || {};
}

function dedupeOuraRowsForUpsert(rows, logLabel) {
  const byConflictKey = new Map();
  let duplicateCount = 0;
  for (const row of rows || []) {
    const key = `${row.user_id}|${row.date}|${row.data_type}`;
    const existing = byConflictKey.get(key);
    if (!existing) {
      byConflictKey.set(key, row);
      continue;
    }
    duplicateCount += 1;
    byConflictKey.set(key, {
      ...existing,
      ...row,
      payload: mergePayloadData(existing.payload, row.payload),
      synced_at: row.synced_at || existing.synced_at,
    });
  }
  const deduped = [...byConflictKey.values()];
  if (duplicateCount > 0) {
    console.warn(`${logLabel} deduped ${duplicateCount} duplicate row(s) before Supabase upsert`);
  }
  return deduped;
}

// Store Oura rows batched by data_type so one malformed payload type cannot
// silently sink every other type in a single all-or-nothing POST. Each batch
// logs sanitized status + row count + response body on failure and we continue
// best-effort with the remaining types. Rows are first deduped by the Supabase
// conflict target (user_id,date,data_type), merging same-day sleep docs.
async function storeOuraDataBatches(supabaseUrl, serviceKey, upserts, logLabel) {
  const byType = new Map();
  for (const row of dedupeOuraRowsForUpsert(upserts, logLabel)) {
    if (!byType.has(row.data_type)) byType.set(row.data_type, []);
    byType.get(row.data_type).push(row);
  }
  let stored = 0;
  const failures = [];
  for (const [dataType, rows] of byType) {
    try {
      const r = await fetch(`${supabaseUrl}/rest/v1/oura_data?on_conflict=user_id,date,data_type`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "authorization": `Bearer ${serviceKey}`,
          "apikey": serviceKey,
          "Prefer": "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(rows),
      });
      if (!r.ok) {
        const detail = await readErrorBody(r);
        console.error(`${logLabel} storage failed data_type=${dataType} status=${r.status} rows=${rows.length} body=${detail}`);
        failures.push({ dataType, status: r.status });
        continue;
      }
      stored += rows.length;
    } catch (e) {
      console.error(`${logLabel} storage error data_type=${dataType} rows=${rows.length}: ${e?.message || e}`);
      failures.push({ dataType, error: true });
    }
  }
  return { stored, failures };
}

// ─── Sync event logging (V3.4 parity) ────────────────────────────────────────
// Writes a privacy-safe metadata-only row to wearable_sync_events after each
// Oura sync / connect / disconnect / token_refresh. Mirrors whoop-auth.js.
// Never logs raw payloads, tokens, or biometric values — only aggregate counts
// + a short message.
async function logSyncEvent(supabaseUrl, serviceKey, { userId, source, eventType, status, counts = {}, message = "", days = null } = {}) {
  if (!supabaseUrl || !serviceKey || !userId || !source || !eventType || !status) return;
  try {
    await fetch(`${supabaseUrl}/rest/v1/wearable_sync_events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${serviceKey}`,
        "apikey": serviceKey,
        "Prefer": "return=minimal",
      },
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

// V13.6 · The HMAC state-signing helpers (base64url/hmacSha256/signState/
// verifyState) were removed here. Oura now uses the DB-backed single-use
// provider_oauth_state pattern (storeProviderOAuthState/consumeProviderOAuthState)
// like every other provider, which is one-time-use and needs no shared secret.

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

function resolveOuraRedirectUri(req) {
  const derived = new URL("/api/oura/callback", req.url).toString();
  const configured = (process.env.OURA_REDIRECT_URI || "").trim();
  if (!configured) return derived;

  // A stale Netlify env var is the most common cause of Oura's opaque
  // `400 invalid_request` during the authorize step: Oura requires the
  // redirect_uri to exactly match both the current app origin and the URI
  // whitelisted in the Oura developer app. Prefer the live request origin when
  // the configured host does not match this deployment, so production/custom
  // domains don't accidentally send users to an old preview URL.
  try {
    const configuredUrl = new URL(configured);
    const derivedUrl = new URL(derived);
    if (configuredUrl.origin !== derivedUrl.origin) return derived;
    if (configuredUrl.pathname !== derivedUrl.pathname) return derived;
    return configured;
  } catch {
    return derived;
  }
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

async function handleAuth(req) {
  const OURA_CLIENT_ID = process.env.OURA_CLIENT_ID;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const redirectUri = resolveOuraRedirectUri(req);
  if (!OURA_CLIENT_ID || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "Oura not configured" }, 500);
  }

  let userId;
  try { userId = await resolveUserIdFromBearer(req); }
  catch { userId = null; }
  if (!userId) return json({ error: "Not authenticated" }, 401);

  // V13.6 · DB-backed, single-use OAuth state (provider_oauth_state), matching
  // Whoop/Strava/Google. Replaces the HMAC-signed self-verifying token, which
  // used a non-constant-time signature compare and — because it carried its own
  // expiry rather than being consumed — was replayable within its TTL. The row
  // is deleted the moment it's consumed in the callback, so a state can be used
  // at most once.
  const state = randomState(32);
  const stored = await storeProviderOAuthState(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    provider: PROVIDERS.OURA,
    state,
    userId,
    ttlMs: STATE_TTL_MS,
  });
  if (!stored) return json({ error: "Could not start Oura connection. Try again." }, 502);

  const authorizeUrl = new URL(OURA_AUTH_URL);
  authorizeUrl.searchParams.set("client_id", OURA_CLIENT_ID);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("scope", "personal daily heartrate spo2");

  const wantsJson = (req.headers.get("accept") || "").includes("application/json");
  return wantsJson ? json({ url: authorizeUrl.toString() }) : redirect(authorizeUrl.toString());
}

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
  // fallback, no decryption. Works (and reports honestly) even if the
  // encryption key is missing.
  let tokenData;
  try {
    const summary = await getProviderConnectionSummary(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, userId, PROVIDERS.OURA);
    tokenData = summary.connected
      ? { expires_at: summary.expiresAt, refresh_token: summary.hasRefreshToken, token_encryption_configured: summary.tokenEncryptionConfigured }
      : null;
  } catch {
    return json({ error: "Token status unavailable" }, 502);
  }

  let lastSynced = null;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/oura_data?user_id=eq.${encodeURIComponent(userId)}&select=synced_at&order=synced_at.desc&limit=1`,
      {
        headers: {
          "authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "apikey": SUPABASE_SERVICE_ROLE_KEY,
        },
      }
    );
    if (r.ok) {
      const rows = await r.json();
      lastSynced = rows?.[0]?.synced_at || null;
    } else {
      console.warn("Oura status sync lookup failed:", r.status);
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
  // stored tokens (handled inside refreshOuraAccessToken) — we never return tokens.
  let expiresAt = tokenData?.expires_at || null;
  let isExpired = expiresAt ? new Date(expiresAt) <= new Date() : false;
  if (tokenData) {
    const remainingMs = expiresAt ? new Date(expiresAt).getTime() - Date.now() : -Infinity;
    const needsRefresh = remainingMs <= TOKEN_NEAR_EXPIRY_MS;
    if (needsRefresh && tokenData.refresh_token) {
      // V14 · refreshOuraAccessToken resolves its own refresh token from the
      // encrypted store (with one-shot legacy migration) — no plaintext flows
      // through the status handler.
      const refreshed = await refreshOuraAccessToken(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, userId);
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
    tokenEncryptionConfigured: tokenData ? tokenData.token_encryption_configured !== false : undefined,
  });
}

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
    for (const table of ["oura_data", "oura_tokens"]) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?user_id=eq.${encodeURIComponent(userId)}`, {
        method: "DELETE",
        headers: {
          "authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "apikey": SUPABASE_SERVICE_ROLE_KEY,
          "Prefer": "return=minimal",
        },
      });
      // V14 · 404 = the table no longer exists (migration_v31 dropped the
      // plaintext token tables). Nothing to delete is a success, not a failure.
      if (!r.ok && r.status !== 404) {
        console.error(`Oura disconnect failed for ${table}:`, r.status);
        await logSyncEvent(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
          userId, source: "oura", eventType: "disconnect", status: "failed",
          message: `Disconnect failed at ${table} (status ${r.status}).`,
        });
        return json({ error: "Disconnect failed" }, 502);
      }
    }
    // Best-effort cleanup for the provider-standard mirror. Do not fail legacy
    // disconnect if the migration has not been applied yet.
    await fetch(`${SUPABASE_URL}/rest/v1/connected_accounts?user_id=eq.${encodeURIComponent(userId)}&provider=eq.oura`, {
      method: "DELETE",
      headers: {
        "authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Prefer": "return=minimal",
      },
    }).catch(() => null);
  } catch {
    await logSyncEvent(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      userId, source: "oura", eventType: "disconnect", status: "failed",
      message: "Disconnect failed — network error.",
    });
    return json({ error: "Disconnect failed" }, 502);
  }

  await logSyncEvent(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    userId, source: "oura", eventType: "disconnect", status: "success",
    message: "Oura disconnected. Tokens and data removed.",
  });

  return json({ ok: true });
}

function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function syncRange(days) {
  const safeDays = Math.min(30, Math.max(1, Number.isFinite(Number(days)) ? Math.round(Number(days)) : 14));
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - safeDays);
  return { days: safeDays, startDate: fmtDate(start), endDate: fmtDate(end) };
}

async function buildOuraUpserts({ userId, accessToken, days = 14 }) {
  const { days: safeDays, startDate, endDate } = syncRange(days);
  const dataTypes = {
    sleep: "sleep",
    readiness: "daily_readiness",
    activity: "daily_activity",
    heartrate: "heartrate",
    spo2: "daily_spo2",
  };
  const upserts = [];
  for (const [dataType, endpoint] of Object.entries(dataTypes)) {
    try {
      const params = endpoint === "heartrate"
        ? new URLSearchParams({
            start_datetime: `${startDate}T00:00:00-00:00`,
            end_datetime: `${endDate}T23:59:59-00:00`,
          })
        : new URLSearchParams({ start_date: startDate, end_date: endDate });
      const r = await fetch(`${OURA_API_BASE}/${endpoint}?${params}`, {
        headers: { "Authorization": `Bearer ${accessToken}` },
      });
      if (!r.ok) {
        console.warn(`Oura user sync skipped ${dataType}:`, r.status);
        continue;
      }
      const payload = await r.json();
      const docs = Array.isArray(payload?.data) ? payload.data : [];
      if (dataType === "heartrate") {
        if (docs.length > 0) {
          upserts.push({ user_id: userId, date: endDate, data_type: dataType, payload, synced_at: new Date().toISOString() });
        }
        continue;
      }
      for (const doc of docs) {
        const day = doc.day || doc.date;
        if (!day) continue;
        upserts.push({
          user_id: userId,
          date: day,
          data_type: dataType,
          payload: { data: [doc] },
          synced_at: new Date().toISOString(),
        });
      }
    } catch (e) {
      console.warn(`Oura user sync error ${dataType}:`, e?.message || e);
    }
  }
  return { upserts, safeDays, startDate, endDate };
}

// Exchange the stored refresh token for a new access token, persist the rotated
// tokens immediately, and log a token_refresh event. Returns { accessToken,
// expiresAt } on success or null on failure. The refresh token itself is never
// returned. Shared by /status (self-heal) and the manual-sync path
// (getUsableOuraAccessToken).
//
// V14 · Resolves its own refresh token from the encrypted store (with one-shot
// legacy migration) and persists the rotation encrypted-only. The resolve step
// fails up front when the encryption key is missing, so we never rotate a
// token at Oura that we'd then be unable to store — that ordering is what
// keeps a misconfigured deploy from silently severing connections.
async function refreshOuraAccessToken(supabaseUrl, serviceKey, userId) {
  const OURA_CLIENT_ID = process.env.OURA_CLIENT_ID;
  const OURA_CLIENT_SECRET = process.env.OURA_CLIENT_SECRET;
  if (!OURA_CLIENT_ID || !OURA_CLIENT_SECRET) {
    console.error("Oura refresh: credentials not configured");
    return null;
  }
  const resolved = await resolveProviderTokens(supabaseUrl, serviceKey, { userId, provider: PROVIDERS.OURA });
  if (!resolved.ok || !resolved.refreshToken) {
    await logSyncEvent(supabaseUrl, serviceKey, {
      userId, source: "oura", eventType: "token_refresh", status: "failed",
      message: resolved.reason === "encryption_not_configured"
        ? "Token refresh blocked: TOKEN_ENCRYPTION_KEY is not configured."
        : "Token refresh failed: no refresh token on file.",
    });
    return null;
  }
  try {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: resolved.refreshToken,
      client_id: OURA_CLIENT_ID,
      client_secret: OURA_CLIENT_SECRET,
    });
    const refreshRes = await fetch(OURA_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body,
    });
    if (!refreshRes.ok) {
      console.error("Oura token refresh failed:", refreshRes.status);
      return null;
    }
    const refreshed = await refreshRes.json();
    const accessToken = refreshed.access_token;
    const newRefresh = refreshed.refresh_token || resolved.refreshToken;
    if (!accessToken) return null;
    const expiresIn = refreshed.expires_in || 3600;
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    // Persist immediately before using it so a rotated refresh token is never lost.
    const persisted = await persistProviderTokens(supabaseUrl, serviceKey, {
      userId,
      provider: PROVIDERS.OURA,
      accessToken,
      refreshToken: newRefresh,
      expiresAt,
      scopes: ["personal", "daily", "heartrate", "spo2"],
    });
    if (!persisted.ok) {
      // The rotation already happened at Oura; a failed store means the stored
      // refresh token is now stale. Report failure so the UI surfaces a
      // reconnect rather than pretending health.
      await logSyncEvent(supabaseUrl, serviceKey, { userId, source: "oura", eventType: "token_refresh", status: "failed", message: `Refreshed but storage failed (${persisted.reason}).` });
      return null;
    }
    await logSyncEvent(supabaseUrl, serviceKey, { userId, source: "oura", eventType: "token_refresh", status: "success", message: "Oura access token refreshed." });
    return { accessToken, expiresAt };
  } catch (e) {
    console.error("Oura token refresh error:", e?.message || "error");
    await logSyncEvent(supabaseUrl, serviceKey, { userId, source: "oura", eventType: "token_refresh", status: "failed", message: e?.message || "Token refresh failed." });
    return null;
  }
}

async function getUsableOuraAccessToken(supabaseUrl, serviceKey, userId) {
  const OURA_CLIENT_ID = process.env.OURA_CLIENT_ID;
  const OURA_CLIENT_SECRET = process.env.OURA_CLIENT_SECRET;
  // V14 · Encrypted store first, one-shot legacy migration, fail-closed on a
  // missing encryption key.
  const resolved = await resolveProviderTokens(supabaseUrl, serviceKey, { userId, provider: PROVIDERS.OURA });
  if (!resolved.ok) {
    if (resolved.reason === "encryption_not_configured") {
      return { error: "Server token storage not configured (TOKEN_ENCRYPTION_KEY).", status: 503 };
    }
    return { error: "Oura not connected", status: 404 };
  }
  if (!resolved.accessToken || !resolved.refreshToken) return { error: "Oura not connected", status: 404 };

  const expiresAt = resolved.expiresAt ? new Date(resolved.expiresAt).getTime() : 0;
  if (expiresAt > Date.now() + 60000) return { accessToken: resolved.accessToken };
  if (!OURA_CLIENT_ID || !OURA_CLIENT_SECRET) return { error: "Oura not configured", status: 500 };

  const refreshed = await refreshOuraAccessToken(supabaseUrl, serviceKey, userId);
  if (!refreshed) return { error: "Token refresh failed", status: 502 };
  return { accessToken: refreshed.accessToken };
}

function countRowsByType(rows) {
  const counts = { sleep: 0, readiness: 0, activity: 0, heartrate: 0, spo2: 0 };
  for (const row of rows || []) {
    if (Object.prototype.hasOwnProperty.call(counts, row.data_type)) counts[row.data_type] += 1;
  }
  return counts;
}

async function handleCounts(req) {
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: "Server not configured" }, 500);
  let userId;
  try { userId = await resolveUserIdFromBearer(req); } catch { userId = null; }
  if (!userId) return json({ error: "Not authenticated" }, 401);
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/oura_data?user_id=eq.${encodeURIComponent(userId)}&select=date,data_type,synced_at`,
    { headers: { "authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "apikey": SUPABASE_SERVICE_ROLE_KEY } }
  );
  if (!r.ok) return json({ error: "Counts unavailable" }, 502);
  const rows = await r.json();
  const counts = countRowsByType(rows);
  let lastSynced = null;
  let latestDate = null;
  for (const row of rows || []) {
    if (row.synced_at && (!lastSynced || new Date(row.synced_at) > new Date(lastSynced))) lastSynced = row.synced_at;
    if (row.date && (!latestDate || row.date > latestDate)) latestDate = row.date;
  }
  return json({ ...counts, lastSynced, latestDate });
}

async function runOuraSyncForUser(supabaseUrl, serviceKey, userId, requestedDays = 14, logLabel = "Manual Oura sync", eventLabel = "Manual sync") {
  const token = await getUsableOuraAccessToken(supabaseUrl, serviceKey, userId);
  if (token.error) return { error: token.error, status: token.status || 502 };
  const { upserts, safeDays, startDate, endDate } = await buildOuraUpserts({ userId, accessToken: token.accessToken, days: requestedDays });
  const result = upserts.length > 0
    ? await storeOuraDataBatches(supabaseUrl, serviceKey, upserts, logLabel)
    : { stored: 0, failures: [] };
  const counts = countRowsByType(upserts);
  const status = result.failures.length === 0 ? "success" : result.stored > 0 ? "partial" : "failed";
  await logSyncEvent(supabaseUrl, serviceKey, {
    userId, source: "oura", eventType: "sync", status, counts,
    message: status === "success" ? `${eventLabel}: ${result.stored} record(s) stored over ${safeDays} days.` : `${eventLabel}: ${result.stored} stored, ${result.failures.length} type(s) failed.`,
    days: safeDays,
  });
  return {
    ok: result.failures.length === 0,
    synced: upserts.length,
    stored: result.stored,
    counts,
    days: safeDays,
    start_date: startDate,
    end_date: endDate,
    failed_types: result.failures.map(f => f.dataType),
  };
}

async function handleUserSync(req) {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: "Server not configured" }, 500);

  const authHeader = req.headers.get("authorization") || "";
  const syncSecret = process.env.OURA_SYNC_SECRET;
  const isInternalSync = Boolean(syncSecret && authHeader === `Bearer ${syncSecret}`);

  let userId;
  let requestedDays = new URL(req.url).searchParams.get("days") || 14;

  if (isInternalSync) {
    // Scheduled prefetch calls the same routed endpoint, but only with the
    // internal OURA_SYNC_SECRET. User ownership is the service-role selected
    // token row from wearable-prefetch, never a browser-supplied id.
    let body;
    try { body = await req.json(); }
    catch { return json({ error: "Invalid JSON" }, 400); }
    userId = body?.user_id;
    requestedDays = body?.days || requestedDays;
    if (!userId) return json({ error: "Missing user_id" }, 400);
  } else {
    try { userId = await resolveUserIdFromBearer(req); } catch { userId = null; }
    if (!userId) return json({ error: "Not authenticated" }, 401);
  }

  const result = await runOuraSyncForUser(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    userId,
    requestedDays,
    isInternalSync ? "Scheduled Oura sync" : "Manual Oura sync",
    isInternalSync ? "Scheduled sync" : "Manual sync"
  );
  if (result.error) return json({ error: result.error }, result.status || 502);
  return json(result);
}

async function handleCallback(req) {
  const OURA_CLIENT_ID = process.env.OURA_CLIENT_ID;
  const OURA_CLIENT_SECRET = process.env.OURA_CLIENT_SECRET;
  const redirectUri = resolveOuraRedirectUri(req);
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!OURA_CLIENT_ID || !OURA_CLIENT_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "Server not configured" }, 500);
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) return redirect(`/settings?oura_error=${encodeURIComponent(error)}`);
  if (!code || !state) return json({ error: "Missing code or state" }, 400);

  // V13.6 · Consume the single-use state row. Returns the userId and deletes
  // the row atomically, so a replayed callback (same state twice) fails.
  const userId = await consumeProviderOAuthState(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    provider: PROVIDERS.OURA,
    state,
  });
  if (!userId) return json({ error: "Invalid or expired state" }, 400);

  let tokenData;
  try {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: OURA_CLIENT_ID,
      client_secret: OURA_CLIENT_SECRET,
      redirect_uri: redirectUri,
    });

    const r = await fetch(OURA_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body,
    });
    if (!r.ok) {
      console.error("Oura token exchange failed:", r.status);
      return redirect(`/settings?oura_error=token_exchange_failed_${r.status}`);
    }
    tokenData = await r.json();
  } catch (e) {
    console.error("Token exchange error:", e);
    return redirect(`/settings?oura_error=network_error`);
  }

  const accessToken = tokenData.access_token;
  const refreshToken = tokenData.refresh_token;
  const expiresIn = tokenData.expires_in || 3600;
  if (!accessToken || !refreshToken) {
    return redirect(`/settings?oura_error=invalid_token_response`);
  }

  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  // V14 · Encrypted-only persistence. This is the moment plaintext-at-rest
  // ends for Oura: connected_accounts (AES-256-GCM) is the sole store, and a
  // successful persist deletes any surviving legacy oura_tokens row. Fails
  // closed with an actionable error when TOKEN_ENCRYPTION_KEY is missing —
  // never falls back to writing plaintext.
  const persisted = await persistProviderTokens(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    userId,
    provider: PROVIDERS.OURA,
    accessToken,
    refreshToken,
    expiresAt,
    scopes: ["personal", "daily", "heartrate", "spo2"],
  });
  if (!persisted.ok) {
    console.error("Failed to store Oura tokens:", persisted.reason);
    return redirect(persisted.reason === "encryption_not_configured"
      ? `/settings?oura_error=token_storage_unconfigured`
      : `/settings?oura_error=storage_failed`);
  }

  // Best-effort immediate sync for the last 14 days so the dashboard is not empty
  // right after OAuth. Oura summaries can lag, so a range is more reliable than yesterday-only.
  try {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 14);
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const startDate = fmt(start);
    const endDate = fmt(end);
    const dataTypes = {
      sleep: "sleep",
      readiness: "daily_readiness",
      activity: "daily_activity",
      heartrate: "heartrate",
      spo2: "daily_spo2",
    };
    const upserts = [];
    for (const [dataType, endpoint] of Object.entries(dataTypes)) {
      const params = endpoint === "heartrate"
        ? new URLSearchParams({
            start_datetime: `${startDate}T00:00:00-00:00`,
            end_datetime: `${endDate}T23:59:59-00:00`,
          })
        : new URLSearchParams({ start_date: startDate, end_date: endDate });
      const r = await fetch(`${OURA_API_BASE}/${endpoint}?${params}`, {
        headers: { "Authorization": `Bearer ${accessToken}` },
      });
      if (!r.ok) {
        console.warn(`Immediate Oura sync skipped ${dataType}:`, r.status);
        continue;
      }
      const payload = await r.json();
      const docs = Array.isArray(payload?.data) ? payload.data : [];
      if (dataType === "heartrate") {
        upserts.push({ user_id: userId, date: endDate, data_type: dataType, payload, synced_at: new Date().toISOString() });
        continue;
      }
      for (const doc of docs) {
        const day = doc.day || doc.date;
        if (!day) continue;
        upserts.push({
          user_id: userId,
          date: day,
          data_type: dataType,
          payload: { data: [doc] },
          synced_at: new Date().toISOString(),
        });
      }
    }
    if (upserts.length > 0) {
      // Batch by data_type: a 500 from one type (e.g. a schema mismatch on
      // heartrate) must not lose sleep/readiness/activity too. storeOuraDataBatches
      // logs sanitized status + data_type + row count + response body per failure.
      const { failures } = await storeOuraDataBatches(
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY,
        upserts,
        "Immediate Oura data sync"
      );
      if (failures.length > 0) {
        console.warn(`Immediate Oura data sync: ${failures.length} data_type batch(es) failed to store`);
      }
      // V3.4 parity — log the connect + immediate sync event
      await logSyncEvent(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        userId, source: "oura", eventType: "connect",
        status: failures.length === 0 ? "success" : "partial",
        message: failures.length === 0
          ? "Oura connected and initial 14-day sync completed."
          : `Oura connected, but ${failures.length} data_type batch(es) failed to store.`,
        days: 14,
      });
    } else {
      await logSyncEvent(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        userId, source: "oura", eventType: "connect", status: "partial",
        message: "Oura connected, but initial sync returned no data — try syncing manually.",
        days: 14,
      });
    }
  } catch (e) {
    console.warn("Immediate Oura sync failed:", e);
    await logSyncEvent(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      userId, source: "oura", eventType: "connect", status: "partial",
      message: "Oura connected, but initial sync failed — try syncing manually.",
    });
  }

  return redirect(`/settings?oura_connected=true`);
}

// ─── Route: GET /api/oura/events ─────────────────────────────────────────────
// Returns the most recent wearable_sync_events rows for the caller (Oura only
// for this endpoint). Owner-derived via Bearer token. Mirrors /api/whoop/events.
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

  let limit = 20;
  try {
    const requested = parseInt(new URL(req.url).searchParams.get("limit") || "", 10);
    if (Number.isFinite(requested)) limit = Math.min(50, Math.max(1, requested));
  } catch { limit = 20; }

  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/wearable_sync_events?user_id=eq.${encodeURIComponent(userId)}&source=eq.oura&order=created_at.desc&limit=${limit}&select=id,source,event_type,status,counts,message,days,created_at`,
      {
        headers: {
          "authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "apikey": SUPABASE_SERVICE_ROLE_KEY,
        },
      }
    );
    if (!r.ok) {
      console.error("Oura events lookup failed:", r.status);
      return json({ error: "Events unavailable" }, 502);
    }
    const rows = await r.json();
    return json({ events: Array.isArray(rows) ? rows : [] });
  } catch {
    return json({ error: "Events unavailable" }, 502);
  }
}

// Netlify serves this function at /api/oura/auth and /api/oura/callback
export const config = { path: "/api/oura/*" };

export default async (req) => {
  const url = new URL(req.url);
  if (url.pathname.endsWith("/api/oura/auth")) {
    return await handleAuth(req);
  } else if (url.pathname.endsWith("/api/oura/callback")) {
    return await handleCallback(req);
  } else if (url.pathname.endsWith("/api/oura/status")) {
    return await handleStatus(req);
  } else if (url.pathname.endsWith("/api/oura/counts")) {
    return await handleCounts(req);
  } else if (url.pathname.endsWith("/api/oura/sync")) {
    return await handleUserSync(req);
  } else if (url.pathname.endsWith("/api/oura/events")) {
    return await handleEvents(req);
  } else if (url.pathname.endsWith("/api/oura/disconnect")) {
    return await handleDisconnect(req);
  } else {
    return json({ error: "Not found" }, 404);
  }
};