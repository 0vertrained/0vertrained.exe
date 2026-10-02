import { describe, expect, it } from "vitest";
import { RECIPES, DIETARY_TAGS, SLOTS, generateMealPlans } from "../mealPlan";

// Recipe slots (snack1/snack2 both map to the "snack" recipe slot).
const RECIPE_SLOTS = ["breakfast", "lunch", "dinner", "snack"];
const VALID_TAGS = new Set(DIETARY_TAGS.map((t) => t.key));

// Generous per-slot plausibility bounds for high-protein athlete meals. These
// are intentionally wider than the documented target ranges — they only fail on
// clearly-broken macros (empty/negative/absurd), not on reasonable variety.
const PLAUSIBLE = {
  breakfast: { cal: [500, 1000], pro: [30, 95] },
  lunch: { cal: [550, 1050], pro: [40, 85] },
  dinner: { cal: [550, 1050], pro: [35, 85] },
  snack: { cal: [220, 580], pro: [12, 55] },
};

// Documented target ranges from mealPlan.js — most recipes should land here.
const TARGET = {
  breakfast: { cal: [600, 900], pro: [40, 60] },
  lunch: { cal: [700, 950], pro: [50, 70] },
  dinner: { cal: [700, 950], pro: [50, 70] },
  snack: { cal: [280, 420], pro: [20, 35] },
};

// Ingredient-name markers that contradict a "free-from" tag. Used to catch
// mis-tagged recipes (e.g. a nut-free recipe that contains almond milk).
const CONFLICT_MARKERS = {
  "gluten-free": [/pasta/i, /bread/i, /tortilla/i, /wrap/i, /pita/i, /bagel/i, /couscous/i, /cracker/i, /breadcrumb/i, /waffle mix/i, /\bwheat\b/i, /noodle/i],
  "dairy-free": [/whey/i, /casein/i, /yogurt/i, /cheese/i, /\bbutter\b/i, /\bmilk\b/i, /\bcream\b/i, /feta/i, /parmesan/i, /mozzarella/i],
  "nut-free": [/almond/i, /peanut/i, /cashew/i, /walnut/i, /pecan/i, /pistachio/i, /hazelnut/i, /pine nut/i, /pesto/i],
  "egg-free": [/\begg/i, /mayo/i],
  "soy-free": [/tofu/i, /tempeh/i, /edamame/i, /tamari/i, /\bmiso\b/i, /soybean/i, /\bsoy /i],
};
// Allowed exceptions — ingredients that match a marker but do not carry the allergen.
const ALLOW = {
  "gluten-free": [/rice noodle/i, /rice cake/i, /corn tortilla/i],
  "dairy-free": [/coconut milk/i, /coconut cream/i, /peanut butter/i, /almond butter/i],
  "nut-free": [/coconut/i, /nutmeg/i],
};

const bySlot = (slot) => RECIPES.filter((r) => r.slot === slot);
const inRange = (v, [lo, hi]) => v >= lo && v <= hi;

const GOALS = { calories: 3600, protein: 200, carbs: 400, fats: 100 };

describe("recipe library shape", () => {
  it("has at least 90 recipes for meal variety", () => {
    expect(RECIPES.length).toBeGreaterThanOrEqual(90);
  });

  it("has at least 20 recipes in every recipe slot", () => {
    for (const slot of RECIPE_SLOTS) {
      expect(bySlot(slot).length).toBeGreaterThanOrEqual(20);
    }
  });

  it("uses only the known recipe slots", () => {
    for (const r of RECIPES) {
      expect(RECIPE_SLOTS).toContain(r.slot);
    }
  });

  it("has unique, stable, non-empty ids", () => {
    const ids = RECIPES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);
    }
  });

  it("gives every recipe a name and at least one step and ingredient", () => {
    for (const r of RECIPES) {
      expect(r.name.trim().length).toBeGreaterThan(0);
      expect(r.ingredients.length).toBeGreaterThan(0);
      expect(r.steps.length).toBeGreaterThan(0);
      expect(Number.isFinite(r.prepMins)).toBe(true);
      expect(Number.isFinite(r.cookMins)).toBe(true);
    }
  });
});

describe("dietary tags", () => {
  it("only uses tags from the DIETARY_TAGS vocabulary, without duplicates", () => {
    for (const r of RECIPES) {
      expect(Array.isArray(r.tags)).toBe(true);
      expect(new Set(r.tags).size).toBe(r.tags.length);
      for (const tag of r.tags) {
        expect(VALID_TAGS.has(tag)).toBe(true);
      }
    }
  });

  it("never claims a free-from tag that its ingredients contradict", () => {
    const conflicts = [];
    for (const r of RECIPES) {
      for (const tag of r.tags) {
        const markers = CONFLICT_MARKERS[tag] || [];
        const allow = ALLOW[tag] || [];
        for (const ing of r.ingredients) {
          if (markers.some((m) => m.test(ing.name)) && !allow.some((a) => a.test(ing.name))) {
            conflicts.push(`${r.id} [${tag}] ← ${ing.name}`);
          }
        }
      }
    }
    expect(conflicts).toEqual([]);
  });
});

describe("recipe macros", () => {
  it("are finite, non-negative, and derived from ingredient sums", () => {
    for (const r of RECIPES) {
      for (const key of ["calories", "protein", "carbs", "fats"]) {
        expect(Number.isFinite(r.macros[key])).toBe(true);
        expect(r.macros[key]).toBeGreaterThanOrEqual(0);
      }
      const summed = r.ingredients.reduce((a, i) => a + i.calories, 0);
      // Recipe totals should track the ingredient calorie sum (rounding aside).
      expect(Math.abs(r.macros.calories - summed)).toBeLessThanOrEqual(RECIPES.length);
    }
  });

  it("are plausible for a high-protein athlete in every slot", () => {
    for (const r of RECIPES) {
      const bounds = PLAUSIBLE[r.slot];
      expect(inRange(r.macros.calories, bounds.cal), `${r.id} calories ${r.macros.calories}`).toBe(true);
      expect(inRange(r.macros.protein, bounds.pro), `${r.id} protein ${r.macros.protein}`).toBe(true);
    }
  });

  it("mostly land within the documented target ranges per slot", () => {
    for (const slot of RECIPE_SLOTS) {
      const list = bySlot(slot);
      const t = TARGET[slot];
      const calIn = list.filter((r) => inRange(r.macros.calories, t.cal)).length;
      const proIn = list.filter((r) => inRange(r.macros.protein, t.pro)).length;
      expect(calIn / list.length).toBeGreaterThanOrEqual(0.6);
      expect(proIn / list.length).toBeGreaterThanOrEqual(0.55);
    }
  });
});

describe("meal plan generation", () => {
  const restrictionSets = [
    [],
    ["gluten-free"],
    ["dairy-free"],
    ["nut-free"],
    ["egg-free"],
    ["soy-free"],
    ["gluten-free", "dairy-free"],
    ["gluten-free", "dairy-free", "nut-free", "egg-free", "soy-free"],
  ];

  for (const rs of restrictionSets) {
    const label = rs.length ? rs.join("+") : "no restrictions";
    it(`returns complete 5-slot plans for ${label}`, () => {
      const plans = generateMealPlans(GOALS, rs, 3, 42);
      expect(plans.length).toBeGreaterThan(0);
      for (const plan of plans) {
        // Every UI slot is filled with a real recipe.
        for (const slot of SLOTS) {
          expect(plan.meals[slot]).toBeTruthy();
          expect(typeof plan.meals[slot].id).toBe("string");
        }
        // The two snack slots never repeat the same recipe.
        expect(plan.meals.snack1.id).not.toBe(plan.meals.snack2.id);
        // Every chosen recipe honors all active restrictions.
        for (const slot of SLOTS) {
          for (const tag of rs) {
            expect(plan.meals[slot].tags).toContain(tag);
          }
        }
        // Day macros are finite.
        for (const key of ["calories", "protein", "carbs", "fats"]) {
          expect(Number.isFinite(plan.macros[key])).toBe(true);
        }
      }
    });
  }

  it("varies plans across seeds (regeneration produces variety)", () => {
    const key = (p) => SLOTS.map((s) => p.meals[s].id).join("|");
    const a = generateMealPlans(GOALS, [], 1, 1)[0];
    const b = generateMealPlans(GOALS, [], 1, 999)[0];
    expect(a && b).toBeTruthy();
    // Different seeds should not always yield the identical top plan.
    expect(key(a)).not.toBe(key(b));
  });
});
