// src/adaptiveTDEE.js
// Estimate energy expenditure from explicitly confirmed food logs and the
// athlete's weight trend.
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
const MIN_COVERAGE = 0.55;
const DAY_MS = 86400000;

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

export function loggedCalories(nutrition) {
  const raw = nutrition?.calories;
  if (typeof raw !== "number" && (typeof raw !== "string" || !raw.trim())) return null;
  const calories = Number(raw);
  return Number.isFinite(calories) && calories >= 0 ? calories : null;
}

// The snapshot makes a correction to the total from *any* entry point reopen
// the day for confirmation. A later confirmation cannot enter an earlier replay.
export function confirmedCalories(nutrition, asOf) {
  const calories = loggedCalories(nutrition);
  const stamp = nutrition?.foodLogConfirmation;
  if (calories === null || stamp?.calories !== calories || !stamp.confirmedOn) return null;
  return asOf && stamp.confirmedOn > asOf ? null : calories;
}

export function computeAdaptiveTDEE(data = {}, { windowDays = WINDOW_DAYS, asOf } = {}) {
  const dates = Object.keys(data || {}).filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day)).sort();
  const end = asOf ?? dates.at(-1);
  if (!end) return { ready: false, note: "Log your morning weight and confirm full days of food in Fuel." };

  // Treat YYYY-MM-DD as civil days. UTC midnight arithmetic has no DST hops.
  const startMs = Date.parse(end) - (windowDays - 1) * DAY_MS;
  const start = new Date(startMs).toISOString().slice(0, 10);
  const warmup = new Date(startMs - 30 * DAY_MS).toISOString().slice(0, 10);
  const recent = Object.fromEntries(dates.filter((day) => day >= warmup && day <= end).map((day) => [day, data[day]]));
  const trend = buildWeightTrend(recent, { windowDays: windowDays + 30 });
  const windowPoints = (trend?.points || []).filter((p) => p.date >= start);
  if (windowPoints.length < 5) {
    return { ready: false, note: `Log at least 5 morning weigh-ins in the last ${windowDays} days to estimate expenditure.` };
  }
  const first = windowPoints[0];
  const last = windowPoints.at(-1);
  const spanDays = (Date.parse(last.date) - Date.parse(first.date)) / DAY_MS;
  const coverageDays = spanDays + 1;
  if (spanDays < MIN_SPAN_DAYS) {
    return { ready: false, note: `Needs ${MIN_SPAN_DAYS}+ days of weigh-in history (${spanDays} so far).` };
  }

  const calorieDays = dates
    .filter(k => k >= first.date && k <= last.date)
    .map(k => confirmedCalories(data[k]?.nutrition, asOf))
    .filter(Number.isFinite);
  const loggedDays = calorieDays.length;
  const density = Math.round(100 * loggedDays / coverageDays);
  const required = Math.max(MIN_LOGGED_DAYS, Math.ceil(MIN_COVERAGE * coverageDays));
  if (loggedDays < required) {
    return { ready: false, loggedDays, coverageDays, density,
      note: `Confirm at least ${required} complete food logs across these ${coverageDays} days in Fuel. You have confirmed ${loggedDays}.` };
  }

  const avgIntake = calorieDays.reduce((a, b) => a + b, 0) / calorieDays.length;
  const trendDeltaLbs = last.trend - first.trend;
  const tdee = Math.round(avgIntake - (trendDeltaLbs * KCAL_PER_LB) / spanDays);

  if (tdee <= 0) return { ready: false, note: "Check your weight and food totals. This period does not support an expenditure estimate." };

  return {
    ready: true,
    tdee,
    avgIntake: Math.round(avgIntake),
    trendDeltaLbs: Math.round(trendDeltaLbs * 10) / 10,
    spanDays,
    loggedDays,
    coverageDays,
    density,
    confidence: loggedDays / coverageDays >= 0.8 ? "high" : "medium",
    trendWeight: trend.current.trend,
    actualWeeklyRate: trend.current.weeklyRate,
  };
}

// Targets + drift
export function buildEnergyTargets(tdee, goalRate, trendWeight) {
  if (!Number.isFinite(tdee) || !Number.isFinite(goalRate)) return null;
  const calories = Math.round((tdee + (goalRate * KCAL_PER_LB) / 7) / 10) * 10;
  if (calories <= 0) return null;
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
