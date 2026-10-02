// netlify/functions/_provider-standard.js
// ─────────────────────────────────────────────────────────────────────────────
// Server-side integration standard for OAuth health/activity providers.
//
// This module is deliberately provider-agnostic. Oura/Whoop continue writing to
// their legacy token tables for backward compatibility, but successful OAuth
// callbacks also mirror encrypted account metadata into connected_accounts when
// the new migration has been applied and TOKEN_ENCRYPTION_KEY is configured.
// ─────────────────────────────────────────────────────────────────────────────

import crypto from "node:crypto";

export const PROVIDERS = Object.freeze({
  OURA: "oura",
  WHOOP: "whoop",
  GOOGLE_HEALTH: "google_health",
  STRAVA: "strava",
  MANUAL: "manual",
  MIXED: "mixed",
});

export const AI_EXCLUSION_REASONS = Object.freeze({
  USER_OPT_OUT: "user_opt_out",
  STRAVA_API_TERMS: "strava_api_terms",
  SENSITIVE_SCOPE: "sensitive_scope",
  UNKNOWN_PROVIDER_POLICY: "unknown_provider_policy",
});

export const providerPolicies = Object.freeze({
  [PROVIDERS.OURA]: Object.freeze({ aiEligibleDefault: true, aiExclusionReason: null, role: "recovery" }),
  [PROVIDERS.WHOOP]: Object.freeze({ aiEligibleDefault: true, aiExclusionReason: null, role: "recovery_and_load" }),
  [PROVIDERS.GOOGLE_HEALTH]: Object.freeze({ aiEligibleDefault: true, aiExclusionReason: null, role: "recovery_and_activity" }),
  [PROVIDERS.STRAVA]: Object.freeze({ aiEligibleDefault: false, aiExclusionReason: AI_EXCLUSION_REASONS.STRAVA_API_TERMS, role: "activity" }),
  [PROVIDERS.MANUAL]: Object.freeze({ aiEligibleDefault: true, aiExclusionReason: null, role: "user_entered_truth" }),
});

function stableEncryptionKey(rawKey) {
  if (!rawKey) return null;
  const value = String(rawKey).trim();
  if (!value) return null;
  // Accept either a 32-byte base64/base64url key or any high-entropy string.
  try {
    const decoded = Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    if (decoded.length === 32) return decoded;
  } catch {
    // Fall through to hash-derived key.
  }
  return crypto.createHash("sha256").update(value).digest();
}

export function encryptSecret(plaintext, env = process.env) {
  if (plaintext == null || plaintext === "") return null;
  const key = stableEncryptionKey(env.TOKEN_ENCRYPTION_KEY || env.CONNECTED_ACCOUNT_ENCRYPTION_KEY);
  if (!key) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptSecret(ciphertext, env = process.env) {
  if (!ciphertext) return null;
  const key = stableEncryptionKey(env.TOKEN_ENCRYPTION_KEY || env.CONNECTED_ACCOUNT_ENCRYPTION_KEY);
  if (!key) return null;
  const [version, ivB64, tagB64, encryptedB64] = String(ciphertext).split(".");
  if (version !== "v1" || !ivB64 || !tagB64 || !encryptedB64) return null;
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedB64, "base64url")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

export function getAiPolicyForProvider(provider, { userOptedIn = true } = {}) {
  const policy = providerPolicies[provider];
  if (!policy) {
    return { aiEligible: false, aiExclusionReason: AI_EXCLUSION_REASONS.UNKNOWN_PROVIDER_POLICY };
  }
  if (!userOptedIn) {
    return { aiEligible: false, aiExclusionReason: AI_EXCLUSION_REASONS.USER_OPT_OUT };
  }
  return {
    aiEligible: Boolean(policy.aiEligibleDefault),
    aiExclusionReason: policy.aiEligibleDefault ? null : policy.aiExclusionReason,
  };
}

export function buildConnectedAccountRecord({
  userId,
  provider,
  providerUserId = null,
  accessToken,
  refreshToken,
  expiresAt = null,
  scopes = [],
  status = "connected",
  env = process.env,
} = {}) {
  if (!userId || !provider) return null;
  const accessTokenCiphertext = encryptSecret(accessToken, env);
  const refreshTokenCiphertext = encryptSecret(refreshToken, env);
  if ((accessToken || refreshToken) && (!accessTokenCiphertext || !refreshTokenCiphertext)) {
    return null;
  }
  const aiPolicy = getAiPolicyForProvider(provider);
  return {
    user_id: userId,
    provider,
    provider_user_id: providerUserId,
    access_token_ciphertext: accessTokenCiphertext,
    refresh_token_ciphertext: refreshTokenCiphertext,
    scopes_granted: Array.isArray(scopes) ? scopes : String(scopes || "").split(/\s+/).filter(Boolean),
    expires_at: expiresAt,
    status,
    ai_eligible: aiPolicy.aiEligible,
    ai_exclusion_reason: aiPolicy.aiExclusionReason,
    connected_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

export async function upsertConnectedAccount(supabaseUrl, serviceKey, accountRecord) {
  if (!supabaseUrl || !serviceKey || !accountRecord?.user_id || !accountRecord?.provider) {
    return { ok: false, skipped: true, reason: "missing_required_fields" };
  }
  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/connected_accounts?on_conflict=user_id,provider`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${serviceKey}`,
        "apikey": serviceKey,
        "Prefer": "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(accountRecord),
    });
    if (!r.ok) return { ok: false, status: r.status };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || "connected account upsert failed" };
  }
}

export async function mirrorConnectedAccount(supabaseUrl, serviceKey, params) {
  const record = buildConnectedAccountRecord(params);
  if (!record) return { ok: false, skipped: true, reason: "encryption_not_configured_or_invalid_record" };
  return await upsertConnectedAccount(supabaseUrl, serviceKey, record);
}

export function serviceHeaders(serviceKey, extra = {}) {
  return {
    "authorization": `Bearer ${serviceKey}`,
    "apikey": serviceKey,
    ...extra,
  };
}


export const CONNECTED_ACCOUNT_SELECT = "id,user_id,provider,provider_user_id,access_token_ciphertext,refresh_token_ciphertext,scopes_granted,expires_at,status,ai_eligible,ai_exclusion_reason,last_sync_at,connected_at,updated_at";

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "strict-origin-when-cross-origin",
      ...extraHeaders,
    },
  });
}

export function redirect(location, status = 302) {
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

export async function resolveUserIdFromBearer(req, env = process.env) {
  const supabaseUrl = env.SUPABASE_URL;
  const anonKey = env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) return null;
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return null;
  const r = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { "authorization": `Bearer ${token}`, "apikey": anonKey },
  });
  if (!r.ok) return null;
  const user = await r.json().catch(() => null);
  return user?.id || null;
}

export function randomState(length = 32) {
  return crypto.randomBytes(length).toString("base64url").slice(0, length);
}

export async function storeProviderOAuthState(supabaseUrl, serviceKey, { provider, state, userId, ttlMs = 10 * 60 * 1000 }) {
  if (!supabaseUrl || !serviceKey || !provider || !state || !userId) return false;
  const r = await fetch(`${supabaseUrl}/rest/v1/provider_oauth_state`, {
    method: "POST",
    headers: serviceHeaders(serviceKey, { "content-type": "application/json", "Prefer": "return=minimal" }),
    body: JSON.stringify({ provider, state, user_id: userId, expires_at: new Date(Date.now() + ttlMs).toISOString() }),
  });
  return r.ok;
}

export async function consumeProviderOAuthState(supabaseUrl, serviceKey, { provider, state }) {
  if (!supabaseUrl || !serviceKey || !provider || !state) return null;
  let row = null;
  try {
    const r = await fetch(
      `${supabaseUrl}/rest/v1/provider_oauth_state?provider=eq.${encodeURIComponent(provider)}&state=eq.${encodeURIComponent(state)}&select=user_id,expires_at&limit=1`,
      { headers: serviceHeaders(serviceKey) }
    );
    if (r.ok) row = (await r.json())?.[0] || null;
  } catch {
    row = null;
  }
  try {
    await fetch(`${supabaseUrl}/rest/v1/provider_oauth_state?provider=eq.${encodeURIComponent(provider)}&state=eq.${encodeURIComponent(state)}`, {
      method: "DELETE",
      headers: serviceHeaders(serviceKey, { "Prefer": "return=minimal" }),
    });
    await fetch(`${supabaseUrl}/rest/v1/provider_oauth_state?expires_at=lt.${encodeURIComponent(new Date().toISOString())}`, {
      method: "DELETE",
      headers: serviceHeaders(serviceKey, { "Prefer": "return=minimal" }),
    });
  } catch {
    /* best effort */
  }
  if (!row || new Date(row.expires_at) <= new Date()) return null;
  return row.user_id || null;
}

export async function getConnectedAccount(supabaseUrl, serviceKey, userId, provider) {
  if (!supabaseUrl || !serviceKey || !userId || !provider) return null;
  const r = await fetch(
    `${supabaseUrl}/rest/v1/connected_accounts?user_id=eq.${encodeURIComponent(userId)}&provider=eq.${encodeURIComponent(provider)}&select=${CONNECTED_ACCOUNT_SELECT}&limit=1`,
    { headers: serviceHeaders(serviceKey) }
  );
  if (!r.ok) return null;
  return (await r.json().catch(() => []))?.[0] || null;
}

export function decryptAccountTokens(account, env = process.env) {
  if (!account) return null;
  return {
    accessToken: decryptSecret(account.access_token_ciphertext, env),
    refreshToken: decryptSecret(account.refresh_token_ciphertext, env),
  };
}

export async function updateConnectedAccount(supabaseUrl, serviceKey, userId, provider, patch) {
  if (!supabaseUrl || !serviceKey || !userId || !provider || !patch) return false;
  const r = await fetch(
    `${supabaseUrl}/rest/v1/connected_accounts?user_id=eq.${encodeURIComponent(userId)}&provider=eq.${encodeURIComponent(provider)}`,
    {
      method: "PATCH",
      headers: serviceHeaders(serviceKey, { "content-type": "application/json", "Prefer": "return=minimal" }),
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
    }
  );
  return r.ok;
}

export async function deleteProviderData(supabaseUrl, serviceKey, userId, provider) {
  if (!supabaseUrl || !serviceKey || !userId || !provider) return false;
  const headers = serviceHeaders(serviceKey, { "Prefer": "return=minimal" });
  await fetch(`${supabaseUrl}/rest/v1/provider_raw_payloads?user_id=eq.${encodeURIComponent(userId)}&provider=eq.${encodeURIComponent(provider)}`, { method: "DELETE", headers });
  await fetch(`${supabaseUrl}/rest/v1/health_daily_summaries?user_id=eq.${encodeURIComponent(userId)}&source_provider=eq.${encodeURIComponent(provider)}`, { method: "DELETE", headers });
  const activityRows = await fetch(`${supabaseUrl}/rest/v1/activities?user_id=eq.${encodeURIComponent(userId)}&source_provider=eq.${encodeURIComponent(provider)}&select=id`, { headers: serviceHeaders(serviceKey) })
    .then(r => r.ok ? r.json() : [])
    .catch(() => []);
  const ids = Array.isArray(activityRows) ? activityRows.map(r => r.id).filter(Boolean) : [];
  for (const id of ids) {
    await fetch(`${supabaseUrl}/rest/v1/activity_streams?activity_id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers });
  }
  await fetch(`${supabaseUrl}/rest/v1/activities?user_id=eq.${encodeURIComponent(userId)}&source_provider=eq.${encodeURIComponent(provider)}`, { method: "DELETE", headers });
  await fetch(`${supabaseUrl}/rest/v1/connected_accounts?user_id=eq.${encodeURIComponent(userId)}&provider=eq.${encodeURIComponent(provider)}`, { method: "DELETE", headers });
  return true;
}

export async function logSyncEvent(supabaseUrl, serviceKey, { userId, source, eventType = "sync", status = "success", counts = {}, message = "", days = null }) {
  if (!supabaseUrl || !serviceKey || !userId || !source) return false;
  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/wearable_sync_events`, {
      method: "POST",
      headers: serviceHeaders(serviceKey, { "content-type": "application/json", "Prefer": "return=minimal" }),
      body: JSON.stringify({ user_id: userId, source, event_type: eventType, status, counts, message, days }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

// ═══ V14 · Encrypted-token cutover ═══════════════════════════════════════════
// connected_accounts (AES-256-GCM ciphertexts) is now the runtime source of
// truth for ALL provider tokens. The legacy plaintext tables (oura_tokens,
// whoop_tokens) survive only as a one-shot read fallback: the first time a
// user's tokens are resolved after this release, the legacy row is encrypted
// into connected_accounts and the plaintext row is DELETED. Active users drain
// out of the legacy tables organically (every sync/status/refresh resolves
// tokens), after which migration_v31 drops the plaintext columns entirely.
//
// Fail-closed stance: nothing here ever WRITES plaintext. If the encryption
// key is absent, token resolution refuses up front — before any provider call —
// so a rotating refresh token is never burned against storage we can't use.

// Legacy plaintext token tables (pre-V14). Only Oura and Whoop ever had them.
const LEGACY_TOKEN_TABLES = Object.freeze({
  [PROVIDERS.OURA]: { table: "oura_tokens", select: "access_token,refresh_token,expires_at" },
  [PROVIDERS.WHOOP]: { table: "whoop_tokens", select: "access_token,refresh_token,expires_at,scope" },
});

export function tokenEncryptionConfigured(env = process.env) {
  return Boolean(stableEncryptionKey(env.TOKEN_ENCRYPTION_KEY || env.CONNECTED_ACCOUNT_ENCRYPTION_KEY));
}

// Tolerant legacy read: any failure (including the table having been dropped
// by migration_v31) reads as "no legacy row". Never throws.
export async function readLegacyTokenRow(supabaseUrl, serviceKey, userId, provider) {
  const spec = LEGACY_TOKEN_TABLES[provider];
  if (!spec || !supabaseUrl || !serviceKey || !userId) return null;
  try {
    const r = await fetch(
      `${supabaseUrl}/rest/v1/${spec.table}?user_id=eq.${encodeURIComponent(userId)}&select=${spec.select}&limit=1`,
      { headers: serviceHeaders(serviceKey) }
    );
    if (!r.ok) return null;
    return (await r.json().catch(() => []))?.[0] || null;
  } catch {
    return null;
  }
}

// Best-effort plaintext row deletion. Also tolerant of a dropped table.
export async function deleteLegacyTokenRow(supabaseUrl, serviceKey, userId, provider) {
  const spec = LEGACY_TOKEN_TABLES[provider];
  if (!spec || !supabaseUrl || !serviceKey || !userId) return false;
  try {
    const r = await fetch(
      `${supabaseUrl}/rest/v1/${spec.table}?user_id=eq.${encodeURIComponent(userId)}`,
      { method: "DELETE", headers: serviceHeaders(serviceKey, { "Prefer": "return=minimal" }) }
    );
    return r.ok;
  } catch {
    return false;
  }
}

// The only sanctioned token WRITE path. Encrypts into connected_accounts and,
// on success, removes the user's plaintext row so it can't go stale-but-live.
// Returns { ok } or { ok:false, reason } — callers surface the reason.
export async function persistProviderTokens(supabaseUrl, serviceKey, {
  userId, provider, providerUserId = null, accessToken, refreshToken,
  expiresAt = null, scopes = [], env = process.env,
} = {}) {
  if (!tokenEncryptionConfigured(env)) {
    return { ok: false, reason: "encryption_not_configured" };
  }
  const result = await mirrorConnectedAccount(supabaseUrl, serviceKey, {
    userId, provider, providerUserId, accessToken, refreshToken, expiresAt, scopes, env,
  });
  if (!result?.ok) {
    return { ok: false, reason: result?.reason || `upsert_failed_${result?.status || "unknown"}` };
  }
  await deleteLegacyTokenRow(supabaseUrl, serviceKey, userId, provider);
  return { ok: true };
}

// The only sanctioned token READ path. Encrypted row first; legacy row as a
// one-shot fallback that self-migrates (encrypt + upsert + delete plaintext).
// Refuses outright when the key is missing — resolving tokens we cannot later
// persist would strand rotated refresh tokens.
export async function resolveProviderTokens(supabaseUrl, serviceKey, { userId, provider, env = process.env } = {}) {
  if (!supabaseUrl || !serviceKey || !userId || !provider) {
    return { ok: false, reason: "missing_parameters" };
  }
  if (!tokenEncryptionConfigured(env)) {
    return { ok: false, reason: "encryption_not_configured" };
  }

  const account = await getConnectedAccount(supabaseUrl, serviceKey, userId, provider).catch(() => null);
  if (account) {
    let tokens;
    try { tokens = decryptAccountTokens(account, env); } catch { /* fall through to legacy */ }
    if (tokens?.accessToken || tokens?.refreshToken) {
      return {
        ok: true,
        source: "encrypted",
        accessToken: tokens.accessToken || null,
        refreshToken: tokens.refreshToken || null,
        expiresAt: account.expires_at || null,
        scopes: account.scopes_granted || [],
      };
    }
    // Ciphertexts exist but don't decrypt (rotated key). Fall through: a
    // surviving legacy row lets us self-heal by re-encrypting under the
    // current key.
  }

  const legacy = await readLegacyTokenRow(supabaseUrl, serviceKey, userId, provider);
  if (legacy?.access_token || legacy?.refresh_token) {
    const scopes = String(legacy.scope || "").split(/\s+/).filter(Boolean);
    const persisted = await persistProviderTokens(supabaseUrl, serviceKey, {
      userId, provider,
      accessToken: legacy.access_token || null,
      refreshToken: legacy.refresh_token || null,
      expiresAt: legacy.expires_at || null,
      scopes, env,
    });
    return {
      ok: true,
      source: persisted.ok ? "legacy_migrated" : "legacy",
      accessToken: legacy.access_token || null,
      refreshToken: legacy.refresh_token || null,
      expiresAt: legacy.expires_at || null,
      scopes,
    };
  }

  return { ok: false, reason: "not_connected" };
}

// Presence-only view for /status endpoints: no decryption, so it works and
// reports honestly even when the encryption key is missing.
export async function getProviderConnectionSummary(supabaseUrl, serviceKey, userId, provider, env = process.env) {
  const encryptionConfigured = tokenEncryptionConfigured(env);
  const account = await getConnectedAccount(supabaseUrl, serviceKey, userId, provider).catch(() => null);
  if (account) {
    return {
      connected: true,
      source: "encrypted",
      expiresAt: account.expires_at || null,
      hasRefreshToken: Boolean(account.refresh_token_ciphertext),
      tokenEncryptionConfigured: encryptionConfigured,
    };
  }
  const legacy = await readLegacyTokenRow(supabaseUrl, serviceKey, userId, provider);
  if (legacy) {
    return {
      connected: true,
      source: "legacy",
      expiresAt: legacy.expires_at || null,
      hasRefreshToken: Boolean(legacy.refresh_token),
      tokenEncryptionConfigured: encryptionConfigured,
    };
  }
  return { connected: false, source: null, expiresAt: null, hasRefreshToken: false, tokenEncryptionConfigured: encryptionConfigured };
}

// Scheduled-job enumeration: users with a connection for `provider`, union of
// encrypted rows (preferred) and any not-yet-migrated legacy rows, deduped.
export async function listProviderConnectedUserIds(supabaseUrl, serviceKey, provider, limit = 25) {
  const ids = [];
  const seen = new Set();
  try {
    const r = await fetch(
      `${supabaseUrl}/rest/v1/connected_accounts?provider=eq.${encodeURIComponent(provider)}&select=user_id&limit=${limit}`,
      { headers: serviceHeaders(serviceKey) }
    );
    if (r.ok) {
      for (const row of (await r.json().catch(() => [])) || []) {
        if (row?.user_id && !seen.has(row.user_id)) { seen.add(row.user_id); ids.push(row.user_id); }
      }
    }
  } catch { /* tolerated */ }
  const spec = LEGACY_TOKEN_TABLES[provider];
  if (spec && ids.length < limit) {
    try {
      const r = await fetch(
        `${supabaseUrl}/rest/v1/${spec.table}?select=user_id&limit=${limit}`,
        { headers: serviceHeaders(serviceKey) }
      );
      if (r.ok) {
        for (const row of (await r.json().catch(() => [])) || []) {
          if (row?.user_id && !seen.has(row.user_id)) { seen.add(row.user_id); ids.push(row.user_id); }
          if (ids.length >= limit) break;
        }
      }
    } catch { /* tolerated (table may be dropped post-v31) */ }
  }
  return ids.slice(0, limit);
}

export function hashPayload(payload) {
  return crypto.createHash("sha256").update(JSON.stringify(payload ?? {})).digest("hex");
}


export default {
  PROVIDERS,
  AI_EXCLUSION_REASONS,
  providerPolicies,
  encryptSecret,
  decryptSecret,
  getAiPolicyForProvider,
  buildConnectedAccountRecord,
  upsertConnectedAccount,
  mirrorConnectedAccount,
  serviceHeaders,
  json,
  redirect,
  resolveUserIdFromBearer,
  randomState,
  storeProviderOAuthState,
  consumeProviderOAuthState,
  getConnectedAccount,
  decryptAccountTokens,
  updateConnectedAccount,
  deleteProviderData,
  logSyncEvent,
  hashPayload,
  tokenEncryptionConfigured,
  readLegacyTokenRow,
  deleteLegacyTokenRow,
  persistProviderTokens,
  resolveProviderTokens,
  getProviderConnectionSummary,
  listProviderConnectedUserIds,
};
