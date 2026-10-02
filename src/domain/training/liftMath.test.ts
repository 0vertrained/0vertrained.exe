import { describe, expect, it } from "vitest";
import { normalizeDay } from "../day/normalize";
import type { DayMap } from "../day/schema";
import { guessMeta, type ExerciseMeta } from "../exercise";
import { lbToKg } from "../units";
import { e1rm, lastPerformance, performanceLabel, plateMath, suggestRestSeconds } from "./liftMath";

const day = (sets: unknown[], name = "Bench Press") => normalizeDay({ workout: { exercises: { [name]: { sets } } } });
const done = (weight: number | string, reps: number | string, extra: Record<string, unknown> = {}) =>
  ({ weight: String(weight), reps: String(reps), done: true, ...extra });

describe("e1rm", () => {
  it("is Epley: 185 lb × 8 ≈ 234 lb", () => {
    expect(e1rm(lbToKg(185), 8)! * 2.20462262185).toBeCloseTo(234.33, 2);
    expect(e1rm(100, 5)).toBeCloseTo(116.667, 3);
  });

  it("keeps the v19 convention that a single is its own max", () => {
    expect(e1rm(140, 1)).toBe(140);
  });

  it("clamps reps at 12 instead of returning nothing above it", () => {
    expect(e1rm(60, 15)).toBeCloseTo(e1rm(60, 12)!, 10);
    expect(e1rm(60, 12)).toBeCloseTo(84, 10);
  });

  it("has no RIR adjustment (RIR is not modelled in v2)", () => {
    expect(e1rm.length).toBe(2);
  });

  it("returns null without a load or a rep", () => {
    expect(e1rm(0, 5)).toBeNull();
    expect(e1rm(null, 5)).toBeNull();
    expect(e1rm(100, 0)).toBeNull();
    expect(e1rm(100, null)).toBeNull();
    expect(e1rm(100, Number.NaN)).toBeNull();
  });
});

describe("lastPerformance", () => {
  it("finds the most recent prior day with completed working sets (legacy pin)", () => {
    const days: DayMap = {
      "2026-06-28": day([done(185, 8), done(185, 8), done(185, 7)]),
      "2026-06-30": day([done(185, 8), done(185, 8), done(185, 8)]),
      "2026-07-02": day([{ weight: "", reps: "8", done: false }]),
    };
    const last = lastPerformance(days, { name: "Bench Press" }, "2026-07-02", "imperial")!;
    expect(last.dateKey).toBe("2026-06-30");
    expect(last.topWeightKg).toBeCloseTo(lbToKg(185), 10);
    expect(last.reps).toEqual([8, 8, 8]);
    expect(last.label).toBe("185×8/8/8");
  });

  it("excludes today and returns null with no history", () => {
    const days: DayMap = { "2026-07-02": day([done(185, 8)]) };
    expect(lastPerformance(days, { name: "Bench Press" }, "2026-07-02", "imperial")).toBeNull();
    expect(lastPerformance({}, { name: "Bench Press" }, "2026-07-02", "imperial")).toBeNull();
  });

  it("ignores incomplete or weightless loaded sets", () => {
    const days: DayMap = { "2026-06-30": day([{ weight: "185", reps: "8", done: false }, { weight: "", reps: "8", done: true }]) };
    expect(lastPerformance(days, { name: "Bench Press" }, "2026-07-02", "imperial")).toBeNull();
  });

  it("follows the performed movement, not the planned one", () => {
    const days: DayMap = {
      "2026-06-30": normalizeDay({ workout: { exercises: { "Seated Cable Row": { performedName: "Chest-Supported Row", sets: [done(140, 10)] } } } }),
    };
    expect(lastPerformance(days, { name: "Seated Cable Row" }, "2026-07-02", "imperial")).toBeNull();
    expect(lastPerformance(days, { name: "chest-supported row" }, "2026-07-02", "imperial")!.label).toBe("140×10");
  });

  it("reads bodyweight work, which v19 ignored for lacking a weight", () => {
    const days: DayMap = { "2026-06-30": day([done("", 12), done("", 10)], "Push-Ups") };
    const last = lastPerformance(days, { name: "Push-Ups", trackingMode: "bodyweight_reps" }, "2026-07-02", "imperial")!;
    expect(last.topWeightKg).toBeNull();
    expect(last.label).toBe("BW×12/10");
  });
});

describe("performanceLabel", () => {
  const s = (v: Record<string, number>) => ({ id: "s", weightKg: null, reps: null, done: true, ...v });
  it("labels every tracking mode", () => {
    expect(performanceLabel([s({ weightKg: 10, reps: 8 }), s({ weightKg: 10, reps: 7 })], "bodyweight_reps", "metric")).toBe("+10 kg×8/7");
    expect(performanceLabel([s({ assistanceKg: lbToKg(40), reps: 8 })], "assisted_reps", "imperial")).toBe("40 lb assist×8");
    expect(performanceLabel([s({ reps: 8 })], "assisted_reps", "imperial")).toBe("BW×8");
    expect(performanceLabel([s({ seconds: 60 }), s({ seconds: 45 })], "timed_hold", "metric")).toBe("60/45 s");
    expect(performanceLabel([s({ seconds: 60, weightKg: 10 })], "timed_hold", "metric")).toBe("+10 kg · 60 s");
    expect(performanceLabel([s({ weightKg: 32, distanceM: 30 }), s({ weightKg: 32, distanceM: 25 })], "carry", "metric")).toBe("32 kg · 30/25 m");
    expect(performanceLabel([s({ weightKg: 32, seconds: 40 })], "carry", "metric")).toBe("32 kg · 40 s");
    expect(performanceLabel([], "loaded_reps", "metric")).toBe("");
  });
});

describe("plateMath", () => {
  it("computes standard per-side lb loads on a 45 lb bar (legacy pins)", () => {
    expect(plateMath(lbToKg(225), "imperial", true)!.perSide).toEqual([45, 45]);
    expect(plateMath(lbToKg(190), "imperial", true)!.perSide).toEqual([45, 25, 2.5]);
    expect(plateMath(lbToKg(135), "imperial", true)).toMatchObject({ perSide: [45], bar: 45, unit: "lb", remainder: 0, label: "45 / side" });
  });

  it("loads kg plates on a 20 kg bar", () => {
    expect(plateMath(100, "metric", true)).toMatchObject({ bar: 20, unit: "kg", perSide: [25, 15], remainder: 0 });
    expect(plateMath(102.5, "metric", true)!.perSide).toEqual([25, 15, 1.25]);
  });

  it("handles the empty bar and impossible targets", () => {
    expect(plateMath(lbToKg(45), "imperial", true)).toMatchObject({ perSide: [], remainder: 0, label: "empty bar" });
    expect(plateMath(lbToKg(30), "imperial", true)).toBeNull();
    expect(plateMath(Number.NaN, "metric", true)).toBeNull();
  });

  it("flags unloadable remainders", () => {
    const r = plateMath(lbToKg(137), "imperial", true)!; // 1 lb/side
    expect(r.remainder).toBe(1);
    expect(r.label).toBe("45 / side (+1 lb short)");
    expect(plateMath(lbToKg(47), "imperial", true)!.label).toBe("empty bar (+1 lb short)");
  });

  it("is only for barbell lifts (v19 assumed a 45 lb bar under dumbbells and machines)", () => {
    expect(plateMath(lbToKg(70), "imperial", guessMeta("Dumbbell Bench Press").isBarbell)).toBeNull();
    expect(plateMath(lbToKg(270), "imperial", guessMeta("Leg Press").isBarbell)).toBeNull();
    expect(plateMath(lbToKg(225), "imperial", guessMeta("Back Squat").isBarbell)).not.toBeNull();
  });
});

describe("suggestRestSeconds", () => {
  const meta = (m: Partial<ExerciseMeta>): ExerciseMeta => ({ trackingMode: "loaded_reps", isBarbell: false, ...m });

  it("gives heavy compounds the longest rest (legacy pins)", () => {
    expect(suggestRestSeconds(guessMeta("Back Squat"), 5)).toBe(180);
    expect(suggestRestSeconds(guessMeta("Bench Press"), 10)).toBe(120);
    expect(suggestRestSeconds(guessMeta("Lateral Raise"), 15)).toBe(90);
  });

  it("reads compound-ness from the movement pattern and reps from a prescription", () => {
    expect(suggestRestSeconds(meta({ pattern: "verticalPull" }), "5-6")).toBe(180);
    expect(suggestRestSeconds(meta({ pattern: "horizontalPull" }), "8–12")).toBe(120);
    expect(suggestRestSeconds(meta({ pattern: "biceps" }), "8")).toBe(90);
    expect(suggestRestSeconds(meta({ pattern: "squat" }), null)).toBe(120);
  });
});
