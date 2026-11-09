// src/adaptiveTDEE.js
// Adaptive TDEE — measure actual energy expenditure from the athlete's
// own ledger instead of estimating it from a population formula. Method
// (the MacroFactor-style energy-balance approach):
//
//   TDEE ≈ avg daily intake − (Δ trend weight in lb × 3500 kcal/lb) / days
//
// using the SMOOTHED weight trend (weightTrend.js) for Δ, never raw scale
// readings. Goal targets invert the same equation. localStorage persists the
// goal rate (same precedent as the race plan); calorie/protein targets are
// ADVISORY DISPLAY ONLY — nothing here writes to settings or entries.

import { buildWeightTrend } from "./weightTrend";

const KCAL_PER_LB = 3500;
const WINDOW_DAYS = 28;
const MIN_SPAN_DAYS = 14;
const MIN_LOGGED_DAYS = 10;

const GOAL_KEY = "ovt_energy_goal_v1";
export const GOAL_RATES = [
  { rate: -1.0,  label: "Cut fast · −1 lb/wk" },
  { rate: -0.5,  label: "Cut · −0.5 lb/wk" },
  { rate: 0,     label: "Maintain" },
  { rate: 0.25,  label: "Lean bulk · +0.25 lb/wk" },
  { rate: 0.5,   label: "Bulk · +0.5 lb/wk" },
];

export function readGoalRate() {
  try {
    const raw = localStorage.getItem(GOAL_KEY);
    if (raw === null) return null;
    const v = JSON.parse(raw)?.rate;
    return Number.isFinite(v) ? v : null;
  } catch { return null; }
}
export function writeGoalRate(rate) {
  try { localStorage.setItem(GOAL_KEY, JSON.stringify({ rate, setAt: new Date().toISOString() })); } catch {}
}

function dayDiff(a, b) {
  return Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 86400000);
}

// Measured TDEE
export function computeAdaptiveTDEE(data, { windowDays = WINDOW_DAYS } = {}) {
  if (!data) return { ready: false, note: "No data yet." };

  const trend = buildWeightTrend(data, { windowDays: windowDays + 30 });
  if (!trend?.ready) {
    return { ready: false, note: `Needs ${trend?.needed ?? 5} weigh-ins for the weight trend first — log morning weight in Check-in.` };
  }

  // Trend points inside the window, calorie days inside the same span.
  const windowPoints = trend.points.slice(-windowDays);
  const first = windowPoints[0];
  const last = windowPoints[windowPoints.length - 1];
  const spanDays = dayDiff(first.date, last.date);
  if (spanDays < MIN_SPAN_DAYS) {
    return { ready: false, note: `Needs ${MIN_SPAN_DAYS}+ days of weigh-in history (${spanDays} so far).` };
  }

  const calorieDays = Object.keys(data)
    .filter(k => k >= first.date && k <= last.date)
    .map(k => parseFloat(data[k]?.nutrition?.calories))
    .filter(v => Number.isFinite(v) && v > 500); // <500 kcal logged = partial day, exclude
  if (calorieDays.length < MIN_LOGGED_DAYS) {
    return { ready: false, note: `Needs ${MIN_LOGGED_DAYS}+ fully-logged calorie days in the window (${calorieDays.length} so far).` };
  }

  const avgIntake = calorieDays.reduce((a, b) => a + b, 0) / calorieDays.length;
  const trendDeltaLbs = last.trend - first.trend;
  const tdee = Math.round(avgIntake - (trendDeltaLbs * KCAL_PER_LB) / spanDays);

  // Confidence from logging density: how many of the span's days had calories.
  const density = calorieDays.length / spanDays;
  const confidence = density >= 0.8 ? "high" : density >= 0.55 ? "medium" : "low";

  return {
    ready: true,
    tdee,
    avgIntake: Math.round(avgIntake),
    trendDeltaLbs: Math.round(trendDeltaLbs * 10) / 10,
    spanDays,
    loggedDays: calorieDays.length,
    density: Math.round(density * 100),
    confidence,
    trendWeight: trend.current.trend,
    actualWeeklyRate: trend.current.weeklyRate,
  };
}

// Targets + drift
export function buildEnergyTargets(tdee, goalRate, trendWeight) {
  if (!Number.isFinite(tdee) || !Number.isFinite(goalRate)) return null;
  const calories = Math.round((tdee + (goalRate * KCAL_PER_LB) / 7) / 10) * 10;
  const protein = Number.isFinite(trendWeight) ? Math.round(trendWeight) : null; // 1 g/lb anchor
  return { calories, protein, goalRate };
}

// Compare the goal rate to what the trend is ACTUALLY doing. Only flags after
// the measurement is ready, and only beyond a ±0.25 lb/wk dead band —
// energy balance is noisy and small drift is normal.
export function buildDriftCheck(goalRate, actualWeeklyRate) {
  if (!Number.isFinite(goalRate) || !Number.isFinite(actualWeeklyRate)) return null;
  const drift = Math.round((actualWeeklyRate - goalRate) * 100) / 100;
  if (Math.abs(drift) <= 0.25) {
    return { onTrack: true, drift, note: "Trend is tracking the goal — hold the current intake." };
  }
  const adjust = Math.round(((-drift * KCAL_PER_LB) / 7) / 50) * 50;
  return {
    onTrack: false,
    drift,
    adjustKcal: adjust,
    note: drift > 0
      ? `Trending ${drift} lb/wk heavier than goal — consider ${adjust} kcal/day.`
      : `Trending ${Math.abs(drift)} lb/wk lighter than goal — consider +${adjust} kcal/day.`,
  };
}
