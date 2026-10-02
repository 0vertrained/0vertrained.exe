// src/nutritionAutopilot.js
// V18.4 · Nutrition Autopilot
// Pure planning helpers for prepared-meal inventory, next-meal selection,
// protein-gap rescue, and grocery prompts. Suggest-only; callers own writes.

import { FACTOR_MEALS, FACTOR_SCAFFOLD, factorDayPlan, getFactorDayIndex } from "./factorCutPlan";

const NUTRIENTS = ["calories", "protein", "carbs", "fats", "water"];

const n = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const NUTRITION_RESCUE_OPTIONS = Object.freeze([
  {
    id: "rescue-shake",
    category: "Pantry",
    label: "Two-scoop whey shake + banana",
    calories: 345,
    protein: 49,
    carbs: 34,
    fats: 3,
    water: 16,
    note: "Fastest protein-first option when the day is slipping.",
  },
  {
    id: "rescue-chicken-rice",
    category: "Fast casual",
    label: "Double chicken, white rice, vegetables",
    calories: 690,
    protein: 72,
    carbs: 70,
    fats: 14,
    water: 0,
    note: "Order sauces on the side so the estimate stays usable.",
  },
  {
    id: "rescue-burgers",
    category: "Drive-through",
    label: "Two plain grilled chicken sandwiches, no mayo",
    calories: 760,
    protein: 64,
    carbs: 88,
    fats: 18,
    water: 0,
    note: "A predictable fallback; verify the restaurant nutrition when available.",
  },
]);

export function readLatestNutritionAutopilotState(data = {}) {
  const keys = Object.keys(data).sort().reverse();
  for (const key of keys) {
    const state = data[key]?.nutrition?.autopilot;
    if (state && typeof state === "object") return state;
  }
  return {};
}

export function collectFactorUsage(data = {}) {
  const used = {};
  for (const entry of Object.values(data || {})) {
    const plan = entry?.nutrition?.factorPlan || {};
    for (const mealId of Object.values(plan)) {
      if (!mealId) continue;
      used[mealId] = (used[mealId] || 0) + 1;
    }
  }
  return used;
}

export function buildFactorInventory({ data = {}, adjustments = null } = {}) {
  const used = collectFactorUsage(data);
  const state = readLatestNutritionAutopilotState(data);
  const deltaMap = adjustments && typeof adjustments === "object"
    ? adjustments
    : (state.inventoryAdjustments || {});

  return Object.values(FACTOR_MEALS).map((meal) => {
    const adjustment = Math.trunc(n(deltaMap[meal.id]));
    const consumed = used[meal.id] || 0;
    const remaining = Math.max(0, meal.qty + adjustment - consumed);
    return {
      ...meal,
      initialQty: meal.qty,
      adjustment,
      consumed,
      remaining,
      urgency: !meal.freeze && remaining > 0 ? "use_first" : remaining <= 1 ? "low" : "normal",
    };
  }).sort((a, b) => {
    const urgencyRank = { use_first: 0, low: 1, normal: 2 };
    return urgencyRank[a.urgency] - urgencyRank[b.urgency] || b.protein - a.protein;
  });
}

function mealRow(meal, slot, label) {
  return {
    id: meal.id,
    slot,
    label,
    name: meal.name,
    calories: Number.isFinite(meal.calories) ? meal.calories : null,
    protein: Number.isFinite(meal.protein) ? meal.protein : null,
    verified: meal.verified !== false,
    kind: "factor",
  };
}

function scaffoldRow(meal) {
  return { ...meal, kind: "scaffold", verified: true };
}

function chooseInventoryMeal(inventory, { preferUseFirst = true } = {}) {
  const available = inventory.filter((meal) => meal.remaining > 0 && Number.isFinite(meal.calories) && Number.isFinite(meal.protein));
  if (!available.length) return null;
  const pool = preferUseFirst ? available.filter((meal) => meal.urgency === "use_first") : [];
  return (pool.length ? pool : available)
    .slice()
    .sort((a, b) => b.protein - a.protein || a.calories - b.calories)[0];
}

function macroSnapshot(nutrition = {}, goals = {}) {
  const current = Object.fromEntries(NUTRIENTS.map((key) => [key, Math.round(n(nutrition[key]))]));
  const target = Object.fromEntries(NUTRIENTS.map((key) => [key, Math.max(0, Math.round(n(goals[key])))]));
  const gaps = Object.fromEntries(NUTRIENTS.map((key) => [key, Math.max(0, target[key] - current[key])]));
  const progress = Object.fromEntries(NUTRIENTS.map((key) => [key, target[key] > 0 ? clamp(current[key] / target[key], 0, 1.5) : 0]));
  return { current, target, gaps, progress };
}

function findNextMeal(sequence, logged) {
  for (const meal of sequence) {
    if (!meal?.slot) continue;
    if (logged[meal.slot] !== meal.id) return meal;
  }
  return null;
}

function rescueRank(option, gaps) {
  const proteinCoverage = Math.min(option.protein, gaps.protein) / Math.max(1, gaps.protein);
  const calorieCoverage = Math.min(option.calories, gaps.calories) / Math.max(1, gaps.calories);
  const overshoot = gaps.calories > 0 ? Math.max(0, option.calories - gaps.calories) / Math.max(1, gaps.calories) : 1;
  return proteinCoverage * 5 + calorieCoverage * 1.5 - overshoot;
}

function groceryPrompts({ inventory, gaps }) {
  const prompts = [];
  const trays = inventory.reduce((sum, meal) => sum + meal.remaining, 0);
  if (trays <= 4) prompts.push({ id: "prepared-meals", label: "Restock prepared meals", why: `${trays} trays remain.` });
  if (gaps.protein >= 45) prompts.push({ id: "whey", label: "Whey or ready-to-drink shakes", why: "Reliable protein buffer for missed meals." });
  if (gaps.protein >= 25) prompts.push({ id: "egg-whites", label: "Egg whites or lean chicken", why: "Low-friction lean protein for breakfast or meal prep." });
  if (gaps.calories >= 500) prompts.push({ id: "carbs", label: "Rice, oats, bananas, or bagels", why: "Predictable training carbohydrates." });
  if (!prompts.length) prompts.push({ id: "none", label: "No urgent grocery gap", why: "Inventory and macro buffers are currently covered." });
  return prompts.slice(0, 4);
}

export function buildNutritionAutopilot({
  data = {},
  todayKey,
  nutrition = {},
  goals = {},
  hour = 12,
} = {}) {
  const activeIndex = getFactorDayIndex(todayKey);
  const day = activeIndex >= 0 ? factorDayPlan(activeIndex) : null;
  const inventory = buildFactorInventory({ data });
  const logged = nutrition.factorPlan || {};
  const macros = macroSnapshot(nutrition, goals);

  let factorLunch = day?.lunch || chooseInventoryMeal(inventory, { preferUseFirst: true });
  let factorDinner = day?.dinner || chooseInventoryMeal(
    inventory.filter((meal) => meal.id !== factorLunch?.id),
    { preferUseFirst: true },
  );

  // If a scheduled tray was consumed earlier than planned, choose a live replacement.
  const inventoryById = Object.fromEntries(inventory.map((meal) => [meal.id, meal]));
  if (factorLunch && (inventoryById[factorLunch.id]?.remaining ?? 0) <= 0 && logged.factorLunch !== factorLunch.id) {
    factorLunch = chooseInventoryMeal(inventory, { preferUseFirst: true });
  }
  if (factorDinner && (inventoryById[factorDinner.id]?.remaining ?? 0) <= 0 && logged.factorDinner !== factorDinner.id) {
    factorDinner = chooseInventoryMeal(inventory.filter((meal) => meal.id !== factorLunch?.id), { preferUseFirst: true });
  }

  const sequence = [
    scaffoldRow(FACTOR_SCAFFOLD[0]),
    scaffoldRow(FACTOR_SCAFFOLD[1]),
    factorLunch ? mealRow(factorLunch, "factorLunch", "Lunch · Factor") : null,
    factorDinner ? mealRow(factorDinner, "factorDinner", "Dinner · Factor") : null,
    scaffoldRow(FACTOR_SCAFFOLD[2]),
  ].filter(Boolean);

  const nextMeal = findNextMeal(sequence, logged);
  const rescueOptions = NUTRITION_RESCUE_OPTIONS
    .map((option) => ({ ...option, score: rescueRank(option, macros.gaps) }))
    .sort((a, b) => b.score - a.score)
    .map(({ score, ...option }) => option);

  const lateDay = Number(hour) >= 18;
  const rescueMode = lateDay && (macros.gaps.protein >= 40 || macros.gaps.calories >= 650);
  const onTarget = macros.gaps.protein <= 10 && macros.gaps.calories <= 150;
  const traysRemaining = inventory.reduce((sum, meal) => sum + meal.remaining, 0);
  const useFirst = inventory.filter((meal) => meal.urgency === "use_first" && meal.remaining > 0);

  let headline = "Run the prepared-meal plan";
  let summary = nextMeal ? `${nextMeal.name} is the next scheduled action.` : "All scheduled prepared meals are logged.";
  if (onTarget) {
    headline = "Fueling is closed out";
    summary = "Protein and calories are close enough. Stop optimizing the day.";
  } else if (rescueMode) {
    headline = "Use rescue mode";
    summary = `The day is late with ${macros.gaps.protein}g protein and ${macros.gaps.calories} kcal still open. Choose one predictable fallback.`;
  } else if (macros.gaps.protein >= 45) {
    headline = "Protect protein first";
    summary = `${macros.gaps.protein}g protein remains. Keep the next meal protein-forward before filling calories.`;
  }

  return {
    version: 1,
    activeIndex,
    day,
    inventory,
    traysRemaining,
    useFirst,
    sequence,
    nextMeal,
    macros,
    rescueMode,
    rescueOptions,
    groceryPrompts: groceryPrompts({ inventory, gaps: macros.gaps }),
    onTarget,
    headline,
    summary,
    confidence: activeIndex >= 0 && day?.known ? "high" : traysRemaining > 0 ? "medium" : "low",
    caveat: "Prepared-meal macros use the stored tray labels. Verify any estimated or unverified tray before logging it.",
  };
}

export function buildInventoryAdjustment(currentState = {}, mealId, delta) {
  const adjustments = { ...(currentState.inventoryAdjustments || {}) };
  adjustments[mealId] = Math.trunc(n(adjustments[mealId])) + Math.trunc(n(delta));
  if (adjustments[mealId] === 0) delete adjustments[mealId];
  return {
    ...currentState,
    inventoryAdjustments: adjustments,
    updatedAt: new Date().toISOString(),
  };
}

export default {
  collectFactorUsage,
  readLatestNutritionAutopilotState,
  buildFactorInventory,
  buildNutritionAutopilot,
  buildInventoryAdjustment,
};
