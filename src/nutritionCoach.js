// src/nutritionCoach.js
// Dynamic nutrition recommendations. Pure module: no React, no network, no writes.

import { PROTEIN_PER_LB } from "./intelligenceConfig";

const n = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function macroGap(current, goal) {
  return Math.max(0, Math.round(n(goal) - n(current)));
}

function pct(current, goal) {
  const g = n(goal);
  if (!g) return 0;
  return clamp(n(current) / g, 0, 2);
}

function programDemand(todayProgram) {
  const text = [todayProgram?.type, todayProgram?.code, todayProgram?.cardio?.type, todayProgram?.cardio?.effort, todayProgram?.cardio?.notes]
    .map(v => String(v || "").toLowerCase())
    .join(" ");
  const miles = n(todayProgram?.cardio?.miles);
  const hasLift = Array.isArray(todayProgram?.lifting) && todayProgram.lifting.length > 0;
  const hard = /interval|tempo|hyrox|speed|high|station/.test(text);
  const longRun = /long/.test(text) || miles >= 6;
  const rest = /rest/.test(text) && !todayProgram?.cardio && !hasLift;

  if (rest) return { level: "rest", label: "Recovery day", carbsBias: 0.85, caloriesBias: 0.9 };
  if (hard || longRun) return { level: "high", label: longRun ? "Long-run fueling" : "High-output session", carbsBias: 1.08, caloriesBias: 1.03 };
  if (hasLift || todayProgram?.cardio) return { level: "moderate", label: "Training day", carbsBias: 1, caloriesBias: 1 };
  return { level: "unknown", label: "General fueling", carbsBias: 1, caloriesBias: 1 };
}

function adjustedGoals(goals = {}, todayProgram = null, recommendation = null, bodyWeightLb = 0) {
  const demand = programDemand(todayProgram);
  const readiness = recommendation?.readiness || "normal";
  // Protein: honor an explicit goal; otherwise derive from bodyweight (athlete
  // range ~0.9 g/lb) and only fall back to a flat default if neither is known.
  let protein = Math.round(n(goals.protein) || 0);
  if (!protein) protein = bodyWeightLb > 0 ? Math.round(bodyWeightLb * PROTEIN_PER_LB) : 200;
  let calories = Math.round(n(goals.calories) || 0);
  let carbs = Math.round(n(goals.carbs) || 0);
  let fats = Math.round(n(goals.fats) || 0);
  const water = Math.round(n(goals.water) || 128);

  if (calories) calories = Math.round(calories * demand.caloriesBias);
  if (carbs) carbs = Math.round(carbs * demand.carbsBias);
  if (readiness === "rest" || readiness === "pull_back") {
    // Keep protein stable; slightly reduce carb pressure on recovery-heavy days.
    if (carbs) carbs = Math.round(carbs * 0.92);
  }
  if (demand.level === "high" && fats) fats = Math.max(0, Math.round(fats * 0.95));

  return { calories, protein, carbs, fats, water, demand };
}

const QUICK_ADDS = [
  { id: "whey-banana", label: "Whey + banana", calories: 235, protein: 26, carbs: 32, fats: 2, bestFor: ["protein", "carbs"] },
  { id: "chicken-rice", label: "Chicken + rice bowl", calories: 560, protein: 55, carbs: 62, fats: 8, bestFor: ["protein", "carbs", "calories"] },
  { id: "greek-yogurt", label: "Greek yogurt bowl", calories: 330, protein: 40, carbs: 32, fats: 4, bestFor: ["protein"] },
  { id: "rice-honey", label: "Rice + honey", calories: 270, protein: 4, carbs: 62, fats: 0, bestFor: ["carbs"] },
  { id: "olive-rice", label: "Rice + olive oil", calories: 325, protein: 4, carbs: 45, fats: 14, bestFor: ["calories", "fats"] },
  { id: "electrolytes", label: "Electrolytes + 16oz water", calories: 0, protein: 0, carbs: 0, fats: 0, water: 16, bestFor: ["water"] },
];

function scoreAdd(add, gaps, priority) {
  let score = 0;
  for (const key of ["protein", "carbs", "fats", "calories", "water"]) {
    const gap = gaps[key] || 0;
    if (!gap) continue;
    const contribution = Math.min(n(add[key]), gap) / Math.max(gap, 1);
    score += contribution * (key === priority ? 4 : 1.5);
  }
  if ((add.bestFor || []).includes(priority)) score += 2;
  return score;
}

function priorityFromGaps(gaps, progress) {
  if (progress.protein < 0.75 && gaps.protein > 25) return "protein";
  if (progress.water < 0.7 && gaps.water >= 24) return "water";
  if (progress.calories < 0.8 && gaps.calories > 600) return "calories";
  if (progress.carbs < 0.75 && gaps.carbs > 70) return "carbs";
  if (progress.fats < 0.65 && gaps.fats > 25) return "fats";
  if (gaps.protein > 10) return "protein";
  if (gaps.carbs > 30) return "carbs";
  if (gaps.calories > 200) return "calories";
  if (gaps.water > 0) return "water";
  return "done";
}

export function buildNutritionRecommendation({ nutrition = {}, goals = {}, todayProgram = null, recommendation = null, bodyWeightLb = 0 } = {}) {
  const targets = adjustedGoals(goals, todayProgram, recommendation, bodyWeightLb);
  const current = {
    calories: Math.round(n(nutrition.calories)),
    protein: Math.round(n(nutrition.protein)),
    carbs: Math.round(n(nutrition.carbs)),
    fats: Math.round(n(nutrition.fats)),
    water: Math.round(n(nutrition.water)),
  };
  const gaps = {
    calories: macroGap(current.calories, targets.calories),
    protein: macroGap(current.protein, targets.protein),
    carbs: macroGap(current.carbs, targets.carbs),
    fats: macroGap(current.fats, targets.fats),
    water: macroGap(current.water, targets.water),
  };
  const progress = {
    calories: pct(current.calories, targets.calories),
    protein: pct(current.protein, targets.protein),
    carbs: pct(current.carbs, targets.carbs),
    fats: pct(current.fats, targets.fats),
    water: pct(current.water, targets.water),
  };
  const priority = priorityFromGaps(gaps, progress);
  const scoredAdds = QUICK_ADDS
    .map(add => ({ ...add, score: scoreAdd(add, gaps, priority) }))
    .filter(add => add.score > 0)
    .sort((a, b) => b.score - a.score);
  const priorityAdd = scoredAdds.find(add => (add.bestFor || []).includes(priority));
  const quickAdds = [priorityAdd, ...scoredAdds]
    .filter(Boolean)
    .filter((add, idx, arr) => arr.findIndex(x => x.id === add.id) === idx)
    .slice(0, 3)
    .map(({ score, ...add }) => add);

  const title = priority === "done"
    ? "Fueling on target"
    : priority === "protein"
      ? "Protein first"
      : priority === "carbs"
        ? "Carbs are the limiter"
        : priority === "water"
          ? "Hydration gap"
          : priority === "fats"
            ? "Add fats carefully"
            : "Close the calorie gap";

  const summary = priority === "done"
    ? "Macros are close enough. Stop optimizing and go live your life."
    : `${targets.demand.label}: close ${priority} first, then reassess calories.`;

  const warnings = [];
  if (progress.protein < 0.55) warnings.push("Protein is far behind target; prioritize lean protein before calorie filler.");
  if (targets.demand.level === "high" && progress.carbs < 0.65) warnings.push("Carbs are low for today's training demand.");
  if (progress.water < 0.5) warnings.push("Hydration is materially behind target.");

  return { title, summary, priority, current, targets, gaps, progress, quickAdds, warnings };
}

export default { buildNutritionRecommendation };
