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
  serviceHeaders,
  storeProviderOAuthState,
  updateConnectedAccount,
  upsertConnectedAccount,
} from "./_provider-standard.js";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_HEALTH_API_BASE = "https://health.googleapis.com/v4/users/me";
const TOKEN_NEAR_EXPIRY_MS = 5 * 60 * 1000;
const MAX_SYNC_DAYS = 90;

const GOOGLE_HEALTH_SCOPES = [
  "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
  "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
  "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
  "https://www.googleapis.com/auth/googlehealth.profile.readonly",
  "https://www.googleapis.com/auth/googlehealth.settings.readonly",
];

const DAILY_DATA_TYPES = [
  { type: "daily-heart-rate-variability", field: "hrv_ms" },
  { type: "daily-resting-heart-rate", field: "resting_hr" },
  { type: "daily-oxygen-saturation", field: "spo2" },
  { type: "daily-respiratory-rate", field: "respiratory_rate" },
  { type: "steps", field: "steps", aggregate: "sum" },
  { type: "active-minutes", field: "active_minutes", aggregate: "sum" },
  { type: "active-zone-minutes", field: "active_zone_minutes", aggregate: "sum" },
  { type: "total-calories", field: "calories", aggregate: "sum" },
];

function envReady() {
  return Boolean(process.env.GOOGLE_HEALTH_CLIENT_ID && process.env.GOOGLE_HEALTH_CLIENT_SECRET && process.env.GOOGLE_HEALTH_REDIRECT_URI && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function parseScopes(scopeValue) {
  if (Array.isArray(scopeValue)) return scopeValue.filter(Boolean);
  return String(scopeValue || "").split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
}

async function exchangeToken(body) {
  const r = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8", "accept": "application/json" },
    body: new URLSearchParams(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error_description || data?.error || `google_token_${r.status}`);
  return data;
}

async function refreshGoogleToken(account) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const tokens = decryptAccountTokens(account);
  if (!tokens?.refreshToken) return null;
  const tokenData = await exchangeToken({
    client_id: process.env.GOOGLE_HEALTH_CLIENT_ID,
    client_secret: process.env.GOOGLE_HEALTH_CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: tokens.refreshToken,
  });
  const expiresAt = new Date(Date.now() + (Number(tokenData.expires_in) || 3600) * 1000).toISOString();
  const record = buildConnectedAccountRecord({
    userId: account.user_id,
    provider: PROVIDERS.GOOGLE_HEALTH,
    providerUserId: account.provider_user_id,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token || tokens.refreshToken,
    expiresAt,
    scopes: parseScopes(tokenData.scope || account.scopes_granted || []),
  });
  if (record) await upsertConnectedAccount(supabaseUrl, serviceKey, { ...record, connected_at: account.connected_at || new Date().toISOString() });
  return { accessToken: tokenData.access_token, expiresAt };
}

async function getAccessTokenForAccount(account) {
  if (!account || account.status !== "connected") return null;
  const expiresAt = account.expires_at ? new Date(account.expires_at).getTime() : 0;
  if (expiresAt && expiresAt - Date.now() <= TOKEN_NEAR_EXPIRY_MS) {
    return (await refreshGoogleToken(account))?.accessToken || null;
  }
  return decryptAccountTokens(account)?.accessToken || null;
}

function getByPath(obj, path) {
  return path.split(".").reduce((acc, key) => (acc && Object.prototype.hasOwnProperty.call(acc, key) ? acc[key] : undefined), obj);
}

function flattenNumbers(obj, out = []) {
  if (obj == null || out.length > 50) return out;
  if (typeof obj === "number" && Number.isFinite(obj)) out.push(obj);
  else if (Array.isArray(obj)) obj.forEach(v => flattenNumbers(v, out));
  else if (typeof obj === "object") Object.values(obj).forEach(v => flattenNumbers(v, out));
  return out;
}

function extractNumber(record, preferredPaths = []) {
  for (const path of preferredPaths) {
    const v = getByPath(record, path);
    if (Number.isFinite(Number(v))) return Number(v);
  }
  const nums = flattenNumbers(record);
  return Number.isFinite(nums[0]) ? nums[0] : null;
}

function extractDate(record) {
  const candidates = [
    record.date,
    record.day,
    record.local_date,
    record.civil_date,
    record.startDate,
    record.start_date,
    record.interval?.civil_start_time,
    record.interval?.start_time,
    record.data_type?.interval?.civil_start_time,
    record.data_type?.interval?.start_time,
    record.sleep?.interval?.civil_start_time,
    record.exercise?.interval?.civil_start_time,
  ];
  const found = candidates.find(Boolean);
  if (!found) return new Date().toISOString().slice(0, 10);
  return String(found).slice(0, 10);
}

function extractInterval(record) {
  const interval = record.interval || record.data_type?.interval || record.sleep?.interval || record.exercise?.interval || {};
  const start = interval.start_time || interval.civil_start_time || record.startTime || record.start_time || record.start_date || record.start || null;
  const end = interval.end_time || interval.civil_end_time || record.endTime || record.end_time || record.end_date || record.end || null;
  return { start, end };
}

function durationMinutes(record) {
  const { start, end } = extractInterval(record);
  if (start && end) {
    const ms = new Date(end).getTime() - new Date(start).getTime();
    if (Number.isFinite(ms) && ms > 0) return Math.round(ms / 60000);
  }
  return extractNumber(record, ["duration_minutes", "durationMinutes", "minutes", "value.minutes"]);
}

function mergeDaily(daily, date, patch) {
  const row = daily.get(date) || { date, readiness_inputs: {}, source_provider: PROVIDERS.GOOGLE_HEALTH };
  for (const [key, value] of Object.entries(patch)) {
    if (value == null) continue;
    if (["steps", "active_minutes", "active_zone_minutes", "calories", "sleep_minutes"].includes(key)) {
      row[key] = (Number(row[key]) || 0) + Number(value);
    } else {
      row[key] = value;
    }
  }
  daily.set(date, row);
}

function normalizeDailyRecords(records, config, daily) {
  for (const rec of records) {
    const date = extractDate(rec);
    const value = extractNumber(rec, [
      "value", "average", "mean", "amount", "count", "duration", "minutes",
      "measurement.value", "data_type.value", "daily.value", "summary.value",
    ]);
    if (value == null) continue;
    mergeDaily(daily, date, { [config.field]: value });
  }
}

function normalizeSleepRecords(records, daily) {
  for (const rec of records) {
    const date = extractDate(rec);
    const minutes = durationMinutes(rec);
    const score = extractNumber(rec, ["score", "sleep_score", "efficiency", "summary.score"]);
    mergeDaily(daily, date, { sleep_minutes: minutes, sleep_score: score });
  }
}

function normalizeExerciseRows(userId, records) {
  const aiPolicy = getAiPolicyForProvider(PROVIDERS.GOOGLE_HEALTH);
  return records.map((rec, idx) => {
    const { start, end } = extractInterval(rec);
    const startTime = start || rec.start_time || new Date().toISOString();
    const duration = durationMinutes(rec);
    const id = rec.id || rec.uid || rec.data_point_id || hashPayload({ startTime, idx, rec }).slice(0, 32);
    return {
      user_id: userId,
      source_provider: PROVIDERS.GOOGLE_HEALTH,
      provider_activity_id: String(id),
      start_time: startTime,
      sport_type: rec.exercise?.type || rec.exercise_type || rec.activity_type || rec.type || "exercise",
      title: rec.name || rec.title || rec.exercise?.type || "Google Health exercise",
      duration_sec: duration ? Math.round(duration * 60) : null,
      distance_m: extractNumber(rec, ["distance_m", "distance", "summary.distance"]),
      elevation_m: extractNumber(rec, ["elevation_m", "elevation", "summary.elevation"]),
      avg_hr: extractNumber(rec, ["avg_hr", "average_heartrate", "heart_rate.average"]),
      max_hr: extractNumber(rec, ["max_hr", "max_heartrate", "heart_rate.max"]),
      calories: extractNumber(rec, ["calories", "energy", "summary.calories"]),
      source_payload_hash: hashPayload(rec),
      dedupe_key: `google_health:${String(startTime).slice(0, 16)}:${duration || "u"}:${String(end || "").slice(0, 16)}`,
      ai_eligible: aiPolicy.aiEligible,
      ai_exclusion_reason: aiPolicy.aiExclusionReason,
      synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  });
}

async function listDataPoints(dataType, accessToken, filter) {
  const url = new URL(`${GOOGLE_HEALTH_API_BASE}/dataTypes/${dataType}/dataPoints`);
  if (filter) url.searchParams.set("filter", filter);
  url.searchParams.set("page_size", "100");
  const r = await fetch(url, { headers: { "authorization": `Bearer ${accessToken}`, "accept": "application/json" } });
  if (!r.ok) return { error: r.status, records: [] };
  const data = await r.json().catch(() => ({}));
  const records = data.dataPoints || data.data_points || data[`${dataType}DataPoints`] || data.records || data.items || [];
  return { records: Array.isArray(records) ? records : [] };
}

async function upsertDaily(supabaseUrl, serviceKey, userId, rows) {
  if (!rows.length) return 0;
  const aiPolicy = getAiPolicyForProvider(PROVIDERS.GOOGLE_HEALTH);
  const body = rows.map(row => ({
    user_id: userId,
    ...row,
    readiness_inputs: row.readiness_inputs || {},
    ai_eligible: aiPolicy.aiEligible,
    ai_exclusion_reason: aiPolicy.aiExclusionReason,
    source_payload_hash: hashPayload(row),
    synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));
  const r = await fetch(`${supabaseUrl}/rest/v1/health_daily_summaries?on_conflict=user_id,date,source_provider`, {
    method: "POST",
    headers: serviceHeaders(serviceKey, { "content-type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify(body),
  });
  return r.ok ? body.length : 0;
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
    body: JSON.stringify({ user_id: userId, provider: PROVIDERS.GOOGLE_HEALTH, payload_type: payloadType, payload_hash: hashPayload(payload), payload }),
  }).catch(() => null);
}

async function syncGoogleHealth(userId, days = 30) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const account = await getConnectedAccount(supabaseUrl, serviceKey, userId, PROVIDERS.GOOGLE_HEALTH);
  if (!account) return { error: "Google Health/Fitbit not connected", status: 404 };
  const accessToken = await getAccessTokenForAccount(account);
  if (!accessToken) return { error: "Google Health/Fitbit connection needs reconnect", status: 401 };

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 19);
  const daily = new Map();
  const counts = {};
  const failures = [];
  const raw = {};

  for (const config of DAILY_DATA_TYPES) {
    const filterName = config.type.replace(/-/g, "_");
    const filter = `${filterName}.interval.civil_start_time >= "${since}"`;
    const { records, error } = await listDataPoints(config.type, accessToken, filter);
    if (error) failures.push({ type: config.type, status: error });
    counts[config.type] = records.length;
    raw[config.type] = records.slice(0, 100);
    normalizeDailyRecords(records, config, daily);
  }

  const sleep = await listDataPoints("sleep", accessToken, `sleep.interval.civil_start_time >= "${since}"`);
  if (sleep.error) failures.push({ type: "sleep", status: sleep.error });
  counts.sleep = sleep.records.length;
  raw.sleep = sleep.records.slice(0, 100);
  normalizeSleepRecords(sleep.records, daily);

  const exercise = await listDataPoints("exercise", accessToken, `exercise.interval.civil_start_time >= "${since}"`);
  if (exercise.error) failures.push({ type: "exercise", status: exercise.error });
  counts.exercise = exercise.records.length;
  raw.exercise = exercise.records.slice(0, 100);

  await storeRaw(supabaseUrl, serviceKey, userId, "sync_window", { days, counts, samples: raw, failures });
  const dailyStored = await upsertDaily(supabaseUrl, serviceKey, userId, [...daily.values()]);
  const activityStored = await upsertActivities(supabaseUrl, serviceKey, normalizeExerciseRows(userId, exercise.records));
  await updateConnectedAccount(supabaseUrl, serviceKey, userId, PROVIDERS.GOOGLE_HEALTH, { last_sync_at: new Date().toISOString(), status: failures.length ? "error" : "connected" });
  await logSyncEvent(supabaseUrl, serviceKey, {
    userId,
    source: PROVIDERS.GOOGLE_HEALTH,
    eventType: failures.length ? "sync_failed" : "sync_succeeded",
    status: failures.length ? (dailyStored || activityStored ? "partial" : "failed") : "success",
    counts: { ...counts, daily: dailyStored, activities: activityStored, failures: failures.length },
    message: failures.length ? `Google Health sync completed with ${failures.length} endpoint issue(s).` : `Synced ${dailyStored} daily row(s) and ${activityStored} activity row(s).`,
    days,
  });
  return { ok: !failures.length, synced: dailyStored + activityStored, counts: { daily: dailyStored, activities: activityStored, ...counts }, failures, days };
}

async function handleAuth(req) {
  if (!envReady()) return json({ error: "Google Health/Fitbit not configured" }, 500);
  const userId = await resolveUserIdFromBearer(req);
  if (!userId) return json({ error: "Not authenticated" }, 401);
  const state = randomState(32);
  const stored = await storeProviderOAuthState(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { provider: PROVIDERS.GOOGLE_HEALTH, state, userId });
  if (!stored) return json({ error: "Could not start Google Health connection" }, 502);
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", process.env.GOOGLE_HEALTH_CLIENT_ID);
  url.searchParams.set("redirect_uri", process.env.GOOGLE_HEALTH_REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_HEALTH_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return (req.headers.get("accept") || "").includes("application/json") ? json({ url: url.toString() }) : redirect(url.toString());
}

async function handleCallback(req) {
  if (!envReady()) return json({ error: "Server not configured" }, 500);
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  if (error) return redirect(`/?google_health_error=${encodeURIComponent(error)}#/settings`);
  if (!code || !state) return json({ error: "Missing code or state" }, 400);
  const userId = await consumeProviderOAuthState(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { provider: PROVIDERS.GOOGLE_HEALTH, state });
  if (!userId) return json({ error: "Invalid or expired state" }, 400);

  let tokenData;
  try {
    tokenData = await exchangeToken({
      code,
      client_id: process.env.GOOGLE_HEALTH_CLIENT_ID,
      client_secret: process.env.GOOGLE_HEALTH_CLIENT_SECRET,
      redirect_uri: process.env.GOOGLE_HEALTH_REDIRECT_URI,
      grant_type: "authorization_code",
    });
  } catch (e) {
    return redirect(`/?google_health_error=${encodeURIComponent(e.message || "token_exchange_failed")}#/settings`);
  }
  const expiresAt = new Date(Date.now() + (Number(tokenData.expires_in) || 3600) * 1000).toISOString();
  const record = buildConnectedAccountRecord({
    userId,
    provider: PROVIDERS.GOOGLE_HEALTH,
    providerUserId: null,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresAt,
    scopes: parseScopes(tokenData.scope || GOOGLE_HEALTH_SCOPES.join(" ")),
  });
  if (!record || !(await upsertConnectedAccount(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, record)).ok) {
    return redirect(`/?google_health_error=token_store_failed#/settings`);
  }
  await logSyncEvent(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { userId, source: PROVIDERS.GOOGLE_HEALTH, eventType: "oauth_connected", status: "success", message: "Google Health/Fitbit connected." });
  return redirect(`/?google_health=connected#/settings`);
}

async function handleStatus(req) {
  if (!envReady()) return json({ connected: false, syncStatus: "not_configured" });
  const userId = await resolveUserIdFromBearer(req);
  if (!userId) return json({ error: "Not authenticated" }, 401);
  const account = await getConnectedAccount(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, userId, PROVIDERS.GOOGLE_HEALTH);
  if (!account) return json({ connected: false, syncStatus: "never" });
  const expiresAtMs = account.expires_at ? new Date(account.expires_at).getTime() : 0;
  return json({
    connected: account.status === "connected" || account.status === "error",
    expiresAt: account.expires_at,
    isExpired: expiresAtMs ? expiresAtMs <= Date.now() : false,
    lastSynced: account.last_sync_at,
    syncStatus: account.last_sync_at ? account.status : "never",
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
  const result = await syncGoogleHealth(userId, days);
  return json(result, result.status || (result.error ? 502 : 200));
}

async function handleCounts(req) {
  const userId = await resolveUserIdFromBearer(req);
  if (!userId) return json({ error: "Not authenticated" }, 401);
  const headers = serviceHeaders(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const [dailyRes, activityRes, account] = await Promise.all([
    fetch(`${process.env.SUPABASE_URL}/rest/v1/health_daily_summaries?user_id=eq.${encodeURIComponent(userId)}&source_provider=eq.google_health&select=date`, { headers }),
    fetch(`${process.env.SUPABASE_URL}/rest/v1/activities?user_id=eq.${encodeURIComponent(userId)}&source_provider=eq.google_health&select=start_time`, { headers }),
    getConnectedAccount(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, userId, PROVIDERS.GOOGLE_HEALTH),
  ]);
  const dailyRows = dailyRes.ok ? await dailyRes.json().catch(() => []) : [];
  const activityRows = activityRes.ok ? await activityRes.json().catch(() => []) : [];
  const latestDaily = Array.isArray(dailyRows) && dailyRows.length ? dailyRows.map(x => x.date).sort().at(-1) : null;
  return json({ daily: dailyRows.length || 0, activities: activityRows.length || 0, latestDate: latestDaily, lastSynced: account?.last_sync_at || null });
}

async function handleEvents(req) {
  const userId = await resolveUserIdFromBearer(req);
  if (!userId) return json({ error: "Not authenticated" }, 401);
  const limit = Math.min(50, Math.max(1, Number(new URL(req.url).searchParams.get("limit") || 20)));
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/wearable_sync_events?user_id=eq.${encodeURIComponent(userId)}&source=eq.google_health&order=created_at.desc&limit=${limit}&select=id,source,event_type,status,counts,message,days,created_at`, { headers: serviceHeaders(process.env.SUPABASE_SERVICE_ROLE_KEY) });
  return json({ events: r.ok ? await r.json().catch(() => []) : [] });
}

async function handleDisconnect(req) {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const userId = await resolveUserIdFromBearer(req);
  if (!userId) return json({ error: "Not authenticated" }, 401);
  await deleteProviderData(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, userId, PROVIDERS.GOOGLE_HEALTH);
  await logSyncEvent(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { userId, source: PROVIDERS.GOOGLE_HEALTH, eventType: "oauth_disconnected", status: "success", message: "Google Health/Fitbit disconnected." });
  return json({ ok: true });
}

async function handleWebhook(req) {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const token = req.headers.get("x-google-health-webhook-token") || req.headers.get("x-webhook-token") || new URL(req.url).searchParams.get("token");
  if (process.env.GOOGLE_HEALTH_WEBHOOK_SECRET && token !== process.env.GOOGLE_HEALTH_WEBHOOK_SECRET) return json({ error: "Invalid webhook token" }, 403);
  const body = await req.json().catch(() => ({}));
  await fetch(`${process.env.SUPABASE_URL}/rest/v1/provider_webhook_events`, {
    method: "POST",
    headers: serviceHeaders(process.env.SUPABASE_SERVICE_ROLE_KEY, { "content-type": "application/json", "Prefer": "return=minimal" }),
    body: JSON.stringify({ provider: PROVIDERS.GOOGLE_HEALTH, provider_user_id: body.userId || body.user_id || null, object_id: body.notificationId || body.id || null, event_type: body.eventType || "health_data_changed", aspect_type: body.dataType || null, payload: body, processed_at: new Date().toISOString() }),
  }).catch(() => null);
  return json({ ok: true });
}

export const config = { path: "/api/google-health/*" };

export default async (req) => {
  const path = new URL(req.url).pathname;
  if (path.endsWith("/api/google-health/auth")) return await handleAuth(req);
  if (path.endsWith("/api/google-health/callback")) return await handleCallback(req);
  if (path.endsWith("/api/google-health/status")) return await handleStatus(req);
  if (path.endsWith("/api/google-health/sync")) return await handleSync(req);
  if (path.endsWith("/api/google-health/counts")) return await handleCounts(req);
  if (path.endsWith("/api/google-health/events")) return await handleEvents(req);
  if (path.endsWith("/api/google-health/disconnect")) return await handleDisconnect(req);
  if (path.endsWith("/api/google-health/webhook")) return await handleWebhook(req);
  return json({ error: "Not found" }, 404);
};
