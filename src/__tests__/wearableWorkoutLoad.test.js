import { describe, expect, it } from "vitest";
import { buildWearableLoadRows, summarizeWearableLoadSource } from "../wearableWorkoutLoad";

const doneSet = (weight, reps) => ({ weight, reps, done: true });

describe("wearable workout load bridge", () => {
  it("keeps manual logs canonical and does not double-count wearable workouts", () => {
    const rows = buildWearableLoadRows({
      asOf: "2026-07-07",
      maxDays: 1,
      entries: {
        "2026-07-07": { workout: { exercises: { Bench: { sets: [doneSet(200, 5)] } } } },
      },
      whoopData: {
        "2026-07-07": { workout: [{ id: "w1", start: "2026-07-07T12:00:00Z", score: { strain: 14 } }] },
      },
    });

    expect(rows[0].source).toBe("manual+wearable-context");
    expect(rows[0].load).toBe(18); // one completed set × 3 min × estimated lifting RPE 6
    expect(rows[0].notes[0]).toMatch(/not double-counted/i);
  });

  it("fills missing manual days from Whoop workout strain", () => {
    const rows = buildWearableLoadRows({
      asOf: "2026-07-07",
      maxDays: 1,
      entries: {},
      whoopData: {
        "2026-07-07": { workout: [{ id: "w1", start: "2026-07-07T12:00:00Z", score: { strain: 12 } }] },
      },
    });

    expect(rows[0].source).toBe("whoop");
    expect(rows[0].load).toBeGreaterThan(0);
    expect(rows[0].hasWorkout).toBe(true);
  });

  it("summarizes wearable-filled days", () => {
    const summary = summarizeWearableLoadSource([
      { source: "whoop" },
      { source: "manual+wearable-context" },
      { source: "none" },
    ]);
    expect(summary.filledDays).toBe(1);
    expect(summary.contextDays).toBe(1);
  });
});
