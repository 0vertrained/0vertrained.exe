// netlify/functions/wearable-prefetch.js
// Hourly background wearable prefetch. DB-first UI reads oura_data/whoop_data;
// this keeps those tables warm without browser polling.
//
// After a successful scheduled Oura sync we also materialize a
// compact, display-safe latest snapshot into public.wearable_snapshots so a
// cold open on ANY device can hydrate before a live provider refresh. The
// snapshot holds ONLY already-derived display numbers — never OAuth tokens,
// auth payloads, or raw biometric time-series. Token-like fields are stripped
// recursively as defence-in-depth (mirrors netlify/functions/wearable-snapshot.js).

// Reuse the server-side Whoop sync core from whoop-auth.js so the scheduled
// prefetch performs a real sync (not a log-only stub) using the exact same
// token-refresh, data mapping/upsert, window, and status classification the
// manual /api/whoop/sync uses. Importing the named helpers does NOT run the
// Netlify default handler; the route/handler in whoop-auth.js is untouched.
import {
  refreshAccessToken,
  syncUserData,
  classifyWhoopSync,
  logSyncEvent,
  SYNC_DAYS as WHOOP_SYNC_DAYS,
  TOKEN_NEAR_EXPIRY_MS as WHOOP_TOKEN_NEAR_EXPIRY_MS,
} from "./whoop-auth.js";
import { PROVIDERS, resolveProviderTokens, listProviderConnectedUserIds } from "./_provider-standard.js";

const SECURITY_HEADERS = { "content-type": "application/json", "x-content-type-options": "nosniff" };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: SECURITY_HEADERS });

export const config = { schedule: "0 * * * *" };

// Hard cap on the stored snapshot size (defence-in-depth against ever dumping a
// large raw payload into the display snapshot). Mirrors wearable-snapshot.js.
const MAX_SNAPSHOT_BYTES = 32 * 1024;
// A freshly materialized snapshot is always "fresh"; kept explicit so the row
// matches the wearable_snapshots CHECK constraint without importing helpers.
const SNAPSHOT_STATUS_FRESH = "fresh";

// Secret-key stripping (mirrors netlify/functions/wearable-snapshot.js)
// Kept inline so this function stays self-contained like the other netlify
// functions; the rules must not drift from the writer/reader path.
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
 * tests. Applied to the derived snapshot so a token-like field can never be
 * stored even if a source oura_data payload shape accidentally carried one.
 */
export function stripSecretsDeep(value) {
  if (Array.isArray(value)) return value.map((v) => stripSecretsDeep(v));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (isSecretKey(k)) continue;
      out[k] = stripSecretsDeep(v);
    }
    return out;
  }
  return value;
}

// A finite number, else null. Keeps derived display values compact and typed.
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// The latest doc inside an oura_data payload ({ data: [...] }). Later Oura docs
// for the same day supersede earlier ones, so prefer the last.
function latestDoc(payload) {
  const docs = Array.isArray(payload?.data) ? payload.data : [];
  return docs.length ? docs[docs.length - 1] : null;
}

// Main-sleep selection for the snapshot, mirroring the client's
// normalization rule (src/oura/normalization.js). Oura keys naps to the day
// they occur on, so "the last doc in data[]" could be an afternoon late_nap or
// a minutes-long detected segment — the cold-open card then showed nap HRV/RHR
// as the day's numbers. Main = type matching long/main, or (untyped legacy
// docs) duration ≥ 3h; the longest main segment wins. Returns null on
// nap-only days so the chosen-day loop skips to the last real night.
function mainSleepDoc(payload) {
  const docs = Array.isArray(payload?.data) ? payload.data.filter(Boolean) : [];
  const isMain = (doc) => {
    const type = doc?.type ?? doc?.sleep_type ?? null;
    if (type != null && String(type).trim() !== "") {
      if (/long|main/i.test(String(type))) return true;
      if (/nap|rest|deleted/i.test(String(type))) return false;
    }
    const duration = Number(doc?.total_sleep_duration ?? doc?.total_sleep_time);
    // Untyped + durationless: partial/legacy record, not a nap (mirrors the
    // client rule in src/oura/normalization.js).
    if (!Number.isFinite(duration)) return true;
    return duration >= 3 * 3600;
  };
  const mains = docs.filter(isMain);
  if (!mains.length) return null;
  return mains.slice().sort((a, b) =>
    (Number(b?.total_sleep_duration) || 0) - (Number(a?.total_sleep_duration) || 0)
  )[0];
}

// Drop null/empty branches so the stored snapshot stays small and honest.
function compact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    if (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Derive a compact, display-safe snapshot from a user's recent oura_data rows.
 * Pure; exported for tests. Input rows are the same shape the UI reads:
 *   [{ date, data_type, payload }]  where payload is { data: [...docs] }.
 *
 * Returns a small object of already-derived display numbers for the most recent
 * day that has readiness or sleep, or null when there is nothing to show. The
 * result is run through stripSecretsDeep so it can never carry a token-like
 * field, and never contains raw biometric time-series (heartrate/spo2 payloads
 * are intentionally not selected upstream).
 */
export function deriveOuraDisplaySnapshot(rows) {
  const byDate = {};
  for (const row of rows || []) {
    if (!row || !row.date || !row.data_type) continue;
    if (!byDate[row.date]) byDate[row.date] = {};
    byDate[row.date][row.data_type] = row.payload;
  }
  const dates = Object.keys(byDate).sort(); // ascending ISO dates
  let chosen = null;
  for (let i = dates.length - 1; i >= 0; i--) {
    const d = byDate[dates[i]];
    // A day qualifies on readiness or a MAIN sleep; a nap-only newest
    // day no longer anchors the snapshot.
    if (d.readiness || mainSleepDoc(d.sleep)) { chosen = dates[i]; break; }
  }
  if (!chosen) return null;

  const day = byDate[chosen];
  const readinessDoc = latestDoc(day.readiness);
  const sleepDoc = mainSleepDoc(day.sleep);
  const activityDoc = latestDoc(day.activity);

  // Personal baselines for the cold-open approximation. The old
  // mapping graded HRV against a fixed 70 ms and RHR against 50 bpm —
  // population constants that happen to sit near the reporting user's numbers
  // but are meaningless for a 45 ms-baseline or 95 ms-baseline athlete. The
  // function already holds up to 30 days of this user's rows: derive trimmed
  // main-sleep baselines from the days BEFORE the chosen one and grade
  // relative to those; the constants remain the fallback below 4 samples.
  const baselinePool = { hrv: [], rhr: [] };
  for (const d of dates) {
    if (d >= chosen) continue;
    const doc = mainSleepDoc(byDate[d]?.sleep);
    const hrvVal = num(doc?.average_hrv);
    const rhrVal = num(doc?.lowest_heart_rate);
    if (hrvVal !== null && hrvVal > 0) baselinePool.hrv.push(hrvVal);
    if (rhrVal !== null && rhrVal > 0) baselinePool.rhr.push(rhrVal);
  }
  const trimmedAvg = (values) => {
    const sorted = values.slice().sort((a, b) => a - b);
    const k = sorted.length >= 5 ? Math.floor(sorted.length * 0.1) : 0;
    const kept = k > 0 ? sorted.slice(k, sorted.length - k) : sorted;
    return kept.reduce((a, b) => a + b, 0) / kept.length;
  };
  const hrvBase = baselinePool.hrv.length >= 4 ? trimmedAvg(baselinePool.hrv) : null;
  const rhrBase = baselinePool.rhr.length >= 4 ? trimmedAvg(baselinePool.rhr) : null;

  const readinessScore = num(readinessDoc?.score);
  const sleepScore = num(sleepDoc?.score);
  const averageHrv = num(sleepDoc?.average_hrv);
  const restingHeartRate = num(sleepDoc?.lowest_heart_rate);
  const sleepEfficiency = num(sleepDoc?.efficiency);
  const totalSleepSeconds = num(sleepDoc?.total_sleep_duration);
  const temperatureDeviation = num(readinessDoc?.temperature_deviation);
  const activityScore = num(activityDoc?.score);
  const activitySteps = num(activityDoc?.steps);

  // Use Oura's readiness score as the temporary DB-first lead score. The live
  // browser refresh still recomputes 0vertrained's full transparent ledger; this
  // snapshot's job is to avoid a blank/slow cold open without inventing precision.
  const leadScore = readinessScore ?? sleepScore;
  if (leadScore == null && averageHrv == null && restingHeartRate == null && sleepScore == null) return null;

  const hrvScore = averageHrv == null ? null
    : hrvBase != null
      // Relative to own baseline: at-baseline ≈ 32/35 (matching the engine's
      // z=0 midpoint), ±40 pts per 100% deviation, clamped.
      ? Math.max(0, Math.min(35, Math.round(32 + ((averageHrv - hrvBase) / hrvBase) * 40)))
      : Math.max(0, Math.min(35, Math.round((averageHrv / 70) * 35)));
  const rhrScore = restingHeartRate == null ? null
    : rhrBase != null
      // At-baseline ≈ 22/25 (engine's z=0 anchor), 2 pts per bpm of deviation.
      ? Math.max(0, Math.min(25, Math.round(22 - (restingHeartRate - rhrBase) * 2)))
      : Math.max(0, Math.min(25, Math.round(25 - Math.max(0, restingHeartRate - 50) * 1.2)));
  const sleepContribution = sleepScore == null ? null : Math.max(0, Math.min(25, Math.round((sleepScore / 100) * 25)));
  const tempContribution = temperatureDeviation == null
    ? null
    : Math.max(0, Math.min(15, Math.round(15 - Math.max(0, temperatureDeviation - 0.2) * 20)));

  const rawMetrics = compact({
    hrv: averageHrv == null ? null : `${averageHrv} ms`,
    rhr: restingHeartRate == null ? null : `${restingHeartRate} bpm`,
    sleep: sleepScore == null ? null : `${sleepScore}/100`,
    temp: temperatureDeviation == null ? null : `${temperatureDeviation > 0 ? "+" : ""}${temperatureDeviation.toFixed(1)}°C`,
  });

  const sources = compact({
    hrv: averageHrv == null ? null : "raw sleep HRV · scheduled snapshot",
    rhr: restingHeartRate == null ? null : "raw sleep RHR · scheduled snapshot",
    sleep: sleepScore == null ? null : "Oura sleep score · scheduled snapshot",
    temp: temperatureDeviation == null ? null : "Oura readiness temperature · scheduled snapshot",
  });

  const snapshot = compact({
    connected: true,
    provider: "oura",
    date: chosen,
    generatedBy: "scheduled-prefetch",
    tokenStatus: {
      connected: true,
      expiresAt: null,
      isExpired: false,
      lastSynced: new Date().toISOString(),
      syncStatus: "recent",
    },
    recovery: leadScore == null ? null : {
      score: Math.max(0, Math.min(100, Math.round(leadScore))),
      band: leadScore >= 85 ? "push" : leadScore >= 70 ? "normal_load" : leadScore >= 55 ? "moderate_load" : leadScore >= 40 ? "pull_back" : "rest",
      source: "oura_scheduled_snapshot",
      scoredDay: chosen,
    },
    rawMetrics,
    hrv: hrvScore == null ? null : { score: hrvScore, source: sources.hrv, sampleCount: null, confidence: "scheduled_snapshot", zScore: "n/a", cv: "n/a" },
    rhr: rhrScore == null ? null : { score: rhrScore, source: sources.rhr, delta: 0, confidence: "scheduled_snapshot" },
    sleep: sleepContribution == null ? null : { nightly: sleepContribution, source: sources.sleep, score: sleepScore, totalSleepSeconds, efficiency: sleepEfficiency },
    temp: tempContribution == null ? null : { score: tempContribution, source: sources.temp, consecutiveNights: 0, deviation: temperatureDeviation },
    quality: {
      score: 65,
      confidence: "medium",
      summary: "scheduled DB snapshot · live refresh will verify",
      daysLoaded: dates.length,
      daysRequested: 14,
      latestDate: chosen,
      latestRecoveryDate: chosen,
      sleepRecords: sleepDoc ? 1 : 0,
      readinessRecords: readinessDoc ? 1 : 0,
      heartrateSamples: 0,
      spo2Records: 0,
      tempRecords: temperatureDeviation == null ? 0 : 1,
      fallbackMode: false,
    },
    confidence: { score: 65, level: "medium", reason: "scheduled DB snapshot; live refresh will recompute full ledger" },
    recommendation: leadScore == null ? null : {
      label: leadScore >= 85 ? "Push" : leadScore >= 70 ? "Normal Load" : leadScore >= 55 ? "Moderate Load" : leadScore >= 40 ? "Pull Back" : "Rest / Recovery",
      prescription: "Using scheduled cached Oura data while the live provider refresh verifies the full recovery ledger.",
    },
    insights: ["Scheduled Oura snapshot loaded instantly; live refresh will verify raw data and full scoring."],
    sources,
    readiness: readinessScore == null ? null : { level: "scheduled_snapshot", score: readinessScore },
    activity: compact({ score: activityScore, steps: activitySteps }),
  });

  return stripSecretsDeep(snapshot);
}

// SupabaseSelect (generic table select) was removed here — enumeration
// goes through listProviderConnectedUserIds, and this file no longer selects
// token columns from any table.

// Load a user's recent oura_data display rows. Deliberately restricts to the
// summary data_types (readiness/sleep/activity) and excludes heartrate/spo2 so
// we never pull — let alone store — large raw biometric time-series payloads.
async function loadOuraDisplayRows(userId) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase not configured");
  const q =
    `oura_data?user_id=eq.${encodeURIComponent(userId)}` +
    `&data_type=in.(readiness,sleep,activity)` +
    `&select=date,data_type,payload&order=date.desc&limit=30`;
  const r = await fetch(`${url}/rest/v1/${q}`, {
    headers: { authorization: `Bearer ${key}`, apikey: key },
  });
  if (!r.ok) throw new Error(`oura_data select failed: ${r.status}`);
  return r.json();
}

// Upsert the display-safe snapshot for a user (service role, on_conflict=user_id).
// Returns true on success. Never fakes success: any non-OK response throws.
async function upsertWearableSnapshot(userId, snapshot, source) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase not configured");
  const safe = stripSecretsDeep(snapshot);
  const serialized = JSON.stringify(safe);
  if (serialized.length > MAX_SNAPSHOT_BYTES) throw new Error("snapshot too large");
  const r = await fetch(`${url}/rest/v1/wearable_snapshots?on_conflict=user_id`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
      apikey: key,
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({
      user_id: userId,
      source: typeof source === "string" && source ? source.slice(0, 32) : null,
      status: SNAPSHOT_STATUS_FRESH,
      snapshot: safe,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!r.ok) throw new Error(`snapshot upsert failed: ${r.status}`);
  return true;
}

// Read the just-synced user's oura_data and materialize a snapshot row. Returns
// true if a snapshot was upserted, false if there was nothing to store. Throws
// on a real failure so the caller counts it as a snapshot failure — NOT as a
// provider sync failure and never as a faked success.
async function materializeOuraSnapshot(userId) {
  const rows = await loadOuraDisplayRows(userId);
  const snapshot = deriveOuraDisplaySnapshot(rows);
  if (!snapshot) return false;
  await upsertWearableSnapshot(userId, snapshot, "oura");
  return true;
}

async function logEvent(userId, source, status, message, counts = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !userId) return;
  await fetch(`${url}/rest/v1/wearable_sync_events`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}`, apikey: key, Prefer: "return=minimal" },
    body: JSON.stringify({ user_id: userId, source, status, message, counts }),
  }).catch(() => {});
}

async function syncOuraUser(userId, origin) {
  const secret = process.env.OURA_SYNC_SECRET;
  if (!secret) return { ok: false, error: "OURA_SYNC_SECRET missing" };
  const r = await fetch(`${origin}/api/oura/sync`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
    body: JSON.stringify({ user_id: userId, days: 3 }),
  });
  const body = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body };
}

// Perform a real server-side Whoop sync for one connected user during the
// scheduled hourly prefetch. Driven ENTIRELY by a service-role enumeration of
// connection rows — never a request body/query user_id (this is a public
// scheduled endpoint, so trusting caller-supplied ids would be an
// ownership-confusion bug).
//
// Tokens come from resolveProviderTokens (encrypted connected_accounts
// first, one-shot legacy migration). Refreshes an expired / near-expired access
// token first; refreshAccessToken persists the rotated (Whoop rotates them)
// refresh token encrypted, BEFORE any data fetch, so a rotated token is never
// lost. Returns the shared classification for the event log. Throws only on an
// unexpected error so the caller counts a failure — it never fakes a success.
async function syncWhoopUser(userId) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase not configured");

  const resolved = await resolveProviderTokens(url, key, { userId, provider: PROVIDERS.WHOOP });
  if (!resolved.ok) {
    return {
      status: "failed",
      message: resolved.reason === "encryption_not_configured"
        ? "Whoop sync blocked: TOKEN_ENCRYPTION_KEY is not configured."
        : "Whoop not connected.",
      counts: {},
    };
  }

  let accessToken = resolved.accessToken;
  const expiresMs = resolved.expiresAt ? new Date(resolved.expiresAt).getTime() : NaN;
  const remainingMs = Number.isFinite(expiresMs) ? expiresMs - Date.now() : -Infinity;
  const needsRefresh = !accessToken || remainingMs <= WHOOP_TOKEN_NEAR_EXPIRY_MS;
  if (needsRefresh) {
    if (!resolved.refreshToken) {
      return { status: "failed", message: "Whoop token expired and no refresh token on file — reconnect needed.", counts: {} };
    }
    // Persists the rotated tokens (encrypted) internally before returning the new access token.
    const refreshed = await refreshAccessToken(url, key, userId);
    if (!refreshed) {
      return { status: "failed", message: "Whoop token refresh failed — reconnect needed.", counts: {} };
    }
    accessToken = refreshed.accessToken;
  }

  // 14-day window (WHOOP_SYNC_DAYS) — the same conservative default as manual sync.
  const result = await syncUserData(url, key, userId, accessToken, WHOOP_SYNC_DAYS);
  return classifyWhoopSync(result, WHOOP_SYNC_DAYS);
}

export default async (req) => {
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const origin = new URL(req.url).origin;
  const summary = {
    ok: true,
    oura: { attempted: 0, success: 0, failed: 0, snapshots: 0, snapshot_failed: 0 },
    whoop: { connected: 0, attempted: 0, success: 0, partial: 0, failed: 0 },
  };

  try {
    // Enumerate via the union of encrypted connected_accounts rows and
    // any not-yet-migrated legacy rows, deduped. Per-user token access happens
    // downstream inside oura-sync (encrypted resolve).
    const ouraUserIds = await listProviderConnectedUserIds(
      process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, PROVIDERS.OURA, 25
    );
    for (const ouraUserId of ouraUserIds) {
      summary.oura.attempted += 1;
      const res = await syncOuraUser(ouraUserId, origin);
      if (res.ok) {
        summary.oura.success += 1;
        await logEvent(ouraUserId, "oura", "success", "Hourly prefetch completed.", res.body?.counts || {});
        // Materialize a display-safe snapshot from the rows the sync just wrote.
        // A snapshot failure is isolated: it is logged and counted separately and
        // NEVER downgrades the (real) provider sync success above.
        try {
          const stored = await materializeOuraSnapshot(ouraUserId);
          if (stored) summary.oura.snapshots += 1;
        } catch (e) {
          summary.oura.snapshot_failed += 1;
          await logEvent(ouraUserId, "oura", "info", `Snapshot materialization failed: ${e?.message || "error"}`.slice(0, 300), {});
        }
      } else {
        summary.oura.failed += 1;
        await logEvent(ouraUserId, "oura", "failed", `Hourly prefetch failed (${res.status || "unknown"}).`, {});
      }
    }
  } catch (e) {
    summary.ok = false;
    summary.oura.error = e?.message || String(e);
  }

  // Scheduled Whoop sync. Enumerate connected users via the encrypted
  // store union (never selecting plaintext token columns — syncWhoopUser
  // resolves tokens itself), and drive the real server-side sync (whoop-auth.js
  // core) per user, so connected Whoop stays fresh hourly like Oura instead of
  // only updating on a manual "Sync now". The batch is capped at 25 users and
  // each sync uses the conservative 14-day window. Ownership is taken ONLY from
  // the service-role enumeration — no body/query user_id.
  try {
    const whoopUserIds = await listProviderConnectedUserIds(
      process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, PROVIDERS.WHOOP, 25
    );
    summary.whoop.connected = whoopUserIds.length;
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    for (const whoopUserId of whoopUserIds) {
      summary.whoop.attempted += 1;
      let result;
      try {
        result = await syncWhoopUser(whoopUserId);
      } catch (e) {
        result = { status: "failed", message: `Hourly Whoop sync failed: ${e?.message || "error"}`.slice(0, 300), counts: {} };
      }
      if (result.status === "success") summary.whoop.success += 1;
      else if (result.status === "partial") summary.whoop.partial += 1;
      else summary.whoop.failed += 1;
      // Reuse whoop-auth's logSyncEvent so the scheduled event matches the manual
      // sync shape exactly (event_type "sync", counts, days) — never a token/payload.
      await logSyncEvent(url, key, {
        userId: whoopUserId, source: "whoop", eventType: "sync",
        status: result.status, counts: result.counts, message: result.message, days: WHOOP_SYNC_DAYS,
      });
    }
  } catch (e) {
    summary.ok = false;
    summary.whoop.error = e?.message || String(e);
  }

  return json(summary, summary.ok ? 200 : 207);
};
