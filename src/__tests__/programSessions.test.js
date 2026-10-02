import { describe, expect, it } from "vitest";
import {
  buildSplitSessionsFromLegacy,
  countProgramCardioMiles,
  countProgramSets,
  flattenProgramLifting,
  getProgramCardioSessions,
  getProgramSessions,
  hasProgramTraining,
  usesProgramSessions,
} from "../programSessions";

describe("program session adapter", () => {
  it("normalizes a legacy lifting/cardio day into one synthetic session", () => {
    const day = {
      type: "Push + Run",
      lifting: [{ name: "Bench", sets: 4, reps: 6 }],
      cardio: { type: "Easy Run", miles: 3, effort: "Zone 2" },
    };

    const sessions = getProgramSessions(day);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ id: "main", label: "Session", title: "Push + Run" });
    expect(sessions[0].lifting[0].name).toBe("Bench");
    expect(sessions[0].cardio.miles).toBe(3);
    expect(usesProgramSessions(day)).toBe(false);
  });

  it("returns no sessions for a legacy rest day", () => {
    expect(getProgramSessions({ type: "Rest", lifting: [], cardio: null })).toEqual([]);
    expect(hasProgramTraining({ lifting: [], cardio: null })).toBe(false);
  });

  it("preserves explicit AM and PM sessions", () => {
    const day = {
      type: "Two a day",
      sessions: [
        { id: "am", label: "AM", title: "Upper Strength", lifting: [{ name: "Bench", sets: 5, reps: 3 }], cardio: { miles: 3 } },
        { id: "pm", label: "PM", title: "Lower Volume", lifting: [{ name: "Squat", sets: 4, reps: 8 }], cardio: { miles: 2 } },
      ],
    };

    const sessions = getProgramSessions(day);

    expect(sessions.map((s) => s.id)).toEqual(["am", "pm"]);
    expect(flattenProgramLifting(day).map((e) => e.name)).toEqual(["Bench", "Squat"]);
    expect(getProgramCardioSessions(day)).toHaveLength(2);
    expect(countProgramSets(day)).toBe(9);
    expect(countProgramCardioMiles(day)).toBe(5);
    expect(usesProgramSessions(day)).toBe(true);
  });

  it("splits a legacy day into editable AM/PM sessions without losing work", () => {
    const day = {
      type: "Full Body",
      lifting: [
        { name: "Bench", sets: 3, reps: 8 },
        { name: "Row", sets: 3, reps: 8 },
        { name: "Squat", sets: 4, reps: 6 },
      ],
      cardio: { type: "Run", miles: 2 },
    };

    const split = buildSplitSessionsFromLegacy(day);

    expect(split.lifting).toEqual([]);
    expect(split.cardio).toBeNull();
    expect(split.sessions).toHaveLength(2);
    expect(split.sessions[0].lifting.map((e) => e.name)).toEqual(["Bench", "Row"]);
    expect(split.sessions[1].lifting.map((e) => e.name)).toEqual(["Squat"]);
    expect(split.sessions[0].cardio.miles).toBe(2);
  });
});
