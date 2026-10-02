import { describe, expect, it } from "vitest";
import { normalizeDay } from "../day/normalize";
import type { ExerciseLog, PlannedExercise, SetLog, WorkoutLog } from "../day/schema";
import { lbToKg, ydToM } from "../units";
import {
  blankSet,
  completedPlannedSets,
  describeSet,
  firstIncompleteExerciseIndex,
  firstIncompleteSetIndex,
  isCompletedSet,
  isExerciseHandled,
  isSessionHandled,
  isStraightSet,
  modeOf,
  nextIncompleteExerciseIndex,
  parseRepRange,
  reconcileSets,
  validateSet,
} from "./sets";

const set = (values: Partial<SetLog> = {}, id = "s1"): SetLog => ({ id, weightKg: null, reps: null, done: false, ...values });
const done = (weightKg: number | null, reps: number | null, id = "s1"): SetLog => set({ weightKg, reps, done: true }, id);

/** A v1 exercise read through the real v1 → v2 reader. */
function v1Exercise(name: string, raw: unknown): ExerciseLog {
  return normalizeDay({ workout: { exercises: { [name]: raw } } }).workout.exercises[name] as ExerciseLog;
}

const planned = (id: string, sets = 1, trackingMode: PlannedExercise["trackingMode"] = "loaded_reps"): PlannedExercise => ({
  id, name: id, sets, reps: "8", trackingMode,
});

describe("validateSet", () => {
  it("does not count a banked loaded set without a weight as complete", () => {
    const bench = v1Exercise("Bench Press", { sets: [{ weight: "", reps: "8", done: true }] });
    expect(validateSet(bench.sets[0]!, "loaded_reps")).toEqual({ valid: false, message: "Enter the working weight before banking this set." });
    expect(isExerciseHandled(bench, 1, "loaded_reps")).toBe(false);
  });

  it("supports bodyweight, timed hold, carry and assisted sets", () => {
    expect(validateSet(set({ reps: 12 }), "bodyweight_reps").valid).toBe(true);
    expect(validateSet(set({ reps: 8, weightKg: lbToKg(25) }), "bodyweight_reps").valid).toBe(true);
    expect(validateSet(set({ seconds: 45 }), "timed_hold").valid).toBe(true);
    expect(validateSet(set({ weightKg: lbToKg(80), distanceM: ydToM(40) }), "carry").valid).toBe(true);
    expect(validateSet(set({ weightKg: 32, seconds: 30 }), "carry").valid).toBe(true);
    expect(validateSet(set({ reps: 8, assistanceKg: 20 }), "assisted_reps").valid).toBe(true);
    expect(validateSet(set({ reps: 8 }), "assisted_reps").valid).toBe(true);
  });

  it("names what is missing, without units", () => {
    expect(validateSet(set(), "timed_hold").message).toBe("Enter the hold time before banking this set.");
    expect(validateSet(set({ distanceM: 40 }), "carry").message).toBe("Enter the carried load before banking this set.");
    expect(validateSet(set({ weightKg: 40 }), "carry").message).toBe("Enter the carry distance or time.");
    expect(validateSet(set({ weightKg: 40 }), "loaded_reps").message).toBe("Enter completed reps before banking this set.");
    expect(validateSet(set({ weightKg: 40 }), "bodyweight_reps").valid).toBe(false);
    expect(validateSet(set({ assistanceKg: 20 }), "assisted_reps").valid).toBe(false);
  });

  it("keeps a prescription such as 6–8 from validating as performed reps", () => {
    const bench = v1Exercise("Bench Press", { sets: [{ weight: "185", reps: "6–8", done: true }] });
    expect(bench.sets[0]!.reps).toBeNull();
    expect(validateSet(bench.sets[0]!, "loaded_reps").valid).toBe(false);
  });

  it("never validates negative values (v19 accepted a negative added load)", () => {
    expect(validateSet(set({ reps: 8, weightKg: -5 }), "bodyweight_reps")).toEqual({ valid: false, message: "Values can't be negative." });
    expect(validateSet(set({ reps: 8, assistanceKg: -1 }), "assisted_reps").valid).toBe(false);
  });

  it("rejects non-finite numbers", () => {
    expect(validateSet(set({ weightKg: Number.NaN, reps: 5 }), "loaded_reps").valid).toBe(false);
    expect(validateSet(set({ weightKg: Number.POSITIVE_INFINITY, reps: 5 }), "loaded_reps").valid).toBe(false);
  });
});

describe("completion", () => {
  it("counts a set only when banked and valid", () => {
    expect(isCompletedSet(done(100, 5), "loaded_reps")).toBe(true);
    expect(isCompletedSet(set({ weightKg: 100, reps: 5 }), "loaded_reps")).toBe(false);
    expect(isCompletedSet(set({ weightKg: 100, reps: 5, done: true, pain: true }), "loaded_reps")).toBe(true);
  });

  it("never counts extra sets toward the plan", () => {
    const log: ExerciseLog = { name: "Row", sets: [done(80, 10, "s1"), { ...done(80, 10, "s2"), extra: true }, done(80, 10, "s3")] };
    expect(completedPlannedSets(log, 2, "loaded_reps")).toBe(1);
    expect(completedPlannedSets(log, 3, "loaded_reps")).toBe(2);
    expect(isExerciseHandled(log, 2, "loaded_reps")).toBe(false);
    expect(completedPlannedSets(undefined, 3)).toBe(0);
  });

  it("treats a recorded skip as handled", () => {
    expect(isExerciseHandled({ name: "Press", sets: [], skipped: "equipment" }, 3)).toBe(true);
    expect(isExerciseHandled(undefined, 3)).toBe(false);
    expect(isExerciseHandled({ name: "Press", sets: [] }, 0)).toBe(false);
  });

  it("uses the log's own tracking mode before the caller's fallback", () => {
    const swapped: ExerciseLog = { name: "Pull-Up", performedName: "Lat Pulldown", trackingMode: "loaded_reps", sets: [done(null, 10)] };
    expect(isExerciseHandled(swapped, 1, "bodyweight_reps")).toBe(false);
    expect(modeOf(swapped, "bodyweight_reps")).toBe("loaded_reps");
    expect(modeOf({ name: "Plank", sets: [] })).toBe("timed_hold");
    expect(modeOf({ name: "Pull-Up", sets: [] }, "assisted_reps")).toBe("assisted_reps");
    expect(modeOf(undefined)).toBe("loaded_reps");
  });
});

describe("reconcileSets", () => {
  it("pads to the plan without deleting existing work", () => {
    const sets = reconcileSets(3, [done(100, 10)]);
    expect(sets).toHaveLength(3);
    expect(sets[0]).toEqual(done(100, 10));
    expect(sets.slice(1)).toEqual([blankSet("s2"), blankSet("s3")]);
    expect(firstIncompleteSetIndex(sets, "loaded_reps")).toBe(1);
  });

  it("keeps sets beyond the plan and flags them extra (v19 truncated them)", () => {
    const existing = [done(100, 10, "s1"), done(100, 10, "s2"), done(100, 9, "s3")];
    const sets = reconcileSets(2, existing);
    expect(sets).toHaveLength(3);
    expect(sets[2]).toEqual({ ...existing[2], extra: true });
    expect(sets[0]).toBe(existing[0]);
    expect(existing[2]!.extra).toBeUndefined();
  });

  it("never reuses an id already taken", () => {
    const sets = reconcileSets(3, [done(100, 10, "s3")]);
    expect(sets.map((s) => s.id)).toEqual(["s3", "s2", "s4"]);
  });

  it("treats junk counts as zero planned sets", () => {
    expect(reconcileSets(Number.NaN, [])).toEqual([]);
    expect(reconcileSets(-2, [done(1, 1)])[0]!.extra).toBe(true);
  });
});

describe("resume", () => {
  const lifting = [planned("press"), planned("row"), planned("curl")];
  const workout: WorkoutLog = {
    cardio: [],
    exercises: {
      press: { name: "Press", sets: [], skipped: "equipment" },
      row: { name: "Row", sets: [done(lbToKg(100), 8)] },
      curl: { name: "Curl", sets: [set({ reps: 10 })] },
    },
  };

  it("resumes at the first real gap, treating skips as handled", () => {
    expect(firstIncompleteExerciseIndex(lifting, workout)).toBe(2);
    expect(isSessionHandled(lifting, workout)).toBe(false);
    expect(nextIncompleteExerciseIndex(lifting, workout)).toBe(2);
    expect(nextIncompleteExerciseIndex(lifting, workout, 2)).toBe(-1);
  });

  it("falls back to the last exercise or set when everything is handled", () => {
    const all: WorkoutLog = { ...workout, exercises: { ...workout.exercises, curl: { name: "Curl", sets: [done(20, 10)] } } };
    expect(isSessionHandled(lifting, all)).toBe(true);
    expect(firstIncompleteExerciseIndex(lifting, all)).toBe(2);
    expect(firstIncompleteExerciseIndex([], all)).toBe(0);
    expect(isSessionHandled([], all)).toBe(false);
    expect(firstIncompleteSetIndex([done(1, 1), done(1, 1)], "loaded_reps")).toBe(1);
    expect(firstIncompleteSetIndex([], "loaded_reps")).toBe(0);
  });
});

describe("parseRepRange", () => {
  const fallback = { min: 8, max: 12 };
  it("parses single and ranged prescriptions", () => {
    expect(parseRepRange("6–10", fallback)).toEqual({ min: 6, max: 10 });
    expect(parseRepRange("10-6", fallback)).toEqual({ min: 6, max: 10 });
    expect(parseRepRange("8", fallback)).toEqual({ min: 8, max: 8 });
    expect(parseRepRange(8, fallback)).toEqual({ min: 8, max: 8 });
    expect(parseRepRange("30-45 s", fallback)).toEqual({ min: 30, max: 45 });
  });

  it("falls back when there is no usable number", () => {
    expect(parseRepRange("AMRAP", fallback)).toEqual(fallback);
    expect(parseRepRange(null, fallback)).toEqual(fallback);
    expect(parseRepRange(0, fallback)).toEqual(fallback);
    expect(parseRepRange("0", fallback)).toEqual(fallback);
  });
});

describe("isStraightSet", () => {
  it("treats v19 technique sets as not straight", () => {
    const bench = v1Exercise("Bench", { sets: [
      { weight: "185", reps: "8", done: true },
      { weight: "185", reps: "8", done: true, type: "straight" },
      { weight: "225", reps: "6", done: true, type: "drop", segments: [{ weight: "170", reps: "8" }] },
    ] });
    expect(bench.sets.map(isStraightSet)).toEqual([true, true, false]);
  });
});

describe("describeSet", () => {
  it("labels each tracking mode in the athlete's units", () => {
    expect(describeSet(done(lbToKg(185), 6), "loaded_reps", "imperial")).toBe("185 × 6");
    expect(describeSet(done(82.5, 5), "loaded_reps", "metric")).toBe("82.5 × 5");
    expect(describeSet(set(), "loaded_reps", "metric")).toBe("— × —");
    expect(describeSet(set({ seconds: 60 }), "timed_hold", "imperial")).toBe("60 s");
    expect(describeSet(set({ seconds: 45, weightKg: 10 }), "timed_hold", "metric")).toBe("45 s · +10 kg");
    expect(describeSet(set({ reps: 8, weightKg: lbToKg(25) }), "bodyweight_reps", "imperial")).toBe("+25 lb × 8");
    expect(describeSet(set({ reps: 12 }), "bodyweight_reps", "imperial")).toBe("BW × 12");
    expect(describeSet(set({ reps: 8, assistanceKg: lbToKg(40) }), "assisted_reps", "imperial")).toBe("40 lb assist × 8");
    expect(describeSet(set({ reps: 8 }), "assisted_reps", "metric")).toBe("BW × 8");
    expect(describeSet(set({ weightKg: lbToKg(70), distanceM: ydToM(40) }), "carry", "imperial")).toBe("70 lb · 40 yd");
    expect(describeSet(set({ weightKg: 32, distanceM: 30 }), "carry", "metric")).toBe("32 kg · 30 m");
    expect(describeSet(set({ seconds: 45 }), "carry", "metric")).toBe("— · 45 s");
  });
});
