import { describe, expect, it } from "vitest";
import { normalizeDay } from "../day/normalize";
import type { DayMap, SetLog } from "../day/schema";
import { guessMeta } from "../exercise";
import { lbToKg, toDisplayWeight } from "../units";
import { buildNextGlance, firstEmptyIndex, ghostForSet, shortDate, targetGhost, valuesFor, type LastSets } from "./ghosts";
import { lastPerformance } from "./liftMath";
import { prescribe } from "./progression";

const S = (weight: number | string, reps: number | string, extra: Record<string, unknown> = {}) =>
  ({ done: true, weight: String(weight), reps: String(reps), ...extra });
const day = (exercises: Record<string, unknown>) => normalizeDay({ workout: { exercises } });
const empty = (id = "s"): SetLog => ({ id, weightKg: null, reps: null, done: false });
const lbSet = (weight: number, reps: number, done = true): SetLog => ({ id: "s", weightKg: lbToKg(weight), reps, done });
const lb = (kg: number | null | undefined) => (kg == null ? kg : toDisplayWeight(kg, "imperial"));

const HIST: DayMap = {
  "2026-07-10": day({ Bench: { sets: [S(180, 8), S(180, 8), S(180, 7)] } }),
  "2026-07-13": day({ Bench: { sets: [S(185, 8), S(185, 8), S(185, 6)] } }),
};
const lastBench = (before = "2026-07-15"): LastSets | null => lastPerformance(HIST, { name: "Bench" }, before, "imperial");

describe("last time's raw sets", () => {
  it("are the most recent prior day's sets, index-preserved and strictly prior", () => {
    const last = lastBench()!;
    expect(last.dateKey).toBe("2026-07-13");
    expect(last.sets).toHaveLength(3);
    expect(lb(last.sets[2]!.weightKg)).toBe(185);
    expect(last.sets[2]!.reps).toBe(6);
    expect(lastBench("2026-07-13")!.dateKey).toBe("2026-07-10");
    expect(lastPerformance(HIST, { name: "Squat" }, "2026-07-15", "imperial")).toBeNull();
  });
});

describe("ghost priority and placement", () => {
  it("carry beats last time; last time uses the SAME slot; overflow uses the final set", () => {
    const last = lastBench();
    const untouched = ghostForSet([empty(), empty()], 0, last, "loaded_reps", "imperial")!;
    expect(untouched).toMatchObject({ source: "last", label: "last time · Jul 13", text: "185 × 8" });
    expect(lb(untouched.values.weightKg)).toBe(185);

    const carried = ghostForSet([lbSet(190, 8), empty()], 1, last, "loaded_reps", "imperial")!;
    expect(carried).toMatchObject({ source: "carry", label: "from set 1", text: "190 × 8" });

    const fourth = ghostForSet([empty(), empty(), empty(), empty()], 3, last, "loaded_reps", "imperial")!;
    expect(fourth).toMatchObject({ source: "last", text: "185 × 6" });

    expect(ghostForSet([empty()], 0, null, "loaded_reps", "imperial")).toBeNull();
  });

  it("carries a typed-but-unbanked earlier set too", () => {
    expect(ghostForSet([lbSet(200, 5, false), empty()], 1, null, "loaded_reps", "imperial")).toMatchObject({ source: "carry", text: "200 × 5" });
  });

  it("places one ghost at the first empty set", () => {
    expect(firstEmptyIndex([lbSet(185, 8), empty(), empty()], "loaded_reps")).toBe(1);
    expect(firstEmptyIndex([lbSet(185, 8), lbSet(185, 8)], "loaded_reps")).toBe(-1);
  });

  it("works for bodyweight work, which v19 never ghosted", () => {
    const days: DayMap = { "2026-07-13": day({ "Push-Ups": { sets: [S("", 15), S("", 12)] } }) };
    const last = lastPerformance(days, { name: "Push-Ups", trackingMode: "bodyweight_reps" }, "2026-07-15", "imperial");
    const sets: SetLog[] = [{ ...empty(), reps: 14 }, empty()];
    expect(firstEmptyIndex(sets, "bodyweight_reps")).toBe(1);
    expect(ghostForSet([empty(), empty()], 1, last, "bodyweight_reps", "imperial")).toMatchObject({ source: "last", text: "BW × 12", values: { weightKg: null, reps: 12 } });
    expect(ghostForSet(sets, 1, last, "bodyweight_reps", "imperial")).toMatchObject({ source: "carry", text: "BW × 14" });
  });

  it("works for holds and carries, with only the mode's fields", () => {
    expect(firstEmptyIndex([{ ...empty(), seconds: 45 }, { ...empty(), weightKg: 10 }], "timed_hold")).toBe(1);
    const hold: LastSets = { dateKey: "2026-07-01", sets: [{ ...empty(), seconds: 60, reps: 3, done: true }] };
    expect(ghostForSet([empty()], 0, hold, "timed_hold", "metric")).toMatchObject({ text: "60 s", values: { weightKg: null, reps: null, seconds: 60 } });
    const carry: LastSets = { dateKey: "2026-07-01", sets: [{ ...empty(), weightKg: 32, distanceM: 30, done: true }] };
    expect(ghostForSet([empty()], 0, carry, "carry", "metric")).toMatchObject({ text: "32 kg · 30 m" });
  });

  it("flags a ghost copied from a pain set", () => {
    const last: LastSets = { dateKey: "2026-07-01", sets: [{ ...lbSet(185, 8), pain: true }] };
    expect(ghostForSet([empty()], 0, last, "loaded_reps", "imperial")!.pain).toBe(true);
    expect(ghostForSet([empty()], 0, lastBench(), "loaded_reps", "imperial")).not.toHaveProperty("pain");
  });
});

describe("valuesFor", () => {
  it("keeps only the fields the mode logs", () => {
    const set = { weightKg: 10, reps: 5, seconds: 30, distanceM: 20, assistanceKg: 15 };
    expect(valuesFor(set, "assisted_reps")).toEqual({ weightKg: null, reps: 5, assistanceKg: 15 });
    expect(valuesFor({ weightKg: 10, reps: 5 }, "carry")).toEqual({ weightKg: 10, reps: null, distanceM: null, seconds: null });
    expect(valuesFor({ weightKg: 10, reps: 5 }, "timed_hold")).toEqual({ weightKg: 10, reps: null, seconds: null });
    expect(valuesFor({ weightKg: 10, reps: 5 }, "assisted_reps")).toEqual({ weightKg: null, reps: 5, assistanceKg: null });
  });
});

describe("target ghosts", () => {
  const days: DayMap = { "2026-07-13": day({ "Incline Dumbbell Press": { sets: [S(75, 10), S(75, 9), S(75, 8)] } }) };
  const target = { name: "Incline Dumbbell Press", sets: 3, reps: "8-10" };

  it("fills the day's target for the set, named as the target", () => {
    const p = prescribe({ days, target, meta: guessMeta(target.name), todayKey: "2026-07-20", units: "imperial" });
    expect(targetGhost(p, 1, "imperial")).toMatchObject({ source: "target", label: "today's target", text: "75 × 10" });
    expect(targetGhost(p, 7, "imperial")!.text).toBe("75 × 8");
  });

  it("offers nothing for a baseline", () => {
    const p = prescribe({ days: {}, target, meta: guessMeta(target.name), todayKey: "2026-07-20", units: "imperial" });
    expect(targetGhost(p, 0, "imperial")).toBeNull();
  });

  it("fills holds and assistance", () => {
    const plank = prescribe({ days: { "2026-07-13": day({ Plank: { sets: [{ duration: "40", done: true }] } }) }, target: { name: "Plank", sets: 1, reps: "30-45" }, meta: guessMeta("Plank"), todayKey: "2026-07-20", units: "metric" });
    expect(targetGhost(plank, 0, "metric")).toMatchObject({ text: "45 s", values: { seconds: 45 } });
    const assisted = prescribe({ days: { "2026-07-13": day({ "Assisted Dip": { sets: [{ assistance: "40", reps: "8", done: true }] } }) }, target: { name: "Assisted Dip", sets: 1, reps: "8" }, meta: guessMeta("Assisted Dip"), todayKey: "2026-07-20", units: "imperial" });
    expect(targetGhost(assisted, 0, "imperial")!.text).toBe("35 lb assist × 8");
  });
});

describe("the rest glance", () => {
  it("answers what's next: slot ghost, then next exercise, then banked", () => {
    const last = lastBench();
    const sets = [lbSet(190, 8), empty(), empty()];
    const g = buildNextGlance({ sets, completedIndex: 0, exerciseName: "Bench", last, mode: "loaded_reps", units: "imperial", nextExerciseName: "Dip" });
    expect(g).toEqual({ line: "Next · set 2 of 3", ghost: "last time 185 × 8", exercise: "Bench" });
    const done = [lbSet(190, 8), lbSet(190, 8), lbSet(190, 6)];
    expect(buildNextGlance({ sets: done, completedIndex: 2, exerciseName: "Bench", last, mode: "loaded_reps", units: "imperial", nextExerciseName: "Dip" }))
      .toEqual({ line: "Next · Dip", ghost: null, exercise: "Dip" });
    expect(buildNextGlance({ sets: done, completedIndex: 2, exerciseName: "Bench", last, mode: "loaded_reps", units: "imperial" }).line).toBe("Last set banked");
  });

  it("uses last time's final set past its length, ignores extra sets, and has no ghost without history", () => {
    const last = lastBench();
    const sets = [lbSet(190, 8), lbSet(190, 8), lbSet(190, 8), empty(), { ...empty(), extra: true }];
    expect(buildNextGlance({ sets, completedIndex: 2, exerciseName: "Bench", last, mode: "loaded_reps", units: "imperial" }))
      .toMatchObject({ line: "Next · set 4 of 4", ghost: "last time 185 × 6" });
    expect(buildNextGlance({ sets, completedIndex: 2, exerciseName: "Bench", last: null, mode: "loaded_reps", units: "imperial" }).ghost).toBeNull();
  });
});

describe("shortDate", () => {
  it("formats from the key, independent of locale", () => {
    expect(shortDate("2026-07-13")).toBe("Jul 13");
    expect(shortDate("2026-12-01")).toBe("Dec 1");
    expect(shortDate("junk")).toBe("junk");
  });
});
