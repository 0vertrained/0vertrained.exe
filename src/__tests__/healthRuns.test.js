// src/__tests__/healthRuns.test.js
// Runs from Apple Health fill in a day's run only while nothing is logged
// for it, add up when there are several, and are each looked at once.
import { describe, expect, it } from "vitest";
import { fillMessage, fillWrites, formatRunTime, hasLoggedRun, planHealthFills, runFill } from "../watch/healthRuns";

const run = (id, date, meters, seconds) => ({ id, date, meters, seconds });
const logged = (cardio) => ({ workout: { cardio } });

describe("runFill", () => {
  it("writes miles, time and pace the way the log reads them", () => {
    expect(runFill([run("a", "2026-11-26", 8046.72, 2430)])).toEqual({ miles: "5", time: "40:30", pace: "8:06", hr: "" });
  });

  it("adds up runs on the same day", () => {
    expect(runFill([run("a", "d", 1609.344, 480), run("b", "d", 3218.688, 1080)])).toEqual({ miles: "3", time: "26:00", pace: "8:40", hr: "" });
  });

  it("averages heart rate by how long each run lasted", () => {
    const fill = runFill([{ ...run("a", "d", 1609.344, 600), avgHr: 140 }, { ...run("b", "d", 1609.344, 1800), avgHr: 160 }]);
    expect(fill.hr).toBe("155");
  });

  it("counts minutes past the hour", () => {
    expect(formatRunTime(5720)).toBe("95:20");
  });

  it("fills what it has", () => {
    expect(runFill([run("a", "d", 0, 1800)])).toEqual({ miles: "", time: "30:00", pace: "", hr: "" });
    expect(runFill([run("a", "d", 0, 0)])).toBeNull();
  });
});

describe("hasLoggedRun", () => {
  it("follows the Strava suggestion's rule: miles or a time", () => {
    expect(hasLoggedRun({ cardio: { miles: "", time: "", pace: "" } })).toBe(false);
    expect(hasLoggedRun({ cardio: { miles: "3.1" } })).toBe(true);
    expect(hasLoggedRun({ cardio: { time: "25:00" } })).toBe(true);
    expect(hasLoggedRun({ cardio: {}, cardioSessions: { run: { miles: "4" } } })).toBe(true);
  });
});

describe("planHealthFills", () => {
  it("fills an empty day and remembers the run", () => {
    const result = planHealthFills({ runs: [run("a", "2026-11-26", 8046.72, 2430)], data: {} });
    expect(result.fills).toEqual([{ dateKey: "2026-11-26", miles: "5", time: "40:30", pace: "8:06", hr: "", count: 1 }]);
    expect(result.handled).toEqual(["a"]);
  });

  it("leaves a day with a logged run alone, and doesn't look at that run again", () => {
    const data = { "2026-11-26": logged({ miles: "3.1", time: "26:00" }) };
    const result = planHealthFills({ runs: [run("a", "2026-11-26", 8046.72, 2430)], data });
    expect(result.fills).toEqual([]);
    expect(result.handled).toEqual(["a"]);
  });

  it("never refills a run it has looked at, even after an undo", () => {
    const result = planHealthFills({ runs: [run("a", "2026-11-26", 8046.72, 2430)], data: {}, handled: ["a"] });
    expect(result.fills).toEqual([]);
    expect(result.handled).toEqual(["a"]);
  });

  it("fills each day in date order and skips anything malformed", () => {
    const result = planHealthFills({
      runs: [run("b", "2026-11-26", 5000, 1500), run("a", "2026-11-24", 3000, 1000), { id: "", date: "2026-11-25" }, run("c", "yesterday", 1, 1)],
      data: {},
    });
    expect(result.fills.map((fill) => fill.dateKey)).toEqual(["2026-11-24", "2026-11-26"]);
    expect(result.handled).toEqual(["a", "b"]);
  });
});

describe("fillWrites", () => {
  it("writes only the fields it has", () => {
    expect(fillWrites({ miles: "5", time: "40:30", pace: "", hr: "152" })).toEqual([
      { path: "workout.cardio.miles", value: "5" },
      { path: "workout.cardio.time", value: "40:30" },
      { path: "workout.cardio.hr", value: "152" },
    ]);
  });
});

describe("fillMessage", () => {
  it("names the day", () => {
    expect(fillMessage([{ dateKey: "2026-11-26" }], "2026-11-26")).toBe("Today’s run filled in from Apple Health");
    expect(fillMessage([{ dateKey: "2026-11-25" }], "2026-11-26")).toBe("Yesterday’s run filled in from Apple Health");
    expect(fillMessage([{ dateKey: "2026-11-23" }], "2026-11-26")).toBe("Monday’s run filled in from Apple Health");
    expect(fillMessage([{ dateKey: "2026-11-23" }, { dateKey: "2026-11-24" }], "2026-11-26")).toBe("2 runs filled in from Apple Health");
  });
});
