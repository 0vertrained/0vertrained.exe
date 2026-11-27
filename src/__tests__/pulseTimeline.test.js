import { describe, expect, it } from "vitest";
import { extendPulse, previousPulseSet, pulseCoverage, pulseSets } from "../workout/pulseTimeline";

const start = Date.parse("2026-10-22T15:00:00Z");
function session(at = start, load = "185", gaps = []) {
  let summary;
  for (let second = 0; second <= 75; second++) {
    if (gaps.includes(second)) continue;
    summary = extendPulse(summary, { timestamp: at + second * 1000, bpm: Math.max(110, 175 - second) }, at, !summary);
  }
  summary.trace.sets = [{ name: "Bench", index: 0, offset: 5000, restMs: 65000, mode: "loaded_reps" }];
  return { whoopHeartRate: { main: summary }, exercises: { Bench: {
    sets: [{ done: true, completedAt: new Date(at + 5000).toISOString(), weight: load, reps: 8 }],
  } } };
}
const inspect = workout => pulseSets(workout.whoopHeartRate.main, workout.exercises);

describe("workout pulse timelines", () => {
  it("keeps real endpoints, a compact trace, full-rate totals and coverage from real samples", () => {
    const { whoopHeartRate: { main } } = session();
    const points = main.trace.segments[0];
    expect(main.count).toBe(76);
    expect(points.length).toBe(16);
    expect(points[0]).toEqual([0, 175]);
    expect(points.at(-1)).toEqual([75000, 110]);
    expect(pulseCoverage(main.trace)).toBe(100);
    const newer = extendPulse(main, { timestamp: start + 80_500, bpm: 170 }, start, true);
    expect(newer.trace.segments).toHaveLength(2);
    expect(main.trace.segments).toHaveLength(1);
    expect(pulseCoverage(newer.trace)).toBe(95);
    const sameSecond = extendPulse(newer, { timestamp: start + 80_750, bpm: 173 }, start, false);
    expect(sameSecond.trace.observedSeconds).toBe(77);
  });

  it("splits a silent disconnect and declines a recovery change across that gap or a short rest", () => {
    const workout = session(start, "185", Array.from({ length: 15 }, (_, i) => i + 20));
    expect(workout.whoopHeartRate.main.trace.segments).toHaveLength(2);
    expect(pulseCoverage(workout.whoopHeartRate.main.trace)).toBe(80);
    expect(inspect(workout)[0].change).toBeNull();
    const clean = session();
    expect(inspect(clean)[0].change).toBe(60);
    clean.whoopHeartRate.main.trace.sets[0].restMs = 59_999;
    expect(inspect(clean)[0].change).toBeNull();
    clean.exercises.Bench.sets[0].done = false;
    expect(inspect(clean)).toEqual([]);
  });

  it("compares the same performed lift, set number, reps, tracking mode and a similar load before this session", () => {
    const current = session();
    const day = "2026-10-22";
    const data = { [day]: { workout: current } };
    for (let prior = 1; prior <= 5; prior++) {
      const at = start - prior * 86_400_000;
      const workout = session(at, prior === 2 ? "160" : "180");
      if (prior === 1) workout.exercises.Bench.performedName = "Dumbbell press";
      if (prior === 3) workout.exercises.Bench.sets[0].reps = 3;
      if (prior === 4) workout.whoopHeartRate.main.trace.sets[0].mode = "assisted_reps";
      data[new Date(at).toISOString().slice(0, 10)] = { workout };
    }
    const [selected] = inspect(current);
    expect(previousPulseSet(data, day, start, selected)).toMatchObject({ date: "2026-10-17", change: 60 });
    expect(previousPulseSet(data, day, start, { ...selected, index: 1 })).toBeNull();
  });
});
