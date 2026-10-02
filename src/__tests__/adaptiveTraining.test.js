import { describe, expect, it } from "vitest";
import { suggestWorkoutAdjustments } from "../adaptiveTraining";

const intervalLegDay = {
  type: "Intervals + Legs",
  code: "SPEED+LEGS",
  lifting: [{ name: "Back Squat" }, { name: "Walking Lunges" }],
  cardio: { type: "Intervals", effort: "High" },
};

describe("adaptiveTraining", () => {
  it("suggests rest for rest readiness", () => {
    const out = suggestWorkoutAdjustments({ recommendation: { readiness: "rest", reasons: [] }, todayProgram: intervalLegDay });
    expect(out.mode).toBe("rest");
    expect(out.changes.some(c => c.type === "session")).toBe(true);
  });

  it("swaps intervals on pull-back days", () => {
    const out = suggestWorkoutAdjustments({ recommendation: { readiness: "pull_back", reasons: [] }, todayProgram: intervalLegDay });
    expect(out.mode).toBe("swap_cardio");
    expect(out.changes.some(c => c.type === "cardio")).toBe(true);
  });

  it("never adds intensity on a rest recommendation", () => {
    const out = suggestWorkoutAdjustments({ recommendation: { readiness: "rest", reasons: [] }, todayProgram: intervalLegDay });
    expect(JSON.stringify(out).toLowerCase()).not.toMatch(/add intensity|push harder|max effort/);
  });

  it("handles missing program with a low-confidence generic suggestion", () => {
    const out = suggestWorkoutAdjustments({ recommendation: { readiness: "moderate", reasons: [] }, todayProgram: null });
    expect(out.mode).toBe("keep");
    expect(out.title).toMatch(/No programmed workout/);
  });

  it("keeps the plan on push days while preserving guardrails", () => {
    const out = suggestWorkoutAdjustments({ recommendation: { readiness: "push", reasons: [] }, todayProgram: { type: "Push", lifting: [{ name: "Bench" }] } });
    expect(out.mode).toBe("keep");
    expect(out.safetyNotes.length).toBeGreaterThan(0);
  });
});
