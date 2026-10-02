import { describe, expect, it } from "vitest";
import { TRACKING_MODES } from "../day/schema";
import { EQUIPMENT, MOVEMENT_PATTERNS, guessMeta } from "../exercise";
import {
  COMPOUND_PATTERNS, DIFFICULTY_RANK, EQUIPMENT_ALLOW, LIBRARY,
  getExercise, isCompoundPattern, metaFor, resolveExercise, selectExercises,
} from "./library";
import { normalizeName } from "./aliases";

// The 64 movements of v19's EXERCISES (src/programExerciseLibrary.js @ c955d5a).
const V19_NAMES = [
  "Back Squat", "Front Squat", "Goblet Squat", "Leg Press", "Hack Squat", "Bodyweight Squat",
  "Conventional Deadlift", "Trap Bar Deadlift", "Romanian Deadlift", "DB Romanian Deadlift", "Barbell Hip Thrust", "Glute Bridge",
  "Bulgarian Split Squat", "Walking Lunge", "Step-Up", "Reverse Lunge",
  "Barbell Bench Press", "Dumbbell Bench Press", "Incline DB Press", "Push-Up", "Weighted Push-Up",
  "Overhead Press", "Seated DB Press", "Pike Push-Up",
  "Barbell Row", "Chest-Supported Row", "One-Arm DB Row", "Cable Row", "Inverted Row",
  "Pull-Up", "Lat Pulldown", "Assisted Pull-Up",
  "Cable Fly", "Pec Deck", "DB Fly", "Face Pull", "Straight-Arm Pulldown", "Shrugs",
  "Lateral Raise", "Cable Lateral Raise", "Rear Delt Fly", "Reverse Pec Deck",
  "EZ Bar Curl", "Incline DB Curl", "Hammer Curl", "Cable Curl",
  "Triceps Pushdown", "Skull Crusher", "Overhead Triceps Extension", "Bench Dip",
  "Leg Extension", "Lying Leg Curl", "Seated Leg Curl",
  "Standing Calf Raise", "Seated Calf Raise", "DB Calf Raise", "Bodyweight Calf Raise",
  "Sissy Squat", "Single-Leg Glute Bridge",
  "Plank", "Dead Bug", "Pallof Press", "Cable Crunch", "Hanging Leg Raise",
];

const byId = (id: string) => {
  const e = getExercise(id);
  if (!e) throw new Error(id);
  return e;
};

describe("catalog shape", () => {
  it("keeps all 64 v19 movements under their names and adds 35", () => {
    expect(V19_NAMES).toHaveLength(64);
    const names = LIBRARY.map((e) => e.name);
    for (const name of V19_NAMES) expect(names).toContain(name);
    expect(LIBRARY).toHaveLength(64 + 35);
  });

  it("gives every entry complete, valid fields", () => {
    for (const e of LIBRARY) {
      expect(e.id, e.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(MOVEMENT_PATTERNS).toContain(e.pattern);
      expect(EQUIPMENT).toContain(e.equipment);
      expect(Object.keys(DIFFICULTY_RANK)).toContain(e.difficulty);
      expect(TRACKING_MODES).toContain(e.trackingMode);
      expect(typeof e.isBarbell).toBe("boolean");
      expect(Number.isInteger(e.defaultSets) && e.defaultSets > 0).toBe(true);
      expect(e.defaultReps).toMatch(/^\d+$/);
      expect(e.notes.length).toBeGreaterThan(10);
    }
  });

  it("has unique ids and names (after normalization)", () => {
    expect(new Set(LIBRARY.map((e) => e.id)).size).toBe(LIBRARY.length);
    expect(new Set(LIBRARY.map((e) => normalizeName(e.name))).size).toBe(LIBRARY.length);
  });

  it("covers every pattern in a full gym and the big patterns with dumbbells or bodyweight", () => {
    for (const pattern of MOVEMENT_PATTERNS) expect(selectExercises(pattern).length, pattern).toBeGreaterThan(0);
    for (const equipment of ["dumbbells", "bodyweight"] as const) {
      for (const pattern of ["squat", "hinge", "singleLeg", "horizontalPush", "verticalPush", "horizontalPull", "verticalPull", "core"] as const) {
        expect(selectExercises(pattern, { equipment }).length, `${equipment} ${pattern}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("catalog metadata", () => {
  it("flags only straight, plate-loaded bars as barbell lifts", () => {
    const barbell = LIBRARY.filter((e) => e.isBarbell).map((e) => e.id).sort();
    expect(barbell).toEqual([
      "back-squat", "barbell-bench-press", "barbell-curl", "barbell-hip-thrust", "barbell-row", "close-grip-bench-press",
      "conventional-deadlift", "deficit-deadlift", "front-squat", "overhead-press", "power-clean", "push-press",
      "rack-pull", "romanian-deadlift",
    ]);
    for (const id of ["trap-bar-deadlift", "ez-bar-curl", "skull-crusher", "incline-smith-press", "t-bar-row"]) expect(byId(id).isBarbell, id).toBe(false);
  });

  it("uses big load jumps for deadlifts, squats, leg press, hack squat, hip thrust and calf raises", () => {
    const large = LIBRARY.filter((e) => e.largeIncrement).map((e) => e.id).sort();
    expect(large).toEqual([
      "back-squat", "barbell-hip-thrust", "conventional-deadlift", "deficit-deadlift", "front-squat", "hack-squat",
      "leg-press", "pendulum-squat", "rack-pull", "romanian-deadlift", "seated-calf-raise", "standing-calf-raise", "trap-bar-deadlift",
    ]);
  });

  it.each([
    ["push-up", 0.64], ["pull-up", 1], ["chin-up", 1], ["dip", 0.9], ["bodyweight-squat", 0.6], ["inverted-row", 0.55],
    ["walking-lunge", 0.6], ["step-up", 0.6], ["glute-bridge", 0.5], ["weighted-pull-up", 1], ["assisted-pull-up", 1],
  ])("%s moves %s × bodyweight", (id, factor) => {
    expect(byId(id).bwFactor).toBe(factor);
  });

  it("leaves bwFactor off core work, holds and loaded machines", () => {
    for (const e of LIBRARY) {
      if (e.pattern === "core" || e.trackingMode === "timed_hold") expect(e.bwFactor, e.id).toBeUndefined();
      if (e.trackingMode === "bodyweight_reps" && e.pattern !== "core") {
        expect(e.bwFactor !== undefined || ["scapular-row", "tibialis-raise"].includes(e.id), e.id).toBe(true);
      }
      if (e.equipment === "cable") expect(e.bwFactor, e.id).toBeUndefined();
    }
  });

  it("tracks holds by time, carries by distance and weighted variants by added load", () => {
    const modeOf = (id: string) => byId(id).trackingMode;
    for (const id of ["plank", "wall-sit", "superman-hold", "hollow-body-hold"]) expect(modeOf(id)).toBe("timed_hold");
    expect(modeOf("farmer-carry")).toBe("carry");
    expect(modeOf("assisted-pull-up")).toBe("assisted_reps");
    for (const id of ["weighted-pull-up", "weighted-dip", "weighted-push-up"]) expect(modeOf(id)).toBe("loaded_reps");
    for (const id of ["push-up", "pull-up", "walking-lunge", "crunch", "shoulder-tap"]) expect(modeOf(id)).toBe("bodyweight_reps");
  });
});

describe("resolveExercise / metaFor", () => {
  it("finds by id, exact name and loose spelling", () => {
    expect(resolveExercise("barbell-bench-press")?.name).toBe("Barbell Bench Press");
    expect(resolveExercise("Barbell Bench Press")?.id).toBe("barbell-bench-press");
    expect(resolveExercise("  barbell bench presses ")?.id).toBe("barbell-bench-press");
    expect(resolveExercise("PULL UPS")?.id).toBe("pull-up");
    expect(resolveExercise("Incline Dumbbell Press")?.id).toBe("incline-db-press");
  });

  it("returns undefined for unknown or empty names", () => {
    expect(resolveExercise("Zercher Yoke Carry Backwards")).toBeUndefined();
    expect(resolveExercise("")).toBeUndefined();
    expect(resolveExercise("--")).toBeUndefined();
    expect(getExercise("Back Squat")).toBeUndefined();
  });

  it("returns catalog metadata for known movements", () => {
    expect(metaFor("Back Squat")).toEqual({ trackingMode: "loaded_reps", isBarbell: true, largeIncrement: true, pattern: "squat", equipment: "barbell" });
    expect(metaFor("Pull-Ups")).toEqual({ trackingMode: "bodyweight_reps", isBarbell: false, bwFactor: 1, pattern: "verticalPull", equipment: "bodyweight" });
    expect(metaFor("Core Plank").trackingMode).toBe("timed_hold");
  });

  it("falls back to the name guess for movements the catalog doesn't know", () => {
    expect(metaFor("Box Jump")).toEqual(guessMeta("Box Jump"));
    expect(metaFor("Zercher Squat")).toEqual(guessMeta("Zercher Squat"));
  });
});

describe("selectExercises", () => {
  it("respects the equipment mode", () => {
    for (const pattern of MOVEMENT_PATTERNS) {
      for (const equipment of ["bodyweight", "dumbbells"] as const) {
        for (const e of selectExercises(pattern, { equipment, level: "beginner", count: 3 })) {
          expect(EQUIPMENT_ALLOW[equipment]).toContain(e.equipment);
        }
      }
    }
  });

  it("is deterministic for a seed and varies across seeds", () => {
    const pick = (seed: number) => selectExercises("horizontalPush", { level: "advanced", seed })[0]?.id;
    expect(pick(3)).toBe(pick(3));
    expect(new Set([0, 1, 2, 3, 4].map(pick)).size).toBeGreaterThan(1);
  });

  it("returns the requested count of distinct movements, fewer when the pool is smaller", () => {
    expect(selectExercises("biceps", { count: 3 })).toHaveLength(3);
    const triceps = selectExercises("triceps", { equipment: "bodyweight", count: 2 });
    expect(triceps.map((e) => e.id)).toEqual(["bench-dip"]);
    expect(selectExercises("biceps", { equipment: "bodyweight" })).toEqual([]);
    expect(selectExercises("core", { count: 0 })).toEqual([]);
  });

  it("starts from the pattern's staple at seed 0 and filters by level", () => {
    expect(selectExercises("squat")[0]?.id).toBe("back-squat");
    expect(selectExercises("squat", { level: "beginner" })[0]?.id).toBe("goblet-squat");
    expect(selectExercises("hinge", { level: "beginner" })[0]?.id).toBe("trap-bar-deadlift");
  });

  it("opens up harder movements only when the level pool is too small", () => {
    const pulls = selectExercises("verticalPull", { equipment: "bodyweight", level: "beginner" });
    expect(pulls).toHaveLength(1);
    expect(["chin-up", "pull-up", "weighted-pull-up"]).toContain(pulls[0]?.id);
  });

  it("skips specialty lifts and excluded ids, and wraps negative or odd seeds", () => {
    const hinge = selectExercises("hinge", { level: "advanced", count: 20 });
    expect(hinge.some((e) => e.specialty)).toBe(false);
    const without = selectExercises("hinge", { count: 20, exclude: new Set(["conventional-deadlift"]) });
    expect(without.map((e) => e.id)).not.toContain("conventional-deadlift");
    expect(selectExercises("calves", { seed: -1 })[0]?.id).toBe(selectExercises("calves", { seed: 3 })[0]?.id);
    expect(selectExercises("calves", { seed: Number.NaN })).toEqual(selectExercises("calves"));
  });
});

describe("pattern classes", () => {
  it("separates compound from accessory patterns", () => {
    expect(COMPOUND_PATTERNS).toHaveLength(7);
    expect(isCompoundPattern("squat")).toBe(true);
    expect(isCompoundPattern("biceps")).toBe(false);
  });
});
