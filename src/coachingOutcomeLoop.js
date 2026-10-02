/**
 * V18.6 · Coaching Outcome Loop
 * Pure lifecycle, plan versioning, outcome evaluation, projection, monthly
 * review, phase-transition, and inbox helpers. The UI owns persistence.
 */

const DAY_MS = 86400000;
const n = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const avg = (values) => {
  const clean = values.filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null;
};
const round1 = (value) => Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function dateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(`${value}T12:00:00`);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function shiftDate(key, days) {
  const date = new Date(`${key}T12:00:00`);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

function dayDiff(later, earlier) {
  return Math.round((new Date(`${later}T12:00:00`) - new Date(`${earlier}T12:00:00`)) / DAY_MS);
}

function hasWorkout(entry) {
  return Object.keys(entry?.workout?.exercises || {}).length > 0 || (n(entry?.workout?.cardio?.miles) || 0) > 0;
}

function completedSetStats(entry) {
  let sets = 0;
  let volume = 0;
  let strainSets = 0;
  for (const exercise of Object.values(entry?.workout?.exercises || {})) {
    for (const set of exercise?.sets || []) {
      if (!set?.done) continue;
      sets += 1;
      volume += (n(set.weight) || 0) * (n(set.reps) || 0);
      if (set.quality === "grind" || set.quality === "form_break" || n(set.rir) === 0) strainSets += 1;
    }
  }
  return { sets, volume, strainSets };
}

export function summarizeWindow(data = {}, startKey, endKey, goals = {}) {
  const keys = Object.keys(data).filter((key) => key >= startKey && key <= endKey).sort();
  const rows = keys.map((key) => ({ key, entry: data[key] })).filter(({ entry }) => entry);
  const weights = rows.map(({ entry }) => n(entry?.body?.weight)).filter((value) => value > 0);
  const waists = rows.map(({ entry }) => n(entry?.body?.waist ?? entry?.body?.waistInches ?? entry?.measurements?.waist)).filter((value) => value > 0);
  const calories = rows.map(({ entry }) => n(entry?.nutrition?.calories)).filter((value) => value > 0);
  const proteins = rows.map(({ entry }) => n(entry?.nutrition?.protein)).filter((value) => value > 0);
  const sleeps = rows.map(({ entry }) => n(entry?.body?.sleep)).filter(Number.isFinite);
  const soreness = rows.map(({ entry }) => n(entry?.body?.soreness)).filter(Number.isFinite);
  const energy = rows.map(({ entry }) => n(entry?.body?.energy)).filter(Number.isFinite);
  const steps = rows.map(({ entry }) => n(entry?.activity?.steps)).filter(Number.isFinite);
  const workoutDays = rows.filter(({ entry }) => hasWorkout(entry)).length;
  const setStats = rows.reduce((total, { entry }) => {
    const stats = completedSetStats(entry);
    total.sets += stats.sets;
    total.volume += stats.volume;
    total.strainSets += stats.strainSets;
    return total;
  }, { sets: 0, volume: 0, strainSets: 0 });
  const targetCalories = n(goals.calories);
  const targetProtein = n(goals.protein) || 200;
  const targetSteps = n(goals.steps) || 9000;
  const calorieHits = targetCalories ? calories.filter((value) => value >= targetCalories * 0.9 && value <= targetCalories * 1.1).length : 0;
  const proteinHits = proteins.filter((value) => value >= targetProtein * 0.9).length;
  const stepHits = steps.filter((value) => value >= targetSteps).length;
  return {
    startKey,
    endKey,
    daysLogged: rows.length,
    weight: round1(avg(weights)),
    weightCount: weights.length,
    waist: waists.at(-1) ?? null,
    waistCount: waists.length,
    calories: Math.round(avg(calories) || 0),
    protein: Math.round(avg(proteins) || 0),
    sleep: round1(avg(sleeps)),
    soreness: round1(avg(soreness)),
    energy: round1(avg(energy)),
    steps: Math.round(avg(steps) || 0),
    workoutDays,
    completedSets: setStats.sets,
    volume: Math.round(setStats.volume),
    strainSetPct: setStats.sets ? Math.round((setStats.strainSets / setStats.sets) * 100) : 0,
    calorieAdherence: calories.length ? Math.round((calorieHits / calories.length) * 100) : 0,
    proteinAdherence: proteins.length ? Math.round((proteinHits / proteins.length) * 100) : 0,
    stepAdherence: steps.length ? Math.round((stepHits / steps.length) * 100) : 0,
  };
}

const STANDARD_CHANGES = {
  continue: { caloriesDelta: 0, stepsDelta: 0, volumeReductionPct: 0, cardioMinutesDelta: 0 },
  calories: { caloriesDelta: -125, stepsDelta: 0, volumeReductionPct: 0, cardioMinutesDelta: 0 },
  activity: { caloriesDelta: 0, stepsDelta: 1000, volumeReductionPct: 0, cardioMinutesDelta: 0 },
  recovery: { caloriesDelta: 0, stepsDelta: 0, volumeReductionPct: 35, cardioMinutesDelta: -10 },
  diet_break: { caloriesDelta: 250, stepsDelta: 0, volumeReductionPct: 20, cardioMinutesDelta: -10 },
  adherence: { caloriesDelta: 0, stepsDelta: 0, volumeReductionPct: 0, cardioMinutesDelta: 0 },
  collect_data: { caloriesDelta: 0, stepsDelta: 0, volumeReductionPct: 0, cardioMinutesDelta: 0 },
};

export function resolveRecommendationKind(response) {
  return response?.response === "modified" && response.modifiedKind ? response.modifiedKind : response?.recommendationKind || "continue";
}

export function buildPlanVersion({ review, response, modifiedKind = null, settings = {}, previousPlan = null, recordedAt = new Date().toISOString() } = {}) {
  const kind = response === "modified" && modifiedKind ? modifiedKind : review?.recommendation?.kind || "continue";
  const recommendationChanges = review?.recommendation?.changes || {};
  const useRecommendationChanges = !(response === "modified" && modifiedKind && modifiedKind !== review?.recommendation?.kind);
  const changes = {
    ...(STANDARD_CHANGES[kind] || STANDARD_CHANGES.continue),
    ...(useRecommendationChanges ? recommendationChanges : {}),
  };
  const currentGoals = { ...(settings.goals || {}) };
  const snapshot = {
    phase: settings?.coachingPhase?.phase || settings?.coachingSystem?.phase || review?.phase || "recomposition",
    goals: {
      ...currentGoals,
      calories: Math.max(1200, Math.round((n(currentGoals.calories) || 2400) + (n(changes.caloriesDelta) || 0))),
      protein: Math.round(n(currentGoals.protein) || 200),
      steps: Math.max(0, Math.round((n(currentGoals.steps) || 9000) + (n(changes.stepsDelta) || 0))),
    },
    trainingModifiers: {
      volumeReductionPct: clamp(Math.round(n(changes.volumeReductionPct) || 0), 0, 60),
      cardioMinutesDelta: Math.round(n(changes.cardioMinutesDelta) || 0),
      targetRir: (n(changes.volumeReductionPct) || 0) >= 25 ? 3 : null,
    },
  };
  const effectiveDate = shiftDate(review?.weekEndKey || dateKey(recordedAt.slice(0, 10)), 1);
  return {
    id: `plan-${review?.recommendation?.id || review?.weekEndKey || dateKey()}-${Date.parse(recordedAt) || Date.now()}`,
    version: (previousPlan?.version || 0) + 1,
    label: `Plan v${(previousPlan?.version || 0) + 1}`,
    previousVersionId: previousPlan?.id || null,
    recommendationId: review?.recommendation?.id || null,
    recommendationKind: kind,
    createdAt: recordedAt,
    effectiveDate,
    evaluationDue: shiftDate(effectiveDate, 13),
    status: "active",
    changes,
    snapshot,
  };
}

export function collectRecommendationRecords(data = {}) {
  return Object.keys(data).sort().flatMap((date) => {
    const response = data[date]?.intelligence?.weeklyCoachReviewResponse;
    if (!response?.response) return [];
    const kind = resolveRecommendationKind(response);
    const effectiveDate = response.lifecycle?.effectiveDate || response.planVersion?.effectiveDate || shiftDate(date, 1);
    const evaluationDue = response.lifecycle?.evaluationDue || response.planVersion?.evaluationDue || shiftDate(effectiveDate, 13);
    return [{
      ...response,
      date,
      kind,
      lifecycle: {
        state: response.response === "rejected" ? "held" : (dateKey() > evaluationDue ? "evaluation_due" : "active"),
        effectiveDate,
        evaluationDue,
        ...(response.lifecycle || {}),
      },
    }];
  });
}

export function collectPlanVersions(data = {}, settings = {}) {
  const records = collectRecommendationRecords(data);
  const versions = records.map((record, index) => record.planVersion || {
    id: `legacy-plan-${record.recommendationId || record.date}`,
    version: index + 1,
    label: `Plan v${index + 1}`,
    previousVersionId: index ? `legacy-plan-${records[index - 1].recommendationId || records[index - 1].date}` : null,
    recommendationId: record.recommendationId,
    recommendationKind: record.kind,
    createdAt: record.recordedAt || `${record.date}T12:00:00`,
    effectiveDate: record.lifecycle.effectiveDate,
    evaluationDue: record.lifecycle.evaluationDue,
    status: record.response === "rejected" ? "held" : "historical",
    changes: STANDARD_CHANGES[record.kind] || STANDARD_CHANGES.continue,
    snapshot: { phase: settings?.coachingPhase?.phase || "recomposition", goals: { ...(settings.goals || {}) }, trainingModifiers: {} },
  }).filter((version, index) => records[index]?.response !== "rejected");
  const settingVersions = settings?.coachingSystem?.planHistory || [];
  const merged = [...versions, ...settingVersions].filter((version, index, all) => version?.id && all.findIndex((item) => item.id === version.id) === index);
  return merged.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

function outcomeDeltas(before, after) {
  return {
    weight: before?.weight != null && after?.weight != null ? round1(after.weight - before.weight) : null,
    waist: before?.waist != null && after?.waist != null ? round1(after.waist - before.waist) : null,
    sleep: before?.sleep != null && after?.sleep != null ? round1(after.sleep - before.sleep) : null,
    soreness: before?.soreness != null && after?.soreness != null ? round1(after.soreness - before.soreness) : null,
    workoutDays: (after?.workoutDays || 0) - (before?.workouts ?? before?.workoutDays ?? 0),
    volumePct: before?.volume > 0 && after?.volume > 0 ? Math.round(((after.volume - before.volume) / before.volume) * 100) : null,
  };
}

export function evaluateRecommendation(record, data = {}, goals = {}, todayKey = dateKey()) {
  if (!record || record.response === "rejected") return { status: "held", label: "Held", reason: record?.reason || "Recommendation was held." };
  const effectiveDate = record.lifecycle?.effectiveDate || shiftDate(record.date, 1);
  const due = record.lifecycle?.evaluationDue || shiftDate(effectiveDate, 13);
  const end = todayKey < due ? todayKey : due;
  const after = summarizeWindow(data, effectiveDate, end, record.planVersion?.snapshot?.goals || goals);
  const before = record.baseline || {};
  const deltas = outcomeDeltas(before, after);
  const targetDays = dayDiff(end, effectiveDate) + 1;
  const adherence = Math.round(avg([after.calorieAdherence, after.proteinAdherence, after.stepAdherence].filter((value) => value > 0)) || 0);
  if (todayKey < due) return { status: "active", label: "Active", due, daysRemaining: dayDiff(due, todayKey), after, deltas, adherence };
  if (after.daysLogged < Math.min(7, Math.max(4, Math.floor(targetDays * 0.5))) || adherence < 60) {
    return { status: "not_followed", label: "Not followed closely enough", due, after, deltas, adherence, reason: "The evaluation window does not contain enough consistent execution to judge the recommendation." };
  }
  const kind = record.kind || resolveRecommendationKind(record);
  const performanceStable = deltas.volumePct == null || deltas.volumePct >= -12;
  const recoveryStable = (deltas.sleep == null || deltas.sleep >= -0.3) && (deltas.soreness == null || deltas.soreness <= 1);
  const bodyImproved = (deltas.weight != null && deltas.weight <= -0.3) || (deltas.waist != null && deltas.waist <= -0.15);
  const recoveryImproved = (deltas.sleep != null && deltas.sleep >= 0.3) || (deltas.soreness != null && deltas.soreness <= -1);
  let status = "inconclusive";
  if (["calories", "activity", "continue", "adherence"].includes(kind)) {
    if (bodyImproved && performanceStable && recoveryStable) status = "effective";
    else if (!performanceStable || !recoveryStable) status = "harmful";
    else if (!bodyImproved && after.daysLogged >= 10) status = "ineffective";
  } else if (["recovery", "diet_break"].includes(kind)) {
    if (recoveryImproved && performanceStable) status = "effective";
    else if ((deltas.sleep != null && deltas.sleep <= -0.5) || !performanceStable) status = "harmful";
    else if (!recoveryImproved) status = "ineffective";
  }
  const labels = { effective: "Effective", harmful: "Harmful", ineffective: "Ineffective", inconclusive: "Inconclusive" };
  return { status, label: labels[status], due, after, deltas, adherence, performanceStable, recoveryStable };
}

export function buildOutcomeLoop({ data = {}, settings = {}, goals = settings.goals || {}, todayKey = dateKey() } = {}) {
  const records = collectRecommendationRecords(data).map((record) => ({ ...record, outcome: evaluateRecommendation(record, data, goals, todayKey) }));
  const planVersions = collectPlanVersions(data, settings);
  const activePlan = settings?.coachingSystem?.activePlan || [...planVersions].reverse().find((plan) => plan.status !== "rolled_back") || null;
  return {
    version: 1,
    records: records.slice().reverse(),
    planVersions: planVersions.slice().reverse(),
    activePlan,
    pendingEvaluation: records.filter((record) => record.outcome.status === "active" || record.outcome.status === "evaluation_due"),
    evaluated: records.filter((record) => ["effective", "harmful", "ineffective", "inconclusive", "not_followed"].includes(record.outcome.status)),
  };
}

function regressionSlope(points) {
  if (points.length < 4) return null;
  const xMean = avg(points.map((point) => point.x));
  const yMean = avg(points.map((point) => point.y));
  const numerator = points.reduce((sum, point) => sum + (point.x - xMean) * (point.y - yMean), 0);
  const denominator = points.reduce((sum, point) => sum + (point.x - xMean) ** 2, 0);
  return denominator ? numerator / denominator : null;
}

export function buildGoalProjection({ data = {}, settings = {}, todayKey = dateKey() } = {}) {
  const goalRange = settings?.coachingSystem?.goalWeightRange || { min: 178, max: 185 };
  const start = shiftDate(todayKey, -27);
  const rows = Object.keys(data).filter((key) => key >= start && key <= todayKey).sort()
    .map((key, index) => ({ x: index, key, y: n(data[key]?.body?.weight) }))
    .filter((point) => point.y > 0);
  const currentWeight = rows.length ? round1(avg(rows.slice(-7).map((row) => row.y))) : null;
  const slope = regressionSlope(rows);
  const weeklyRate = slope != null ? round1(slope * 7) : null;
  const target = Number.isFinite(n(goalRange.max)) ? n(goalRange.max) : null;
  let weeksLow = null;
  let weeksHigh = null;
  if (currentWeight && target && weeklyRate != null && weeklyRate < -0.15 && currentWeight > target) {
    const raw = (currentWeight - target) / Math.abs(weeklyRate);
    weeksLow = Math.max(1, Math.round(raw * 0.9));
    weeksHigh = Math.max(weeksLow + 1, Math.round(raw * 1.35 + 2));
  }
  const enough = rows.length >= 14;
  const confidence = rows.length >= 21 && weeklyRate != null ? "moderate" : rows.length >= 7 ? "low" : "building";
  return {
    currentWeight,
    goalRange,
    recentRate: weeklyRate,
    confidence,
    weighIns: rows.length,
    estimatedWindow: weeksLow != null ? { weeksLow, weeksHigh, start: shiftDate(todayKey, weeksLow * 7), end: shiftDate(todayKey, weeksHigh * 7) } : null,
    note: !enough ? "Collect at least two weeks of consistent weigh-ins before treating the projection as useful."
      : weeklyRate == null || weeklyRate >= -0.15 ? "Recent weight change is too flat or noisy for a responsible completion estimate."
        : "The window is a range and assumes adherence remains similar while loss gradually slows.",
  };
}

export function buildMonthlyPhysiqueReview({ data = {}, settings = {}, todayKey = dateKey() } = {}) {
  const current = summarizeWindow(data, shiftDate(todayKey, -27), todayKey, settings.goals || {});
  const previous = summarizeWindow(data, shiftDate(todayKey, -55), shiftDate(todayKey, -28), settings.goals || {});
  const weightDelta = current.weight != null && previous.weight != null ? round1(current.weight - previous.weight) : null;
  const waistDelta = current.waist != null && previous.waist != null ? round1(current.waist - previous.waist) : null;
  const photos = Object.keys(data).filter((key) => key >= shiftDate(todayKey, -27)).reduce((sum, key) => sum + (Array.isArray(data[key]?.body?.progressPhotos) ? data[key].body.progressPhotos.length : 0), 0);
  const strengthStable = previous.volume <= 0 || current.volume >= previous.volume * 0.88;
  const favorable = (weightDelta == null || weightDelta <= 0) && (waistDelta == null || waistDelta <= 0) && strengthStable;
  return {
    periodStart: current.startKey,
    periodEnd: current.endKey,
    current,
    previous,
    weightDelta,
    waistDelta,
    photos,
    strengthStatus: strengthStable ? "stable" : "watch",
    assessment: current.daysLogged < 14 ? "The month is still too sparse for a reliable block assessment."
      : favorable ? "Fat-loss and performance signals are moving in a favorable direction."
        : "The block needs review before another restriction or volume increase.",
    nextBlock: favorable ? "Continue the current phase and preserve the highest-value progression work." : "Hold major changes until adherence, recovery, and strength are reconciled.",
  };
}

export function buildPhaseTransitionRecommendation({ monthlyReview, settings = {}, projection = null } = {}) {
  const phase = settings?.coachingPhase?.phase || settings?.coachingSystem?.phase || "recomposition";
  const dietingWeeks = n(settings?.coachingSystem?.dietingWeeks) || 0;
  const currentWeight = projection?.currentWeight;
  const goalMax = n(projection?.goalRange?.max);
  if (phase === "medical_hold") return { kind: "stay", from: phase, to: phase, title: "Keep the medical hold", confidence: "high", reason: "Medical holds are hard constraints and require clinician clearance to exit." };
  if (phase === "fat_loss" && currentWeight && goalMax && currentWeight <= goalMax) {
    return { kind: "transition", from: phase, to: "maintenance", title: "Transition to maintenance", confidence: "moderate", reason: "The trend-weight goal range has been reached. Stabilize before deciding on another phase." };
  }
  const strained = monthlyReview?.current?.sleep != null && monthlyReview.current.sleep < 6.5
    || monthlyReview?.current?.soreness != null && monthlyReview.current.soreness >= 7
    || monthlyReview?.strengthStatus === "watch";
  if (phase === "fat_loss" && dietingWeeks >= 12 && strained) {
    return { kind: "transition", from: phase, to: "diet_break", title: "Consider a maintenance break", confidence: "moderate", reason: "Diet duration and recovery strain have converged. A short maintenance phase is safer than adding restriction." };
  }
  if (phase === "diet_break" && dietingWeeks >= 2 && !strained) {
    return { kind: "transition", from: phase, to: "fat_loss", title: "Resume the fat-loss phase", confidence: "low", reason: "Recovery is stable enough to consider resuming the approved deficit." };
  }
  return { kind: "stay", from: phase, to: phase, title: `Stay in ${phase.replace(/_/g, " ")}`, confidence: "moderate", reason: "The current phase remains consistent with the available trend and recovery evidence." };
}

export function buildCoachingInbox({ review, outcomeLoop, nutritionAutopilot = null, phaseTransition = null, notificationPrefs = {}, todayKey = dateKey() } = {}) {
  const items = [];
  const enabled = (key) => notificationPrefs?.[key] !== false;
  const response = review ? outcomeLoop?.records?.find((record) => record.recommendationId === review.recommendation?.id) : null;
  if (review && !response && enabled("weeklyReview")) items.push({ id: `review-${review.weekEndKey}`, priority: 1, kind: "review", title: "Weekly review ready", detail: review.recommendation?.title || "Review the next-week recommendation." });
  for (const record of outcomeLoop?.records || []) {
    if (record.outcome?.status === "active" && record.outcome.daysRemaining <= 2 && enabled("weeklyReview")) items.push({ id: `eval-${record.recommendationId}`, priority: 2, kind: "evaluation", title: "Plan evaluation approaching", detail: `${record.outcome.daysRemaining} day${record.outcome.daysRemaining === 1 ? "" : "s"} until the outcome window closes.` });
    if (["harmful", "ineffective"].includes(record.outcome?.status) && enabled("fatiguePattern")) items.push({ id: `outcome-${record.recommendationId}`, priority: 0, kind: "outcome", title: `${record.outcome.label} coaching outcome`, detail: "Review the result before approving another change." });
  }
  if (nutritionAutopilot?.traysRemaining != null && nutritionAutopilot.traysRemaining <= 4 && enabled("factorInventory")) items.push({ id: "factor-low", priority: 2, kind: "nutrition", title: "Factor inventory low", detail: `${nutritionAutopilot.traysRemaining} trays remain.` });
  if (phaseTransition?.kind === "transition" && enabled("weeklyReview")) items.push({ id: `phase-${phaseTransition.to}`, priority: 1, kind: "phase", title: phaseTransition.title, detail: phaseTransition.reason });
  return { generatedAt: todayKey, items: items.sort((a, b) => a.priority - b.priority).slice(0, 8), count: items.length };
}

export function buildCoachingSettingsPatch(settings = {}, patch = {}) {
  return {
    ...settings,
    coachingSystem: {
      goalWeightRange: { min: 178, max: 185 },
      phase: settings?.coachingPhase?.phase || "recomposition",
      notificationPrefs: {
        morningCheckin: true,
        scheduledTraining: true,
        proteinGap: true,
        factorInventory: true,
        weeklyReview: true,
        fatiguePattern: true,
        progressPhotoDay: true,
        quietHours: { start: "21:30", end: "07:00" },
      },
      clinicianGuardrails: {
        enabled: false,
        exerciseHeartRateGuidance: "",
        stopRules: "Chest discomfort, faintness, unusual shortness of breath, or concerning palpitations: stop training and follow the clinician-approved plan.",
        medicationNotes: "",
        trainingRestrictions: "",
        emergencyInstructions: "",
        clinicianReviewDate: "",
      },
      ...(settings.coachingSystem || {}),
      ...patch,
    },
  };
}

export default {
  buildOutcomeLoop,
  buildPlanVersion,
  buildGoalProjection,
  buildMonthlyPhysiqueReview,
  buildPhaseTransitionRecommendation,
  buildCoachingInbox,
  buildCoachingSettingsPatch,
  evaluateRecommendation,
};
