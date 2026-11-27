// src/progressionEngine.js
// Deterministic exercise progression.
// The engine is intentionally suggest-only: it reads completed work, requires
// repeated evidence before calling a stall, and never mutates the program.

import { performedExerciseName, defaultWeightIncrement, resolveTrackingMode, TRACKING_MODES, validateSet } from "./workoutLogging";
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

function completedSetsForExercise(exercise, sets = []) {
  return sets
    .flatMap((set, slot) => set?.done && validateSet(set, exercise).valid ? [{
      ...set, slot,
      weight: n(set.weight),
      reps: n(set.reps),
      assistance: n(set.assistance ?? set.weight),
      duration: n(set.duration),
      distance: n(set.distance),
      rir: String(set.rir ?? "").trim() === "" ? null : n(set.rir),
      quality: QUALITY_RANK[set.quality] != null ? set.quality : null,
      pain: Boolean(set.pain) || n(set.painScore) > 0,
    }] : []);
}

function summarizeSession({ date, exercise, sets, plannedName, performedName }) {
  const completed = completedSetsForExercise(exercise, sets);
  if (completed.length === 0) return null;
  const mode = resolveTrackingMode(exercise);
  const reps = completed.map((set) => set.reps);
  const weights = completed.map((set) => set.weight);
  const rirs = completed.map((set) => set.rir).filter(Number.isFinite);
  const qualityRank = completed.reduce((worst, set) => Math.max(worst, QUALITY_RANK[set.quality] ?? 0), 0);
  const mixedWeights = weights.some(weight => weight !== weights[0]);
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
        // "0×10/9/8" read as a 0-lb load.
        ? `${Math.max(...weights, 0) > 0 ? `+${Math.max(...weights, 0)}` : "BW"}×${reps.join("/")}`
        : mixedWeights ? completed.map(set => `${set.weight}×${set.reps}`).join(" / ")
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
      const performedName = performedExerciseName(plannedName, entry);
      // A substituted exercise owns its own history. The planned movement does
      // not receive credit for a different movement performed in its slot.
      if (performedName.toLowerCase() !== exerciseName.toLowerCase()) continue;
      const exerciseShape = exercise || { name: performedName, sets: entry?.sets?.length || 1, reps: 8 };
      const session = summarizeSession({ date, exercise: { ...exerciseShape, name: performedName }, sets: entry?.sets || [], plannedName, performedName });
      if (session) {
        sessions.push(session);
        break;
      }
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
  // At bodyweight the "load" never changes, so a sharp drop in reps is
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
    targetRir: exercise.rir ?? null,
    confidence: confidenceLabel(sessions.length),
    rationale,
    caution,
    last,
  };
}

// Older stored prescriptions carry one weight for the whole exercise.
export function prescriptionWeightAt(prescription, index) {
  if (Array.isArray(prescription?.targetWeights)) return prescription.targetWeights[index] ?? null;
  return prescription?.targetWeight ?? null;
}

function effortRange(value) {
  if (value == null || !/\d/.test(String(value))) return null;
  const range = parseRepRange(value);
  return String(value).includes("+") ? { min: range.min, max: Infinity } : range;
}

function grindingSet(set, effort) {
  return set.quality === "grind" || set.rir === 0 || (effort && set.rir != null && set.rir < effort.min);
}

// Distinct loads belong to their set slots. A leading heavier group followed
// by one lighter group can progress independently. For a changing pyramid,
// incomplete log or intensity-technique set, repeat the observed pattern.
function mixedLoadPrescription({ exercise, mode, sessions, range, targetSets, increment }) {
  const last = sessions[0];
  const sets = last.sets;
  const top = sets[0].weight;
  const split = sets.findIndex(set => set.weight !== top);
  const lighter = sets[split].weight;
  const completePattern = sets.length === targetSets && sets.every((set, index) =>
    set.slot === index && (!set.type || set.type === "straight"));
  const topAndBackoff = completePattern && lighter < top && sets.slice(split).every(set => set.weight === lighter);
  const adverse = last.pain || last.worstQuality === "form_break";
  const effort = effortRange(exercise.rir);
  const reachedCeiling = set => set.reps >= range.max && (!effort || set.rir != null) && !grindingSet(set, effort);
  const prior = sessions[1];
  const confirmed = exercise.progressionExposures !== 2 || (
    !prior?.pain && prior?.worstQuality !== "form_break" && prior?.sets.length === targetSets &&
    sets.every((set, index) => prior.sets[index]?.weight === set.weight && reachedCeiling(prior.sets[index]) && reachedCeiling(set))
  );
  const raise = group => !adverse && confirmed && group.every(reachedCeiling);
  const raiseTop = topAndBackoff && raise(sets.slice(0, split));
  const raiseBackoff = topAndBackoff && raise(sets.slice(split));
  const slots = new Map(sets.map(set => [set.slot, set]));
  const lowest = Math.min(...sets.map(set => set.weight));
  const targetWeights = [];
  const targetReps = [];
  for (let index = 0; index < targetSets; index++) {
    const set = slots.get(index);
    const previousWeight = set?.weight ?? lowest;
    const advancing = index < split ? raiseTop : raiseBackoff;
    let weight = previousWeight;
    if (adverse) weight = Math.max(mode === TRACKING_MODES.BODYWEIGHT_REPS ? 0 : Math.min(previousWeight, increment), previousWeight - increment);
    else if (advancing) weight = previousWeight + increment;
    targetWeights.push(weight);
    targetReps.push(advancing || adverse || !set ? range.min : Math.min(range.max, set.reps));
  }
  const rationale = adverse ? "Step each load down after the technique or discomfort flag."
    : topAndBackoff ? "The top and back-off sets keep their own loads. Each group advances after all its sets reach the upper target cleanly."
    : "Repeat the recorded loads by set. Use the lighter load for an unrecorded set.";
  return {
    ...prescriptionBase({ kind: "set_targets", exercise, sessions, range, targetSets, targetReps, rationale,
      caution: last.pain ? "Stop the movement if pain persists or worsens." : null }),
    mode, targetWeights,
  };
}

export function formatPrescription(prescription) {
  if (!prescription) return "No target yet";
  if (Array.isArray(prescription.targetWeights)) {
    return prescription.targetWeights.map((weight, index) =>
      `${weight} lb × ${prescription.targetReps[index]}`).join(" / ");
  }
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
    // Nothing added reads as bodyweight, not "0 lb".
    return prescription.targetWeight > 0 ? `+${prescription.targetWeight} lb · ${reps}` : `Bodyweight · ${reps}`;
  }
  return `${prescription.targetWeight} lb · ${reps}`;
}

export function buildExercisePrescription({ data, exercise, todayKey, currentSession = null } = {}) {
  if (!exercise?.name || !todayKey) return null;
  const mode = resolveTrackingMode(exercise);
  const range = parseRepRange(exercise.reps, mode === TRACKING_MODES.TIMED_HOLD ? { min: 30, max: 45 } : { min: 8, max: 12 });
  if (Number.isInteger(exercise.repMin) && exercise.repMin > 0 && exercise.repMin <= range.max) range.min = exercise.repMin;
  const targetSets = Math.max(1, Number.parseInt(exercise.sets, 10) || 1);
  const increment = defaultWeightIncrement(exercise);
  const history = getExerciseSessions(data, currentSession?.performedName || exercise.name, todayKey, { exercise, limit: 8 });
  const current = sessionFromCurrent(exercise, currentSession, todayKey);
  const exposures = current ? [current, ...history.filter((session) => session.date !== current.date)] : history;
  // Weighted pull-ups from an earlier program are a different baseline.
  const leverage = exercise.progressionMode === "leverage" && (mode === TRACKING_MODES.BODYWEIGHT_REPS || mode === TRACKING_MODES.TIMED_HOLD);
  const sessions = leverage ? exposures.filter(session => session.weight === 0) : exposures;
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
      rationale: `Start at ${range.min} ${mode === TRACKING_MODES.TIMED_HOLD ? "seconds" : mode === TRACKING_MODES.CARRY ? "yards" : "reps"} per set and record the effort.`,
    }), mode };
  }

  const adverseTechnique = last.pain || last.worstQuality === "form_break";
  const hitAllSets = last.setsCompleted >= targetSets;
  const hitUpper = hitAllSets && last.reps.slice(0, targetSets).every((reps) => reps >= range.max);
  const hitFloor = hitAllSets && last.reps.slice(0, targetSets).every((reps) => reps >= range.min);
  const stall = detectStall(sessions, targetSets);

  const effort = effortRange(exercise.rir);
  const twoVisits = exercise.progressionExposures === 2;
  const cleanCeiling = (session) => Boolean(session && !session.pain && session.worstQuality !== "form_break" &&
    session.sets.length >= targetSets && session.sets.slice(0, targetSets).every(set =>
      (mode === TRACKING_MODES.TIMED_HOLD ? set.duration : set.reps) >= range.max &&
      set.weight === last.weight && (!effort || set.rir != null) && !grindingSet(set, effort)));
  const repeatCeiling = twoVisits && !cleanCeiling(sessions[1]);
  if (mode === TRACKING_MODES.TIMED_HOLD) {
    const advanceVariation = leverage && cleanCeiling(last) && !repeatCeiling;
    const durationTargets = nextRepTargets({ reps: last.sets.map((set) => set.duration) }, range, targetSets);
    return { ...prescriptionBase({
      kind: "timed_progress", exercise, sessions, range, targetSets,
      targetReps: adverseTechnique || advanceVariation ? Array(targetSets).fill(range.min) : durationTargets,
      rationale: adverseTechnique ? "Return to the easier duration and a comfortable position."
        : advanceVariation ? "Choose the next hold variation in the exercise notes and restart at the lower time."
        : "Build time with good position. Repeat the top duration before advancing the variation.",
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

  if (last.sets.some(set => set.weight !== last.sets[0].weight)) {
    return mixedLoadPrescription({ exercise, mode, sessions, range, targetSets, increment });
  }
  const lastWeight = last.weight;
  // A bodyweight movement steps back to bodyweight, never below it,
  // and with nothing added "one step back" means an easier variation. The
  // loaded floor (one increment) would prescribe "+5 lb" there, after a
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

  if (stall && !(twoVisits && hitUpper)) {
    return { ...prescriptionBase({
      kind: "reset", exercise, sessions, range, targetSets, targetWeight: stepBackWeight,
      targetReps: Array(targetSets).fill(range.min),
      rationale: atBodyweight
        ? "Three exposures at bodyweight produced no meaningful rep gain. Step back to an easier variation and rebuild."
        : `Three exposures at ${lastWeight} lb produced no meaningful rep or strength gain. Take one step back and rebuild.`,
    }), mode };
  }

  const grinding = last.sets.some(set => grindingSet(set, effort));
  const missingEffort = Boolean(effort && !last.allRirLogged);
  if (hitUpper && !grinding && !missingEffort && repeatCeiling) {
    return { ...prescriptionBase({ kind: "hold_for_quality", exercise, sessions, range, targetSets,
      targetWeight: lastWeight, targetReps: Array(targetSets).fill(range.max),
      rationale: "Repeat the upper target at the same difficulty for a second clean visit." }), mode };
  }
  if (hitUpper && !grinding && !missingEffort && leverage) {
    return { ...prescriptionBase({ kind: "advance_variation", exercise, sessions, range, targetSets,
      targetWeight: 0, targetReps: Array(targetSets).fill(range.min),
      rationale: "Choose a harder bodyweight variation or reduce support using the exercise notes. Restart at the lower rep target." }), mode };
  }
  if (hitUpper && !grinding && !missingEffort) {
    const targetWeight = roundToIncrement(lastWeight + increment, increment);
    return { ...prescriptionBase({
      kind: "add_load", exercise, sessions, range, targetSets, targetWeight,
      targetReps: Array(targetSets).fill(range.min),
      rationale: `All ${targetSets} sets reached ${range.max} reps without a technique flag. ${atBodyweight ? "Add the smallest load, or move to a harder variation." : "Add the smallest load step."}`,
    }), mode };
  }

  if (hitUpper) {
    return { ...prescriptionBase({
      kind: "hold_for_quality", exercise, sessions, range, targetSets, targetWeight: lastWeight,
      targetReps: Array(targetSets).fill(range.max),
      rationale: missingEffort ? "Repeat this load and log reps in reserve for each set to check the intended effort."
        : "Repeat the target at the same difficulty with cleaner reps and the intended reserve.",
    }), mode };
  }

  return { ...prescriptionBase({
    kind: hitFloor ? "add_reps" : "repeat_floor", exercise, sessions, range, targetSets, targetWeight: lastWeight,
    targetReps: nextRepTargets(last, range, targetSets),
    rationale: hitFloor ? "Keep the load and add one rep to the weakest set." : `Repeat ${atBodyweight ? "at bodyweight" : `${lastWeight} lb`} until every set reaches at least ${range.min} clean reps.`,
  }), mode };
}

// The target is kept per logged set so an edit or a replay can score the
// recorded work independently of which suggestion the athlete selected.
export function evaluateSetOutcome(target, set) {
  if (!set?.done || target?.value == null || target.kind === "establish") return "unknown";
  const actual = target.mode === TRACKING_MODES.TIMED_HOLD ? set.duration
    : target.mode === TRACKING_MODES.CARRY ? set.distance : set.reps;
  if (!Number.isFinite(Number(actual)) || Number(actual) <= 0) return "unknown";
  const weight = target.mode === TRACKING_MODES.ASSISTED_REPS ? set.assistance || set.weight : set.weight;
  if (target.weight != null) {
    if ((target.mode === TRACKING_MODES.LOADED_REPS || target.mode === TRACKING_MODES.CARRY) &&
      (!Number.isFinite(Number(weight)) || Number(weight) <= 0)) return "unknown";
    if (Math.abs(n(weight) - target.weight) >= 0.01) return "missed";
  }
  if (n(actual) < target.value || set.pain || n(set.painScore) > 0 || set.quality === "form_break") return "missed";
  const effort = effortRange(target.rir);
  if (!effort) return "met";
  if (String(set.rir ?? "").trim() === "") return "unknown";
  const rir = Number(set.rir);
  if (!Number.isFinite(rir)) return "unknown";
  return rir >= effort.min && rir <= effort.max ? "met" : "missed";
}

export function buildProgressionDecision(prescription, actualSet, { setIndex = 0, selectedSource = null, acceptedAt = new Date().toISOString() } = {}) {
  if (!prescription) return null;
  const mode = prescription.mode;
  const targetWeight = prescriptionWeightAt(prescription, setIndex);
  const actualWeight = n(mode === TRACKING_MODES.ASSISTED_REPS ? actualSet?.assistance || actualSet?.weight : actualSet?.weight);
  const matchedLoad = targetWeight == null || Math.abs(actualWeight - targetWeight) < 0.01;
  const target = { kind: prescription.kind, mode: mode ?? TRACKING_MODES.LOADED_REPS,
    weight: targetWeight, value: prescription.targetReps?.[setIndex] ?? null, rir: prescription.targetRir ?? null };
  return {
    version: 2,
    status: matchedLoad ? "accepted" : "overridden", // Compatibility with older decision records.
    loadMatched: targetWeight == null ? null : matchedLoad,
    outcome: evaluateSetOutcome(target, actualSet),
    target, selectedSource, setIndex, acceptedAt,
    kind: prescription.kind,
    sourceDate: prescription.sourceDate,
    targetWeight, targetReps: prescription.targetReps, actualWeight,
  };
}

function allExerciseNames(data) {
  const names = new Set();
  for (const entry of Object.values(data || {})) {
    for (const [plannedName, exercise] of Object.entries(entry?.workout?.exercises || {})) {
      names.add(performedExerciseName(plannedName, exercise));
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
