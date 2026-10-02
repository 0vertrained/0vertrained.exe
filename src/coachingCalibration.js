// src/coachingCalibration.js
// V18.5 · Calibration layer for daily and weekly coaching decisions.
// This module never mutates plans. It measures response/outcome history,
// exposes source coverage without requiring a particular wearable, and returns
// conservative decision authority for the weekly coach.

import { buildCalibrationReport } from "./coachCalibration";

const DAY_MS = 86400000;

const n = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

function dayDiff(a, b) {
  return Math.round((new Date(`${a}T12:00:00`) - new Date(`${b}T12:00:00`)) / DAY_MS);
}

function avg(values) {
  const clean = values.filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null;
}

function snapshotForWindow(data, endKey, days = 7) {
  const rows = Object.keys(data || {})
    .filter((key) => key <= endKey && dayDiff(endKey, key) < days)
    .sort()
    .map((key) => data[key]);
  const weights = rows.map((row) => n(row?.body?.weight)).filter(Number.isFinite);
  const waists = rows.map((row) => n(row?.body?.waist ?? row?.body?.waistInches ?? row?.measurements?.waist)).filter(Number.isFinite);
  const proteins = rows.map((row) => n(row?.nutrition?.protein)).filter(Number.isFinite);
  const sleeps = rows.map((row) => n(row?.body?.sleep)).filter(Number.isFinite);
  const workouts = rows.filter((row) => Object.keys(row?.workout?.exercises || {}).length > 0 || n(row?.workout?.cardio?.miles) > 0).length;
  return {
    weight: avg(weights),
    waist: waists.length ? waists[waists.length - 1] : null,
    protein: avg(proteins),
    sleep: avg(sleeps),
    workouts,
    loggedDays: rows.length,
  };
}

export function collectWeeklyRecommendationSamples(data = {}) {
  const samples = [];
  for (const date of Object.keys(data).sort()) {
    const response = data[date]?.intelligence?.weeklyCoachReviewResponse;
    if (!response?.response || !response?.recommendationKind) continue;
    const futureKeys = Object.keys(data).filter((key) => key > date && dayDiff(key, date) >= 6).sort();
    const nextEnd = futureKeys[0];
    if (!nextEnd) continue;
    const before = response.baseline || snapshotForWindow(data, date);
    const after = snapshotForWindow(data, nextEnd);
    const weightDelta = before.weight != null && after.weight != null ? after.weight - before.weight : null;
    const waistDelta = before.waist != null && after.waist != null ? after.waist - before.waist : null;
    const sleepDelta = before.sleep != null && after.sleep != null ? after.sleep - before.sleep : null;
    const executionImproved = after.workouts >= (before.workouts || 0) && (after.protein || 0) >= (before.protein || 0) * 0.95;
    const goalSignalImproved = response.recommendationKind === "recovery" || response.recommendationKind === "diet_break"
      ? (sleepDelta != null && sleepDelta >= 0.2) || executionImproved
      : (weightDelta != null && weightDelta < -0.1) || (waistDelta != null && waistDelta < -0.1) || executionImproved;
    samples.push({
      date,
      response: response.response,
      recommendationKind: response.recommendationKind,
      modifiedKind: response.modifiedKind || null,
      followed: response.response === "approved" || response.response === "modified",
      before,
      after,
      weightDelta,
      waistDelta,
      sleepDelta,
      favorable: Boolean(goalSignalImproved),
    });
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
      ? `Current trend inputs resolve independently from ${unique.join(", ")}; no provider is required and sources are never averaged.`
      : "No wearable trend is required. Manual logs remain a valid lower-confidence source.",
  };
}

export function buildCoachingCalibrationProfile({ data = {}, wearableTrends = null } = {}) {
  const daily = buildCalibrationReport(data, { windowDays: 90 });
  const weekly = collectWeeklyRecommendationSamples(data);
  const approved = weekly.filter((sample) => sample.response === "approved");
  const modified = weekly.filter((sample) => sample.response === "modified");
  const rejected = weekly.filter((sample) => sample.response === "rejected");
  const followed = weekly.filter((sample) => sample.followed);
  const favorable = followed.filter((sample) => sample.favorable);
  const weeklySuccessRate = followed.length ? Math.round((favorable.length / followed.length) * 100) : null;
  const source = sourceCoverage(wearableTrends);

  let authority = "observe";
  if ((daily.sampleCount || 0) >= 8 && followed.length >= 4) authority = "calibrated";
  else if ((daily.sampleCount || 0) >= 3 || followed.length >= 2) authority = "suggest";

  // Rejection-heavy histories make the coach ask for more evidence before
  // repeating the same class of recommendation.
  const rejectionRate = weekly.length ? rejected.length / weekly.length : 0;
  const falsePositiveGuard = {
    minStallDays: rejectionRate >= 0.4 ? 21 : 14,
    minRecoverySignals: rejectionRate >= 0.4 ? 4 : 3,
    requireSecondWeek: true,
    note: rejectionRate >= 0.4
      ? "Recent weekly recommendations were often rejected, so the engine now requires an extra week or signal before escalating."
      : "The engine requires repeated evidence; one bad day or weigh-in cannot escalate the plan.",
  };

  const confidenceAdjustment = authority === "calibrated" && weeklySuccessRate != null && weeklySuccessRate >= 60
    ? 1
    : authority === "observe" || rejectionRate >= 0.5
      ? -1
      : 0;

  return {
    version: 1,
    authority,
    daily,
    weekly: {
      sampleCount: weekly.length,
      followedCount: followed.length,
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
      ? `Calibrated from ${daily.sampleCount || 0} daily and ${followed.length} weekly follow-through samples.`
      : authority === "suggest"
        ? "Personalization is active, but recommendations remain suggest-only while more outcomes accumulate."
        : "Observation mode: the app explains patterns but does not treat them as personalized thresholds yet.",
  };
}

export default { collectWeeklyRecommendationSamples, buildCoachingCalibrationProfile };
