// src/watch/watchRunsState.js
// Whether runs go to the Apple Watch, as set in Settings › Integrations, and
// the Apple Health workouts already dealt with. Both live on this phone:
// the permissions behind them are this phone's too.

const ON_KEY = "ovt-watch-runs-on";
const HANDLED_KEY = "ovt-health-runs-handled";
// Runs whose splits and effort were read, so each is read once.
const DETAILED_KEY = "ovt-health-runs-detailed";

// Fired on window when the setting changes, so the app picks it up at once.
export const WATCH_RUNS_EVENT = "ovt:watch-runs";

// Where storage is refused, the setting lasts until the app closes.
let unsaved = null;

export function readWatchRunsOn() {
  try { return localStorage.getItem(ON_KEY) === "1"; } catch { return unsaved === true; }
}

export function writeWatchRunsOn(on) {
  unsaved = Boolean(on);
  try {
    if (on) localStorage.setItem(ON_KEY, "1");
    else localStorage.removeItem(ON_KEY);
  } catch {
    // Kept in `unsaved` instead.
  }
  try { window.dispatchEvent(new Event(WATCH_RUNS_EVENT)); } catch { /* no window */ }
}

export function readHandledRuns() {
  try {
    const ids = JSON.parse(localStorage.getItem(HANDLED_KEY) || "[]");
    return Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function writeHandledRuns(ids) {
  try { localStorage.setItem(HANDLED_KEY, JSON.stringify(ids)); } catch { /* looked at again next time */ }
}

export function readDetailedRuns() {
  try {
    const ids = JSON.parse(localStorage.getItem(DETAILED_KEY) || "[]");
    return Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function writeDetailedRuns(ids) {
  try { localStorage.setItem(DETAILED_KEY, JSON.stringify(ids.slice(-200))); } catch { /* read again next time */ }
}
