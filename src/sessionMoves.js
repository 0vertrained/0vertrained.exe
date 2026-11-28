// Each edit identifies one occurrence in the resolved program by date and slot.
// Incoming workouts keep a distinct log key even if the destination also has a PM.
import { legacyCardioSessionId } from "./cardioLog";
import { shiftDate } from "./coachWindows";
import { getProgramSessions, plannedSessionTime, usesProgramSessions } from "./programSessions";
import { describeRoadTrailWeek } from "./plans/roadTrailHybrid";
import { validDateKey } from "./plans/hybridAlignmentDates";
import { datedSessionEdits, moveLock, raceMoveLock, weekdayOf, weekStartOf } from "./weekMoves";

const movedId = edit => `moved-${edit.from}-${edit.id}`;
const signature = session => JSON.stringify([session.title, session.cardio?.type || null, session.lifting.map(ex => ex.name)]);
function raceLock(program, key, day, racePlanOn) {
  const raceDay = getProgramSessions(day).some(s => s.cardio?.planRole === "race");
  return raceMoveLock(program, key) || moveLock(racePlanOn(program, key)?.raceDate, key) ||
    moveLock(describeRoadTrailWeek(program, key)?.raceDate, key) || (raceDay ? "Race day" : null);
}

function availableSlot(day, session) {
  const times = new Set(getProgramSessions(day).map(plannedSessionTime));
  const options = plannedSessionTime(session) < "12:00"
    ? [session.timeOfDay || "morning", "midday", "afternoon", "evening", "night"]
    : [session.timeOfDay, "night", "afternoon", "midday", "morning"];
  return options.find(timeOfDay => !times.has(plannedSessionTime({ timeOfDay })));
}

function withSessions(day, sessions) {
  return { ...day, type: sessions.map(s => s.title).join(" + ") || "Rest",
    code: sessions.length > 1 ? "SPLIT" : sessions[0]?.lifting.length ? "LIFT" : sessions.length ? "CARDIO" : "REST",
    sessions, lifting: [], cardio: null };
}

function occupied(day, session) {
  const names = new Set(session.lifting.map(ex => ex.name));
  return getProgramSessions(day).some(other => other.lifting.some(ex => names.has(ex.name)));
}

export function applySessionEdits(program, scheduled, dateKey, resolveBase, racePlanOn) {
  const edits = datedSessionEdits(program);
  if (!edits.length) return scheduled;
  const monday = weekStartOf(dateKey);
  const sunday = shiftDate(monday, 6);
  const inWeek = key => key && key >= monday && key <= sunday;
  const cache = new Map([[monday, scheduled]]);
  const baseDay = key => {
    const start = weekStartOf(key);
    if (!cache.has(start)) cache.set(start, resolveBase(program, key));
    return cache.get(start)?.[weekdayOf(key)];
  };
  let result = scheduled;
  function update(key, transform) {
    if (!inWeek(key)) return;
    if (result === scheduled) result = { ...scheduled };
    const name = weekdayOf(key);
    const day = result[name];
    result[name] = withSessions(day, transform(getProgramSessions(day)));
  }
  for (const edit of edits) {
    if (!inWeek(edit.from) && !inWeek(edit.to)) continue;
    const session = getProgramSessions(baseDay(edit.from)).find(item => item.id === edit.id);
    if (!session || signature(session) !== edit.signature || raceLock(program, edit.from, baseDay(edit.from), racePlanOn)) continue;
    if (edit.to && (raceLock(program, edit.to, baseDay(edit.to), racePlanOn) || occupied(baseDay(edit.to), session))) continue;
    update(edit.from, slots => slots.filter(s => s.id !== edit.id));
    if (edit.to) {
      const timeOfDay = edit.timeOfDay || session.timeOfDay;
      const label = /^(am|pm)$/i.test(session.label) ? (plannedSessionTime({ timeOfDay }) < "12:00" ? "AM" : "PM") : session.label;
      update(edit.to, slots => [...slots.filter(s => s.id !== movedId(edit)), { ...session, id: movedId(edit), timeOfDay, label }]);
    }
  }
  return result;
}

function cardioEdited(block) {
  return Boolean(block && (Number(block.miles) > 0 || String(block.time || "").trim() || block.notes?.trim?.() ||
    block.startedAt || block.activityRefs?.length));
}

function sessionStarted(session, workout, split) {
  if (!workout || !session) return false;
  const state = workout.sessionState?.[session.id];
  return Boolean(state?.startedAt || state?.status === "active" || state?.status === "complete" ||
    workout.added?.some?.(ex => ex?.session === session.id) ||
    session.lifting.some(ex => Object.keys(workout.exercises?.[ex.name] || {}).length) ||
    workout.whoopHeartRate?.[session.id]?.count || workout.whoopHeartRate?.[`cardio-${session.id}`]?.count ||
    (session.cardio && cardioEdited(split ? workout.cardioSessions?.[session.id] : workout.cardio)));
}

export function workoutStarted(workout) {
  return Boolean(workout && (workout.completed || workout.customPlanSnapshot || workout.watchWorkouts?.length || workout.added?.length ||
    Object.values(workout.exercises || {}).some(ex => Object.keys(ex || {}).length) ||
    Object.values(workout.sessionState || {}).some(s => s?.startedAt || s?.status === "active" || s?.status === "complete") ||
    Object.values(workout.whoopHeartRate || {}).some(pulse => pulse?.count > 0) ||
    cardioEdited(workout.cardio) || Object.values(workout.cardioSessions || {}).some(cardioEdited)));
}

// All the guards also run when the athlete confirms, using the latest log entries.
export function prepareSessionChange(program, entries, { from, id, to, todayKey, undo = false }, resolveBase, resolveLive, racePlanOn) {
  const fail = error => ({ error });
  if (!validDateKey(from) || !validDateKey(todayKey) || typeof id !== "string") return fail("Choose a scheduled session.");
  if (program?.__sessionEdits && program.__sessionEdits.version !== 1) return fail("Update the app to edit this schedule.");
  const edits = datedSessionEdits(program);
  const previous = edits.find(edit => edit.from === from && edit.id === id);
  if (undo ? !previous : previous) return fail("This session’s schedule has changed.");
  const origin = resolveBase(program, from)?.[weekdayOf(from)];
  const session = getProgramSessions(origin).find(item => item.id === id);
  const dest = undo ? previous.to : to;
  if (!undo && (!session || !usesProgramSessions(origin))) return fail("Choose a scheduled AM or PM session.");
  if (dest !== null && (!validDateKey(dest) || dest === from)) return fail("Choose a different destination date.");
  if (!undo && dest && (dest < todayKey || dest > shiftDate(todayKey, 7))) return fail("Choose today or one of the next seven days.");
  if (!undo && (from < weekStartOf(todayKey) || from > shiftDate(weekStartOf(todayKey), 6))) return fail("Choose a session from this week.");
  const originalWorkout = entries?.[from]?.workout;
  const legacyId = legacyCardioSessionId(getProgramSessions(origin), originalWorkout);
  const siblingLogged = (legacyId && legacyId !== id) || getProgramSessions(origin).some(slot =>
    slot.id !== id && sessionStarted(slot, originalWorkout, true));
  const unassignedWatchLift = session?.lifting.length && originalWorkout?.watchWorkouts?.length && !siblingLogged;
  if (id === legacyId || sessionStarted(session, originalWorkout, true) || originalWorkout?.customPlanSnapshot ||
      unassignedWatchLift) return fail("This session already has training logged.");
  if (!undo && originalWorkout?.completed && !siblingLogged) return fail("Training already logged for this day.");
  const destBase = dest ? resolveBase(program, dest)?.[weekdayOf(dest)] : null;
  if (!undo) {
    const lock = raceLock(program, from, origin, racePlanOn) || (dest && raceLock(program, dest, destBase, racePlanOn));
    if (lock) return fail(lock);
  }
  let timeOfDay;
  if (dest) {
    const destination = edits.length ? resolveLive(program, dest)?.[weekdayOf(dest)] : destBase;
    const destWorkout = entries?.[dest]?.workout;
    // Adding to or removing from a legacy day changes its cardio storage path.
    // Keep that path stable once the athlete has begun recording on that day.
    const unassignedCardio = session?.cardio && !destWorkout?.cardio?.unplanned && cardioEdited(destWorkout?.cardio);
    if (unassignedCardio || destWorkout?.customPlanSnapshot || (workoutStarted(destWorkout) && !usesProgramSessions(destBase))) {
      return fail("Training already logged on the destination date.");
    }
    const incoming = { ...session, lifting: session?.lifting || [], cardio: true, id: movedId({ from, id }) };
    if (sessionStarted(incoming, destWorkout, true)) return fail("The moved session has already started.");
    if (!undo) {
      timeOfDay = availableSlot(destination, session);
      if (!timeOfDay) return fail("All session times are booked. Choose another day.");
    }
    if (!undo && (occupied(destination, session) || occupied(destBase, session))) return fail("Both sessions include the same lift. Choose another day.");
  }
  const items = undo ? edits.filter(edit => edit !== previous) : [...edits, { from, id, to, title: session.title, signature: signature(session), ...(timeOfDay && { timeOfDay }) }];
  const next = { ...program };
  if (items.length) next.__sessionEdits = { version: 1, items };
  else delete next.__sessionEdits;
  return { program: next };
}
