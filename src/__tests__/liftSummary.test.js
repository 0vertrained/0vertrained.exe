// src/__tests__/liftSummary.test.js
// The watch's lifting workouts on a day, added up and said in one line.
import { describe, expect, it } from "vitest";
import { watchLiftLine, watchLiftSummary, watchWorkoutRecord } from "../watch/liftSummary";
import { buildBoxScore } from "../boxScore";

const day = (watchWorkouts) => ({ workout: { exercises: {}, watchWorkouts } });

describe("watchLiftSummary", () => {
  it("adds up the day's workouts, with heart rate weighted by time", () => {
    const summary = watchLiftSummary(day([
      { id: "a", seconds: 1800, avgHr: 120, kcal: 200 },
      { id: "b", seconds: 3600, avgHr: 150, kcal: 410 },
    ]));
    expect(summary).toEqual({ seconds: 5400, avgHr: 140, kcal: 610, count: 2 });
  });

  it("leaves out what the watch didn't measure, and is nothing without workouts", () => {
    expect(watchLiftSummary(day([{ id: "a", seconds: 600, avgHr: null, kcal: null }]))).toEqual({ seconds: 600, avgHr: null, kcal: null, count: 1 });
    expect(watchLiftSummary(day([]))).toBeNull();
    expect(watchLiftSummary({})).toBeNull();
  });
});

describe("watchLiftLine", () => {
  it("reads as time, heart rate and calories", () => {
    expect(watchLiftLine({ seconds: 3120, avgHr: 128, kcal: 1410 })).toBe("52\u00a0min · 128\u00a0bpm average · 1,410\u00a0kcal");
    expect(watchLiftLine({ seconds: 4500, avgHr: null, kcal: null })).toBe("1\u00a0h 15\u00a0min");
    expect(watchLiftLine(null)).toBe("");
  });
});

describe("watchWorkoutRecord", () => {
  it("needs a duration and an id", () => {
    expect(watchWorkoutRecord({ id: "a", durationSeconds: 0 })).toBeNull();
    expect(watchWorkoutRecord({ durationSeconds: 60 })).toBeNull();
    expect(watchWorkoutRecord({ id: "a", durationSeconds: 59.6, at: "x" })).toMatchObject({ seconds: 60, avgHr: null, kcal: null, endedAt: "x" });
  });
});

describe("the box score", () => {
  it("carries what the watch measured", () => {
    const data = { "2026-11-26": day([{ id: "a", seconds: 3000, avgHr: 130, kcal: 380 }]) };
    expect(buildBoxScore({ data, todayKey: "2026-11-26" }).watch).toEqual({ seconds: 3000, avgHr: 130, kcal: 380, count: 1 });
  });
});
