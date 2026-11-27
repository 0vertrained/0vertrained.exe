// src/watch/watchRunsState.js
// Whether runs go to the Apple Watch, as set in Settings › Integrations, and
// the Apple Health workouts already dealt with. Both live on this phone:
// the permissions behind them are this phone's too.

import { readDeviceToggle, writeDeviceToggle, deviceHealthKey } from "../health/deviceHealthStorage";

const ON_KEY = "ovt-watch-runs-on";
// WorkoutKit has one physical schedule, shared across signed-in accounts.
const SCHEDULE_KEY = "ovt-watch-has-schedule";
let scheduleQueue = Promise.resolve();
const HANDLED_KEY = "ovt-health-runs-handled";
// Runs whose splits and effort were read, so each is read once.
const DETAILED_KEY = "ovt-health-runs-detailed";

// Fired on window when the setting changes, so the app picks it up at once.
export const WATCH_RUNS_EVENT = "ovt:watch-runs";

export function readWatchRunsOn(owner) {
  return readDeviceToggle(ON_KEY, owner);
}

export function writeWatchRunsOn(on, owner) {
  writeDeviceToggle(ON_KEY, owner, on, WATCH_RUNS_EVENT);
}

export function readHandledRuns(owner) {
  try {
    const ids = JSON.parse(localStorage.getItem(deviceHealthKey(HANDLED_KEY, owner)) || "[]");
    return Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function writeHandledRuns(ids, owner) {
  try { localStorage.setItem(deviceHealthKey(HANDLED_KEY, owner), JSON.stringify(ids)); } catch { /* looked at again next time */ }
}

export function readDetailedRuns(owner) {
  try {
    const ids = JSON.parse(localStorage.getItem(deviceHealthKey(DETAILED_KEY, owner)) || "[]");
    return Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function writeDetailedRuns(ids, owner) {
  try { localStorage.setItem(deviceHealthKey(DETAILED_KEY, owner), JSON.stringify(ids.slice(-200))); } catch { /* read again next time */ }
}

// Keep a late schedule from a previous athlete from racing the next clear.
function queueSchedule(action) {
  const next = scheduleQueue.then(action);
  scheduleQueue = next.catch(() => {});
  return next;
}

function hasSchedule() {
  try {
    const saved = localStorage.getItem(SCHEDULE_KEY);
    return saved === null ? readWatchRunsOn() : saved === "1";
  } catch { return false; }
}

function markSchedule(on) {
  try { localStorage.setItem(SCHEDULE_KEY, on ? "1" : "0"); } catch { /* No persistent device storage. */ }
}

export function scheduleWatchRuns(plugin, runs, current) {
  return queueSchedule(async () => {
    if (!current()) return;
    if (runs.length) markSchedule(true);
    const result = await plugin.schedule({ runs: JSON.stringify(runs) });
    if (!runs.length && result?.authorized) markSchedule(false);
    return result;
  });
}

export function clearWatchSchedule(plugin, { force = false, current = () => true } = {}) {
  return queueSchedule(async () => {
    if (!current() || (!force && !hasSchedule()) || !plugin?.clear) return;
    if (force) markSchedule(true);
    await plugin.clear();
    markSchedule(false);
  });
}
