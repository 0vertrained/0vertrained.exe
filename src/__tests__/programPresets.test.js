import { describe, expect, it } from "vitest";
import { PROGRAM_PRESETS } from "../constants";
import { countProgramCardioMiles, countProgramSets, getProgramSessions } from "../programSessions";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

describe("high-intensity hybrid preset", () => {
  it("defines an advanced AM/PM two-a-day program", () => {
    const preset = PROGRAM_PRESETS.highIntensityHybrid;

    expect(preset).toBeTruthy();
    expect(preset.name).toMatch(/2-a-day/i);
    expect(preset.tags).toContain("Advanced");
  });

  it("has two sessions on six training days and true rest on Sunday", () => {
    const program = PROGRAM_PRESETS.highIntensityHybrid.program;

    for (const day of DAYS.slice(0, 6)) {
      const sessions = getProgramSessions(program[day]);
      expect(sessions).toHaveLength(2);
      expect(sessions.map((s) => s.label)).toEqual(["AM", "PM"]);
      expect(sessions.every((s) => s.lifting.length > 0)).toBe(true);
      expect(sessions.every((s) => !!s.cardio)).toBe(true);
    }

    expect(getProgramSessions(program.Sunday)).toEqual([]);
  });

  it("keeps weekly volume and cardio inside the intended aggressive range", () => {
    const program = PROGRAM_PRESETS.highIntensityHybrid.program;
    const totals = DAYS.reduce((acc, day) => {
      acc.sets += countProgramSets(program[day]);
      acc.miles += countProgramCardioMiles(program[day]);
      return acc;
    }, { sets: 0, miles: 0 });

    expect(totals.sets).toBeGreaterThanOrEqual(110);
    expect(totals.sets).toBeLessThanOrEqual(135);
    expect(totals.miles).toBeGreaterThanOrEqual(24);
    expect(totals.miles).toBeLessThanOrEqual(32);
  });

  it("keeps single-session volume bounded", () => {
    const program = PROGRAM_PRESETS.highIntensityHybrid.program;
    for (const day of DAYS) {
      for (const session of getProgramSessions(program[day])) {
        const sets = session.lifting.reduce((sum, ex) => sum + (Number(ex.sets) || 0), 0);
        expect(sets).toBeLessThanOrEqual(20);
      }
    }
  });
});
