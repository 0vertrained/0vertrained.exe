// src/runPaces.js
// ─────────────────────────────────────────────────────────────────────────────
// V19.3 · Training paces from a race result — pure math, no React, no clocks.
//
// Daniels & Gilbert oxygen-cost model (the formulas behind the VDOT tables):
//   VO2(v)      = −4.60 + 0.182258·v + 0.000104·v²          v = metres/min
//   %VO2max(t)  = 0.8 + 0.1894393·e^(−0.012778·t)
//                     + 0.2989558·e^(−0.1932605·t)          t = minutes
//   VDOT        = VO2(v) / %VO2max(t)
// Checked against the published tables: a 19:57 5K → 49.95, which predicts a
// 41:20 10K (table: 41:21) and a 6:51/mi threshold pace (table: 6:51).
//
// Training paces are the speeds at a fraction of VDOT:
//   easy 62–70% · threshold 88% · interval 98% · repetition ~105%
// Race paces come from the race-time prediction for each distance.
//
// Units: the app logs miles and "/mi" paces, so every pace here is
// SECONDS PER MILE. Distances are metres.
//
// No benchmark → no paces. Callers fall back to effort targets (talk test,
// RPE); a wrong pace is worse than an honest effort cue.
// ─────────────────────────────────────────────────────────────────────────────

export const METERS_PER_MILE = 1609.344;

export const RACE_DISTANCES = {
  "1mi":      { id: "1mi",      meters: 1609.344, label: "1 mile" },
  "5k":       { id: "5k",       meters: 5000,     label: "5K" },
  "10k":      { id: "10k",      meters: 10000,    label: "10K" },
  "half":     { id: "half",     meters: 21097.5,  label: "Half marathon" },
  "marathon": { id: "marathon", meters: 42195,    label: "Marathon" },
};

// VDOT sanity band: below 20 is slower than a 40-min 5K walk-run; above 85 is
// world-record territory. Anything outside is a typo, not a runner.
export const VDOT_MIN = 20;
export const VDOT_MAX = 85;

export const PACE_FRACTIONS = {
  easyFast: 0.70,
  easySlow: 0.62,
  threshold: 0.88,
  interval: 0.98,
  repetition: 1.05,
};

function vo2Cost(metersPerMin) {
  return -4.60 + 0.182258 * metersPerMin + 0.000104 * metersPerMin * metersPerMin;
}

function fractionSustainable(minutes) {
  return 0.8 + 0.1894393 * Math.exp(-0.012778 * minutes) + 0.2989558 * Math.exp(-0.1932605 * minutes);
}

function finitePositive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Resolve a distance id ("5k") or a metre count to metres. */
export function distanceMeters(distance) {
  if (typeof distance === "string" && RACE_DISTANCES[distance]) return RACE_DISTANCES[distance].meters;
  return finitePositive(distance);
}

/** VDOT for a race result, or null when the inputs are not a plausible race. */
export function vdotFromRace(distance, seconds) {
  const meters = distanceMeters(distance);
  const secs = finitePositive(seconds);
  if (!meters || !secs) return null;
  const minutes = secs / 60;
  const vdot = vo2Cost(meters / minutes) / fractionSustainable(minutes);
  if (!Number.isFinite(vdot) || vdot < VDOT_MIN || vdot > VDOT_MAX) return null;
  return Math.round(vdot * 100) / 100;
}

/** Predicted race time (seconds) for a distance at a given VDOT. */
export function predictRaceSeconds(vdot, distance) {
  const meters = distanceMeters(distance);
  const v = finitePositive(vdot);
  if (!meters || !v) return null;
  // Faster time → higher implied VDOT, so bisect on time.
  const implied = (secs) => {
    const minutes = secs / 60;
    return vo2Cost(meters / minutes) / fractionSustainable(minutes);
  };
  let lo = 60;          // 1 minute
  let hi = 12 * 3600;   // 12 hours
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (implied(mid) > v) lo = mid; else hi = mid;
  }
  return Math.round((lo + hi) / 2);
}

/** Pace (sec/mi) at a fraction of VDOT — the positive root of the cost curve. */
export function paceAtFraction(vdot, fraction) {
  const v = finitePositive(vdot);
  const f = finitePositive(fraction);
  if (!v || !f) return null;
  const a = 0.000104;
  const b = 0.182258;
  const c = -4.60 - f * v;
  const metersPerMin = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
  if (!(metersPerMin > 0)) return null;
  return Math.round((METERS_PER_MILE / metersPerMin) * 60);
}

/** Race pace (sec/mi) for a distance at a given VDOT. */
export function racePaceSecPerMile(vdot, distance) {
  const meters = distanceMeters(distance);
  const secs = predictRaceSeconds(vdot, distance);
  if (!meters || !secs) return null;
  return Math.round(secs / (meters / METERS_PER_MILE));
}

// ─── Formatting / parsing ───────────────────────────────────────────────────

/** "24:30" → 1470, "1:02:10" → 3730. Null for anything ambiguous. */
export function parseDuration(text) {
  if (typeof text !== "string") return null;
  const parts = text.trim().split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  if (!parts.every((p) => /^\d{1,3}$/.test(p))) return null;
  const nums = parts.map((p) => parseInt(p, 10));
  const [h, m, s] = parts.length === 3 ? nums : [0, nums[0], nums[1]];
  if (s >= 60 || (parts.length === 3 && m >= 60)) return null;
  const total = h * 3600 + m * 60 + s;
  return total > 0 ? total : null;
}

/** 1470 → "24:30", 3730 → "1:02:10". */
export function formatDuration(seconds) {
  const s = finitePositive(seconds);
  if (!s) return "";
  const total = Math.round(s);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}

/** 494 → "8:14" (sec/mi, no unit suffix). */
export function formatPace(secPerMile) {
  const s = finitePositive(secPerMile);
  if (!s) return "";
  const total = Math.round(s);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

// ─── Zones ──────────────────────────────────────────────────────────────────

/**
 * Normalize a stored benchmark: { distance: "5k", seconds: 1500, date? }.
 * Returns null unless it yields a plausible VDOT.
 */
export function normalizeBenchmark(raw) {
  if (!raw || typeof raw !== "object") return null;
  const distance = typeof raw.distance === "string" && RACE_DISTANCES[raw.distance] ? raw.distance : null;
  const seconds = Number.isFinite(Number(raw.seconds)) ? Math.round(Number(raw.seconds)) : null;
  if (!distance || !seconds) return null;
  if (!vdotFromRace(distance, seconds)) return null;
  const date = typeof raw.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : null;
  return { distance, seconds, date };
}

/**
 * Pace zones from a benchmark result. Null when there is no usable benchmark —
 * callers then prescribe by effort only.
 */
export function buildPaceZones(benchmark) {
  const bm = normalizeBenchmark(benchmark);
  if (!bm) return null;
  const vdot = vdotFromRace(bm.distance, bm.seconds);
  if (!vdot) return null;
  const predictions = {};
  const race = {};
  for (const id of ["5k", "10k", "half", "marathon"]) {
    predictions[id] = predictRaceSeconds(vdot, id);
    race[id] = racePaceSecPerMile(vdot, id);
  }
  return {
    vdot,
    benchmark: bm,
    easy: { fast: paceAtFraction(vdot, PACE_FRACTIONS.easyFast), slow: paceAtFraction(vdot, PACE_FRACTIONS.easySlow) },
    threshold: paceAtFraction(vdot, PACE_FRACTIONS.threshold),
    interval: paceAtFraction(vdot, PACE_FRACTIONS.interval),
    repetition: paceAtFraction(vdot, PACE_FRACTIONS.repetition),
    race,
    predictions,
  };
}

/**
 * Display target for a workout intensity: "easy" | "threshold" | "interval" |
 * "race:<distanceId>". Returns { secPerMile, label } or null without zones.
 */
export function paceTarget(zones, intensity) {
  if (!zones || !intensity) return null;
  if (intensity === "easy") {
    const { fast, slow } = zones.easy || {};
    if (!fast || !slow) return null;
    return { secPerMile: Math.round((fast + slow) / 2), label: `${formatPace(fast)}–${formatPace(slow)}/mi` };
  }
  if (intensity === "threshold" || intensity === "interval" || intensity === "repetition") {
    const s = zones[intensity];
    return s ? { secPerMile: s, label: `${formatPace(s)}/mi` } : null;
  }
  if (intensity.startsWith("race:")) {
    const s = zones.race?.[intensity.slice(5)];
    return s ? { secPerMile: s, label: `${formatPace(s)}/mi` } : null;
  }
  return null;
}
