// src/watch/healthRuns.js
// Runs recorded on the watch, read back from Apple Health by the iPhone app
// (ios/App/App/RunsPlugin.swift), and the run log they fill in. A day is
// filled only while no run is logged for it: one typed in, confirmed from
// Strava or filled here earlier stays exactly as it is. Each Health workout
// is looked at once, so a fill that was undone isn't made again.

import { defaultDay, getDayName } from "../constants";
import { usesProgramSessions } from "../programSessions";
import { applyRaceBuild } from "../raceBuild";
import { runWorkoutsFor, stableUuid } from "./runWorkouts";
import { cardioModality, hasCardioResult } from "../cardioLog";
import { METERS_PER_MILE } from "../runPaces";
import { runSplits } from "./runSplits";

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
// How many Health workout ids are remembered as dealt with.
export const HANDLED_LIMIT = 200;

const positive = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};

const pad = (number) => String(number).padStart(2, "0");

/** "42:10", or "95:20" past the hour, as the log's Time field reads. */
export function formatRunTime(seconds) {
  const total = Math.round(positive(seconds));
  return total > 0 ? `${Math.floor(total / 60)}:${pad(total % 60)}` : "";
}

/** Seconds per mile as the log's Pace field reads, "8:06". */
export function formatRunPace(secondsPerMile) {
  const total = Math.round(positive(secondsPerMile));
  return total > 0 ? `${Math.floor(total / 60)}:${pad(total % 60)}` : "";
}

// The rule the Strava suggestion uses (hasManualCardio in
// sections/StravaCardioRow.jsx): a run is logged once it has miles or a time.
export function hasLoggedRun(workout) {
  const filled = (cardio) => positive(Number.parseFloat(cardio?.miles)) > 0 || String(cardio?.time || "").trim() !== "";
  return filled(workout?.cardio) || Object.values(workout?.cardioSessions || {}).some(filled);
}

// Average heart rate across runs, each weighted by how long it lasted.
function averageHeartRate(runs) {
  let beats = 0;
  let seconds = 0;
  for (const run of runs) {
    const bpm = positive(run?.avgHr);
    const length = positive(run?.seconds);
    if (bpm && length) {
      beats += bpm * length;
      seconds += length;
    }
  }
  return seconds > 0 ? Math.round(beats / seconds) : 0;
}

/** A day's runs as the log's fields. Runs on the same day add up. */
export function runFill(runs) {
  const meters = runs.reduce((sum, run) => sum + positive(run?.meters), 0);
  const seconds = runs.reduce((sum, run) => sum + positive(run?.seconds), 0);
  const miles = Math.round((meters / METERS_PER_MILE) * 100) / 100;
  if (!(miles > 0) && !(seconds > 0)) return null;
  const hr = averageHeartRate(runs);
  return {
    miles: miles > 0 ? String(miles) : "",
    time: formatRunTime(seconds),
    pace: miles > 0 && seconds > 0 ? formatRunPace(seconds / miles) : "",
    hr: hr > 0 ? String(hr) : "",
  };
}

/** The log writes a fill makes, one per field it has a value for. */
export function fillWrites(fill) {
  const path = fill.path || "workout.cardio";
  const writes = ["miles", "time", "pace", "hr", "modality", "type", "plannedSeconds"]
    .filter((field) => fill?.[field])
    .map((field) => ({ path: `${path}.${field}`, value: fill[field] }));
  if (fill.activityRefs?.length) writes.push({ path: `${path}.activityRefs`, value: fill.activityRefs });
  return writes;
}

/**
 * Which days to fill from these Health runs. `handled` is the ids already
 * dealt with; the result's `handled` adds every run looked at now, filled or
 * not, newest last.
 */
function records(workout = {}) {
  return [["workout.cardio", workout.cardio], ...Object.entries(workout.cardioSessions || {}).map(([key, value]) => [`workout.cardioSessions.${key}`, value])];
}

function plannedSeconds(plan) {
  if (!plan) return null;
  const steps = [plan.warmup, ...plan.blocks.flatMap(block => Array.from({ length: block.iterations }, () => block.steps).flat()), plan.cooldown].filter(Boolean);
  return steps.length && steps.every(step => step.goal.kind === "time") ? steps.reduce((sum, step) => sum + step.goal.seconds, 0) : null;
}

const clockMinutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const activityNames = { run: "Run", walk: "Walk", hike: "Hike", bike: "Cycling", row: "Rowing", stair: "Stair stepper", elliptical: "Elliptical", cross: "Mixed cardio", rope: "Jump rope", swim: "Swim", ski: "Ski" };

export function planHealthFills({ runs = [], data = {}, handled = [], program } = {}) {
  const seen = new Set(handled);
  const fills = [];
  const looked = [];
  const days = new Map();
  const valid = runs.filter(run => run && typeof run.id === "string" && run.id && DATE_KEY.test(run.date));
  for (const run of valid.sort((a, b) => a.date.localeCompare(b.date) || String(a.start || "").localeCompare(String(b.start || "")))) {
    if (seen.has(run.id)) continue;
    seen.add(run.id);
    looked.push(run.id);
    const { date: dateKey } = run;
    const modality = run.activity || "run";
    const fill = runFill([run]);
    if (!fill) continue;
    if (!days.has(dateKey)) {
      const day = program && applyRaceBuild(program, dateKey)?.[getDayName(new Date(`${dateKey}T12:00:00`))];
      days.set(dateKey, {
        blocks: new Map(records((data[dateKey] || defaultDay()).workout)),
        plans: program ? runWorkoutsFor(program, dateKey) : [],
        split: usesProgramSessions(day),
      });
    }
    const { blocks, plans, split } = days.get(dateKey);
    const existing = [...blocks.values()].filter(hasCardioResult);
    if (existing.some(block => block.activityRefs?.some(ref => ref.source === "apple" && ref.id === run.id))) continue;
    const pathFor = plan => split ? `workout.cardioSessions.${plan.sessionId}` : "workout.cardio";
    const candidates = plans.filter(plan => plan.activity === modality);
    const exact = plans.find(plan => plan.id.toLowerCase() === run.planId?.toLowerCase() || (run.sessionId && plan.sessionId === run.sessionId && plan.activity === modality));
    if (exact && hasCardioResult(blocks.get(pathFor(exact)))) {
      // A manual entry already owns this planned session. Distinct Apple workouts
      // can still be saved as additional sessions on the same day.
      if (!blocks.get(pathFor(exact)).activityRefs?.some(ref => ref.source === "apple")) continue;
    }
    const start = new Date(run.start);
    const minutes = Number.isFinite(start.getTime()) ? start.getHours() * 60 + start.getMinutes() : null;
    const nearest = exact || candidates.sort((a, b) => minutes == null ? 0 :
      Math.abs(clockMinutes(a.time) - minutes) - Math.abs(clockMinutes(b.time) - minutes))[0];
    const matched = nearest && !hasCardioResult(blocks.get(pathFor(nearest))) ? nearest : null;
    let path = matched ? pathFor(matched) : "workout.cardio";
    // Avoid counting a manual/Strava recording twice. Without identities from
    // an old bridge, a pre-existing manual entry keeps priority.
    if (!exact && existing.some(block => !block.activityRefs?.some(ref => ref.source === "apple") &&
        (cardioModality(block) === modality || (!run.activity && !run.start)) &&
        (!run.start || !(block.startTime || block.activityRefs?.[0]?.startTime) ||
          Math.abs(Date.parse(run.start) - Date.parse(block.startTime || block.activityRefs[0].startTime)) < 300000) &&
        (!run.activity || (block.time === fill.time || (fill.miles && Math.abs(Number(block.miles) - Number(fill.miles)) < 0.03))))) continue;
    if (!matched && (hasCardioResult(blocks.get(path)) || (!split && plans.length))) {
      path = `workout.cardioSessions.apple-${stableUuid(run.id)}`;
    }
    const ref = { source: "apple", id: run.id, kind: modality === "bike" ? "ride" : modality, startTime: run.start || null,
      minutes: positive(run.seconds) / 60, miles: positive(run.meters) / METERS_PER_MILE };
    const seconds = plannedSeconds(matched);
    const result = { dateKey, ...fill, count: 1, activityRefs: [ref],
      ...(path !== "workout.cardio" && { path }), ...(run.activity && { modality, type: matched?.name || activityNames[modality] || "Cardio" }),
      ...(seconds && { plannedSeconds: seconds }) };
    if (modality !== "run") result.pace = "";
    fills.push(result);
    blocks.set(path, result);
  }
  return { fills, handled: [...handled, ...looked].slice(-HANDLED_LIMIT) };
}

/** The toast after a fill: "Today’s run filled in from Apple Health". */
export function fillMessage(fills, todayKey) {
  if (fills.length !== 1) return `${fills.length} ${fills.some(fill => fill.modality && fill.modality !== "run") ? "workouts" : "runs"} filled in from Apple Health`;
  const { dateKey } = fills[0];
  const date = new Date(`${dateKey}T12:00:00`);
  const yesterday = new Date(`${todayKey}T12:00:00`);
  yesterday.setDate(yesterday.getDate() - 1);
  const sameDay = (a, b) => a.toDateString() === b.toDateString();
  const day = dateKey === todayKey ? "Today’s"
    : sameDay(date, yesterday) ? "Yesterday’s"
    : `${date.toLocaleDateString("en-US", { weekday: "long" })}’s`;
  return `${day} ${activityNames[fills[0].modality]?.toLowerCase() || "run"} filled in from Apple Health`;
}

// A logged run is the Health run when their miles agree this closely.
const SAME_RUN = 0.03;

/**
 * Which logged runs to read splits and effort for: [{ dateKey, id }], one
 * per day, the day's longest Health run, where the day's logged run has its
 * miles and no splits yet, and that run wasn't read before (`detailed`).
 * `filled` are days just filled from these runs, whose writes may not have
 * landed in `data` yet.
 */
export function planRunDetails({ runs = [], data = {}, detailed = [], filled = [] } = {}) {
  const done = new Set(detailed);
  const justFilled = new Set(filled.filter(fill => typeof fill === "string"));
  const identified = new Map();
  for (const fill of filled) {
    for (const ref of fill?.activityRefs || []) identified.set(ref.id, { dateKey: fill.dateKey, path: fill.path || "workout.cardio" });
  }
  for (const [dateKey, day] of Object.entries(data)) {
    for (const [path, block] of records(day?.workout)) {
      for (const ref of block?.activityRefs || []) {
        if (ref.source === "apple" && block.activityRefs.length === 1) identified.set(ref.id, { dateKey, path });
      }
    }
  }
  const byDate = new Map();
  for (const run of runs) {
    if (!run || typeof run.id !== "string" || !DATE_KEY.test(run.date || "")) continue;
    if (identified.has(run.id)) continue;
    if (run.activity && run.activity !== "run") continue;
    byDate.set(run.date, [...(byDate.get(run.date) || []), run]);
  }
  const plan = [];
  for (const run of runs) {
    const match = identified.get(run?.id);
    if (match && !done.has(run.id)) {
      plan.push({ dateKey: match.dateKey, id: run.id, ...(match.path !== "workout.cardio" && { path: match.path }), ...(run.activity && { modality: run.activity }) });
      done.add(run.id);
    }
  }
  for (const [dateKey, dayRuns] of byDate) {
    const longest = [...dayRuns].sort((a, b) => positive(b.meters) - positive(a.meters))[0];
    if (!longest || done.has(longest.id) || !(positive(longest.meters) > 0)) continue;
    const cardio = (data[dateKey] || defaultDay()).workout?.cardio || {};
    if (Array.isArray(cardio.splits) && cardio.splits.length) continue;
    if (!justFilled.has(dateKey)) {
      const logged = positive(Number.parseFloat(cardio.miles));
      const recorded = dayRuns.reduce((sum, run) => sum + positive(run.meters), 0) / METERS_PER_MILE;
      if (!(logged > 0) || Math.abs(logged - recorded) > recorded * SAME_RUN) continue;
    }
    plan.push({ dateKey, id: longest.id });
  }
  return plan.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

/** The log writes for a run's detail: its splits and its effort. */
export function detailWrites(detail, path = "workout.cardio", modality = "run") {
  const writes = [];
  const splits = modality === "run" ? runSplits(detail) : [];
  if (splits.length) writes.push({ path: `${path}.splits`, value: splits });
  const segments = Array.isArray(detail?.segments) ? detail.segments.slice(0, 150).filter(s => Number.isFinite(s?.seconds) && s.seconds > 0).map(s => ({
    seconds: Math.round(s.seconds), ...(s.targetSeconds > 0 && { targetSeconds: Math.round(s.targetSeconds) }),
    ...(["Warm up", "Work", "Recover", "Cool down"].includes(s.label) && { label: s.label }),
  })) : [];
  if (segments.length) writes.push({ path: `${path}.segments`, value: segments });
  const effort = Number(detail?.effort?.value);
  if (Number.isFinite(effort) && effort >= 1 && effort <= 10) {
    writes.push({ path: `${path}.effortScore`, value: String(Math.round(effort)) });
    writes.push({ path: `${path}.effortEstimated`, value: detail.effort.estimated !== false });
  }
  return writes;
}
