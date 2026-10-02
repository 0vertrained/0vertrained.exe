import { describe, expect, it } from "vitest";
import { normalizeDay } from "../day/normalize";
import type { DayMap, DayV2, Tier } from "../day/schema";
import { guessMeta, type ExerciseMeta } from "../exercise";
import { lbToKg, toDisplayWeight, type UnitSystem } from "../units";
import { prescribe, type ProgressionTarget } from "./progression";

type V1Set = Record<string, unknown>;
const session = (weight: number | string, reps: number[], extra: V1Set = {}): V1Set[] =>
  reps.map((r) => ({ weight: String(weight), reps: String(r), done: true, ...extra }));
/** A v19 day with one exercise, read through the real v1 → v2 reader. */
const liftDay = (name: string, sets: V1Set[], exercise: V1Set = {}): DayV2 =>
  normalizeDay({ workout: { exercises: { [name]: { sets, ...exercise } } } });
const withTier = (day: DayV2, tier: Tier): DayV2 => ({
  ...day,
  quest: { rulesVersion: 1, tier, reason: "", issuedAt: "2026-07-01T06:00:00Z", engineIssued: true, planned: { exercises: [], plannedSets: 3, cardioMinutes: null } },
});

const incline: ProgressionTarget = { name: "Incline Dumbbell Press", sets: 3, reps: "8–10" };
const loaded: ExerciseMeta = { trackingMode: "loaded_reps", isBarbell: false };
const TODAY = "2026-07-20";
const run = (days: DayMap, target = incline, meta = loaded, units: UnitSystem = "imperial") =>
  prescribe({ days, target, meta, todayKey: TODAY, units });
const lb = (kg: number | null | undefined) => (kg == null ? kg : toDisplayWeight(kg, "imperial"));

describe("loaded double progression (legacy pins)", () => {
  it("establishes a baseline with no history", () => {
    const out = run({});
    expect(out).toMatchObject({ status: "baseline", weightKg: null, reps: [8, 8, 8], confidence: "low", basis: null });
  });

  it("adds the smallest load step only after every set reaches the top of the range", () => {
    const out = run({ "2026-07-13": liftDay(incline.name, session(75, [10, 10, 10])) });
    expect(out.status).toBe("progress");
    expect(lb(out.weightKg)).toBe(80);
    expect(out.reps).toEqual([8, 8, 8]);
    expect(out.basis).toEqual({ dateKey: "2026-07-13", label: "75×10/10/10" });
  });

  it("holds the load and adds one rep to the first set below the top", () => {
    const out = run({ "2026-07-13": liftDay(incline.name, session(75, [10, 9, 8])) });
    expect(out.status).toBe("progress");
    expect(lb(out.weightKg)).toBe(75);
    expect(out.reps).toEqual([10, 10, 8]);
  });

  it("repeats the load while any set is below the floor", () => {
    const out = run({ "2026-07-13": liftDay(incline.name, session(75, [9, 8, 6])) });
    expect(out.status).toBe("hold");
    expect(lb(out.weightKg)).toBe(75);
    expect(out.reps).toEqual([10, 8, 8]);
    expect(run({ "2026-07-13": liftDay(incline.name, session(75, [10, 10])) }).status).toBe("hold");
  });

  it("reduces the load after pain, with a stop caution", () => {
    const out = run({ "2026-07-13": liftDay(incline.name, session(75, [8, 8, 8], { pain: true })) });
    expect(out.status).toBe("reduce");
    expect(lb(out.weightKg)).toBe(70);
    expect(out.reps).toEqual([8, 8, 8]);
    expect(out.caution).toMatch(/stop the movement/i);
  });

  it("requires three non-improving exposures before calling a stall", () => {
    const two: DayMap = {
      "2026-07-06": liftDay(incline.name, session(75, [8, 8, 8])),
      "2026-07-13": liftDay(incline.name, session(75, [8, 8, 8])),
    };
    expect(run(two).status).not.toBe("reduce");
    const three = { ...two, "2026-06-29": liftDay(incline.name, session(75, [8, 8, 8])) };
    const out = run(three);
    expect(out.status).toBe("reduce");
    expect(lb(out.weightKg)).toBe(70);
    expect(out.reason).toMatch(/Three exposures at 75 lb/);
  });

  it("never calls a stall from an exposure with missed sets or pain in the sample", () => {
    const flat = () => liftDay(incline.name, session(75, [8, 8, 8]));
    const missed = { "2026-06-29": liftDay(incline.name, session(75, [8, 8])), "2026-07-06": flat(), "2026-07-13": flat() };
    expect(run(missed).status).toBe("progress");
    const pain = { "2026-06-29": liftDay(incline.name, session(75, [8, 8, 8], { pain: true })), "2026-07-06": flat(), "2026-07-13": flat() };
    expect(run(pain).status).toBe("progress");
    const moved = { "2026-06-29": liftDay(incline.name, session(70, [8, 8, 8])), "2026-07-06": flat(), "2026-07-13": flat() };
    expect(run(moved).status).toBe("progress");
  });

  it("treats a junk set count as one set", () => {
    expect(run({}, { ...incline, sets: Number.NaN }).reps).toEqual([8]);
    expect(run({}, { ...incline, sets: 0 }).reps).toEqual([8]);
  });

  it("does not mistake one poor day after prior progress for a stall", () => {
    const days: DayMap = {
      "2026-06-29": liftDay(incline.name, session(75, [8, 8, 8])),
      "2026-07-06": liftDay(incline.name, session(75, [10, 9, 9])),
      "2026-07-13": liftDay(incline.name, session(75, [8, 8, 8])),
    };
    expect(run(days).status).not.toBe("reduce");
  });

  it("keeps substituted movement history separate from the planned exercise", () => {
    const days: DayMap = {
      "2026-07-13": liftDay("Barbell Bench Press", session(160, [10, 10, 10]), { performedName: "Machine Chest Press" }),
    };
    expect(run(days, { name: "Barbell Bench Press", sets: 3, reps: 10 }).status).toBe("baseline");
    const swapped = run(days, { name: "Machine Chest Press", sets: 3, reps: 10 });
    expect(swapped.status).toBe("progress");
    expect(lb(swapped.weightKg)).toBe(165);
  });

  it("rates confidence by the number of exposures", () => {
    const days: DayMap = {};
    ["2026-06-22", "2026-06-29", "2026-07-06", "2026-07-13"].forEach((k, i) => (days[k] = liftDay(incline.name, session(70 + i * 5, [10, 10, 10]))));
    expect(run(days).confidence).toBe("high");
    expect(run({ "2026-07-06": days["2026-07-06"]!, "2026-07-13": days["2026-07-13"]! }).confidence).toBe("medium");
  });

  it("only reads the last 120 days", () => {
    expect(run({ "2026-03-01": liftDay(incline.name, session(75, [10, 10, 10])) }).status).toBe("baseline");
  });

  it("previews next time from today's work when asked", () => {
    const days: DayMap = { [TODAY]: liftDay(incline.name, session(75, [10, 10, 10])) };
    expect(run(days).status).toBe("baseline");
    const next = prescribe({ days, target: incline, meta: loaded, todayKey: TODAY, units: "imperial", includeToday: true });
    expect(lb(next.weightKg)).toBe(80);
  });
});

describe("fix: RIR and set-quality gates are gone (the data is not modelled in v2)", () => {
  it("progresses a top-of-range session that v19 held back as a grind", () => {
    const out = run({ "2026-07-13": liftDay(incline.name, session(75, [10, 10, 10], { rir: "0", quality: "grind" })) });
    expect(out.status).toBe("progress");
    expect(lb(out.weightKg)).toBe(80);
  });

  it("ignores a form-break flag but still gates on pain", () => {
    expect(run({ "2026-07-13": liftDay(incline.name, session(75, [10, 10, 10], { quality: "form_break" })) }).status).toBe("progress");
  });
});

describe("fix: pain on any signal holds or reduces", () => {
  it("treats a pain flag on an unbanked set as pain", () => {
    const sets = [...session(75, [10, 10]), { weight: "75", reps: "", done: false, pain: true }];
    expect(run({ "2026-07-13": liftDay(incline.name, sets) }).status).toBe("reduce");
  });

  it("treats a later skip for pain as pain, even with no sets that day", () => {
    const days: DayMap = {
      "2026-07-06": liftDay(incline.name, session(75, [10, 10, 10])),
      "2026-07-13": liftDay(incline.name, [], { skipped: "pain" }),
    };
    const out = run(days);
    expect(out.status).toBe("reduce");
    expect(lb(out.weightKg)).toBe(70);
  });

  it("cautions a first exposure after a pain skip", () => {
    const out = run({ "2026-07-13": liftDay(incline.name, [], { skipped: "pain" }) });
    expect(out.status).toBe("baseline");
    expect(out.caution).toMatch(/pain/i);
  });

  it("never prescribes more than last time under pain, even off-grid", () => {
    const out = run({ "2026-07-13": liftDay(incline.name, session(2.5, [8, 8, 8], { pain: true })) });
    expect(out.weightKg).toBeLessThanOrEqual(lbToKg(2.5) + 1e-9);
    expect(out.status).toBe("hold");
  });
});

describe("fix: bodyweight moves hold or reduce on pain or stall", () => {
  const pushups: ProgressionTarget = { name: "Push-Ups", sets: 3, reps: "8-12" };
  const bw = guessMeta("Push-Ups");

  it("never prescribes added load to an unloaded move on pain (v19 said reduce and prescribed +5 lb)", () => {
    const out = run({ "2026-07-13": liftDay("Push-Ups", session("", [12, 12, 12], { pain: true })) }, pushups, bw);
    expect(out.status).toBe("reduce");
    expect(out.weightKg).toBeNull();
    expect(out.reps).toEqual([8, 8, 8]);
  });

  it("holds when the reps are already at or below the floor", () => {
    const out = run({ "2026-07-13": liftDay("Push-Ups", session("", [7, 6, 6], { pain: true })) }, pushups, bw);
    expect(out.status).toBe("hold");
    expect(out.weightKg).toBeNull();
    expect(out.reps).toEqual([7, 6, 6]);
  });

  it("backs off an unloaded stall to the floor without adding load", () => {
    const days: DayMap = {
      "2026-06-29": liftDay("Push-Ups", session("", [10, 10, 10])),
      "2026-07-06": liftDay("Push-Ups", session("", [10, 10, 10])),
      "2026-07-13": liftDay("Push-Ups", session("", [10, 10, 10])),
    };
    const out = run(days, pushups, bw);
    expect(out.status).toBe("reduce");
    expect(out.weightKg).toBeNull();
    expect(out.reps).toEqual([8, 8, 8]);
  });

  it("reduces added load a step on pain, never below zero", () => {
    const out = run({ "2026-07-13": liftDay("Push-Ups", session(25, [10, 10, 10], { pain: true })) }, pushups, bw);
    expect(out.status).toBe("reduce");
    expect(lb(out.weightKg)).toBe(20);
    const light = run({ "2026-07-13": liftDay("Push-Ups", session(2.5, [10, 10, 10], { pain: true })) }, pushups, bw);
    expect(light.weightKg).toBeNull();
  });

  it("starts a baseline with no added load, and holds while sets are below the floor", () => {
    expect(run({}, pushups, bw)).toMatchObject({ status: "baseline", weightKg: null, reps: [8, 8, 8] });
    const below = run({ "2026-07-13": liftDay("Push-Ups", session("", [9, 7, 6])) }, pushups, bw);
    expect(below).toMatchObject({ status: "hold", weightKg: null, reps: [10, 8, 8] });
    expect(below.reason).toMatch(/at least 8 reps/);
  });

  it("progresses reps, and at the top of the range holds instead of inventing load", () => {
    const mid = run({ "2026-07-13": liftDay("Push-Ups", session("", [12, 10, 9])) }, pushups, bw);
    expect(mid).toMatchObject({ status: "progress", weightKg: null, reps: [12, 11, 9] });
    const top = run({ "2026-07-13": liftDay("Push-Ups", session("", [12, 12, 12])) }, pushups, bw);
    expect(top).toMatchObject({ status: "hold", weightKg: null, reps: [12, 12, 12] });
    expect(top.reason).toMatch(/harder variation/i);
  });

  it("adds a load step when the move is already loaded and every set hit the top", () => {
    const out = run({ "2026-07-13": liftDay("Push-Ups", session(25, [12, 12, 12])) }, pushups, bw);
    expect(out.status).toBe("progress");
    expect(lb(out.weightKg)).toBe(30);
  });
});

describe("fix: scaled days are never evidence of a stall", () => {
  const flat = () => liftDay(incline.name, session(75, [8, 8, 8]));

  it("does not count REDUCED or RECOVER exposures toward the three-exposure gate", () => {
    for (const tier of ["REDUCED", "RECOVER"] as const) {
      const days: DayMap = { "2026-06-29": withTier(flat(), tier), "2026-07-06": flat(), "2026-07-13": flat() };
      expect(run(days).status).not.toBe("reduce");
    }
  });

  it("still finds the stall across a scaled day in between", () => {
    const days: DayMap = {
      "2026-06-22": withTier(flat(), "FULL"),
      "2026-06-29": flat(),
      "2026-07-06": withTier(flat(), "REDUCED"),
      "2026-07-13": flat(),
    };
    expect(run(days).status).toBe("reduce");
  });
});

describe("fix: targets are kg rounded to loadable steps in the athlete's units", () => {
  it("uses 2.5 kg / 5 kg steps in metric", () => {
    const metric = (w: number, meta = loaded) => run({ "2026-07-13": normalizeDay({ v: 2, checkin: {}, workout: { cardio: [], exercises: { x: { name: incline.name, sets: [10, 10, 10].map((r, i) => ({ id: `s${i}`, weightKg: w, reps: r, done: true })) } } } }) }, incline, meta, "metric");
    expect(metric(60).weightKg).toBe(62.5);
    expect(metric(100, { ...loaded, largeIncrement: true }).weightKg).toBe(105);
    expect(metric(61).weightKg).toBe(62.5);
  });

  it("uses 10 lb steps for large-increment lifts in imperial", () => {
    const squat: ProgressionTarget = { name: "Back Squat", sets: 3, reps: 5 };
    const out = run({ "2026-07-13": liftDay("Back Squat", session(225, [5, 5, 5])) }, squat, guessMeta("Back Squat"));
    expect(lb(out.weightKg)).toBe(235);
  });

  it("rounds reductions down to a loadable weight", () => {
    const out = run({ "2026-07-13": liftDay(incline.name, session(77.5, [8, 8, 8], { pain: true })) });
    expect(lb(out.weightKg)).toBe(70);
  });
});

describe("fix: decisions are not persisted", () => {
  it("never writes into the history it reads", () => {
    const days: DayMap = { "2026-07-13": liftDay(incline.name, session(75, [10, 10, 10])) };
    const before = JSON.stringify(days);
    run(days);
    expect(JSON.stringify(days)).toBe(before);
  });
});
