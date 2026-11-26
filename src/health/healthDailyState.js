// src/health/healthDailyState.js
// Whether the day's numbers come from Apple Health, as set in Settings ›
// Integrations. It lives on this phone: the permission behind it is this
// phone's too.

const ON_KEY = "ovt-health-daily-on";

// Fired on window when the setting changes, so the app picks it up at once.
export const HEALTH_DAILY_EVENT = "ovt:health-daily";

// Where storage is refused, the setting lasts until the app closes.
let unsaved = null;

export function readHealthDailyOn() {
  try { return localStorage.getItem(ON_KEY) === "1"; } catch { return unsaved === true; }
}

export function writeHealthDailyOn(on) {
  unsaved = Boolean(on);
  try {
    if (on) localStorage.setItem(ON_KEY, "1");
    else localStorage.removeItem(ON_KEY);
  } catch {
    // Kept in `unsaved` instead.
  }
  try { window.dispatchEvent(new Event(HEALTH_DAILY_EVENT)); } catch { /* no window */ }
}
