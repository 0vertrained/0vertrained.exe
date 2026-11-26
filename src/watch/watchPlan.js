// src/watch/watchPlan.js
// What the Apple Watch gets from the phone, and what the phone does with what
// comes back. The plan is a day's lifting with every number the runner would
// show already worked out: what each open set is filled from and says so, how
// long to rest, how far one step of the crown moves each field. The watch
// logs sets against it and sends them back as events, which are written the
// way the runner writes them (completeSet), so the phone stays the only
// writer of the log. Nothing here talks to the watch; useWatchBridge does.

import { DEFAULT_PROGRAM, defaultDay, getDayName } from "../constants";
import { applyRaceBuild } from "../raceBuild";
import { getProgramSessions } from "../programSessions";
import { buildExercisePrescription } from "../progressionEngine";
import { lastSessionSets } from "../setGhosts";
import { suggestRestSeconds } from "../sessionIntelligence";
import { proposeSet, setFields } from "../workout/setFill";
import { completeSet } from "../workout/completeSet";
import { defaultWeightIncrement, isSessionHandled, reconcileExerciseSets, validateSet } from "../workoutLogging";

export const WATCH_PLAN_VERSION = 1;

// How far the crown can take each field.
const FIELD_MAX = { weight: 1500, reps: 100, duration: 600, distance: 1000, assistance: 300 };
// Units short enough to sit under a number on the watch.
const SHORT_UNIT = { s: "sec", "reps per side": "reps/side" };
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

const toNumber = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

// The log keeps numbers as the strings the runner's fields produce.
const toEntry = (value) => String(Math.round(value * 100) / 100);

function numbers(set, fields) {
  const values = {};
  for (const field of fields) {
    const value = toNumber(set?.[field.prop]);
    if (value !== null) values[field.prop] = value;
  }
  return values;
}

function setIn(object, [key, ...rest], value) {
  const base = object && typeof object === "object" ? object : {};
  return { ...base, [key]: rest.length ? setIn(base[key], rest, value) : value };
}

// The day's lifting sessions, from the program as Today shows it.
export function liftingSessionsFor(program, dateKey) {
  const dayName = getDayName(new Date(`${dateKey}T12:00:00`));
  const live = applyRaceBuild(program, dateKey) || DEFAULT_PROGRAM;
  const day = live[dayName] || DEFAULT_PROGRAM[dayName];
  const sessions = getProgramSessions(day)
    .filter((session) => (session.lifting || []).length > 0)
    .map((session) => ({ ...session, id: session.id || "main" }));
  return { dayName, sessions };
}

// The runner's title for a session.
function sessionTitle(session, fallback) {
  const label = session.label && session.label !== "Session" ? session.label : null;
  return [label, session.title || null].filter(Boolean).join(" · ") || fallback || "Lifting";
}

function planExercise({ data, exercise, exData, dateKey }) {
  const performedName = exData.performedName || exercise.name;
  const progressionExercise = { ...exercise, name: performedName };
  const prescription = buildExercisePrescription({ data, exercise: progressionExercise, todayKey: dateKey });
  const lastRaw = lastSessionSets(data, performedName, dateKey);
  const fields = setFields(exercise);
  const increment = defaultWeightIncrement(exercise);
  const sets = reconcileExerciseSets(exercise, exData.sets || []);
  return {
    name: exercise.name,
    display: performedName,
    ...(exData.skipped ? { skipped: true } : {}),
    restSeconds: suggestRestSeconds(exercise),
    fields: fields.map((field) => ({
      prop: field.prop,
      label: field.label,
      unit: SHORT_UNIT[field.unit] || field.unit,
      step: field.step ?? increment,
      max: FIELD_MAX[field.prop] ?? 1000,
      // Assistance can be zero; it just can't go below it.
      required: !field.optional && field.prop !== "assistance",
    })),
    sets: sets.map((set, setIndex) => {
      if (set.done === true) return { done: true, values: numbers(set, fields) };
      const proposal = proposeSet({ set, setIndex, sets, exercise, prescription, lastRaw });
      return {
        done: false,
        values: numbers(proposal.set, fields),
        ...(proposal.source ? { source: proposal.source.key, sourceLabel: proposal.source.name } : {}),
      };
    }),
  };
}

// `seen` is the ids of watch events the phone has dealt with, so the watch
// can stop showing them as its own.
export function buildWatchPlan({ data = {}, program = null, dateKey, sentAt = new Date().toISOString(), seen = [] } = {}) {
  const { dayName, sessions } = liftingSessionsFor(program, dateKey);
  const exercises = (data[dateKey] || defaultDay()).workout?.exercises || {};
  return {
    v: WATCH_PLAN_VERSION,
    date: dateKey,
    sentAt,
    title: dayName,
    seen: seen.slice(-50),
    sessions: sessions.map((session) => ({
      id: session.id,
      title: sessionTitle(session, dayName),
      exercises: session.lifting.map((exercise) => planExercise({
        data, exercise, exData: exercises[exercise.name] || {}, dateKey,
      })),
    })),
  };
}

export function parseWatchEvent(raw) {
  let event = raw;
  if (typeof raw === "string") {
    try { event = JSON.parse(raw); } catch { return null; }
  }
  if (!event || typeof event !== "object") return null;
  if (typeof event.id !== "string" || !event.id) return null;
  if (event.type !== "set" && event.type !== "finish") return null;
  if (typeof event.date !== "string" || !DATE_KEY.test(event.date)) return null;
  return event;
}

// Applies events in order. Returns the writes to make (one per path, the
// last value wins), the days as they stand after them, and the ids dealt
// with: applied, or set aside because the phone already has that set or the
// exercise isn't in that day's program anymore.
export function applyWatchEvents({ data = {}, program = null, events = [] } = {}) {
  const working = { ...data };
  const writes = new Map();
  const processed = [];
  let applied = 0;

  const write = (dateKey, parts, value) => {
    working[dateKey] = setIn(working[dateKey] || defaultDay(), parts, value);
    writes.set(`${dateKey}|${parts.join(".")}`, { dateKey, path: parts.join("."), value });
  };

  const applySet = (event) => {
    const { sessions } = liftingSessionsFor(program, event.date);
    const exercise = sessions.flatMap((session) => session.lifting).find((item) => item.name === event.exercise);
    if (!exercise) return false;
    const day = working[event.date] || defaultDay();
    const exData = day.workout?.exercises?.[exercise.name] || {};
    const sets = reconcileExerciseSets(exercise, exData.sets || []);
    const setIndex = event.setIndex;
    if (!Number.isInteger(setIndex) || setIndex < 0 || setIndex >= sets.length) return false;
    // Already logged, here or by an earlier copy of this event.
    if (sets[setIndex].done === true) return false;

    const entered = { ...sets[setIndex] };
    for (const field of setFields(exercise)) {
      const value = Number(event.values?.[field.prop]);
      const usable = Number.isFinite(value) && (value > 0 || (field.prop === "assistance" && value === 0));
      entered[field.prop] = usable ? toEntry(value) : "";
    }
    if (!validateSet(entered, exercise).valid) return false;

    const performedName = exData.performedName || exercise.name;
    const progressionExercise = { ...exercise, name: performedName };
    const prescription = buildExercisePrescription({ data: working, exercise: progressionExercise, todayKey: event.date });
    const at = typeof event.at === "string" && !Number.isNaN(Date.parse(event.at)) ? event.at : new Date().toISOString();
    const { exData: logged } = completeSet({
      exData, sets, setIndex, set: entered, exercise, progressionExercise, prescription,
      data: working, todayKey: event.date, performedName, completedAt: at,
    });
    write(event.date, ["workout", "exercises", exercise.name], logged);
    return true;
  };

  // The watch's End marks each of the day's sessions finished whose every
  // exercise is logged or skipped, as Finish does in the runner.
  const applyFinish = (event) => {
    const { sessions } = liftingSessionsFor(program, event.date);
    const at = typeof event.at === "string" && !Number.isNaN(Date.parse(event.at)) ? event.at : new Date().toISOString();
    let changed = false;
    for (const session of sessions) {
      const workout = (working[event.date] || defaultDay()).workout || {};
      if (!isSessionHandled(session.lifting, workout)) continue;
      const current = workout.sessionState?.[session.id] || {};
      if (current.status === "complete") continue;
      write(event.date, ["workout", "sessionState", session.id], { ...current, status: "complete", completedAt: at });
      changed = true;
    }
    return changed;
  };

  for (const raw of events) {
    const event = parseWatchEvent(raw);
    if (!event) continue;
    processed.push(event.id);
    const done = event.type === "set" ? applySet(event) : applyFinish(event);
    if (done) applied += 1;
  }

  const days = {};
  for (const { dateKey } of writes.values()) days[dateKey] = working[dateKey];
  return { writes: [...writes.values()], days, processed, applied };
}

export default { buildWatchPlan, applyWatchEvents, parseWatchEvent, liftingSessionsFor };
