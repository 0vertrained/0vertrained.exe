// src/__tests__/watchPlan.test.js
// The watch's plan carries what the runner would show for each set, and the
// sets the watch sends back are written as the runner writes them: once,
// only when valid, and only for an exercise still in that day's program.
import { describe, expect, it } from "vitest";
import { DAYS } from "../constants";
import { applyWatchEvents, buildWatchPlan, buildWatchWeek, parseWatchEvent } from "../watch/watchPlan";
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
  it("sends each top and back-off target in its own set slot", () => {
    const sets = [135, 105, 105].map(weight => ({ weight: String(weight), reps: "8", done: true }));
    const data = { [LAST_WEEK]: { workout: { exercises: { "Bench Press": { sets } } } } };
    const plan = buildWatchPlan({ data, program, dateKey: DAY });
    expect(plan.sessions[0].exercises[0].sets.map(set => Number(set.values.weight))).toEqual([140, 110, 110]);
  });

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

  it("carries an exercise added for the day, and takes its sets back", () => {
    const data = { [DAY]: { workout: { exercises: {}, added: [{ name: "Cable Fly", sets: 2, reps: 12, session: "main" }] } } };
    const plan = buildWatchPlan({ data, program, dateKey: DAY });
    expect(plan.sessions[0].exercises.map((exercise) => exercise.name)).toEqual(["Bench Press", "Plank", "Cable Fly"]);

    const event = JSON.stringify({ v: 1, type: "set", id: "fly-0", date: DAY, session: "main", exercise: "Cable Fly", setIndex: 0, values: { weight: 30, reps: 12 }, at: "2026-11-26T15:10:00.000Z" });
    const result = applyWatchEvents({ data, program, events: [event] });
    expect(result.applied).toBe(1);
    expect(program.Thursday.lifting).toHaveLength(2);
  });

  it("has no sessions on a day with no lifting", () => {
    const plan = buildWatchPlan({ data: {}, program, dateKey: "2026-11-27" });
    expect(plan.sessions).toEqual([]);
  });
});

describe("adaptive custom plans on Watch", () => {
  const bench = { ...upper.lifting[0], repMin: 6, rir: 2, restSeconds: 180 };
  const authored = { ...upper, lifting: [bench], adaptivePlan: { version: 1, goal: "strength", experience: "intermediate" } };
  const custom = { ...program, Thursday: authored, Friday: authored };
  const frozen = { dateKey: DAY, day: { ...authored, adaptation: { dateKey: DAY, status: "reduce" }, lifting: [{ ...bench, sets: 2,
    adaptivePrescription: { exerciseName: bench.name, kind: "hold_for_quality", mode: "loaded_reps",
      targetSets: 2, baseSets: 3, repRange: { min: 6, max: 8 }, targetWeight: 150, targetReps: [6, 6] } }] } };

  it("sends frozen weights and effort prompts while future days keep their own work sets", () => {
    const data = { [DAY]: { workout: { customPlanSnapshot: frozen } } };
    const week = buildWatchWeek({ data, program: custom, todayKey: DAY, wearableScore: 10, days: 2 });
    expect(week.days[0].sessions[0].exercises[0]).toMatchObject({ targetRir: "2", sets: [
      { values: { weight: 150, reps: 6 } }, { values: { weight: 150, reps: 6 } },
    ] });
    expect(week.days[1].sessions[0].exercises[0].sets).toHaveLength(3);
  });

  it("a shared rest verdict also clears the day's planned run on the watch", () => {
    const mixed = { ...custom, Thursday: { ...authored, cardio: { type: "Easy Run", miles: 2, effort: "Easy" } } };
    const watch = buildWatchWeek({ program: mixed, todayKey: DAY, readiness: "rest" });
    expect(watch.sessions).toEqual([]);
    expect(watch.runs).toEqual([]);
    expect(watch.days[1].sessions[0].exercises).toHaveLength(1);
  });

  it("keeps late extra sets beyond the recovered budget and distinguishes zero RIR from unrecorded", () => {
    const data = { [DAY]: { workout: { customPlanSnapshot: frozen } } };
    const events = [setEvent("last", 2, { weight: 155, reps: 6, rir: 0 }), setEvent("first", 0, { weight: 155, reps: 7 }),
      setEvent("off-plan", 9, { weight: 155, reps: 7 })];
    const result = applyWatchEvents({ data, program: custom, currentDateKey: "2026-11-27", events });
    const sets = result.days[DAY].workout.exercises["Bench Press"].sets;
    expect(result.applied).toBe(2);
    expect(sets).toHaveLength(3);
    expect(sets[2]).toMatchObject({ done: true, reps: "6", rir: "0" });
    expect(sets[0].rir).toBe("");
  });

  it("freezes a snapshot only when the watch logs a valid set", () => {
    const invalid = setEvent("invalid", 0, { reps: 8 });
    const event = setEvent("accepted", 0, { weight: 100, reps: 8, rir: 2 });
    expect(applyWatchEvents({ program: custom, currentDateKey: DAY, events: [invalid] }).writes).toHaveLength(0);
    const result = applyWatchEvents({ program: custom, currentDateKey: DAY, events: [invalid, event] });
    expect(result.days[DAY].workout.customPlanSnapshot.day.adaptation.dateKey).toBe(DAY);
    expect(result.days[DAY].workout.exercises["Bench Press"].sets[0].rir).toBe("2");
  });

  it("records a legitimate offline set even if the phone now recommends rest", () => {
    const data = { [DAY]: { intelligence: { physiqueOS: { safetyFlag: true } } } };
    expect(buildWatchWeek({ data, program: custom, todayKey: DAY, days: 1 }).sessions).toHaveLength(0);
    const result = applyWatchEvents({ data, program: custom, currentDateKey: DAY,
      events: [setEvent("done", 0, { weight: 155, reps: 6 })] });
    expect(result.applied).toBe(1);
    expect(result.days[DAY].workout.customPlanSnapshot.day.adaptation.status).toBe("safety");
    const watched = buildWatchPlan({ data: result.days, program: custom, dateKey: DAY });
    expect(watched.sessions[0].exercises[0].sets).toHaveLength(1);
    expect(watched.sessions[0].exercises[0].sets[0].done).toBe(true);
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

describe("the watch's workout numbers", () => {
  const finish = (id, extra = {}) => JSON.stringify({
    v: 1, type: "finish", id, date: DAY, at: "2026-11-26T17:00:00.000Z",
    startedAt: "2026-11-26T16:05:00.000Z", durationSeconds: 3300, averageHeartRate: 127.6, activeEnergy: 412.4, ...extra,
  });

  it("keeps the time, heart rate and calories on the day once per workout", () => {
    const first = applyWatchEvents({ data: {}, program, events: [finish("w1")] });
    const kept = first.writes.find((write) => write.path === "workout.watchWorkouts");
    expect(kept.value).toEqual([{
      id: "w1", startedAt: "2026-11-26T16:05:00.000Z", endedAt: "2026-11-26T17:00:00.000Z", seconds: 3300, avgHr: 128, kcal: 412,
    }]);
    expect(first.applied).toBe(1);

    const again = applyWatchEvents({ data: first.days, program, events: [finish("w1")] });
    expect(again.writes).toEqual([]);
    const second = applyWatchEvents({ data: first.days, program, events: [finish("w2", { averageHeartRate: null })] });
    expect(second.writes[0].value.map((workout) => workout.id)).toEqual(["w1", "w2"]);
    expect(second.writes[0].value[1]).toMatchObject({ avgHr: null, kcal: 412 });
  });

  it("keeps nothing from an older watch build that sends no duration", () => {
    const result = applyWatchEvents({ data: {}, program, events: [finish("w1", { durationSeconds: undefined })] });
    expect(result.writes.some((write) => write.path === "workout.watchWorkouts")).toBe(false);
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

describe("buildWatchWeek", () => {
  it("sends today and the next six days, with what the phone has dealt with once", () => {
    const week = buildWatchWeek({ data: {}, program, todayKey: DAY, sentAt: "2026-11-26T14:00:00.000Z", seen: ["a"] });
    expect(week).toMatchObject({ week: 1, sentAt: "2026-11-26T14:00:00.000Z", seen: ["a"] });
    expect(week.days.map((day) => day.date)).toEqual([
      "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29", "2026-11-30", "2026-12-01", "2026-12-02",
    ]);
    expect(week.days[0].sessions[0].title).toBe("Upper B");
    expect(week.days[1].sessions).toEqual([]);
    for (const day of week.days) {
      expect(day).not.toHaveProperty("seen");
      expect(day).not.toHaveProperty("sentAt");
    }
  });

  it("is today's plan at the top, for a watch app built before weeks", () => {
    const week = buildWatchWeek({ data: {}, program, todayKey: DAY, sentAt: "2026-11-26T14:00:00.000Z", seen: ["a"] });
    const today = buildWatchPlan({ data: {}, program, dateKey: DAY, sentAt: "2026-11-26T14:00:00.000Z", seen: ["a"] });
    const { days, week: version, ...top } = week;
    expect(top).toEqual(today);
    expect(version).toBe(1);
    expect(days[0]).toEqual(expect.objectContaining({ date: DAY, sessions: today.sessions }));
  });

  it("works each day out from the log as it stands", () => {
    const week = buildWatchWeek({ data: {}, program, todayKey: "2026-11-20" });
    const thursday = week.days.find((day) => day.date === DAY);
    expect(thursday).toEqual(expect.objectContaining({ title: "Thursday" }));
    expect(thursday.sessions[0].exercises[0].name).toBe("Bench Press");
  });
});


describe("Watch lifting guidance", () => {
  const prescribed = { ...program, Thursday: { ...upper, lifting: [
    { ...upper.lifting[0], rir: 2 }, { name: "Machine Chest Press", reps: 8, sets: 3 },
  ] } };
  const data = { [LAST_WEEK]: lastWeek };
  const warmup = (id, enabled, at, extra = {}) => ({ id, type: "warmup", date: DAY, session: "main",
    exercise: "Bench Press", performedName: "Bench Press", workingWeight: 225, setIndex: 1, enabled, at, ...extra });

  it("preserves the prescribed target beside the editable entry and records preset RIR, including zero", () => {
    const actual = { ...data, [DAY]: { workout: { exercises: { "Bench Press": { sets: [{ weight: "170", reps: "7" }] } } } } };
    const bench = buildWatchPlan({ program: prescribed, data: actual, dateKey: DAY }).sessions[0].exercises[0];
    expect(bench).toMatchObject({ barbell: true, targetRir: "2" });
    expect(bench.sets[0].values).toEqual({ weight: 170, reps: 7 });
    expect(bench.sets[0].target.weight).toBeGreaterThan(170);
    const event = setEvent("preset-rir", 0, { weight: 170, reps: 7, rir: 0 });
    const result = applyWatchEvents({ program: prescribed, data: actual, events: [event] });
    const logged = result.days[DAY].workout.exercises["Bench Press"].sets[0];
    expect(logged).toMatchObject({ done: true, rir: "0" });
    expect(buildWatchPlan({ program: prescribed, data: result.days, dateKey: DAY }).sessions[0]
      .exercises[0].sets[0].values.rir).toBe(0);
  });

  it("can replay offline warm-ups and corrections without creating working sets or completing the session", () => {
    const tick = warmup("tick", true, "2026-11-26T07:00:01Z");
    const undo = warmup("untick", false, "2026-11-26T07:01:01Z");
    const stale = warmup("stale", true, "2026-11-26T07:00:45Z");
    const otherLoad = warmup("lighter", true, "2026-11-26T07:00:50Z", { workingWeight: 185 });
    const result = applyWatchEvents({ program: prescribed, data, events: [tick, undo, tick, stale, otherLoad] });
    expect(result.applied).toBe(3);
    const log = result.days[DAY].workout.exercises["Bench Press"];
    expect(log.sets).toBeUndefined();
    expect(log.nextPrescription).toBeUndefined();
    expect(log.warmupSets).toMatchObject([{ weight: 125, reps: 5, done: false }, { weight: 100, reps: 5, done: true }]);
    const plan = buildWatchPlan({ program: prescribed, data: result.days, dateKey: DAY });
    expect(plan.sessions[0].exercises[0].warmupSets).toEqual(log.warmupSets);
    expect(plan.sessions[0].exercises[1].barbell).toBeUndefined();
    expect(plan.barbellRules).toMatchObject({ bar: 45, plates: [45, 35, 25, 10, 5, 2.5] });
    const wrongMovement = warmup("swapped", true, tick.at, { performedName: "Dumbbell Bench Press" });
    const impossibleStep = warmup("invalid", true, tick.at, { workingWeight: 80 });
    expect(applyWatchEvents({ program: prescribed, events: [wrongMovement, impossibleStep] }).applied).toBe(0);

    const pinned = { ...tick, workoutID: "workout-id",
      offlinePlan: { sessions: [{ id: "main", exercises: [{ name: tick.exercise, count: 3, fields: ["weight", "reps"] }] }] } };
    const changed = { ...program, Thursday: { type: "Rest", lifting: [], cardio: null } };
    expect(applyWatchEvents({ program: changed, events: [pinned] }).days[DAY].workout.exercises[tick.exercise]
      .warmupSets[0]).toMatchObject({ done: true, weight: 125, reps: 5 });
  });
});
