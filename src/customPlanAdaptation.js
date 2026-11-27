// Resolve an authored custom week into one dated training prescription.
// The caller can freeze this JSON on the workout when logging begins.
import { shiftDate } from "./coachWindows";
import { buildDecisionContext, getDailyRecommendation } from "./decisionEngine";
import { buildDeloadRecommendation } from "./fatigueManagement";
import { buildDailyLoads, computeRollingLoads } from "./loadModel";
import { mapExerciseToMuscles, MUSCLE_LANDMARKS, weekStartKey } from "./muscleVolume";
import { buildExercisePrescription, getExerciseSessions, parseRepRange, prescriptionWeightAt } from "./progressionEngine";
import { getProgramSessions, usesProgramSessions } from "./programSessions";
import { buildSessionVolumeProjection } from "./trainingArbitration";
import { computeRecoveryBaseline, manualRecoveryForDay, resolveRecovery } from "./recovery";
import { defaultWeightIncrement, performedExerciseName, resolveTrackingMode, TRACKING_MODES } from "./workoutLogging";

const BANDS = ["rest", "pull_back", "moderate", "normal", "push"];
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function dailyDose(day, records, dateKey, readiness, wearableScore, safetyFlag) {
  const yesterday = shiftDate(dateKey, -1);
  const subjective = manualRecoveryForDay(records, dateKey, yesterday);
  const scoreInRange = Number.isFinite(wearableScore) && wearableScore >= 0 && wearableScore <= 100;
  const recovery = resolveRecovery({ subjective, ouraScore: scoreInRange ? wearableScore : null });
  const trainingLoad = computeRollingLoads(buildDailyLoads(records, 28, yesterday));
  const personal = recovery?.source === "subjective" ? computeRecoveryBaseline(records, yesterday) : null;
  const decision = getDailyRecommendation(buildDecisionContext({ todayProgram: day, entries: records, todayKey: dateKey, recovery, trainingLoad, personal }));
  const band = BANDS.includes(readiness) ? BANDS[Math.min(BANDS.indexOf(readiness), BANDS.indexOf(decision.readiness))] : decision.readiness;
  const entry = records[dateKey] || {};
  const fatigue = buildDeloadRecommendation({ data: records, todayKey: dateKey, body: entry.body, workout: entry.workout,
    safetyFlag: safetyFlag || entry.intelligence?.physiqueOS?.safetyFlag });
  if (fatigue.status === "safety") return { status: "safety", reason: fatigue.guidance };
  if (band === "rest") return { status: "rest", reason: "Today's recovery and training load call for a recovery day. Resume the planned week when ready." };
  const score = recovery ? `Recovery ${recovery.score}/100. ` : "";
  if (fatigue.status === "deload" || fatigue.status === "watch" || band === "pull_back") {
    const { volumeReductionPct = 20, loadPct = 90 } = fatigue.prescription || {};
    return { status: "reduce", fraction: volumeReductionPct / 100, loadPct, rir: fatigue.status === "deload" ? 4 : 3,
      reason: score + (fatigue.reasons[0] || "Recent training and recovery suggest easing back.") + " Fewer working sets and a lighter target today." };
  }
  if (band === "moderate" || day.adaptivePlan?.isDeload) {
    return { status: "hold", fraction: 0, loadPct: 100, rir: 3,
      reason: day.adaptivePlan?.isDeload ? "Keep this planned deload easy. Use the low end of each range." : score + "Repeat familiar loads with extra reserve." };
  }
  return { status: "normal", recovered: Boolean(recovery && recovery.confidence !== "low" && recovery.score >= 70 && ["normal", "push"].includes(band)) };
}

function comparableHistory(data, exercise, dateKey) {
  const mode = resolveTrackingMode(exercise);
  const repRange = parseRepRange(exercise.reps);
  const minimum = Number(exercise.repMin) || repRange.min;
  const from = shiftDate(dateKey, -42);
  const history = {};
  // Different rep demands, assisted versus unassisted sets and timed versus
  // distance carries are different baselines, even under the same name.
  for (const [date, entry] of Object.entries(data)) {
    if (date < from || date >= dateKey || entry?.workout?.customPlanSnapshot?.day?.adaptation?.status === "reduce") continue;
    const matching = {};
    for (const [name, log] of Object.entries(entry?.workout?.exercises || {})) {
      if (performedExerciseName(name, log).toLowerCase() !== exercise.name.toLowerCase()) continue;
      const sets = Array.isArray(log?.sets) ? log.sets : [];
      const done = sets.filter(set => set?.done);
      if (!done.length || done.some(set => {
        const tracked = set.progressionTarget?.mode || set.progressionTarget?.plan?.trackingMode || log.trackingMode;
        return (tracked && tracked !== mode) || (set.type && set.type !== "straight") ||
          (mode === TRACKING_MODES.CARRY && !(Number(set.distance) > 0)) ||
          (mode === TRACKING_MODES.ASSISTED_REPS && String(set.assistance ?? set.weight ?? "").trim() === "");
      })) continue;
      const amounts = done.map(set => Number(mode === TRACKING_MODES.TIMED_HOLD ? set.duration : mode === TRACKING_MODES.CARRY ? set.distance : set.reps)).filter(n => n > 0);
      if (!amounts.some(amount => amount >= minimum * 0.7 && amount <= repRange.max * 1.5)) continue;
      matching[name] = log;
    }
    if (Object.keys(matching).length) history[date] = { workout: { exercises: matching } };
  }
  return history;
}

function setBudgets(lifts, fraction) {
  const counts = lifts.map(ex => Number(ex.sets));
  let remove = Math.round(counts.reduce((a, b) => a + b, 0) * fraction);
  // Drop accessory slots first, one set per exercise per pass.
  while (remove > 0 && counts.some(n => n > 1)) {
    for (let i = counts.length - 1; i >= 0 && remove > 0; i--) {
      if (counts[i] > 1) { counts[i]--; remove--; }
    }
  }
  return counts;
}

function recoveryTarget(exercise, prescription, sets, dose) {
  const { mode, last, repRange } = prescription;
  const effort = exercise.rir == null ? null : Math.max(parseRepRange(exercise.rir).min, dose.rir);
  const result = { ...prescription, targetSets: sets, targetReps: Array(sets).fill(repRange.min), targetRir: effort,
    rationale: dose.reason, kind: "hold_for_quality" };
  if (!last) return { ...result, kind: "establish" };
  if (mode === TRACKING_MODES.TIMED_HOLD) return { ...result, kind: "timed_progress", targetWeight: null };
  const assisted = mode === TRACKING_MODES.ASSISTED_REPS;
  const increment = Math.max(0.5, defaultWeightIncrement(exercise) || 5);
  const observed = last.sets.map(set => assisted ? set.assistance : set.weight);
  const fallback = assisted ? Math.max(...observed) : Math.min(...observed);
  const weights = Array.from({ length: sets }, (_, i) => {
    const prior = last.sets.find(set => set.slot === i);
    const weight = prior ? (assisted ? prior.assistance : prior.weight) : fallback;
    const target = prescriptionWeightAt(prescription, i);
    if (assisted) return Math.max(target ?? 0, weight + (dose.loadPct < 100 ? increment : 0));
    if (!weight) return 0;
    const capped = Math.min(weight, target ?? weight);
    if (dose.loadPct === 100) return capped;
    const rounded = Math.round(weight * dose.loadPct / 100 / increment) * increment;
    return Math.min(capped, Math.max(Math.min(weight, increment), rounded));
  });
  const mixed = weights.some(w => w !== weights[0]);
  delete result.targetWeights;
  if (mixed) result.targetWeights = weights;
  result.targetWeight = mixed ? null : weights[0];
  result.kind = assisted ? "assistance_hold" : mode === TRACKING_MODES.CARRY ? "carry_progress" : mixed ? "set_targets" : "hold_for_quality";
  return result;
}

function canTrialSet(exercise, prescription, history, dateKey, volume) {
  if (prescription.kind !== "reset" || prescription.mode !== TRACKING_MODES.LOADED_REPS || exercise.sets >= 5) return false;
  const primary = mapExerciseToMuscles(exercise.name)?.primary;
  if (!primary?.length || primary.some(muscle => (volume.find(row => row.key === muscle)?.projected ?? Infinity) + 1 > MUSCLE_LANDMARKS[muscle].mavHi)) return false;
  const recent = getExerciseSessions(history, exercise.name, dateKey, { exercise, limit: 3 });
  const { min, max } = prescription.repRange;
  if (recent.length < 3 || recent[2].date > shiftDate(dateKey, -14) || recent[0].date < shiftDate(dateKey, -10)) return false;
  const weight = recent[0].weight;
  return recent.every(session => !session.pain && session.sets.length === exercise.sets && session.allRirLogged &&
    session.sets.every(set => set.weight === weight && set.reps >= min && set.reps <= max &&
      set.rir >= parseRepRange(exercise.rir ?? 2).min && set.rir <= 3 && (!set.quality || set.quality === "clean"))) &&
    recent.some(session => session.reps.some(value => value < max));
}

function loggedSlots(log) {
  return (log?.sets || []).reduce((count, set, i) => {
    const entered = set && (set.done || ["weight", "reps", "assistance", "distance", "duration", "rir"].some(key => set[key] != null && String(set[key]).trim() !== ""));
    return entered ? i + 1 : count;
  }, 0);
}

export function adaptCustomProgramDay({ day, dateKey, data = {}, config = day?.adaptivePlan, readiness, wearableScore, safetyFlag = false } = {}) {
  if (!day || config?.version !== 1 || !datePattern.test(dateKey) || day.adaptation?.dateKey === dateKey) return day;
  const sessions = getProgramSessions(day);
  if (!sessions.some(session => session.lifting.length)) return day;
  const cutoff = shiftDate(dateKey, -120);
  const records = Object.fromEntries(Object.entries(data || {}).filter(([key]) => datePattern.test(key) && key >= cutoff && key <= dateKey));
  const actual = records[dateKey] || {};
  const workout = actual.workout || {};
  // Today's partial training is neither yesterday's baseline nor evidence to
  // change an in-progress dose. Its check-in and explicit safety flags apply.
  records[dateKey] = { ...actual, workout: { notes: workout.notes } };
  const dose = dailyDose(day, records, dateKey, readiness, wearableScore, safetyFlag);
  const paused = ["rest", "safety"].includes(dose.status);
  const weekStart = weekStartKey(dateKey);
  const triedThisWeek = Object.keys(records).some(key => key >= weekStart && records[key]?.workout?.customPlanSnapshot?.day?.adaptation?.status === "volume_trial");
  let trialAvailable = !triedThisWeek && dose.recovered && config.goal === "bodybuilding" && ["intermediate", "advanced"].includes(config.experience) &&
    (!config.sessionLength || config.sessionLength >= 45) && (!config.estimatedMinutes || config.estimatedMinutes + 3 <= config.sessionLength) && sessions.length === 1;
  const volume = trialAvailable ? buildSessionVolumeProjection({ data: records, todayKey: dateKey, lifting: sessions[0].lifting }).rows : [];
  let tried = false;
  let hasHistory = false;

  const resolved = sessions.map(session => {
    const counts = setBudgets(session.lifting, dose.fraction || 0);
    const lifting = session.lifting.flatMap((ex, index) => {
      const log = workout.exercises?.[ex.name];
      const recorded = loggedSlots(log);
      if (paused) return recorded || log?.skipped ? [{ ...ex, sets: Math.max(recorded, log?.skipped ? ex.sets : 1) }] : [];
      const history = comparableHistory(records, ex, dateKey);
      const original = buildExercisePrescription({ exercise: ex, data: history, todayKey: dateKey });
      if (!original) return [ex];
      hasHistory ||= Boolean(original.sourceDate);
      const sets = Math.max(counts[index], recorded);
      let target = original;
      if (dose.status === "reduce" || dose.status === "hold") {
        target = recoveryTarget(ex, original, Math.max(sets, log?.skipped ? ex.sets : 0), dose);
      } else if (trialAvailable && canTrialSet(ex, original, history, dateKey, volume)) {
        trialAvailable = false;
        tried = true;
        target = { ...original, kind: "volume_trial", targetSets: ex.sets + 1, targetWeight: original.last.weight,
          targetReps: [...original.last.reps, original.repRange.min],
          rationale: "Three clean sessions at this load have plateaued. Trial one extra set at the same weight and review the next visits." };
      }
      // Snapshot only the target, never the athlete's previous raw set logs.
      const adaptivePrescription = { ...target, baseSets: ex.sets };
      delete adaptivePrescription.last;
      return [{ ...ex, sets: Math.max(recorded, adaptivePrescription.targetSets),
        ...(adaptivePrescription.targetRir != null && { rir: adaptivePrescription.targetRir }), adaptivePrescription }];
    });
    const loggedCardio = workout.cardioSessions?.[session.id] || workout.cardio;
    const keepCardio = !paused || Number(loggedCardio?.miles) > 0 || Boolean(loggedCardio?.time);
    return { ...session, lifting, cardio: keepCardio ? session.cardio : null };
  });
  const status = dose.status !== "normal" ? dose.status : tried ? "volume_trial" : hasHistory ? "progress" : "baseline";
  const reason = dose.reason || (tried ? "A recovered, repeated plateau earns one trial set at the same load." :
    hasHistory ? "Working targets use your most recent comparable completed sets and recorded effort." : "Start at the lower end of each range and log a comfortable working load.");
  const result = { ...day, lifting: resolved.flatMap(s => s.lifting), cardio: resolved.find(s => s.cardio)?.cardio || null, adaptation: { dateKey, status, reason } };
  if (usesProgramSessions(day)) result.sessions = day.sessions.flatMap((s, i) =>
    paused && !resolved[i].lifting.length && !resolved[i].cardio ? [] : [{ ...s, lifting: resolved[i].lifting, cardio: resolved[i].cardio }]);
  if (paused && !result.lifting.length && !result.cardio) {
    result.type = "Recovery day";
    result.code = "REST";
  }
  return result;
}
