import { shiftDate } from "./coachWindows";
import { hasLoggedWorkout } from "./loadModel";
import { validDateKey } from "./plans/hybridAlignmentDates";
import { describeRoadTrailWeek } from "./plans/roadTrailHybrid";
import { getProgramSessions, plannedSessionTime, samePrescription } from "./programSessions";
import { applyRaceBuild, racePlanOn, resolveRaceBuildConfig } from "./raceBuild";
import { WEEK_DAYS, weekStartOf } from "./weekMoves";

function changeDate(entries, todayKey) {
  const entry = entries?.[todayKey];
  const workout = entry?.workout;
  const started = workout?.completed || workout?.watchWorkouts?.length || hasLoggedWorkout(entry) ||
    Object.values(workout?.whoopHeartRate || {}).some(pulse => pulse?.count > 0) ||
    Object.values(workout?.sessionState || {}).some(s => s?.startedAt || s?.status === "active" || s?.status === "complete");
  return started ? shiftDate(todayKey, 1) : todayKey;
}

function revise(program, effectiveDate, raceDate, raceName) {
  const marker = program.__hybridBlock;
  const history = Array.isArray(marker.alignments) ? marker.alignments : [];
  // Replacing a pending decision on the same date also handles retry and undo.
  const alignments = history.filter(r => r?.effectiveDate < effectiveDate);
  alignments.push(raceDate ? { effectiveDate, raceDate, raceName } : { effectiveDate, raceDate: null });
  return { ...program, __hybridBlock: { ...marker, alignments } };
}

function daySummary(day) {
  const sessions = getProgramSessions(day);
  const lifts = new Map();
  const cardio = [];
  const parts = [];
  for (const session of sessions) {
    if (session.lifting.length) {
      const count = session.lifting.reduce((sum, ex) => sum + Number(ex.sets || 0), 0);
      parts.push(`${session.title} · ${count} working sets`);
      for (const ex of session.lifting) {
        const reps = ex.repMin && ex.repMin !== ex.reps ? `${ex.repMin}–${ex.reps}` : ex.reps;
        const dose = `${ex.sets} × ${reps}${ex.rir != null ? ` at ${ex.rir} RIR` : ""}`;
        const key = (session.id === "main" ? "" : session.label + " · ") + ex.name;
        lifts.set(key, [lifts.get(key), dose].filter(Boolean).join(" + "));
      }
    }
    if (session.cardio) {
      const work = session.cardio;
      const time = plannedSessionTime(session);
      cardio.push({ work, time });
      const duration = work.minutes ? `${work.minutes} min` : work.miles ? `${work.miles} mi` : "";
      parts.push([time, work.type, duration].filter(Boolean).join(" · "));
    }
  }
  return { lifts, cardio, label: parts.join(" + ") || "Rest" };
}

function compareSchedules(current, proposed, first, last) {
  const changes = [];
  let unchangedRuns = true;
  for (let monday = weekStartOf(first); monday <= last; monday = shiftDate(monday, 7)) {
    const before = applyRaceBuild(current, monday);
    const after = applyRaceBuild(proposed, monday);
    for (const [i, day] of WEEK_DAYS.entries()) {
      const dateKey = shiftDate(monday, i);
      if (dateKey < first || dateKey > last) continue;
      const a = daySummary(before[day]);
      const b = daySummary(after[day]);
      const sameCardio = samePrescription(a.cardio, b.cardio);
      if (!sameCardio) unchangedRuns = false;
      const liftChanges = [];
      for (const name of new Set([...a.lifts.keys(), ...b.lifts.keys()])) {
        const from = a.lifts.get(name);
        const to = b.lifts.get(name);
        if (from !== to) liftChanges.push(`${name} · ${from || "off"} → ${to || "off"}`);
      }
      if (!sameCardio || liftChanges.length) changes.push({ dateKey, before: a.label, after: b.label, liftChanges });
    }
  }
  return { changes, unchangedRuns };
}

// A race moved to an earlier weekday can already belong to the athlete's
// history when the official event date is still ahead. Do not schedule a second race.
function linkedRaceAlreadyPassed(program, effectiveDate) {
  const race = program?.__raceBuild;
  if (!race?.raceDate || weekStartOf(race.raceDate) !== weekStartOf(effectiveDate)) return false;
  const start = weekStartOf(race.raceDate);
  const week = applyRaceBuild(program, effectiveDate);
  return WEEK_DAYS.some((day, i) => {
    const key = shiftDate(start, i);
    return key < effectiveDate && racePlanOn(program, key)?.raceDate === race.raceDate &&
      getProgramSessions(week[day]).some(s => s.cardio?.planRole === "race" && s.cardio?.planWeek);
  });
}

export function hybridAlignmentDecision({ program, entries, todayKey, align = true }) {
  if (!describeRoadTrailWeek(program, todayKey)) return null;
  const effectiveDate = changeDate(entries, todayKey);
  const current = describeRoadTrailWeek(program, effectiveDate);
  const race = align && resolveRaceBuildConfig(program.__raceBuild);
  if (align && (!race?.generated || race.raceDate < effectiveDate || race.raceDate < current.startDate)) return null;
  if (align && linkedRaceAlreadyPassed(program, effectiveDate)) return null;
  if (align ? current.aligned && current.raceDate === race.raceDate : !current.aligned) return null;

  const raceDate = align ? race.raceDate : current.baselineRaceDate;
  const raceName = align ? race.raceName : null;
  const proposed = revise(program, effectiveDate, align ? raceDate : null, raceName);
  return { program: proposed, currentRaceDate: current.raceDate, raceDate, raceName, effectiveDate };
}

export function previewHybridRaceAlignment(args, decision = hybridAlignmentDecision(args)) {
  if (!decision) return null;
  const { program: proposed, effectiveDate, currentRaceDate, raceDate } = decision;
  const start = proposed.__hybridBlock.startDate || proposed.__hybridBlock.startMonday;
  const first = effectiveDate > start ? effectiveDate : start;
  const lastTarget = currentRaceDate > raceDate ? currentRaceDate : raceDate;
  // Through the first complete recovery week both versions have converged.
  const diff = compareSchedules(args.program, proposed, first, shiftDate(weekStartOf(lastTarget), 13));
  return { ...decision, ...diff };
}

// A changed event needs a fresh preview. Editing paces or mileage for the
// same date keeps the accepted taper. A reset is dated like an alignment.
export function changeHybridRacePlan(program, spec, entries, todayKey) {
  let next = { ...program };
  if (spec) next.__raceBuild = spec;
  else delete next.__raceBuild;
  const marker = program.__hybridBlock;
  if (!Array.isArray(marker?.alignments) || !marker.alignments.length || samePrescription(program.__raceBuild ?? null, spec ?? null)) return next;
  const effectiveDate = changeDate(entries, todayKey);
  const current = describeRoadTrailWeek(program, effectiveDate);
  const until = shiftDate(effectiveDate, -1);
  const history = Array.isArray(marker.priorRacePlans) ? marker.priorRacePlans : [];
  const priorRacePlans = history.filter(item => validDateKey(item?.until) && item.until < until && Object.hasOwn(item, "spec"));
  priorRacePlans.push({ until, spec: racePlanOn(program, until) ?? null });
  next.__hybridBlock = { ...marker, priorRacePlans };
  if (current?.aligned && current.raceDate === spec?.raceDate) {
    if (current.raceName !== spec.raceName) next = revise(next, effectiveDate, spec.raceDate, spec.raceName);
  } else if (current?.aligned || marker.alignments.some(r => r?.effectiveDate >= effectiveDate)) {
    next = revise(next, effectiveDate, null);
  }
  return next;
}
