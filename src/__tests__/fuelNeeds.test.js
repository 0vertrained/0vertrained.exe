import { describe, expect, it } from "vitest";
import { computeStillNeeded, formatStillNeeded } from "../fuelNeeds";

const goals = { calories: 3600, protein: 200, carbs: 400, fats: 100, water: 128 };

describe("computeStillNeeded", () => {
  it("computes remaining amounts toward goals", () => {
    const out = computeStillNeeded({ calories: 3380, protein: 185, carbs: 372, fats: 88, water: 100 }, goals);
    expect(out).toMatchObject({ calories: 220, protein: 15, carbs: 28, fats: 12, water: 28 });
    expect(out.allMet).toBe(false);
  });

  it("floors at zero when intake exceeds the goal", () => {
    const out = computeStillNeeded({ calories: 4000, protein: 250, carbs: 500, fats: 120, water: 200 }, goals);
    expect(out).toMatchObject({ calories: 0, protein: 0, carbs: 0, fats: 0, water: 0 });
    expect(out.allMet).toBe(true);
  });

  it("parses string inputs and treats garbage as zero", () => {
    const out = computeStillNeeded({ calories: "100", protein: "abc", carbs: "", fats: undefined, water: null }, goals);
    expect(out.calories).toBe(3500);
    expect(out.protein).toBe(200);
    expect(out.carbs).toBe(400);
    expect(out.fats).toBe(100);
    expect(out.water).toBe(128);
  });

  it("handles empty input safely (no NaN)", () => {
    const out = computeStillNeeded();
    expect(JSON.stringify(out)).not.toMatch(/NaN/);
    expect(out.allMet).toBe(true);
  });
});

describe("formatStillNeeded", () => {
  it("includes only non-zero fields in order", () => {
    const parts = formatStillNeeded({ calories: 220, protein: 15, carbs: 0, fats: 0, water: 28 });
    expect(parts).toEqual(["+220 kcal", "+15g protein", "+28 oz water"]);
  });

  it("returns an empty array when everything is met", () => {
    expect(formatStillNeeded({ calories: 0, protein: 0, carbs: 0, fats: 0, water: 0 })).toEqual([]);
  });
});
