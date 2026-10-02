import { describe, it, expect } from "vitest";
import {
  EXERCISES,
  EXERCISE_LIBRARY,
  MOVEMENT_PATTERNS,
  CARDIO_SESSIONS,
  CARDIO_KEYS,
  buildCardio,
  cardioIntensity,
  selectExercises,
  isCompoundPattern,
} from "../programExerciseLibrary";

describe("exercise catalog shape", () => {
  it("every exercise has the required fields", () => {
    for (const e of EXERCISES) {
      expect(typeof e.name).toBe("string");
      expect(e.name.length).toBeGreaterThan(0);
      expect(MOVEMENT_PATTERNS).toContain(e.pattern);
      expect(["barbell", "dumbbell", "machine", "cable", "bodyweight"]).toContain(e.equipment);
      expect(["beginner", "intermediate", "advanced"]).toContain(e.difficulty);
      expect(Number.isFinite(e.defaultSets)).toBe(true);
      expect(Number.isFinite(e.defaultReps)).toBe(true);
      expect(typeof e.notes).toBe("string");
      expect(e.notes.length).toBeGreaterThan(0);
      expect(Array.isArray(e.alternatives)).toBe(true);
    }
  });

  it("includes the required movement variety", () => {
    const names = EXERCISES.map((e) => e.name);
    for (const required of [
      "Barbell Bench Press", "Incline DB Press", "Dumbbell Bench Press", "Push-Up", "Weighted Push-Up",
      "Overhead Press", "Seated DB Press", "Pull-Up", "Lat Pulldown", "Barbell Row",
      "Chest-Supported Row", "One-Arm DB Row", "Cable Row",
      "Back Squat", "Front Squat", "Goblet Squat", "Romanian Deadlift", "Conventional Deadlift",
      "Trap Bar Deadlift", "Leg Press", "Bulgarian Split Squat", "Walking Lunge", "Step-Up", "Barbell Hip Thrust",
      "Cable Fly", "Pec Deck", "Lateral Raise", "Rear Delt Fly", "Face Pull", "Shrugs",
      "Hammer Curl", "Triceps Pushdown", "Skull Crusher", "Overhead Triceps Extension",
      "Standing Calf Raise", "Cable Crunch", "Plank", "Dead Bug", "Pallof Press",
    ]) {
      expect(names).toContain(required);
    }
  });

  it("full gym covers every movement pattern", () => {
    for (const pattern of MOVEMENT_PATTERNS) {
      expect(EXERCISE_LIBRARY.full_gym[pattern].length).toBeGreaterThan(0);
    }
  });

  it("dumbbells and bodyweight modes have real fallbacks for the big patterns", () => {
    for (const mode of ["dumbbells", "bodyweight"]) {
      for (const pattern of ["squat", "hinge", "horizontalPush", "horizontalPull", "core"]) {
        expect(EXERCISE_LIBRARY[mode][pattern].length).toBeGreaterThan(0);
      }
    }
  });

  it("no duplicate exercise names within the same pattern", () => {
    const byPattern = {};
    for (const e of EXERCISES) {
      byPattern[e.pattern] = byPattern[e.pattern] || new Set();
      expect(byPattern[e.pattern].has(e.name)).toBe(false);
      byPattern[e.pattern].add(e.name);
    }
  });
});

describe("cardio catalog", () => {
  it("includes all the required session types", () => {
    const types = CARDIO_KEYS.map((k) => CARDIO_SESSIONS[k].type);
    for (const t of ["Easy Run", "Zone 2 Run", "Long Run", "Tempo Run", "Intervals", "Hill Repeats", "Recovery Walk", "Bike Zone 2", "Row Erg Intervals", "Incline Walk"]) {
      expect(types).toContain(t);
    }
  });

  it("buildCardio returns the program cardio shape with overrides", () => {
    const c = buildCardio("long_run", { miles: 9 });
    expect(c).toMatchObject({ type: "Long Run", miles: 9, effort: expect.any(String), notes: expect.any(String) });
    expect(cardioIntensity("intervals")).toBe("hard");
    expect(cardioIntensity("easy_run")).toBe("easy");
  });
});

describe("selectExercises", () => {
  it("respects equipment mode (bodyweight never returns barbell lifts)", () => {
    for (const pattern of MOVEMENT_PATTERNS) {
      const picks = selectExercises(pattern, "bodyweight", "beginner", 2, 0);
      for (const p of picks) expect(p.equipment).toBe("bodyweight");
    }
  });

  it("is deterministic for the same seed and varies with seed", () => {
    const a = selectExercises("horizontalPush", "full_gym", "advanced", 1, 0)[0].name;
    const b = selectExercises("horizontalPush", "full_gym", "advanced", 1, 0)[0].name;
    expect(a).toBe(b);
    const names = new Set();
    for (let s = 0; s < 5; s++) names.add(selectExercises("horizontalPush", "full_gym", "advanced", 1, s)[0].name);
    expect(names.size).toBeGreaterThan(1);
  });

  it("returns the requested count", () => {
    expect(selectExercises("biceps", "full_gym", "intermediate", 3, 0)).toHaveLength(3);
  });

  it("classifies compound vs accessory patterns", () => {
    expect(isCompoundPattern("squat")).toBe(true);
    expect(isCompoundPattern("biceps")).toBe(false);
  });
});
