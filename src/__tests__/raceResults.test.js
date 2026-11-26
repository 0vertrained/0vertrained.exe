// src/__tests__/raceResults.test.js
// A run marked as a race is kept as a result: best times by distance, what
// your fitness predicts, and the training paces it sets in a race plan.
import { describe, expect, it } from "vitest";
import { currentFitness, normalizeRace, paceUpdateFor, personalBests, raceLabel, raceMiles, racePace, raceResults } from "../raceResults";

const entries = {
  "2026-11-26": { workout: { cardio: { miles: "3.11", time: "24:10", race: { distance: "5k", seconds: 1450, name: "Turkey Trot" } } } },
  "2026-10-04": { workout: { cardioSessions: { pm: { miles: "3.1", race: { distance: "5k", seconds: 1520 } } } } },
  "2026-09-12": { workout: { cardio: { miles: "6.2", race: { distance: "10k", seconds: 3200 } } } },
  "2026-09-13": { workout: { cardio: { miles: "4", race: { distance: "mile", seconds: 400 } } } },
};

describe("race results", () => {
  it("are read from any run on any day, newest first, with pace", () => {
    const results = raceResults(entries);
    expect(results.map((result) => [result.dateKey, result.distance, result.seconds])).toEqual([
      ["2026-11-26", "5k", 1450], ["2026-10-04", "5k", 1520], ["2026-09-12", "10k", 3200],
    ]);
    expect(results[0]).toMatchObject({ name: "Turkey Trot", pace: 467 });
    expect(results[0].vdot).toBeGreaterThan(39);
  });

  it("keep the fastest at each distance as the best", () => {
    const best = personalBests(raceResults(entries));
    expect(best["5k"].dateKey).toBe("2026-11-26");
    expect(best["10k"].seconds).toBe(3200);
  });

  it("drop anything that isn't a plausible result", () => {
    expect(normalizeRace({ distance: "5k", seconds: 0 })).toBeNull();
    expect(normalizeRace({ distance: "5k", seconds: 200 })).toBeNull();
    expect(normalizeRace({ distance: "half", seconds: 6300, name: "  River Run  " })).toEqual({ distance: "half", seconds: 6300, name: "River Run" });
  });

  it("know their miles, pace and name", () => {
    expect([raceMiles("5k"), raceMiles("10k"), raceMiles("half")]).toEqual([3.11, 6.21, 13.11]);
    expect(racePace({ distance: "10k", seconds: 3000 })).toBe(483);
    expect(raceLabel("half")).toBe("Half marathon");
  });
});

describe("current fitness", () => {
  const spec = { benchmark: { distance: "5k", seconds: 1560, date: "2026-11-01" } };

  it("comes from the latest race, or the plan's result when that's newer", () => {
    const results = raceResults(entries);
    expect(currentFitness({ results, spec })).toMatchObject({ source: "race", name: "Turkey Trot", benchmark: { seconds: 1450 } });
    expect(currentFitness({ results: results.slice(1), spec })).toMatchObject({ source: "plan", benchmark: { seconds: 1560 } });
    expect(currentFitness({ results: [], spec: null })).toBeNull();
  });

  it("predicts the other distances", () => {
    const fitness = currentFitness({ results: raceResults(entries) });
    expect(fitness.zones.predictions["10k"]).toBeGreaterThan(1450 * 2);
  });
});

describe("pace updates from a result", () => {
  const spec = { benchmark: { distance: "5k", seconds: 1560, date: "2026-11-01" } };

  it("offer the faster paces a new result sets", () => {
    const update = paceUpdateFor({ result: { distance: "5k", seconds: 1450 }, dateKey: "2026-11-26", spec });
    expect(update.benchmark).toEqual({ distance: "5k", seconds: 1450, date: "2026-11-26" });
    expect(update.next.easy.fast).toBeLessThan(update.current.easy.fast);
  });

  it("say nothing without a plan, for an older result, or for the same fitness", () => {
    expect(paceUpdateFor({ result: { distance: "5k", seconds: 1450 }, dateKey: "2026-11-26", spec: null })).toBeNull();
    expect(paceUpdateFor({ result: { distance: "5k", seconds: 1450 }, dateKey: "2026-10-01", spec })).toBeNull();
    expect(paceUpdateFor({ result: { distance: "5k", seconds: 1561 }, dateKey: "2026-11-26", spec })).toBeNull();
  });

  it("set paces for a plan that had none", () => {
    const update = paceUpdateFor({ result: { distance: "10k", seconds: 3100 }, dateKey: "2026-11-26", spec: { benchmark: null } });
    expect(update.current).toBeNull();
    expect(update.next.easy).toBeTruthy();
  });
});
