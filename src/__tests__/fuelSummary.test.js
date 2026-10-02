import { describe, expect, it } from "vitest";
import { buildFuelHero, buildFuelRecoveryInsight, buildMealPlanProgress, buildNextMealPreview } from "../fuelSummary";
import { computeStillNeeded } from "../fuelNeeds";
import { buildNutritionRecommendation } from "../nutritionCoach";
import { SLOTS, SLOT_LABELS } from "../mealPlan";

const goals = { calories: 3600, protein: 200, carbs: 400, fats: 100, water: 128 };

describe("buildFuelHero", () => {
  it("leads a protein-first day with remaining protein/calories/water and a next suggestion", () => {
    const nutrition = { calories: 1200, protein: 60, carbs: 150, fats: 40, water: 40 };
    const recommendation = buildNutritionRecommendation({ nutrition, goals });
    const hero = buildFuelHero({
      nutrition,
      goals,
      recommendation,
      stillNeeded: computeStillNeeded(nutrition, goals),
    });

    expect(hero.priority).toBe("protein");
    expect(hero.title).toBe("Protein first");
    expect(hero.onTarget).toBe(false);
    const byKey = Object.fromEntries(hero.metrics.map((m) => [m.key, m]));
    expect(byKey.protein.remaining).toBe(140);
    expect(byKey.protein.current).toBe(60);
    expect(byKey.protein.target).toBe(200);
    expect(byKey.calories.remaining).toBe(2400);
    expect(byKey.water.remaining).toBe(88);
    expect(hero.primaryActionLabel).toBe("Add protein");
    // Concise next suggestion from the top quick add.
    expect(hero.suggestion).toMatch(/^Try .+\.$/);
    expect(hero.suggestionAdd).toBeTruthy();
  });

  it("reports clear on-target copy when all targets are met", () => {
    const nutrition = { calories: 3600, protein: 200, carbs: 400, fats: 100, water: 128 };
    const recommendation = buildNutritionRecommendation({ nutrition, goals });
    const hero = buildFuelHero({
      nutrition,
      goals,
      recommendation,
      stillNeeded: computeStillNeeded(nutrition, goals),
    });

    expect(hero.onTarget).toBe(true);
    expect(hero.priority).toBe("done");
    expect(hero.metrics.every((m) => m.remaining === 0)).toBe(true);
    expect(hero.suggestion).toMatch(/no next action/i);
  });

  it("reports an empty-day state with a clear first logging action", () => {
    const nutrition = { calories: 0, protein: 0, carbs: 0, fats: 0, water: 0 };
    const recommendation = buildNutritionRecommendation({ nutrition, goals });
    const hero = buildFuelHero({ nutrition, goals, recommendation, stillNeeded: computeStillNeeded(nutrition, goals) });

    expect(hero.emptyDay).toBe(true);
    expect(hero.onTarget).toBe(false);
    expect(hero.primaryActionLabel).toMatch(/Add/);
    expect(hero.subtext).toMatch(/Nothing logged yet/i);
  });

  it("is null-defensive without a recommendation or stillNeeded", () => {
    const hero = buildFuelHero();
    expect(hero.metrics).toHaveLength(3);
    expect(JSON.stringify(hero)).not.toMatch(/NaN/);
    // Empty intake vs empty goals → nothing remaining, treated as on target.
    expect(hero.onTarget).toBe(true);
  });
});

describe("buildFuelRecoveryInsight", () => {
  it("warns about under-fueling when calories/protein are far behind", () => {
    const nutrition = { calories: 800, protein: 40, carbs: 90, fats: 25, water: 90 };
    const insight = buildFuelRecoveryInsight({ nutrition, goals });
    expect(insight.tone).toBe("caution");
    expect(insight.body).toMatch(/recovery read harder to trust/i);
    expect(insight.connected).toBe(false);
  });

  it("flags a hydration gap when only water is far behind", () => {
    const nutrition = { calories: 3400, protein: 195, carbs: 380, fats: 95, water: 30 };
    const insight = buildFuelRecoveryInsight({ nutrition, goals });
    expect(insight.tone).toBe("caution");
    expect(insight.body).toMatch(/hydration gap/i);
  });

  it("says fuel is unlikely to be the limiter when on target", () => {
    const nutrition = { calories: 3600, protein: 200, carbs: 400, fats: 100, water: 128 };
    const insight = buildFuelRecoveryInsight({ nutrition, goals });
    expect(insight.tone).toBe("good");
    expect(insight.body).toMatch(/unlikely to be the limiter/i);
  });

  it("tightens copy when a poor recovery context is provided (display only)", () => {
    const nutrition = { calories: 800, protein: 40, carbs: 90, fats: 25, water: 90 };
    const insight = buildFuelRecoveryInsight({ nutrition, goals, recoveryContext: { tone: "warning" } });
    expect(insight.tone).toBe("caution");
    expect(insight.body).toMatch(/reading soft/i);
    expect(insight.connected).toBe(true);
  });
});

describe("buildMealPlanProgress", () => {
  it("counts logged meals against the plan slots", () => {
    const checkedMeals = { breakfast: "b01", lunch: "l01" };
    const progress = buildMealPlanProgress({ checkedMeals, slots: SLOTS });
    expect(progress.logged).toBe(2);
    expect(progress.total).toBe(5);
    expect(progress.label).toBe("2/5 meals logged");
    expect(progress.allLogged).toBe(false);
  });

  it("marks allLogged when every slot is checked", () => {
    const checkedMeals = { breakfast: "b01", lunch: "l01", snack1: "s01", dinner: "d01", snack2: "s02" };
    const progress = buildMealPlanProgress({ checkedMeals, slots: SLOTS });
    expect(progress.allLogged).toBe(true);
    expect(progress.label).toBe("5/5 meals logged");
  });

  it("handles empty/missing inputs safely", () => {
    const progress = buildMealPlanProgress();
    expect(progress.logged).toBe(0);
    expect(progress.total).toBe(0);
    expect(progress.allLogged).toBe(false);
  });
});

describe("buildNextMealPreview", () => {
  const meals = {
    breakfast: { name: "Oats + whey", macros: { calories: 500, protein: 40 }, prepMins: 5, cookMins: 3 },
    lunch: { name: "Chicken bowl", macros: { calories: 700, protein: 55 }, prepMins: 10, cookMins: 15 },
    snack1: { name: "Greek yogurt", macros: { calories: 250, protein: 22 }, prepMins: 1, cookMins: 0 },
    dinner: { name: "Salmon + rice", macros: { calories: 800, protein: 50 }, prepMins: 10, cookMins: 20 },
    snack2: { name: "Casein shake", macros: { calories: 300, protein: 35 }, prepMins: 2, cookMins: 0 },
  };

  it("returns the first unlogged meal as the next preview", () => {
    const preview = buildNextMealPreview({ meals, checkedMeals: { breakfast: "b01" }, slots: SLOTS, slotLabels: SLOT_LABELS });
    expect(preview.available).toBe(true);
    expect(preview.slot).toBe("lunch");
    expect(preview.name).toBe("Chicken bowl");
    expect(preview.calories).toBe(700);
    expect(preview.protein).toBe(55);
    expect(preview.totalMins).toBe(25);
    expect(preview.loggedCount).toBe(1);
    expect(preview.remaining).toBe(4);
  });

  it("reports allLogged with no next meal once every slot is checked", () => {
    const checkedMeals = { breakfast: "b", lunch: "l", snack1: "s", dinner: "d", snack2: "s2" };
    const preview = buildNextMealPreview({ meals, checkedMeals, slots: SLOTS, slotLabels: SLOT_LABELS });
    expect(preview.available).toBe(false);
    expect(preview.allLogged).toBe(true);
    expect(preview.slot).toBe(null);
    expect(preview.remaining).toBe(0);
  });

  it("is null-defensive with no inputs", () => {
    const preview = buildNextMealPreview();
    expect(preview.available).toBe(false);
    expect(preview.total).toBe(0);
    expect(JSON.stringify(preview)).not.toMatch(/NaN/);
  });
});
