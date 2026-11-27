import { describe, expect, it } from "vitest";
import { applyWatchEvents, buildWatchPlan, buildWatchWeek } from "../watch/watchPlan";
import { buildProgramPlan } from "../programBuilder";
import { EXERCISE_LIBRARY } from "../programExerciseLibrary";

const date = "2026-11-26";
const at = "2026-11-27T01:00:00.000Z";
const session = "main";
const exercise = "Barbell Bench Press";
const dumbbell = "Dumbbell Bench Press";
const bench = { name: exercise, sets: 3, reps: 8 };
const row = { name: "Barbell Row", sets: 2, reps: 8 };
const program = { Thursday: { type: "Upper", lifting: [bench, row], cardio: null } };
const data = { "2026-11-19": { workout: { exercises: {
  [exercise]: { sets: [{ weight: "185", reps: "8", done: true }] },
  [dumbbell]: { sets: [{ weight: "50", reps: "7", done: true }] },
} } } };
function event(type, id, extras = {}) { return { type, id, date, at, session, exercise, ...extras }; }
function apply(events, existing = data, schedule = program) {
  return applyWatchEvents({ data: existing, program: schedule, events, currentDateKey: date });
}
const log = result => result.days[date].workout.exercises[exercise];
const swap = event("swap", "s", { performedName: dumbbell });
const first = event("set", "one", { setIndex: 0, performedName: dumbbell, values: { weight: 50, reps: 8 } });
const undo = event("undo", "u", { setIndex: 0, targetID: first.id });

describe("gym actions from the wrist", () => {
  it("offers load-compatible alternatives with their own working weights and a fresh baseline when history is absent", () => {
    const options = buildWatchPlan({ data, program, dateKey: date }).sessions[0].exercises[0].swaps;
    const alt = options.find(v => v.name === dumbbell);
    expect(alt.sets[0].values.weight).toBe(50);
    const fresh = buildWatchPlan({ program, dateKey: date }).sessions[0].exercises[0].swaps.find(v => v.name === dumbbell);
    expect(fresh.sets[0].values.weight).toBeUndefined();
    expect(options.some(v => v.name === "Push-Up")).toBe(false);
  });

  it("records swapped sets under the performed exercise and prevents reassigning logged sets", () => {
    const result = apply([swap, first, event("swap", "late", { at: "2026-11-27T02:00:00Z", performedName: exercise })]);
    expect(result.applied).toBe(2);
    expect(log(result)).toMatchObject({ performedName: dumbbell, sets: [{ watchEventID: "one", done: true, weight: "50" }, {}, {}] });
    expect(log(result).sets[0].progressionTarget?.plan.name).toBe(dumbbell);
  });

  it("keeps new custom-plan alternatives inside the selected equipment and movement pattern", () => {
    const built = buildProgramPlan({ goal: "bodybuilding", equipment: "dumbbells", daysPerWeek: 3 });
    const pool = EXERCISE_LIBRARY.dumbbells;
    let checked = 0;
    Object.values(built.program).forEach(day => day.lifting?.forEach(ex => {
      const matches = Object.values(pool).find(choices => choices.some(choice => choice.name === ex.name));
      for (const swap of ex.swapOptions) {
        expect(matches.some(entry => entry.name === swap)).toBe(true);
        checked++;
      }
    }));
    expect(checked).toBeGreaterThan(0);
  });

  it("uses saved equipment for older custom weeks that were generated without swap options", () => {
    const older = { ...program, Thursday: { ...program.Thursday, lifting: [{ name: "One-Arm DB Row", sets: 3, reps: 8 }],
      adaptivePlan: { version: 1, goal: "bodybuilding", experience: "intermediate" } } };
    const week = buildWatchWeek({ program: older, todayKey: date, days: 1, builderPreferences: { equipment: "dumbbells", experience: "intermediate" } });
    const choices = week.sessions[0].exercises[0].swaps || [];
    expect(choices.every(option => EXERCISE_LIBRARY.dumbbells.horizontalPull.some(ex => ex.name === option.name))).toBe(true);
    expect(choices.some(option => option.name === "Cable Row")).toBe(false);
  });

  it("undoes the identified set and ignores its re-delivery after a correction", () => {
    const correction = { ...first, id: "two", values: { weight: 45, reps: 8 } };
    const result = apply([swap, first, undo, first, correction, undo, first]);
    expect(log(result).sets[0]).toMatchObject({ done: true, watchEventID: "two", weight: "45" });
    expect(log(result).watchUndoneIDs).toEqual(["one"]);
    expect(apply([undo, first], result.days).writes).toEqual([]);
  });

  it("does not remove a phone-entered set, including an undo delivered before its original", () => {
    const entries = { [date]: { workout: { exercises: { [exercise]: { sets: [{ weight: "155", reps: "8", done: true }] } } } } };
    const result = apply([undo, first], entries);
    expect(log(result).sets[0]).toMatchObject({ weight: "155", done: true });
    expect(log(result).watchUndoneIDs).toContain("one");
  });

  it("lets the watch pair adjacent lifts and the phone send that selection back", () => {
    const pair = event("pair", "ab", { partner: row.name, enabled: true });
    const result = apply([pair, { ...pair, id: "invalid", partner: "other" }]);
    expect(result.applied).toBe(1);
    expect(buildWatchPlan({ program, data: result.days, dateKey: date }).sessions[0].exercises[0].pairNext).toBe(true);
    expect(apply([{ ...pair, id: "off", at: "2026-11-27T02:00:00Z", enabled: false }], result.days).days[date].workout.exercises[exercise].pairNext).toBe(false);
  });

  it("retains a pinned lift if the iPhone schedule changed before reconnect", () => {
    const different = { Thursday: { type: "Rest", lifting: [], cardio: null } };
    const offlinePlan = { sessions: [{ id: session, exercises: [{ name: exercise, display: dumbbell, swaps: [exercise], fields: ["weight", "reps"], count: 1, reps: 8 }] }] };
    const extra = { workoutID: "workout-one", offlinePlan };
    const result = apply([{ ...first, ...extra }, event("finish", "done", extra)], {}, different);
    expect(log(result)).toMatchObject({ performedName: dumbbell, sets: [{ weight: "50", done: true }] });
    expect(result.days[date].workout.added).toContainEqual(expect.objectContaining({ name: exercise, session }));
    expect(result.days[date].workout.sessionState.main.status).toBe("complete");
  });
});
