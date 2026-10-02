import { describe, expect, it } from "vitest";
import { buildNutritionRecommendation } from "../nutritionCoach";

const goals = { calories: 3400, protein: 200, carbs: 380, fats: 95, water: 128 };

describe("nutritionCoach", () => {
  it("prioritizes protein when protein is far behind", () => {
    const out = buildNutritionRecommendation({ nutrition: { calories: 1800, protein: 70, carbs: 220, fats: 55, water: 80 }, goals });
    expect(out.priority).toBe("protein");
    expect(out.quickAdds[0].protein).toBeGreaterThan(0);
  });

  it("raises carb targets on long-run days", () => {
    const normal = buildNutritionRecommendation({ nutrition: {}, goals, todayProgram: { type: "Push", lifting: [{ name: "Bench" }] } });
    const longRun = buildNutritionRecommendation({ nutrition: {}, goals, todayProgram: { type: "Long Run", cardio: { miles: 7, type: "Long Run" } } });
    expect(longRun.targets.carbs).toBeGreaterThan(normal.targets.carbs);
  });

  it("does not lower protein on rest readiness", () => {
    const out = buildNutritionRecommendation({ nutrition: {}, goals, recommendation: { readiness: "rest" } });
    expect(out.targets.protein).toBe(goals.protein);
  });

  it("prioritizes hydration when water is materially behind", () => {
    const out = buildNutritionRecommendation({ nutrition: { calories: 3300, protein: 195, carbs: 360, fats: 90, water: 40 }, goals });
    expect(out.priority).toBe("water");
    expect(out.quickAdds.some(add => add.water)).toBe(true);
  });

  it("handles empty input safely", () => {
    const out = buildNutritionRecommendation({});
    expect(out.title).toBeTruthy();
    expect(JSON.stringify(out)).not.toMatch(/NaN/);
  });
});
