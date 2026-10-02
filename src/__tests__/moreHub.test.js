import { describe, it, expect } from "vitest";
import { summarizeProgramForHub } from "../moreHub";
import { DEFAULT_PROGRAM } from "../constants";

describe("summarizeProgramForHub", () => {
  it("counts lifting, cardio and rest days for the default program", () => {
    const s = summarizeProgramForHub(DEFAULT_PROGRAM);
    // Default: Mon/Tue/Fri/Sat lifting-only, Thu lifting+cardio, Sun cardio-only,
    // Wed full rest.
    expect(s.liftingDays).toBe(5); // Mon, Tue, Thu, Fri, Sat
    expect(s.cardioDays).toBe(2);  // Thu, Sun
    expect(s.restDays).toBe(1);    // Wed
    expect(s.totalDays).toBe(7);
    expect(s.hasProgram).toBe(true);
    expect(s.line).toBe("5 lifting · 2 cardio · 1 rest");
  });

  it("treats a day with both lifting and cardio as counting toward both", () => {
    const prog = {
      Monday: { lifting: [{ name: "Squat", sets: 3, reps: 5 }], cardio: { type: "Run", miles: 2 } },
    };
    const s = summarizeProgramForHub(prog);
    expect(s.liftingDays).toBe(1);
    expect(s.cardioDays).toBe(1);
    expect(s.restDays).toBe(6); // the other six weekdays are absent → rest
  });

  it("returns neutral zero summary for null/empty program", () => {
    for (const input of [null, undefined, {}]) {
      const s = summarizeProgramForHub(input);
      expect(s.liftingDays).toBe(0);
      expect(s.cardioDays).toBe(0);
      expect(s.restDays).toBe(7);
      expect(s.hasProgram).toBe(false);
      expect(s.line).toBe("No program yet — generate one to get started");
    }
  });

  it("does not count empty lifting arrays or null cardio as active days", () => {
    const prog = {
      Monday: { lifting: [], cardio: null },
      Tuesday: { type: "Rest" },
    };
    const s = summarizeProgramForHub(prog);
    expect(s.liftingDays).toBe(0);
    expect(s.cardioDays).toBe(0);
    expect(s.restDays).toBe(7);
    expect(s.hasProgram).toBe(false);
  });
});
