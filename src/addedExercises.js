// src/addedExercises.js
// Exercises added to one day's training without touching the program, kept
// with the day as workout.added = [{ name, sets, reps, session,
// trackingMode? }]. Their sets are logged like any others, under
// workout.exercises[name], so volume, load and progress count them.
// withAdded() puts them into that day's plan wherever the day is read:
// Today, the session runner, the watch and the widget.

import { normalizeProgramSession } from "./programSessions";
import { EXERCISES } from "./programExerciseLibrary";

const MAX_ADDED = 12;
const MAX_CHOICES = 8;
const RECENT_DAYS = 60;
const BODYWEIGHT = "bodyweight_reps";

const clampInt = (value, low, high, fallback) => {
  const number = Math.round(Number(value));
  return Number.isFinite(number) && number >= low ? Math.min(number, high) : fallback;
};

/** The day's added exercises, cleaned. */
export function addedFor(workout) {
  const list = Array.isArray(workout?.added) ? workout.added : [];
  return list.filter((item) => item && typeof item.name === "string" && item.name.trim()).slice(0, MAX_ADDED);
}

function asExercise(item) {
  return {
    name: item.name.trim(),
    sets: clampInt(item.sets, 1, 10, 3),
    reps: clampInt(item.reps, 1, 50, 10),
    ...(item.trackingMode ? { trackingMode: item.trackingMode } : {}),
    added: true,
  };
}

/**
 * The day's plan with its added exercises, each at the end of the session
 * it was added to (else the first lifting session). One the plan already
 * has is left out.
 */
export function withAdded(day, workout) {
  const added = addedFor(workout);
  if (!added.length) return day;
  const base = day && typeof day === "object" ? day : {};
  if (Array.isArray(base.sessions) && base.sessions.length) {
    const ids = base.sessions.map((session, index) => normalizeProgramSession(session, index, base).id);
    const sessions = base.sessions.map((session) => ({ ...session, lifting: [...(Array.isArray(session.lifting) ? session.lifting : [])] }));
    const names = new Set(sessions.flatMap((session) => session.lifting.map((exercise) => exercise?.name)));
    const fallback = Math.max(0, sessions.findIndex((session) => session.lifting.length > 0));
    for (const item of added) {
      const exercise = asExercise(item);
      if (names.has(exercise.name)) continue;
      names.add(exercise.name);
      const at = ids.indexOf(item.session);
      sessions[at >= 0 ? at : fallback].lifting.push(exercise);
    }
    return { ...base, sessions };
  }
  const lifting = Array.isArray(base.lifting) ? base.lifting : [];
  const names = new Set(lifting.map((exercise) => exercise?.name));
  const extra = [];
  for (const item of added) {
    const exercise = asExercise(item);
    if (names.has(exercise.name)) continue;
    names.add(exercise.name);
    extra.push(exercise);
  }
  return extra.length ? { ...base, lifting: [...lifting, ...extra] } : base;
}

/** workout.added with one more, or the same list when it's already there. */
export function addToDay(workout, item) {
  const list = addedFor(workout);
  const name = String(item?.name || "").trim();
  if (!name || list.some((entry) => entry.name === name) || list.length >= MAX_ADDED) return list;
  const entry = { name, sets: clampInt(item.sets, 1, 10, 3), reps: clampInt(item.reps, 1, 50, 10), session: item.session || "main" };
  if (item.trackingMode) entry.trackingMode = item.trackingMode;
  return [...list, entry];
}

/** workout.added without the named one. */
export function removeFromDay(workout, name) {
  return addedFor(workout).filter((entry) => entry.name !== name);
}

function shiftKey(dateKey, days) {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// Exercises logged in the last RECENT_DAYS before today, newest first, each
// with how it went last time: { name, sets, reps }.
function recentExercises(allData, todayKey) {
  const since = shiftKey(todayKey, -RECENT_DAYS);
  const days = Object.keys(allData || {}).filter((key) => key < todayKey && key >= since).sort().reverse();
  const seen = new Map();
  for (const key of days) {
    for (const [planned, data] of Object.entries(allData[key]?.workout?.exercises || {})) {
      const name = String(data?.performedName || planned || "").trim();
      if (!name || seen.has(name)) continue;
      const done = (data?.sets || []).filter((set) => set?.done);
      if (!done.length) continue;
      const reps = Number(done[done.length - 1]?.reps);
      seen.set(name, { name, sets: done.length, reps: Number.isFinite(reps) && reps > 0 ? reps : 10 });
    }
  }
  return [...seen.values()];
}

function libraryEntry(name) {
  const lower = name.toLowerCase();
  return EXERCISES.find((exercise) => exercise.name.toLowerCase() === lower) || null;
}

/** Sets, reps and tracking for a chosen name: last time, else the library, else 3 × 10. */
export function defaultsFor(name, { allData = {}, todayKey } = {}) {
  const library = libraryEntry(name);
  const recent = todayKey ? recentExercises(allData, todayKey).find((exercise) => exercise.name === name) : null;
  const trackingMode = library?.equipment === "bodyweight" ? BODYWEIGHT : undefined;
  return {
    sets: recent?.sets || library?.defaultSets || 3,
    reps: recent?.reps || library?.defaultReps || 10,
    ...(trackingMode ? { trackingMode } : {}),
  };
}

/**
 * Names to choose from: with nothing typed, what was logged lately; with
 * a search, those and the exercise library, starting-with first. Names in
 * `exclude` (already in the day) are left out.
 */
export function exerciseChoices({ query = "", allData = {}, todayKey, exclude = [] } = {}) {
  const skip = new Set(exclude.map((name) => String(name).toLowerCase()));
  const recent = todayKey ? recentExercises(allData, todayKey).map((exercise) => exercise.name) : [];
  const needle = query.trim().toLowerCase();
  if (!needle) return recent.filter((name) => !skip.has(name.toLowerCase())).slice(0, MAX_CHOICES);
  const pool = [...new Set([...recent, ...EXERCISES.map((exercise) => exercise.name)])]
    .filter((name) => !skip.has(name.toLowerCase()) && name.toLowerCase().includes(needle));
  const starts = pool.filter((name) => name.toLowerCase().startsWith(needle) || name.toLowerCase().includes(` ${needle}`));
  const rest = pool.filter((name) => !starts.includes(name));
  return [...starts, ...rest].slice(0, MAX_CHOICES);
}
