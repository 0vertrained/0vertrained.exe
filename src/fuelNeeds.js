// src/fuelNeeds.js
// Pure helper for the Fuel → Log "Still Needed Today" summary.
// No React, no network, no writes — just safe arithmetic over today's nutrition.

const num = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

// Remaining toward a goal: never negative, rounded to a whole unit.
const remaining = (current, goal) => Math.max(0, Math.round(num(goal) - num(current)));

// Compute what's still needed today across macros + water.
// Safe against missing/garbage values and zero-floors every field.
export function computeStillNeeded(nutrition = {}, goals = {}) {
  const needs = {
    calories: remaining(nutrition.calories, goals.calories),
    protein: remaining(nutrition.protein, goals.protein),
    carbs: remaining(nutrition.carbs, goals.carbs),
    fats: remaining(nutrition.fats, goals.fats),
    water: remaining(nutrition.water, goals.water),
  };
  needs.allMet =
    needs.calories === 0 &&
    needs.protein === 0 &&
    needs.carbs === 0 &&
    needs.fats === 0 &&
    needs.water === 0;
  return needs;
}

// Build the compact display parts, e.g. ["+220 kcal", "+15g protein", "+28 oz water"].
// Only non-zero fields are included so the line stays short.
export function formatStillNeeded(needs = {}) {
  const parts = [];
  if (needs.calories > 0) parts.push(`+${needs.calories} kcal`);
  if (needs.protein > 0) parts.push(`+${needs.protein}g protein`);
  if (needs.carbs > 0) parts.push(`+${needs.carbs}g carbs`);
  if (needs.fats > 0) parts.push(`+${needs.fats}g fats`);
  if (needs.water > 0) parts.push(`+${needs.water} oz water`);
  return parts;
}

export default { computeStillNeeded, formatStillNeeded };
