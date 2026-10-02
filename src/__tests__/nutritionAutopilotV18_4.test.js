import { describe, expect, it } from "vitest";
import { buildFactorInventory, buildInventoryAdjustment, buildNutritionAutopilot, collectFactorUsage } from "../nutritionAutopilot";

const todayKey = "2026-07-20";

 describe("V18.4 nutrition autopilot", () => {
  it("subtracts logged prepared meals from live inventory", () => {
    const data = {
      "2026-07-20": { nutrition: { factorPlan: { factorLunch: "factor-thai", factorDinner: "factor-truffle" } } },
      "2026-07-21": { nutrition: { factorPlan: { factorLunch: "factor-thai" } } },
    };
    expect(collectFactorUsage(data)["factor-thai"]).toBe(2);
    const inventory = buildFactorInventory({ data });
    expect(inventory.find((meal) => meal.id === "factor-thai").remaining).toBe(0);
    expect(inventory.find((meal) => meal.id === "factor-truffle").remaining).toBe(3);
  });

  it("applies manual tray adjustments without mutating the previous state", () => {
    const state = { inventoryAdjustments: { "factor-thai": 1 } };
    const next = buildInventoryAdjustment(state, "factor-thai", -2);
    expect(next.inventoryAdjustments["factor-thai"]).toBe(-1);
    expect(state.inventoryAdjustments["factor-thai"]).toBe(1);
    expect(next.updatedAt).toBeTruthy();
  });

  it("selects the next unlogged meal in the prepared-meal sequence", () => {
    const result = buildNutritionAutopilot({
      data: {},
      todayKey,
      nutrition: { calories: "1020", protein: "106", factorPlan: { breakfast: "scaffold-breakfast", postWorkout: "scaffold-post" } },
      goals: { calories: 2400, protein: 200, carbs: 250, fats: 70, water: 128 },
      hour: 12,
    });
    expect(result.nextMeal.slot).toBe("factorLunch");
    expect(result.sequence.length).toBe(5);
    expect(result.traysRemaining).toBeGreaterThan(0);
  });

  it("activates late-day rescue mode and ranks a protein-first fallback", () => {
    const result = buildNutritionAutopilot({
      data: {},
      todayKey,
      nutrition: { calories: "900", protein: "70" },
      goals: { calories: 2400, protein: 200 },
      hour: 20,
    });
    expect(result.rescueMode).toBe(true);
    expect(result.headline).toBe("Use rescue mode");
    expect(result.rescueOptions[0].protein).toBeGreaterThanOrEqual(49);
    expect(result.groceryPrompts.some((item) => /whey|protein/i.test(`${item.label} ${item.why}`))).toBe(true);
  });

  it("closes the loop when calories and protein are within the allowed buffer", () => {
    const result = buildNutritionAutopilot({
      data: {},
      todayKey,
      nutrition: { calories: "2320", protein: "195" },
      goals: { calories: 2400, protein: 200 },
      hour: 21,
    });
    expect(result.onTarget).toBe(true);
    expect(result.headline).toBe("Fueling is closed out");
  });
});
