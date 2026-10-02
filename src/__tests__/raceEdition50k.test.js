import { describe, expect, it } from "vitest";
import { DAYS, PROGRAM_PRESETS } from "../constants";
import { RACE_BUILDS } from "../raceBuild";

// V19.2 · The Race Edition — 50K Build. Emergency five-week ultra build:
// two upper lifting days + calves, four cardio days (incl. B2B weekend),
// one full rest day, and a __raceBuild marker wiring it to the resolver.

describe("The Race Edition — 50K Build preset", () => {
  const preset = PROGRAM_PRESETS.raceEdition50k;

  it("exists with matching id, a name, desc, and tags", () => {
    expect(preset).toBeTruthy();
    expect(preset.id).toBe("raceEdition50k");
    expect(preset.name).toMatch(/50K/);
    expect(preset.desc.length).toBeGreaterThan(40);
    expect(preset.tags.length).toBeGreaterThan(0);
  });

  it("carries a __raceBuild marker registered in RACE_BUILDS", () => {
    const id = preset.program.__raceBuild;
    expect(typeof id).toBe("string");
    expect(RACE_BUILDS[id]).toBeTruthy();
    expect(RACE_BUILDS[id].raceDate).toBe("2026-08-28");
  });

  it("defines all seven days in the single-session day shape", () => {
    for (const day of DAYS) {
      const d = preset.program[day];
      expect(d, `${day} missing`).toBeTruthy();
      expect(typeof d.type).toBe("string");
      expect(typeof d.code).toBe("string");
      expect(Array.isArray(d.lifting)).toBe(true);
      expect(d.cardio === null || typeof d.cardio === "object").toBe(true);
      expect(d.sessions).toBeUndefined();
    }
  });

  it("carries two lifting days, four cardio days, and one full rest day", () => {
    const days = DAYS.map((day) => preset.program[day]);
    expect(days.filter(d => d.lifting.length > 0).length).toBe(2);
    expect(days.filter(d => d.cardio).length).toBe(4);
    expect(days.filter(d => d.lifting.length === 0 && !d.cardio).length).toBe(1);
  });

  it("contains no axially loaded leg work — the injury tax this block can't afford", () => {
    for (const day of DAYS) {
      for (const ex of preset.program[day].lifting) {
        expect(ex.name).not.toMatch(/squat|deadlift|lunge|leg press/i);
      }
    }
  });

  it("keeps lifting in maintenance volume — no day exceeds 15 working sets", () => {
    for (const day of DAYS) {
      const sets = preset.program[day].lifting.reduce((acc, ex) => acc + ex.sets, 0);
      expect(sets).toBeLessThanOrEqual(15);
    }
  });

  it("Saturday base is detectable as the long day by the periodization layer", () => {
    const sat = preset.program.Saturday;
    expect(sat.cardio.miles).toBeGreaterThanOrEqual(6);
    expect(`${sat.type} ${sat.cardio.type}`).toMatch(/long/i);
  });

  it("bakes run/walk rhythm and fueling into the base long-session notes", () => {
    const notes = preset.program.Saturday.cardio.notes;
    expect(notes).toMatch(/run \/ 2 min walk/i);
    expect(notes).toMatch(/carbs/i);
  });

  it("every exercise and cardio block is fully specified", () => {
    for (const day of DAYS) {
      const d = preset.program[day];
      for (const ex of d.lifting) {
        expect(typeof ex.name).toBe("string");
        expect(ex.sets).toBeGreaterThan(0);
        expect(ex.reps).toBeGreaterThan(0);
        expect(typeof ex.notes).toBe("string");
      }
      if (d.cardio) {
        expect(d.cardio.miles).toBeGreaterThan(0);
        expect(typeof d.cardio.effort).toBe("string");
        expect(typeof d.cardio.notes).toBe("string");
      }
    }
  });
});
