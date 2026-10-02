import { describe, it, expect } from "vitest";
import {
  PROGRAM_BUILDER_GOALS,
  PROGRAM_BUILDER_GOAL_IDS,
  TRAINING_DAY_OPTIONS,
  REST_DAY_OPTIONS,
  EQUIPMENT_OPTIONS,
  EXPERIENCE_LEVELS,
  SESSION_LENGTH_OPTIONS,
  CARDIO_PREFERENCES,
  DAYS,
  normalizeProgramBuilderInput,
  recommendTrainingDaysForGoal,
  recommendRestDays,
  mapOnboardingGoalToBuilderGoal,
  buildWeeklySchedule,
  buildProgramPlan,
  buildWeekVariant,
  buildMultiWeekProgram,
  summarizeGeneratedPlan,
  validateGeneratedProgram,
  buildProgramBuilderSettingsPatch,
} from "../programBuilder";


function totalSets(program) {
  return DAYS.reduce((sum, d) => sum + (program[d].lifting || []).reduce((s, l) => s + l.sets, 0), 0);
}

describe("catalogs", () => {
  it("exposes the six goals", () => {
    expect(PROGRAM_BUILDER_GOAL_IDS).toEqual([
      "basic_fitness", "bodybuilding", "strength", "endurance", "hybrid", "fat_loss",
    ]);
    for (const g of PROGRAM_BUILDER_GOALS) {
      expect(typeof g.label).toBe("string");
      expect(typeof g.desc).toBe("string");
    }
  });

  it("exposes training/equipment/experience/session/cardio option lists", () => {
    expect(TRAINING_DAY_OPTIONS).toEqual([2, 3, 4, 5, 6]);
    expect(REST_DAY_OPTIONS).toEqual(DAYS);
    expect(EQUIPMENT_OPTIONS.map((e) => e.id)).toEqual(["full_gym", "dumbbells", "bodyweight", "mixed"]);
    expect(EXPERIENCE_LEVELS.map((e) => e.id)).toEqual(["beginner", "intermediate", "advanced"]);
    expect(SESSION_LENGTH_OPTIONS).toEqual([30, 45, 60, 75]);
    expect(CARDIO_PREFERENCES.map((c) => c.id)).toEqual(["none", "light", "moderate", "high"]);
  });

  it("maps onboarding goals to builder goals", () => {
    expect(mapOnboardingGoalToBuilderGoal("muscle")).toBe("bodybuilding");
    expect(mapOnboardingGoalToBuilderGoal("strength")).toBe("strength");
    expect(mapOnboardingGoalToBuilderGoal("endurance")).toBe("endurance");
    expect(mapOnboardingGoalToBuilderGoal("fat_loss")).toBe("fat_loss");
    expect(mapOnboardingGoalToBuilderGoal("hybrid")).toBe("hybrid");
    expect(mapOnboardingGoalToBuilderGoal("nonsense")).toBe("hybrid");
  });
});

describe("normalizeProgramBuilderInput", () => {
  it("defaults missing fields to a coherent shape", () => {
    const n = normalizeProgramBuilderInput({});
    expect(PROGRAM_BUILDER_GOAL_IDS).toContain(n.goal);
    expect(TRAINING_DAY_OPTIONS).toContain(n.trainingDaysPerWeek);
    expect(n.equipment).toBe("full_gym");
    expect(n.experience).toBe("intermediate");
    expect(n.sessionLength).toBe(60);
    expect(Array.isArray(n.restDays)).toBe(true);
  });

  it("clamps invalid training-day counts and dedupes rest days", () => {
    const n = normalizeProgramBuilderInput({ goal: "strength", trainingDaysPerWeek: 99, restDays: ["Sunday", "Sunday", "Bogus"] });
    expect(TRAINING_DAY_OPTIONS).toContain(n.trainingDaysPerWeek);
    // exactly 7 - training rest days, all real
    expect(n.restDays.length).toBe(7 - n.trainingDaysPerWeek);
    for (const d of n.restDays) expect(DAYS).toContain(d);
  });

  it("defaults the long-run day for running goals and leaves it null otherwise", () => {
    expect(normalizeProgramBuilderInput({ goal: "endurance" }).longRunDay).toBeTruthy();
    expect(normalizeProgramBuilderInput({ goal: "hybrid" }).longRunDay).toBeTruthy();
    expect(normalizeProgramBuilderInput({ goal: "bodybuilding" }).longRunDay).toBeNull();
  });

  it("recommends sensible training days and rest days", () => {
    expect(recommendTrainingDaysForGoal("bodybuilding")).toBe(5);
    const rest = recommendRestDays({ trainingDaysPerWeek: 3, goal: "basic_fitness" });
    expect(rest.length).toBe(4);
  });
});

describe("buildWeeklySchedule", () => {
  it("honors selected rest days", () => {
    const schedule = buildWeeklySchedule({ goal: "bodybuilding", trainingDaysPerWeek: 5, restDays: ["Wednesday", "Sunday"] });
    expect(schedule.Wednesday).toBe("rest");
    expect(schedule.Sunday).toBe("rest");
  });

  it("produces the right number of training vs rest days", () => {
    const schedule = buildWeeklySchedule({ goal: "basic_fitness", trainingDaysPerWeek: 3 });
    const training = DAYS.filter((d) => schedule[d] !== "rest");
    expect(training.length).toBe(3);
    expect(DAYS.length - training.length).toBe(4);
  });

  it("places the long run on the chosen day", () => {
    const schedule = buildWeeklySchedule({ goal: "endurance", trainingDaysPerWeek: 5, longRunDay: "Sunday", restDays: [] });
    expect(schedule.Sunday).toBe("long_run");
  });

  it("hybrid avoids heavy lower-body immediately before the long run", () => {
    const schedule = buildWeeklySchedule({ goal: "hybrid", trainingDaysPerWeek: 6, longRunDay: "Sunday", restDays: [] });
    const lrIndex = DAYS.indexOf("Sunday");
    const before = DAYS[lrIndex - 1];
    if (schedule[before] && schedule[before] !== "rest") {
      expect(["lower", "legs", "squat", "deadlift"]).not.toContain(schedule[before]);
    }
  });
});

describe("buildProgramPlan — shape + goal templates", () => {
  const goals = ["basic_fitness", "bodybuilding", "strength", "endurance", "hybrid", "fat_loss"];

  it("every generated program passes validation for every goal and day count", () => {
    for (const goal of goals) {
      for (const days of TRAINING_DAY_OPTIONS) {
        const plan = buildProgramPlan({ goal, trainingDaysPerWeek: days });
        const res = validateGeneratedProgram(plan.program);
        expect(res.valid, `${goal} ${days}d: ${res.errors.join("; ")}`).toBe(true);
        // exactly 7 days, each with the full shape
        expect(Object.keys(plan.program).sort()).toEqual([...DAYS].sort());
        for (const d of DAYS) {
          const day = plan.program[d];
          expect(day).toHaveProperty("type");
          expect(day).toHaveProperty("code");
          expect(Array.isArray(day.lifting)).toBe(true);
          expect(day.cardio === null || typeof day.cardio === "object").toBe(true);
        }
      }
    }
  });

  it("rest days have empty lifting and null cardio", () => {
    const plan = buildProgramPlan({ goal: "strength", trainingDaysPerWeek: 4, restDays: ["Wednesday", "Sunday"] });
    for (const d of ["Wednesday", "Sunday"]) {
      expect(plan.program[d].lifting).toEqual([]);
      expect(plan.program[d].cardio).toBeNull();
    }
  });

  it("respects the selected training-day count in the output", () => {
    const plan = buildProgramPlan({ goal: "bodybuilding", trainingDaysPerWeek: 5, restDays: ["Wednesday", "Sunday"] });
    const training = DAYS.filter((d) => (plan.program[d].lifting.length > 0) || plan.program[d].cardio);
    expect(training.length).toBe(5);
  });

  it("bodybuilding 5-day covers chest / back / legs variety", () => {
    const plan = buildProgramPlan({ goal: "bodybuilding", trainingDaysPerWeek: 5 });
    const codes = DAYS.map((d) => plan.program[d].code);
    expect(codes).toContain("CHEST");
    expect(codes).toContain("BACK");
    expect(codes).toContain("LEGS");
  });

  it("strength 4-day covers squat / bench / deadlift / press focus", () => {
    const plan = buildProgramPlan({ goal: "strength", trainingDaysPerWeek: 4 });
    const codes = DAYS.map((d) => plan.program[d].code);
    expect(codes).toContain("SQUAT");
    expect(codes).toContain("BENCH");
    expect(codes).toContain("DEADLIFT");
    expect(codes).toContain("PRESS");
  });

  it("running plan includes a long run on the selected day", () => {
    const plan = buildProgramPlan({ goal: "endurance", trainingDaysPerWeek: 4, longRunDay: "Saturday", restDays: [] });
    expect(plan.program.Saturday.cardio?.type).toBe("Long Run");
  });

  it("6-day plans include at least one low-intensity / active-recovery session", () => {
    for (const goal of ["strength", "basic_fitness"]) {
      const plan = buildProgramPlan({ goal, trainingDaysPerWeek: 6 });
      const hasRecovery = DAYS.some((d) => /Active Recovery|Recovery/i.test(plan.program[d].type));
      expect(hasRecovery, `${goal} 6d`).toBe(true);
    }
  });

  it("beginner runs lower volume than advanced for the same goal", () => {
    const beg = buildProgramPlan({ goal: "bodybuilding", trainingDaysPerWeek: 5, experience: "beginner" });
    const adv = buildProgramPlan({ goal: "bodybuilding", trainingDaysPerWeek: 5, experience: "advanced" });
    expect(totalSets(beg.program)).toBeLessThan(totalSets(adv.program));
  });

  it("attaches rationale and warnings arrays", () => {
    const plan = buildProgramPlan({ goal: "hybrid", trainingDaysPerWeek: 5 });
    expect(Array.isArray(plan.rationale)).toBe(true);
    expect(plan.rationale.length).toBeGreaterThan(0);
    expect(Array.isArray(plan.warnings)).toBe(true);
  });
});

describe("multi-week variation", () => {
  it("returns four weeks with week 4 as a deload", () => {
    const weeks = buildMultiWeekProgram({ goal: "hybrid", trainingDaysPerWeek: 5 }, 4);
    expect(weeks).toHaveLength(4);
    expect(weeks[3].isDeload).toBe(true);
    // deload week has strictly lower total volume than the base week
    expect(totalSets(weeks[3].program)).toBeLessThan(totalSets(weeks[0].program));
  });

  it("week 2 varies at least some accessory/cardio selection vs week 1", () => {
    const w1 = buildWeekVariant({ goal: "bodybuilding", trainingDaysPerWeek: 5 }, 0);
    const w2 = buildWeekVariant({ goal: "bodybuilding", trainingDaysPerWeek: 5 }, 1);
    const names1 = DAYS.flatMap((d) => w1.program[d].lifting.map((l) => l.name)).join("|");
    const names2 = DAYS.flatMap((d) => w2.program[d].lifting.map((l) => l.name)).join("|");
    expect(names1).not.toBe(names2);
  });

  it("every week validates", () => {
    const weeks = buildMultiWeekProgram({ goal: "strength", trainingDaysPerWeek: 5 }, 4);
    for (const w of weeks) expect(validateGeneratedProgram(w.program).valid).toBe(true);
  });
});

describe("summary + validation + settings patch", () => {
  it("summarizeGeneratedPlan reports counts and per-day labels", () => {
    const plan = buildProgramPlan({ goal: "hybrid", trainingDaysPerWeek: 5 });
    const s = summarizeGeneratedPlan(plan);
    expect(s.trainingDays).toBe(5);
    expect(s.days).toHaveLength(7);
    expect(typeof s.headline).toBe("string");
    expect(s.totalWeeklySets).toBeGreaterThan(0);
  });

  it("validateGeneratedProgram rejects a broken program", () => {
    const bad = { Monday: { type: "x", code: "y", lifting: "nope", cardio: null } };
    expect(validateGeneratedProgram(bad).valid).toBe(false);
    expect(validateGeneratedProgram(null).valid).toBe(false);
  });

  it("buildProgramBuilderSettingsPatch only returns the programBuilder key", () => {
    const plan = buildProgramPlan({ goal: "strength", trainingDaysPerWeek: 4, generatedAt: "2026-07-01T00:00:00.000Z" });
    const patch = buildProgramBuilderSettingsPatch(plan.input, plan);
    expect(Object.keys(patch)).toEqual(["programBuilder"]);
    expect(patch.programBuilder.goal).toBe("strength");
    expect(patch.programBuilder.trainingDaysPerWeek).toBe(4);
    expect(patch.programBuilder.lastGeneratedAt).toBe("2026-07-01T00:00:00.000Z");
  });
});
