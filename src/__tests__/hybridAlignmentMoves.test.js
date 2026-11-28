import { describe, expect, it } from "vitest";
import { shiftDate } from "../coachWindows";
import { getProgramSessions } from "../programSessions";
import { applyRaceBuild, describeBuildWeek } from "../raceBuild";
import { ROAD_TRAIL_HYBRID, startRoadTrailHybrid } from "../plans/roadTrailHybrid";
import { movedFrom, raceMoveLock, swapDays, WEEK_DAYS, weekMovesFor } from "../weekMoves";
import { runWorkoutsFor } from "../watch/runWorkouts";

const start = "2026-11-27";
const saturday = "2027-01-30";
const spec = { kind: "runPlan", raceDate: saturday, raceName: "Snow 10K", distance: "10k", startDate: start,
  runsPerWeek: 4, qualityDay: "Tuesday", longRunDay: "Saturday", benchmarkTest: "none", benchmark: { distance: "5k", seconds: 1400 } };
const block = { ...startRoadTrailHybrid(ROAD_TRAIL_HYBRID.program, start), __raceBuild: spec };
const align = (program, effectiveDate, raceDate = saturday) => ({ ...program, __hybridBlock: { ...program.__hybridBlock,
  alignments: [...(program.__hybridBlock.alignments || []), { effectiveDate, raceDate, raceName: raceDate ? spec.raceName : null }] } });

describe("week moves on a dated hybrid race schedule", () => {
  it("pins the event, taper and recovery while retaining other weekdays in a multi-way swap", () => {
    const monday = "2027-01-25";
    // Monday → Tuesday → Saturday → Monday. Pinning Saturday leaves Monday and Tuesday swapped.
    const swaps = swapDays(swapDays(block, monday, "Monday", "Tuesday"), monday, "Tuesday", "Saturday");
    const program = align(swaps, start);
    expect(weekMovesFor(program, monday)).toEqual({ Monday: "Tuesday", Tuesday: "Monday" });
    expect(movedFrom(program, saturday)).toBeNull();
    expect(raceMoveLock(program, saturday)).toBe("Race day");
    expect(raceMoveLock(program, shiftDate(saturday, -2))).toBe("Race taper");
    expect(raceMoveLock(program, shiftDate(saturday, 1))).toBe("Post-race recovery");
    expect(movedFrom(program, monday)).toBe("Tuesday");
    const week = applyRaceBuild(program, monday);
    const races = WEEK_DAYS.filter(day => getProgramSessions(week[day]).some(session => session.cardio?.planRole === "race"));
    expect(races).toEqual(["Saturday"]);
    expect(swapDays(program, monday, "Monday", "Saturday")).toBe(program);
    expect(swapDays(program, monday, "Wednesday", "Thursday")).toBe(program);
    expect(swapDays(program, monday, "Sunday", "Wednesday")).toBe(program);
    const movedAgain = swapDays(program, monday, "Monday", "Wednesday");
    expect(movedFrom(movedAgain, "2027-01-27")).toBe("Tuesday");
    expect(movedFrom(movedAgain, saturday)).toBeNull();
  });

  it("uses the destination's accepted taper after a midweek acceptance and later restoration", () => {
    const monday = "2027-01-11";
    const moved = swapDays(block, monday, "Monday", "Friday");
    const early = applyRaceBuild(moved, monday);
    const aligned = align(moved, "2027-01-13");
    const expectedAfter = applyRaceBuild(align(moved, start), monday);
    const mixed = applyRaceBuild(aligned, monday);
    expect(mixed.Monday).toEqual(early.Monday);
    expect(mixed.Friday).toEqual(expectedAfter.Friday);
    const rolledBack = align(aligned, "2027-01-15", null);
    const rolled = applyRaceBuild(rolledBack, monday);
    expect(rolled.Monday).toEqual(early.Monday);
    expect(rolled.Thursday).toEqual(expectedAfter.Thursday);
    expect(rolled.Friday).toEqual(early.Friday);
  });

  it("keeps a moved day's workout and Watch paces after the athlete ends an aligned race plan", () => {
    const monday = "2027-01-04";
    const moved = swapDays(align(block, start), monday, "Monday", "Tuesday");
    const ended = align(moved, "2027-01-05", null);
    delete ended.__raceBuild;
    ended.__hybridBlock.priorRacePlans = [{ until: monday, spec }];
    expect(describeBuildWeek(ended, monday)).toEqual(describeBuildWeek(moved, monday));
    expect(describeBuildWeek(ended, "2027-01-05")).toBeNull();
    const old = applyRaceBuild(moved, monday);
    const current = applyRaceBuild(ended, monday);
    expect(current.Monday).toEqual(old.Monday);
    const afterEnd = swapDays(startRoadTrailHybrid(ROAD_TRAIL_HYBRID.program, start), monday, "Monday", "Tuesday");
    expect(current.Tuesday).toEqual(applyRaceBuild(afterEnd, monday).Tuesday);
    expect(runWorkoutsFor(moved, monday).length).toBeGreaterThan(0);
    expect(runWorkoutsFor(ended, monday)).toEqual(runWorkoutsFor(moved, monday));
  });

  it("keeps an already-run event out of later days when restoring the independent dates", () => {
    const monday = "2027-01-25";
    const mondayRace = { ...block, __raceBuild: { ...spec, raceDate: monday } };
    const moved = swapDays(mondayRace, monday, "Monday", "Friday");
    const aligned = align(moved, start, monday);
    const restored = align(aligned, shiftDate(monday, 2), null);
    const week = applyRaceBuild(restored, monday);
    const races = WEEK_DAYS.filter(day => getProgramSessions(week[day]).some(session => session.cardio?.planRole === "race"));
    expect(races).toEqual(["Monday"]);
    expect(movedFrom(restored, "2027-01-29")).toBeNull();
  });

  it("resolves a short-lived race edit even when the same empty spec starts and ends the week", () => {
    const monday = "2027-01-04";
    const program = startRoadTrailHybrid(ROAD_TRAIL_HYBRID.program, start);
    program.__hybridBlock.priorRacePlans = [{ until: monday, spec: null }, { until: "2027-01-06", spec }];
    const live = applyRaceBuild(program, monday);
    expect(live.Monday).toEqual(applyRaceBuild(startRoadTrailHybrid(ROAD_TRAIL_HYBRID.program, start), monday).Monday);
    expect(live.Tuesday).toEqual(applyRaceBuild(block, monday).Tuesday);
    expect(live.Friday).toEqual(applyRaceBuild(startRoadTrailHybrid(ROAD_TRAIL_HYBRID.program, start), monday).Friday);
    expect(describeBuildWeek(program, monday)).toBeNull();
    expect(describeBuildWeek(program, "2027-01-05").raceDate).toBe(saturday);
  });
});
