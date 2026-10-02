// src/trainingArbitration.js
// V18.2 · AM/PM load arbitration and in-session volume projection.

import { getProgramSessions } from "./programSessions";
import { buildWeeklyMuscleVolume, classifyVolume, mapExerciseToMuscles, MUSCLE_LANDMARKS, weekStartKey } from "./muscleVolume";
import { completedSetCount, isExerciseHandled } from "./workoutLogging";

function n(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sessionEffort(session, workoutData) {
  const summary = { completedSets: 0, plannedSets: 0, lowRirSets: 0, techniqueFlags: 0, lowerBodySets: 0, handled: true };
  for (const exercise of session?.lifting || []) {
    const data = workoutData?.exercises?.[exercise.name] || {};
    const sets = data?.sets || [];
    summary.plannedSets += Number.parseInt(exercise.sets, 10) || 0;
    summary.completedSets += completedSetCount(exercise, data);
    summary.handled = summary.handled && isExerciseHandled(exercise, data);
    const mapped = mapExerciseToMuscles(data.performedName || exercise.name);
    for (const set of sets) {
      if (!set?.done) continue;
      const rir = n(set.rir);
      if (rir != null && rir <= 1) summary.lowRirSets += 1;
      if (set.quality === "grind" || set.quality === "form_break" || set.pain) summary.techniqueFlags += 1;
      if (mapped?.primary?.some((muscle) => ["quads", "hamstrings", "glutes", "calves"].includes(muscle))) summary.lowerBodySets += 1;
    }
  }
  summary.highEffort = summary.completedSets >= 3 && (summary.lowRirSets / Math.max(1, summary.completedSets) >= 0.5 || summary.techniqueFlags >= 2);
  return summary;
}

function sessionHasHardCardio(session) {
  const text = `${session?.cardio?.type || ""} ${session?.cardio?.effort || ""} ${session?.cardio?.notes || ""}`.toLowerCase();
  return /(interval|tempo|threshold|high|race|speed)/.test(text);
}

function sessionIsLowerBody(session) {
  return (session?.lifting || []).some((exercise) => {
    const mapped = mapExerciseToMuscles(exercise.name);
    return mapped?.primary?.some((muscle) => ["quads", "hamstrings", "glutes", "calves"].includes(muscle));
  });
}

export function buildSessionArbitration({ programDay, workoutData, sessionId } = {}) {
  const sessions = getProgramSessions(programDay);
  if (sessions.length <= 1) return { status: "single", headline: "Single-session day", guidance: "Run the session as prescribed; do not add unplanned volume." };
  const index = Math.max(0, sessions.findIndex((session) => session.id === sessionId));
  const current = sessions[index] || sessions[0];
  const previous = sessions.slice(0, index).map((session) => ({ session, effort: sessionEffort(session, workoutData) }));
  const later = sessions.slice(index + 1);
  const missedEarlier = previous.filter(({ effort }) => !effort.handled && effort.completedSets === 0);
  const hardEarlier = previous.filter(({ effort }) => effort.highEffort);
  const lowerEarlier = previous.some(({ effort }) => effort.lowerBodySets >= 3);

  if (missedEarlier.length > 0) {
    return {
      status: "do_not_stack",
      headline: "Do not stack the missed earlier session",
      guidance: `Run ${current.label || current.title || "the current session"} only. Reschedule the missed work after checking tomorrow's plan instead of doubling today's fatigue.`,
      missedSessionIds: missedEarlier.map(({ session }) => session.id),
    };
  }

  if (hardEarlier.length > 0 && (sessionHasHardCardio(current) || (lowerEarlier && sessionIsLowerBody(current)))) {
    return {
      status: "reduce",
      headline: "Earlier work was high effort",
      guidance: sessionHasHardCardio(current)
        ? "Convert hard cardio to Zone 2 or shorten the quality block. Keep the aerobic habit without compounding fatigue."
        : "Keep the second lower-body session submaximal and remove one accessory set per movement.",
      changes: sessionHasHardCardio(current) ? ["Zone 2", "No finishers"] : ["RIR 3+", "Accessories −1 set"],
    };
  }

  if (index === 0 && later.length > 0) {
    const laterLabel = later.map((session) => session.label || session.title).filter(Boolean).join(" + ");
    return {
      status: "preserve",
      headline: `Preserve ${laterLabel || "the later session"}`,
      guidance: "Complete the programmed work, but do not add extra sets or max-effort finishers. The later session is already part of today's load.",
    };
  }

  return {
    status: "keep",
    headline: "AM/PM load is compatible",
    guidance: "The earlier session does not show enough strain to modify this block. Keep the plan and use warm-ups as the final check.",
  };
}

const PRIORITY_ORDER = ["side_delt", "rear_delt", "chest", "back", "biceps", "triceps", "quads"];

export function buildSessionVolumeProjection({ data, todayKey, lifting = [], workoutData = {} } = {}) {
  if (!todayKey) return { rows: [], exceptions: [] };
  const weeks = buildWeeklyMuscleVolume(data, { weeks: 8 });
  const currentWeekKey = weekStartKey(todayKey);
  const current = weeks.find((week) => week.weekStart === currentWeekKey);
  const actual = Object.fromEntries(Object.keys(MUSCLE_LANDMARKS).map((key) => [key, current?.muscles?.[key] || 0]));
  const remaining = Object.fromEntries(Object.keys(MUSCLE_LANDMARKS).map((key) => [key, 0]));

  for (const exercise of lifting) {
    const exerciseData = workoutData?.exercises?.[exercise.name] || {};
    const left = Math.max(0, (Number.parseInt(exercise.sets, 10) || 0) - completedSetCount(exercise, exerciseData));
    if (!left) continue;
    const mapped = mapExerciseToMuscles(exerciseData.performedName || exercise.name);
    if (!mapped) continue;
    for (const muscle of mapped.primary) remaining[muscle] += left;
    for (const muscle of mapped.secondary) remaining[muscle] += left * 0.5;
  }

  const rows = Object.keys(MUSCLE_LANDMARKS).map((key) => {
    const projected = Math.round((actual[key] + remaining[key]) * 10) / 10;
    const currentSets = Math.round(actual[key] * 10) / 10;
    return {
      key,
      label: MUSCLE_LANDMARKS[key].label,
      current: currentSets,
      remaining: Math.round(remaining[key] * 10) / 10,
      projected,
      landmarks: MUSCLE_LANDMARKS[key],
      classification: classifyVolume(key, projected),
    };
  });

  const exceptions = rows.filter((row) => row.remaining > 0 && ["below_mev", "above_mrv"].includes(row.classification?.status));
  const prioritized = [...rows].sort((a, b) => {
    const ai = PRIORITY_ORDER.indexOf(a.key);
    const bi = PRIORITY_ORDER.indexOf(b.key);
    if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    return b.remaining - a.remaining;
  });
  return { rows: prioritized, exceptions };
}

export default { buildSessionArbitration, buildSessionVolumeProjection };
