import { describe, expect, it } from "vitest";
import {
  RECIPES,
  SLOTS,
  generateMealPlans,
  planMacros,
  swapCandidates,
  replaceMealInPlan,
} from "../mealPlan";

const GOALS = { calories: 3600, protein: 200, carbs: 400, fats: 100 };

// A concrete plan to swap against (deterministic seed).
const basePlan = () => generateMealPlans(GOALS, [], 3, 7)[0];

describe("swapCandidates — filtering & sorting", () => {
  it("returns only recipes of the slot's recipe type", () => {
    const plan = basePlan();
    const map = { breakfast: "breakfast", lunch: "lunch", snack1: "snack", dinner: "dinner", snack2: "snack" };
    for (const slot of SLOTS) {
      const cands = swapCandidates(GOALS, [], slot, plan);
      expect(cands.length).toBeGreaterThan(0);
      for (const c of cands) expect(c.slot).toBe(map[slot]);
    }
  });

  it("ranks candidates by macro fit (non-decreasing score)", () => {
    const plan = basePlan();
    const cands = swapCandidates(GOALS, [], "dinner", plan);
    for (let k = 1; k < cands.length; k++) {
      expect(cands[k]._score).toBeGreaterThanOrEqual(cands[k - 1]._score);
    }
  });

  it("excludes the recipe currently in that slot", () => {
    const plan = basePlan();
    for (const slot of SLOTS) {
      const currentId = plan.meals[slot].id;
      const cands = swapCandidates(GOALS, [], slot, plan);
      expect(cands.some(c => c.id === currentId)).toBe(false);
    }
  });

  it("never offers a snack already used in the other snack slot (no duplicate snack)", () => {
    const plan = basePlan();
    const s1 = plan.meals.snack1.id;
    const s2 = plan.meals.snack2.id;
    expect(swapCandidates(GOALS, [], "snack1", plan).some(c => c.id === s2)).toBe(false);
    expect(swapCandidates(GOALS, [], "snack2", plan).some(c => c.id === s1)).toBe(false);
  });

  it("honors dietary restrictions", () => {
    const restrictions = ["gluten-free", "dairy-free"];
    const plans = generateMealPlans(GOALS, restrictions, 1, 3);
    const plan = plans[0];
    for (const slot of SLOTS) {
      for (const c of swapCandidates(GOALS, restrictions, slot, plan)) {
        for (const tag of restrictions) expect(c.tags).toContain(tag);
      }
    }
  });

  it("respects the optional limit", () => {
    const plan = basePlan();
    const limited = swapCandidates(GOALS, [], "lunch", plan, 4);
    expect(limited.length).toBeLessThanOrEqual(4);
    // The limited list is the prefix of the full ranked list.
    const full = swapCandidates(GOALS, [], "lunch", plan);
    expect(limited.map(c => c.id)).toEqual(full.slice(0, 4).map(c => c.id));
  });

  it("returns [] for a bad slot or missing goals", () => {
    expect(swapCandidates(GOALS, [], "nope", basePlan())).toEqual([]);
    expect(swapCandidates(null, [], "dinner", basePlan())).toEqual([]);
  });
});

describe("replaceMealInPlan — single-slot replacement", () => {
  it("replaces only the target slot and preserves the others", () => {
    const plan = basePlan();
    const target = "lunch";
    const alt = swapCandidates(GOALS, [], target, plan)[0];
    const next = replaceMealInPlan(plan, target, alt, GOALS);

    expect(next.meals[target].id).toBe(alt.id);
    for (const slot of SLOTS) {
      if (slot === target) continue;
      expect(next.meals[slot].id).toBe(plan.meals[slot].id);
    }
  });

  it("recomputes day macros from the new set of meals", () => {
    const plan = basePlan();
    const alt = swapCandidates(GOALS, [], "breakfast", plan)[0];
    const next = replaceMealInPlan(plan, "breakfast", alt, GOALS);
    expect(next.macros).toEqual(planMacros(next));
  });

  it("does not mutate the input plan (immutable)", () => {
    const plan = basePlan();
    const originalId = plan.meals.dinner.id;
    const originalMacros = { ...plan.macros };
    const alt = swapCandidates(GOALS, [], "dinner", plan)[0];
    const next = replaceMealInPlan(plan, "dinner", alt, GOALS);

    expect(plan.meals.dinner.id).toBe(originalId);
    expect(plan.macros).toEqual(originalMacros);
    expect(next).not.toBe(plan);
    expect(next.meals).not.toBe(plan.meals);
  });

  it("returns the plan unchanged for an unknown slot or missing recipe", () => {
    const plan = basePlan();
    expect(replaceMealInPlan(plan, "brunch", RECIPES[0], GOALS)).toBe(plan);
    expect(replaceMealInPlan(plan, "dinner", null, GOALS)).toBe(plan);
  });
});
