// src/addedExercises.js
// Exercises added to one day's training without touching the program, kept
// with the day as workout.added = [{ name, sets, reps, session,
// trackingMode? }]. Their sets are logged like any others, under
// workout.exercises[name], so volume, load and progress count them.
// withAdded() puts them into that day's plan wherever the day is read:
// Today, the session runner, the watch and the widget.

import { normalizeProgramSession } from "./programSessions";
import { EXERCISES, exercisePrescription, findLibraryExercise } from "./programExerciseLibrary";
import { resolveTrackingMode, TRACKING_MODES } from "./workoutLogging";

const MAX_ADDED = 12;
const MAX_CHOICES = 8;
const RECENT_DAYS = 60;
// The persisted target field is named "reps" for all historical program shapes.
export function exerciseTarget(exercise) {
  switch (resolveTrackingMode(exercise)) {
    case TRACKING_MODES.TIMED_HOLD: return { label: "Seconds", unit: "seconds", max: 3600, field: "duration" };
    case TRACKING_MODES.CARRY: return { label: "Yards", unit: "yards", max: 1000, field: "distance" };
    default: return { label: "Reps", unit: "reps", max: 50, field: "reps" };
  }
}

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
    reps: clampInt(item.reps, 1, exerciseTarget(item).max, 10),
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
  const entry = { name, sets: clampInt(item.sets, 1, 10, 3), reps: clampInt(item.reps, 1, exerciseTarget(item).max, 10), session: item.session || "main" };
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
      const last = done[done.length - 1];
      seen.set(name, { name, sets: done.length, last });
    }
  }
  return [...seen.values()];
}

/** Sets and targets from the most recent logged set or the catalog's starting prescription. */
export function defaultsFor(name, { allData = {}, todayKey } = {}) {
  const prescription = exercisePrescription(name);
  const recent = todayKey ? recentExercises(allData, todayKey).find(item => item.name.toLowerCase() === name.toLowerCase()) : null;
  const target = exerciseTarget(prescription || { name });
  return {
    sets: clampInt(recent?.sets, 1, 10, prescription?.sets || 3),
    reps: clampInt(recent?.last?.[target.field], 1, target.max, prescription?.reps || 10),
    ...(prescription?.trackingMode && { trackingMode: prescription.trackingMode }),
  };
}

export const EXERCISE_FILTERS = {
  all: "All equipment", free: "Free weights", barbell: "Barbells", dumbbell: "Dumbbells", kettlebell: "Kettlebells",
  machines: "Machines", selectorized: "Selectorized machines",
  plate_loaded: "Plate-loaded machines", cable: "Cables", bodyweight: "Calisthenics",
  assisted: "Assisted exercises", conditioning: "Carries and conditioning",
};

function matchesFilter(ex, category) {
  switch (category) {
    case "all": return true;
    case "free": return ["barbell", "dumbbell", "kettlebell", "plate"].includes(ex?.equipment);
    case "machines": return ["machine", "selectorized", "plate_loaded"].includes(ex?.equipment);
    case "assisted": return ex && resolveTrackingMode(ex) === TRACKING_MODES.ASSISTED_REPS;
    case "conditioning": return ex?.pattern === "carry" || ex?.pattern === "conditioning";
    default: return ex?.equipment === category;
  }
}

const searchKey = name => name.toLowerCase()
  .replace(/\bdb\b/g, "dumbbell").replace(/\bkb\b/g, "kettlebell").replace(/\brdl\b/g, "romanian deadlift")
  .replace(/[^a-z0-9]/g, "");

/** Recent lifts appear first. Browse includes the full catalog, optionally filtered by equipment. */
export function exerciseChoices({ query = "", allData = {}, todayKey, exclude = [], category = "all", pattern = "all", browse = false } = {}) {
  const skip = new Set(exclude.map(name => String(name).toLowerCase()));
  const recent = todayKey ? recentExercises(allData, todayKey).map(exercise => exercise.name) : [];
  const needle = query.trim().toLowerCase();
  const entries = needle || browse ? [...recent, ...EXERCISES.map(ex => ex.name)] : recent;
  const names = [];
  const compact = searchKey(needle);
  for (const name of entries) {
    const key = name.toLowerCase();
    if (skip.has(key)) continue;
    const exercise = findLibraryExercise(name);
    if (!matchesFilter(exercise, category) || (pattern !== "all" && exercise?.pattern !== pattern)) continue;
    if (needle && !key.includes(needle) && !(compact && searchKey(name).includes(compact))) continue;
    skip.add(key);
    names.push(name);
  }
  if (needle) {
    const starts = name => name.toLowerCase().startsWith(needle) || name.toLowerCase().includes(" " + needle);
    names.sort((a, b) => Number(starts(b)) - Number(starts(a)));
  }
  return browse ? names : names.slice(0, MAX_CHOICES);
}
