// src/health/healthDailyState.js
// Whether the day's numbers come from Apple Health, as set in Settings ›
// Integrations. It lives on this phone: the permission behind it is this
// phone's too.

import { readDeviceToggle, writeDeviceToggle } from "./deviceHealthStorage";

const ON_KEY = "ovt-health-daily-on";

// Fired on window when the setting changes, so the app picks it up at once.
export const HEALTH_DAILY_EVENT = "ovt:health-daily";

export function readHealthDailyOn(owner) {
  return readDeviceToggle(ON_KEY, owner);
}

export function writeHealthDailyOn(on, owner) {
  writeDeviceToggle(ON_KEY, owner, on, HEALTH_DAILY_EVENT);
}
