// src/watch/healthRuns.js
// Runs recorded on the watch, read back from Apple Health by the iPhone app
// (ios/App/App/RunsPlugin.swift), and the run log they fill in. A day is
// filled only while no run is logged for it: one typed in, confirmed from
// Strava or filled here earlier stays exactly as it is. Each Health workout
// is looked at once, so a fill that was undone isn't made again.

import { defaultDay } from "../constants";
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
  return ["miles", "time", "pace", "hr"]
    .filter((field) => fill?.[field])
    .map((field) => ({ path: `workout.cardio.${field}`, value: fill[field] }));
}

/**
 * Which days to fill from these Health runs. `handled` is the ids already
 * dealt with; the result's `handled` adds every run looked at now, filled or
 * not, newest last.
 */
export function planHealthFills({ runs = [], data = {}, handled = [] } = {}) {
  const seen = new Set(handled);
  const byDate = new Map();
  for (const run of runs) {
    if (!run || typeof run.id !== "string" || !run.id || seen.has(run.id) || !DATE_KEY.test(run.date || "")) continue;
    seen.add(run.id);
    byDate.set(run.date, [...(byDate.get(run.date) || []), run]);
  }
  const fills = [];
  const looked = [];
  for (const [dateKey, dayRuns] of [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    looked.push(...dayRuns.map((run) => run.id));
    const entry = data[dateKey] || defaultDay();
    if (hasLoggedRun(entry.workout)) continue;
    const fill = runFill(dayRuns);
    if (fill) fills.push({ dateKey, ...fill, count: dayRuns.length });
  }
  return { fills, handled: [...handled, ...looked].slice(-HANDLED_LIMIT) };
}

/** The toast after a fill: "Today’s run filled in from Apple Health". */
export function fillMessage(fills, todayKey) {
  if (fills.length !== 1) return `${fills.length} runs filled in from Apple Health`;
  const { dateKey } = fills[0];
  const date = new Date(`${dateKey}T12:00:00`);
  const yesterday = new Date(`${todayKey}T12:00:00`);
  yesterday.setDate(yesterday.getDate() - 1);
  const sameDay = (a, b) => a.toDateString() === b.toDateString();
  const day = dateKey === todayKey ? "Today’s"
    : sameDay(date, yesterday) ? "Yesterday’s"
    : `${date.toLocaleDateString("en-US", { weekday: "long" })}’s`;
  return `${day} run filled in from Apple Health`;
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
  const justFilled = new Set(filled);
  const byDate = new Map();
  for (const run of runs) {
    if (!run || typeof run.id !== "string" || !DATE_KEY.test(run.date || "")) continue;
    byDate.set(run.date, [...(byDate.get(run.date) || []), run]);
  }
  const plan = [];
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
export function detailWrites(detail) {
  const writes = [];
  const splits = runSplits(detail);
  if (splits.length) writes.push({ path: "workout.cardio.splits", value: splits });
  const effort = Number(detail?.effort?.value);
  if (Number.isFinite(effort) && effort >= 1 && effort <= 10) {
    writes.push({ path: "workout.cardio.effortScore", value: String(Math.round(effort)) });
    writes.push({ path: "workout.cardio.effortEstimated", value: detail.effort.estimated !== false });
  }
  return writes;
}
