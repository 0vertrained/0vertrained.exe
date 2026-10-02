import { describe, expect, it } from "vitest";
import { WEEKDAYS } from "../dates";
import {
  GOAL_TEMPLATES, LIFT_ROLE_PLANS, buildSchedule, coerceBuilderInput, goalUsesRunning, includesIntervals,
  recommendCardioPreference, recommendRestDays, roleIntensity, scoreSchedule, type Schedule,
} from "./builderRules";
import { BUILDER_GOALS, TRAINING_DAY_OPTIONS, type BuilderInput } from "./types";

const input = (goal: BuilderInput["goal"], daysPerWeek: BuilderInput["daysPerWeek"], experience: BuilderInput["experience"] = "intermediate"): BuilderInput => ({
  goal, daysPerWeek, equipment: "full_gym", experience,
});

describe("goal templates", () => {
  it("have exactly one role per training day", () => {
    for (const goal of BUILDER_GOALS) {
      for (const days of TRAINING_DAY_OPTIONS) expect(GOAL_TEMPLATES[goal][days], `${goal} ${days}`).toHaveLength(days);
    }
  });

  it("name a lifting plan for every lifting role", () => {
    const roles = new Set(BUILDER_GOALS.flatMap((g) => TRAINING_DAY_OPTIONS.flatMap((d) => GOAL_TEMPLATES[g][d])));
    for (const role of roles) {
      if (!["easy_run", "long_run", "tempo_run", "quality_run", "active_recovery"].includes(role)) {
        expect(LIFT_ROLE_PLANS[role as keyof typeof LIFT_ROLE_PLANS], role).toBeDefined();
      }
    }
  });
});

describe("recommendRestDays (ported)", () => {
  it("returns 7 − training days, weekend and mid-week first", () => {
    expect(recommendRestDays(3, "basic_fitness")).toEqual(["Wednesday", "Thursday", "Saturday", "Sunday"]);
    expect(recommendRestDays(5, "bodybuilding")).toEqual(["Wednesday", "Sunday"]);
    expect(recommendRestDays(6, "strength")).toEqual(["Sunday"]);
  });

  it("never rests on the long-run day for running goals", () => {
    for (const goal of ["endurance", "hybrid"] as const) {
      for (const days of TRAINING_DAY_OPTIONS) {
        const rest = recommendRestDays(days, goal);
        expect(rest).toHaveLength(7 - days);
        expect(rest).not.toContain("Saturday");
      }
    }
    expect(recommendRestDays(4, "strength")).toContain("Saturday");
  });
});

describe("v19 defaults", () => {
  it("keeps v19's cardio preference per goal and turns intervals on for non-beginner runners", () => {
    expect(BUILDER_GOALS.map(recommendCardioPreference)).toEqual(["none", "light", "high", "light", "moderate"]);
    expect(goalUsesRunning("hybrid")).toBe(true);
    expect(goalUsesRunning("strength")).toBe(false);
    expect(includesIntervals(input("endurance", 5))).toBe(true);
    expect(includesIntervals(input("hybrid", 5, "advanced"))).toBe(true);
    expect(includesIntervals(input("endurance", 5, "beginner"))).toBe(false);
    expect(includesIntervals(input("strength", 5))).toBe(false);
  });
});

describe("buildSchedule", () => {
  it("produces the right number of training and rest days (ported)", () => {
    const schedule = buildSchedule(input("basic_fitness", 3));
    expect(WEEKDAYS.filter((d) => schedule[d] !== "rest")).toHaveLength(3);
  });

  it("keeps heavy lower-body work off the day before the long run (ported)", () => {
    for (const days of TRAINING_DAY_OPTIONS) {
      const schedule = buildSchedule(input("hybrid", days));
      expect(schedule.Saturday).toBe("long_run");
      expect(["lower", "legs", "squat", "deadlift", "full_body"]).not.toContain(schedule.Friday);
    }
  });

  it("swaps days to remove back-to-back hard sessions where it can", () => {
    const schedule = buildSchedule(input("endurance", 6));
    expect(scoreSchedule(schedule, true)).toBe(0);
  });
});

describe("scoreSchedule / roleIntensity", () => {
  const rest = Object.fromEntries(WEEKDAYS.map((d) => [d, "rest"])) as Schedule;

  it("penalises heavy legs before the long run, legs before quality runs and hard-hard pairs", () => {
    expect(scoreSchedule({ ...rest, Friday: "lower", Saturday: "long_run" }, false)).toBe(4);
    expect(scoreSchedule({ ...rest, Monday: "full_body", Tuesday: "tempo_run" }, false)).toBe(3);
    expect(scoreSchedule({ ...rest, Monday: "squat", Tuesday: "deadlift" }, false)).toBe(2);
    expect(scoreSchedule({ ...rest, Monday: "squat", Tuesday: "tempo_run" }, false)).toBe(5);
    expect(scoreSchedule({ ...rest, Monday: "squat", Wednesday: "deadlift" }, false)).toBe(0);
  });

  it("rates quality runs hard only when intervals are on", () => {
    expect(roleIntensity("quality_run", true)).toBe("hard");
    expect(roleIntensity("quality_run", false)).toBe("moderate");
    expect(roleIntensity("active_recovery", false)).toBe("recovery");
    expect(roleIntensity("easy_run", false)).toBe("easy");
    expect(roleIntensity("upper", false)).toBe("moderate");
  });
});

describe("coerceBuilderInput", () => {
  it("accepts the four answers and an optional finite seed", () => {
    expect(coerceBuilderInput({ goal: "strength", daysPerWeek: 4, equipment: "dumbbells", experience: "advanced", extra: 1 }))
      .toEqual({ goal: "strength", daysPerWeek: 4, equipment: "dumbbells", experience: "advanced" });
    expect(coerceBuilderInput({ goal: "strength", daysPerWeek: 4, equipment: "dumbbells", experience: "advanced", seed: 3 })?.seed).toBe(3);
    expect(coerceBuilderInput({ goal: "strength", daysPerWeek: 4, equipment: "dumbbells", experience: "advanced", seed: Infinity })?.seed).toBeUndefined();
  });

  it("rejects anything else, including v19's dropped options", () => {
    for (const raw of [null, "strength", { goal: "fat_loss", daysPerWeek: 4, equipment: "full_gym", experience: "beginner" },
      { goal: "strength", daysPerWeek: "4", equipment: "full_gym", experience: "beginner" },
      { goal: "strength", daysPerWeek: 4, equipment: "mixed", experience: "beginner" },
      { goal: "strength", daysPerWeek: 4, equipment: "full_gym", experience: "expert" }]) {
      expect(coerceBuilderInput(raw)).toBeNull();
    }
  });
});
