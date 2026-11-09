// src/recovery/wearableProgressContext.js
// Wearable Progress Context
//
// Pure, side-effect-free source-aware trend notes for the Progress / weekly
// review surfaces. It reads the SAME per-metric source arbitration the recovery
// resolver uses (resolveMetric) so a note always states which wearable a trend
// came from — "HRV trending up (Oura, 14d)" — and never averages sources.
//
// Hard rules:
//   • Never fabricate a trend. A trend requires ≥2 data points in the window;
//     otherwise the note explicitly says "not enough data".
//   • Every note carries a source label for HRV, RHR, sleep, and strain when
//     that metric resolves to a source.
//   • No recovery-score recomputation, no averaging Oura + Whoop.
//   • Null-safe: empty/partial/missing inputs never throw and never emit NaN.
//   • No network, no Supabase, no logging of raw biometric payloads.

import { resolveMetric } from "./wearableSourceResolver";

const SOURCE_DISPLAY = {
  oura: "Oura",
  whoop: "Whoop",
  manual: "Manual",
  app_log: "App log",
};

// Per-metric trend framing. `label` is display copy; `stableDelta` is the
// magnitude below which a change reads as "holding steady"; `betterWhenUp`
// tags direction so copy can stay conservative and non-diagnostic.
const METRICS = [
  { key: "hrv", label: "HRV", stableDelta: 4, betterWhenUp: true, unit: "" },
  { key: "rhr", label: "Resting HR", stableDelta: 2, betterWhenUp: false, unit: " bpm" },
  { key: "sleep", label: "Sleep", stableDelta: 20, betterWhenUp: true, unit: " min" },
  { key: "strain", label: "Strain", stableDelta: 1.5, betterWhenUp: null, unit: "" },
];

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round1(v) {
  const n = num(v);
  return n === null ? null : Math.round(n * 10) / 10;
}

// Build the descending list of date keys for the window ending at `endDate`
// (inclusive). Uses only the keys present across the supplied data maps so no
// date arithmetic is required (keeps the module clock-free and deterministic).
function windowDates({ ouraData, whoopData, days, endDate }) {
  const keys = new Set();
  for (const map of [ouraData, whoopData]) {
    if (map && typeof map === "object") Object.keys(map).forEach((k) => keys.add(k));
  }
  let sorted = [...keys].filter(Boolean).sort(); // ascending YYYY-MM-DD
  if (endDate) sorted = sorted.filter((k) => k <= endDate);
  const n = Math.max(1, num(days) || 30);
  return sorted.slice(-n);
}

// Collect a dated series for one metric across the window using the resolver's
// per-metric source preference. Returns { source, points: [{date, value}] }.
function collectSeries(metricKey, { ouraData, whoopData, manualData }, dates) {
  const points = [];
  const sourceCounts = {};
  for (const date of dates) {
    const res = resolveMetric(metricKey, { ouraData, whoopData, manualData, date });
    const value = num(res?.value);
    if (value === null) continue;
    points.push({ date, value });
    if (res.source) sourceCounts[res.source] = (sourceCounts[res.source] || 0) + 1;
  }
  // Dominant source across the window (ties resolve to the most recent point).
  let source = points.length ? null : null;
  let best = -1;
  for (const [src, count] of Object.entries(sourceCounts)) {
    if (count > best) {
      best = count;
      source = src;
    }
  }
  if (!source && points.length) {
    // Fallback: source of the newest point.
    const last = resolveMetric(metricKey, { ouraData, whoopData, manualData, date: points[points.length - 1].date });
    source = last?.source || null;
  }
  return { source, points };
}

// Classify a first-half vs second-half trend. Never fabricates: with <2 points
// the caller treats it as insufficient before calling this.
function classifyTrend(points, stableDelta) {
  const values = points.map((p) => p.value);
  const mid = Math.floor(values.length / 2);
  const firstHalf = values.slice(0, mid || 1);
  const secondHalf = values.slice(mid);
  const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const delta = avg(secondHalf) - avg(firstHalf);
  if (Math.abs(delta) < stableDelta) return { direction: "stable", delta };
  return { direction: delta > 0 ? "rising" : "falling", delta };
}

/**
 * Build source-aware trend notes for the Progress / weekly-review surface.
 *
 * @param {object} params
 * @param {object} params.ouraData - grouped Oura map (date → docs) or null.
 * @param {object} params.whoopData - grouped Whoop map (date → docs) or null.
 * @param {object} params.manualData - manual check-in body (optional; context only).
 * @param {number} [params.days=30] - window length in days (counted over present keys).
 * @param {string} [params.endDate] - inclusive upper bound date (YYYY-MM-DD), optional.
 * @returns {{available, days, hasEnoughData, notes: Array, summary, sources}}
 */
export function buildWearableTrendNotes({
  ouraData = null,
  whoopData = null,
  manualData = null,
  days = 30,
  endDate = null,
} = {}) {
  const dates = windowDates({ ouraData, whoopData, days, endDate });
  const hasAnyWearable =
    (ouraData && typeof ouraData === "object" && Object.keys(ouraData).length > 0) ||
    (whoopData && typeof whoopData === "object" && Object.keys(whoopData).length > 0);

  // No wearable data at all → a single honest "not enough data" note.
  if (!hasAnyWearable || !dates.length) {
    return {
      available: false,
      days: Math.max(1, num(days) || 30),
      hasEnoughData: false,
      notes: [
        {
          metric: "overview",
          label: "Wearable trends",
          source: null,
          sourceLabel: null,
          trend: "insufficient",
          points: 0,
          note: "Not enough wearable data yet — connect Oura or Whoop and log a few days to unlock source-aware trends.",
        },
      ],
      summary: "Not enough wearable data yet to trend.",
      sources: {},
    };
  }

  const notes = [];
  const sources = {};
  let enoughForAny = false;

  for (const metric of METRICS) {
    const { source, points } = collectSeries(metric.key, { ouraData, whoopData, manualData }, dates);
    const sourceLabel = source ? SOURCE_DISPLAY[source] || source : null;
    sources[metric.key] = source;

    // No source resolved this metric at all in the window.
    if (!points.length) {
      notes.push({
        metric: metric.key,
        label: metric.label,
        source: null,
        sourceLabel: null,
        trend: "insufficient",
        points: 0,
        note: `${metric.label} — no wearable data in the last ${dates.length} day${dates.length === 1 ? "" : "s"}.`,
      });
      continue;
    }

    // Present but <2 points → never fabricate a trend.
    if (points.length < 2) {
      notes.push({
        metric: metric.key,
        label: metric.label,
        source,
        sourceLabel,
        trend: "insufficient",
        points: points.length,
        latest: round1(points[points.length - 1].value),
        note: `${metric.label} — not enough data to trend yet (${sourceLabel}, 1 reading).`,
      });
      continue;
    }

    enoughForAny = true;
    const { direction } = classifyTrend(points, metric.stableDelta);
    const latest = round1(points[points.length - 1].value);
    const trendWord =
      direction === "stable" ? "holding steady" : direction === "rising" ? "trending up" : "trending down";
    notes.push({
      metric: metric.key,
      label: metric.label,
      source,
      sourceLabel,
      trend: direction,
      points: points.length,
      latest,
      note: `${metric.label} ${trendWord} (${sourceLabel}, ${points.length}d) · latest ${latest}${metric.unit}.`,
    });
  }

  const summary = enoughForAny
    ? "Source-aware trends below name the wearable each reading came from. Oura and Whoop are never averaged."
    : "Not enough wearable history to trend yet — keep logging.";

  return {
    available: true,
    days: dates.length,
    hasEnoughData: enoughForAny,
    notes,
    summary,
    sources,
  };
}

export default { buildWearableTrendNotes };
