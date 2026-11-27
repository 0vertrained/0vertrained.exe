// src/wearableWorkoutLoad.js
// Conservative bridge from wearable activity/workouts into the existing load model.
// Manual logs stay canonical; wearable rows fill gaps and annotate source.

import { buildDailyLoads, cardioActivityRefs, getLoggedCardioBlocks } from "./loadModel";
import { reconcileActivities, sportKind } from "./workout/activityMatching";
import { normalizeWorkout } from "./whoop/normalization";
import { normalizeActivity } from "./oura/normalization";

function isoDate(d) {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

const ZONE_SRPE = { zone_zero_milli: 1, zone_one_milli: 2, zone_two_milli: 4, zone_three_milli: 6, zone_four_milli: 8, zone_five_milli: 9.5 };

function whoopLoad(workout) {
  const w = normalizeWorkout(workout);
  if (!w) return null;
  let load = 0;
  let minutes = 0;
  for (const [zone, effort] of Object.entries(ZONE_SRPE)) {
    const time = (Number(workout.score?.zone_durations?.[zone]) || 0) / 60000;
    if (time > 0) { load += time * effort; minutes += time; }
  }
  const hasZones = load > 0;
  if (!hasZones) {
    // Old Whoop records can have strain or energy but no HR-zone samples.
    const estimatedMinutes = w.kilojoule > 0 ? Math.min(180, Math.max(20, w.kilojoule / 40)) : 0;
    load = Math.max((w.strain || 0) * 35, estimatedMinutes * 5);
    minutes = Math.max(0, (Date.parse(workout.end) - Date.parse(workout.start)) / 60000) || 0;
  }
  if (!(load > 0)) return null;
  return { source: "whoop", id: w.id, startTime: workout.start, kind: sportKind(w.sportName),
    minutes, load, durationSource: minutes > 0 ? "recorded" : null, confidence: hasZones || w.strain > 0 ? "medium" : "low" };
}

// A recorded moving time is the best duration signal. With no reported
// exertion, use moderate effort; distance/elevation fill older imports that
// have no usable time. Only non-identifying aggregates leave this function.
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
    if (mins > 0) {
      const effort = Number(a.effortScore);
      load += mins * (effort >= 1 && effort <= 10 ? effort : 5);
    } else if (a.kind === "run" && m > 0) load += m * 45 + elevFt * 0.045;
    else if (a.kind === "ride" && m > 0) load += m * 14 + elevFt * 0.03;

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

// A reference identifies coverage, not an extra contribution to the manual
// load. A confirmed import can represent several separate morning/evening runs.
function manualActivities(entry, row) {
  const workout = entry?.workout || {};
  const lifts = (Array.isArray(workout.watchWorkouts) ? workout.watchWorkouts : []).filter(w => w?.seconds > 0)
    .map(w => ({ kind: "lift", startTime: w.startedAt, minutes: w.seconds / 60 }));
  if (!lifts.length && row.liftingMin > 0) {
    for (const session of Object.values(workout.sessionState || {})) {
      if (!session?.startedAt || !session.completedAt) continue;
      const minutes = (Date.parse(session.completedAt) - Date.parse(session.startedAt)) / 60000;
      if (minutes > 0) lifts.push({ kind: "lift", startTime: session.startedAt, minutes });
    }
    if (!lifts.length) lifts.push({ kind: "lift" });
  }
  const cardio = getLoggedCardioBlocks(workout).flatMap(cardioActivityRefs);
  return [...lifts, ...cardio];
}

function stravaActivity(a) {
  if (!(a.minutes > 0 || (a.miles > 0 && (a.kind === "run" || a.kind === "ride")))) return null;
  return { source: "strava", id: a.stravaId || a.id, kind: sportKind(a.sport) || sportKind(a.kind),
    startTime: a.startTime, minutes: a.minutes, miles: a.miles, durationSource: a.minutes > 0 ? "recorded" : null, confidence: "medium", raw: a };
}

function distinctRecords(records) {
  const seen = new Set();
  return records.filter(r => {
    const key = (r.id != null ? String(r.id) : null) || (r.startTime && r.kind && r.minutes ? [r.startTime, r.kind, r.minutes].join("|") : null);
    if (key && seen.has(key)) return false;
    if (key) seen.add(key);
    return true;
  });
}

export function buildWearableLoadRows({ entries = {}, ouraData = {}, whoopData = {}, stravaByDate = {}, maxDays = 28, asOf = null } = {}) {
  return buildDailyLoads(entries, maxDays, asOf).map(row => {
    const manual = manualActivities(entries[row.date], row);
    const groups = manual.map(activity => [activity]);
    const strava = distinctRecords((stravaByDate?.[row.date] || []).filter(Boolean).map(stravaActivity).filter(Boolean));
    const whoopDay = whoopData?.[row.date]?.workout;
    const whoop = distinctRecords([].concat(whoopDay || []).map(whoopLoad).filter(Boolean));
    const oura = ouraLoadForDay(ouraData?.[row.date]);
    const extraStrava = reconcileActivities(groups, strava);
    const extraWhoop = reconcileActivities(groups, whoop);
    // Apply the Strava cap once to the contributed activities over the day.
    const stravaTotal = stravaLoadForDay(extraStrava.map(a => a.raw));
    const whoopTotal = Math.round(extraWhoop.reduce((n, w) => n + w.load, 0));
    const extra = [...extraStrava, ...extraWhoop];
    const context = [];
    if (strava.length) context.push(stravaLoadForDay(strava.map(a => a.raw)));
    if (whoop.length) context.push({ source: "whoop", load: Math.round(whoop.reduce((n, w) => n + w.load, 0)), note: "Whoop recorded workout activity." });
    if (oura) context.push(oura);
    const contributing = [row.hasWorkout && "manual", stravaTotal && "strava", whoopTotal > 0 && "whoop"].filter(Boolean);
    const fill = contributing.length ? null : oura;
    const source = fill ? "oura" : contributing.join("+") || "none";
    const notes = extra.length ? [`Added ${extra.length} distinct wearable workout${extra.length === 1 ? "" : "s"}.`] : [];
    if (fill) notes.push(oura.note);
    if (extra.length < strava.length + whoop.length || (oura && !fill)) {
      notes.push("Overlapping or unresolved wearable activity is context only and is not double-counted; each workout is counted once.");
    }
    const minutes = extra.reduce((sum, a) => sum + (Number(a.minutes) || 0), 0);
    const durationKinds = new Set([row.durationSource, ...extra.map(a => a.durationSource)].filter(Boolean));
    const totalMinutes = row.durationMin + Math.round(minutes);
    const load = row.load + (stravaTotal?.load || 0) + whoopTotal + (fill?.load || 0);
    const manualConfidence = row.durationSource === "recorded" && !row.rpeEstimated ? "high" : "medium";
    return {
      ...row, load, hasWorkout: load > 0 || row.hasWorkout,
      durationMin: totalMinutes,
      liftingMin: row.liftingMin + Math.round(extra.filter(a => a.kind === "lift").reduce((sum, a) => sum + (a.minutes || 0), 0)),
      cardioMin: row.cardioMin + Math.round(extra.filter(a => a.kind && a.kind !== "lift").reduce((sum, a) => sum + (a.minutes || 0), 0)),
      durationSource: durationKinds.size > 1 ? "mixed" : [...durationKinds][0] || null,
      source: source === "manual" && context.length ? "manual+wearable-context" : source,
      confidence: extra.length ? (extra.every(a => a.confidence === "low") ? "low" : "medium")
        : row.hasWorkout ? manualConfidence : "low",
      wearableContext: context, notes,
    };
  });
}

export function summarizeWearableLoadSource(rows = []) {
  const filled = rows.filter(r => r.source && r.source !== "none" && r.source !== "manual" && r.source !== "manual+wearable-context").length;
  const context = rows.filter(r => r.source === "manual+wearable-context").length;
  if (!filled && !context) return null;
  return { filledDays: filled, contextDays: context,
    label: filled ? `Wearables contributed to load on ${filled} day${filled === 1 ? "" : "s"}` : "Wearables available as load context" };
}

export function todayKeyFromNow(now = new Date()) {
  return isoDate(now);
}
