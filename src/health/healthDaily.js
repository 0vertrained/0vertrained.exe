// src/health/healthDaily.js
// Which of the log's fields the day's Apple Health numbers fill. A field is
// filled when it's empty, and kept up to date while it still holds what
// Health last put there (health.<key> on the day remembers that), so steps
// grow through the day. A number typed in is never replaced.
//
// Steps and weight are always filled. Sleep, resting heart rate and HRV only
// when neither Oura nor Whoop is connected: those come from the ring or the
// strap then, and Apple's HRV is measured differently, so the two would
// never line up in one trend.

export const HEALTH_FIELDS = [
  { key: "steps", path: "activity.steps", always: true, format: (value) => String(Math.round(value)) },
  { key: "weightLb", path: "body.weight", always: true, format: (value) => String(Math.round(value * 10) / 10) },
  { key: "sleepHours", path: "body.sleep", always: false, format: (value) => String(Math.round(value * 10) / 10) },
  { key: "restingHr", path: "body.restingHeartRate", always: false, format: (value) => String(Math.round(value)) },
  { key: "hrv", path: "body.hrv", always: false, format: (value) => String(Math.round(value)) },
];

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

function read(day, path) {
  return path.split(".").reduce((node, key) => node?.[key], day);
}

/**
 * The writes that bring the log up to date with Health's days:
 * [{ dateKey, path, value }]. `wearables`: Oura or Whoop is connected.
 */
export function planHealthDailyFills({ days = [], data = {}, wearables = false } = {}) {
  const writes = [];
  for (const health of days || []) {
    const dateKey = health?.date;
    if (typeof dateKey !== "string" || !DATE_KEY.test(dateKey)) continue;
    const day = data?.[dateKey] || {};
    for (const field of HEALTH_FIELDS) {
      if (!field.always && wearables) continue;
      const number = Number(health[field.key]);
      if (!Number.isFinite(number) || number <= 0) continue;
      const value = field.format(number);
      const current = String(read(day, field.path) ?? "").trim();
      const filled = String(day.health?.[field.key] ?? "");
      const ours = current === "" || (filled !== "" && current === filled);
      if (!ours || current === value) continue;
      writes.push({ dateKey, path: field.path, value });
      writes.push({ dateKey, path: `health.${field.key}`, value });
    }
  }
  return writes;
}
