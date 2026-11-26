// src/__tests__/runProgress.test.js
// Easy runs are told apart by the day's plan; easy pace and ground per
// heartbeat compare the last few weeks with the ones before.
import { describe, expect, it } from "vitest";
import { DAYS } from "../constants";
import { easyPaceTrend, heartRateTrend, isEasyRunPlan, loggedRuns, metersPerBeat, parseRunTime } from "../runProgress";

const rest = { type: "Rest", lifting: [], cardio: null };
const program = {
  ...Object.fromEntries(DAYS.map((day) => [day, rest])),
  Monday: { type: "Easy", lifting: [], cardio: { type: "Easy Run", minutes: 40, effort: "Easy" } },
  Wednesday: { type: "Intervals", lifting: [], cardio: { type: "Intervals", effort: "High" } },
  Saturday: { type: "Long", lifting: [], cardio: { type: "Long Run", miles: 8, effort: "Zone 2" } },
};

describe("isEasyRunPlan", () => {
  it("reads the plan's steps first, then its name and effort", () => {
    expect(isEasyRunPlan({ steps: [{ kind: "run", intensity: "easy" }, { kind: "strides", reps: 4 }] })).toBe(true);
    expect(isEasyRunPlan({ type: "Long Run", steps: [{ kind: "run", intensity: "easy" }, { kind: "run", intensity: "race" }] })).toBe(false);
    expect(isEasyRunPlan({ type: "Long Run", effort: "Zone 2" })).toBe(true);
    expect(isEasyRunPlan({ type: "Tempo Run", effort: "Easy then hard" })).toBe(false);
    expect(isEasyRunPlan(null)).toBe(false);
  });
});

describe("parseRunTime", () => {
  it("reads a clock or plain minutes", () => {
    expect([parseRunTime("40:30"), parseRunTime("1:05:10"), parseRunTime("45"), parseRunTime(""), parseRunTime("abc")]).toEqual([2430, 3910, 2700, null, null]);
  });
});

// Mondays and Wednesdays from Oct 5 to Nov 23, 2026.
const entries = {
  "2026-10-05": { workout: { cardio: { miles: "4", time: "44:00", hr: "150" } } },
  "2026-10-12": { workout: { cardio: { miles: "4", time: "43:20", hr: "148" } } },
  "2026-10-26": { workout: { cardio: { miles: "4", time: "42:00", hr: "146" } } },
  "2026-11-02": { workout: { cardio: { miles: "4", time: "42:40", hr: "147" } } },
  "2026-11-09": { workout: { cardio: { miles: "4", time: "41:20", hr: "142" } } },
  "2026-11-16": { workout: { cardio: { miles: "5", pace: "10:00/mi", time: "50:00", hr: "141" } } },
  "2026-11-18": { workout: { cardio: { miles: "5", time: "38:00", hr: "170" } } },
  "2026-11-23": { workout: { cardio: { miles: "4", time: "39:20", hr: "140", race: null } } },
  "2026-11-25": { workout: { cardio: { miles: "3.11", time: "24:10", race: { distance: "5k", seconds: 1450 } } } },
};

describe("loggedRuns", () => {
  const runs = loggedRuns(entries, program, { todayKey: "2026-11-26" });

  it("lists runs oldest first, easy by the day's plan", () => {
    expect(runs.map((run) => run.dateKey)).toEqual(Object.keys(entries));
    expect(runs.find((run) => run.dateKey === "2026-11-18").easy).toBe(false);
    expect(runs.find((run) => run.dateKey === "2026-11-23")).toMatchObject({ easy: true, pace: 590, hr: 140 });
    expect(runs.find((run) => run.dateKey === "2026-11-16").pace).toBe(600);
  });

  it("never counts a race as an easy run", () => {
    expect(runs.at(-1)).toMatchObject({ easy: false, race: { distance: "5k", seconds: 1450, name: "" } });
  });
});

describe("easyPaceTrend", () => {
  it("compares the last four weeks of easy runs with the four before, by miles", () => {
    const trend = easyPaceTrend(loggedRuns(entries, program, { todayKey: "2026-11-26" }), { todayKey: "2026-11-26" });
    expect(trend.recent.runs).toBe(4);
    expect(trend.earlier.runs).toBe(3);
    expect(trend.recent.pace).toBeLessThan(trend.earlier.pace);
  });

  it("is nothing without easy runs lately", () => {
    expect(easyPaceTrend([], { todayKey: "2026-11-26" })).toBeNull();
  });
});

describe("heartRateTrend", () => {
  it("shows more ground per heartbeat as easy runs get fitter", () => {
    const trend = heartRateTrend(loggedRuns(entries, program, { todayKey: "2026-11-26" }), { todayKey: "2026-11-26" });
    expect(trend.recent.runs).toBe(3);
    expect(trend.change).toBeGreaterThan(0);
  });

  it("needs time and heart rate", () => {
    expect(metersPerBeat({ miles: 4, seconds: 2400, hr: null })).toBeNull();
    expect(metersPerBeat({ miles: 4, seconds: 2400, hr: 150 })).toBeCloseTo(1.07, 2);
  });
});
