// src/fuelSummary.js
// ─────────────────────────────────────────────────────────────────────────────
// Fuel presentation helpers (V2.4D — "Daily nutrition execution")
//
// Pure, side-effect-free display summarizers. These do NOT recompute nutrition
// targets, re-derive macros, or change any algorithm. They only reshape values
// that fuelNeeds/nutritionCoach have *already* produced into an execution-first
// hierarchy: a "still needed" hero, a display-only Fuel ↔ Recovery insight, and
// a meal-plan progress count. Everything is defensive against null so a partial/
// loading state never throws.
//
// Coaching-safe language only. No medical diagnosis, no rigid diet prescriptions.
// The macro ledger and meal-plan recipe details are rendered elsewhere and are
// intentionally NOT hidden by these summaries.
// ─────────────────────────────────────────────────────────────────────────────

import { computeStillNeeded } from "./fuelNeeds";

const num = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

// Progress toward a goal as a 0..(1+) ratio; 0 when the goal is unknown.
const ratio = (current, goal) => {
  const g = num(goal);
  if (g <= 0) return 0;
  return num(current) / g;
};

/**
 * Still Needed Hero model. Leads Fuel with "what should I eat/drink next?"
 * rather than the raw ledger. Reuses the already-computed `stillNeeded`
 * (computeStillNeeded) and `recommendation` (buildNutritionRecommendation);
 * it does not re-score anything.
 *
 * Returns:
 *   { title, priority, onTarget, metrics[], suggestion, suggestionAdd, subtext }
 *   metrics: [{ key, label, remaining, unit }] for protein, calories, water.
 */
export function buildFuelHero({ nutrition = {}, goals = {}, recommendation = null, stillNeeded = null } = {}) {
  const needs = stillNeeded || computeStillNeeded(nutrition, goals);
  const onTarget = !!needs.allMet;

  const title = recommendation?.title || (onTarget ? "Fueling on target" : "Keep fueling");
  const priority = recommendation?.priority || (onTarget ? "done" : "calories");

  const current = {
    protein: num(nutrition.protein),
    calories: num(nutrition.calories),
    water: num(nutrition.water),
  };
  const target = {
    protein: num(goals.protein),
    calories: num(goals.calories),
    water: num(goals.water),
  };
  const emptyDay = current.protein === 0 && current.calories === 0 && current.water === 0;

  // Remaining values for protein, calories, water at minimum (plan requirement).
  const metrics = [
    { key: "protein", label: "Protein", current: current.protein, target: target.protein, remaining: num(needs.protein), unit: "g" },
    { key: "calories", label: "Calories", current: current.calories, target: target.calories, remaining: num(needs.calories), unit: "kcal" },
    { key: "water", label: "Water", current: current.water, target: target.water, remaining: num(needs.water), unit: "oz" },
  ];

  // Concise next suggestion from the top-scored quick add, e.g. "Try Chicken + rice bowl."
  const quickAdds = Array.isArray(recommendation?.quickAdds) ? recommendation.quickAdds : [];
  const topAdd = quickAdds[0] || null;
  const primaryActionLabel = onTarget
    ? "Review plan"
    : priority === "water"
      ? "Add water"
      : priority === "protein"
        ? "Add protein"
        : "Add fuel";
  const suggestion = onTarget
    ? "Targets met — no next action needed."
    : topAdd ? `Try ${topAdd.label}.` : null;

  const subtext = onTarget
    ? "Macros and hydration are on target. Stop optimizing and go live your life."
    : emptyDay
      ? "Nothing logged yet. Start with one protein-forward meal or water, then reassess."
      : recommendation?.summary || "Close your biggest gap first, then reassess.";

  return { title, priority, onTarget, emptyDay, metrics, suggestion, suggestionAdd: topAdd, primaryActionLabel, subtext };
}

/**
 * Display-only Fuel ↔ Recovery insight. When no recovery context is passed
 * (the common case in Fuel today), it is derived purely from current fuel
 * gaps. Coaching copy, never a medical/nutrition diagnosis.
 *
 * Returns { tone, body, connected } where tone ∈ good|caution|neutral.
 */
export function buildFuelRecoveryInsight({ nutrition = {}, goals = {}, recoveryContext = null, stillNeeded = null } = {}) {
  const needs = stillNeeded || computeStillNeeded(nutrition, goals);

  const proteinPct = ratio(nutrition.protein, goals.protein);
  const caloriePct = ratio(nutrition.calories, goals.calories);
  const waterPct = ratio(nutrition.water, goals.water);

  const underProtein = num(needs.protein) > 0 && proteinPct < 0.6;
  const underCalories = num(needs.calories) > 0 && caloriePct < 0.6;
  const underHydrated = num(needs.water) > 0 && waterPct < 0.6;

  // Optional recovery context tightens the copy but is never required. Display
  // only — we do not plumb or recompute recovery here.
  const poorRecovery = recoveryContext?.tone === "warning" || recoveryContext?.tone === "caution";

  if (underProtein || underCalories) {
    const lead = num(needs.protein) >= num(needs.calories) / 12 && underProtein
      ? "Close protein first, then calories."
      : "Close your calorie gap, protein first.";
    const body = poorRecovery
      ? `Recovery is already reading soft and you're under-fueling — that combination makes tomorrow's readiness harder to trust. ${lead}`
      : `Under-fueling today can make tomorrow's recovery read harder to trust. ${lead}`;
    return { tone: "caution", body, connected: !!recoveryContext };
  }

  if (underHydrated) {
    return {
      tone: "caution",
      body: "A hydration gap can show up as higher perceived strain tomorrow. Topping up water now helps.",
      connected: !!recoveryContext,
    };
  }

  if (needs.allMet) {
    return {
      tone: "good",
      body: "Fuel is on target — unlikely to be the limiter on tomorrow's recovery.",
      connected: !!recoveryContext,
    };
  }

  return {
    tone: "neutral",
    body: "You're close on fuel. Minor gaps are unlikely to move tomorrow's recovery much.",
    connected: !!recoveryContext,
  };
}

/**
 * Compact meal-plan progress, e.g. "2/5 meals logged". Pure count over the
 * already-persisted `checkedMeals` map (nutrition.plannedMeals) and the plan's
 * slots. Does not read or change recipe generation.
 *
 * Returns { logged, total, label, allLogged }.
 */
export function buildMealPlanProgress({ checkedMeals = {}, slots = [] } = {}) {
  const slotList = Array.isArray(slots) ? slots : [];
  const total = slotList.length;
  const map = checkedMeals || {};
  const logged = slotList.reduce((count, slot) => (map[slot] ? count + 1 : count), 0);
  return {
    logged,
    total,
    label: `${logged}/${total} meals logged`,
    allLogged: total > 0 && logged === total,
  };
}

/**
 * Next-meal preview model (V2.6 — Visual compression). Reshapes the already
 * generated plan into a single "what's next" card so Fuel can show one compact
 * meal by default instead of all five rows. Pure display: it never generates
 * recipes, changes macros, or writes anything. The full five-meal plan (with
 * recipes and alternates) is still rendered on demand elsewhere.
 *
 * Picks the first slot (in the plan's own slot order) that has not been logged
 * yet. When every slot is logged it reports allLogged with no next meal.
 *
 * Returns:
 *   { available, allLogged, slot, slotLabel, name, calories, protein,
 *     totalMins, loggedCount, total, remaining }
 */
export function buildNextMealPreview({ meals = {}, checkedMeals = {}, slots = [], slotLabels = {} } = {}) {
  const slotList = Array.isArray(slots) ? slots : [];
  const mealMap = meals || {};
  const checked = checkedMeals || {};
  const total = slotList.length;
  const loggedCount = slotList.reduce((count, slot) => (checked[slot] ? count + 1 : count), 0);
  const allLogged = total > 0 && loggedCount === total;

  const nextSlot = slotList.find((slot) => !checked[slot] && mealMap[slot]) || null;
  if (!nextSlot) {
    return {
      available: false,
      allLogged,
      slot: null,
      slotLabel: null,
      name: null,
      calories: 0,
      protein: 0,
      totalMins: 0,
      loggedCount,
      total,
      remaining: Math.max(0, total - loggedCount),
    };
  }

  const recipe = mealMap[nextSlot] || {};
  const macros = recipe.macros || {};
  const prep = num(recipe.prepMins);
  const cook = num(recipe.cookMins);
  return {
    available: true,
    allLogged: false,
    slot: nextSlot,
    slotLabel: slotLabels[nextSlot] || nextSlot,
    name: recipe.name || "Next meal",
    calories: num(macros.calories),
    protein: num(macros.protein),
    totalMins: prep + cook,
    loggedCount,
    total,
    remaining: Math.max(0, total - loggedCount),
  };
}

export default { buildFuelHero, buildFuelRecoveryInsight, buildMealPlanProgress, buildNextMealPreview };
