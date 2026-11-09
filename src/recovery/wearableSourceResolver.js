// src/recovery/wearableSourceResolver.js
// Wearable Source Resolver
//
// Pure, side-effect-free per-metric source arbitration for the case where BOTH
// Oura and Whoop are connected (and manual check-in is always available). This
// module never recomputes the recovery SCORE — the canonical 0VERTRAINED recovery
// algorithm (calcRecoveryScore over Oura components) stays exactly where it is in
// RecoveryDashboard. Instead the resolver answers a narrower question: for each
// individual metric, which connected source should we read from, what value does
// it give, and how confident are we?
//
// Design rules (hard-coded, not user-configurable yet):
//   • NEVER average Oura and Whoop values. Per-metric source PREFERENCE only.
//   • Manual check-in ("feel") is always first-class and is never overridden.
//   • Every resolved value carries a `source` label and a `confidence` level.
//   • Confidence downgrades when a fallback source is used or when the two
//     wearables disagree (a "conflict") for that metric.
//   • Everything is defensive against null / missing / partial data. No function
//     throws on missing inputs. No network, no Supabase, no side effects.
//
// Source preference table (primary → fallback):
//   sleep duration   Oura  → Whoop → Manual      (Oura sleep staging is validated)
//   sleep quality    Oura  → Whoop
//   HRV (rmssd)      Oura  → Whoop
//   resting HR       Oura  → Whoop
//   body temp        Oura  → (—, Whoop has none)
//   recovery score   Oura  → Whoop (context only, never averaged)
//   training strain  Whoop → Oura activity        (Whoop strain is training-specific)
//   workouts         App log (authoritative) — Whoop supplementary, never auto-complete
//   respiratory rate Whoop → Oura                 (Whoop measures directly)
//   SpO₂             Whoop → Oura                 (Whoop measures directly)
//   subjective/feel  Manual (always first-class)

import {
  getSleepDoc,
  getReadinessDoc,
  firstDoc,
  hrvRmssdWithSource,
  rhrValue,
  tempDeviation,
  latestRecoveryDay,
} from "../oura/normalization";
import {
  normalizeRecovery,
  normalizeSleep,
  normalizeCycle,
  normalizeWorkout,
  latestWhoopDate,
} from "../whoop/normalization";
import { PROVIDERS } from "../integrations/providerRegistry";
import { parseManualRecovery } from "../manualRecovery";
import { trimmedMean } from "../oura/statistics";

// ── Small pure utilities ─────────────────────────────────────────────────────

const CONFIDENCE = { HIGH: "high", MEDIUM: "medium", LOW: "low" };

function finite(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// One-step confidence downgrade (high → medium → low). low stays low.
function downgrade(level) {
  if (level === CONFIDENCE.HIGH) return CONFIDENCE.MEDIUM;
  if (level === CONFIDENCE.MEDIUM) return CONFIDENCE.LOW;
  return CONFIDENCE.LOW;
}

// A value counts as "present" when it is a finite number, a non-empty array, or a
// non-empty plain object. null/undefined/NaN/empty are absent.
function hasValue(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === "number") return Number.isFinite(v);
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return true;
}

// ── Per-source, per-date extraction into a flat "reading" bag ─────────────────

// Extract the Oura metrics we care about for a single calendar date. Uses the
// existing Oura normalization helpers so payload-shape handling stays in one place.
// Note: recovery here is the Oura-native readiness score (0-100) used purely as
// the resolver's representative Oura recovery reading for source arbitration and
// conflict detection. The canonical 0VERTRAINED recovery score is computed by
// calcRecoveryScore elsewhere and is intentionally NOT recomputed here.
function extractOuraDay(ouraData, date) {
  const day = date ? ouraData?.[date] : null;
  if (!day) return null;
  const sleepDoc = getSleepDoc(day);
  const readinessDoc = getReadinessDoc(day);
  const activityDoc = firstDoc(day.activity);
  const spo2Doc = firstDoc(day.spo2 ?? day.daily_spo2);

  const sleepSeconds = finite(sleepDoc?.total_sleep_duration ?? sleepDoc?.total_sleep_time);
  const spo2Avg = finite(spo2Doc?.average ?? spo2Doc?.spo2_percentage?.average);

  return {
    sleepMin: sleepSeconds !== null ? sleepSeconds / 60 : null,
    sleepScore: finite(sleepDoc?.score),
    hrv: finite(hrvRmssdWithSource(sleepDoc).value),
    rhr: finite(rhrValue(sleepDoc)),
    temp: finite(tempDeviation(sleepDoc, readinessDoc)),
    recovery: finite(readinessDoc?.score),
    strain: finite(activityDoc?.score),
    respiratoryRate: finite(readinessDoc?.respiratory_rate ?? sleepDoc?.respiratory_rate),
    spo2: spo2Avg,
    hasRecoverySignal: Boolean(sleepDoc || readinessDoc),
  };
}

// Extract the Whoop metrics for a single calendar date via the display-only
// normalizers. Workouts collapse to an array (supplementary suggestions only).
function extractWhoopDay(whoopData, date) {
  const day = date ? whoopData?.[date] : null;
  if (!day) return null;
  const recovery = normalizeRecovery(day.recovery);
  const sleep = normalizeSleep(day.sleep);
  const cycle = normalizeCycle(day.cycle);
  const rawWorkouts = Array.isArray(day.workout) ? day.workout : day.workout ? [day.workout] : [];
  const workouts = rawWorkouts.map(normalizeWorkout).filter(Boolean);

  return {
    sleepMin: finite(sleep?.asleepMin),
    sleepScore: finite(sleep?.performancePct),
    hrv: finite(recovery?.hrvRmssd),
    rhr: finite(recovery?.rhr),
    recovery: finite(recovery?.recoveryScore),
    strain: finite(cycle?.strain),
    respiratoryRate: finite(sleep?.respiratoryRate),
    spo2: finite(recovery?.spo2),
    workouts,
  };
}

// Normalize whatever manual shape we were handed (raw body OR already parsed).
function extractManual(manualData) {
  if (!manualData || typeof manualData !== "object") return null;
  const parsed = Array.isArray(manualData?.present) || manualData.present
    ? manualData
    : parseManualRecovery(manualData);
  const subjectiveFields = {};
  ["energy", "motivation", "soreness", "stress", "sleepQuality", "illnessOrInjury"].forEach((k) => {
    if (parsed[k] !== null && parsed[k] !== undefined) subjectiveFields[k] = parsed[k];
  });
  const sleepHours = finite(parsed.sleep);
  return {
    sleepMin: sleepHours !== null ? sleepHours * 60 : null,
    rhr: finite(parsed.restingHeartRate),
    hrv: finite(parsed.hrv),
    subjective: Object.keys(subjectiveFields).length ? subjectiveFields : null,
  };
}

// ── Metric → source-preference ordering ──────────────────────────────────────

const METRIC_ORDER = {
  sleep: [PROVIDERS.OURA, PROVIDERS.WHOOP, PROVIDERS.MANUAL],
  sleepQuality: [PROVIDERS.OURA, PROVIDERS.WHOOP],
  hrv: [PROVIDERS.OURA, PROVIDERS.WHOOP],
  rhr: [PROVIDERS.OURA, PROVIDERS.WHOOP],
  temp: [PROVIDERS.OURA],
  recovery: [PROVIDERS.OURA, PROVIDERS.WHOOP],
  strain: [PROVIDERS.WHOOP, PROVIDERS.OURA],
  respiratoryRate: [PROVIDERS.WHOOP, PROVIDERS.OURA],
  spo2: [PROVIDERS.WHOOP, PROVIDERS.OURA],
  subjective: [PROVIDERS.MANUAL],
  // workouts handled specially (app log authoritative). Strava remains an
  // activity import/suggestion provider and does not auto-complete app logs.
};

// Map (source, metric) → the extracted reading value from that source's bag.
function readFromSource(source, metric, bags) {
  const bag = source === PROVIDERS.OURA ? bags.oura : source === PROVIDERS.WHOOP ? bags.whoop : source === PROVIDERS.MANUAL ? bags.manual : null;
  if (!bag) return null;
  switch (metric) {
    case "sleep":
      return bag.sleepMin ?? null;
    case "sleepQuality":
      return bag.sleepScore ?? null;
    case "hrv":
      return bag.hrv ?? null;
    case "rhr":
      return bag.rhr ?? null;
    case "temp":
      return bag.temp ?? null;
    case "recovery":
      return bag.recovery ?? null;
    case "strain":
      return bag.strain ?? null;
    case "respiratoryRate":
      return bag.respiratoryRate ?? null;
    case "spo2":
      return bag.spo2 ?? null;
    case "subjective":
      return bag.subjective ?? null;
    default:
      return null;
  }
}

function buildBags({ ouraData, whoopData, manualData, date } = {}) {
  return {
    oura: extractOuraDay(ouraData, date),
    whoop: extractWhoopDay(whoopData, date),
    manual: extractManual(manualData),
  };
}

const EMPTY_RESOLUTION = { value: null, source: null, confidence: null, fallbackUsed: false };

/**
 * Resolve a single metric to its best available value + source info.
 * @param {string} metricName - one of the keys in METRIC_ORDER, or "workouts".
 * @param {{ouraData, whoopData, manualData, date}} data
 * @returns {{value, source, confidence, fallbackUsed}}
 */
export function resolveMetric(metricName, data = {}) {
  const bags = buildBags(data);

  // Workouts: the app training log is always authoritative and is never
  // auto-completed from a wearable. Whoop workouts ride along as suggestions only.
  if (metricName === "workouts") {
    const suggestions = bags.whoop?.workouts || [];
    return {
      value: null,
      source: "app_log",
      confidence: CONFIDENCE.HIGH,
      fallbackUsed: false,
      suggestions,
      autoComplete: false,
    };
  }

  const order = METRIC_ORDER[metricName];
  if (!order) return { ...EMPTY_RESOLUTION };

  for (let i = 0; i < order.length; i += 1) {
    const source = order[i];
    const value = readFromSource(source, metricName, bags);
    if (hasValue(value)) {
      const fallbackUsed = i > 0;
      // Manual subjective is first-class — always high confidence, never a fallback.
      const confidence = source === PROVIDERS.MANUAL && metricName === "subjective"
        ? CONFIDENCE.HIGH
        : fallbackUsed ? CONFIDENCE.MEDIUM : CONFIDENCE.HIGH;
      return { value, source, confidence, fallbackUsed };
    }
  }
  return { ...EMPTY_RESOLUTION };
}

// ── Conflict detection ────────────────────────────────────────────────────────

// Per-metric detection thresholds. `minor` is the disagreement magnitude that
// counts as a conflict at all; `major` promotes it to a conservative-action level.
// `pct` marks percentage-based comparison (HRV) rather than absolute units.
const CONFLICT_RULES = {
  recovery: { minor: 15, major: 30, pct: false, unit: "pts" },
  hrv: { minor: 15, major: 30, pct: true, unit: "%" },
  rhr: { minor: 5, major: 10, pct: false, unit: "bpm" },
  sleep: { minor: 60, major: 120, pct: false, unit: "min" },
};

function magnitudeFor(rule, ouraValue, whoopValue) {
  const diff = Math.abs(ouraValue - whoopValue);
  if (!rule.pct) return diff;
  const avg = (Math.abs(ouraValue) + Math.abs(whoopValue)) / 2;
  return avg > 0 ? (diff / avg) * 100 : 0;
}

// ── Baseline-relative comparison for HRV and RHR ────────────────────
// The doctrine ("devices carry systematic offsets; z-scores are computed
// against the SAME device's own history") stopped at the scoring engine — the
// conflict detector still compared raw cross-device values. On the reporting
// user's export, Whoop's resting HR reads +5.8 bpm above Oura's lowest-HR
// EVERY day (a definitional difference, not a disagreement), so the 5 bpm
// absolute rule fired a "minor RHR conflict" on essentially every dual-device
// morning — a standing false alarm that also degraded metric confidence.
// HRV and RHR now compare each device's DEVIATION FROM ITS OWN baseline
// (leave-one-out trimmed mean over up to 14 prior days, matching the engine);
// a conflict means the devices disagree about how today differs from normal,
// which is the question that matters. Falls back to the raw comparison when
// either device lacks 4 baseline days. Recovery and sleep stay absolute —
// both are same-scale quantities where raw disagreement is the signal.
const BASELINE_MIN_SAMPLES = 4;

function ouraMetricBaseline(ouraData, date, metric) {
  const dates = Object.keys(ouraData || {}).filter((d) => d !== date).sort().reverse();
  const values = [];
  for (const d of dates) {
    const doc = getSleepDoc(ouraData[d]);
    const v = metric === "hrv" ? finite(hrvRmssdWithSource(doc).value) : finite(rhrValue(doc));
    if (v !== null && v > 0) values.push(v);
    if (values.length >= 14) break;
  }
  return values.length >= BASELINE_MIN_SAMPLES ? trimmedMean(values, 0.1) : null;
}

function whoopMetricBaseline(whoopData, date, metric) {
  const dates = Object.keys(whoopData || {}).filter((d) => d !== date).sort().reverse();
  const values = [];
  for (const d of dates) {
    const score = whoopData?.[d]?.recovery?.score;
    const v = metric === "hrv" ? finite(score?.hrv_rmssd_milli) : finite(score?.resting_heart_rate);
    if (v !== null && v > 0) values.push(v);
    if (values.length >= 14) break;
  }
  return values.length >= BASELINE_MIN_SAMPLES ? trimmedMean(values, 0.1) : null;
}

/**
 * Detect per-metric disagreements between Oura and Whoop for the same date.
 * A conflict requires BOTH sources to have data AND to disagree beyond the
 * metric's minor threshold. HRV/RHR compare baseline-relative deviations when
 * both devices carry enough history (conflict.mode === "baseline-relative");
 * raw values otherwise (mode === "absolute"). ouraValue/whoopValue always
 * carry the RAW readings for display.
 * @returns {Array<{metric, ouraValue, whoopValue, threshold, magnitude, severity, mode}>}
 */
export function detectConflicts({ ouraData, whoopData, date } = {}) {
  const oura = extractOuraDay(ouraData, date);
  const whoop = extractWhoopDay(whoopData, date);
  if (!oura || !whoop) return [];

  const conflicts = [];
  for (const metric of Object.keys(CONFLICT_RULES)) {
    // For the "sleep" conflict we compare sleep DURATION (sleepMin).
    const ouraValue = metric === "sleep" ? oura.sleepMin : oura[metric];
    const whoopValue = metric === "sleep" ? whoop.sleepMin : whoop[metric];
    if (!Number.isFinite(ouraValue) || !Number.isFinite(whoopValue)) continue;

    const rule = CONFLICT_RULES[metric];
    let magnitude;
    let mode = "absolute";
    let ouraDeviation = null;
    let whoopDeviation = null;
    if (metric === "hrv" || metric === "rhr") {
      const oBase = ouraMetricBaseline(ouraData, date, metric);
      const wBase = whoopMetricBaseline(whoopData, date, metric);
      if (oBase !== null && wBase !== null) {
        mode = "baseline-relative";
        if (rule.pct) {
          ouraDeviation = ((ouraValue - oBase) / oBase) * 100;
          whoopDeviation = ((whoopValue - wBase) / wBase) * 100;
        } else {
          ouraDeviation = ouraValue - oBase;
          whoopDeviation = whoopValue - wBase;
        }
        magnitude = Math.abs(ouraDeviation - whoopDeviation);
      }
    }
    if (mode === "absolute") {
      magnitude = magnitudeFor(rule, ouraValue, whoopValue);
    }
    if (magnitude >= rule.minor) {
      conflicts.push({
        metric,
        ouraValue: Math.round(ouraValue * 100) / 100,
        whoopValue: Math.round(whoopValue * 100) / 100,
        ...(mode === "baseline-relative" ? {
          ouraDeviation: Math.round(ouraDeviation * 100) / 100,
          whoopDeviation: Math.round(whoopDeviation * 100) / 100,
        } : {}),
        threshold: rule.minor,
        magnitude: Math.round(magnitude * 100) / 100,
        unit: rule.unit,
        severity: magnitude >= rule.major ? "major" : "minor",
        mode,
      });
    }
  }
  return conflicts;
}

/**
 * Recommend an action given a conflict list.
 *  - no conflicts   → use_primary
 *  - only minor      → flag (surface a "mixed signal" note, keep primary values)
 *  - any major       → conservative (bias the recommendation toward caution)
 * @returns {{action, message, conflicts}}
 */
export function resolveConflictAction(conflicts) {
  const list = Array.isArray(conflicts) ? conflicts : [];
  if (!list.length) {
    return {
      action: "use_primary",
      message: "Sources agree — using primary per-metric preferences.",
      conflicts: [],
    };
  }
  const hasMajor = list.some((c) => c?.severity === "major");
  if (hasMajor) {
    return {
      action: "conservative",
      message: "Mixed signal day — wearables disagree materially. Using the conservative read.",
      conflicts: list,
    };
  }
  return {
    action: "flag",
    message: "Minor wearable disagreement — flagged for awareness; primary values kept.",
    conflicts: list,
  };
}

// ── Full context assembly ─────────────────────────────────────────────────────

const CONTEXT_METRICS = [
  "sleep",
  "sleepQuality",
  "hrv",
  "rhr",
  "temp",
  "recovery",
  "strain",
  "workouts",
  "respiratoryRate",
  "spo2",
  "subjective",
];

// Which resolved metric key a conflict on `metric` should downgrade.
const CONFLICT_TO_METRIC = { recovery: "recovery", hrv: "hrv", rhr: "rhr", sleep: "sleep" };

/**
 * Resolve every metric for a date into a unified recovery context, apply
 * conflict-driven confidence downgrades, and attach the source map + conflicts.
 * @returns {{sleep, sleepQuality, hrv, rhr, temp, recovery, strain, workouts,
 *   respiratoryRate, spo2, subjective, sources, conflicts, conflictAction, date}}
 */
export function resolveRecoveryContext({ ouraData, whoopData, manualData, date, settings } = {}) {
  void settings; // reserved for future per-user source overrides
  const resolvedDate = date
    || latestRecoveryDay(ouraData)
    || latestWhoopDate(whoopData)
    || null;

  const data = { ouraData, whoopData, manualData, date: resolvedDate };

  const context = {};
  for (const metric of CONTEXT_METRICS) {
    context[metric] = resolveMetric(metric, data);
  }

  const conflicts = detectConflicts({ ouraData, whoopData, date: resolvedDate });

  // Downgrade confidence on any metric that is in conflict (manual is exempt —
  // it is never overridden and carries its own first-class confidence).
  for (const conflict of conflicts) {
    const key = CONFLICT_TO_METRIC[conflict.metric];
    if (key && context[key] && context[key].source && context[key].source !== "manual") {
      context[key] = { ...context[key], confidence: downgrade(context[key].confidence), conflict: true };
    }
  }

  context.date = resolvedDate;
  context.conflicts = conflicts;
  context.conflictAction = resolveConflictAction(conflicts);
  context.sources = buildSourceMap(context);
  return context;
}

/**
 * Build a flat { metric: sourceLabel } map from a resolved context.
 * @returns {Object<string,string|null>}
 */
export function buildSourceMap(resolvedContext) {
  const map = {};
  if (!resolvedContext || typeof resolvedContext !== "object") return map;
  for (const metric of CONTEXT_METRICS) {
    const resolved = resolvedContext[metric];
    map[metric] = resolved && resolved.source ? resolved.source : null;
  }
  return map;
}

export default {
  resolveMetric,
  resolveRecoveryContext,
  detectConflicts,
  buildSourceMap,
  resolveConflictAction,
};
