// src/foodLog.js
// The day's food log. Each food logged is kept on the day as an item in
// nutrition.meals, with its macros for one serving and how many servings
// were eaten, so it can be seen, changed and taken off later. The day's
// totals (nutrition.calories, .protein, .carbs, .fats) stay what every other
// screen reads: adding, changing or removing an item moves them by exactly
// that item's share. Totals typed in by hand are left alone, so a day can
// hold more than its items add up to.
//
// Recent foods come from the last few weeks of logs; saved foods and meals
// live in settings.savedFoods.

export const MACRO_KEYS = ["calories", "protein", "carbs", "fats"];
export const SERVING_STEP = 0.5;
export const MAX_SERVINGS = 10;
export const SAVED_FOODS_MAX = 40;
const RECENT_DAYS = 21;
const RECENT_LIMIT = 8;

const num = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const nonNegative = (value) => Math.max(0, num(value));
const round1 = (value) => Math.round(value * 10) / 10;

let counter = 0;
function newId(at) {
  counter = (counter + 1) % 1296;
  const time = Date.parse(at);
  const stamp = (Number.isFinite(time) ? time : Date.now()).toString(36);
  return `f-${stamp}-${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Servings kept between half a serving and ten, in half steps. */
export function clampServings(value) {
  const stepped = Math.round(num(value) / SERVING_STEP) * SERVING_STEP;
  return Math.min(MAX_SERVINGS, Math.max(SERVING_STEP, stepped || 1));
}

// A food's name and serving, the way two logs of the same food match.
export function foodKey(food) {
  return `${String(food?.name || "").trim().toLowerCase()}|${String(food?.serving || "").trim().toLowerCase()}`;
}

/**
 * A food as an item for the day: macros for one serving, how many servings,
 * when it was logged and where it came from. Null without a name or with
 * nothing to count.
 */
export function makeFoodItem(food, { qty = food?.qty ?? 1, at = new Date().toISOString(), source = food?.source || "search", slot = null, planId = null, id = null } = {}) {
  const name = String(food?.name || "").trim();
  if (!name) return null;
  const macros = {
    calories: Math.round(nonNegative(food.calories)),
    protein: round1(nonNegative(food.protein)),
    carbs: round1(nonNegative(food.carbs)),
    fats: round1(nonNegative(food.fats ?? food.fat)),
  };
  if (!MACRO_KEYS.some((key) => macros[key] > 0)) return null;
  const item = {
    id: id || newId(at),
    name: name.slice(0, 120),
    serving: food.serving ? String(food.serving).slice(0, 40) : null,
    qty: clampServings(qty),
    ...macros,
    at,
    source,
  };
  if (slot) item.slot = slot;
  if (planId) item.planId = planId;
  if (Array.isArray(food.parts) && food.parts.length) item.parts = food.parts.slice(0, 12).map(String);
  return item;
}

/** What an item adds to the day: its macros times its servings. */
export function itemTotals(item) {
  const qty = num(item?.qty) || 1;
  return {
    calories: Math.round(nonNegative(item?.calories) * qty),
    protein: round1(nonNegative(item?.protein) * qty),
    carbs: round1(nonNegative(item?.carbs) * qty),
    fats: round1(nonNegative(item?.fats) * qty),
  };
}

/** The day's logged foods, oldest first. */
export function dayFoods(nutrition) {
  const items = Array.isArray(nutrition?.meals) ? nutrition.meals : [];
  return items
    .filter((item) => item && typeof item === "object" && item.id && item.name)
    .sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
}

// Totals moved by `sign` times an item's share, never below zero, kept as
// the whole-number strings the rest of the app writes.
function moveTotals(nutrition, totals, sign) {
  const next = { ...nutrition };
  for (const key of MACRO_KEYS) {
    if (!totals[key]) continue;
    next[key] = String(Math.max(0, Math.round(num(nutrition?.[key]) + sign * totals[key])));
  }
  return next;
}

/** The day's nutrition with an item added and its share on the totals. */
export function addFoodToDay(nutrition = {}, item) {
  if (!item) return nutrition;
  const items = Array.isArray(nutrition.meals) ? nutrition.meals : [];
  const next = moveTotals(nutrition, itemTotals(item), 1);
  next.meals = [...items, item];
  if (item.source === "plan" && item.slot) next.plannedMeals = { ...(nutrition.plannedMeals || {}), [item.slot]: item.planId || true };
  return next;
}

/**
 * The day's nutrition with an item taken off, its share off the totals. A
 * meal from the meal plan is marked as not eaten again.
 */
export function removeFoodFromDay(nutrition = {}, id) {
  const items = Array.isArray(nutrition.meals) ? nutrition.meals : [];
  const item = items.find((entry) => entry?.id === id);
  if (!item) return nutrition;
  const next = moveTotals(nutrition, itemTotals(item), -1);
  next.meals = items.filter((entry) => entry?.id !== id);
  if (item.source === "plan" && item.slot) next.plannedMeals = { ...(nutrition.plannedMeals || {}), [item.slot]: null };
  return next;
}

/** The day's nutrition with an item's servings changed, totals moved by the difference. */
export function setFoodServings(nutrition = {}, id, qty) {
  const items = Array.isArray(nutrition.meals) ? nutrition.meals : [];
  const item = items.find((entry) => entry?.id === id);
  if (!item) return nutrition;
  const changed = { ...item, qty: clampServings(qty) };
  const before = itemTotals(item);
  const after = itemTotals(changed);
  const delta = Object.fromEntries(MACRO_KEYS.map((key) => [key, after[key] - before[key]]));
  const next = moveTotals(nutrition, delta, 1);
  next.meals = items.map((entry) => (entry?.id === id ? changed : entry));
  return next;
}

/** What the day's items add up to. */
export function foodsTotal(items) {
  const total = { calories: 0, protein: 0, carbs: 0, fats: 0 };
  for (const item of items || []) {
    const share = itemTotals(item);
    for (const key of MACRO_KEYS) total[key] += share[key];
  }
  return { calories: Math.round(total.calories), protein: Math.round(total.protein), carbs: Math.round(total.carbs), fats: Math.round(total.fats) };
}

/**
 * What the day's totals hold beyond its items: amounts typed in by hand, or
 * logged before foods were kept. Null when there's nothing extra.
 */
export function untrackedTotals(nutrition) {
  const counted = foodsTotal(dayFoods(nutrition));
  const extra = {
    calories: Math.round(num(nutrition?.calories) - counted.calories),
    protein: Math.round(num(nutrition?.protein) - counted.protein),
  };
  return extra.calories > 0 || extra.protein > 0 ? { calories: Math.max(0, extra.calories), protein: Math.max(0, extra.protein) } : null;
}

// The day before a "YYYY-MM-DD" key.
function previousKey(dateKey) {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * Foods logged over the last three weeks, newest first, each once, with the
 * servings last eaten. Meals from the meal plan are left out: the plan
 * offers those itself.
 */
export function recentFoods(entries = {}, { todayKey, days = RECENT_DAYS, limit = RECENT_LIMIT, exclude = [] } = {}) {
  const seen = new Set(exclude.map(foodKey));
  const found = [];
  let key = todayKey;
  for (let index = 0; index < days && key && found.length < limit; index += 1) {
    const items = dayFoods(entries?.[key]?.nutrition).reverse();
    for (const item of items) {
      if (item.source === "plan") continue;
      const id = foodKey(item);
      if (seen.has(id)) continue;
      seen.add(id);
      const { id: _id, at: _at, slot: _slot, planId: _planId, ...food } = item;
      void _id; void _at; void _slot; void _planId;
      found.push(food);
      if (found.length >= limit) break;
    }
    key = previousKey(key);
  }
  return found;
}

/** Saved foods and meals from settings, the ones still usable. */
export function savedFoods(settings) {
  const list = Array.isArray(settings?.savedFoods) ? settings.savedFoods : [];
  return list.filter((food) => food && food.name && MACRO_KEYS.some((key) => num(food[key]) > 0));
}

export function isSavedFood(saved, food) {
  const key = foodKey(food);
  return (saved || []).some((entry) => foodKey(entry) === key);
}

// A saved food keeps what a log needs and nothing about the day it came from.
function savedShape(food) {
  const shaped = {
    name: String(food.name).trim().slice(0, 120),
    serving: food.serving || null,
    calories: Math.round(nonNegative(food.calories)),
    protein: round1(nonNegative(food.protein)),
    carbs: round1(nonNegative(food.carbs)),
    fats: round1(nonNegative(food.fats)),
    qty: clampServings(food.qty ?? 1),
  };
  if (Array.isArray(food.parts) && food.parts.length) shaped.parts = food.parts.slice(0, 12).map(String);
  return shaped;
}

/** The saved list with a food added at the top, or taken off when it was saved. */
export function toggleSavedFood(saved, food) {
  const list = Array.isArray(saved) ? saved : [];
  const key = foodKey(food);
  if (list.some((entry) => foodKey(entry) === key)) return list.filter((entry) => foodKey(entry) !== key);
  return [savedShape(food), ...list].slice(0, SAVED_FOODS_MAX);
}

/**
 * Several logged foods as one saved meal: their macros as eaten, under one
 * name, one serving. Null without a name or foods.
 */
export function mealFromFoods(items, name) {
  const title = String(name || "").trim();
  if (!title || !items?.length) return null;
  const total = { calories: 0, protein: 0, carbs: 0, fats: 0 };
  for (const item of items) {
    const share = itemTotals(item);
    for (const key of MACRO_KEYS) total[key] += share[key];
  }
  return savedShape({
    name: title,
    serving: null,
    calories: total.calories,
    protein: total.protein,
    carbs: total.carbs,
    fats: total.fats,
    qty: 1,
    parts: items.map((item) => (num(item.qty) === 1 ? item.name : `${item.name} × ${num(item.qty)}`)),
  });
}

/** "1.5 servings" style, or "" for one. */
export function servingsLabel(qty) {
  const value = num(qty) || 1;
  if (value === 1) return "";
  return `${value}\u00a0servings`;
}
