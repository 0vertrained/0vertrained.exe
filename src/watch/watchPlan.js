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
import { defaultWeightIncrement, isSessionHandled, reconcileExerciseSets, resolveTrackingMode, TRACKING_MODES, validateSet } from "../workoutLogging";
import { availableSwapNames, exercisePrescription, findLibraryExercise } from "../programExerciseLibrary";
import { getRankedSubstitutions } from "../exerciseSubstitutions";
import { readSupersetPref } from "../liftLogPrefs";
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

// Keep the planned slot stable. Only offer movements measured in the same
// units so historical logs, the iPhone editor and the crown all agree.
function swapNames(exercise, preferences) {
  const library = findLibraryExercise(exercise.name);
  if (!exercise.swapOptions && library && preferences?.equipment) return availableSwapNames(library, preferences);
  const names = exercise.swapOptions ?? (library ? library.alternatives : (getRankedSubstitutions(exercise.name)?.subs || []).map(s => s.name));
  const options = names.map(name => {
    const match = findLibraryExercise(name) || findLibraryExercise(name.replace(/\bDB\b/gi, "Dumbbell"));
    return match?.name || name;
  });
  return [...new Set(options)].filter(name => name.toLowerCase() !== exercise.name.toLowerCase() &&
    resolveTrackingMode(exercisePrescription(name) || { name }) === resolveTrackingMode(exercise)).slice(0, 4);
}

function planExercise({ data, exercise, exData, dateKey, adaptive, dayName, reduced }) {
  const performedName = exData.performedName || exercise.name;
  const swapped = performedName !== exercise.name;
  const movement = swapped ? { ...exercise, name: performedName, notes: exercisePrescription(performedName)?.notes } : exercise;
  const prescription = sessionPrescription({ exercise, data, performedName, dateKey });
  const lastRaw = lastSessionSets(data, performedName, dateKey);
  const fields = setFields(movement);
  const increment = defaultWeightIncrement(movement);
  const sets = reconcileExerciseSets(exercise, exData.sets || []);
  return {
    name: exercise.name,
    display: performedName,
    ...(exData.skipped ? { skipped: true } : {}),
    restSeconds: suggestRestSeconds(exercise),
    ...((exData.pairNext ?? (readSupersetPref(dayName, exercise.name) || exercise.pairNext)) && { pairNext: true }),
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
      if (set.done === true) return { done: true, values: numbers(set, fields),
        ...(set.watchEventID && { watchEventID: set.watchEventID, completedAt: set.completedAt }) };
      const proposal = proposeSet({ set, setIndex, sets, exercise: movement, prescription, lastRaw });
      // A substituted lift can show its own recent working load. When
      // recovery reduced today's work, leave unfamiliar weights to the lifter.
      if (swapped && adaptive && !reduced && !proposal.set.weight && lastRaw?.date >= addDays(dateKey, -42)) {
        const previous = lastRaw.sets[setIndex] || lastRaw.sets.at(-1);
        return { done: false, values: numbers(previous, fields), source: "last", sourceLabel: "Last time" };
      }
      return {
        done: false,
        values: numbers(proposal.set, fields),
        ...(proposal.source ? { source: proposal.source.key, sourceLabel: proposal.source.name } : {}),
      };
    }),
  };
}

function watchExercise(args) {
  const planned = planExercise(args);
  const choices = [args.exercise.name, ...swapNames(args.exercise, args.builderPreferences)].filter(name => name !== planned.display);
  if (choices.length) {
    planned.swaps = choices.map(name => {
      const variant = planExercise({ ...args, exData: { performedName: name } });
      return { name: variant.display, fields: variant.fields, sets: variant.sets };
    });
  }
  return planned;
}

// `seen` is the ids of watch events the phone has dealt with, so the watch
// can stop showing them as its own.
export function buildWatchPlan({ owner = null, builderPreferences, data = {}, program = null, dateKey, currentDateKey = dateKey, wearableScore, readiness, sentAt = new Date().toISOString(), seen = [] } = {}) {
  const { dayName, day, sessions } = liftingSessionsFor(program, dateKey, data[dateKey]?.workout, { data, currentDateKey, wearableScore, readiness });
  const exercises = (data[dateKey] || defaultDay()).workout?.exercises || {};
  const cardio = ["rest", "safety"].includes(day.adaptation?.status) && !getProgramSessions(day).some(session => session.cardio)
    ? [] : runWorkoutsFor(program, dateKey);
  return {
    v: WATCH_PLAN_VERSION,
    ...(owner && { owner }),
    date: dateKey,
    sentAt,
    title: dayName,
    ...(day.adaptation?.reason && { adaptationReason: day.adaptation.reason }),
    seen: seen.slice(-50),
    sessions: sessions.map((session) => ({
      id: session.id,
      title: sessionTitle(session, dayName),
      exercises: session.lifting.map((exercise) => watchExercise({
        data, exercise, exData: exercises[exercise.name] || {}, dateKey, dayName, adaptive: day.adaptivePlan?.version === 1,
        builderPreferences: day.adaptivePlan ? builderPreferences : null,
        reduced: ["reduce", "hold", "rest", "safety"].includes(day.adaptation?.status),
      })),
    })),
    // Older Watch apps open everything in 'runs' as a running workout.
    runs: cardio.filter(activity => !activity.activity || activity.activity === "run"),
    cardio,
  };
}

function addDays(dateKey, days) {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const safeName = value => typeof value === "string" && value.trim().length > 0 && value.length <= 120 &&
  !value.includes(".") && !["__proto__", "prototype", "constructor"].includes(value) &&
  [...value].every(char => char.charCodeAt(0) >= 32);

// A phone schedule may have been replaced while the watch was offline.
// Only restore the small validated part of the dated plan needed to log it.
function offlineSessions(event) {
  if (!safeName(event.workoutID) || !Array.isArray(event.offlinePlan?.sessions)) return [];
  return event.offlinePlan.sessions.slice(0, 8).filter(s => safeName(s?.id) && Array.isArray(s.exercises)).map(s => ({
    id: s.id,
    lifting: s.exercises.slice(0, 40).filter(e => safeName(e?.name) && Number.isInteger(e.count) && e.count >= 1 && e.count <= 50).map(e => {
      const fields = Array.isArray(e.fields) ? e.fields : [];
      const mode = fields.includes("duration") ? TRACKING_MODES.TIMED_HOLD : fields.includes("distance") ? TRACKING_MODES.CARRY :
        fields.includes("assistance") ? TRACKING_MODES.ASSISTED_REPS : resolveTrackingMode(exercisePrescription(e.display || e.name) || { name: e.name });
      return { name: e.name, sets: e.count, reps: Number(e.reps) > 0 ? e.reps : exercisePrescription(e.name)?.reps || 8, trackingMode: mode,
        offlineSwaps: [e.display, ...(Array.isArray(e.swaps) ? e.swaps.slice(0, 5) : [])].filter(safeName),
        ...(String(e.targetRir ?? "").trim() !== "" && { rir: e.targetRir }) };
    }),
  }));
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
export function buildWatchWeek({ owner = null, builderPreferences, data = {}, program = null, todayKey, wearableScore, readiness, sentAt = new Date().toISOString(), seen = [], days = WATCH_WEEK_DAYS } = {}) {
  const today = buildWatchPlan({ owner, builderPreferences, data, program, dateKey: todayKey, currentDateKey: todayKey, wearableScore, readiness, sentAt, seen });
  const plans = [];
  for (let offset = 0; offset < days; offset += 1) {
    const { sentAt: omitSentAt, seen: omitSeen, ...plan } = offset === 0
      ? today
      : buildWatchPlan({ owner, builderPreferences, data, program, dateKey: addDays(todayKey, offset), currentDateKey: todayKey, sentAt });
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
  if (!["set", "finish", "swap", "undo", "pair"].includes(event.type)) return null;
  if (typeof event.date !== "string" || !DATE_KEY.test(event.date)) return null;
  return event;
}

// Applies events in order. Returns the writes to make (one per path, the
// last value wins), the days as they stand after them, and the ids dealt
// with: applied, or set aside because the phone already has that set or the
// exercise isn't in that day's program anymore.
export function applyWatchEvents({ owner = null, acceptLegacy = true, data = {}, program = null, events = [], currentDateKey = getTodayKey(), wearableScore, readiness } = {}) {
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
    const offline = offlineSessions(event).find(s => s.id === event.session)?.lifting.find(ex => ex.name === event.exercise);
    const planned = sessions.find(s => !event.session || s.id === event.session)?.lifting.find(ex => ex.name === event.exercise) || (paused && baseExercise);
    const exercise = planned || offline;
    if (!exercise) return false;
    const day = working[event.date] || defaultDay();
    let exData = day.workout?.exercises?.[exercise.name] || {};
    if (exData.watchUndoneIDs?.includes(event.id)) return false;
    const performed = event.performedName;
    if (performed != null && performed !== (exData.performedName || exercise.name)) {
      if (exData.sets?.some(s => s.done) || exData.watchSwapAt ||
          ![exercise.name, ...swapNames(exercise), ...(offline?.offlineSwaps || [])].includes(performed)) return false;
      exData = { ...exData, performedName: performed, substitutionReason: "equipment", sets: [], progressionDecision: null, nextPrescription: null };
    }
    const setIndex = event.setIndex;
    if (!Number.isInteger(setIndex) || setIndex < 0) return false;
    let count = Math.max(exercise.sets, offline?.sets || 0);
    const custom = projected.adaptivePlan?.version === 1 && Boolean(baseExercise || exercise.adaptivePrescription);
    if (custom) {
      // An offline watch may still have a larger, valid prescription from
      // before today's check-in. The adaptive planner can add one base set.
      const base = Number(exercise.adaptivePrescription?.baseSets ?? baseExercise?.sets ?? exercise.sets);
      const maximum = Math.max(base + 1, offline?.sets || 0, exData.sets?.length || 0);
      if (setIndex >= maximum) return false;
      count = Math.max(count, exData.sets?.length || 0, setIndex + 1);
    }
    if (paused && custom) count = Math.max(exData.sets?.length || 0, setIndex + 1);
    const sets = reconcileExerciseSets({ ...exercise, sets: count }, exData.sets || []);
    if (setIndex >= sets.length) return false;
    // Already logged, here or by an earlier copy of this event.
    if (sets[setIndex].done === true) return false;

    const entered = { ...sets[setIndex], watchEventID: event.id };
    for (const field of setFields(exercise)) {
      const value = Number(event.values?.[field.prop]);
      const usable = Number.isFinite(value) && (value > 0 || (field.prop === "assistance" && value === 0));
      entered[field.prop] = usable ? toEntry(value) : "";
    }
    const reserve = event.values?.rir;
    if ((custom || offline?.rir != null) && Number.isInteger(reserve) && reserve >= 0 && reserve <= 10) entered.rir = String(reserve);
    if (!validateSet(entered, exercise).valid) return false;

    const performedName = exData.performedName || exercise.name;
    const progressionExercise = { ...exercise, name: performedName };
    const prescription = paused ? null : sessionPrescription({ data: working, exercise, performedName, dateKey: event.date });
    const at = typeof event.at === "string" && !Number.isNaN(Date.parse(event.at)) ? event.at : new Date().toISOString();
    const { exData: logged } = completeSet({
      exData, sets, setIndex, set: entered, exercise, progressionExercise, prescription,
      data: working, todayKey: event.date, performedName, completedAt: at,
    });
    if (!planned && offline) {
      const added = Array.isArray(day.workout?.added) ? day.workout.added : [];
      if (!added.some(e => e.name === exercise.name)) {
        const { name, sets: count, reps, trackingMode } = offline;
        write(event.date, ["workout", "added"], [...added, { name, sets: count, reps, trackingMode, session: event.session }]);
      }
    }
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

  function applyGymEdit(event) {
    if (!safeName(event.exercise) || !safeName(event.session)) return false;
    const workout = working[event.date]?.workout || {};
    const path = ["workout", "exercises", event.exercise];
    const log = workout.exercises?.[event.exercise] || {};
    if (event.type === "undo") {
      if (!safeName(event.targetID) || !Number.isInteger(event.setIndex) || event.setIndex < 0 || event.setIndex >= 50 ||
          log.watchUndoneIDs?.includes(event.targetID)) return false;
      // Tombstone the original operation even if its transfer arrives late.
      const updated = { ...log, watchUndoneIDs: [...(log.watchUndoneIDs || []), event.targetID].slice(-64) };
      if (log.sets?.[event.setIndex]?.watchEventID === event.targetID) {
        const { completedAt, progressionTarget, targetSource, watchEventID, ...open } = log.sets[event.setIndex];
        void completedAt; void progressionTarget; void targetSource; void watchEventID;
        updated.sets = log.sets.map((s, i) => i === event.setIndex ? { ...open, done: false } : s);
        updated.nextPrescription = null;
        if (log.progressionDecision?.setIndex === event.setIndex) updated.progressionDecision = null;
        const session = workout.sessionState?.[event.session];
        if (session?.status === "complete") write(event.date, ["workout", "sessionState", event.session], { ...session, status: "active", completedAt: null });
      }
      write(event.date, path, updated);
      return true;
    }
    const actual = liftingSessionsFor(program, event.date, workout, { data: working, currentDateKey, wearableScore, readiness }).sessions;
    const offline = offlineSessions(event);
    const session = [...actual, ...offline].find(s => s.id === event.session && s.lifting.some(ex => ex.name === event.exercise));
    if (!session || !Number.isFinite(Date.parse(event.at))) return false;
    const i = session.lifting.findIndex(ex => ex.name === event.exercise);
    const ex = session.lifting[i];
    if (event.type === "pair") {
      if (typeof event.enabled !== "boolean" || session.lifting[i + 1]?.name !== event.partner ||
          (log.watchPairAt && Date.parse(log.watchPairAt) >= Date.parse(event.at))) return false;
      write(event.date, path, { ...log, pairNext: event.enabled, watchPairAt: event.at });
      return true;
    }
    const pinned = offline.find(s => s.id === event.session)?.lifting.find(e => e.name === ex.name);
    if (![ex.name, ...swapNames(ex), ...(pinned?.offlineSwaps || [])].includes(event.performedName) ||
        log.sets?.some(s => s.done) || (log.watchSwapAt && Date.parse(log.watchSwapAt) >= Date.parse(event.at))) return false;
    write(event.date, path, { ...log, performedName: event.performedName === ex.name ? null : event.performedName,
      substitutionReason: event.performedName === ex.name ? null : "equipment", sets: [], nextPrescription: null,
      progressionDecision: null, watchSwapAt: event.at });
    return true;
  }

  // The watch's End marks each of the day's sessions finished whose every
  // exercise is logged or skipped, as Finish does in the runner.
  const applyFinish = (event) => {
    const { sessions } = liftingSessionsFor(program, event.date, working[event.date]?.workout,
      { data: working, currentDateKey, wearableScore, readiness });
    const at = typeof event.at === "string" && !Number.isNaN(Date.parse(event.at)) ? event.at : new Date().toISOString();
    let changed = false;
    const pinned = offlineSessions(event);
    for (const session of pinned.length ? pinned : sessions) {
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
    if (!event || (event.owner == null ? !acceptLegacy : event.owner !== owner)) continue;
    processed.push(event.id);
    let done;
    if (event.type === "set") done = applySet(event);
    else if (event.type === "finish") {
      const finished = applyFinish(event);
      const kept = keepWorkout(event);
      done = finished || kept;
    } else done = applyGymEdit(event);
    if (done) applied += 1;
  }

  const days = {};
  for (const { dateKey } of writes.values()) days[dateKey] = working[dateKey];
  return { writes: [...writes.values()], days, processed, applied };
}

export default { buildWatchPlan, applyWatchEvents, parseWatchEvent, liftingSessionsFor };
