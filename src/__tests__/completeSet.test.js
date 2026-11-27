// src/__tests__/completeSet.test.js
// One way to log a set, shared by the runner and the watch: done with its
// time, skipped cleared, the first logged set's progression decision kept,
// and next time's prescription only once every set is in.
import { describe, expect, it } from "vitest";
import { completeSet } from "../workout/completeSet";
import { buildExercisePrescription, buildProgressionDecision } from "../progressionEngine";
import { reconcileExerciseSets } from "../workoutLogging";

const exercise = { name: "Bench Press", sets: 2, reps: "6-8" };
const todayKey = "2026-11-26";

function start(exData = {}) {
  const sets = reconcileExerciseSets(exercise, exData.sets || []);
  const prescription = buildExercisePrescription({ data: {}, exercise, todayKey });
  return { exData, sets, prescription };
}

describe("completeSet", () => {
  it("marks the set done at the time given and clears a skip", () => {
    const { exData, sets, prescription } = start({ skipped: { reason: "time" } });
    const result = completeSet({
      exData, sets, setIndex: 0, set: { ...sets[0], weight: "185", reps: "8" },
      exercise, prescription, data: {}, todayKey, completedAt: "2026-11-26T15:00:00.000Z",
    });
    expect(result.completed).toMatchObject({ weight: "185", reps: "8", done: true, completedAt: "2026-11-26T15:00:00.000Z" });
    expect(result.completed.progressionTarget.plan).toMatchObject({ name: "Bench Press", sets: 2, reps: "6-8" });
    expect(result.nextSets[1].done).not.toBe(true);
    expect(result.exerciseComplete).toBe(false);
    expect(result.exData.skipped).toBeUndefined();
    expect(result.exData.progressionDecision).toBeTruthy();
    expect(result.exData.nextPrescription).toBeUndefined();
  });

  it("scores a chosen target when the athlete actually logs the set", () => {
    const prescription = { kind: "add_reps", targetWeight: 185, targetReps: [8, 8], targetRir: "1-2" };
    const chosen = buildProgressionDecision(prescription, { weight: "185" }, { selectedSource: "target" });
    const initial = start({ progressionDecision: chosen });
    const result = completeSet({ ...initial, prescription, exercise, todayKey, setIndex: 0,
      set: { weight: "185", reps: "7", rir: "2" }, selectedSource: "target" });
    expect(chosen.outcome).toBe("unknown");
    expect(result.exData.progressionDecision).toMatchObject({ selectedSource: "target", loadMatched: true, outcome: "missed" });
    expect(result.completed.progressionTarget).toMatchObject({ value: 8, rir: "1-2", plan: { sets: 2, reps: "6-8" } });
  });

  it("keeps the decision from the first set and adds next time once every set is in", () => {
    const first = start();
    const one = completeSet({ ...first, setIndex: 0, set: { ...first.sets[0], weight: "185", reps: "8" }, exercise, data: {}, todayKey });
    const decision = one.exData.progressionDecision;
    const two = completeSet({
      exData: one.exData, sets: one.nextSets, setIndex: 1, set: { ...one.nextSets[1], weight: "185", reps: "7" },
      exercise, prescription: first.prescription, data: {}, todayKey,
    });
    expect(two.exData.progressionDecision).toBe(decision);
    expect(two.exerciseComplete).toBe(true);
    expect(two.exData.nextPrescription).toBeTruthy();
    expect(two.exData.sets.map((set) => set.done)).toEqual([true, true]);
  });
});
