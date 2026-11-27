// src/watch/watchPlan.js
// What the Apple Watch gets from the phone, and what the phone does with what
// comes back. The plan is a day's runs (./runWorkouts) and its lifting, with
// every number the runner would show already worked out: what each open set
// is filled from and says so, how long to rest, how far one step of the crown
// moves each field. The watch logs sets against it and sends them back as
// events, which are written the way the runner writes them (completeSet), so
// the phone stays the only writer of the log. Nothing here talks to the
// watch; useWatchBridge does.

import { DEFAULT_PROGRAM, defaultDay, getDayName, getTodayKey } from "../constants";
import { applyRaceBuild } from "../raceBuild";
import { getProgramSessions } from "../programSessions";
import { withAdded } from "../addedExercises";
import { resolveCustomTrainingDay, sessionPrescription } from "../customTrainingDay";
import { lastSessionSets } from "../setGhosts";
import { suggestRestSeconds } from "../sessionIntelligence";
import { proposeSet, setFields } from "../workout/setFill";
import { completeSet } from "../workout/completeSet";
import { defaultWeightIncrement, isSessionHandled, reconcileExerciseSets, validateSet } from "../workoutLogging";
import { runWorkoutsFor } from "./runWorkouts";
import { WATCH_WORKOUTS_PER_DAY, watchWorkoutRecord } from "./liftSummary";

export const WATCH_PLAN_VERSION = 1;
// What the phone sends: today's plan with the week's day plans, today first.
export const WATCH_WEEK_VERSION = 1;
export const WATCH_WEEK_DAYS = 7;

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

// The day's lifting sessions, from the program as Today shows it, with any
// exercises added to that day (`workout` is the day's logged workout).
export function liftingSessionsFor(program, dateKey, workout = null, { data, currentDateKey = dateKey, wearableScore, readiness } = {}) {
  const dayName = getDayName(new Date(`${dateKey}T12:00:00`));
  const live = applyRaceBuild(program, dateKey) || DEFAULT_PROGRAM;
  const template = live[dayName] || DEFAULT_PROGRAM[dayName];
  const day = resolveCustomTrainingDay({ day: template,
    data: data || { [dateKey]: { workout } }, dateKey, currentDateKey, wearableScore, readiness });
  const sessions = getProgramSessions(withAdded(day, workout))
    .filter((session) => (session.lifting || []).length > 0)
    .map((session) => ({ ...session, id: session.id || "main" }));
  return { dayName, template, day, sessions };
}

// The runner's title for a session.
function sessionTitle(session, fallback) {
  const label = session.label && session.label !== "Session" ? session.label : null;
  return [label, session.title || null].filter(Boolean).join(" · ") || fallback || "Lifting";
}

function planExercise({ data, exercise, exData, dateKey, adaptive }) {
  const performedName = exData.performedName || exercise.name;
  const prescription = sessionPrescription({ exercise, data, performedName, dateKey });
  const lastRaw = lastSessionSets(data, performedName, dateKey);
  const fields = setFields(exercise);
  const increment = defaultWeightIncrement(exercise);
  const sets = reconcileExerciseSets(exercise, exData.sets || []);
  return {
    name: exercise.name,
    display: performedName,
    ...(exData.skipped ? { skipped: true } : {}),
    restSeconds: suggestRestSeconds(exercise),
    ...(adaptive && exercise.rir != null && { targetRir: String(exercise.rir) }),
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
export function buildWatchPlan({ data = {}, program = null, dateKey, currentDateKey = dateKey, wearableScore, readiness, sentAt = new Date().toISOString(), seen = [] } = {}) {
  const { dayName, day, sessions } = liftingSessionsFor(program, dateKey, data[dateKey]?.workout, { data, currentDateKey, wearableScore, readiness });
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
        data, exercise, exData: exercises[exercise.name] || {}, dateKey, adaptive: day.adaptivePlan?.version === 1,
      })),
    })),
    // Today's runs, which the watch opens in its Workout app.
    runs: ["rest", "safety"].includes(day.adaptation?.status) && !getProgramSessions(day).some(session => session.cardio)
      ? [] : runWorkoutsFor(program, dateKey),
  };
}

function addDays(dateKey, days) {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * Today's plan and the next six days', so the watch has a day's lifts and
 * runs even when the iPhone app isn't opened that day. Every day is worked
 * out from the log as it stands; the phone sends the week again whenever
 * anything in it changes.
 *
 * The top level is today's plan as a single-day watch app reads it, so a
 * watch app built before weeks keeps working until it's rebuilt; `days`
 * holds the week, and `week` says which version of it this is.
 */
export function buildWatchWeek({ data = {}, program = null, todayKey, wearableScore, readiness, sentAt = new Date().toISOString(), seen = [], days = WATCH_WEEK_DAYS } = {}) {
  const today = buildWatchPlan({ data, program, dateKey: todayKey, currentDateKey: todayKey, wearableScore, readiness, sentAt, seen });
  const plans = [];
  for (let offset = 0; offset < days; offset += 1) {
    const { sentAt: omitSentAt, seen: omitSeen, ...plan } = offset === 0
      ? today
      : buildWatchPlan({ data, program, dateKey: addDays(todayKey, offset), currentDateKey: todayKey, sentAt });
    void omitSentAt;
    void omitSeen;
    plans.push(plan);
  }
  return { ...today, week: WATCH_WEEK_VERSION, days: plans };
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
export function applyWatchEvents({ data = {}, program = null, events = [], currentDateKey = getTodayKey(), wearableScore, readiness } = {}) {
  const working = { ...data };
  const writes = new Map();
  const processed = [];
  let applied = 0;

  const write = (dateKey, parts, value) => {
    working[dateKey] = setIn(working[dateKey] || defaultDay(), parts, value);
    writes.set(`${dateKey}|${parts.join(".")}`, { dateKey, path: parts.join("."), value });
  };

  const applySet = (event) => {
    const { sessions, day: projected, template } = liftingSessionsFor(program, event.date, working[event.date]?.workout,
      { data: working, currentDateKey, wearableScore, readiness });
    const paused = ["rest", "safety"].includes(projected.adaptation?.status);
    const baseSession = projected.adaptivePlan?.version === 1 && template.adaptivePlan?.version === 1
      ? getProgramSessions(template).find(session => session.lifting.some(ex => ex.name === event.exercise)) : null;
    const baseExercise = baseSession?.lifting.find(ex => ex.name === event.exercise);
    const exercise = sessions.flatMap(session => session.lifting).find(ex => ex.name === event.exercise) || (paused && baseExercise);
    if (!exercise) return false;
    const day = working[event.date] || defaultDay();
    const exData = day.workout?.exercises?.[exercise.name] || {};
    const setIndex = event.setIndex;
    if (!Number.isInteger(setIndex) || setIndex < 0) return false;
    let count = exercise.sets;
    const custom = projected.adaptivePlan?.version === 1 && Boolean(baseExercise || exercise.adaptivePrescription);
    if (custom) {
      // An offline watch may still have a larger, valid prescription from
      // before today's check-in. The adaptive planner can add one base set.
      const base = Number(exercise.adaptivePrescription?.baseSets ?? baseExercise?.sets ?? exercise.sets);
      const maximum = Math.max(base + 1, exData.sets?.length || 0);
      if (setIndex >= maximum) return false;
      count = Math.max(count, exData.sets?.length || 0, setIndex + 1);
    }
    if (paused && custom) count = Math.max(exData.sets?.length || 0, setIndex + 1);
    const sets = reconcileExerciseSets({ ...exercise, sets: count }, exData.sets || []);
    if (setIndex >= sets.length) return false;
    // Already logged, here or by an earlier copy of this event.
    if (sets[setIndex].done === true) return false;

    const entered = { ...sets[setIndex] };
    for (const field of setFields(exercise)) {
      const value = Number(event.values?.[field.prop]);
      const usable = Number.isFinite(value) && (value > 0 || (field.prop === "assistance" && value === 0));
      entered[field.prop] = usable ? toEntry(value) : "";
    }
    const reserve = event.values?.rir;
    if (custom && Number.isInteger(reserve) && reserve >= 0 && reserve <= 10) entered.rir = String(reserve);
    if (!validateSet(entered, exercise).valid) return false;

    const performedName = exData.performedName || exercise.name;
    const progressionExercise = { ...exercise, name: performedName };
    const prescription = paused ? null : sessionPrescription({ data: working, exercise, performedName, dateKey: event.date });
    const at = typeof event.at === "string" && !Number.isNaN(Date.parse(event.at)) ? event.at : new Date().toISOString();
    const { exData: logged } = completeSet({
      exData, sets, setIndex, set: entered, exercise, progressionExercise, prescription,
      data: working, todayKey: event.date, performedName, completedAt: at,
    });
    let snapshotDay = projected;
    if (paused && baseSession && baseExercise) {
      // Keep a completed offline lift visible even when the phone subsequently
      // called for rest. Only its recorded slots belong in the day's snapshot.
      const previous = getProgramSessions(projected);
      const session = previous.find(s => s.id === baseSession.id) || { ...baseSession, lifting: [], cardio: null };
      const loggedExercise = { ...baseExercise, sets: count };
      const keep = session.lifting.some(ex => ex.name === exercise.name)
        ? session.lifting.map(ex => ex.name === exercise.name ? loggedExercise : ex) : [...session.lifting, loggedExercise];
      const sessions = [...previous.filter(s => s.id !== session.id), { ...session, lifting: keep }];
      snapshotDay = { ...projected, lifting: sessions.flatMap(s => s.lifting),
        ...(Array.isArray(template.sessions) && { sessions }) };
    }
    if (projected.adaptation?.dateKey === event.date && (!day.workout?.customPlanSnapshot || snapshotDay !== projected)) {
      write(event.date, ["workout", "customPlanSnapshot"], { dateKey: event.date, day: snapshotDay });
    }
    write(event.date, ["workout", "exercises", exercise.name], logged);
    return true;
  };

  // The watch's End marks each of the day's sessions finished whose every
  // exercise is logged or skipped, as Finish does in the runner.
  const applyFinish = (event) => {
    const { sessions } = liftingSessionsFor(program, event.date, working[event.date]?.workout,
      { data: working, currentDateKey, wearableScore, readiness });
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

  // What the watch measured over its workout (time, heart rate, calories) is
  // kept on the day once per workout, whether or not a session finished.
  const keepWorkout = (event) => {
    const record = watchWorkoutRecord(event);
    if (!record) return false;
    const workout = (working[event.date] || defaultDay()).workout || {};
    const kept = Array.isArray(workout.watchWorkouts) ? workout.watchWorkouts : [];
    if (kept.some((item) => item?.id === record.id)) return false;
    write(event.date, ["workout", "watchWorkouts"], [...kept, record].slice(-WATCH_WORKOUTS_PER_DAY));
    return true;
  };

  for (const raw of events) {
    const event = parseWatchEvent(raw);
    if (!event) continue;
    processed.push(event.id);
    let done;
    if (event.type === "set") done = applySet(event);
    else {
      const finished = applyFinish(event);
      const kept = keepWorkout(event);
      done = finished || kept;
    }
    if (done) applied += 1;
  }

  const days = {};
  for (const { dateKey } of writes.values()) days[dateKey] = working[dateKey];
  return { writes: [...writes.values()], days, processed, applied };
}

export default { buildWatchPlan, applyWatchEvents, parseWatchEvent, liftingSessionsFor };
