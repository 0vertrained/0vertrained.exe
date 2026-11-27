import { describe, expect, it } from "vitest";
import { buildProgramPlan } from "../programBuilder";
import { liveTrainingWeek, sessionPrescription, snapshotOnTrainingWrite } from "../customTrainingDay";
import { proposeSet } from "../workout/setFill";
import { reconcileExerciseSets } from "../workoutLogging";

const dateKey = "2026-11-23"; // Monday
const inputs = { goal: "bodybuilding", equipment: "machines", experience: "intermediate", trainingDaysPerWeek: 3,
  restDays: ["Tuesday", "Thursday", "Saturday", "Sunday"], sessionLength: 60, adaptiveTraining: true };
const program = buildProgramPlan(inputs).program;
const day = program.Monday;
const first = day.lifting[0];
const data = Object.fromEntries(["2026-11-09", "2026-11-16"].map(date => [date, {
  workout: { exercises: { [first.name]: { sets: Array.from({ length: first.sets }, () => ({
    done: true, reps: first.reps, weight: 100, rir: 3, quality: "clean",
  })) } } },
}]));
const options = { program, data, dateKey, currentDateKey: dateKey, wearableScore: 92 };

describe("custom week through the daily resolver and logger", () => {
  it("projects a working load using prior workouts and leaves the editable template intact", () => {
    const projected = liveTrainingWeek(options).Monday;
    const ex = projected.lifting[0];
    const target = sessionPrescription({ data, exercise: ex, dateKey });
    expect(target.targetWeight).toBeGreaterThan(100);
    const filled = proposeSet({ exercise: ex, prescription: target });
    expect(Number(filled.set.weight)).toBe(target.targetWeight);
    expect(filled.set.done).toBeUndefined();
    expect(day.lifting[0].adaptivePrescription).toBeUndefined();
    expect(liveTrainingWeek({ ...options, wearableScore: 0 }).Monday.lifting).toEqual([]);
    expect(liveTrainingWeek({ ...options, readiness: "rest" }).Monday.lifting).toEqual([]);
  });

  it("freezes the actual day's dose on first training write and restores it after changing plans", () => {
    const entry = { workout: { exercises: {} } };
    expect(snapshotOnTrainingWrite({ ...options, entry, path: "body.soreness" })).toBe(entry);
    const started = snapshotOnTrainingWrite({ ...options, entry, path: "workout.sessionState.main" });
    const logged = JSON.parse(JSON.stringify(started));
    expect(logged.workout.customPlanSnapshot.day).toEqual(liveTrainingWeek(options).Monday);
    const changed = buildProgramPlan({ ...inputs, adaptiveTraining: false }).program;
    const past = liveTrainingWeek({ program: changed, data: { ...data, [dateKey]: logged }, dateKey,
      currentDateKey: "2026-11-25", wearableScore: 20 });
    expect(past.Monday).toEqual(started.workout.customPlanSnapshot.day);
    expect(snapshotOnTrainingWrite({ ...options, entry: started, wearableScore: 0, path: "workout.exercises.Row" })).toBe(started);
    expect(liveTrainingWeek({ ...options, program: changed })).toBe(changed);
  });

  it("keeps future and unrecorded past days on the template when viewing another date", () => {
    const projection = liveTrainingWeek({ ...options, dateKey: "2026-11-30", wearableScore: 30 });
    expect(projection).toBe(program);
    expect(liveTrainingWeek(options).Wednesday).toBe(program.Wednesday);
  });

  it("never copies the planned exercise's load or a stale last-time fill to a new variation", () => {
    const ex = liveTrainingWeek(options).Monday.lifting[0];
    const prescription = sessionPrescription({ exercise: ex, performedName: "Another Machine", dateKey, data });
    expect(prescription.targetWeight).toBeNull();
    const result = proposeSet({ exercise: ex, prescription, lastRaw: { sets: [{ reps: 10, weight: 100 }] } });
    expect(result.set.weight).toBeUndefined();
  });

  it("preserves extra lifted sets returned by an offline watch when editing a lighter session", () => {
    const logged = [{ done: true, reps: 8, weight: 60 }, { done: true, reps: 8, weight: 60 }, { done: true, reps: 6, weight: 60 }];
    const ex = { name: "Chest Press", sets: 2, adaptivePrescription: { targetSets: 2 } };
    expect(reconcileExerciseSets(ex, logged)).toHaveLength(3);
    expect(reconcileExerciseSets(ex, [...logged, { reps: "", weight: "" }])).toHaveLength(3);
  });
});
