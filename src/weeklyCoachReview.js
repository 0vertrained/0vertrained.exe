/**
 * src/weeklyCoachReview.js
 *
 * Weekly Coaching Review
 * Pure weekly trend/adherence/decision engine. It is intentionally suggest-only:
 * it explains evidence and proposes one next-week change, but never edits goals,
 * programs, cardio, or nutrition targets itself.
 */

import { buildStrengthRetentionAlert } from "./progressionEngine";

const CONFIDENCE_ORDER = ["low", "medium", "high"];

const n = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const mean = (values) => {
  const clean = values.filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null;
};

const round1 = (value) => Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
const pct = (value) => Math.round(Math.max(0, Math.min(1, value || 0)) * 100);

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function shiftDate(key, offset) {
  const date = new Date(`${key}T12:00:00`);
  date.setDate(date.getDate() + offset);
  return dateKey(date);
}


function keysForWindow(endKey, count = 7) {
  return Array.from({ length: count }, (_, index) => shiftDate(endKey, index - (count - 1)));
}

function entryHasWorkout(entry) {
  return Object.keys(entry?.workout?.exercises || {}).length > 0 || n(entry?.workout?.cardio?.miles) > 0;
}

function waistValue(entry) {
  return n(entry?.body?.waist ?? entry?.body?.waistInches ?? entry?.measurements?.waist);
}

function windowSummary(data, keys, goals) {
  const rows = keys.map((key) => ({ key, entry: data[key] })).filter((row) => row.entry);
  const nutritionRows = rows.filter(({ entry }) => n(entry?.nutrition?.calories) > 0);
  const weightRows = rows.map(({ key, entry }) => ({ key, value: n(entry?.body?.weight) })).filter((row) => Number.isFinite(row.value) && row.value > 0);
  const waistRows = rows.map(({ key, entry }) => ({ key, value: waistValue(entry) })).filter((row) => Number.isFinite(row.value) && row.value > 0);
  const sleepRows = rows.map(({ entry }) => n(entry?.body?.sleep)).filter(Number.isFinite);
  const energyRows = rows.map(({ entry }) => n(entry?.body?.energy)).filter(Number.isFinite);
  const sorenessRows = rows.map(({ entry }) => n(entry?.body?.soreness)).filter(Number.isFinite);
  const stepRows = rows.map(({ entry }) => n(entry?.activity?.steps)).filter(Number.isFinite);
  const workoutDays = rows.filter(({ entry }) => entryHasWorkout(entry)).length;
  const totalMiles = rows.reduce((sum, { entry }) => sum + (n(entry?.workout?.cardio?.miles) || 0), 0);
  const targetCalories = n(goals?.calories) || 0;
  const targetProtein = n(goals?.protein) || 200;
  const targetSteps = n(goals?.steps) || 9000;

  const calorieHitDays = nutritionRows.filter(({ entry }) => {
    const value = n(entry?.nutrition?.calories);
    if (!targetCalories || value == null) return false;
    return value >= targetCalories * 0.9 && value <= targetCalories * 1.1;
  }).length;
  const proteinHitDays = nutritionRows.filter(({ entry }) => (n(entry?.nutrition?.protein) || 0) >= targetProtein * 0.9).length;
  const stepHitDays = stepRows.filter((steps) => steps >= targetSteps).length;

  let totalVolume = 0;
  let completedSets = 0;
  let hardSets = 0;
  for (const { entry } of rows) {
    for (const exercise of Object.values(entry?.workout?.exercises || {})) {
      for (const set of exercise?.sets || []) {
        if (!set?.done) continue;
        const weight = n(set.weight) || 0;
        const reps = n(set.reps) || 0;
        if (weight > 0 && reps > 0) totalVolume += weight * reps;
        completedSets += 1;
        if (set.quality === "grind" || set.quality === "form_break" || n(set.rir) === 0) hardSets += 1;
      }
    }
  }

  return {
    keys,
    rows,
    daysLogged: rows.length,
    workoutDays,
    totalMiles: round1(totalMiles) || 0,
    nutritionDays: nutritionRows.length,
    avgCalories: Math.round(mean(nutritionRows.map(({ entry }) => n(entry?.nutrition?.calories))) || 0),
    avgProtein: Math.round(mean(nutritionRows.map(({ entry }) => n(entry?.nutrition?.protein))) || 0),
    avgSleep: round1(mean(sleepRows)) || 0,
    avgEnergy: round1(mean(energyRows)) || 0,
    avgSoreness: round1(mean(sorenessRows)) || 0,
    avgSteps: Math.round(mean(stepRows) || 0),
    weightAverage: round1(mean(weightRows.map((row) => row.value))),
    weightLatest: weightRows.at(-1)?.value ?? null,
    weightCount: weightRows.length,
    waistLatest: waistRows.at(-1)?.value ?? null,
    waistCount: waistRows.length,
    calorieAdherence: nutritionRows.length ? pct(calorieHitDays / nutritionRows.length) : 0,
    proteinAdherence: nutritionRows.length ? pct(proteinHitDays / nutritionRows.length) : 0,
    stepAdherence: stepRows.length ? pct(stepHitDays / stepRows.length) : 0,
    totalVolume: Math.round(totalVolume),
    completedSets,
    hardSetRatio: completedSets ? round1((hardSets / completedSets) * 100) : 0,
  };
}

function confidenceFor(current, previous, wearableTrends) {
  // Preserve the established weekly UX contract: five substantially logged
  // days is enough for a high-confidence descriptive review. Comparative
  // changes still carry their own blockers when a prior week, waist, or
  // wearable baseline is missing.
  if (current.daysLogged >= 5 && current.nutritionDays >= 4) return "high";
  if (current.daysLogged >= 3) return "medium";

  let score = 0;
  if (current.weightCount >= 4) score += 1;
  if (previous.weightCount >= 3) score += 1;
  if (current.waistCount >= 1 && previous.waistCount >= 1) score += 1;
  if (wearableTrends?.hasEnoughData) score += 1;
  return score >= 3 ? "medium" : "low";
}

function adjustConfidence(level, delta = 0) {
  const index = CONFIDENCE_ORDER.indexOf(level);
  return CONFIDENCE_ORDER[Math.max(0, Math.min(CONFIDENCE_ORDER.length - 1, index + delta))] || level;
}

function recoveryTrendFromWearables(wearableTrends, current) {
  const notes = wearableTrends?.notes || [];
  const negative = [];
  const positive = [];
  for (const note of notes) {
    if (note.trend === "insufficient") continue;
    const bad = (note.metric === "hrv" || note.metric === "sleep") ? note.trend === "falling"
      : note.metric === "rhr" ? note.trend === "rising"
        : note.metric === "strain" ? note.trend === "rising" : false;
    const good = (note.metric === "hrv" || note.metric === "sleep") ? note.trend === "rising"
      : note.metric === "rhr" ? note.trend === "falling" : false;
    if (bad) negative.push(note.note);
    if (good) positive.push(note.note);
  }
  if (current.avgSleep > 0 && current.avgSleep < 6.5) negative.push(`Sleep averaged ${current.avgSleep} hours.`);
  if (current.avgSoreness >= 7) negative.push(`Soreness averaged ${current.avgSoreness}/10.`);
  if (current.avgEnergy > 0 && current.avgEnergy <= 4.5) negative.push(`Energy averaged ${current.avgEnergy}/10.`);
  return {
    status: negative.length >= 3 ? "strained" : negative.length >= 1 ? "watch" : positive.length ? "improving" : "stable",
    negative,
    positive,
  };
}

function phaseFromSettings(settings) {
  return settings?.coachingPhase?.phase
    || (settings?.setup?.goal === "fat_loss" || settings?.setup?.macroPreset === "cut" ? "fat_loss" : null)
    || "recomposition";
}

function countDietingWeeks(data, goals) {
  const keys = Object.keys(data || {}).sort();
  if (!keys.length) return 0;
  const target = n(goals?.calories);
  if (!target) return 0;
  let qualifyingDays = 0;
  for (const key of keys.slice(-84)) {
    const calories = n(data[key]?.nutrition?.calories);
    if (calories > 0 && calories <= target * 1.1) qualifyingDays += 1;
  }
  return Math.floor(qualifyingDays / 5);
}

function buildRecommendation({ current, previous, phase, strength, recoveryTrend, confidence, calibrationProfile, goals, dietingWeeks }) {
  const guard = calibrationProfile?.falsePositiveGuard || { minStallDays: 14, minRecoverySignals: 3, requireSecondWeek: true };
  const weightDelta = current.weightAverage != null && previous.weightAverage != null ? current.weightAverage - previous.weightAverage : null;
  const currentWeight = current.weightAverage || current.weightLatest;
  const weeklyRatePct = weightDelta != null && currentWeight ? (weightDelta / currentWeight) * 100 : null;
  const waistDelta = current.waistLatest != null && previous.waistLatest != null ? current.waistLatest - previous.waistLatest : null;
  const adherenceReady = current.nutritionDays >= 5 && current.calorieAdherence >= 80 && current.proteinAdherence >= 80;
  const dataReady = current.daysLogged >= 5 && current.weightCount >= 4 && previous.weightCount >= 3;
  const strengthRisk = strength.status === "watch" || strength.status === "action";
  const recoveryRisk = recoveryTrend.status === "strained" || recoveryTrend.negative.length >= guard.minRecoverySignals;
  const stalled = weightDelta != null && Math.abs(weightDelta) < 0.25 && (waistDelta == null || Math.abs(waistDelta) < 0.15);
  const fastLoss = weeklyRatePct != null && weeklyRatePct <= -1.0;
  const appropriateLoss = weeklyRatePct != null && weeklyRatePct <= -0.25 && weeklyRatePct > -1.0;

  const base = {
    id: `weekly-${current.keys[0]}-${current.keys.at(-1)}`,
    confidence,
    authority: calibrationProfile?.authority || "observe",
    evidence: [],
    blockers: [],
    changes: {},
  };

  if (!dataReady) {
    return {
      ...base,
      kind: "collect_data",
      title: "Collect one more week",
      summary: "There is not enough body-weight history to make a responsible plan adjustment.",
      evidence: [`${current.daysLogged}/7 days logged`, `${current.weightCount} current-week weigh-ins`, `${previous.weightCount} prior-week weigh-ins`],
      blockers: ["No automatic target changes are allowed in observation mode."],
    };
  }

  if (strengthRisk || recoveryRisk || fastLoss) {
    const shouldDietBreak = dietingWeeks >= 6 && recoveryRisk && (strengthRisk || fastLoss);
    return {
      ...base,
      kind: shouldDietBreak ? "diet_break" : "recovery",
      title: shouldDietBreak ? "Consider a maintenance break" : "Protect recovery next week",
      summary: shouldDietBreak
        ? "Fat loss has accumulated alongside recovery or performance pressure. Hold restriction rather than tightening it."
        : "Do not reduce calories or add cardio while performance and recovery are under pressure.",
      changes: shouldDietBreak
        ? { caloriesDelta: "move toward estimated maintenance", durationDays: 7 }
        : { volumeReductionPct: strength.status === "action" ? 30 : 20, cardio: "hold or reduce optional work" },
      evidence: [
        ...(strength.headline ? [strength.headline] : []),
        ...recoveryTrend.negative.slice(0, 3),
        ...(fastLoss ? [`Average weight changed ${round1(weightDelta)} lb (${round1(weeklyRatePct)}%) week over week.`] : []),
      ],
      blockers: ["Do not interpret this as medical clearance; clinician-defined symptom rules still override the app."],
    };
  }

  if (!adherenceReady) {
    return {
      ...base,
      kind: "adherence",
      title: "Fix execution before restriction",
      summary: "The current calorie target has not been tested consistently enough to justify lowering it.",
      changes: { caloriesDelta: 0, stepsDelta: 0 },
      evidence: [`Calorie adherence ${current.calorieAdherence}%`, `Protein adherence ${current.proteinAdherence}%`, `${current.nutritionDays}/7 nutrition days logged`],
      blockers: ["The coach will not lower calories to compensate for inconsistent logging or execution."],
    };
  }

  if (phase === "fat_loss" && stalled) {
    const calories = n(goals?.calories) || current.avgCalories;
    const stepsLow = current.avgSteps > 0 && current.avgSteps < (n(goals?.steps) || 9000);
    const chooseActivity = stepsLow || calories <= 2000;
    return {
      ...base,
      kind: chooseActivity ? "activity" : "calories",
      title: chooseActivity ? "Add a small movement target" : "Use a small calorie adjustment",
      summary: chooseActivity
        ? "Weight and waist are holding despite good adherence. Add one modest activity lever instead of cutting food further."
        : "Weight and waist are holding despite good adherence. Reduce one small calorie block and reassess next week.",
      changes: chooseActivity ? { stepsDelta: 1000 } : { caloriesDelta: -125 },
      evidence: [`Weight change ${round1(weightDelta)} lb`, waistDelta == null ? "Waist comparison unavailable" : `Waist change ${round1(waistDelta)} in`, `Calorie adherence ${current.calorieAdherence}%`],
      blockers: [`Requires at least ${guard.minStallDays} days of repeated evidence before a second escalation.`],
    };
  }

  return {
    ...base,
    kind: "continue",
    title: "Continue unchanged",
    summary: appropriateLoss
      ? "Fat loss is moving while strength and recovery remain acceptable. Do not add another lever."
      : "The current plan is producing a stable, usable signal. Keep the week unchanged and collect another comparison.",
    changes: { caloriesDelta: 0, stepsDelta: 0, volumeReductionPct: 0 },
    evidence: [
      weightDelta == null ? "Weight trend still building" : `Weight change ${round1(weightDelta)} lb (${round1(weeklyRatePct)}%)`,
      `Protein adherence ${current.proteinAdherence}%`,
      strength.status === "stable" ? "Benchmark strength is stable." : strength.note || "Strength trend is still building.",
    ],
    blockers: ["Change only one major variable after repeated evidence."],
  };
}

/**
 * Build a structured weekly coaching review from logged data.
 * Backwards-compatible v1 fields remain; `engineVersion: 2` exposes the new
 * trend, adherence, recommendation, phase, and calibration fields.
 */
export function buildWeeklyCoachReview({
  data = {},
  goals = {},
  settings = {},
  program = null,
  weekEndKey = null,
  wearableTrends = null,
  calibrationProfile = null,
} = {}) {
  void program; // Program detail remains available to callers; no mutation here.
  const actualWeekEndKey = weekEndKey || dateKey(new Date());
  const weekKeys = keysForWindow(actualWeekEndKey, 7);
  const previousKeys = keysForWindow(shiftDate(weekKeys[0], -1), 7);
  const current = windowSummary(data, weekKeys, goals);
  const previous = windowSummary(data, previousKeys, goals);
  let confidence = confidenceFor(current, previous, wearableTrends);
  confidence = adjustConfidence(confidence, calibrationProfile?.confidenceAdjustment || 0);
  const strength = buildStrengthRetentionAlert({ data, todayKey: actualWeekEndKey });
  const recoveryTrend = recoveryTrendFromWearables(wearableTrends, current);
  const phase = phaseFromSettings(settings);
  const dietingWeeks = countDietingWeeks(data, goals);
  const recommendation = buildRecommendation({ current, previous, phase, strength, recoveryTrend, confidence, calibrationProfile, goals, dietingWeeks });
  const observationMode = confidence === "low" || recommendation.authority === "observe";

  const goalWorkouts = n(goals.workouts) || 5;
  const goalMiles = n(goals.miles) || 15;
  const goalProtein = n(goals.protein) || 200;
  const waterGoal = n(goals.water) || 128;
  const waterDays = current.rows.filter(({ entry }) => (n(entry?.nutrition?.water) || 0) >= waterGoal).length;
  const workoutScore = Math.min(1, current.workoutDays / goalWorkouts);
  const milesScore = Math.min(1, current.totalMiles / goalMiles);
  const proteinScore = Math.min(1, current.avgProtein / goalProtein);
  const sleepScore = Math.min(1, current.avgSleep / 7);
  const waterScore = Math.min(1, waterDays / 5);
  const adherenceScore = (current.calorieAdherence + current.proteinAdherence) / 200;
  const score = Math.round(((workoutScore + milesScore + proteinScore + sleepScore + waterScore + adherenceScore) / 6) * 100);

  const decisionStats = { followed: 0, modified: 0, ignored: 0, skipped: 0, total: 0 };
  for (const { entry } of current.rows) {
    const response = entry?.intelligence?.todayDecisionResponse?.response;
    if (Object.prototype.hasOwnProperty.call(decisionStats, response)) {
      decisionStats[response] += 1;
      decisionStats.total += 1;
    }
  }

  const weightDelta = current.weightAverage != null && previous.weightAverage != null ? round1(current.weightAverage - previous.weightAverage) : null;
  const waistDelta = current.waistLatest != null && previous.waistLatest != null ? round1(current.waistLatest - previous.waistLatest) : null;

  const wins = [];
  if (current.workoutDays >= goalWorkouts) wins.push(`Hit the training target with ${current.workoutDays} logged sessions.`);
  if (current.proteinAdherence >= 80) wins.push(`Protein adherence reached ${current.proteinAdherence}%.`);
  if (weightDelta != null && weightDelta < -0.25 && strength.status !== "action") wins.push(`Weight trend moved ${Math.abs(weightDelta)} lb while the strength signal remained usable.`);
  if (recoveryTrend.status === "improving") wins.push("Source-aware wearable recovery trends improved.");

  const watchouts = [];
  if (current.workoutDays < goalWorkouts) watchouts.push(`Training completion: ${current.workoutDays}/${goalWorkouts}.`);
  if (current.proteinAdherence < 80) watchouts.push(`Protein adherence: ${current.proteinAdherence}%.`);
  if (current.calorieAdherence < 80) watchouts.push(`Calorie adherence: ${current.calorieAdherence}%.`);
  if (current.avgSleep > 0 && current.avgSleep < 7) watchouts.push(`Sleep averaged ${current.avgSleep} hours.`);
  if (strength.status === "watch" || strength.status === "action") watchouts.push(strength.headline);

  const fuelRecoveryLinks = [];
  if (current.proteinAdherence < 70) {
    fuelRecoveryLinks.push(current.avgSoreness >= 6
      ? "Lower protein adherence occurred alongside elevated soreness; treat this as an association, not proof."
      : `Protein intake averaged ${current.avgProtein}g against a ${goalProtein}g target; close the fuel gap before changing training.`);
  }
  if (current.calorieAdherence < 70 && current.nutritionDays >= 3) fuelRecoveryLinks.push("Calorie execution was inconsistent enough to limit recovery and trend interpretation.");
  if (current.avgSleep > 0 && current.avgSleep < 6.5 && current.hardSetRatio >= 35) fuelRecoveryLinks.push("Short sleep and a high grinder/form-break share appeared in the same week.");
  if (recoveryTrend.negative.length) fuelRecoveryLinks.push(...recoveryTrend.negative.slice(0, 2));

  const trainingSignals = [];
  if (current.totalVolume > 0) trainingSignals.push(`Total training volume: ~${Math.round(current.totalVolume / 1000)}k lb.`);
  trainingSignals.push(`${current.completedSets} completed working sets; ${current.hardSetRatio}% were grinders, form breaks, or RIR 0.`);
  if (strength.status === "stable") trainingSignals.push("Repeated-lift strength retention is stable.");
  else if (strength.note) trainingSignals.push(strength.note);

  // Legacy headline remains a week-quality narrative for older surfaces. The
  // new coaching UI renders recommendation.title directly.
  const headline = score >= 80 ? "Strong week — maintain the progression"
    : score >= 60 ? "Solid week — protect consistency"
      : "Execution gaps need attention";
  const summary = recommendation.summary;
  const nextWeekActions = [
    ...Object.entries(recommendation.changes || {}).filter(([, value]) => value !== 0 && value != null).map(([key, value]) => `${key.replace(/([A-Z])/g, " $1")}: ${value}`),
    ...recommendation.blockers,
  ];
  if (recommendation.kind === "collect_data" && score >= 70) {
    nextWeekActions.unshift("Maintain consistency while the comparison baseline builds.");
  }
  if (!nextWeekActions.length) nextWeekActions.push("Keep the current plan unchanged and continue consistent logging.");

  return {
    // Compatibility contract for existing UI/tests.
    version: 1,
    engineVersion: 2,
    weekStartKey: weekKeys[0],
    weekEndKey: actualWeekEndKey,
    confidence,
    score,
    headline,
    summary,
    daysLogged: current.daysLogged,
    wins: wins.length ? wins : ["Keep logging to surface reliable wins."],
    watchouts,
    nextWeekActions,
    decisionStats,
    fuelRecoveryLinks,
    trainingSignals,

    // Fields.
    phase,
    observationMode,
    recommendation: { ...recommendation, observationMode },
    calibration: calibrationProfile ? {
      authority: calibrationProfile.authority,
      summary: calibrationProfile.summary,
      falsePositiveGuard: calibrationProfile.falsePositiveGuard,
    } : null,
    recoveryTrend,
    strength,
    currentWindow: current,
    previousWindow: previous,
    trend: {
      weightDelta,
      weightCurrent: current.weightAverage,
      weightPrevious: previous.weightAverage,
      waistDelta,
      waistCurrent: current.waistLatest,
      waistPrevious: previous.waistLatest,
    },
    adherence: {
      calories: current.calorieAdherence,
      protein: current.proteinAdherence,
      steps: current.stepAdherence,
      training: pct(current.workoutDays / Math.max(1, goalWorkouts)),
    },
    metrics: {
      workoutDays: current.workoutDays,
      totalMiles: current.totalMiles,
      avgCalories: current.avgCalories,
      avgProtein: current.avgProtein,
      avgSleep: current.avgSleep,
      avgEnergy: current.avgEnergy,
      avgSoreness: current.avgSoreness,
      avgSteps: current.avgSteps,
      waterDays,
      totalVolume: current.totalVolume,
      weightDelta,
      waistDelta,
      calorieAdherence: current.calorieAdherence,
      proteinAdherence: current.proteinAdherence,
      stepAdherence: current.stepAdherence,
    },
  };
}

export function buildWeeklyReviewResponse(review, response, {
  modifiedKind = null,
  reason = null,
  recordedAt = new Date().toISOString(),
  planVersion = null,
} = {}) {
  if (!review?.recommendation) return null;
  const effectiveDate = planVersion?.effectiveDate || (() => {
    const date = new Date(`${review.weekEndKey}T12:00:00`);
    date.setDate(date.getDate() + 1);
    return dateKey(date);
  })();
  const evaluationDue = planVersion?.evaluationDue || (() => {
    const date = new Date(`${effectiveDate}T12:00:00`);
    date.setDate(date.getDate() + 13);
    return dateKey(date);
  })();
  return {
    version: 2,
    recommendationId: review.recommendation.id,
    recommendationKind: review.recommendation.kind,
    recommendation: {
      title: review.recommendation.title,
      summary: review.recommendation.summary,
      changes: review.recommendation.changes || {},
    },
    response,
    modifiedKind,
    reason,
    recordedAt,
    confidence: review.confidence,
    observationMode: review.observationMode,
    lifecycle: {
      state: response === "rejected" ? "held" : "active",
      proposedAt: review.weekEndKey,
      effectiveDate,
      evaluationDue,
    },
    planVersion,
    baseline: {
      weight: review.currentWindow?.weightAverage ?? null,
      waist: review.currentWindow?.waistLatest ?? null,
      protein: review.currentWindow?.avgProtein ?? null,
      sleep: review.currentWindow?.avgSleep ?? null,
      soreness: review.currentWindow?.avgSoreness ?? null,
      energy: review.currentWindow?.avgEnergy ?? null,
      steps: review.currentWindow?.avgSteps ?? null,
      volume: review.currentWindow?.totalVolume ?? 0,
      workouts: review.currentWindow?.workoutDays ?? 0,
      loggedDays: review.currentWindow?.daysLogged ?? 0,
    },
  };
}

export default { buildWeeklyCoachReview, buildWeeklyReviewResponse };
