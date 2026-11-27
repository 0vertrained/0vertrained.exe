// src/health/healthWrite.js
// Saving to Apple Health from the iPhone app, once it's on in Settings ›
// Integrations (ios/App/App/HealthWritePlugin.swift): the weight you type,
// each day's food totals, lifts finished in the session runner on this
// iPhone as strength workouts with your effort rating, and that rating on
// lifts the watch tracked, which the watch already saved. Each write is
// remembered by what it said, so a day is saved again only when it changed.

const ON_KEY = "ovt-health-write-on";
const SAVED_KEY = "ovt-health-saved";
// Today and the two days before: late edits to those still reach Health.
export const WRITE_DAYS = 3;
// A watch lift that can't be found in Health yet is tried this many times.
const RATE_TRIES = 3;

// Fired on window when the setting changes, so the app picks it up at once.
export const HEALTH_WRITE_EVENT = "ovt:health-write";

let unsaved = null;

export function readHealthWriteOn() {
  try { return localStorage.getItem(ON_KEY) === "1"; } catch { return unsaved === true; }
}

export function writeHealthWriteOn(on) {
  unsaved = Boolean(on);
  try {
    if (on) localStorage.setItem(ON_KEY, "1");
    else localStorage.removeItem(ON_KEY);
  } catch {
    // Kept in `unsaved` instead.
  }
  try { window.dispatchEvent(new Event(HEALTH_WRITE_EVENT)); } catch { /* no window */ }
}

export function readSaved() {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVED_KEY) || "{}");
    return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  } catch {
    return {};
  }
}

/** Keeps what was saved for the last two weeks of days. */
export function writeSaved(saved, todayKey) {
  const oldest = shift(todayKey, -14);
  const kept = Object.fromEntries(Object.entries(saved || {}).filter(([key]) => (key.match(/\d{4}-\d{2}-\d{2}/)?.[0] || "") >= oldest));
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(kept)); } catch { /* saved again next time */ }
}

function shift(dateKey, days) {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const amount = (value) => {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number * 10) / 10 : 0;
};

const effortOf = (workout) => {
  const score = Number.parseFloat(workout?.rpe);
  return Number.isFinite(score) && score >= 1 && score <= 10 ? Math.round(score) : null;
};

const time = (value) => {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
};

const hasDoneSets = (workout) => Object.values(workout?.exercises || {}).some((exercise) => (exercise?.sets || []).some((set) => set?.done));

/**
 * What to save for today and the days before it: [{ key, signature, kind,
 * ... }], kind being weight, food, lift or rate, leaving out what was saved
 * already with the same signature.
 */
export function planHealthWrites({ data = {}, todayKey, saved = {}, days = WRITE_DAYS } = {}) {
  const writes = [];
  for (let back = 0; back < days; back += 1) {
    const date = shift(todayKey, -back);
    const day = data?.[date];
    if (!day) continue;

    // Weight you typed. One Health filled in is Health's already.
    const pounds = amount(day.body?.weight);
    const filled = String(day.health?.weightLb ?? "");
    if (pounds && !(filled !== "" && String(day.body.weight).trim() === filled)) {
      writes.push({ key: `weight.${date}`, signature: String(pounds), kind: "weight", date, pounds });
    }

    // The day's food totals; once saved, totals back at nothing clear Health's.
    const nutrition = day.nutrition || {};
    const food = { calories: amount(nutrition.calories), protein: amount(nutrition.protein), carbs: amount(nutrition.carbs), fat: amount(nutrition.fats) };
    if (Object.values(food).some(Boolean) || saved[`food.${date}`]) {
      writes.push({ key: `food.${date}`, signature: JSON.stringify(food), kind: "food", date, ...food });
    }

    // Lifts: the watch saved its own workouts, so those only get the rating;
    // a session finished in the runner on this iPhone becomes a workout.
    const workout = day.workout || {};
    const effort = effortOf(workout);
    const watched = Array.isArray(workout.watchWorkouts) ? workout.watchWorkouts : [];
    if (watched.length) {
      if (effort == null) continue;
      for (const record of watched) {
        const start = time(record?.startedAt);
        const end = time(record?.endedAt);
        if (!record?.id || start == null || end == null || end <= start) continue;
        const key = `rate.${date}.${record.id}`;
        if ((Number(saved[`${key}#tries`]) || 0) >= RATE_TRIES) continue;
        writes.push({ key, signature: String(effort), kind: "rate", date, start, end, effort });
      }
      continue;
    }
    if (!hasDoneSets(workout)) continue;
    for (const [session, state] of Object.entries(workout.sessionState || {})) {
      const start = time(state?.startedAt);
      const end = time(state?.completedAt);
      if (state?.status !== "complete" || start == null || end == null || end <= start) continue;
      writes.push({ key: `lift.${date}.${session}`, signature: JSON.stringify([start, end, effort]), kind: "lift", date, id: `${date}-${session}`, start, end, effort });
    }
  }
  return writes.filter((write) => saved[write.key] !== write.signature);
}

/** Sends one write. Resolves whether Health has it now. */
export async function sendHealthWrite(plugin, write) {
  if (write.kind === "weight") return (await plugin.saveWeight({ date: write.date, pounds: write.pounds }))?.saved === true;
  if (write.kind === "food") {
    const { date, calories, protein, carbs, fat } = write;
    return (await plugin.saveFood({ date, calories, protein, carbs, fat }))?.saved === true;
  }
  if (write.kind === "lift") {
    const result = await plugin.saveLift({ id: write.id, start: write.start, end: write.end, ...(write.effort ? { effort: write.effort } : {}) });
    return result?.saved === true;
  }
  if (write.kind === "rate") return (await plugin.rateWorkout({ start: write.start, end: write.end, effort: write.effort }))?.rated === true;
  return false;
}

/** Remembers a write: done, or for a rating, one more try. */
export function recordWrite(saved, write, done) {
  if (done) return { ...saved, [write.key]: write.signature };
  if (write.kind === "rate") return { ...saved, [`${write.key}#tries`]: (Number(saved[`${write.key}#tries`]) || 0) + 1 };
  return saved;
}
