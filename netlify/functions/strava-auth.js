import {
  PROVIDERS,
  buildConnectedAccountRecord,
  consumeProviderOAuthState,
  decryptAccountTokens,
  deleteProviderData,
  getAiPolicyForProvider,
  getConnectedAccount,
  hashPayload,
  json,
  logSyncEvent,
  randomState,
  redirect,
  resolveUserIdFromBearer,
  secretsMatch,
  serviceHeaders,
  storeProviderOAuthState,
  updateConnectedAccount,
  upsertConnectedAccount,
} from "./_provider-standard.js";

const STRAVA_AUTH_URL = "https://www.strava.com/oauth/authorize";
const STRAVA_TOKEN_URL = "https://www.strava.com/oauth/token";
const STRAVA_API_BASE = "https://www.strava.com/api/v3";
const STRAVA_SCOPES = "read,activity:read,activity:read_all,profile:read_all";
const MAX_SYNC_DAYS = 90;
const TOKEN_NEAR_EXPIRY_MS = 5 * 60 * 1000;
// Strava's webhook events are a few hundred bytes.
const WEBHOOK_MAX_BYTES = 4_096;
const WEBHOOK_UPDATE_KEYS = ["title", "type", "private", "authorized"];
const STRAVA_ID = /^[1-9][0-9]{0,19}$/;

function envReady() {
  return Boolean(process.env.STRAVA_CLIENT_ID && process.env.STRAVA_CLIENT_SECRET && process.env.STRAVA_REDIRECT_URI && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function parseScopes(scopeValue) {
  if (Array.isArray(scopeValue)) return scopeValue.filter(Boolean);
  return String(scopeValue || "").split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
}

async function exchangeToken(body) {
  const r = await fetch(STRAVA_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "accept": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const error = new Error(data?.message || `strava_token_${r.status}`);
    error.status = r.status;
    throw error;
  }
  return data;
}

async function refreshStravaToken(account) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const tokens = decryptAccountTokens(account);
  if (!tokens?.refreshToken) return null;
  const tokenData = await exchangeToken({
    client_id: process.env.STRAVA_CLIENT_ID,
    client_secret: process.env.STRAVA_CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: tokens.refreshToken,
  });
  const expiresAt = tokenData.expires_at ? new Date(tokenData.expires_at * 1000).toISOString() : new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
  const record = buildConnectedAccountRecord({
    userId: account.user_id,
    provider: PROVIDERS.STRAVA,
    providerUserId: account.provider_user_id,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token || tokens.refreshToken,
    expiresAt,
    scopes: account.scopes_granted || [],
  });
  if (record) await upsertConnectedAccount(supabaseUrl, serviceKey, { ...record, connected_at: account.connected_at || new Date().toISOString() });
  return { accessToken: tokenData.access_token, expiresAt };
}

async function getAccessTokenForAccount(account) {
  if (!account || account.status !== "connected") return null;
  const expiresAt = account.expires_at ? new Date(account.expires_at).getTime() : 0;
  if (expiresAt && expiresAt - Date.now() <= TOKEN_NEAR_EXPIRY_MS) {
    return (await refreshStravaToken(account))?.accessToken || null;
  }
  return decryptAccountTokens(account)?.accessToken || null;
}

function normalizeSportType(activity = {}) {
  return activity.sport_type || activity.type || activity.workout_type || "activity";
}

function stravaDedupeKey(activity = {}) {
  const start = activity.start_date ? new Date(activity.start_date).toISOString().slice(0, 16) : "unknown";
  const duration = Math.round((Number(activity.moving_time || activity.elapsed_time || 0) || 0) / 60) * 60;
  const distance = Math.round((Number(activity.distance) || 0) / 100) * 100;
  return `strava:${normalizeSportType(activity)}:${start}:${duration}:${distance}`;
}

function activityRow(userId, activity) {
  const aiPolicy = getAiPolicyForProvider(PROVIDERS.STRAVA);
  return {
    user_id: userId,
    source_provider: PROVIDERS.STRAVA,
    provider_activity_id: String(activity.id || activity.resource_state || `${activity.start_date}-${activity.name || "activity"}`),
    start_time: activity.start_date || activity.start_date_local || new Date().toISOString(),
    sport_type: normalizeSportType(activity),
    title: activity.name || normalizeSportType(activity),
    duration_sec: Number(activity.moving_time || activity.elapsed_time) || null,
    distance_m: Number(activity.distance) || null,
    elevation_m: Number(activity.total_elevation_gain) || null,
    avg_hr: Number(activity.average_heartrate) || null,
    max_hr: Number(activity.max_heartrate) || null,
    avg_power: Number(activity.average_watts || activity.weighted_average_watts) || null,
    calories: Number(activity.calories) || null,
    perceived_effort: Number(activity.perceived_exertion || activity.suffer_score) || null,
    source_payload_hash: hashPayload(activity),
    dedupe_key: stravaDedupeKey(activity),
    ai_eligible: aiPolicy.aiEligible,
    ai_exclusion_reason: aiPolicy.aiExclusionReason,
    synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

async function upsertActivities(supabaseUrl, serviceKey, rows) {
  if (!rows.length) return 0;
  const r = await fetch(`${supabaseUrl}/rest/v1/activities?on_conflict=user_id,source_provider,provider_activity_id`, {
    method: "POST",
    headers: serviceHeaders(serviceKey, { "content-type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify(rows),
  });
  return r.ok ? rows.length : 0;
}

async function storeRaw(supabaseUrl, serviceKey, userId, payloadType, payload) {
  await fetch(`${supabaseUrl}/rest/v1/provider_raw_payloads`, {
    method: "POST",
    headers: serviceHeaders(serviceKey, { "content-type": "application/json", "Prefer": "return=minimal" }),
    body: JSON.stringify({ user_id: userId, provider: PROVIDERS.STRAVA, payload_type: payloadType, payload_hash: hashPayload(payload), payload }),
  }).catch(() => null);
}

async function syncStrava(userId, days = 30) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const account = await getConnectedAccount(supabaseUrl, serviceKey, userId, PROVIDERS.STRAVA);
  if (!account) return { error: "Strava not connected", status: 404 };
  const accessToken = await getAccessTokenForAccount(account);
  if (!accessToken) return { error: "Strava connection needs reconnect", status: 401 };

  const after = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);
  const all = [];
  for (let page = 1; page <= 3; page++) {
    const url = new URL(`${STRAVA_API_BASE}/athlete/activities`);
    url.searchParams.set("after", String(after));
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));
    const r = await fetch(url, { headers: { "authorization": `Bearer ${accessToken}`, "accept": "application/json" } });
    if (r.status === 429) {
      await logSyncEvent(supabaseUrl, serviceKey, { userId, source: PROVIDERS.STRAVA, eventType: "rate_limited", status: "partial", message: "Strava rate limit reached.", days });
      return { error: "Strava rate limit reached", status: 429 };
    }
    if (!r.ok) return { error: `Strava activities failed: ${r.status}`, status: 502 };
    const rows = await r.json().catch(() => []);
    if (!Array.isArray(rows) || rows.length === 0) break;
    all.push(...rows);
    if (rows.length < 100) break;
  }

  await storeRaw(supabaseUrl, serviceKey, userId, "activities", { days, activities: all });
  const stored = await upsertActivities(supabaseUrl, serviceKey, all.map(a => activityRow(userId, a)));
  await updateConnectedAccount(supabaseUrl, serviceKey, userId, PROVIDERS.STRAVA, { last_sync_at: new Date().toISOString(), status: "connected" });
  await logSyncEvent(supabaseUrl, serviceKey, {
    userId,
    source: PROVIDERS.STRAVA,
    eventType: "sync_succeeded",
    status: "success",
    counts: { activities: stored, fetched: all.length },
    message: `Synced ${stored} Strava activity record(s).`,
    days,
  });
  return { ok: true, synced: stored, fetched: all.length, days };
}

async function handleAuth(req) {
  if (!envReady()) return json({ error: "Strava not configured" }, 500);
  const userId = await resolveUserIdFromBearer(req);
  if (!userId) return json({ error: "Not authenticated" }, 401);
  const state = randomState(32);
  const stored = await storeProviderOAuthState(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { provider: PROVIDERS.STRAVA, state, userId });
  if (!stored) return json({ error: "Could not start Strava connection" }, 502);
  const url = new URL(STRAVA_AUTH_URL);
  url.searchParams.set("client_id", process.env.STRAVA_CLIENT_ID);
  url.searchParams.set("redirect_uri", process.env.STRAVA_REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", STRAVA_SCOPES);
  url.searchParams.set("approval_prompt", "auto");
  url.searchParams.set("state", state);
  return (req.headers.get("accept") || "").includes("application/json") ? json({ url: url.toString() }) : redirect(url.toString());
}

async function handleCallback(req) {
  if (!envReady()) return json({ error: "Server not configured" }, 500);
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const acceptedScope = url.searchParams.get("scope") || "";
  const error = url.searchParams.get("error");
  if (error) return redirect(`/?strava_error=${encodeURIComponent(error)}#/settings`);
  if (!code || !state) return json({ error: "Missing code or state" }, 400);
  const userId = await consumeProviderOAuthState(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { provider: PROVIDERS.STRAVA, state });
  if (!userId) return json({ error: "Invalid or expired state" }, 400);

  let tokenData;
  try {
    tokenData = await exchangeToken({ client_id: process.env.STRAVA_CLIENT_ID, client_secret: process.env.STRAVA_CLIENT_SECRET, code, grant_type: "authorization_code" });
  } catch (e) {
    return redirect(`/?strava_error=${encodeURIComponent(e.message || "token_exchange_failed")}#/settings`);
  }
  const scopes = parseScopes(tokenData.scope || acceptedScope);
  const expiresAt = tokenData.expires_at ? new Date(tokenData.expires_at * 1000).toISOString() : null;
  const athleteId = tokenData.athlete?.id ? String(tokenData.athlete.id) : null;
  const record = buildConnectedAccountRecord({
    userId,
    provider: PROVIDERS.STRAVA,
    providerUserId: athleteId,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresAt,
    scopes,
  });
  if (!record || !(await upsertConnectedAccount(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, record)).ok) {
    return redirect(`/?strava_error=token_store_failed#/settings`);
  }
  await logSyncEvent(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { userId, source: PROVIDERS.STRAVA, eventType: "oauth_connected", status: "success", message: "Strava connected." });
  return redirect(`/?strava=connected#/settings`);
}

async function handleStatus(req) {
  if (!envReady()) return json({ connected: false, syncStatus: "not_configured" });
  const userId = await resolveUserIdFromBearer(req);
  if (!userId) return json({ error: "Not authenticated" }, 401);
  const account = await getConnectedAccount(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, userId, PROVIDERS.STRAVA);
  if (!account) return json({ connected: false, syncStatus: "never" });
  const expiresAtMs = account.expires_at ? new Date(account.expires_at).getTime() : 0;
  return json({
    connected: account.status === "connected",
    expiresAt: account.expires_at,
    isExpired: expiresAtMs ? expiresAtMs <= Date.now() : false,
    lastSynced: account.last_sync_at,
    syncStatus: account.last_sync_at ? "synced" : "never",
    scopes: account.scopes_granted || [],
    aiEligible: !!account.ai_eligible,
    aiExclusionReason: account.ai_exclusion_reason || null,
  });
}

async function handleSync(req) {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const userId = await resolveUserIdFromBearer(req);
  if (!userId) return json({ error: "Not authenticated" }, 401);
  const requested = Number(new URL(req.url).searchParams.get("days") || 30);
  const days = Math.min(MAX_SYNC_DAYS, Math.max(1, Number.isFinite(requested) ? Math.round(requested) : 30));
  const result = await syncStrava(userId, days);
  return json(result, result.status || (result.error ? 502 : 200));
}

async function handleCounts(req) {
  const userId = await resolveUserIdFromBearer(req);
  if (!userId) return json({ error: "Not authenticated" }, 401);
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/activities?user_id=eq.${encodeURIComponent(userId)}&source_provider=eq.strava&select=start_time`, { headers: serviceHeaders(process.env.SUPABASE_SERVICE_ROLE_KEY) });
  const rows = r.ok ? await r.json().catch(() => []) : [];
  const latestDate = Array.isArray(rows) && rows.length ? rows.map(x => x.start_time).sort().at(-1)?.slice(0, 10) : null;
  const account = await getConnectedAccount(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, userId, PROVIDERS.STRAVA);
  return json({ activities: Array.isArray(rows) ? rows.length : 0, latestDate, lastSynced: account?.last_sync_at || null });
}

async function handleEvents(req) {
  const userId = await resolveUserIdFromBearer(req);
  if (!userId) return json({ error: "Not authenticated" }, 401);
  const limit = Math.min(50, Math.max(1, Number(new URL(req.url).searchParams.get("limit") || 20)));
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/wearable_sync_events?user_id=eq.${encodeURIComponent(userId)}&source=eq.strava&order=created_at.desc&limit=${limit}&select=id,source,event_type,status,counts,message,days,created_at`, { headers: serviceHeaders(process.env.SUPABASE_SERVICE_ROLE_KEY) });
  return json({ events: r.ok ? await r.json().catch(() => []) : [] });
}

async function handleDisconnect(req) {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const userId = await resolveUserIdFromBearer(req);
  if (!userId) return json({ error: "Not authenticated" }, 401);
  await deleteProviderData(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, userId, PROVIDERS.STRAVA);
  await logSyncEvent(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { userId, source: PROVIDERS.STRAVA, eventType: "oauth_disconnected", status: "success", message: "Strava disconnected." });
  return json({ ok: true });
}

function requestTooLarge(req, maxBytes) {
  const len = Number(req.headers.get("content-length") || 0);
  return Number.isFinite(len) && len > maxBytes;
}

// A Strava webhook event, cut down to the fields this handler uses. Null when
// it isn't one: an unknown object or aspect type, or an id that isn't a
// positive integer.
export function parseStravaEvent(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const objectType = body.object_type;
  const aspectType = body.aspect_type;
  if (objectType !== "activity" && objectType !== "athlete") return null;
  if (!["create", "update", "delete"].includes(aspectType)) return null;
  const ownerId = String(body.owner_id ?? "");
  const objectId = String(body.object_id ?? "");
  if (!STRAVA_ID.test(ownerId) || !STRAVA_ID.test(objectId)) return null;
  const updates = {};
  if (body.updates && typeof body.updates === "object" && !Array.isArray(body.updates)) {
    for (const key of WEBHOOK_UPDATE_KEYS) {
      const value = body.updates[key];
      if (typeof value === "boolean") updates[key] = value;
      else if (typeof value === "string") updates[key] = value.slice(0, 200);
    }
  }
  return {
    objectType,
    aspectType,
    ownerId,
    objectId,
    subscriptionId: body.subscription_id == null ? null : String(body.subscription_id),
    eventTime: Number.isFinite(Number(body.event_time)) ? Number(body.event_time) : null,
    updates,
  };
}

// Strava doesn't sign its webhook events. With STRAVA_WEBHOOK_SECRET set, the
// callback registered with Strava is /api/strava/webhook/<secret>, and a
// request to any other webhook path is answered 404 without being read.
function webhookPathAllowed(pathSecret, env = process.env) {
  const expected = env.STRAVA_WEBHOOK_SECRET;
  if (!expected) return true;
  return secretsMatch(pathSecret || "", expected);
}

// Whether Strava still lets this app read the athlete's data: true, false
// once access was revoked, or null when Strava couldn't say (rate limit,
// outage, no usable token).
async function stravaStillAuthorized(account) {
  let accessToken;
  try {
    accessToken = await getAccessTokenForAccount(account);
  } catch (error) {
    return error?.status === 400 || error?.status === 401 ? false : null;
  }
  if (!accessToken) return null;
  const r = await fetch(`${STRAVA_API_BASE}/athlete`, { headers: { "authorization": `Bearer ${accessToken}`, "accept": "application/json" } });
  if (r.ok) return true;
  if (r.status === 401) return false;
  return null;
}

async function storedActivityExists(supabaseUrl, serviceKey, userId, activityId) {
  const r = await fetch(`${supabaseUrl}/rest/v1/activities?user_id=eq.${encodeURIComponent(userId)}&source_provider=eq.strava&provider_activity_id=eq.${encodeURIComponent(activityId)}&select=id&limit=1`, { headers: serviceHeaders(serviceKey) });
  if (!r.ok) return false;
  const rows = await r.json().catch(() => []);
  return Array.isArray(rows) && rows.length > 0;
}

// True only when Strava answers 404 for the activity, so it really is gone.
async function stravaActivityGone(account, activityId) {
  let accessToken;
  try {
    accessToken = await getAccessTokenForAccount(account);
  } catch {
    return false;
  }
  if (!accessToken) return false;
  const r = await fetch(`${STRAVA_API_BASE}/activities/${encodeURIComponent(activityId)}`, { headers: { "authorization": `Bearer ${accessToken}`, "accept": "application/json" } });
  return r.status === 404;
}

async function handleWebhook(req, pathSecret = "") {
  if (!webhookPathAllowed(pathSecret)) return json({ error: "Not found" }, 404);
  const url = new URL(req.url);
  if (req.method === "GET") {
    const verifyToken = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN;
    if (verifyToken && secretsMatch(url.searchParams.get("hub.verify_token") || "", verifyToken)) {
      return json({ "hub.challenge": url.searchParams.get("hub.challenge") || "" });
    }
    return json({ error: "Invalid verify token" }, 403);
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (requestTooLarge(req, WEBHOOK_MAX_BYTES)) return json({ error: "Request body too large" }, 413);
  const text = await req.text().catch(() => "");
  if (text.length > WEBHOOK_MAX_BYTES) return json({ error: "Request body too large" }, 413);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  const event = parseStravaEvent(body);
  if (!event) return json({ error: "Not a Strava webhook event" }, 400);
  const subscriptionId = process.env.STRAVA_SUBSCRIPTION_ID;
  if (subscriptionId && event.subscriptionId !== String(subscriptionId)) return json({ error: "Unknown subscription" }, 403);

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return json({ error: "Server not configured" }, 500);
  const r = await fetch(`${supabaseUrl}/rest/v1/connected_accounts?provider=eq.strava&provider_user_id=eq.${encodeURIComponent(event.ownerId)}&select=user_id&limit=1`, { headers: serviceHeaders(serviceKey) });
  const userId = r.ok ? (await r.json().catch(() => []))?.[0]?.user_id : null;
  // An athlete nobody here has connected: acknowledge it and keep nothing.
  if (!userId) return json({ ok: true });

  await fetch(`${supabaseUrl}/rest/v1/provider_webhook_events`, {
    method: "POST",
    headers: serviceHeaders(serviceKey, { "content-type": "application/json", "Prefer": "return=minimal" }),
    body: JSON.stringify({
      provider: PROVIDERS.STRAVA,
      provider_user_id: event.ownerId,
      object_id: event.objectId,
      event_type: event.objectType,
      aspect_type: event.aspectType,
      payload: { object_type: event.objectType, aspect_type: event.aspectType, object_id: event.objectId, owner_id: event.ownerId, subscription_id: event.subscriptionId, event_time: event.eventTime, updates: event.updates },
      processed_at: new Date().toISOString(),
    }),
  }).catch(() => null);

  // Deauthorization purge — the API Agreement requires deleting an athlete's
  // data when they revoke access from Strava's side. Strava signals this as an
  // athlete-update event with authorized:"false". Anyone can send that event,
  // so the purge waits until Strava itself refuses this app's token.
  const authorizedFlag = event.updates.authorized;
  if (event.objectType === "athlete" && (authorizedFlag === "false" || authorizedFlag === false)) {
    const account = await getConnectedAccount(supabaseUrl, serviceKey, userId, PROVIDERS.STRAVA);
    const authorized = account ? await stravaStillAuthorized(account).catch(() => null) : null;
    if (authorized === true) {
      await logSyncEvent(supabaseUrl, serviceKey, { userId, source: PROVIDERS.STRAVA, eventType: "deauthorize_ignored", status: "error", message: "A deauthorization event arrived, but Strava still accepts this app's token; nothing was deleted." });
      return json({ ok: true });
    }
    if (authorized === null) {
      await logSyncEvent(supabaseUrl, serviceKey, { userId, source: PROVIDERS.STRAVA, eventType: "deauthorize_unconfirmed", status: "error", message: "A deauthorization event arrived, but Strava couldn't confirm it; nothing was deleted yet." });
      // Strava retries a delivery that fails, so a real revocation gets another try.
      return json({ error: "Could not confirm the deauthorization with Strava" }, 503);
    }
    try {
      await deleteProviderData(supabaseUrl, serviceKey, userId, PROVIDERS.STRAVA);
      await logSyncEvent(supabaseUrl, serviceKey, { userId, source: PROVIDERS.STRAVA, eventType: "deauthorized_purged", status: "success", message: "Athlete revoked access on Strava; tokens and imported data deleted." });
    } catch {
      await logSyncEvent(supabaseUrl, serviceKey, { userId, source: PROVIDERS.STRAVA, eventType: "deauthorize_purge_failed", status: "error", message: "Deauthorization received but purge failed; retry via disconnect." }).catch(() => null);
    }
    return json({ ok: true });
  }
  // Targeted sync — a create/update event costs one API call for that
  // activity instead of a paged backfill, keeping webhook traffic inside the
  // rate budget. A delete drops the single normalized row, once Strava
  // confirms the activity is gone.
  if (event.objectType === "activity") {
    try {
      if (event.aspectType === "delete") {
        if (await storedActivityExists(supabaseUrl, serviceKey, userId, event.objectId)) {
          const account = await getConnectedAccount(supabaseUrl, serviceKey, userId, PROVIDERS.STRAVA);
          if (account && await stravaActivityGone(account, event.objectId)) {
            await fetch(`${supabaseUrl}/rest/v1/activities?user_id=eq.${encodeURIComponent(userId)}&source_provider=eq.strava&provider_activity_id=eq.${encodeURIComponent(event.objectId)}`, {
              method: "DELETE",
              headers: serviceHeaders(serviceKey, { "Prefer": "return=minimal" }),
            });
          }
        }
      } else {
        const account = await getConnectedAccount(supabaseUrl, serviceKey, userId, PROVIDERS.STRAVA);
        const accessToken = account ? await getAccessTokenForAccount(account) : null;
        if (accessToken) {
          const ar = await fetch(`${STRAVA_API_BASE}/activities/${encodeURIComponent(event.objectId)}`, { headers: { "authorization": `Bearer ${accessToken}`, "accept": "application/json" } });
          if (ar.ok) {
            const activity = await ar.json().catch(() => null);
            if (activity) await upsertActivities(supabaseUrl, serviceKey, [activityRow(userId, activity)]);
          }
        }
      }
    } catch { /* best-effort: the next full sync reconciles */ }
  }
  await logSyncEvent(supabaseUrl, serviceKey, { userId, source: PROVIDERS.STRAVA, eventType: "webhook_received", status: "success", counts: { object_id: event.objectId }, message: `Strava ${event.aspectType} webhook received.` });
  return json({ ok: true });
}

export const config = { path: "/api/strava/*" };

export default async (req) => {
  const path = new URL(req.url).pathname;
  const webhook = path.match(/\/api\/strava\/webhook(?:\/([^/]+))?\/?$/);
  if (webhook) return await handleWebhook(req, webhook[1] || "");
  if (path.endsWith("/api/strava/auth")) return await handleAuth(req);
  if (path.endsWith("/api/strava/callback")) return await handleCallback(req);
  if (path.endsWith("/api/strava/status")) return await handleStatus(req);
  if (path.endsWith("/api/strava/sync")) return await handleSync(req);
  if (path.endsWith("/api/strava/counts")) return await handleCounts(req);
  if (path.endsWith("/api/strava/events")) return await handleEvents(req);
  if (path.endsWith("/api/strava/disconnect")) return await handleDisconnect(req);
  return json({ error: "Not found" }, 404);
};
