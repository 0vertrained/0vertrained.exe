// src/oura/normalization.js
// ─────────────────────────────────────────────────────────────────────────────
// Oura Data Normalization
//
// Converts raw Oura API responses to internal schema and provides payload helpers.
//
// V16.6 · Main-sleep discipline. Real-data root cause behind the "recovery 37
// on an ordinary morning" class of reports (V16.5.1 floored the SD but the
// deviation was REAL — relative to the wrong reference): Oura keys naps to the
// calendar day they occur on, so an afternoon `late_nap` synced before tonight's
// main sleep becomes the newest day's ONLY sleep doc. The engine then scored
// nap HRV/RHR (physiologically lower HRV, higher RHR — that's what naps are)
// against a main-sleep baseline: on the reporting user's own export, HRV 39 vs
// a ~71 ms baseline read z=−2.54 and RHR 68 vs 57.9 read z=+2.98 → 37/100,
// while the last real night scored 87. The fix is at the source of truth:
// `getSleepDoc` (which every scoring, alert, debt, and display path anchors on)
// now returns MAIN sleep only, so a nap can never be a day's recovery signal
// and nap-only days drop out of `recoveryDates` unless readiness reported.
// Naps stay readable via `getAnySleepDoc` for display surfaces that want them.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalize Oura sleep data to internal schema.
 * V16.6 · Accepts the stored V2 shape ({ data: [...] }) in addition to the
 * legacy { sleep: [...] } draft shape, prefers the main sleep document, and
 * maps the V2 field names (`efficiency` is already 0–100, `latency`,
 * `average_hrv`, embedded `readiness.temperature_deviation`).
 */
export function normalizeSleep(ouraSleep) {
  const sleep = mainSleepFromPayload(ouraSleep) || firstDoc(ouraSleep);
  if (!sleep) return null;

  const efficiencyRaw = sleep.efficiency ?? sleep.sleep_efficiency;
  const efficiencyPct = efficiencyRaw == null ? null
    : Number(efficiencyRaw) <= 1 ? Number(efficiencyRaw) * 100 : Number(efficiencyRaw);

  return {
    date: sleep.day || sleep.date,
    duration_min: finiteNum(sleep.total_sleep_duration) !== null ? sleep.total_sleep_duration / 60 : null,
    efficiency_pct: finiteNum(efficiencyPct),
    deep_min: finiteNum(sleep.deep_sleep_duration) !== null ? sleep.deep_sleep_duration / 60 : null,
    rem_min: finiteNum(sleep.rem_sleep_duration) !== null ? sleep.rem_sleep_duration / 60 : null,
    light_min: finiteNum(sleep.light_sleep_duration) !== null ? sleep.light_sleep_duration / 60 : null,
    awake_min: finiteNum(sleep.awake_time) !== null ? sleep.awake_time / 60 : null,
    latency_min: finiteNum(sleep.latency ?? sleep.sleep_latency) !== null ? (sleep.latency ?? sleep.sleep_latency) / 60 : null,
    hr_lowest: finiteNum(sleep.lowest_heart_rate),
    hr_average: finiteNum(sleep.average_heart_rate),
    hrv_rmssd: finiteNum(hrvRmssd(sleep)),
    temperature_deviation: finiteNum(
      sleep.skin_temperature_deviation ?? sleep.readiness?.temperature_deviation
    ),
    bedtime: sleep.bedtime_start,
    waketime: sleep.bedtime_end,
  };
}

/**
 * Normalize Oura readiness data (accepts { data: [...] } and legacy shapes).
 */
export function normalizeReadiness(ouraReadiness) {
  const r = firstDoc(ouraReadiness);
  if (!r) return null;
  return {
    date: r.day || r.date,
    score: finiteNum(r.score),
    temperature_deviation: finiteNum(r.temperature_deviation),
    temperature_trend_deviation: finiteNum(r.temperature_trend_deviation),
    respiratory_rate: finiteNum(r.respiratory_rate),
  };
}

/**
 * Normalize Oura activity data.
 * V16.6 · This previously required the legacy { activity: [...] } wrapper and
 * read draft-era field names, so the stored V2 payload ({ data: [{
 * equivalent_walking_distance, active_calories, ... }] }) ALWAYS normalized to
 * null — the Oura load-fill rung in wearableWorkoutLoad was dead code. Now
 * unwraps every stored shape and exposes both the V2 names and the camelCase
 * keys the load model reads.
 */
export function normalizeActivity(ouraActivity) {
  const a = firstDoc(ouraActivity);
  if (!a) return null;
  const meters = finiteNum(a.equivalent_walking_distance ?? a.walking_distance ?? a.distance);
  const activeCalories = finiteNum(a.active_calories);
  const totalCalories = finiteNum(a.total_calories);
  return {
    date: a.day || a.date,
    score: finiteNum(a.score),
    // Legacy keys (kept for any existing consumer of the old shape)
    active_calories: activeCalories,
    total_calories: totalCalories,
    walking_distance: meters,
    steps: finiteNum(a.steps),
    // Canonical keys read by wearableWorkoutLoad's ouraLoadForDay. `calories`
    // deliberately maps to ACTIVE calories: the load fill multiplies by 0.8,
    // and total_calories includes BMR (~2,300+ kcal of it), which would
    // manufacture a huge training load out of simply being alive.
    activeCalories,
    calories: activeCalories,
    meters,
  };
}

/**
 * Normalize Oura heart rate data
 */
export function normalizeHeartRate(ouraHR) {
  if (!ouraHR || !ouraHR.heartrate?.length) return [];

  return ouraHR.heartrate.map(hr => ({
    timestamp: hr.timestamp,
    bpm: hr.bpm,
  }));
}

/**
 * Normalize Oura SpO2 data (accepts { data: [...] } and legacy shapes).
 */
export function normalizeSpO2(ouraSpO2) {
  const doc = firstDoc(ouraSpO2);
  if (!doc) return null;
  return {
    date: doc.day || doc.date,
    average_pct: finiteNum(doc.spo2_percentage?.average ?? doc.average),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal payload helpers
// ─────────────────────────────────────────────────────────────────────────────

// Oura V2 payload helpers. The sync endpoint stores raw responses like
// { data: [{ ...daily_sleep_document }] }, while older draft code expected
// { sleep: [{ ... }] }. These helpers support both shapes.
export function firstDoc(payload) {
  if (!payload) return null;
  if (Array.isArray(payload)) return payload[0] || null;
  if (Array.isArray(payload.data)) return payload.data[0] || null;
  if (Array.isArray(payload.sleep)) return payload.sleep[0] || null;
  if (Array.isArray(payload.readiness)) return payload.readiness[0] || null;
  if (Array.isArray(payload.activity)) return payload.activity[0] || null;
  return payload;
}

function docsFromPayload(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload.filter(Boolean);
  if (Array.isArray(payload.data)) return payload.data.filter(Boolean);
  if (Array.isArray(payload.sleep)) return payload.sleep.filter(Boolean);
  const doc = firstDoc(payload);
  return doc ? [doc] : [];
}

function finiteNum(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ─── V16.6 · Main-sleep classification ──────────────────────────────────────
// Oura V2 `type` values observed in the wild: long_sleep (the main sleep),
// sleep (short detected segments, often minutes), late_nap / nap, rest,
// deleted. Naps and short segments carry physiologically DIFFERENT HRV/RHR
// than a night of sleep, so they must never stand in for a night in baselines
// or day scoring. Older/demo payloads without a `type` are classified by
// duration: ≥ 3h counts as a main sleep.
const MAIN_SLEEP_TYPE = /long|main/i;
const NON_MAIN_SLEEP_TYPE = /nap|rest|deleted/i;
const MAIN_SLEEP_MIN_SECONDS = 3 * 3600;

export function isMainSleepDoc(doc) {
  if (!doc || typeof doc !== "object") return false;
  const type = doc.type ?? doc.sleep_type ?? null;
  if (type != null && String(type).trim() !== "") {
    if (MAIN_SLEEP_TYPE.test(String(type))) return true;
    if (NON_MAIN_SLEEP_TYPE.test(String(type))) return false;
    // Unknown labelled type (e.g. plain "sleep" segments): fall through to the
    // duration heuristic so a mislabelled full night is not discarded.
  }
  const duration = finiteNum(doc.total_sleep_duration ?? doc.total_sleep_time);
  // Untyped AND durationless: a partial/legacy record, not a nap — every real
  // nap shape observed carries `type: late_nap`/`nap` or a short duration.
  // Rejecting these would blank legitimate biometric-only docs.
  if (duration === null) return true;
  return duration >= MAIN_SLEEP_MIN_SECONDS;
}

function sleepDocRank(doc) {
  if (!doc) return -Infinity;
  const duration = finiteNum(doc.total_sleep_duration ?? doc.total_sleep_time) || 0;
  const score = finiteNum(doc.score) || 0;
  const hasHrv = finiteNum(hrvRmssd(doc)) !== null ? 1 : 0;
  const hasRhr = finiteNum(rhrValue(doc)) !== null ? 1 : 0;
  const typeBonus = MAIN_SLEEP_TYPE.test(String(doc.type || doc.sleep_phase || "")) ? 50_000 : 0;
  // Duration dominates: a 7h long sleep should beat a high-scored nap/segment.
  return typeBonus + duration + score * 100 + hasHrv * 500 + hasRhr * 500;
}

function mainSleepDocs(day) {
  return docsFromPayload(day?.sleep).filter(isMainSleepDoc);
}

function mainSleepFromPayload(payload) {
  const docs = docsFromPayload(payload).filter(isMainSleepDoc);
  if (!docs.length) return null;
  return docs.slice().sort((a, b) => sleepDocRank(b) - sleepDocRank(a))[0] || null;
}

/**
 * The day's MAIN sleep document (primary segment when a night was split), or
 * null when the day carries only naps/short segments. This is the anchor for
 * every recovery-signal consumer: scoring pools, alerts, sleep debt, raw
 * metric display. Naps are intentionally invisible here — see module header.
 */
export function getSleepDoc(day) {
  const docs = mainSleepDocs(day);
  if (!docs.length) return null;
  return docs.slice().sort((a, b) => sleepDocRank(b) - sleepDocRank(a))[0] || null;
}

/**
 * Any sleep document for the day, naps included — display-only surfaces that
 * want to acknowledge a nap can read this. Never use for baselines or scoring.
 */
export function getAnySleepDoc(day) {
  const docs = docsFromPayload(day?.sleep);
  if (!docs.length) return null;
  return docs.slice().sort((a, b) => sleepDocRank(b) - sleepDocRank(a))[0] || null;
}

/**
 * Total MAIN sleep seconds for the day across split-night segments. Oura can
 * record a fragmented night as two `long_sleep` documents (the reporting
 * user's own export carries a 6.5h + 4.3h split); picking only the primary
 * segment under-counted the night by hours in the duration subscore and the
 * sleep-debt ledger. HRV/RHR/staging still read from the primary segment via
 * getSleepDoc — only duration sums.
 */
export function mainSleepDurationSeconds(day) {
  const docs = mainSleepDocs(day);
  if (!docs.length) return null;
  let total = 0;
  for (const d of docs) {
    const s = finiteNum(d.total_sleep_duration ?? d.total_sleep_time);
    if (s !== null && s > 0) total += s;
  }
  return total > 0 ? total : null;
}

// V16.9 · Nap minutes for DURATION accounting (sleep debt) only. Naps repay
// sleep need — both wearables credit them (Whoop's need carries an explicit
// nap deduction; Oura counts all sleep in daily totals) — but they stay
// excluded from HRV/RHR physiology baselines, where the V16.6 main-sleep
// discipline is about signal comparability, not hours. Deleted docs and the
// main-sleep segments themselves never count here.
export function napSleepDurationSeconds(day) {
  const docs = docsFromPayload(day?.sleep).filter(
    (d) => !isMainSleepDoc(d) && String(d?.type || "") !== "deleted"
  );
  let total = 0;
  for (const d of docs) {
    const s = finiteNum(d.total_sleep_duration ?? d.total_sleep_time);
    if (s !== null && s > 0) total += s;
  }
  return total;
}

export function getReadinessDoc(day) {
  return firstDoc(day?.readiness);
}

export function readinessContributor(day, key) {
  const readiness = getReadinessDoc(day);
  const value = readiness?.contributors?.[key];
  if (value === null || value === undefined || value === "") return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

export function latestDay(ouraData) {
  return Object.keys(ouraData || {}).sort().reverse()[0];
}

// Dates that carry usable recovery signal (a MAIN sleep and/or readiness
// document), newest first. Oura frequently syncs a newest calendar date that
// is heartrate-only or (V16.6) NAP-only before tonight's main sleep exists;
// scoring off that date collapses recovery. These helpers are the canonical
// way to pick the day to score.
export function recoveryDates(ouraData) {
  return Object.keys(ouraData || {})
    .filter((date) => getSleepDoc(ouraData[date]) || getReadinessDoc(ouraData[date]))
    .sort()
    .reverse();
}

export function latestRecoveryDay(ouraData) {
  return recoveryDates(ouraData)[0] || latestDay(ouraData);
}

function averageFinite(values) {
  const nums = (Array.isArray(values) ? values : [])
    .filter((v) => v !== null && v !== undefined)
    .map(Number)
    .filter(Number.isFinite);
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

// Returns { value, source } so callers can transparently label where an HRV
// number came from. source: "raw sleep average HRV" | "raw sleep HRV" | "hrv.items average" | null.
export function hrvRmssdWithSource(sleep) {
  const direct = sleep?.average_hrv
    ?? sleep?.heart_rate_variability?.average
    ?? sleep?.heart_rate_variability?.rmssd
    ?? sleep?.hrv?.rmssd
    ?? sleep?.hrv_rmssd
    ?? null;
  if (direct !== null && direct !== undefined && Number.isFinite(Number(direct))) {
    return { value: Number(direct), source: sleep?.average_hrv !== undefined ? "raw sleep average HRV" : "raw sleep HRV" };
  }
  // Oura V2 sleep can provide 5-minute RMSSD samples as hrv.items when the
  // nightly aggregate is absent. Prefer Oura's `average_hrv` when present because
  // it is the documented sleep-summary field and matches the app's nightly HRV;
  // item averaging is only a fallback for older/partial payloads.
  const itemsAvg = averageFinite(sleep?.hrv?.items);
  if (itemsAvg !== null) return { value: itemsAvg, source: "hrv.items average" };
  return { value: null, source: null };
}

export function hrvRmssd(sleep) {
  return hrvRmssdWithSource(sleep).value;
}

export function rhrValue(sleep) {
  return sleep?.lowest_heart_rate
    ?? sleep?.heart_rate?.lowest
    ?? sleep?.heart_rate?.average
    ?? sleep?.average_heart_rate
    ?? null;
}

export function tempDeviation(sleep, readiness) {
  // V16.6 · V2 sleep documents no longer carry a top-level skin-temperature
  // field, but every sleep doc embeds a `readiness` block whose
  // temperature_deviation matches the standalone readiness document. Reading
  // it here means a day whose standalone readiness has not synced yet can
  // still report temperature instead of being scored on yesterday's value.
  return sleep?.temperature?.deviation
    ?? sleep?.skin_temperature_deviation
    ?? readiness?.temperature_deviation
    ?? readiness?.temperature?.deviation
    ?? sleep?.readiness?.temperature_deviation
    ?? null;
}
