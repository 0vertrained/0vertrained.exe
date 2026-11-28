import { getDayName } from "../constants";
import { isRunCardio, hasCardioResult } from "../cardioLog";
import { getProgramSessions, usesProgramSessions } from "../programSessions";
import { applyRaceBuild } from "../raceBuild";
import { validCourseDate } from "../rehearsal/course";
import { formatRunTime, formatRunPace } from "../watch/healthRuns";
import { METERS_PER_MILE } from "../runPaces";

export const climbId = id => typeof id === "string" && /^[a-z0-9_-]{1,100}$/i.test(id) &&
  !["__proto__", "prototype", "constructor"].includes(id);
const dateDay = (program, date) => applyRaceBuild(program, date)?.[getDayName(new Date(date + "T12:00:00"))];

function busySlot(workout, id, block) {
  const state = workout?.sessionState?.[id];
  return Boolean(state?.startedAt || ["active", "complete"].includes(state?.status) || block?.startedAt ||
    block?.notes?.trim?.() || block?.activityRefs?.length || hasCardioResult(block));
}

export function climbSlots(program, entries, date) {
  if (!validCourseDate(date)) return [];
  const day = dateDay(program, date), workout = entries?.[date]?.workout;
  const split = usesProgramSessions(day);
  return getProgramSessions(day).filter(s => isRunCardio(s.cardio) && !busySlot(workout, s.id, split ? workout?.cardioSessions?.[s.id] : workout?.cardio))
    .map(s => ({ id: s.id, label: [s.label, s.title || s.cardio.type].filter(Boolean).join(" · ") }));
}

export function courseSummary(course) {
  const { id, revision, rootRevision, name, source, distanceMeters, ascentMeters, hasElevation, hasRecordedGhost, landmarks } = course;
  return { id, revision, rootRevision, name, source, distanceMeters, ascentMeters, hasElevation, hasRecordedGhost, landmarks };
}

// Keep traces local. The daily entry carries enough information to display a
// result on another device and synchronize the same recording with Health.
function attemptSummary(envelope, owner) {
  const { course, run, dateKey } = envelope || {};
  if (!owner || run?.owner !== owner || !validCourseDate(dateKey) || !climbId(run.id) || !climbId(run.recordingId) ||
      !course || course.revision !== run.courseRevision || course.id !== run.courseId || !["finished", "partial"].includes(run.status) ||
      !Number.isFinite(course.distanceMeters) || !Number.isFinite(run.startedAt) || !Number.isFinite(run.endedAt) || run.endedAt < run.startedAt ||
      !Number.isFinite(run.distanceMeters) || run.distanceMeters < 0 || run.distanceMeters > course.distanceMeters + 1 ||
      !Array.isArray(run.marks)) return null;
  const fields = ["id", "recordingId", "owner", "courseId", "courseRevision", "name", "reference", "paceSecondsPerKm",
    "status", "startedAt", "endedAt", "distanceMeters", "verifiedMeters", "marks", "estimated", "uncertain",
    "deckObservedMeters", "deckMatchedMeters", "deckLimitedMeters"];
  const summary = Object.fromEntries(fields.filter(key => run[key] !== undefined).map(key => [key, run[key]]));
  return { course: courseSummary(course), run: summary, dateKey };
}

export function recordClimb(workout = {}, envelope, owner, program) {
  const latest = attemptSummary(envelope, owner);
  if (!latest) return null;
  const { course, run, dateKey } = latest;
  const past = envelope.previousAttempts || [];
  if (!Array.isArray(past)) return null;
  const rows = [...past.map(row => attemptSummary(row, owner)), latest];
  if (!rows.every(row => row && row.dateKey === dateKey && row.run.recordingId === run.recordingId)) return null;
  if (rows.every(row => workout.climbAttempts?.[row.run.id])) return workout;
  const next = { ...workout, climbAttempts: { ...workout.climbAttempts, ...Object.fromEntries(rows.map(row => [row.run.id, row])) } };
  const total = envelope.recording;
  const start = total?.startedAt ?? run.startedAt;
  const end = total?.endedAt ?? run.endedAt;
  const meters = total?.distanceMeters ?? run.distanceMeters;
  if (![start, end, meters].every(Number.isFinite) || end < start || meters < 0) return null;
  const seconds = Math.round((end - start) / 1000);
  if (!seconds && !meters) return next;
  const sessions = { ...workout.cardioSessions };
  const recording = run.recordingId.toLowerCase();
  const extra = "climb-" + recording;
  const same = block => block?.climbRecordingId?.toLowerCase() === recording;
  const previousKey = Object.keys(sessions).find(key => same(sessions[key]));
  const old = same(workout.cardio) ? workout.cardio : sessions[previousKey];
  const schedule = program?.__climbs?.[dateKey];
  const slot = envelope.sessionId ?? run.sessionId;
  const day = dateDay(program, dateKey);
  const assigned = climbId(slot) && rows.some(row => row.course.revision === schedule?.revision) && schedule?.sessionId === slot &&
    getProgramSessions(day).some(item => item.id === slot && isRunCardio(item.cardio));
  const main = assigned && !usesProgramSessions(day) && slot === "main";
  const desired = assigned ? slot : extra;
  // A manual or already logged workout owns its slot. Keep this as another
  // session if a competing device filled that planned slot in the meantime.
  const dest = main ? workout.cardio : sessions[desired];
  const occupied = !same(dest) && busySlot(workout, desired, dest);
  const miles = meters / METERS_PER_MILE;
  const block = { ...(old || (!occupied && dest) || {}), modality: "run", type: course.name,
    climbRecordingId: run.recordingId, indoor: true, unplanned: !assigned || occupied,
    startTime: new Date(start).toISOString() };
  if (!old?.activityRefs?.some(ref => ref.source === "apple")) {
    block.miles = miles ? String(Number(miles.toFixed(3))) : "";
    block.time = formatRunTime(seconds);
    block.pace = miles > 0 && seconds > 0 ? formatRunPace(seconds / miles) : "";
  }
  const targetKey = occupied ? extra : desired;
  if (previousKey && (main && !occupied || previousKey !== targetKey)) delete sessions[previousKey];
  if (main && !occupied || same(workout.cardio)) next.cardio = block;
  else sessions[targetKey] = block;
  next.cardioSessions = sessions;
  return next;
}

export function climbHistory(entries) {
  return Object.values(entries || {}).flatMap(day => Object.values(day?.workout?.climbAttempts || {}))
    .filter(item => item?.course?.revision && item?.run?.id && Array.isArray(item.run.marks));
}
