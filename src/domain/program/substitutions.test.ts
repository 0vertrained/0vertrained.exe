import { describe, expect, it } from "vitest";
import { EQUIPMENT_ALLOW } from "./library";
import { guessPattern, substitutesFor } from "./substitutions";

const ids = (name: string, options?: Parameters<typeof substitutesFor>[1]) => substitutesFor(name, options).map((e) => e.id);

describe("substitutesFor", () => {
  it("offers same-pattern movements, curated order first (ported)", () => {
    expect(ids("Back Squat")).toEqual(["front-squat", "hack-squat", "pendulum-squat", "leg-press"]);
    expect(ids("Romanian Deadlift")).toEqual(["db-romanian-deadlift", "conventional-deadlift", "back-extension", "barbell-hip-thrust"]);
    expect(ids("Lat Pulldown", { limit: 3 })).toEqual(["pull-up", "assisted-pull-up", "single-arm-lat-pulldown"]);
  });

  it("never suggests the movement itself (ported)", () => {
    for (const name of ["Lat Pulldown", "Barbell Bench Press", "Plank", "Leg Extension"]) {
      const names = substitutesFor(name).map((e) => e.name);
      expect(names.length, name).toBeGreaterThan(0);
      expect(names).not.toContain(name);
    }
  });

  it("only offers what the equipment allows", () => {
    expect(ids("Barbell Bench Press", { equipment: "bodyweight" })).toEqual(["weighted-push-up", "dip", "weighted-dip", "push-up"]);
    expect(ids("Barbell Row", { equipment: "dumbbells" })).toEqual(["one-arm-db-row", "inverted-row"]);
    for (const e of substitutesFor("Back Squat", { equipment: "dumbbells", limit: 10 })) expect(EQUIPMENT_ALLOW.dumbbells).toContain(e.equipment);
  });

  it("takes an exact equipment list (e.g. the rack is taken)", () => {
    const noBarbell = substitutesFor("Back Squat", { equipment: ["machine", "dumbbell"], limit: 10 });
    expect(noBarbell.map((e) => e.equipment)).not.toContain("barbell");
    expect(noBarbell[0]?.id).toBe("hack-squat");
  });

  it("ranks uncurated swaps by equipment, then tracking mode, then difficulty", () => {
    // Face Pull has no curated list: cable first, then the rest of the pattern.
    expect(ids("Face Pull")).toEqual(["straight-arm-pulldown", "shrugs", "scapular-row"]);
    expect(ids("Chin-Up")[0]).toBe("pull-up");
  });

  it("never offers specialty lifts", () => {
    expect(ids("Conventional Deadlift", { limit: 20 })).not.toEqual(expect.arrayContaining(["rack-pull"]));
    expect(ids("Standing Calf Raise", { limit: 20 })).not.toContain("tibialis-raise");
  });

  it("matches names the catalog doesn't know by keyword (ported)", () => {
    expect(substitutesFor("Incline Bench Press")[0]?.pattern).toBe("horizontalPush");
    expect(substitutesFor("Zercher Squat").map((e) => e.pattern)).toEqual(["squat", "squat", "squat", "squat"]);
    expect(ids("Zercher Yoke Carry Backwards")).toEqual([]);
    expect(ids("")).toEqual([]);
  });

  it("respects the limit", () => {
    expect(ids("Back Squat", { limit: 1 })).toEqual(["front-squat"]);
    expect(ids("Back Squat", { limit: 0 })).toEqual([]);
    expect(ids("Back Squat", { limit: 50 }).length).toBeGreaterThan(4);
  });
});

describe("guessPattern", () => {
  it.each([
    ["Barbell Back Squat", "squat"],
    ["Incline Bench Press", "horizontalPush"],
    ["Snatch-Grip Romanian", "hinge"],
    ["Lat Pulldown (wide)", "verticalPull"],
    ["Meadows Row", "horizontalPull"],
    ["Spider Curl", "biceps"],
    ["Seated Calf Press", "calves"],
    ["Lu Lateral Raise", "lateralDelts"],
    ["Arnold Press", "verticalPush"],
    // v19 sent these to the wrong pattern:
    ["Smith Split Squat", "singleLeg"],
    ["Single-Leg Extension", "quadIso"],
    ["Overhead Cable Tricep Ext", "triceps"],
  ])("%s → %s", (name, pattern) => {
    expect(guessPattern(name)).toBe(pattern);
  });

  it("returns undefined for movements it can't place", () => {
    expect(guessPattern("Sled Push")).toBeUndefined();
  });
});
