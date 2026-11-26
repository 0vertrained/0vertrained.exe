// src/__tests__/tomorrowLine.test.js
// Today names tomorrow's lifting and runs in one line, reading the program
// as tomorrow's Today will, race plan included.
import { describe, expect, it } from "vitest";
import { DAYS, DEFAULT_PROGRAM } from "../constants";
import { tomorrowSummary } from "../tomorrowLine";

const rest = { type: "Rest", lifting: [], cardio: null };

describe("tomorrowSummary", () => {
  it("names tomorrow's lifting and its run", () => {
    const program = {
      ...Object.fromEntries(DAYS.map((day) => [day, rest])),
      Friday: {
        type: "Upper B",
        lifting: [{ name: "Bench Press", sets: 3, reps: 8 }, { name: "Row", sets: 3, reps: 10 }],
        cardio: { type: "Easy Run", minutes: 30 },
      },
    };
    expect(tomorrowSummary(program, "2026-11-26")).toBe("Tomorrow: Upper B, 2 exercises · Easy Run, 30 min");
  });

  it("says when tomorrow is a rest day", () => {
    const program = Object.fromEntries(DAYS.map((day) => [day, rest]));
    expect(tomorrowSummary(program, "2026-11-26")).toBe("Tomorrow: rest day");
  });

  it("reads tomorrow's race-plan run", () => {
    const program = {
      ...DEFAULT_PROGRAM,
      __raceBuild: {
        kind: "runPlan", v: 1, distance: "10k", raceDate: "2027-01-09", startDate: "2026-11-23",
        runsPerWeek: 4, longRunDay: "Saturday", qualityDay: "Wednesday", crossTraining: "none",
        startLongRunMin: 45, benchmark: { distance: "5k", seconds: 1500 }, benchmarkTest: "none", raceName: "10K",
      },
    };
    expect(tomorrowSummary(program, "2026-11-27")).toMatch(/Long Run, 45 min/);
  });

  it("is nothing without a date", () => {
    expect(tomorrowSummary(DEFAULT_PROGRAM, "")).toBeNull();
  });
});
