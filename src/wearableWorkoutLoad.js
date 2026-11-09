// src/wearableWorkoutLoad.js
// Conservative bridge from wearable activity/workouts into the existing load model.
// Manual logs stay canonical; wearable rows fill gaps and annotate source.

import { buildDailyLoads, computeSessionLoad } from "./loadModel";
import { normalizeWorkout } from "./whoop/normalization";
import { normalizeActivity } from "./oura/normalization";

function isoDate(d) {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

function hasManualWorkout(entry) {
  return computeSessionLoad(entry).hasWorkout;
}

function whoopLoadForDay(day) {
  const workouts = Array.isArray(day?.workout) ? day.workout : day?.workout ? [day.workout] : [];
  const normalized = workouts.map(normalizeWorkout).filter(Boolean);

  // Zone-weighted load, on the manual model's exact currency
  // (load = sRPE × minutes — see loadModel.computeSessionLoad). The old
  // strain × 35 mapping SUMMED strains across workouts, but Whoop strain is a
  // logarithmic 0–21 scale and is not additive: on the reporting user's
  // export, five workouts on one stored day summed to 17.9 strain (→ 626
  // load) against an actual day-strain of 4.1. Heart-rate-zone minutes ARE
  // additive, and every synced workout carries score.zone_durations. Weights
  // are sRPE equivalents per zone (z0 <50% HR ≈ RPE1 easy movement … z5
  // 90–100% ≈ RPE9.5), so 60 zone-2 minutes ≈ RPE4 × 60 = 240 — directly
  // comparable to a logged session. Strain-based estimate remains as the
  // fallback for records without zones (old Whoop payloads, PENDING scores).
  const ZONE_SRPE = { zone_zero_milli: 1, zone_one_milli: 2, zone_two_milli: 4, zone_three_milli: 6, zone_four_milli: 8, zone_five_milli: 9.5 };
  let zoneLoad = 0;
  let zoneMinutes = 0;
  for (const w of workouts) {
    const zones = w?.score?.zone_durations;
    if (!zones || typeof zones !== "object") continue;
    for (const [key, weight] of Object.entries(ZONE_SRPE)) {
      const minutes = (Number(zones[key]) || 0) / 60000;
      if (minutes > 0) { zoneLoad += minutes * weight; zoneMinutes += minutes; }
    }
  }
  if (zoneLoad > 0) {
    const sports = [...new Set(normalized.map((w) => w.sportName).filter(Boolean))];
    const sportsLabel = sports.length ? ` — ${sports.join(", ")}` : "";
    return {
      load: Math.round(zoneLoad),
      source: "whoop",
      confidence: "medium",
      note: `Whoop HR-zone load filled from ${normalized.length} workout(s)${sportsLabel} (${Math.round(zoneMinutes)} min).`,
    };
  }

  const strain = normalized.reduce((sum, w) => sum + (Number(w.strain) || 0), 0);
  const minutes = normalized.reduce((sum, w) => {
    if (Number(w.kilojoule) > 0) return sum + Math.min(180, Math.max(20, Number(w.kilojoule) / 40));
    return sum;
  }, 0);
  if (!strain && !minutes) return null;
  // Conservative mapping: Whoop workout strain is 0-21; use a moderate sRPE-like
  // factor and cap so it fills missing load without overpowering manual logs.
  const load = Math.round(Math.max(strain * 35, minutes * 5));
  return { load, source: "whoop", confidence: strain ? "medium" : "low", note: `Whoop workout load filled from ${normalized.length} workout(s).` };
}

// Strava is the highest-fidelity gap fill: real per-workout distance,
// duration, and elevation, versus Whoop's day-level strain and Oura's day-level
// activity calories. Formulas sit on the existing fill scale (Oura uses
// miles × 45) and stay conservative: they fill missing days, never outrank a
// manual log. Notes carry counts only — never activity titles — so nothing
// Strava-identifying can leak if a load row is ever serialized (see
// stravaCoachExclusion.test.js).
const STRAVA_DAY_LOAD_CAP = 900;

export function stravaLoadForDay(dayActivities) {
  const acts = Array.isArray(dayActivities) ? dayActivities.filter(Boolean) : [];
  if (!acts.length) return null;
  let load = 0;
  let miles = 0;
  let minutes = 0;
  for (const a of acts) {
    const m = Number(a.miles) || 0;
    const mins = Number(a.minutes) || 0;
    const elevFt = Number(a.elevationFt) || 0;
    miles += m;
    minutes += mins;
    if (a.kind === "run") load += m * 45 + elevFt * 0.045;
    else if (a.kind === "ride") load += m * 14 + elevFt * 0.03;
    else load += mins * 5;
  }
  load = Math.round(Math.min(STRAVA_DAY_LOAD_CAP, load));
  if (!load) return null;
  return {
    load,
    source: "strava",
    confidence: "medium",
    miles: Math.round(miles * 100) / 100,
    minutes: Math.round(minutes),
    note: `Strava filled the day's load from ${acts.length} ${acts.length === 1 ? "activity" : "activities"}.`,
  };
}

function ouraLoadForDay(day) {
  const activity = normalizeActivity(day?.activity);
  const meters = Number(activity?.meters) || Number(activity?.distance) || 0;
  const calories = Number(activity?.activeCalories) || Number(activity?.calories) || 0;
  const miles = meters > 0 ? meters / 1609.344 : 0;
  const load = Math.round(Math.max(miles * 45, calories * 0.8));
  if (!load) return null;
  return { load, source: "oura", confidence: "low", note: "Oura activity load filled a missing manual workout day." };
}

export function buildWearableLoadRows({ entries = {}, ouraData = {}, whoopData = {}, stravaByDate = {}, maxDays = 28, asOf = null } = {}) {
  const manualRows = buildDailyLoads(entries, maxDays, asOf);
  return manualRows.map((row) => {
    const manual = entries?.[row.date];
    const manualHasWorkout = hasManualWorkout(manual);
    const whoop = whoopLoadForDay(whoopData?.[row.date]);
    const oura = ouraLoadForDay(ouraData?.[row.date]);
    const strava = stravaLoadForDay(stravaByDate?.[row.date]);
    if (manualHasWorkout) {
      const context = [strava, whoop, oura].filter(Boolean);
      return {
        ...row,
        source: context.length ? "manual+wearable-context" : "manual",
        confidence: "high",
        wearableContext: context,
        notes: context.length ? ["Manual workout used; wearable workout/activity present but not double-counted."] : [],
      };
    }
    // Fill priority: Strava (real workout with distance) → Whoop (day strain)
    // → Oura (day activity). Exactly one source is chosen per day, so a run
    // that both Strava and Whoop captured can never double-count in ACWR —
    // the runner-up is kept as corroborating context instead.
    const chosen = strava || whoop || oura;
    if (!chosen) return { ...row, source: "none", confidence: "low", wearableContext: [], notes: [] };
    const corroboration = [strava, whoop, oura].filter((c) => c && c !== chosen);
    return {
      ...row,
      load: chosen.load,
      hasWorkout: chosen.load > 0,
      source: chosen.source,
      confidence: chosen.confidence,
      wearableContext: [chosen, ...corroboration],
      notes: [chosen.note, ...(corroboration.length ? ["Other wearable activity on the same day corroborates; counted once."] : [])],
    };
  });
}

export function summarizeWearableLoadSource(rows = []) {
  const filled = rows.filter((r) => r.source === "whoop" || r.source === "oura" || r.source === "strava").length;
  const context = rows.filter((r) => r.source === "manual+wearable-context").length;
  if (!filled && !context) return null;
  return {
    filledDays: filled,
    contextDays: context,
    label: filled ? `Wearables filled ${filled} missing load day${filled === 1 ? "" : "s"}` : "Wearables available as load context",
  };
}

export function todayKeyFromNow(now = new Date()) {
  return isoDate(now);
}
