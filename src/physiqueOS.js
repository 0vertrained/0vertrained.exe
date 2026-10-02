// src/physiqueOS.js
// 0VERTRAINED v18.1 · Physique OS Release 1
//
// Pure decision helpers for the Daily Operating System. This module turns the
// app's existing readiness, program, nutrition, workout, and Factor data into a
// small set of executable daily targets. It never writes data and never makes
// medical decisions; UI surfaces persist explicit user choices separately.

import { readCheckin } from "./checkinMorning";
import { factorDayPlan, getFactorDayIndex } from "./factorCutPlan";
import { summarizeProgramDay } from "./programSummary";
import { hasProgramTraining } from "./programSessions";

export const PHYSIQUE_OS_VERSION = 1;

export const DAY_MODES = {
  full: {
    key: "full",
    label: "Full",
    short: "Execute the complete plan.",
    stepTarget: 9000,
    sleepTarget: 8,
    proteinFactor: 1,
    proteinFloor: 180,
    calorieFloorDelta: 250,
  },
  minimum: {
    key: "minimum",
    label: "Minimum",
    short: "Keep the habit; do the priority work.",
    stepTarget: 6000,
    sleepTarget: 8.5,
    proteinFactor: 0.9,
    proteinFloor: 170,
    calorieFloorDelta: 350,
  },
  rescue: {
    key: "rescue",
    label: "Rescue",
    short: "Protect tomorrow; do not abandon the week.",
    stepTarget: 3000,
    sleepTarget: 9,
    proteinFactor: 0.8,
    proteinFloor: 160,
    calorieFloorDelta: 500,
  },
};

const VALID_MODES = new Set(Object.keys(DAY_MODES));

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function rounded(value, fallback = 0) {
  const number = finite(value);
  return number === null ? fallback : Math.round(number);
}

export function recommendDayMode({ decision = null, recommendation = null, body = {} } = {}) {
  if (body?.illnessOrInjury === true || body?.illnessOrInjury === "true") return "rescue";
  const call = decision?.call;
  const readiness = recommendation?.readiness;
  if (call === "recover" || readiness === "rest") return "rescue";
  if (call === "modify" || readiness === "pull_back" || readiness === "moderate") return "minimum";
  return "full";
}

export function resolveDayMode({ storedMode = null, decision = null, recommendation = null, body = {} } = {}) {
  if (VALID_MODES.has(storedMode)) return storedMode;
  return recommendDayMode({ decision, recommendation, body });
}

export function buildOperatingTargets({ mode = "full", goals = {}, settings = {} } = {}) {
  const selected = DAY_MODES[VALID_MODES.has(mode) ? mode : "full"];
  const calories = Math.max(0, rounded(goals.calories, 2400));
  const baseProtein = Math.max(0, rounded(goals.protein, 200));
  const configuredSteps = rounded(goals.steps, rounded(settings?.physiqueOS?.stepTarget, DAY_MODES.full.stepTarget));
  const activeModifiers = settings?.coachingSystem?.activePlan?.snapshot?.trainingModifiers || {};
  const fullSteps = Math.max(1000, configuredSteps);
  const stepTarget = selected.key === "full"
    ? fullSteps
    : Math.min(fullSteps, selected.stepTarget);
  const protein = Math.min(
    baseProtein,
    Math.max(selected.proteinFloor, Math.round(baseProtein * selected.proteinFactor))
  );
  const calorieFloor = Math.max(0, calories - selected.calorieFloorDelta);
  const calorieCeiling = calories + 100;

  return {
    mode: selected.key,
    modeLabel: selected.label,
    modeSummary: selected.short,
    calories,
    calorieFloor,
    calorieCeiling,
    protein,
    steps: stepTarget,
    sleepHours: selected.sleepTarget,
    volumeReductionPct: Math.max(0, rounded(activeModifiers.volumeReductionPct, 0)),
    cardioMinutesDelta: rounded(activeModifiers.cardioMinutesDelta, 0),
    activePlanLabel: settings?.coachingSystem?.activePlan?.label || null,
  };
}

export function buildTrainingPrescription({ mode = "full", decision = null, adaptiveSuggestion = null, programDay = null } = {}) {
  const summary = summarizeProgramDay(programDay);
  const isRest = !hasProgramTraining(programDay);

  if (decision?.call === "recover" || mode === "rescue") {
    return {
      tone: "recover",
      title: isRest ? "Keep the recovery day" : "Recovery replaces hard training",
      detail: decision?.primaryAction || "Use an easy walk or mobility only. Do not chase missed volume tomorrow.",
    };
  }

  if (decision?.call === "modify" || mode === "minimum") {
    const change = adaptiveSuggestion?.changes?.[0]?.label;
    return {
      tone: "modify",
      title: isRest ? "Keep the rest day" : "Priority work only",
      detail: change || decision?.primaryAction || "Use a 30-minute abbreviated session and stop before grinding reps.",
    };
  }

  return {
    tone: decision?.call === "push" ? "push" : "maintain",
    title: isRest ? "Bank the recovery" : summary.label || "Run the planned session",
    detail: decision?.primaryAction || adaptiveSuggestion?.changes?.[0]?.label || "Execute the programmed work with controlled effort.",
  };
}

export function buildFactorOperatingPlan(todayKey, nutrition = {}) {
  const index = getFactorDayIndex(todayKey);
  if (index < 0) return null;
  const plan = factorDayPlan(index);
  if (!plan) return null;
  const logged = nutrition?.factorPlan || {};
  const meals = [
    { slot: "factorLunch", label: "Lunch", ...plan.lunch },
    { slot: "factorDinner", label: "Dinner", ...plan.dinner },
  ].map((meal) => ({ ...meal, logged: logged[meal.slot] === meal.id }));

  return {
    ...plan,
    index,
    meals,
    loggedCount: meals.filter((meal) => meal.logged).length,
  };
}

export function buildDailyCloseout({
  todayData = {},
  targets = {},
  totalExercises = 0,
  doneExercises = 0,
  hasCardio = false,
  cardioLogged = false,
  isRest = false,
  wearableSteps = null,
} = {}) {
  const nutrition = todayData?.nutrition || {};
  const body = todayData?.body || {};
  const manualSteps = finite(todayData?.activity?.steps);
  const steps = manualSteps ?? finite(wearableSteps) ?? 0;
  const calories = rounded(nutrition.calories, 0);
  const protein = rounded(nutrition.protein, 0);
  const checkin = readCheckin(body);

  const liftingDone = totalExercises > 0 ? doneExercises >= totalExercises : true;
  const cardioDone = hasCardio ? cardioLogged : true;
  const trainingDone = isRest || (liftingDone && cardioDone);
  const proteinDone = protein >= rounded(targets.protein, 0);
  const caloriesDone = calories >= rounded(targets.calorieFloor, 0)
    && calories <= rounded(targets.calorieCeiling, Number.MAX_SAFE_INTEGER);
  const stepsDone = steps >= rounded(targets.steps, 0);
  const checkinDone = checkin.answered >= 3;

  const items = [
    { key: "checkin", label: "Morning check-in", done: checkinDone, weight: 10 },
    { key: "training", label: isRest ? "Recovery day protected" : "Training completed", done: trainingDone, weight: 30 },
    { key: "protein", label: `Protein ${protein}/${rounded(targets.protein, 0)}g`, done: proteinDone, weight: 25 },
    { key: "calories", label: calories ? `Calories ${calories}` : "Calories not logged", done: caloriesDone, weight: 20 },
    { key: "steps", label: `Steps ${Math.round(steps).toLocaleString()}/${rounded(targets.steps, 0).toLocaleString()}`, done: stepsDone, weight: 15 },
  ];
  const score = items.reduce((sum, item) => sum + (item.done ? item.weight : 0), 0);
  const status = score >= 85 ? "complete" : score >= 60 ? "partial" : "rescue";

  return {
    score,
    status,
    items,
    openItems: items.filter((item) => !item.done),
    snapshot: {
      calories,
      protein,
      steps: Math.round(steps),
      trainingDone,
      checkinAnswered: checkin.answered,
      mode: targets.mode || "full",
    },
  };
}

export function buildCloseoutEntry(closeout, now = new Date()) {
  return {
    version: PHYSIQUE_OS_VERSION,
    status: closeout?.status || "partial",
    score: rounded(closeout?.score, 0),
    closedAt: now.toISOString(),
    snapshot: closeout?.snapshot || {},
  };
}

export default {
  PHYSIQUE_OS_VERSION,
  DAY_MODES,
  recommendDayMode,
  resolveDayMode,
  buildOperatingTargets,
  buildTrainingPrescription,
  buildFactorOperatingPlan,
  buildDailyCloseout,
  buildCloseoutEntry,
};
