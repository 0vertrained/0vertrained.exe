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


import { findLibraryExercise } from "../programExerciseLibrary";
import { mapExerciseToMuscles } from "../muscleVolume";
import { runSchedule } from "../watch/runWorkouts";
import { timeBasedCardioPlan } from "../cardioSession";

function totalSets(program) {
  return DAYS.reduce((sum, d) => sum + (program[d].lifting || []).reduce((s, l) => s + l.sets, 0), 0);
}

describe("catalogs", () => {
  it("exposes lifting, endurance and cardio-only goals", () => {
    expect(PROGRAM_BUILDER_GOAL_IDS).toEqual([
      "basic_fitness", "bodybuilding", "strength", "endurance", "hybrid", "cardio_only", "fat_loss",
    ]);
    for (const g of PROGRAM_BUILDER_GOALS) {
      expect(typeof g.label).toBe("string");
      expect(typeof g.desc).toBe("string");
    }
  });

  it("exposes training/equipment/experience/session/cardio option lists", () => {
    expect(TRAINING_DAY_OPTIONS).toEqual([2, 3, 4, 5, 6]);
    expect(REST_DAY_OPTIONS).toEqual(DAYS);
    expect(EQUIPMENT_OPTIONS.map((e) => e.id)).toEqual(["full_gym", "dumbbells", "barbell", "free_weights", "bodyweight", "calisthenics", "machines", "mixed"]);
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
    expect(recommendTrainingDaysForGoal("bodybuilding")).toBe(4);
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
  const goals = PROGRAM_BUILDER_GOAL_IDS;

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

  it("five-day hypertrophy distributes upper and lower work across the week", () => {
    const plan = buildProgramPlan({ goal: "bodybuilding", trainingDaysPerWeek: 5 });
    const codes = DAYS.map((d) => plan.program[d].code);
    expect(codes.filter(code => code.startsWith("UPPER"))).toHaveLength(3);
    expect(codes.filter(code => code.startsWith("LOWER"))).toHaveLength(2);
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
    const weeks = buildMultiWeekProgram({ goal: "hybrid", trainingDaysPerWeek: 5, adaptiveTraining: false }, 4);
    expect(weeks).toHaveLength(4);
    expect(weeks[3].isDeload).toBe(true);
    // deload week has strictly lower total volume than the base week
    expect(totalSets(weeks[3].program)).toBeLessThan(totalSets(weeks[0].program));
  });

  it("week 2 varies at least some accessory/cardio selection vs week 1", () => {
    const w1 = buildWeekVariant({ goal: "bodybuilding", trainingDaysPerWeek: 5, adaptiveTraining: false }, 0);
    const w2 = buildWeekVariant({ goal: "bodybuilding", trainingDaysPerWeek: 5, adaptiveTraining: false }, 1);
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

describe("research-based custom weeks", () => {
  it("carries the reference hypertrophy dose into a four-day gym week", () => {
    const plan = buildProgramPlan({ goal: "bodybuilding", trainingDaysPerWeek: 4, sessionLength: 60 });
    const sets = {};
    for (const day of Object.values(plan.program)) {
      for (const lift of day.lifting) {
        for (const muscle of mapExerciseToMuscles(lift.name).primary) sets[muscle] = (sets[muscle] || 0) + lift.sets;
        expect(lift.repMin).toBeLessThanOrEqual(lift.reps);
        expect(lift).toMatchObject({ rir: expect.any(Number), progressionExposures: 2 });
        expect(lift.restSeconds).toBeGreaterThanOrEqual(60);
      }
    }
    expect(sets).toMatchObject({ chest: 10, back: 10, quads: 10, hamstrings: 8 });
    expect(plan.metadata.guideId).toBe("upperLowerGrowth");
  });

  it("preserves explicit weekdays even when the requested long-run day conflicts", () => {
    const plan = buildProgramPlan({ goal: "hybrid", trainingDaysPerWeek: 3, longRunDay: "Saturday",
      restDays: ["Monday", "Wednesday", "Friday", "Saturday"] });
    expect(DAYS.filter(d => plan.program[d].code !== "REST")).toEqual(["Tuesday", "Thursday", "Sunday"]);
    expect(plan.program.Sunday.type).toBe("Long Run");
  });

  it("keeps matched weeks stable for adaptive comparisons and stores the opt-out", () => {
    const [base, ...later] = buildMultiWeekProgram({ goal: "strength", trainingDaysPerWeek: 3 });
    for (const week of later) {
      expect(week.isDeload).toBe(false);
      expect(week.program).toEqual(base.program);
    }
    const { program } = buildProgramPlan({ goal: "strength", trainingDaysPerWeek: 3, adaptiveTraining: false });
    expect(DAYS.every(day => !program[day].adaptivePlan)).toBe(true);
    expect(buildProgramBuilderSettingsPatch({ adaptiveTraining: false }).programBuilder.adaptiveTraining).toBe(false);
    const mainLifts = DAYS.flatMap(d => base.program[d].lifting.slice(0, 1));
    expect(mainLifts.map(l => l.name)).toEqual(["Back Squat", "Conventional Deadlift", "Barbell Bench Press"]);
    expect(mainLifts.every(l => l.repMin === 3 && l.reps === 5 && l.restSeconds === 180)).toBe(true);
  });

  it("keeps all gear, movement names, time budgets and selected day counts achievable", () => {
    for (const goal of PROGRAM_BUILDER_GOAL_IDS) {
      for (const equipment of EQUIPMENT_OPTIONS.map(e => e.id)) {
        for (const days of TRAINING_DAY_OPTIONS) {
          const plan = buildProgramPlan({ goal, equipment, trainingDaysPerWeek: days, sessionLength: 30, experience: "beginner" });
          expect(summarizeGeneratedPlan(plan).trainingDays, [goal, equipment, days].join(" ")).toBe(days);
          for (const day of Object.values(plan.program)) {
            if (day.adaptivePlan) expect(day.adaptivePlan.estimatedMinutes).toBeLessThanOrEqual(30);
            expect(day.cardio?.minutes || 0).toBeLessThanOrEqual(30);
            const names = day.lifting.map(l => l.name);
            expect(new Set(names).size).toBe(names.length);
            for (const lift of day.lifting) {
              expect(findLibraryExercise(lift.name).difficulty).toBe("beginner");
              if (equipment === "machines") expect(["machine", "selectorized", "plate_loaded", "cable"]).toContain(findLibraryExercise(lift.name).equipment);
              if (equipment === "bodyweight") expect(lift.name).not.toMatch(/hanging|inverted|pull-up|chin-up|nordic|dip|incline|decline|sliding/i);
            }
          }
        }
      }
    }
  });

  it("selects only the available combination and never assumes a rack with a bare bar", () => {
    function movements(equipment, equipmentChoices) {
      const plan = buildProgramPlan({ goal: "strength", trainingDaysPerWeek: 4, equipment, equipmentChoices, experience: "advanced" });
      return DAYS.flatMap(day => plan.program[day].lifting);
    }
    const bareBar = movements("barbell");
    expect(bareBar.map(lift => lift.name)).toContain("Conventional Deadlift");
    for (const lift of bareBar) {
      expect(["barbell", "plate", "bodyweight"]).toContain(findLibraryExercise(lift.name).equipment);
      expect(lift.name).not.toMatch(/bench|incline|front squat|back squat|trap bar|landmine/i);
    }
    const beginner = buildProgramPlan({ goal: "bodybuilding", experience: "beginner", equipment: "barbell", trainingDaysPerWeek: 2 });
    const starterLifts = Object.values(beginner.program).flatMap(d => d.lifting.map(l => l.name));
    expect(starterLifts).toEqual(expect.arrayContaining(["Plate Squat", "Barbell Glute Bridge"]));
    const custom = movements("mixed", ["dumbbells", "calisthenics"]);
    expect(custom.some(lift => findLibraryExercise(lift.name).equipment === "dumbbell")).toBe(true);
    expect(custom.every(lift => ["dumbbell", "bodyweight"].includes(findLibraryExercise(lift.name).equipment))).toBe(true);
    expect(movements("mixed", []).every(lift => findLibraryExercise(lift.name).equipment === "bodyweight")).toBe(true);
  });

  it("uses loadable presses, rows and hinges on every short bodybuilding day with dumbbells and a bare bar", () => {
    const { program } = buildProgramPlan({ goal: "bodybuilding", experience: "intermediate", trainingDaysPerWeek: 3,
      restDays: ["Monday", "Wednesday", "Thursday", "Saturday"], equipment: "mixed", equipmentChoices: ["dumbbells", "barbell"], sessionLength: 30 });
    for (const day of ["Tuesday", "Friday", "Sunday"]) {
      const entries = program[day].lifting.map(lift => findLibraryExercise(lift.name));
      for (const pattern of ["squat", "horizontalPush", "horizontalPull", "hinge"]) {
        const lift = entries.find(e => e.pattern === pattern);
        expect(lift, day + " " + pattern).toBeDefined();
        expect(["barbell", "plate", "dumbbell"]).toContain(lift.equipment);
      }
    }
  });

  it("preserves knee, hinge, press and pull across two- and three-day growth weeks within the shortest time budget", () => {
    for (const days of [2, 3]) for (const { id: equipment } of EQUIPMENT_OPTIONS) {
      for (const experience of ["beginner", "intermediate", "advanced"]) for (const cardioPreference of ["none", "high"]) {
        const { program } = buildProgramPlan({ goal: "bodybuilding", equipment, experience, sessionLength: 30,
          cardioPreference, trainingDaysPerWeek: days });
        const moves = Object.values(program).flatMap(day => day.lifting.map(lift => findLibraryExercise(lift.name).pattern));
        expect(moves, [days, equipment, experience, cardioPreference].join(" ")).toEqual(expect.arrayContaining(["squat", "hinge", "horizontalPush", "horizontalPull"]));
      }
    }
  });

  it("uses the athlete’s available cardio modality and actual elapsed time", () => {
    const plan = buildProgramPlan({ goal: "cardio_only", cardioModality: "row", sessionLength: 30, trainingDaysPerWeek: 4, includeIntervals: true });
    const active = Object.values(plan.program).filter(day => day.cardio);
    expect(active).toHaveLength(4);
    expect(active.every(d => !d.lifting.length && d.cardio.modality === "row" && d.cardio.minutes === 30)).toBe(true);
    expect(active.filter(d => d.code === "QUALITY")).toHaveLength(1);
    expect(active.find(d => d.code === "QUALITY").cardio.steps[1]).toMatchObject({ reps: 3, work: { minutes: 4 } });
    const now = new Date("2026-11-23T10:00:00");
    expect(runSchedule(plan.program, "2026-11-23", { days: 7, now }).map(workout => workout.activity)).toEqual(Array(4).fill("row"));
    const runs = buildProgramPlan({ goal: "cardio_only", cardioModality: "run", sessionLength: 30, trainingDaysPerWeek: 4, includeIntervals: true });
    const workouts = runSchedule(runs.program, "2026-11-23", { days: 7, now });
    expect(workouts).toHaveLength(4);
    const quality = workouts.find(run => run.warmup);
    expect(quality.warmup.goal.seconds + quality.cooldown.goal.seconds + quality.blocks.reduce((sec, block) =>
      sec + block.iterations * block.steps.reduce((sum, step) => sum + step.goal.seconds, 0), 0)).toBe(1800);
    expect(timeBasedCardioPlan(active.find(d => d.code === "QUALITY").cardio)).toMatchObject({ rounds: 3, work: 240, rest: 180 });
    const easyWeek = buildProgramPlan({ goal: "cardio_only", equipment: "bodyweight", includeIntervals: false });
    expect(Object.values(easyWeek.program).filter(d => d.cardio).every(d => ["run","walk"].includes(d.cardio.modality) && d.code === "EASY")).toBe(true);
  });
});
