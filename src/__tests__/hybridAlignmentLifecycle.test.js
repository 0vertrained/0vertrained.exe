import { describe, expect, it } from "vitest";
import { defaultDay, presetProgram } from "../constants";
import { previewHybridRaceAlignment, changeHybridRacePlan } from "../hybridRaceAlignment";
import { startRoadTrailHybrid, describeRoadTrailWeek } from "../plans/roadTrailHybrid";
import { applyRaceBuild, describeBuildWeek, racePlanOn } from "../raceBuild";
import { swapDays } from "../weekMoves";

const friday = "2026-11-27";
const monday = "2027-01-11";
const race = { kind: "runPlan", raceDate: "2027-01-31", startDate: friday, longRunDay: "Sunday",
  raceName: "Hill Country 10K", distance: "10k", runsPerWeek: 4 };
const base = { ...startRoadTrailHybrid(presetProgram("roadTrailHybrid"), friday), __raceBuild: race };
const aligned = () => previewHybridRaceAlignment({ program: base, todayKey: friday }).program;

describe("race alignment decisions", () => {
  it.each([
    { sessionState: { am: { status: "active" } } },
    { whoopHeartRate: { "cardio-main": { count: 12 } } },
    { watchWorkouts: [{ workoutID: "abc" }] },
    { cardioSessions: { pm: { time: "28:30" } } },
  ])("keeps the current day after training has begun", workout => {
    expect(previewHybridRaceAlignment({ program: base, todayKey: friday, entries: { [friday]: { workout } } }).effectiveDate)
      .toBe("2026-11-28");
  });

  it("keeps a scheduled rest or a daily check-in eligible for changes today", () => {
    expect(previewHybridRaceAlignment({ program: base, todayKey: friday, entries: { [friday]: defaultDay() } }).effectiveDate).toBe(friday);
  });

  it("can apply and cancel on the same date without accumulating changes", () => {
    const original = structuredClone(base);
    const yes = aligned();
    expect(previewHybridRaceAlignment({ program: yes, todayKey: friday })).toBeNull();
    const undo = previewHybridRaceAlignment({ program: yes, todayKey: friday, align: false });
    expect(undo.program.__hybridBlock.alignments).toEqual([{ effectiveDate: friday, raceDate: null }]);
    expect(undo.program.__raceBuild).toEqual(race);
    expect(base).toEqual(original);
  });

  it("preserves a logged day's prior race and lifts when the event changes, including a second edit on the same day", () => {
    const before = aligned();
    const entries = { [monday]: { workout: { sessionState: { am: { startedAt: monday } } } } };
    const other = { ...race, raceName: "Lakeside 10K", raceDate: "2027-02-06" };
    const first = changeHybridRacePlan(before, other, entries, monday);
    const final = changeHybridRacePlan(first, { ...other, runsPerWeek: 3 }, entries, monday);
    expect(final.__hybridBlock.priorRacePlans).toEqual([{ until: monday, spec: race }]);
    expect(describeBuildWeek(final, monday).raceDate).toBe(race.raceDate);
    expect(describeRoadTrailWeek(final, monday).raceDate).toBe(race.raceDate);
    expect(applyRaceBuild(final, monday).Monday).toEqual(applyRaceBuild(before, monday).Monday);
    expect(describeRoadTrailWeek(final, "2027-01-12")).toMatchObject({ aligned: false, raceDate: "2027-01-16" });
    expect(describeBuildWeek(final, "2027-01-12").raceDate).toBe(other.raceDate);
    expect(previewHybridRaceAlignment({ program: final, entries, todayKey: monday }).raceDate).toBe(other.raceDate);
  });

  it("updates the accepted race name, and ends the overlay only prospectively", () => {
    const renamed = changeHybridRacePlan(aligned(), { ...race, raceName: "New event name" }, {}, monday);
    expect(describeRoadTrailWeek(renamed, "2027-01-10").raceName).toBe(race.raceName);
    expect(describeRoadTrailWeek(renamed, monday)).toMatchObject({ aligned: true, raceName: "New event name" });
    const ended = changeHybridRacePlan(renamed, null, {}, "2027-01-13");
    expect(racePlanOn(ended, "2027-01-12").raceName).toBe("New event name");
    expect(describeBuildWeek(ended, "2027-01-13")).toBeNull();
    expect(previewHybridRaceAlignment({ program: ended, todayKey: "2027-01-14" })).toBeNull();
  });

  it("keeps a race already moved into history from being scheduled a second time", () => {
    const moved = swapDays(base, "2027-01-27", "Wednesday", "Sunday");
    expect(applyRaceBuild(moved, "2027-01-28").Wednesday.cardio.planRole).toBe("race");
    expect(previewHybridRaceAlignment({ program: moved, todayKey: "2027-01-28" })).toBeNull();
  });

  it("only offers alignment for a valid linked event on or after the start", () => {
    for (const linked of [undefined, "raceBuild50k", { ...race, raceDate: "2026-02-30" }]) {
      expect(previewHybridRaceAlignment({ program: { ...base, __raceBuild: linked }, todayKey: friday })).toBeNull();
    }
    expect(previewHybridRaceAlignment({ program: base, todayKey: "2027-02-01" })).toBeNull();
  });
});
