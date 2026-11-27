import { describe, expect, it } from "vitest";
import { defaultDay } from "../constants";
import { adaptCustomProgramDay } from "../customPlanAdaptation";
import { buildDeloadRecommendation } from "../fatigueManagement";
import { TRACKING_MODES } from "../workoutLogging";

const dateKey = "2026-11-23";
const press = { name: "Barbell Bench Press", sets: 3, repMin: 6, reps: 10, rir: 2, restSeconds: 180, progressionExposures: 2 };
const row = { ...press, name: "Cable Row", sets: 2 };
const base = { type: "Upper", code: "UPPER", lifting: [press, row], cardio: null, adaptivePlan: { version: 1, goal: "bodybuilding", experience: "intermediate", sessionLength: 60 } };
const sets = (reps, weight = 100, rir = "2") => reps.map(count => ({ reps: count, weight, rir, done: true, quality: "clean" }));
const entry = (name, liftSets) => ({ workout: { exercises: { [name]: { sets: liftSets } } } });
const run = (options = {}) => adaptCustomProgramDay({ day: base, dateKey, ...options });
const first = day => day.lifting[0].adaptivePrescription;

describe("custom training on a specific date", () => {
  it("leaves unmarked presets alone and does not invent a weight or modify the week", () => {
    const unmarked = { ...base, adaptivePlan: null };
    expect(run({ day: unmarked })).toBe(unmarked);
    const day = run();
    expect(day.adaptation.status).toBe("baseline");
    expect(first(day)).toMatchObject({ kind: "establish", targetWeight: null, targetReps: [6, 6, 6], baseSets: 3 });
    expect(first(day)).not.toHaveProperty("last");
    expect(base.lifting[0]).not.toHaveProperty("adaptivePrescription");
    expect(run({ day })).toBe(day);
  });

  it("uses two comparable clean exposures, including a substitution performed under its own name", () => {
    const data = {
      "2026-11-10": entry(press.name, sets([10, 10, 10])),
      "2026-11-18": { workout: { exercises: { "Dumbbell Bench Press": { performedName: press.name, sets: sets([10, 10, 10]) } } } },
      "2026-11-19": { workout: { exercises: { [press.name]: { performedName: "Dumbbell Bench Press", sets: sets([10,10,10], 250) } } } },
      [dateKey]: entry(press.name, sets([10], 200)),
      "2026-11-24": entry(press.name, sets([10,10,10], 300)),
    };
    const output = run({ data });
    expect(first(output)).toMatchObject({ kind: "add_load", targetWeight: 105, targetReps: [6,6,6], sourceDate: "2026-11-18" });
    expect(first(run({ data: { ...data, "2026-11-18": entry(press.name, sets([10,10,10], 100, "")) } })).targetWeight).toBe(100);
    expect(first(run({ data: { ...data, "2026-11-18": entry(press.name, sets([10,10,10], 100, "0")) } })).targetWeight).toBe(100);
  });

  it("avoids stale, incomplete, dissimilar or incompatible baselines", () => {
    const data = {
      "2026-08-01": entry(press.name, sets([8, 8, 8])),
      "2026-11-11": entry(press.name, sets([2, 2], 300)),
      "2026-11-12": entry(press.name, [{ reps: 8, weight: 200 }]),
      "2026-11-13": entry(press.name, [{ reps: 8, weight: 50, done: true, progressionTarget: { mode: TRACKING_MODES.ASSISTED_REPS } }]),
    };
    expect(first(run({ data })).targetWeight).toBeNull();
    expect(first(run({ data, readiness: "pull_back" })).targetWeight).toBeNull();
  });

  it("reduces sets and mixed working loads for recovery while respecting per-slot loads", () => {
    const data = { "2026-11-19": entry(press.name, [...sets([8], 100), ...sets([8,8], 75)]) };
    const day = run({ data, readiness: "pull_back" });
    expect(day.adaptation.status).toBe("reduce");
    expect(day.lifting.map(ex => ex.sets)).toEqual([3, 1]);
    expect(first(day)).toMatchObject({ targetWeights: [90, 70, 70], targetRir: 3, targetReps: [6,6,6] });
    expect(day.lifting[1].adaptivePrescription.targetWeight).toBeNull();
    expect(run({ data, readiness: "moderate" }).lifting.map(ex => ex.sets)).toEqual([3, 2]);
    const recoveryDay = { ...entry(press.name, sets([6, 6, 6], 90)), workout: { ...entry(press.name, sets([6,6,6], 90)).workout, customPlanSnapshot: { day } } };
    expect(first(run({ data: { ...data, "2026-11-21": recoveryDay }, readiness: "pull_back" })).targetWeights).toEqual([90,70,70]);
  });

  it("preserves started slots, split session structure and performed cardio if a later signal calls for rest", () => {
    const cardio = { type: "Bike", minutes: 20, modality: "bike" };
    const day = { ...base, sessions: [{ id: "am", lifting: [press], cardio }, { id: "pm", lifting: [row], cardio: null }] };
    const data = { [dateKey]: { workout: { exercises: { [press.name]: { sets: [{}, { weight: 75, reps: 8 }] } }, cardioSessions: { am: { time: "18:00" } } } } };
    const actual = run({ day, data, readiness: "rest" });
    expect(actual.sessions).toHaveLength(1);
    expect(actual.sessions[0]).toMatchObject({ id: "am", lifting: [{ name: press.name, sets: 2 }], cardio });
    expect(data[dateKey].workout.exercises[press.name].sets[1].weight).toBe(75);
    const safety = run({ day, data: { [dateKey]: { body: { illnessOrInjury: true } } } });
    expect(safety).toMatchObject({ type: "Recovery day", code: "REST", lifting: [], sessions: [], cardio: null, adaptation: { status: "safety" } });
  });

  it("uses the dated check-in or wearable score and ignores future symptoms", () => {
    expect(run({ wearableScore: 25 })).toMatchObject({ lifting: [], adaptation: { status: "rest" } });
    expect(run({ data: { [dateKey]: { body: { energy: 1, sleep: 2, soreness: 10 } } } }).adaptation.status).toBe("rest");
    expect(run({ data: { "2026-11-24": { body: { illnessOrInjury: true } } } }).adaptation.status).toBe("baseline");
    expect(run({ wearableScore: -100 }).adaptation.status).toBe("baseline");
  });

  it("trials one bodybuilding set at the same load only with a recovered multiweek plateau and weekly capacity", () => {
    const data = Object.fromEntries(["2026-11-03","2026-11-10","2026-11-18"].map(key => [key, entry(press.name, sets([8,8,8]))]));
    const day = run({ data, wearableScore: 88 });
    expect(day.adaptation.status).toBe("volume_trial");
    expect(first(day)).toMatchObject({ kind: "volume_trial", targetWeight: 100, baseSets: 3, targetSets: 4, targetReps: [8,8,8,6] });
    expect(day.lifting[1].sets).toBe(2);
    expect(first(run({ data })).targetSets).toBe(3);
    expect(first(run({ data, wearableScore: 88, day: { ...base, adaptivePlan: { ...base.adaptivePlan, experience: "beginner" } } })).targetSets).toBe(3);
    const next = run({ data: { ...data, [dateKey]: { workout: { customPlanSnapshot: { day } } } }, dateKey: "2026-11-24", wearableScore: 88 });
    expect(first(next).targetSets).toBe(3);
  });

  it("applies the stronger multi-signal fatigue dose to the base working weight", () => {
    const data = { "2026-11-18": entry(press.name, sets([8,8,8])) };
    for (const key of ["2026-11-20", "2026-11-21", "2026-11-22"]) {
      data[key] = { body: { sleep: "6", soreness: "8", motivation: "3", restingHeartRate: "70" } };
    }
    data["2026-11-08"] = { body: { restingHeartRate: "58" } };
    const day = run({ data, wearableScore: 85 });
    expect(day.adaptation.status).toBe("reduce");
    expect(day.lifting.map(ex => ex.sets)).toEqual([2, 1]);
    expect(first(day)).toMatchObject({ targetWeight: 85, targetRir: 4 });
  });

  it("handles seconds, unweighted reps and assistance in the direction of less effort", () => {
    const hold = { name: "Side Plank", sets: 2, repMin: 20, reps: 40, trackingMode: TRACKING_MODES.TIMED_HOLD };
    const pushup = { ...press, name: "Push-Up", trackingMode: TRACKING_MODES.BODYWEIGHT_REPS, progressionMode: "leverage" };
    const assisted = { ...row, name: "Assisted Pull-Up", trackingMode: TRACKING_MODES.ASSISTED_REPS };
    const day = { ...base, lifting: [hold, pushup, assisted] };
    const log = { [hold.name]: { sets: [{ done: true, duration: 35 }, { done: true, duration: 30 }] }, [pushup.name]: { sets: sets([8,8,8], "") },
      [assisted.name]: { sets: sets([9,9]).map(set => ({ ...set, weight: "", assistance: 40 })) } };
    const result = run({ day, data: { "2026-11-18": { workout: { exercises: log } } }, readiness: "pull_back" });
    expect(result.lifting.map(ex => ex.adaptivePrescription.targetWeight)).toEqual([null, 0, 45]);
    expect(result.lifting[0].adaptivePrescription).toMatchObject({ kind: "timed_progress", targetRir: null, targetReps: [20,20] });
    expect(result.lifting[2].adaptivePrescription.kind).toBe("assistance_hold");
  });

  it("starts from the authored sets for untouched diary defaults", () => {
    expect(run({ data: { [dateKey]: defaultDay(), "2026-11-22": defaultDay() } }).adaptation.status).toBe("baseline");
    const data = Object.fromEntries(["2026-11-03", "2026-11-10", "2026-11-18"].map(key => [key, entry(press.name, sets([8, 8, 8]))]));
    data[dateKey] = { body: { energy: "10" } };
    expect(first(run({ data })).targetSets).toBe(3);
  });

  it("compares distance carries using yards and a repeatable working load", () => {
    const carry = { name: "Farmer Carry", sets: 2, repMin: 20, reps: 30, progressionExposures: 2, trackingMode: TRACKING_MODES.CARRY };
    const day = { ...base, lifting: [carry] };
    const make = (weight, distance = 30) => ({ weight, distance, done: true, quality: "clean" });
    const clean = entry(carry.name, [make(40), make(40)]);
    const data = { "2026-11-10": clean, "2026-11-17": clean };
    expect(first(run({ day, data }))).toMatchObject({ targetWeight: 45, targetReps: [20,20] });
    expect(first(run({ day, data: { ...data, "2026-11-10": entry(carry.name, [make(30), make(30)]) } })).targetWeight).toBe(40);
    expect(first(run({ day, data: { ...data, "2026-11-17": entry(carry.name, [make(40), make(30)]) } })).targetWeights).toEqual([40,30]);
    expect(first(run({ day, data: { "2026-11-20": entry(carry.name, [{ done: true, duration: 30, weight: 40 }]) } })).targetWeight).toBeNull();
  });

  it("requires measured, comparable assistance and reserve before decreasing assistance", () => {
    const lift = { ...row, name: "Assisted Pull-Up", trackingMode: TRACKING_MODES.ASSISTED_REPS };
    const day = { ...base, lifting: [lift] };
    const make = (values, rir = 2) => entry(lift.name, values.map(assistance => ({ done: true, reps: 10, rir, assistance })));
    const data = { "2026-11-10": make([40,40]), "2026-11-17": make([40,40]) };
    expect(first(run({ day, data })).targetWeight).toBe(35);
    expect(first(run({ day, data: { ...data, "2026-11-10": make([45,45]) } })).targetWeight).toBe(40);
    expect(first(run({ day, data: { ...data, "2026-11-17": make([40,40], "") } })).targetWeight).toBe(40);
    expect(first(run({ day, data: { ...data, "2026-11-17": make([40,50]) } })).targetWeights).toEqual([40,50]);
    expect(first(run({ day, data: { "2026-11-17": make(["",""]) } })).targetWeight).toBeNull();
  });

  it("does not convert missing reserve into a fatigue signal", () => {
    const data = { "2026-11-20": entry(press.name, sets(Array(8).fill(8), 100, "")), [dateKey]: { body: {} } };
    expect(buildDeloadRecommendation({ data, todayKey: dateKey }).score).toBe(0);
  });
});
