import { describe, expect, it } from "vitest";
import { MOVEMENT_PATTERNS } from "../exercise";
import { ALIASES, ALIAS_NAMES, normalizeName } from "./aliases";
import { LIBRARY, getExercise, resolveExercise } from "./library";

// Every lift name in v19's DEFAULT_PROGRAM and PROGRAM_PRESETS (src/constants.js
// @ c955d5a), copied verbatim so this test outlives the legacy source.
const KEPT: Record<string, readonly string[]> = {
  DEFAULT_PROGRAM: ["Barbell Bench Press", "Incline DB Press", "Seated DB Shoulder Press", "Cable Lateral Raises", "Pec Deck / Cable Fly", "EZ Bar Skull Crushers", "Rope Tricep Pushdown", "Overhead DB Tricep Extension", "Back Squat", "Pendulum Squat / V-Squat", "Walking Lunges", "Leg Press", "Leg Curl", "Seated Calf Raises", "Standing Calf Raises", "Hanging Leg Raises", "Plank", "Dead Bug", "Barbell Row", "Weighted Pull-Ups", "Chest-Supported Row", "Cable Row (Close Grip)", "Face Pulls", "Incline DB Curl", "Hammer Curls", "Cable Curl", "Conventional Deadlift", "Romanian Deadlift", "Barbell Hip Thrust", "Lying Leg Curl"],
  beginner: ["Squat", "Bench Press", "Barbell Row", "Overhead Press", "Plank", "Deadlift", "Incline DB Press", "Lat Pulldown", "DB Lunges", "Calf Raises", "Goblet Squat", "Push-Ups", "DB Row", "Romanian Deadlift", "Core Work"],
  calisthenics: ["Incline Push-Ups", "Wall Sit", "Shoulder Taps", "Glute Bridges", "Dead Bug", "Australian Pull-Ups", "Good Mornings", "Reverse Lunges", "Superman Hold", "Plank", "Squat (bodyweight)", "Push-Ups (floor)", "Step-Ups", "Scapular Rows", "Hollow Body Hold"],
  bodybuilding: ["Barbell Bench Press", "Incline DB Press", "Cable Fly", "Dips", "Pushdowns", "Deadlift", "Barbell Row", "Lat Pulldown", "Cable Row", "Face Pulls", "Seated DB Press", "Lateral Raises", "Front Raises", "Rear Delt Fly", "Shrugs", "Squat", "Leg Press", "Romanian Deadlift", "Leg Curl", "Calf Raises", "Barbell Curl", "Incline DB Curl", "Hammer Curls", "Skull Crushers", "Tricep Pushdowns", "Overhead Extension"],
  powerlifting: ["Back Squat", "Romanian Deadlift", "Leg Press", "Walking Lunges", "Leg Curl", "Barbell Bench Press", "Close Grip Bench", "DB Press", "Tricep Pushdowns", "Lateral Raises", "Conventional Deadlift", "Deficit Deadlift", "Barbell Row", "Lat Pulldown", "Face Pulls", "Overhead Press", "Seated DB Press", "Barbell Curl", "Skull Crushers", "Core Work"],
  running: ["Squat", "Romanian Deadlift", "Bench Press", "Barbell Row", "Core Plank", "Deadlift", "Pull-Ups", "DB Lunges", "Shoulder Press", "Calf Raises"],
};

const CUT: Record<string, readonly string[]> = {
  highIntensityHybrid: ["Barbell Bench Press", "Weighted Pull-Up", "Overhead Press", "Barbell Row", "Face Pull", "Front Squat", "Romanian Deadlift", "Leg Press", "Walking Lunges", "Seated Calf Raise", "Back Squat", "Conventional Deadlift", "Bulgarian Split Squat", "Lying Leg Curl", "Standing Calf Raise", "Incline DB Press", "Chest-Supported Row", "Cable Fly", "Lat Pulldown", "Cable Lateral Raise", "Weighted Chin-Up", "Pendlay Row", "Rack Pull", "Rear Delt Fly", "Hammer Curl", "DB Bench Press", "Seated DB Shoulder Press", "Dips", "EZ Bar Curl", "Rope Pushdown", "Hack Squat", "Hip Thrust", "Leg Extension", "Seated Leg Curl", "Tibialis Raise", "Close-Grip Bench Press", "Cable Row", "Machine Chest Press", "Single-Arm Pulldown", "Lateral Raise Mechanical Dropset", "Power Clean", "Push Press", "Trap Bar Deadlift", "Box Jump", "Farmer Carry", "Glute-Ham Raise", "T-Bar Row", "Back Extension", "Cable Curl", "Machine Shoulder Press", "Pulldown", "Superset Curl + Pushdown", "Hanging Leg Raise", "Cable Crunch", "Incline DB Curl", "Overhead Tricep Extension"],
  ramiHybridCut: ["Incline Smith Press", "Neutral-Grip Lat Pulldown", "Chest-Supported Row", "Machine Chest Press", "Seated Shoulder Press", "Cable Lateral Raise", "Cable Crunch", "Hack Squat", "Romanian Deadlift", "Bulgarian Split Squat", "Seated Leg Curl", "Leg Extension", "Standing Calf Raise", "Hanging Leg Raise", "Machine Shoulder Press", "Reverse Pec Deck", "Rear-Delt Row", "EZ-Bar Curl", "Incline Dumbbell Curl", "Hammer Curl", "Overhead Cable Triceps Extension", "Rope Pressdown", "Hip Thrust", "Leg Press", "Lying Leg Curl", "Reverse Lunge", "Seated Calf Raise", "Pallof Press", "Incline Machine Press", "Single-Arm Lat Pulldown", "Flat Dumbbell Press", "Single-Arm Cable Row", "Pec Deck", "Straight-Arm Pulldown", "Cable Curl", "Preacher Curl", "Overhead Rope Extension", "Calf Raise"],
  doubleEdition: ["Incline DB Press", "Machine Chest Press", "Weighted Dip", "Cable Fly Low-to-High", "Pec Deck", "Hanging Leg Raise", "EZ-Bar Curl", "Rope Pushdown", "Incline DB Curl", "Overhead Cable Extension", "Standing Calf Raise", "Weighted Pull-Up", "Barbell Row", "Lat Pulldown Neutral Wide", "Chest-Supported Row", "Straight-Arm Pulldown", "Rear Delt Cable Fly", "Cable Lateral Raise", "Cable Rear Fly", "Machine Lateral Raise", "DB Shrug", "Cable Crunch", "Hack Squat", "Leg Press Feet Low", "Bulgarian Split Squat", "Leg Extension", "Seated Calf Raise", "Machine Incline Press", "Cable Fly High-to-Low", "Deficit Push-Up", "Hanging Knee Raise", "Seated DB Shoulder Press", "DB Lateral Raise", "Cable Y-Raise", "Reverse Pec Deck", "Barbell Shrug", "Weighted Plank", "Single-Arm Lat Pulldown", "Machine Row", "DB Curl", "Close-Grip Bench", "Skullcrusher", "Preacher Curl", "Hammer Curl", "Seated Leg Curl", "Hip Thrust", "Back Extension", "Romanian Deadlift", "Lying Leg Curl", "Walking Lunge", "Hip Abduction Machine", "Leg Press Light"],
  raceEdition50k: ["Weighted Pull-Up", "Barbell Row", "Neutral-Grip Lat Pulldown", "Chest-Supported Row", "EZ-Bar Curl", "Standing Calf Raise", "Incline Smith Press", "Machine Chest Press", "Seated Shoulder Press", "Cable Lateral Raise", "Rope Pushdown"],
};

describe("normalizeName", () => {
  it.each([
    ["Pull-Ups", "pullup"],
    ["pull ups", "pullup"],
    ["Pullups", "pullup"],
    ["DB Rows", "dumbbellrow"],
    ["Dumbbell Row", "dumbbellrow"],
    ["Tricep Pushdowns", "triceppushdown"],
    ["Triceps Pushdown", "triceppushdown"],
    ["Skullcrushers", "skullcrusher"],
    ["Crunches", "crunch"],
    ["Bench Presses", "benchpress"],
    ["Cable Flies", "cablefly"],
    ["Farmer's Walk", "farmerwalk"],
    ["EZ-Bar Curl", "ezbarcurl"],
    ["BB Row", "barbellrow"],
    ["KB Swing", "kettlebellswing"],
    ["Pallof Press", "pallofpress"],
    ["Abs & Core", "abandcore"],
    ["  ", ""],
  ])("%s → %s", (name, key) => {
    expect(normalizeName(name)).toBe(key);
  });
});

describe("alias table", () => {
  it("points every alias at a library movement", () => {
    for (const [key, id] of Object.entries(ALIASES)) expect(getExercise(id), key).toBeDefined();
  });

  it("lists each name once and never repeats a catalog name", () => {
    const keys = new Map<string, string>();
    for (const [id, names] of Object.entries(ALIAS_NAMES)) {
      for (const name of names) {
        const key = normalizeName(name);
        expect(keys.get(key), `${name} (${id}) repeats an alias of ${keys.get(key)}`).toBeUndefined();
        keys.set(key, id);
        const own = LIBRARY.find((e) => normalizeName(e.name) === key);
        expect(own, `"${name}" is already ${own?.id}'s catalog name`).toBeUndefined();
      }
    }
  });

  it("only uses valid movement patterns in the catalog it resolves to", () => {
    for (const e of LIBRARY) expect(MOVEMENT_PATTERNS).toContain(e.pattern);
  });
});

describe("legacy names resolve", () => {
  it.each(Object.entries(KEPT))("every lift in %s resolves", (_, names) => {
    expect(names.filter((n) => !resolveExercise(n))).toEqual([]);
  });

  it.each(Object.entries(CUT))("at least 95%% of %s resolves", (_, names) => {
    const unresolved = names.filter((n) => !resolveExercise(n));
    expect(1 - unresolved.length / names.length).toBeGreaterThanOrEqual(0.95);
  });

  it("leaves only these cut-preset names to the name guess", () => {
    const unresolved = Object.values(CUT).flat().filter((n) => !resolveExercise(n));
    expect([...new Set(unresolved)].sort()).toEqual(["Barbell Shrug", "Box Jump", "Hip Abduction Machine", "Rear-Delt Row", "Superset Curl + Pushdown"]);
  });

  it.each([
    ["Squat", "back-squat"],
    ["Deadlift", "conventional-deadlift"],
    ["Bench Press", "barbell-bench-press"],
    ["Push-Ups", "push-up"],
    ["Pullups", "pull-up"],
    ["OHP", "overhead-press"],
    ["RDL", "romanian-deadlift"],
    ["Dumbbell Bench Press", "dumbbell-bench-press"],
    ["DB Bench Press", "dumbbell-bench-press"],
    ["Incline Dumbbell Press", "incline-db-press"],
    ["Weighted Chin-Up", "weighted-pull-up"],
    ["Chin Ups", "chin-up"],
    ["Squat (bodyweight)", "bodyweight-squat"],
    ["Core Work", "crunch"],
    ["Farmer's Walk", "farmer-carry"],
    ["Single-Arm Pulldown", "single-arm-lat-pulldown"],
  ])("%s → %s", (name, id) => {
    expect(resolveExercise(name)?.id).toBe(id);
  });

  it("keeps load-distinct variants apart from the base lift", () => {
    expect(resolveExercise("Single-Arm Lat Pulldown")?.id).not.toBe(resolveExercise("Lat Pulldown")?.id);
    expect(resolveExercise("Weighted Pull-Ups")?.id).not.toBe(resolveExercise("Pull-Ups")?.id);
    expect(resolveExercise("Close Grip Bench")?.id).not.toBe(resolveExercise("Bench Press")?.id);
    expect(resolveExercise("Barbell Curl")?.id).not.toBe(resolveExercise("EZ Bar Curl")?.id);
  });
});
