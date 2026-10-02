import { describe, expect, it } from "vitest";
import { summarizeProgramDay } from "../programSummary";

describe("summarizeProgramDay", () => {
  it("includes a short run added to an existing lifting day", () => {
    const out = summarizeProgramDay({
      type: "Upper A — Push + Triceps",
      lifting: [{ name: "Barbell Bench Press", sets: 4, reps: 6 }],
      cardio: { type: "Short Run", miles: 1.5, effort: "Zone 2", notes: "Easy shakeout" },
    });

    expect(out.hasLifting).toBe(true);
    expect(out.hasCardio).toBe(true);
    expect(out.cardioLabel).toBe("Short Run · 1.5mi · Zone 2");
    expect(out.label).toBe("Upper A — Push + Triceps + Short Run · 1.5mi · Zone 2");
  });

  it("summarizes a cardio-only day without hiding it as rest", () => {
    const out = summarizeProgramDay({
      type: "",
      lifting: [],
      cardio: { type: "Easy Run", miles: "2", effort: "Easy" },
    });

    expect(out.label).toBe("Easy Run · 2mi · Easy");
    expect(out.hasCardio).toBe(true);
  });
});
