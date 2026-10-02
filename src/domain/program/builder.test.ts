import { describe, expect, it } from "vitest";
import { WEEKDAYS } from "../dates";
import { assertGeneratedWeek, buildProgram } from "./builder";
import { EQUIPMENT_ALLOW, getExercise } from "./library";
import { restDay, BUILDER_GOALS, EQUIPMENT_MODES, EXPERIENCE_LEVELS, TRAINING_DAY_OPTIONS, type BuilderInput, type ProgramWeek } from "./types";
import { validateWeek } from "./validate";

const totalSets = (week: ProgramWeek) => WEEKDAYS.reduce((n, d) => n + week[d].lifting.reduce((s, l) => s + l.sets, 0), 0);
const codes = (week: ProgramWeek) => WEEKDAYS.map((d) => week[d].code);

const ALL_INPUTS: BuilderInput[] = BUILDER_GOALS.flatMap((goal) =>
  TRAINING_DAY_OPTIONS.flatMap((daysPerWeek) =>
    EQUIPMENT_MODES.flatMap((equipment) => EXPERIENCE_LEVELS.map((experience) => ({ goal, daysPerWeek, equipment, experience }))),
  ),
);

describe("buildProgram — every input combination", () => {
  it("covers goal × days × equipment × experience", () => {
    expect(ALL_INPUTS).toHaveLength(5 * 5 * 3 * 3);
  });

  it.each([0, 1, 2, 7, -3])("with seed %i: valid, library-only, equipment-true, exact training days", (seed) => {
    for (const base of ALL_INPUTS) {
      const input = { ...base, seed };
      const week = buildProgram(input);
      const label = JSON.stringify(input);
      const result = validateWeek(week, { requireLibraryIds: true, equipment: input.equipment });
      expect(result.errors, label).toEqual([]);
      expect(WEEKDAYS.filter((d) => !week[d].rest), label).toHaveLength(input.daysPerWeek);
      for (const d of WEEKDAYS) {
        for (const lift of week[d].lifting) {
          const entry = getExercise(lift.libraryId ?? "");
          expect(entry, `${label} ${lift.name}`).toBeDefined();
          expect(lift.id).toBe(lift.libraryId);
          expect(lift.trackingMode).toBe(entry?.trackingMode);
          expect(EQUIPMENT_ALLOW[input.equipment]).toContain(entry?.equipment);
          expect(entry?.specialty, lift.name).toBeFalsy();
        }
        if (week[d].rest) expect(week[d]).toEqual(restDay());
      }
    }
  });

  it("is deterministic for the same input and seed", () => {
    for (const input of ALL_INPUTS) {
      expect(buildProgram({ ...input, seed: 4 })).toEqual(buildProgram({ ...input, seed: 4 }));
    }
  });

  it("bodyweight plans contain only bodyweight movements", () => {
    for (const input of ALL_INPUTS.filter((i) => i.equipment === "bodyweight")) {
      const week = buildProgram(input);
      const equipment = WEEKDAYS.flatMap((d) => week[d].lifting.map((l) => getExercise(l.libraryId ?? "")?.equipment));
      expect(new Set(equipment)).toEqual(new Set(equipment.length ? ["bodyweight"] : []));
    }
  });
});

describe("buildProgram — goal templates (ported)", () => {
  it("bodybuilding 5-day covers chest / back / legs", () => {
    const week = buildProgram({ goal: "bodybuilding", daysPerWeek: 5, equipment: "full_gym", experience: "intermediate" });
    expect(codes(week)).toEqual(expect.arrayContaining(["CHEST", "BACK", "LEGS", "SHOULDERS", "ARMS"]));
  });

  it("strength 4-day covers squat / bench / deadlift / press focus", () => {
    const week = buildProgram({ goal: "strength", daysPerWeek: 4, equipment: "full_gym", experience: "intermediate" });
    expect(codes(week)).toEqual(expect.arrayContaining(["SQUAT", "BENCH", "DEADLIFT", "PRESS"]));
  });

  it("running goals put the long run on Saturday", () => {
    for (const goal of ["endurance", "hybrid"] as const) {
      for (const daysPerWeek of TRAINING_DAY_OPTIONS) {
        const week = buildProgram({ goal, daysPerWeek, equipment: "full_gym", experience: "intermediate" });
        expect(week.Saturday.cardio?.kind, `${goal} ${daysPerWeek}`).toBe("Long Run");
        expect(week.Saturday.cardio?.km).toBe(12.9); // v19's 8 mi
      }
    }
  });

  it("6-day strength and basic-fitness plans keep an active-recovery day", () => {
    for (const goal of ["strength", "basic_fitness"] as const) {
      const week = buildProgram({ goal, daysPerWeek: 6, equipment: "full_gym", experience: "intermediate" });
      expect(WEEKDAYS.some((d) => week[d].title === "Active Recovery"), goal).toBe(true);
    }
  });

  it("beginners get less volume than advanced athletes", () => {
    const input = { goal: "bodybuilding", daysPerWeek: 5, equipment: "full_gym" } as const;
    expect(totalSets(buildProgram({ ...input, experience: "beginner" }))).toBeLessThan(totalSets(buildProgram({ ...input, experience: "advanced" })));
  });

  it("names repeated day types A, B…", () => {
    const week = buildProgram({ goal: "bodybuilding", daysPerWeek: 6, equipment: "full_gym", experience: "intermediate" });
    expect(WEEKDAYS.map((d) => week[d].title).filter((t) => t !== "Rest")).toEqual(["Push", "Pull", "Legs", "Push B", "Pull B", "Legs B"]);
  });

  it("a different seed rotates accessories", () => {
    const input = { goal: "bodybuilding", daysPerWeek: 5, equipment: "full_gym", experience: "intermediate" } as const;
    const names = (seed: number) => WEEKDAYS.flatMap((d) => buildProgram({ ...input, seed }).Monday.lifting.map((l) => `${d}:${l.name}`)).join("|");
    expect(names(0)).not.toBe(names(1));
  });

  it("a non-finite seed behaves like seed 0", () => {
    const input = { goal: "hybrid", daysPerWeek: 4, equipment: "dumbbells", experience: "advanced" } as const;
    expect(buildProgram({ ...input, seed: Number.NaN })).toEqual(buildProgram(input));
  });

  it("uses the experience's run distances", () => {
    const easy = (experience: BuilderInput["experience"]) => {
      const week = buildProgram({ goal: "endurance", daysPerWeek: 2, equipment: "full_gym", experience });
      return WEEKDAYS.map((d) => week[d]).find((day) => day.code === "EASY")?.cardio?.km;
    };
    expect([easy("beginner"), easy("intermediate"), easy("advanced")]).toEqual([4.8, 6.4, 8]);
  });
});

describe("buildProgram — v19 bugs fixed", () => {
  it("never repeats a movement within a day (v19 listed Bench Dip twice on bodyweight arm day)", () => {
    for (const input of ALL_INPUTS) {
      const week = buildProgram(input);
      for (const d of WEEKDAYS) {
        const ids = week[d].lifting.map((l) => l.libraryId);
        expect(new Set(ids).size, `${JSON.stringify(input)} ${d}`).toBe(ids.length);
      }
    }
  });

  it("timed holds keep their own target instead of the goal's rep count", () => {
    let holds = 0;
    for (const input of ALL_INPUTS) {
      const week = buildProgram(input);
      for (const lift of WEEKDAYS.flatMap((d) => week[d].lifting)) {
        if (lift.trackingMode !== "timed_hold") continue;
        holds += 1;
        expect(lift.reps).toBe(getExercise(lift.libraryId ?? "")?.defaultReps);
      }
    }
    expect(holds).toBeGreaterThan(0);
  });

  it("anchors focus days on the pattern's staple lift, whatever the seed", () => {
    for (const seed of [0, 1, 2, 3, 4, 5]) {
      const week = buildProgram({ goal: "strength", daysPerWeek: 4, equipment: "full_gym", experience: "intermediate", seed });
      const first = (code: string) => WEEKDAYS.map((d) => week[d]).find((day) => day.code === code)?.lifting[0];
      expect(first("SQUAT")).toMatchObject({ libraryId: "back-squat", sets: 5, reps: "3" });
      expect(first("BENCH")?.libraryId).toBe("barbell-bench-press");
      expect(first("DEADLIFT")?.libraryId).toBe("conventional-deadlift");
      expect(first("PRESS")?.libraryId).toBe("overhead-press");
    }
    const beginner = buildProgram({ goal: "strength", daysPerWeek: 4, equipment: "full_gym", experience: "beginner" });
    expect(WEEKDAYS.map((d) => beginner[d]).find((day) => day.code === "DEADLIFT")?.lifting[0]?.libraryId).toBe("trap-bar-deadlift");
  });

  it("titles the interval day for what it is (v19 said '+ Core' with no core work)", () => {
    const titles = new Set<string>();
    for (const seed of [0, 1]) {
      const week = buildProgram({ goal: "endurance", daysPerWeek: 5, equipment: "full_gym", experience: "advanced", seed });
      const quality = WEEKDAYS.map((d) => week[d]).find((day) => day.code === "QUALITY");
      expect(quality?.lifting).toEqual([]);
      titles.add(quality?.title ?? "");
    }
    expect(titles).toEqual(new Set(["Intervals", "Hill Repeats"]));
  });

  it("beginner runners get a tempo run, not intervals", () => {
    const week = buildProgram({ goal: "endurance", daysPerWeek: 5, equipment: "full_gym", experience: "beginner" });
    expect(WEEKDAYS.map((d) => week[d]).find((day) => day.code === "QUALITY")?.title).toBe("Tempo Run");
  });
});

describe("buildProgram — guards", () => {
  it("rejects input outside the four answers", () => {
    expect(() => buildProgram({ goal: "fat_loss", daysPerWeek: 4, equipment: "full_gym", experience: "beginner" } as unknown as BuilderInput)).toThrow(RangeError);
    expect(() => buildProgram({ goal: "strength", daysPerWeek: 7, equipment: "full_gym", experience: "beginner" } as unknown as BuilderInput)).toThrow(RangeError);
  });

  it("assertGeneratedWeek throws on a week that breaks validation or the day count", () => {
    const input: BuilderInput = { goal: "strength", daysPerWeek: 4, equipment: "bodyweight", experience: "beginner" };
    const good = buildProgram(input);
    expect(assertGeneratedWeek(good, input)).toBe(good);
    expect(() => assertGeneratedWeek({ ...good, Monday: restDay() }, input)).toThrow(/Expected 4 training days/);
    const barbell = { ...good, Monday: { ...good.Monday, lifting: [{ id: "back-squat", name: "Back Squat", libraryId: "back-squat", sets: 3, reps: "5", trackingMode: "loaded_reps" as const }] } };
    expect(() => assertGeneratedWeek(barbell, input)).toThrow(/needs barbell equipment/);
  });
});
