// netlify/functions/oura-sync.js
// ─────────────────────────────────────────────────────────────────────────────
// Oura Data Sync (PHASE 2)
//
// POST /api/oura/sync
// • Fetches yesterday's data from Oura API (sleep, readiness, activity, HR, SpO2)
// • Stores normalized data in Supabase oura_data table
// • Persists rotated tokens encrypted in connected_accounts (V14)
// • Protected by OURA_SYNC_SECRET header (scheduler authentication)
//
// Env vars:
// • OURA_SYNC_SECRET — secret key for scheduler (Authorization: Bearer header)
// • SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — server-to-server Supabase access
// ─────────────────────────────────────────────────────────────────────────────

import { resolveProviderTokens, persistProviderTokens, PROVIDERS } from "./_provider-standard.js";

const OURA_API_BASE = "https://api.ouraring.com/v2/usercollection";

// ─── Sync diagnostics helpers ────────────────────────────────────────────────
// These make failed Supabase/PostgREST writes debuggable without leaking
// secrets. If you are chasing a "Failed to store Oura data" log line, this is
// where the sanitized status + response body come from. Duplicated verbatim in
// netlify/functions/oura-auth.js (no shared serverless utils dir exists yet).

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


function requestTooLarge(req, maxBytes = 64_000) {
  const len = Number(req.headers.get("content-length") || 0);
  return Number.isFinite(len) && len > maxBytes;
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (requestTooLarge(req, 256_000)) return json({ error: "Request body too large" }, 413);

  const SECRET = process.env.OURA_SYNC_SECRET;
  if (!SECRET) return json({ error: "Sync not configured" }, 500);

  // Verify secret
  const authHeader = req.headers.get("authorization") || "";
  if (authHeader !== `Bearer ${SECRET}`) {
    return json({ error: "Unauthorized" }, 401);
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "Supabase not configured" }, 500);
  }

  let body;
  try { body = await req.json(); }
  catch { return json({ error: "Invalid JSON" }, 400); }

  const userId = body?.user_id;
  if (!userId) return json({ error: "Missing user_id" }, 400);

  // V14 · Fetch tokens via the encrypted store (one-shot legacy migration,
  // fail-closed without the encryption key).
  const resolved = await resolveProviderTokens(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { userId, provider: PROVIDERS.OURA });
  if (!resolved.ok) {
    if (resolved.reason === "encryption_not_configured") {
      return json({ error: "Server token storage not configured (TOKEN_ENCRYPTION_KEY)." }, 503);
    }
    return json({ error: "No refresh token found" }, 404);
  }
  if (!resolved.refreshToken) {
    return json({ error: "No refresh token found" }, 404);
  }

  // Refresh access token if needed
  let accessToken = resolved.accessToken;
  if (!accessToken || new Date(resolved.expiresAt || 0) <= new Date()) {
    const OURA_CLIENT_ID = process.env.OURA_CLIENT_ID;
    const OURA_CLIENT_SECRET = process.env.OURA_CLIENT_SECRET;
    if (!OURA_CLIENT_ID || !OURA_CLIENT_SECRET) {
      return json({ error: "Oura credentials not configured" }, 500);
    }

    try {
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: resolved.refreshToken,
        client_id: OURA_CLIENT_ID,
        client_secret: OURA_CLIENT_SECRET,
      });

      const r = await fetch("https://api.ouraring.com/oauth/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body,
      });
      if (!r.ok) {
        console.error("Token refresh failed:", r.status);
        return json({ error: "Token refresh failed" }, 502);
      }
      const newTokenData = await r.json();
      accessToken = newTokenData.access_token;
      const newRefreshToken = newTokenData.refresh_token;
      const expiresAt = new Date(Date.now() + (newTokenData.expires_in || 3600) * 1000).toISOString();

      // V14 · Persist the rotation encrypted-only, immediately, before any data
      // fetch. resolveProviderTokens already refused when the key was missing,
      // so this persist cannot fail for that reason.
      const persisted = await persistProviderTokens(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        userId,
        provider: PROVIDERS.OURA,
        accessToken,
        refreshToken: newRefreshToken || resolved.refreshToken,
        expiresAt,
        scopes: ["personal", "daily", "heartrate", "spo2"],
      });
      if (!persisted.ok) {
        console.error("Token storage failed after refresh:", persisted.reason);
        return json({ error: "Token storage failed" }, 502);
      }
    } catch (e) {
      console.error("Token refresh error:", e);
      return json({ error: "Token refresh failed" }, 502);
    }
  }

  // Fetch a 14-day range from Oura. Daily summaries can lag, and sleep docs
  // should be stored under their own Oura `day`, not under request date.
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
    try {
      const params = endpoint === "heartrate"
        ? new URLSearchParams({
            start_datetime: `${startDate}T00:00:00-00:00`,
            end_datetime: `${endDate}T23:59:59-00:00`,
          })
        : new URLSearchParams({
            start_date: startDate,
            end_date: endDate,
          });
      const r = await fetch(`${OURA_API_BASE}/${endpoint}?${params}`, {
        headers: { "Authorization": `Bearer ${accessToken}` },
      });
      if (!r.ok) {
        console.warn(`Failed to fetch ${dataType}:`, r.status);
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
    } catch (e) {
      console.warn(`Error fetching ${dataType}:`, e);
    }
  }

  let storeStored = upserts.length;
  let storeFailures = [];
  if (upserts.length > 0) {
    // Batch by data_type so a single failing type is identified in logs and does
    // not sink the rest. storeOuraDataBatches logs sanitized status + data_type +
    // row count + PostgREST response body for each failed batch.
    const result = await storeOuraDataBatches(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      upserts,
      "Oura sync"
    );
    storeStored = result.stored;
    storeFailures = result.failures;
  }

  // `synced` keeps its original meaning (rows attempted). `stored`/`failed_types`
  // are additive diagnostics; `ok` now reflects whether every batch persisted.
  // V3.4 parity — log a sync event so the debug timeline covers scheduled Oura syncs.
  const syncCounts = {};
  for (const row of upserts) {
    syncCounts[row.data_type] = (syncCounts[row.data_type] || 0) + 1;
  }
  const syncStatus = storeFailures.length === 0 ? "success" : storeStored > 0 ? "partial" : "failed";
  const syncMessage = storeFailures.length === 0
    ? `Scheduled sync: ${storeStored} record(s) stored over 14 days.`
    : `Scheduled sync: ${storeStored} stored, ${storeFailures.length} type(s) failed.`;
  // Best-effort event log (no service-role context here — use a direct fetch)
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/wearable_sync_events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Prefer": "return=minimal",
      },
      body: JSON.stringify({
        user_id: userId,
        source: "oura",
        event_type: "sync",
        status: syncStatus,
        counts: syncCounts,
        message: String(syncMessage).slice(0, 300),
        days: 14,
      }),
    });
  } catch {
    // Best-effort — never break the sync response over event logging.
  }

  return json({
    ok: storeFailures.length === 0,
    synced: upserts.length,
    stored: storeStored,
    failed_types: storeFailures.map((f) => f.dataType),
    start_date: startDate,
    end_date: endDate,
  });
};