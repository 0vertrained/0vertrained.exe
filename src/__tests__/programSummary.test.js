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
  it("summarizes all authoritative sessions without counting stale top-level work", () => {
    const out = summarizeProgramDay({
      type: "Double session",
      lifting: [{ name: "Old lift" }], cardio: { type: "Old run" },
      sessions: [
        { id: "am", lifting: [{ name: "Bench press" }], cardio: { type: "Easy run", minutes: 20 } },
        { id: "pm", lifting: [{ name: "Row" }], cardio: { type: "Bike", minutes: 30 } },
      ],
    });

    expect(out).toMatchObject({ hasLifting: true, hasCardio: true, liftCount: 2,
      label: "Double session + Easy run · 20 min + Bike · 30 min" });
  });
});
