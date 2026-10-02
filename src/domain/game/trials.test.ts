import { describe, expect, it } from "vitest";
import { day, doneSets, logged, set } from "../../test/gameFixtures";
import { addDays, type DateKey } from "../dates";
import type { DayMap, ExerciseLog, SetLog } from "../day/schema";
import { guessMeta, type ExerciseMeta } from "../exercise";
import { TRIAL } from "./config";
import { judgeTrial, MIN_EXPOSURES, trialAllowedOn, trialFor, type TrialForInput } from "./trials";
import type { TrialSpec } from "./types";

const TODAY: DateKey = "2026-10-02";

const META: Record<string, ExerciseMeta> = {
  "Back Squat": { trackingMode: "loaded_reps", isBarbell: true, pattern: "squat", equipment: "barbell", largeIncrement: true },
  "Bench Press": { trackingMode: "loaded_reps", isBarbell: true, pattern: "horizontalPush", equipment: "barbell" },
  Deadlift: { trackingMode: "loaded_reps", isBarbell: true, pattern: "hinge", equipment: "barbell", largeIncrement: true },
  "Biceps Curl": { trackingMode: "loaded_reps", isBarbell: false, pattern: "biceps", equipment: "dumbbell" },
  "Push-Up": { trackingMode: "bodyweight_reps", isBarbell: false, pattern: "horizontalPush", equipment: "bodyweight", bwFactor: 0.64 },
  "Pull-Up": { trackingMode: "bodyweight_reps", isBarbell: false, pattern: "verticalPull", equipment: "bodyweight", bwFactor: 1 },
  Plank: { trackingMode: "timed_hold", isBarbell: false, pattern: "core", equipment: "bodyweight" },
};
const metaFor = (log: ExerciseLog): ExerciseMeta => META[log.performedName ?? log.name] ?? guessMeta(log.name);

const SQUAT_100x5: SetLog[] = doneSets(3, { weightKg: 100, reps: 5 });
const PUSHUPS = (reps: number): SetLog[] => [set(0, { weightKg: null, reps })];

/** `n` sessions of `name` every third day, the first `startOffset` days ago. */
function sessions(name: string, sets: SetLog[], n: number, days: DayMap = {}, startOffset = 0, log: Partial<ExerciseLog> = {}): DayMap {
  for (let i = 0; i < n; i += 1) {
    const key = addDays(TODAY, -(startOffset + i * 3));
    const entry = days[key] ?? day();
    entry.workout.exercises[name] = { ...logged(name, { sets })[1], ...log };
    days[key] = entry;
  }
  return days;
}

const trial = (days: DayMap, extra: Partial<TrialForInput> = {}) =>
  trialFor({ targetRank: "C", days, todayKey: TODAY, metaFor, units: "metric", ...extra });

describe("trialFor", () => {
  it("prescribes reps at 80% of the best e1RM on the most-trained loaded lift, floored to a plate step", () => {
    // 100 × 5 → e1RM 116.7 kg → 93.3 kg → 90 kg on a 5 kg step
    expect(trial(sessions("Back Squat", SQUAT_100x5, 3))).toEqual({
      targetRank: "C", kind: "loaded", exerciseId: "Back Squat", exerciseName: "Back Squat", loadKg: 90, reps: TRIAL.reps, minutes: null,
      spec: "5 reps at 80% of your best: 90 kg Back Squat. Stop if anything hurts.",
    });
  });

  it("floors to the display system's step in imperial", () => {
    const t = trial(sessions("Bench Press", SQUAT_100x5, 3), { units: "imperial" });
    expect(t?.spec).toBe("5 reps at 80% of your best: 205 lb Bench Press. Stop if anything hurts.");
    expect(t?.loadKg).toBeCloseTo(92.99, 1);
  });

  it("never tests a hinge, however well trained", () => {
    const both = sessions("Back Squat", SQUAT_100x5, 3, sessions("Deadlift", doneSets(3, { weightKg: 180, reps: 5 }), 6));
    expect(trial(both)?.exerciseName).toBe("Back Squat");
    expect(trial(sessions("Deadlift", SQUAT_100x5, 6))).toBeNull();
    expect(trial(sessions("Biceps Curl", SQUAT_100x5, 6))).toBeNull();
  });

  it("picks the most exposures, then the highest best", () => {
    const more = sessions("Bench Press", doneSets(3, { weightKg: 60, reps: 5 }), 4, sessions("Back Squat", SQUAT_100x5, 3));
    expect(trial(more)?.exerciseName).toBe("Bench Press");
    const tie = sessions("Bench Press", doneSets(3, { weightKg: 100, reps: 3 }), 3, sessions("Back Squat", SQUAT_100x5, 3));
    expect(trial(tie)?.exerciseName).toBe("Back Squat");
  });

  it("needs three exposures with pain-free completed work inside the 90-day window", () => {
    expect(MIN_EXPOSURES).toBe(3);
    expect(trial(sessions("Back Squat", SQUAT_100x5, 2))).toBeNull();
    const painful = sessions("Back Squat", doneSets(3, { weightKg: 100, reps: 5, pain: true }), 1, sessions("Back Squat", SQUAT_100x5, 2), 20);
    expect(trial(painful)).toBeNull();
    const undone = sessions("Back Squat", doneSets(3, { done: false }), 1, sessions("Back Squat", SQUAT_100x5, 2), 20);
    expect(trial(undone)).toBeNull();
    const skipped = sessions("Back Squat", SQUAT_100x5, 1, sessions("Back Squat", SQUAT_100x5, 2), 20, { skipped: "time" });
    expect(trial(skipped)).toBeNull();
    expect(trial(sessions("Back Squat", SQUAT_100x5, 3, {}, TRIAL.bestWindowDays - 7))?.kind).toBe("loaded");
    expect(trial(sessions("Back Squat", SQUAT_100x5, 3, {}, TRIAL.bestWindowDays - 6))).toBeNull();
  });

  it("attaches to the planned slot of the movement actually performed", () => {
    const swapped = sessions("Bench Press", SQUAT_100x5, 3, {}, 0, { performedName: "Back Squat" });
    expect(trial(swapped)).toMatchObject({ exerciseId: "Bench Press", exerciseName: "Back Squat", loadKg: 90 });
  });

  it("falls back to a bodyweight test: 80% of the best reps, then a plank", () => {
    const pushups = sessions("Push-Up", PUSHUPS(20), 3, sessions("Push-Up", PUSHUPS(12), 1, {}, 40));
    expect(trial(pushups)).toEqual({
      targetRank: "C", kind: "bodyweight", exerciseId: "Push-Up", exerciseName: "Push-Up", loadKg: null, reps: 16, minutes: null,
      spec: "16 reps of Push-Up in one set, then a plank for as long as you can (up to 3:00). Stop if anything hurts.",
    });
    const tie = sessions("Pull-Up", PUSHUPS(8), 3, sessions("Push-Up", PUSHUPS(5), 3));
    expect(trial(tie)?.exerciseName).toBe("Pull-Up");
    expect(trial(sessions("Push-Up", PUSHUPS(20), 2))).toBeNull();
    expect(trial(sessions("Plank", [set(0, { weightKg: null, reps: null, seconds: 60 })], 3))).toBeNull();
  });

  it("prefers a loaded lift over a bodyweight move, and either over cardio", () => {
    const mixed = sessions("Push-Up", PUSHUPS(20), 5, sessions("Back Squat", SQUAT_100x5, 3, { [addDays(TODAY, -1)]: day({ cardio: [{ minutes: 30 }] }) }));
    expect(trial(mixed)?.kind).toBe("loaded");
    const noLift = sessions("Push-Up", PUSHUPS(20), 3, { [addDays(TODAY, -1)]: day({ cardio: [{ minutes: 30 }] }) });
    expect(trial(noLift)?.kind).toBe("bodyweight");
  });

  it("asks cardio-only athletes for continuous minutes", () => {
    expect(trial({ [addDays(TODAY, -10)]: day({ cardio: [{ minutes: 30 }] }) })).toEqual({
      targetRank: "C", kind: "cardio", exerciseId: null, exerciseName: null, loadKg: null, reps: null, minutes: TRIAL.cardioMinutes,
      spec: "20 minutes of continuous cardio, any kind, no pauses. Stop if anything hurts.",
    });
    expect(trial({ [TODAY]: day({ cardio: [{ minutes: null, km: 5 }] }) })?.kind).toBe("cardio");
    expect(trial({ [TODAY]: day({ cardio: [{ minutes: null, km: null }] }) })).toBeNull();
    expect(trial({ [addDays(TODAY, -TRIAL.bestWindowDays)]: day({ cardio: [{ minutes: 30 }] }) })).toBeNull();
    expect(trial({})).toBeNull();
  });
});

describe("trialAllowedOn", () => {
  it("allows the first trial and then one a week", () => {
    expect(trialAllowedOn(undefined, TODAY)).toBe(true);
    expect(trialAllowedOn(TODAY, TODAY)).toBe(false);
    expect(trialAllowedOn(addDays(TODAY, -(TRIAL.minDaysBetween - 1)), TODAY)).toBe(false);
    expect(trialAllowedOn(addDays(TODAY, -TRIAL.minDaysBetween), TODAY)).toBe(true);
  });
});

describe("judgeTrial", () => {
  const LOADED: TrialSpec = { targetRank: "C", kind: "loaded", exerciseId: "Back Squat", exerciseName: "Back Squat", loadKg: 90, reps: 5, minutes: null, spec: "" };
  const BODYWEIGHT: TrialSpec = { ...LOADED, kind: "bodyweight", exerciseId: "Push-Up", exerciseName: "Push-Up", loadKg: null, reps: 16 };
  const CARDIO: TrialSpec = { ...LOADED, kind: "cardio", exerciseId: null, exerciseName: null, loadKg: null, reps: null, minutes: 20 };
  const PAIN = { attempted: true, passed: false, reason: "Stopped for pain. No penalty." };
  const NOT_ATTEMPTED = { attempted: false, passed: false, reason: "Not attempted yet." };
  const PASSED = { attempted: true, passed: true, reason: "Trial passed." };
  const squatDay = (sets: SetLog[], extra: Partial<ExerciseLog> = {}) =>
    day({ exercises: [["Back Squat", { ...logged("Back Squat", { sets })[1], ...extra }]] });

  it("judges the highlighted trial set against the prescription", () => {
    expect(judgeTrial(squatDay([set(0, { weightKg: 60 }), set(1, { weightKg: 90, reps: 5, trial: true })]), LOADED)).toEqual(PASSED);
    expect(judgeTrial(squatDay([set(0, { weightKg: 90, reps: 4, trial: true })]), LOADED)).toEqual({ attempted: true, passed: false, reason: "4 of 5 reps." });
    expect(judgeTrial(squatDay([set(0, { weightKg: 85, reps: 5, trial: true })]), LOADED)).toEqual({ attempted: true, passed: false, reason: "Below the prescribed load." });
    expect(judgeTrial(squatDay([set(0, { weightKg: 89.96, reps: 6, trial: true })]), LOADED)).toEqual(PASSED);
  });

  it("falls back to the first completed set, and waits while nothing is done", () => {
    expect(judgeTrial(squatDay([set(0, { done: false }), set(1, { weightKg: 90, reps: 5 })]), LOADED)).toEqual(PASSED);
    expect(judgeTrial(squatDay([set(0, { weightKg: 80, reps: 5 }), set(1, { weightKg: 90, reps: 5 })]), LOADED).passed).toBe(false);
    expect(judgeTrial(squatDay([set(0, { done: false })]), LOADED)).toEqual(NOT_ATTEMPTED);
    expect(judgeTrial(squatDay([set(0, { weightKg: 90, reps: 5, done: false, trial: true })]), LOADED)).toEqual(NOT_ATTEMPTED);
    expect(judgeTrial(day(), LOADED)).toEqual(NOT_ATTEMPTED);
    expect(judgeTrial(squatDay([set(0, { weightKg: 90, reps: 5 })]), { ...LOADED, exerciseId: null })).toEqual(NOT_ATTEMPTED);
  });

  it("ends on pain with no penalty", () => {
    expect(judgeTrial(squatDay([set(0, { weightKg: 90, reps: 5, pain: true, trial: true })]), LOADED)).toEqual(PAIN);
    expect(judgeTrial(squatDay([set(0, { weightKg: 90, reps: 2, pain: true, done: false, trial: true })]), LOADED)).toEqual(PAIN);
    expect(judgeTrial(squatDay([], { skipped: "pain" }), LOADED)).toEqual(PAIN);
  });

  it("judges a bodyweight trial on reps alone", () => {
    const pushups = (reps: number, extra = {}) => day({ exercises: [logged("Push-Up", { sets: [set(0, { weightKg: null, reps, ...extra })] })] });
    expect(judgeTrial(pushups(16), BODYWEIGHT)).toEqual(PASSED);
    expect(judgeTrial(pushups(10), BODYWEIGHT)).toEqual({ attempted: true, passed: false, reason: "10 of 16 reps." });
    expect(judgeTrial(pushups(16, { pain: true }), BODYWEIGHT)).toEqual(PAIN);
  });

  it("judges a cardio trial on the longest single session", () => {
    expect(judgeTrial(day({ cardio: [{ minutes: 25 }] }), CARDIO)).toEqual(PASSED);
    expect(judgeTrial(day({ cardio: [{ minutes: 15 }, { minutes: 10 }] }), CARDIO)).toEqual({ attempted: true, passed: false, reason: "15 of 20 minutes." });
    expect(judgeTrial(day({ cardio: [{ minutes: null, km: 5 }] }), CARDIO)).toEqual(NOT_ATTEMPTED);
    expect(judgeTrial(day(), CARDIO)).toEqual(NOT_ATTEMPTED);
  });
});
