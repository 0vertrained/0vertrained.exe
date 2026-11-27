import { describe, expect, it } from "vitest";
import { buildProgramPlan } from "../programBuilder";
import { getLoggedCardioBlocks } from "../loadModel";
import { detailWrites, fillWrites, planHealthFills, planRunDetails } from "../watch/healthRuns";
import { runSchedule, runWorkoutsFor } from "../watch/runWorkouts";

const monday = "2026-11-23";
const intervalDay = activity => buildProgramPlan({ goal: "cardio_only", cardioModality: activity, trainingDaysPerWeek: 4,
  experience: "intermediate", sessionLength: 30, includeIntervals: true }).program;

describe("Watch cardio planning", () => {
  it.each(["run", "walk", "bike", "row", "elliptical", "stair", "hike", "rope", "cross", "spin"])("builds %s efforts with all work and recovery minutes", activity => {
    const week = runSchedule(intervalDay(activity), monday, { now: new Date(monday + "T06:00:00") });
    expect(week.length).toBe(4);
    expect(week.every(spec => spec.activity === (activity === "spin" ? "bike" : activity))).toBe(true);
    const intervals = week.find(spec => spec.warmup);
    const seconds = intervals.warmup.goal.seconds + intervals.cooldown.goal.seconds +
      intervals.blocks.reduce((total, block) => total + block.iterations * block.steps.reduce((sum, step) => sum + step.goal.seconds, 0), 0);
    expect(seconds).toBe(1800);
    expect(intervals.blocks[0].steps[0].alert).toEqual({ kind: "hrZone", zone: 4 });
    if (activity === "stair" || activity === "spin") expect(intervals.location).toBe("indoor");
  });
  it("recognizes a named stair climber in a pre-modality program", () => {
    const [spec] = runWorkoutsFor({ Monday: { cardio: { type: "StairMaster intervals", minutes: 30 } } }, monday);
    expect(spec).toMatchObject({ activity: "stair", location: "indoor" });
  });
});

const two = { Monday: { sessions: [
  { id: "am", timeOfDay: "morning", cardio: { modality: "run", type: "Morning intervals", minutes: 30 } },
  { id: "pm", timeOfDay: "evening", cardio: { modality: "run", type: "Evening jog", minutes: 20 } },
] } };
const observed = (id, activity, hour) => ({ id, activity, date: monday, start: monday + "T" + hour + ":00", seconds: 1800, meters: activity === "run" ? 3000 : 0 });
describe("Health workout identity", () => {
  it("matches two runs to different sessions by the WorkoutKit plan ID, even in reverse order", () => {
    const [am, pm] = runWorkoutsFor(two, monday);
    const first = { ...observed("a", "run", "07:10"), planId: am.id.toUpperCase() };
    const later = { ...observed("b", "run", "17:10"), planId: pm.id };
    const { fills } = planHealthFills({ program: two, runs: [later, first] });
    expect(fills.map(fill => [fill.path, fill.activityRefs[0].id, fill.plannedSeconds])).toEqual([
      ["workout.cardioSessions.am", "a", 1800], ["workout.cardioSessions.pm", "b", 1200]]);
    expect(planRunDetails({ runs: [first, later], filled: fills }).map(plan => plan.path)).toEqual(fills.map(fill => fill.path));
    expect(detailWrites({ effort: { value: 7 } }, fills[1].path).map(write => write.path)).toContain("workout.cardioSessions.pm.effortScore");
  });
  it("imports a later stair session separately and preserves the morning ride and Health IDs on retry", () => {
    const early = observed("bike-id", "bike", "08:10"), later = observed("stair-id", "stair", "18:00");
    const [ride, stairs] = planHealthFills({ runs: [later, early] }).fills;
    expect(stairs.path).toMatch(/^workout\.cardioSessions\.apple-/);
    expect(fillWrites(stairs)).toContainEqual({ path: stairs.path + ".modality", value: "stair" });
    expect(stairs).toMatchObject({ type: "Stair stepper", miles: "", time: "30:00", pace: "" });
    const workout = { cardio: ride, cardioSessions: { [stairs.path.split(".").pop()]: stairs } };
    expect(getLoggedCardioBlocks(workout)).toHaveLength(2);
    expect(planHealthFills({ runs: [early, later], data: { [monday]: { workout } } }).fills).toEqual([]);
  });
});

it("preserves an existing manually logged effort alongside an unrelated extra Health workout", () => {
  const manual = { modality: "run", time: "28:00", miles: "3" };
  const result = planHealthFills({ runs: [observed("stairs", "stair", "19:00")],
    data: { [monday]: { workout: { cardio: manual } } } });
  const extra = result.fills[0];
  expect(extra.path).toMatch(/^workout\.cardioSessions\.apple-/);
  expect(getLoggedCardioBlocks({ cardio: manual, cardioSessions: { [extra.path.split(".").pop()]: extra } })).toHaveLength(2);
});

it("stores measured work and recovery step timings under the correct workout", () => {
  expect(detailWrites({ segments: [
    { label: "Work", seconds: 70, targetSeconds: 90 }, { label: "Recover", seconds: 30 }, { seconds: 0 },
  ] }, "workout.cardioSessions.pm", "stair")).toEqual([{ path: "workout.cardioSessions.pm.segments", value: [
    { label: "Work", seconds: 70, targetSeconds: 90 }, { label: "Recover", seconds: 30 },
  ] }]);
});
