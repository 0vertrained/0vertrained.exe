// src/progressionEngine.js
// V18.2 · Deterministic exercise progression.
// The engine is intentionally suggest-only: it reads completed work, requires
// repeated evidence before calling a stall, and never mutates the program.

import { defaultWeightIncrement, resolveTrackingMode, TRACKING_MODES, validateSet } from "./workoutLogging";
import { effectiveE1RM } from "./sessionIntelligence";

const DAY_MS = 86400000;
const QUALITY_RANK = Object.freeze({ clean: 0, grind: 1, form_break: 2 });

function n(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateDiff(later, earlier) {
  return Math.round((new Date(`${later}T12:00:00`) - new Date(`${earlier}T12:00:00`)) / DAY_MS);
}

function roundToIncrement(value, increment) {
  const step = Math.max(0.5, n(increment) || 5);
  return Math.max(0, Math.round(value / step) * step);
}

export function parseRepRange(value, fallback = { min: 8, max: 12 }) {
  if (typeof value === "number" && Number.isFinite(value)) return { min: value, max: value };
  const matches = String(value ?? "").match(/\d+(?:\.\d+)?/g)?.map(Number).filter(Number.isFinite) || [];
  if (matches.length === 0) return { ...fallback };
  if (matches.length === 1) return { min: matches[0], max: matches[0] };
  return { min: Math.min(matches[0], matches[1]), max: Math.max(matches[0], matches[1]) };
}

function performedExercise(entry, plannedName) {
  const performedName = String(entry?.performedName || plannedName || "").trim();
  return performedName || plannedName;
}

function completedSetsForExercise(exercise, sets = []) {
  return sets
    .filter((set) => set?.done && validateSet(set, exercise).valid)
    .map((set) => ({
      ...set,
      weight: n(set.weight),
      reps: n(set.reps),
      assistance: n(set.assistance ?? set.weight),
      duration: n(set.duration),
      distance: n(set.distance),
      rir: String(set.rir ?? "").trim() === "" ? null : n(set.rir),
      quality: QUALITY_RANK[set.quality] != null ? set.quality : null,
      pain: Boolean(set.pain) || n(set.painScore) > 0,
    }));
}

function summarizeSession({ date, exercise, sets, plannedName, performedName }) {
  const completed = completedSetsForExercise(exercise, sets);
  if (completed.length === 0) return null;
  const mode = resolveTrackingMode(exercise);
  const reps = completed.map((set) => set.reps);
  const weights = completed.map((set) => set.weight);
  const rirs = completed.map((set) => set.rir).filter(Number.isFinite);
  const qualityRank = completed.reduce((worst, set) => Math.max(worst, QUALITY_RANK[set.quality] ?? 0), 0);
  const bestE1RM = completed.reduce((best, set) => Math.max(best, effectiveE1RM(set.weight, set.reps, set.rir) || 0), 0);
  return {
    date,
    plannedName,
    performedName,
    mode,
    sets: completed,
    setsCompleted: completed.length,
    weight: Math.max(...weights, 0),
    reps,
    totalReps: reps.reduce((sum, value) => sum + value, 0),
    minRir: rirs.length ? Math.min(...rirs) : null,
    avgRir: rirs.length ? rirs.reduce((sum, value) => sum + value, 0) / rirs.length : null,
    allRirLogged: rirs.length === completed.length,
    worstQuality: Object.keys(QUALITY_RANK).find((key) => QUALITY_RANK[key] === qualityRank) || "clean",
    pain: completed.some((set) => set.pain),
    bestE1RM: bestE1RM || null,
    label: mode === TRACKING_MODES.ASSISTED_REPS
      ? `${completed[0]?.assistance || 0} lb assist · ${reps.join("/")}`
      : mode === TRACKING_MODES.BODYWEIGHT_REPS
        // V19.5 · "0×10/9/8" read as a 0-lb load.
        ? `${Math.max(...weights, 0) > 0 ? `+${Math.max(...weights, 0)}` : "BW"}×${reps.join("/")}`
        : `${Math.max(...weights, 0)}×${reps.join("/")}`,
  };
}

export function getExerciseSessions(data, exerciseName, todayKey, { lookbackDays = 120, limit = 8, exercise = null } = {}) {
  if (!data || !exerciseName || !todayKey) return [];
  const sessions = [];
  const keys = Object.keys(data).filter((key) => key < todayKey).sort().reverse();
  for (const date of keys) {
    if (dateDiff(todayKey, date) > lookbackDays) continue;
    const entries = data[date]?.workout?.exercises || {};
    for (const [plannedName, entry] of Object.entries(entries)) {
      const performedName = performedExercise(entry, plannedName);
      // A substituted exercise owns its own history. The planned movement does
      // not receive credit for a different movement performed in its slot.
      if (performedName.toLowerCase() !== exerciseName.toLowerCase()) continue;
      const exerciseShape = exercise || { name: performedName, sets: entry?.sets?.length || 1, reps: 8 };
      const session = summarizeSession({ date, exercise: { ...exerciseShape, name: performedName }, sets: entry?.sets || [], plannedName, performedName });
      if (session) sessions.push(session);
      break;
    }
    if (sessions.length >= limit) break;
  }
  return sessions;
}

function sessionFromCurrent(exercise, currentSession, todayKey) {
  if (!currentSession?.sets) return null;
  return summarizeSession({
    date: currentSession.date || todayKey,
    exercise,
    sets: currentSession.sets,
    plannedName: exercise.name,
    performedName: currentSession.performedName || exercise.name,
  });
}

function detectStall(sessions, targetSets) {
  if (sessions.length < 3) return null;
  const sample = sessions.slice(0, 3);
  if (sample.some((session) => session.setsCompleted < targetSets || session.pain || session.worstQuality === "form_break")) return null;
  const weights = sample.map((session) => session.weight);
  const sameLoad = Math.max(...weights) - Math.min(...weights) < 0.01;
  if (!sameLoad) return null;
  // Newest is index 0. Require no meaningful rep or strength improvement over
  // three exposures; one bad workout alone can never trigger this branch.
  const totalReps = sample.map((session) => session.totalReps);
  // V19.5 · At bodyweight the "load" never changes, so a sharp drop in reps is
  // a harder variation (a calisthenics ladder step), not a plateau. Only a flat
  // run of exposures counts as a stall there.
  const atBodyweight = sample.every((session) => session.mode === TRACKING_MODES.BODYWEIGHT_REPS && session.weight <= 0);
  if (atBodyweight && Math.min(...totalReps) < 0.75 * Math.max(...totalReps)) return null;
  const e1rms = sample.map((session) => session.bestE1RM || 0);
  const repGain = totalReps[0] - Math.min(totalReps[1], totalReps[2]);
  const strengthGain = e1rms[0] - Math.max(e1rms[1], e1rms[2]);
  const priorRepGain = totalReps[1] - totalReps[2];
  const priorStrengthGain = e1rms[1] - e1rms[2];
  if (repGain >= 2 || strengthGain >= 2 || priorRepGain >= 2 || priorStrengthGain >= 2) return null;
  return { exposures: 3, weight: weights[0], totalReps, e1rms };
}

function nextRepTargets(last, range, targetSets) {
  const source = Array.from({ length: targetSets }, (_, index) => last.reps[index] || range.min);
  let added = false;
  return source.map((reps) => {
    const clamped = Math.max(range.min, Math.min(range.max, reps));
    if (!added && clamped < range.max) {
      added = true;
      return clamped + 1;
    }
    return clamped;
  });
}

function confidenceLabel(sessionCount) {
  if (sessionCount >= 4) return "high";
  if (sessionCount >= 2) return "medium";
  return "low";
}

function prescriptionBase({ kind, exercise, sessions, range, targetSets, targetWeight = null, targetReps = null, rationale, caution = null }) {
  const last = sessions[0] || null;
  return {
    version: 1,
    kind,
    exerciseName: exercise.name,
    sourceDate: last?.date || null,
    targetSets,
    repRange: range,
    targetWeight,
    targetReps,
    confidence: confidenceLabel(sessions.length),
    rationale,
    caution,
    last,
  };
}

export function formatPrescription(prescription) {
  if (!prescription) return "No target yet";
  const reps = Array.isArray(prescription.targetReps) && prescription.targetReps.length
    ? prescription.targetReps.join(" / ")
    : `${prescription.repRange.min}–${prescription.repRange.max}`;
  if (prescription.kind === "assistance_down" || prescription.kind === "assistance_hold") {
    return `${prescription.targetWeight} lb assistance · ${reps}`;
  }
  if (prescription.kind === "timed_progress") return `${reps} sec across ${prescription.targetSets} sets`;
  if (prescription.kind === "carry_progress") return `${prescription.targetWeight} lb · ${reps} yd`;
  if (prescription.targetWeight == null) return `${prescription.targetSets} sets · ${reps}`;
  if (prescription.mode === TRACKING_MODES.BODYWEIGHT_REPS) {
    // V19.5 · Nothing added reads as bodyweight, not "0 lb".
    return prescription.targetWeight > 0 ? `+${prescription.targetWeight} lb · ${reps}` : `Bodyweight · ${reps}`;
  }
  return `${prescription.targetWeight} lb · ${reps}`;
}

export function buildExercisePrescription({ data, exercise, todayKey, currentSession = null } = {}) {
  if (!exercise?.name || !todayKey) return null;
  const mode = resolveTrackingMode(exercise);
  const range = parseRepRange(exercise.reps, mode === TRACKING_MODES.TIMED_HOLD ? { min: 30, max: 45 } : { min: 8, max: 12 });
  const targetSets = Math.max(1, Number.parseInt(exercise.sets, 10) || 1);
  const increment = defaultWeightIncrement(exercise);
  const history = getExerciseSessions(data, currentSession?.performedName || exercise.name, todayKey, { exercise, limit: 8 });
  const current = sessionFromCurrent(exercise, currentSession, todayKey);
  const sessions = current ? [current, ...history.filter((session) => session.date !== current.date)] : history;
  const last = sessions[0];

  if (!last) {
    return { ...prescriptionBase({
      kind: "establish",
      exercise,
      sessions,
      range,
      targetSets,
      targetWeight: null,
      targetReps: Array(targetSets).fill(range.min),
      rationale: `Establish a clean baseline inside ${range.min}–${range.max} reps before the engine changes load.`,
    }), mode };
  }

  const adverseTechnique = last.pain || last.worstQuality === "form_break";
  const hitAllSets = last.setsCompleted >= targetSets;
  const hitUpper = hitAllSets && last.reps.slice(0, targetSets).every((reps) => reps >= range.max);
  const hitFloor = hitAllSets && last.reps.slice(0, targetSets).every((reps) => reps >= range.min);
  const stall = detectStall(sessions, targetSets);

  if (mode === TRACKING_MODES.TIMED_HOLD) {
    const durationTargets = nextRepTargets({ reps: last.sets.map((set) => set.duration) }, range, targetSets);
    return { ...prescriptionBase({
      kind: "timed_progress", exercise, sessions, range, targetSets, targetReps: durationTargets,
      rationale: hitUpper ? "All holds reached the top of the range. Add load or choose a harder variation after another clean exposure." : "Add time to one hold while keeping position clean.",
      caution: adverseTechnique ? "Technique or discomfort was flagged; repeat the easier duration instead of progressing." : null,
    }), mode };
  }

  if (mode === TRACKING_MODES.CARRY) {
    const distances = last.sets.map((set) => set.distance || set.duration);
    const targetReps = nextRepTargets({ reps: distances }, range, targetSets);
    const targetWeight = adverseTechnique ? Math.max(0, last.weight - increment) : hitUpper ? last.weight + increment : last.weight;
    return { ...prescriptionBase({
      kind: "carry_progress", exercise, sessions, range, targetSets, targetWeight, targetReps,
      rationale: adverseTechnique ? "Reduce the carry load and restore posture and gait." : hitUpper ? "Distance target is complete; add the smallest practical load increase." : "Hold load and add distance to one set.",
    }), mode };
  }

  if (mode === TRACKING_MODES.ASSISTED_REPS) {
    const assistance = last.sets[0]?.assistance || 0;
    if (adverseTechnique) {
      return { ...prescriptionBase({
        kind: "assistance_hold", exercise, sessions, range, targetSets, targetWeight: assistance + increment,
        targetReps: Array(targetSets).fill(range.min), rationale: "Add assistance until every rep is controlled and pain-free.",
      }), mode };
    }
    return { ...prescriptionBase({
      kind: hitUpper ? "assistance_down" : "assistance_hold", exercise, sessions, range, targetSets,
      targetWeight: Math.max(0, assistance - (hitUpper ? increment : 0)),
      targetReps: hitUpper ? Array(targetSets).fill(range.min) : nextRepTargets(last, range, targetSets),
      rationale: hitUpper ? "All sets reached the upper rep target; reduce assistance one step." : "Keep assistance and add one clean rep.",
    }), mode };
  }

  const lastWeight = last.weight;
  // V19.5 · A bodyweight movement steps back to bodyweight, never below it,
  // and with nothing added "one step back" means an easier variation. The
  // loaded floor (one increment) used to prescribe "+5 lb" there, after a
  // pain flag or a stall.
  const bodyweightMode = mode === TRACKING_MODES.BODYWEIGHT_REPS;
  const atBodyweight = bodyweightMode && lastWeight <= 0;
  const stepBackWeight = roundToIncrement(Math.max(bodyweightMode ? 0 : increment, lastWeight - increment), increment);
  if (adverseTechnique) {
    const rationale = atBodyweight
      ? (last.pain ? "Discomfort was flagged. Use an easier variation and only pain-free, controlled reps." : "Form broke down. Use an easier variation and rebuild clean reps.")
      : (last.pain ? "Discomfort was flagged. Reduce load and use only pain-free, controlled reps." : "Form broke down. Reduce one load step and rebuild clean reps.");
    return { ...prescriptionBase({
      kind: "reduce_load", exercise, sessions, range, targetSets, targetWeight: stepBackWeight,
      targetReps: Array(targetSets).fill(range.min),
      rationale,
      caution: last.pain ? "Stop the movement if pain persists or worsens; use an appropriate substitution instead." : null,
    }), mode };
  }

  if (stall) {
    return { ...prescriptionBase({
      kind: "reset", exercise, sessions, range, targetSets, targetWeight: stepBackWeight,
      targetReps: Array(targetSets).fill(range.min),
      rationale: atBodyweight
        ? "Three exposures at bodyweight produced no meaningful rep gain. Step back to an easier variation and rebuild."
        : `Three exposures at ${lastWeight} lb produced no meaningful rep or strength gain. Take one step back and rebuild.`,
    }), mode };
  }

  const grinding = last.minRir === 0 || last.worstQuality === "grind";
  if (hitUpper && !grinding) {
    const targetWeight = roundToIncrement(lastWeight + increment, increment);
    return { ...prescriptionBase({
      kind: "add_load", exercise, sessions, range, targetSets, targetWeight,
      targetReps: Array(targetSets).fill(range.min),
      rationale: `All ${targetSets} sets reached ${range.max} reps without a technique flag. ${atBodyweight ? "Add the smallest load, or move to a harder variation." : "Add the smallest load step."}`,
    }), mode };
  }

  if (hitUpper && grinding) {
    return { ...prescriptionBase({
      kind: "hold_for_quality", exercise, sessions, range, targetSets, targetWeight: lastWeight,
      targetReps: Array(targetSets).fill(range.max),
      rationale: "The rep target was reached, but the final work was a grind. Repeat the load and make the reps cleaner before adding weight.",
    }), mode };
  }

  return { ...prescriptionBase({
    kind: hitFloor ? "add_reps" : "repeat_floor", exercise, sessions, range, targetSets, targetWeight: lastWeight,
    targetReps: nextRepTargets(last, range, targetSets),
    rationale: hitFloor ? "Keep the load and add one rep to the weakest set." : `Repeat ${atBodyweight ? "at bodyweight" : `${lastWeight} lb`} until every set reaches at least ${range.min} clean reps.`,
  }), mode };
}

export function buildProgressionDecision(prescription, actualSet, { acceptedAt = new Date().toISOString() } = {}) {
  if (!prescription) return null;
  const actualWeight = n(actualSet?.weight ?? actualSet?.assistance);
  const targetWeight = n(prescription.targetWeight);
  const accepted = targetWeight <= 0 || Math.abs(actualWeight - targetWeight) < 0.01;
  return {
    version: 1,
    status: accepted ? "accepted" : "overridden",
    acceptedAt,
    kind: prescription.kind,
    sourceDate: prescription.sourceDate,
    targetWeight: prescription.targetWeight,
    targetReps: prescription.targetReps,
    actualWeight,
  };
}

function allExerciseNames(data) {
  const names = new Set();
  for (const entry of Object.values(data || {})) {
    for (const [plannedName, exercise] of Object.entries(entry?.workout?.exercises || {})) {
      names.add(performedExercise(exercise, plannedName));
    }
  }
  return [...names];
}

function bestE1RMInWindow(data, exerciseName, todayKey, minDaysAgo, maxDaysAgo) {
  const sessions = getExerciseSessions(data, exerciseName, todayKey, { lookbackDays: maxDaysAgo, limit: 20, exercise: { name: exerciseName, sets: 1, reps: 8 } });
  const eligible = sessions.filter((session) => {
    const days = dateDiff(todayKey, session.date);
    return days >= minDaysAgo && days <= maxDaysAgo && session.bestE1RM;
  });
  return eligible.length ? Math.max(...eligible.map((session) => session.bestE1RM)) : null;
}

export function buildStrengthRetentionAlert({ data, todayKey, exerciseNames = null } = {}) {
  if (!data || !todayKey) return { status: "none", comparisons: [] };
  const names = (exerciseNames?.length ? exerciseNames : allExerciseNames(data)).slice(0, 40);
  const comparisons = names.map((name) => {
    const recent = bestE1RMInWindow(data, name, todayKey, 1, 14);
    const baseline = bestE1RMInWindow(data, name, todayKey, 15, 56);
    if (!recent || !baseline) return null;
    const changePct = ((recent - baseline) / baseline) * 100;
    return { name, recent, baseline, changePct: Math.round(changePct * 10) / 10 };
  }).filter(Boolean);
  if (comparisons.length < 3) return { status: "none", comparisons, note: "More repeated lifts are needed for a retention signal." };
  const declines = comparisons.filter((row) => row.changePct <= -5);
  if (declines.length < 2) return { status: "stable", comparisons, declines: [] };
  const medianDecline = [...declines].sort((a, b) => a.changePct - b.changePct)[Math.floor(declines.length / 2)].changePct;
  return {
    status: declines.length >= 3 && medianDecline <= -7 ? "action" : "watch",
    comparisons,
    declines,
    headline: `${declines.length} lifts are down at least 5% from the prior baseline.`,
    guidance: "Protect recovery and training quality before adding cardio or cutting calories further.",
  };
}

export default {
  parseRepRange,
  getExerciseSessions,
  buildExercisePrescription,
  formatPrescription,
  buildProgressionDecision,
  buildStrengthRetentionAlert,
};
