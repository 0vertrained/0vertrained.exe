// src/coachingCalibration.js
// Calibration layer for daily and weekly coaching decisions.
// This module never mutates plans. It measures response/outcome history,
// exposes source coverage without requiring a particular wearable, and returns
// conservative decision authority for the weekly coach.

import { confirmedCalories } from "./adaptiveTDEE";
import { getTodayKey } from "./constants";
import { buildCalibrationReport } from "./coachCalibration";

const DAY_MS = 86400000;
const MIN_READINGS = 3;

// Shown alongside the recommendation so athletes can see what the follow-up measures.
export const WEEKLY_ENDPOINT = {
  recovery: "Compare average sleep across the two weeks, using at least three nights each. A gain of 12 minutes counts as improvement.",
  diet_break: "Compare average weight using at least three weigh-ins each week. Staying within 0.25% counts as stable.",
  calories: "Compare average weight using at least three weigh-ins each week. A decrease of 0.25% to 1% counts toward the fat-loss goal.",
  activity: "Compare average daily steps with the suggested increase, using at least three recorded days each week.",
  adherence: "Compare days meeting both food targets, using at least three complete food logs each week. A higher share or at least 80% on target counts.",
  continue: "Check for at least 80% of complete food logs meeting both original targets, using at least five days.",
  collect_data: "Look for four weigh-ins over the next seven days.",
  collect_food: "Look for five confirmed food logs with protein over the next seven days.",
};

function offsetDay(key, days) {
  return new Date(Date.parse(key + "T12:00:00Z") + days * DAY_MS).toISOString().slice(0, 10);
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function snapshotForWindow(data, end, goals = {}, asOf = end) {
  const rows = [];
  for (let offset = -6; offset <= 0; offset++) {
    const key = offsetDay(end, offset);
    if (key <= asOf && data[key]) rows.push(data[key]);
  }
  const values = (read, allowZero = false) => rows.map(read)
    .filter(value => value != null && String(value).trim() !== "")
    .map(Number).filter(value => Number.isFinite(value) && (allowZero ? value >= 0 : value > 0));
  const weights = values(row => row?.body?.weight);
  const sleeps = values(row => row?.body?.sleep).filter(value => value <= 24);
  const steps = values(row => row?.activity?.steps, true);
  const meals = rows.filter(({ nutrition } = {}) => confirmedCalories(nutrition, asOf) != null &&
    nutrition.protein != null && String(nutrition.protein).trim() !== "" &&
    Number.isFinite(Number(nutrition.protein)) && Number(nutrition.protein) >= 0);
  const targetsKnown = Number(goals?.calories) > 0 && Number(goals?.protein) > 0;
  const hits = targetsKnown ? meals.filter(({ nutrition }) => Math.abs(nutrition.calories - goals.calories) <= goals.calories * 0.1 &&
    nutrition.protein >= goals.protein * 0.9).length : 0;
  return {
    weight: mean(weights), weightCount: weights.length, sleep: mean(sleeps), sleepCount: sleeps.length,
    steps: mean(steps), stepCount: steps.length, nutritionCount: meals.length,
    adherence: targetsKnown && meals.length ? hits / meals.length : null,
  };
}

export function weeklyRecommendationIntent({ data, review, goals, response }) {
  const date = review.weekEndKey;
  const storedGoals = { calories: goals?.calories ?? null, protein: goals?.protein ?? null };
  return {
    version: 2, response, recommendationKind: review.recommendation.kind, title: review.recommendation.title,
    recommendation: { ...review.recommendation }, confidence: review.confidence,
    recordedOn: date, phase: review.phase, goals: storedGoals, stepsDelta: review.recommendation.changes?.stepsDelta ?? null,
    baseline: snapshotForWindow(data, date, storedGoals),
  };
}

// These are observable endpoints for each recommendation. Enough readings
// on both sides are required for a change; missing weeks remain unscored.
function measureOutcome(intent, before, after) {
  const enough = (field) => before[field] >= MIN_READINGS && after[field] >= MIN_READINGS;
  switch (intent.recommendationKind) {
    case "recovery":
      return enough("sleepCount") ? after.sleep >= before.sleep + 0.2 : null;
    case "diet_break":
      return enough("weightCount") ? Math.abs(after.weight / before.weight - 1) <= 0.0025 : null;
    case "calories": {
      if (!enough("weightCount") || intent.phase !== "fat_loss") return null;
      const loss = 1 - after.weight / before.weight;
      return loss >= 0.0025 && loss <= 0.01;
    }
    case "activity":
      return enough("stepCount") && intent.stepsDelta > 0 ? after.steps >= before.steps + intent.stepsDelta : null;
    case "adherence":
      return enough("nutritionCount") && before.adherence != null && after.adherence != null
        ? after.adherence > before.adherence || after.adherence >= 0.8 : null;
    case "continue":
      return after.nutritionCount >= 5 && after.adherence != null ? after.adherence >= 0.8 : null;
    case "collect_food":
      return after.nutritionCount >= 5 ? true : null;
    case "collect_data":
      return after.weightCount >= 4 ? true : null;
    default:
      return null;
  }
}

export function collectWeeklyRecommendationSamples(data = {}, { asOf = getTodayKey() } = {}) {
  const samples = [];
  for (const date of Object.keys(data).filter(key => /^\d{4}-\d{2}-\d{2}$/.test(key) && key <= asOf).sort()) {
    const intent = data[date]?.intelligence?.weeklyCoachReviewResponse;
    if (!["approved", "modified", "rejected"].includes(intent?.response) || !intent.recommendationKind || intent.recordedOn > asOf) continue;
    const outcomeEnd = offsetDay(date, 7);
    const before = intent.version === 2 && intent.baseline ? intent.baseline : snapshotForWindow(data, date, intent.goals);
    const after = snapshotForWindow(data, outcomeEnd, intent.goals, asOf);
    const execution = ["followed", "skipped"].includes(intent.followThrough) &&
      intent.followThroughOn >= outcomeEnd && intent.followThroughOn <= asOf ? intent.followThrough : null;
    const followed = execution === "followed";
    const ready = outcomeEnd <= asOf;
    const favorable = ready && followed && intent.response === "approved" ? measureOutcome(intent, before, after) : null;
    const outcome = !ready ? "pending" : favorable == null ? "unknown" : favorable ? "favorable" : "unfavorable";
    samples.push({ date, outcomeEnd, response: intent.response, recommendationKind: intent.recommendationKind,
      modifiedKind: intent.modifiedKind || null, execution, followed, favorable, outcome, before, after });
  }
  return samples;
}

function sourceCoverage(wearableTrends) {
  const sources = Object.values(wearableTrends?.sources || {}).filter(Boolean);
  const unique = [...new Set(sources)];
  return {
    sources: unique,
    labels: unique.map((source) => ({ oura: "Oura", whoop: "Whoop", manual: "Manual", app_log: "App log" }[source] || source)),
    providerNeutral: true,
    hasWearable: unique.some((source) => source === "oura" || source === "whoop"),
    note: unique.length
      ? `Trends are read from ${unique.map((source) => ({ oura: "Oura", whoop: "Whoop", manual: "manual logs", app_log: "the app log" }[source] || source)).join(" and ")}, each on its own. No device is required and sources are never averaged.`
      : "No wearable is needed. Manual logs still count, with lower confidence.",
  };
}

export function buildCoachingCalibrationProfile({ data = {}, wearableTrends = null, asOf = getTodayKey() } = {}) {
  const daily = buildCalibrationReport(data, { windowDays: 90, asOf });
  const weekly = collectWeeklyRecommendationSamples(data, { asOf });
  const approved = weekly.filter((sample) => sample.response === "approved");
  const modified = weekly.filter((sample) => sample.response === "modified");
  const rejected = weekly.filter((sample) => sample.response === "rejected");
  const followed = weekly.filter((sample) => sample.followed);
  const scored = followed.filter(sample => sample.favorable != null);
  const favorable = scored.filter(sample => sample.favorable);
  const weeklySuccessRate = scored.length ? Math.round((favorable.length / scored.length) * 100) : null;
  const source = sourceCoverage(wearableTrends);

  let authority = "observe";
  if ((daily.sampleCount || 0) >= 8 && scored.length >= 4) authority = "calibrated";
  else if ((daily.sampleCount || 0) >= 3 || scored.length >= 2) authority = "suggest";

  // Rejection-heavy histories make the coach ask for more evidence before
  // repeating the same class of recommendation.
  const rejectionRate = weekly.length ? rejected.length / weekly.length : 0;
  const falsePositiveGuard = {
    minStallDays: rejectionRate >= 0.4 ? 21 : 14,
    minRecoverySignals: rejectionRate >= 0.4 ? 4 : 3,
    requireSecondWeek: true,
    note: rejectionRate >= 0.4
      ? "You turned down recent weekly recommendations often, so it now takes an extra week or an extra signal before one is raised again."
      : "It takes repeated evidence. One bad day or one weigh-in cannot change the plan.",
  };

  const confidenceAdjustment = authority === "calibrated" && weeklySuccessRate != null && weeklySuccessRate >= 60
    ? 1
    : authority === "observe" || rejectionRate >= 0.5
      ? -1
      : 0;

  return {
    version: 2,
    authority,
    daily,
    weekly: {
      sampleCount: weekly.length,
      followedCount: followed.length,
      evaluatedCount: scored.length,
      approved: approved.length,
      modified: modified.length,
      rejected: rejected.length,
      favorable: favorable.length,
      successRate: weeklySuccessRate,
      samples: weekly,
    },
    sourceCoverage: source,
    falsePositiveGuard,
    confidenceAdjustment,
    summary: authority === "calibrated"
      ? `Calibrated from ${daily.sampleCount || 0} daily and ${scored.length} measured weekly outcomes.`
      : authority === "suggest"
        ? "Personalization is on. Recommendations stay suggestions while more outcomes build up."
        : "Observation mode. The app explains patterns but does not yet treat them as thresholds personal to you.",
  };
}

export default { collectWeeklyRecommendationSamples, buildCoachingCalibrationProfile };
