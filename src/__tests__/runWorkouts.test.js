// src/__tests__/runWorkouts.test.js
// Planned runs become workouts for the watch's Workout app: the plan's steps
// with time or distance goals, pace alerts from the race plan's zones, a
// heart-rate zone cue without them, and an id that only changes when the run
// does.
import { describe, expect, it } from "vitest";
import { DEFAULT_PROGRAM } from "../constants";
import { alertFor, runSchedule, runStructure, runSummary, runWorkoutsFor, stableUuid } from "../watch/runWorkouts";

const zones = {
  easy: { fast: 611, slow: 672 },
  threshold: 509,
  interval: 480,
  repetition: 455,
  race: { "10k": 492 },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// A generated 10K plan from a 25:00 5K: runs Saturday, Monday, Tuesday and
// Wednesday from the week of 2026-11-23.
const racePlan = {
  ...DEFAULT_PROGRAM,
  __raceBuild: {
    kind: "runPlan", v: 1, distance: "10k", raceDate: "2027-01-09", startDate: "2026-11-23",
    runsPerWeek: 4, longRunDay: "Saturday", qualityDay: "Wednesday", crossTraining: "none",
    startLongRunMin: 45, benchmark: { distance: "5k", seconds: 1500 }, benchmarkTest: "none", raceName: "10K",
  },
};

describe("alertFor", () => {
  it("gives easy steps the easy pace range", () => {
    expect(alertFor("easy", { zones })).toEqual({ kind: "pace", fast: 611, slow: 672 });
  });

  it("puts a band around a single target pace", () => {
    expect(alertFor("threshold", { zones })).toEqual({ kind: "pace", fast: 501, slow: 517 });
    expect(alertFor("race", { zones, raceDistance: "10k" })).toEqual({ kind: "pace", fast: 486, slow: 498 });
  });

  it("leaves jogs and fartleks to feel", () => {
    expect(alertFor("jog", { zones })).toBeNull();
    expect(alertFor("fartlek", { zones })).toBeNull();
  });

  it("cues by heart-rate zone when there are no paces", () => {
    expect(alertFor("easy")).toEqual({ kind: "hrZone", zone: 2 });
    expect(alertFor("interval")).toEqual({ kind: "hrZone", zone: 4 });
    expect(alertFor("race")).toBeNull();
  });
});

describe("runStructure", () => {
  it("turns warm-up, repeats and cool-down into the Workout app's shape", () => {
    const structure = runStructure({
      type: "Threshold Run",
      steps: [
        { kind: "warmup", minutes: 10, intensity: "easy" },
        { kind: "repeat", reps: 3, work: { minutes: 5, intensity: "threshold" }, recovery: { minutes: 2, intensity: "jog" } },
        { kind: "cooldown", minutes: 10, intensity: "easy" },
      ],
    }, { zones });
    expect(structure).toEqual({
      warmup: { goal: { kind: "time", seconds: 600 }, alert: null },
      blocks: [{
        iterations: 3,
        steps: [
          { purpose: "work", goal: { kind: "time", seconds: 300 }, alert: { kind: "pace", fast: 501, slow: 517 } },
          { purpose: "recovery", goal: { kind: "time", seconds: 120 }, alert: null },
        ],
      }],
      cooldown: { goal: { kind: "time", seconds: 600 }, alert: null },
    });
  });

  it("runs strides, a race and plain runs as blocks", () => {
    const structure = runStructure({
      type: "RACE — 10K",
      steps: [
        { kind: "warmup", minutes: 10, intensity: "easy" },
        { kind: "strides", reps: 4, seconds: 20 },
        { kind: "race", distance: "10k" },
      ],
    }, { zones, raceDistance: "10k" });
    expect(structure.cooldown).toBeNull();
    expect(structure.blocks).toEqual([
      { iterations: 4, steps: [
        { purpose: "work", goal: { kind: "time", seconds: 20 }, alert: null },
        { purpose: "recovery", goal: { kind: "time", seconds: 60 }, alert: null },
      ] },
      { iterations: 1, steps: [{ purpose: "work", goal: { kind: "distance", meters: 10000 }, alert: { kind: "pace", fast: 486, slow: 498 } }] },
    ]);
  });

  it("reads intervals from the notes of a run without steps", () => {
    const structure = runStructure(DEFAULT_PROGRAM.Thursday.cardio);
    expect(structure.warmup).toEqual({ goal: { kind: "time", seconds: 300 }, alert: null });
    expect(structure.blocks).toEqual([{ iterations: 4, steps: [
      { purpose: "work", goal: { kind: "time", seconds: 240 }, alert: { kind: "hrZone", zone: 4 } },
      { purpose: "recovery", goal: { kind: "time", seconds: 180 }, alert: null },
    ] }]);
  });

  it("makes an easy run without steps one stretch by distance", () => {
    expect(runStructure({ type: "Long Run", miles: 5.5, effort: "Zone 2" })).toEqual({
      warmup: null,
      blocks: [{ iterations: 1, steps: [{ purpose: "work", goal: { kind: "distance", meters: 8851 }, alert: { kind: "hrZone", zone: 2 } }] }],
      cooldown: null,
    });
  });

  it("leaves a run with nothing to go on open", () => {
    expect(runStructure({ type: "Shakeout" }).blocks[0].steps[0].goal).toEqual({ kind: "open" });
    expect(runStructure(null)).toBeNull();
  });
});

describe("runSummary", () => {
  it("reads as amount and target", () => {
    expect(runSummary({ minutes: 35, targetPace: "10:11–11:12/mi", effort: "Easy" })).toBe("35 min · 10:11–11:12/mi");
    expect(runSummary({ miles: 5.5, effort: "Zone 2" })).toBe("5.5 mi · Zone 2");
    expect(runSummary({})).toBe("");
  });
});

describe("stableUuid", () => {
  it("is a UUID that only changes when the text does", () => {
    const id = stableUuid("Easy Run on 2026-11-30");
    expect(id).toMatch(UUID);
    expect(stableUuid("Easy Run on 2026-11-30")).toBe(id);
    expect(stableUuid("Easy Run on 2026-12-01")).not.toBe(id);
  });
});

describe("runWorkoutsFor", () => {
  it("builds the day's planned runs with the race plan's paces", () => {
    const [run] = runWorkoutsFor(racePlan, "2026-12-02");
    expect(run).toMatchObject({ date: "2026-12-02", time: "07:00", name: "Threshold Run", summary: "39 min · 8:29/mi", location: "outdoor" });
    expect(run.id).toMatch(UUID);
    expect(run.blocks[0].steps[0].alert).toEqual({ kind: "pace", fast: 501, slow: 517 });
  });

  it("has nothing for a day without a run", () => {
    expect(runWorkoutsFor(racePlan, "2026-11-26")).toEqual([]);
    expect(runWorkoutsFor(racePlan, "not a day")).toEqual([]);
  });

  it("gives a changed run a new id", () => {
    const [before] = runWorkoutsFor(racePlan, "2026-12-01");
    const shorter = { ...racePlan, __raceBuild: { ...racePlan.__raceBuild, startLongRunMin: 30 } };
    const [after] = runWorkoutsFor(shorter, "2026-12-01");
    expect(after.id).not.toBe(before.id);
    expect(runWorkoutsFor(racePlan, "2026-12-01")[0].id).toBe(before.id);
  });
});

describe("runSchedule", () => {
  it("covers today and the next six days", () => {
    const runs = runSchedule(racePlan, "2026-11-26", { now: new Date("2026-11-26T06:00:00") });
    expect(runs.map((run) => run.date)).toEqual(["2026-11-28", "2026-11-30", "2026-12-01", "2026-12-02"]);
  });

  it("moves a run whose start has passed today to the next quarter hour", () => {
    const [run] = runSchedule(DEFAULT_PROGRAM, "2026-11-26", { now: new Date("2026-11-26T11:31:00") });
    expect(run).toMatchObject({ date: "2026-11-26", time: "11:45" });
    const [early] = runSchedule(DEFAULT_PROGRAM, "2026-11-26", { now: new Date("2026-11-26T06:10:00") });
    expect(early.time).toBe("07:00");
  });

  it("keeps a run's id when only its start time moves", () => {
    const [morning] = runSchedule(DEFAULT_PROGRAM, "2026-11-26", { now: new Date("2026-11-26T06:00:00") });
    const [noon] = runSchedule(DEFAULT_PROGRAM, "2026-11-26", { now: new Date("2026-11-26T12:00:00") });
    expect(noon.id).toBe(morning.id);
  });
});
