// src/__tests__/watchPlan.test.js
// The watch's plan carries what the runner would show for each set, and the
// sets the watch sends back are written as the runner writes them: once,
// only when valid, and only for an exercise still in that day's program.
import { describe, expect, it } from "vitest";
import { DAYS } from "../constants";
import { applyWatchEvents, buildWatchPlan, parseWatchEvent } from "../watch/watchPlan";
import { proposeSet } from "../workout/setFill";
import { buildExercisePrescription } from "../progressionEngine";
import { lastSessionSets } from "../setGhosts";
import { reconcileExerciseSets } from "../workoutLogging";

const DAY = "2026-11-26"; // a Thursday
const LAST_WEEK = "2026-11-19";
const upper = {
  type: "Upper B",
  lifting: [
    { name: "Bench Press", sets: 3, reps: 8 },
    { name: "Plank", sets: 2, reps: 45 },
  ],
  cardio: null,
};
const program = Object.fromEntries(DAYS.map((day) => [day, day === "Thursday" ? upper : { type: "Rest", lifting: [], cardio: null }]));

const lastWeek = {
  workout: {
    exercises: {
      "Bench Press": { sets: [
        { weight: "185", reps: "8", done: true },
        { weight: "185", reps: "8", done: true },
        { weight: "185", reps: "7", done: true },
      ] },
    },
  },
};

const setEvent = (id, setIndex, values, extra = {}) => JSON.stringify({
  v: 1, type: "set", id, date: DAY, session: "main", exercise: "Bench Press", setIndex, values, at: `2026-11-26T15:0${setIndex}:00.000Z`, ...extra,
});

describe("buildWatchPlan", () => {
  it("sends the day's lifting with the runner's numbers for every open set", () => {
    const data = { [LAST_WEEK]: lastWeek };
    const plan = buildWatchPlan({ data, program, dateKey: DAY, sentAt: "2026-11-26T14:00:00.000Z" });
    expect(plan).toMatchObject({ v: 1, date: DAY, title: "Thursday", sentAt: "2026-11-26T14:00:00.000Z", seen: [] });
    expect(plan.sessions).toHaveLength(1);
    expect(plan.sessions[0]).toMatchObject({ id: "main", title: "Upper B" });

    const bench = plan.sessions[0].exercises[0];
    expect(bench).toMatchObject({ name: "Bench Press", display: "Bench Press", restSeconds: 120 });
    expect(bench.fields.map((field) => [field.prop, field.unit, field.step, field.required])).toEqual([
      ["weight", "lb", 5, true],
      ["reps", "reps", 1, true],
    ]);

    const exercise = upper.lifting[0];
    const sets = reconcileExerciseSets(exercise, []);
    const prescription = buildExercisePrescription({ data, exercise, todayKey: DAY });
    const lastRaw = lastSessionSets(data, "Bench Press", DAY);
    const expected = proposeSet({ set: sets[0], setIndex: 0, sets, exercise, prescription, lastRaw });
    expect(bench.sets[0]).toMatchObject({ done: false, source: expected.source.key, sourceLabel: expected.source.name });
    expect(bench.sets[0].values).toEqual({
      weight: Number(expected.set.weight),
      reps: Number(expected.set.reps),
    });
  });

  it("marks logged sets done with their numbers, and timed holds get seconds", () => {
    const data = { [DAY]: { workout: { exercises: { "Bench Press": { sets: [{ weight: "190", reps: "8", done: true }] } } } } };
    const plan = buildWatchPlan({ data, program, dateKey: DAY });
    const [bench, plank] = plan.sessions[0].exercises;
    expect(bench.sets[0]).toEqual({ done: true, values: { weight: 190, reps: 8 } });
    expect(bench.sets[1].done).toBe(false);
    expect(plank.fields.map((field) => [field.prop, field.unit, field.required])).toEqual([
      ["duration", "sec", true],
      ["weight", "lb added", false],
    ]);
  });

  it("has no sessions on a day with no lifting", () => {
    const plan = buildWatchPlan({ data: {}, program, dateKey: "2026-11-27" });
    expect(plan.sessions).toEqual([]);
  });
});

describe("applyWatchEvents", () => {
  it("writes a logged set the way the runner does", () => {
    const result = applyWatchEvents({ data: {}, program, events: [setEvent("a", 0, { weight: 185, reps: 8 })] });
    expect(result.processed).toEqual(["a"]);
    expect(result.applied).toBe(1);
    expect(result.writes).toHaveLength(1);
    const [write] = result.writes;
    expect(write).toMatchObject({ dateKey: DAY, path: "workout.exercises.Bench Press" });
    expect(write.value.sets[0]).toMatchObject({ weight: "185", reps: "8", done: true, completedAt: "2026-11-26T15:00:00.000Z" });
    expect(write.value.sets).toHaveLength(3);
    expect(write.value.progressionDecision).toBeTruthy();
    expect(result.days[DAY].workout.exercises["Bench Press"]).toBe(write.value);
  });

  it("applies a batch in order, so the last write holds every set", () => {
    const events = [setEvent("a", 0, { weight: 185, reps: 8 }), setEvent("b", 1, { weight: 185, reps: 7 })];
    const result = applyWatchEvents({ data: {}, program, events });
    expect(result.writes).toHaveLength(1);
    expect(result.writes[0].value.sets.map((set) => set.done === true)).toEqual([true, true, false]);
  });

  it("sets aside a set the phone already has, a set that can't be valid, and an exercise no longer planned", () => {
    const data = { [DAY]: { workout: { exercises: { "Bench Press": { sets: [{ weight: "190", reps: "8", done: true }] } } } } };
    const events = [
      setEvent("dup", 0, { weight: 185, reps: 8 }),
      setEvent("zero", 1, { weight: 185, reps: 0 }),
      setEvent("gone", 0, { weight: 50, reps: 10 }, { exercise: "Cable Fly" }),
      setEvent("range", 7, { weight: 185, reps: 8 }),
    ];
    const result = applyWatchEvents({ data, program, events });
    expect(result.processed).toEqual(["dup", "zero", "gone", "range"]);
    expect(result.applied).toBe(0);
    expect(result.writes).toEqual([]);
  });

  it("ignores what it can't read without confirming it", () => {
    const result = applyWatchEvents({ data: {}, program, events: ["{not json", JSON.stringify({ id: "x", type: "set", date: "today" })] });
    expect(result.processed).toEqual([]);
  });

  it("finishes the session only when every exercise is logged or skipped", () => {
    const finish = JSON.stringify({ v: 1, type: "finish", id: "f", date: DAY, at: "2026-11-26T16:00:00.000Z" });
    const partial = applyWatchEvents({ data: {}, program, events: [setEvent("a", 0, { weight: 185, reps: 8 }), finish] });
    expect(partial.writes.map((write) => write.path)).toEqual(["workout.exercises.Bench Press"]);

    const done = (sets) => sets.map((set) => ({ ...set, done: true }));
    const data = { [DAY]: { workout: { exercises: {
      "Bench Press": { sets: done([{ weight: "185", reps: "8" }, { weight: "185", reps: "8" }, { weight: "185", reps: "8" }]) },
      Plank: { skipped: { reason: "time" } },
    } } } };
    const complete = applyWatchEvents({ data, program, events: [finish] });
    expect(complete.writes).toEqual([{
      dateKey: DAY,
      path: "workout.sessionState.main",
      value: { status: "complete", completedAt: "2026-11-26T16:00:00.000Z" },
    }]);
  });
});

describe("parseWatchEvent", () => {
  it("accepts sets and finishes for a real date only", () => {
    expect(parseWatchEvent(setEvent("a", 0, {}))).toMatchObject({ id: "a", type: "set" });
    expect(parseWatchEvent({ id: "a", type: "delete", date: DAY })).toBeNull();
    expect(parseWatchEvent({ id: "", type: "set", date: DAY })).toBeNull();
    expect(parseWatchEvent({ id: "a", type: "set", date: "26/11/2026" })).toBeNull();
  });
});
