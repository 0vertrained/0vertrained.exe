// What an empty set is filled from, and when the runner proposes it.
import { describe, expect, it } from "vitest";
import { proposeSet, fillOptions } from "../workout/setFill";

const done = (weight, reps, extra = {}) => ({ weight: String(weight), reps: String(reps), rir: "", done: true, ...extra });

describe("fill sources for an empty set", () => {
  const exercise = { name: "Bench", sets: 2, reps: 8 };
  const empty = { weight: "", reps: "", done: false };

  it("offers the target, the set before, then last time, each written out", () => {
    const options = fillOptions({
      setIndex: 1, sets: [done(190, 8), empty], exercise,
      prescription: { targetWeight: 190, targetReps: [8, 8], targetSets: 2, repRange: { min: 8, max: 10 } },
      lastRaw: { date: "2026-07-13", sets: [done(185, 8), done(185, 7)] },
    });
    expect(options.map((option) => option.key)).toEqual(["target", "previous", "last"]);
    expect(options.map((option) => option.label)).toEqual(["Target 190 × 8", "Set 1 190 × 8", "Last time 185 × 7"]);
  });

  it("proposes the first source that fills every number, and nothing once the set has an entry", () => {
    // A target with no load on it does not hide the weight from the set before.
    const loadless = { targetWeight: null, targetReps: [8, 8], targetSets: 2, repRange: { min: 8, max: 10 } };
    const proposal = proposeSet({ set: empty, setIndex: 1, sets: [done(190, 8), empty], exercise, prescription: loadless, lastRaw: null });
    expect(proposal.proposed).toBe(true);
    expect(proposal.source.key).toBe("previous");
    expect(proposal.set).toMatchObject({ weight: "190", reps: "8", done: false });
    // The choice wins when one is made.
    expect(proposeSet({ set: empty, setIndex: 1, sets: [done(190, 8), empty], exercise, prescription: loadless, lastRaw: null, choice: "target" }).source.key).toBe("target");
    // Typed numbers are never replaced.
    const typed = { weight: "200", reps: "", done: false };
    expect(proposeSet({ set: typed, setIndex: 1, sets: [done(190, 8), typed], exercise, prescription: loadless, lastRaw: null }).proposed).toBe(false);
  });
});
