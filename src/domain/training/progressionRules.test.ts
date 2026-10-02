// Per-tracking-mode progression (holds, assisted moves, carries) and the
// prescription label, exercised through the public prescribe() API.
import { describe, expect, it } from "vitest";
import { normalizeDay } from "../day/normalize";
import type { DayMap, DayV2 } from "../day/schema";
import { guessMeta, type ExerciseMeta } from "../exercise";
import { toDisplayWeight, ydToM, type UnitSystem } from "../units";
import { formatPrescription, prescribe, type ProgressionTarget } from "./progression";

type V1Set = Record<string, unknown>;
const session = (weight: number | string, reps: number[], extra: V1Set = {}): V1Set[] =>
  reps.map((r) => ({ weight: String(weight), reps: String(r), done: true, ...extra }));
/** A v19 day with one exercise, read through the real v1 → v2 reader. */
const liftDay = (name: string, sets: V1Set[], exercise: V1Set = {}): DayV2 =>
  normalizeDay({ workout: { exercises: { [name]: { sets, ...exercise } } } });

const incline: ProgressionTarget = { name: "Incline Dumbbell Press", sets: 3, reps: "8–10" };
const loaded: ExerciseMeta = { trackingMode: "loaded_reps", isBarbell: false };
const TODAY = "2026-07-20";
const run = (days: DayMap, target = incline, meta = loaded, units: UnitSystem = "imperial") =>
  prescribe({ days, target, meta, todayKey: TODAY, units });
const lb = (kg: number | null | undefined) => (kg == null ? kg : toDisplayWeight(kg, "imperial"));

describe("timed holds progress seconds", () => {
  const plank: ProgressionTarget = { name: "Plank", sets: 3, reps: "30-45 s" };
  const meta = guessMeta("Plank");
  const holds = (secs: number[], extra: V1Set = {}) => secs.map((d) => ({ weight: "", reps: "", duration: String(d), done: true, ...extra }));

  it("adds five seconds to the first hold below the top", () => {
    const out = run({ "2026-07-13": liftDay("Plank", holds([40, 35, 30])) }, plank, meta);
    expect(out).toMatchObject({ status: "progress", seconds: [45, 35, 30], reps: null, weightKg: null });
    expect(out.basis!.label).toBe("40/35/30 s");
  });

  it("holds at the top and reduces to the floor on pain", () => {
    expect(run({ "2026-07-13": liftDay("Plank", holds([45, 45, 45])) }, plank, meta)).toMatchObject({ status: "hold", seconds: [45, 45, 45] });
    expect(run({ "2026-07-13": liftDay("Plank", holds([45, 40, 45], { pain: true })) }, plank, meta)).toMatchObject({ status: "reduce", seconds: [30, 30, 30] });
    expect(run({ "2026-07-13": liftDay("Plank", holds([20, 20, 20], { pain: true })) }, plank, meta)).toMatchObject({ status: "hold", seconds: [20, 20, 20] });
  });

  it("holds while a hold is missing or below the floor", () => {
    expect(run({ "2026-07-13": liftDay("Plank", holds([40, 35])) }, plank, meta)).toMatchObject({ status: "hold", seconds: [45, 35, 30] });
  });

  it("starts a baseline at the floor, defaulting to 30–45 s", () => {
    expect(run({}, { name: "Plank", sets: 2, reps: "hold" }, meta)).toMatchObject({ status: "baseline", seconds: [30, 30], reps: null });
  });

  it("keeps a weighted hold's added load", () => {
    const out = run({ "2026-07-13": liftDay("Plank", holds([40, 40, 40], { weight: "25" })) }, plank, meta);
    expect(lb(out.weightKg)).toBe(25);
  });
});

describe("assisted moves progress by removing assistance", () => {
  const target: ProgressionTarget = { name: "Assisted Pull-Up", sets: 2, reps: "6-8" };
  const meta = guessMeta("Assisted Pull-Up");
  const sets = (assist: number | "", reps: number[], extra: V1Set = {}) => reps.map((r) => ({ assistance: String(assist), reps: String(r), done: true, ...extra }));

  it("removes a step of assistance once every set hits the top", () => {
    const out = run({ "2026-07-13": liftDay(target.name, sets(40, [8, 8])) }, target, meta);
    expect(out.status).toBe("progress");
    expect(lb(out.assistanceKg)).toBe(35);
    expect(out.reps).toEqual([6, 6]);
    expect(formatPrescription(out, "imperial")).toBe("35 lb assist · 6 / 6");
  });

  it("adds assistance on pain and keeps it while chasing reps", () => {
    expect(lb(run({ "2026-07-13": liftDay(target.name, sets(40, [6, 6], { pain: true })) }, target, meta).assistanceKg)).toBe(45);
    expect(run({ "2026-07-13": liftDay(target.name, sets(40, [7, 6])) }, target, meta)).toMatchObject({ status: "progress", reps: [8, 6] });
    expect(run({ "2026-07-13": liftDay(target.name, sets(40, [5, 4])) }, target, meta).status).toBe("hold");
  });

  it("points to the unassisted move when no assistance is left", () => {
    const out = run({ "2026-07-13": liftDay(target.name, sets("", [8, 8])) }, target, meta);
    expect(out.status).toBe("hold");
    expect(out.reason).toMatch(/unassisted/i);
    expect(formatPrescription(out, "imperial")).toBe("BW · 8 / 8");
    const chasing = run({ "2026-07-13": liftDay(target.name, sets("", [7, 6])) }, target, meta);
    expect(chasing).toMatchObject({ status: "progress", assistanceKg: null, reps: [8, 6] });
    expect(chasing.reason).toBe("Keep the setup and add one rep.");
  });

  it("drops to no assistance when the last step is removed", () => {
    expect(run({ "2026-07-13": liftDay(target.name, sets(5, [8, 8])) }, target, meta)).toMatchObject({ status: "progress", assistanceKg: null });
  });

  it("starts with no assistance target", () => {
    expect(run({}, target, meta)).toMatchObject({ status: "baseline", assistanceKg: null, reps: [6, 6] });
  });
});

describe("carries progress distance, then load", () => {
  const target: ProgressionTarget = { name: "Farmer Carry", sets: 2, reps: "30-40" };
  const meta = guessMeta("Farmer Carry");
  const carries = (weight: number, yards: number[], extra: V1Set = {}) => yards.map((d) => ({ weight: String(weight), distance: String(d), done: true, ...extra }));

  it("adds distance to one carry until every carry reaches the top", () => {
    const out = run({ "2026-07-13": liftDay(target.name, carries(70, [35, 30])) }, target, meta);
    expect(out.status).toBe("progress");
    expect(lb(out.weightKg)).toBe(70);
    expect(out.distanceM!.map((m) => Math.round(m / 0.9144))).toEqual([40, 30]);
    expect(formatPrescription(out, "imperial")).toBe("70 lb · 40 / 30 yd");
  });

  it("adds load at the top and drops back to the shortest distance", () => {
    const out = run({ "2026-07-13": liftDay(target.name, carries(70, [40, 40])) }, target, meta);
    expect(out.status).toBe("progress");
    expect(lb(out.weightKg)).toBe(75);
    expect(out.distanceM![0]).toBeCloseTo(ydToM(30), 6);
  });

  it("reduces load on pain and holds when sets were missed", () => {
    expect(lb(run({ "2026-07-13": liftDay(target.name, carries(70, [40, 40], { pain: true })) }, target, meta).weightKg)).toBe(65);
    expect(run({ "2026-07-13": liftDay(target.name, carries(70, [35])) }, target, meta).status).toBe("hold");
  });

  it("works in metres for metric athletes", () => {
    const metric: DayV2 = normalizeDay({ v: 2, checkin: {}, workout: { cardio: [], exercises: { c: { name: target.name, sets: [25, 20].map((m, i) => ({ id: `s${i}`, weightKg: 32, reps: null, distanceM: m, done: true })) } } } });
    const out = run({ "2026-07-13": metric }, { ...target, reps: "20-25" }, meta, "metric");
    expect(out).toMatchObject({ status: "progress", weightKg: 32, distanceM: [25, 25] });
    expect(formatPrescription(out, "metric")).toBe("32 kg · 25 / 25 m");
  });

  it("works on time-based carries and without a numeric target", () => {
    const timed = [{ weight: "70", duration: "30", done: true }, { weight: "70", duration: "30", done: true }];
    const out = run({ "2026-07-13": liftDay(target.name, timed) }, { ...target, reps: "walk" }, meta);
    expect(out).toMatchObject({ status: "progress", seconds: [30, 30] });
    expect(formatPrescription(out, "imperial")).toBe("75 lb · 30 / 30 s");
    expect(run({}, target, meta)).toMatchObject({ status: "baseline", weightKg: null, reps: null });
  });
});

describe("formatPrescription", () => {
  it("formats loads with the athlete's unit", () => {
    const out = run({ "2026-07-13": liftDay(incline.name, session(75, [10, 10, 10])) });
    expect(formatPrescription(out, "imperial")).toBe("80 lb · 8 / 8 / 8");
    expect(formatPrescription(run({}), "imperial")).toBe("3 sets · 8 / 8 / 8");
    const pushups = run({ "2026-07-13": liftDay("Push-Ups", session(25, [12, 12, 12])) }, { name: "Push-Ups", sets: 3, reps: "8-12" }, guessMeta("Push-Ups"));
    expect(formatPrescription(pushups, "imperial")).toBe("+30 lb · 8 / 8 / 8");
    const plank = run({}, { name: "Plank", sets: 2, reps: "30" }, guessMeta("Plank"));
    expect(formatPrescription(plank, "metric")).toBe("30 / 30 s");
    const weighted = run({ "2026-07-13": liftDay("Plank", [{ weight: "25", duration: "40", done: true }]) }, { name: "Plank", sets: 1, reps: "30-45" }, guessMeta("Plank"));
    expect(formatPrescription(weighted, "imperial")).toBe("+25 lb · 45 s");
    const bw = run({ "2026-07-13": liftDay("Push-Ups", session("", [10, 10])) }, { name: "Push-Ups", sets: 2, reps: "8-12" }, guessMeta("Push-Ups"));
    expect(formatPrescription(bw, "imperial")).toBe("BW · 11 / 10");
    expect(formatPrescription(run({}, { name: "Farmer Carry", sets: 2, reps: "40" }, guessMeta("Farmer Carry")), "imperial")).toBe("No target yet");
  });
});
