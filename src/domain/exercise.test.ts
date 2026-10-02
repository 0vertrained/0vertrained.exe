import { describe, expect, it } from "vitest";
import { guessMeta, guessTrackingMode, loadStepKg, strengthGroupOf, MOVEMENT_PATTERNS } from "./exercise";
import { lbToKg } from "./units";

describe("guessTrackingMode", () => {
  it.each([
    ["Plank", "timed_hold"],
    ["Wall Sit", "timed_hold"],
    ["Dead Hang", "timed_hold"],
    ["Farmer Carry", "carry"],
    ["Farmer's Walk", "carry"],
    ["Assisted Pull-Up", "assisted_reps"],
    ["Push-Ups", "bodyweight_reps"],
    ["Pull-Ups", "bodyweight_reps"],
    ["Hanging Leg Raises", "bodyweight_reps"],
    // v19 treated these as loaded lifts, so a weight was required to log them.
    ["Sit-Ups", "bodyweight_reps"],
    ["Crunches", "bodyweight_reps"],
    ["Bodyweight Squat", "bodyweight_reps"],
    ["Air Squats", "bodyweight_reps"],
    ["Glute Bridge", "bodyweight_reps"],
    ["Dead Bug", "bodyweight_reps"],
    ["Walking Lunges", "bodyweight_reps"],
    // …unless they say they're loaded.
    ["Weighted Pull-Ups", "loaded_reps"],
    ["DB Walking Lunges", "loaded_reps"],
    ["Barbell Bench Press", "loaded_reps"],
    ["Cable Curl", "loaded_reps"],
  ])("%s → %s", (name, mode) => {
    expect(guessTrackingMode(name)).toBe(mode);
  });
});

describe("guessMeta", () => {
  it("flags barbell lifts for plate math, not dumbbell or machine work", () => {
    expect(guessMeta("Barbell Row").isBarbell).toBe(true);
    expect(guessMeta("Back Squat").isBarbell).toBe(true);
    expect(guessMeta("Conventional Deadlift").isBarbell).toBe(true);
    expect(guessMeta("Dumbbell Bench Press").isBarbell).toBe(false);
    expect(guessMeta("Trap Bar Deadlift").isBarbell).toBe(false);
    expect(guessMeta("Leg Press").isBarbell).toBe(false);
    expect(guessMeta("Push-Ups").isBarbell).toBe(false);
  });

  it("uses bigger jumps for heavy lower-body lifts", () => {
    expect(guessMeta("Conventional Deadlift").largeIncrement).toBe(true);
    expect(guessMeta("Leg Press").largeIncrement).toBe(true);
    expect(guessMeta("Goblet Squat").largeIncrement).toBe(false);
    expect(guessMeta("Lateral Raise").largeIncrement).toBe(false);
  });
});

describe("loadStepKg", () => {
  it("matches plate jumps in each unit system", () => {
    expect(loadStepKg({}, "imperial")).toBeCloseTo(lbToKg(5), 10);
    expect(loadStepKg({ largeIncrement: true }, "imperial")).toBeCloseTo(lbToKg(10), 10);
    expect(loadStepKg({}, "metric")).toBe(2.5);
    expect(loadStepKg({ largeIncrement: true }, "metric")).toBe(5);
  });
});

describe("strengthGroupOf", () => {
  it("maps compound patterns to the four STR groups and isolation to none", () => {
    expect(strengthGroupOf("squat")).toBe("squat");
    expect(strengthGroupOf("singleLeg")).toBe("squat");
    expect(strengthGroupOf("hinge")).toBe("hinge");
    expect(strengthGroupOf("horizontalPush")).toBe("push");
    expect(strengthGroupOf("verticalPush")).toBe("push");
    expect(strengthGroupOf("horizontalPull")).toBe("pull");
    expect(strengthGroupOf("verticalPull")).toBe("pull");
    expect(strengthGroupOf("biceps")).toBeNull();
    expect(strengthGroupOf(undefined)).toBeNull();
    const grouped = MOVEMENT_PATTERNS.filter((p) => strengthGroupOf(p));
    expect(grouped).toHaveLength(7);
  });
});
