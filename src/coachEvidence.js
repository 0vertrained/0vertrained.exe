// src/coachEvidence.js
// V19.0 · Question-specific, inspectable evidence packets for the unified coach.
// The browser derives compact summaries from the athlete's own loaded data.
// Deterministic application code remains authoritative; the model receives
// evidence to explain, not raw logs to recalculate.

import { buildNutritionAutopilot } from "./nutritionAutopilot";
import { buildOutcomeLoop, shiftDate, summarizeWindow } from "./coachingOutcomeLoop";
import { getExerciseSessions } from "./progressionEngine";
import { flattenProgramLifting } from "./programSessions";

const MAX_EVIDENCE = 18;
const MAX_EXERCISES = 3;

const n = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

function cleanText(value, max = 120) {
  return typeof value === "string" ? value.trim().slice(0, max) : null;
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function hasAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

const DEEP_PATTERNS = [
  /\b(8|10|12|16)\s*(week|weeks)\b/i,
  /\b(month|months|quarter|longitudinal|over time|history|historical)\b/i,
  /\b(intervention|outcome|effective|ineffective|compare blocks?|long[- ]term pattern)\b/i,
  /\b(weight|bodyweight|fat loss|waist)\b.*\b(plateau|stall|stalled)\b/i,
  /\bwhy\b.*\b(weight|bodyweight|fat loss|waist)\b.*\b(not|isn'?t|aren'?t|stalled|plateau|declin)/i,
  /\b(analy[sz]e|investigate|diagnose)\b.*\b(trend|progress|block|phase|months?|weeks?)\b/i,
];

const FAST_PATTERNS = [
  /\b(how much|how many)\b.*\b(left|remaining|today)\b/i,
  /\b(next meal|what should i eat next|factor meal|protein left|calories left)\b/i,
  /\bwhat('?s| is) next\b/i,
  /\b(did i hit|am i at)\b.*\b(protein|calories|steps)\b/i,
  /\b(today'?s? target|today'?s? goal)\b/i,
];

const NUTRITION_PATTERNS = /\b(protein|calorie|macro|meal|eat|food|factor|nutrition|carb|fat|restaurant|grocery)\b/i;
const TRAINING_PATTERNS = /\b(workout|train|training|exercise|set|rep|rir|strength|press|row|squat|deadlift|curl|cardio|run|lifting)\b/i;
const RECOVERY_PATTERNS = /\b(recovery|sleep|hrv|resting heart|rhr|soreness|fatigue|whoop|oura|readiness)\b/i;

export function classifyCoachQuestion(question = "") {
  const text = String(question || "").trim();
  const deep = hasAny(text, DEEP_PATTERNS);
  const fast = !deep && hasAny(text, FAST_PATTERNS);
  const domains = [];
  if (NUTRITION_PATTERNS.test(text)) domains.push("nutrition");
  if (TRAINING_PATTERNS.test(text)) domains.push("training");
  if (RECOVERY_PATTERNS.test(text)) domains.push("recovery");
  if (!domains.length) domains.push("general");
  return {
    routeHint: deep ? "deep" : fast ? "fast" : "main",
    domains,
    consequential: /\b(change|reduce|increase|adjust|deload|diet break|maintenance|stop|skip|push|phase)\b/i.test(text),
  };
}

function collectExerciseNames(data = {}, program = {}) {
  const names = new Set();
  for (const session of Object.values(program || {})) {
    for (const exercise of session?.lifting || []) {
      if (exercise?.name) names.add(String(exercise.name).trim());
    }
  }
  for (const entry of Object.values(data || {})) {
    for (const [plannedName, exercise] of Object.entries(entry?.workout?.exercises || {})) {
      if (plannedName) names.add(String(plannedName).trim());
      if (exercise?.performedName) names.add(String(exercise.performedName).trim());
    }
  }
  return [...names].filter(Boolean);
}

// V19.5 · A program exercise can declare how it's logged (bodyweight reps for
// an Inverted Row, a Nordic curl…). Read by name alone, a bodyweight set logged
// without a weight looks like a loaded set missing its weight and drops out of
// the history the coach sees, so the program's own exercise is passed along.
function programExercisesByName(program = {}) {
  const byName = new Map();
  for (const day of Object.values(program || {})) {
    for (const exercise of flattenProgramLifting(day && typeof day === "object" ? day : {})) {
      const key = String(exercise?.name || "").trim().toLowerCase();
      if (key && !byName.has(key)) byName.set(key, exercise);
    }
  }
  return byName;
}

function mentionedExercises(question, names) {
  const q = ` ${normalize(question)} `;
  return names
    .map((name) => ({ name, normalized: normalize(name) }))
    .filter(({ normalized }) => normalized.length >= 3 && q.includes(` ${normalized} `))
    .sort((a, b) => b.normalized.length - a.normalized.length)
    .slice(0, MAX_EXERCISES)
    .map(({ name }) => name);
}

function summarizeToday(entry = {}, goals = {}) {
  const calories = n(entry?.nutrition?.calories) || 0;
  const protein = n(entry?.nutrition?.protein) || 0;
  const steps = n(entry?.activity?.steps) || 0;
  const targetCalories = n(goals?.calories);
  const targetProtein = n(goals?.protein) || 200;
  const targetSteps = n(goals?.steps) || 9000;
  const completedSets = Object.values(entry?.workout?.exercises || {}).reduce(
    (sum, exercise) => sum + (exercise?.sets || []).filter((set) => set?.done).length,
    0,
  );
  return {
    calories,
    protein,
    steps,
    targets: { calories: targetCalories, protein: targetProtein, steps: targetSteps },
    remaining: {
      calories: targetCalories == null ? null : Math.max(0, Math.round(targetCalories - calories)),
      protein: Math.max(0, Math.round(targetProtein - protein)),
      steps: Math.max(0, Math.round(targetSteps - steps)),
    },
    sleep: n(entry?.body?.sleep),
    weight: n(entry?.body?.weight),
    completedSets,
    cardioMiles: n(entry?.workout?.cardio?.miles) || 0,
  };
}

function compactWindow(summary) {
  if (!summary) return null;
  return {
    start: summary.startKey,
    end: summary.endKey,
    daysLogged: summary.daysLogged,
    weightCount: summary.weightCount,
    waistCount: summary.waistCount,
    weight: summary.weight,
    waist: summary.waist,
    calories: summary.calories,
    protein: summary.protein,
    sleep: summary.sleep,
    steps: summary.steps,
    workoutDays: summary.workoutDays,
    completedSets: summary.completedSets,
    volume: summary.volume,
    strainSetPct: summary.strainSetPct,
    calorieAdherence: summary.calorieAdherence,
    proteinAdherence: summary.proteinAdherence,
    stepAdherence: summary.stepAdherence,
  };
}

function compactExerciseSession(session) {
  return {
    date: session.date,
    performedName: cleanText(session.performedName, 80),
    label: cleanText(session.label, 80),
    setsCompleted: session.setsCompleted,
    weight: session.weight,
    reps: Array.isArray(session.reps) ? session.reps.slice(0, 6) : [],
    avgRir: Number.isFinite(session.avgRir) ? Math.round(session.avgRir * 10) / 10 : null,
    worstQuality: session.worstQuality || null,
    pain: Boolean(session.pain),
    bestE1RM: Number.isFinite(session.bestE1RM) ? Math.round(session.bestE1RM * 10) / 10 : null,
  };
}

function makeEvidenceCollector() {
  const evidence = [];
  return {
    add(type, label, data, { dateRange = null, importance = "supporting" } = {}) {
      if (evidence.length >= MAX_EVIDENCE || data == null) return null;
      const id = `E${evidence.length + 1}`;
      evidence.push({ id, type, label, dateRange, importance, data });
      return id;
    },
    values() { return evidence; },
  };
}

function twelveWeekWindows(data, goals, todayKey) {
  const windows = [];
  for (let index = 11; index >= 0; index -= 1) {
    const end = shiftDate(todayKey, -(index * 7));
    const start = shiftDate(end, -6);
    const summary = compactWindow(summarizeWindow(data, start, end, goals));
    if (summary?.daysLogged) windows.push(summary);
  }
  return windows;
}

export function buildCoachEvidencePacket({
  question,
  data = {},
  settings = {},
  program = {},
  todayKey,
  todayName,
  wearableSummary = null,
  intelligenceSummary = null,
} = {}) {
  const classification = classifyCoachQuestion(question);
  const collector = makeEvidenceCollector();
  const goals = settings?.goals || {};
  const today = data?.[todayKey] || {};
  const guardrails = settings?.coachingSystem?.clinicianGuardrails || null;

  if (guardrails?.enabled === true) {
    collector.add("clinician_guardrails", "Clinician-defined hard constraints", {
      exerciseHeartRateGuidance: cleanText(guardrails.exerciseHeartRateGuidance, 300),
      stopRules: cleanText(guardrails.stopRules, 500),
      trainingRestrictions: cleanText(guardrails.trainingRestrictions, 500),
      emergencyInstructions: cleanText(guardrails.emergencyInstructions, 500),
      reviewDate: cleanText(guardrails.clinicianReviewDate, 20),
    }, { importance: "hard_constraint" });
  }

  const outcomeLoop = (() => {
    try { return buildOutcomeLoop({ data, settings, todayKey }); }
    catch { return null; }
  })();
  const activePlan = settings?.coachingSystem?.activePlan || outcomeLoop?.activePlan || null;
  if (activePlan) {
    collector.add("active_plan", activePlan.label || "Active coaching plan", {
      version: activePlan.version || null,
      effectiveDate: activePlan.effectiveDate || null,
      evaluationDue: activePlan.evaluationDue || null,
      recommendationKind: activePlan.recommendationKind || null,
      goals: activePlan.snapshot?.goals || null,
      trainingModifiers: activePlan.snapshot?.trainingModifiers || null,
    }, { dateRange: activePlan.effectiveDate ? `${activePlan.effectiveDate} onward` : null, importance: "authoritative" });
  }

  collector.add("today", `${todayName || "Today"} progress`, summarizeToday(today, goals), {
    dateRange: todayKey,
    importance: classification.routeHint === "fast" ? "primary" : "supporting",
  });

  const currentStart = shiftDate(todayKey, -6);
  const previousEnd = shiftDate(currentStart, -1);
  const previousStart = shiftDate(previousEnd, -6);
  const currentWeek = compactWindow(summarizeWindow(data, currentStart, todayKey, goals));
  const previousWeek = compactWindow(summarizeWindow(data, previousStart, previousEnd, goals));
  collector.add("weekly_comparison", "Current versus previous seven-day window", {
    current: currentWeek,
    previous: previousWeek,
    weightDelta: currentWeek?.weight != null && previousWeek?.weight != null
      ? Math.round((currentWeek.weight - previousWeek.weight) * 10) / 10
      : null,
    waistDelta: currentWeek?.waist != null && previousWeek?.waist != null
      ? Math.round((currentWeek.waist - previousWeek.waist) * 10) / 10
      : null,
  }, { dateRange: `${previousStart} to ${todayKey}`, importance: classification.routeHint === "deep" ? "primary" : "supporting" });

  if (wearableSummary) {
    collector.add("wearable_recovery", "Resolved wearable recovery context", {
      summary: cleanText(wearableSummary, 500),
      note: "Provider-specific values are resolved by application logic; do not average conflicting sources.",
    }, { dateRange: `${shiftDate(todayKey, -6)} to ${todayKey}`, importance: "supporting" });
  }

  if (intelligenceSummary) {
    collector.add("deterministic_recommendation", "0VERTRAINED deterministic recommendation", {
      readiness: cleanText(intelligenceSummary.readiness, 24),
      confidence: cleanText(intelligenceSummary.confidence, 16),
      title: cleanText(intelligenceSummary.title, 80),
      summary: cleanText(intelligenceSummary.summary, 240),
      reasons: Array.isArray(intelligenceSummary.reasons)
        ? intelligenceSummary.reasons.slice(0, 5).map((reason) => ({
            source: cleanText(reason?.source, 24),
            severity: cleanText(reason?.severity, 16),
            label: cleanText(reason?.label, 80),
          }))
        : [],
    }, { dateRange: todayKey, importance: "authoritative" });
  }

  if (classification.domains.includes("nutrition") || classification.routeHint === "fast") {
    try {
      const autopilot = buildNutritionAutopilot({
        data,
        todayKey,
        nutrition: today?.nutrition || {},
        goals,
        hour: new Date().getHours(),
      });
      collector.add("nutrition_autopilot", "Nutrition Autopilot", {
        headline: cleanText(autopilot.headline, 120),
        summary: cleanText(autopilot.summary, 240),
        gaps: autopilot.macros?.gaps || null,
        nextMeal: autopilot.nextMeal ? {
          name: cleanText(autopilot.nextMeal.name, 100),
          calories: n(autopilot.nextMeal.calories),
          protein: n(autopilot.nextMeal.protein),
          verified: autopilot.nextMeal.verified === true,
        } : null,
        traysRemaining: autopilot.traysRemaining,
        rescueMode: autopilot.rescueMode,
        rescueOptions: (autopilot.rescueOptions || []).slice(0, 3).map((option) => ({
          label: cleanText(option.label, 100),
          calories: n(option.calories),
          protein: n(option.protein),
          category: cleanText(option.category, 40),
        })),
        caveat: cleanText(autopilot.caveat, 200),
      }, { dateRange: todayKey, importance: "primary" });
    } catch { /* nutrition context is optional */ }
  }

  const exerciseNames = collectExerciseNames(data, program);
  const mentions = mentionedExercises(question, exerciseNames);
  const shouldIncludeExercise = mentions.length > 0 || classification.domains.includes("training");
  const fallbackProgramNames = (program?.[todayName]?.lifting || []).map((exercise) => exercise?.name).filter(Boolean);
  const selectedExercises = mentions.length ? mentions : fallbackProgramNames.slice(0, MAX_EXERCISES);
  if (shouldIncludeExercise) {
    const programExercises = programExercisesByName(program);
    for (const exerciseName of selectedExercises.slice(0, MAX_EXERCISES)) {
      const exercise = programExercises.get(String(exerciseName).trim().toLowerCase()) || null;
      const sessions = getExerciseSessions(data, exerciseName, shiftDate(todayKey, 1), { lookbackDays: 120, limit: 5, exercise });
      if (!sessions.length) continue;
      collector.add("exercise_history", `${exerciseName} recent exposures`, {
        exerciseName: cleanText(exerciseName, 80),
        sessions: sessions.map(compactExerciseSession),
      }, { dateRange: `${sessions.at(-1)?.date || todayKey} to ${sessions[0]?.date || todayKey}`, importance: mentions.includes(exerciseName) ? "primary" : "supporting" });
    }
  }

  const latestOutcome = outcomeLoop?.evaluated?.[0] || outcomeLoop?.records?.find((record) => record?.outcome) || null;
  if (latestOutcome) {
    collector.add("recommendation_outcome", "Latest coaching recommendation outcome", {
      kind: latestOutcome.kind || latestOutcome.recommendationKind || null,
      response: latestOutcome.response || null,
      status: latestOutcome.outcome?.status || null,
      label: cleanText(latestOutcome.outcome?.label, 80),
      reason: cleanText(latestOutcome.outcome?.reason, 240),
      adherence: latestOutcome.outcome?.adherence ?? null,
      deltas: latestOutcome.outcome?.deltas || null,
      evaluationDue: latestOutcome.lifecycle?.evaluationDue || null,
    }, { importance: classification.routeHint === "deep" ? "primary" : "supporting" });
  }

  if (classification.routeHint === "deep") {
    const windows = twelveWeekWindows(data, goals, todayKey);
    collector.add("longitudinal_windows", "Twelve-week coaching trend windows", { weeks: windows }, {
      dateRange: `${shiftDate(todayKey, -83)} to ${todayKey}`,
      importance: "primary",
    });
  }

  const missing = [];
  if (!currentWeek?.weight || (currentWeek?.weightCount || 0) < 4) missing.push("Fewer than four current-week weigh-ins.");
  if (!currentWeek?.waist) missing.push("No current-week waist measurement.");
  if ((currentWeek?.daysLogged || 0) < 4) missing.push("Recent logging is sparse.");

  return {
    version: 1,
    generatedForDate: todayKey,
    routeHint: classification.routeHint,
    domains: classification.domains,
    consequential: classification.consequential,
    evidence: collector.values(),
    missing,
    rules: {
      deterministicAuthority: true,
      modelMayExplainButNotMutate: true,
      userApprovalRequiredForPlanChanges: true,
    },
  };
}

export default { classifyCoachQuestion, buildCoachEvidencePacket };
