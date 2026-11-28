import { describe, expect, it } from "vitest";
import { shiftDate } from "../coachWindows";
import { getProgramSessions } from "../programSessions";
import { describeRoadTrailWeek, resolveRoadTrailWeek, ROAD_TRAIL_HYBRID, startRoadTrailHybrid } from "../plans/roadTrailHybrid";
import { weekdayOf } from "../weekMoves";

const block = startRoadTrailHybrid(ROAD_TRAIL_HYBRID.program, "2026-11-27");
const withRevisions = (revisions, base = block) => ({
  ...base, __hybridBlock: { ...base.__hybridBlock, alignments: revisions },
});
const revision = (effectiveDate, raceDate) => ({ effectiveDate, raceDate, raceName: "Winter Classic" });
const day = (program, key) => resolveRoadTrailWeek(program, key)[weekdayOf(key)];
const lifts = (program, key) => getProgramSessions(day(program, key)).flatMap(session => session.lifting);
const cardios = (program, key) => getProgramSessions(day(program, key)).map(session => session.cardio).filter(Boolean);

describe("race-aligned hybrid strength phases", () => {
  it.each([
    ["2027-01-30", "2027-01-18", "2027-01-25", 10],
    ["2027-01-10", "2026-12-28", "2027-01-04", 7],
  ])("retains a Friday start while phasing strength toward %s", (raceDate, taper, raceMonday, totalWeeks) => {
    const plan = withRevisions([revision("2026-11-26", raceDate)]);
    expect(describeRoadTrailWeek(plan, "2026-11-26")).toMatchObject({ weekNumber: 0, phase: "Upcoming" });
    expect(describeRoadTrailWeek(plan, "2026-11-27")).toMatchObject({
      startDate: "2026-11-27", weekNumber: 1, totalWeeks, phase: "Foundation",
      aligned: true, baselineRaceDate: "2027-01-16", raceDate, raceName: "Winter Classic",
    });
    expect(describeRoadTrailWeek(plan, taper)).toMatchObject({ phase: "Taper", weekNumber: totalWeeks - 1 });
    expect(lifts(plan, taper)[0]).toMatchObject({ sets: 2, rir: 3 });
    expect(describeRoadTrailWeek(plan, raceMonday)).toMatchObject({ phase: "Race week", weekNumber: totalWeeks });
    expect(lifts(plan, raceMonday)[0]).toMatchObject({ sets: 1, rir: 4 });
    for (let offset = -2; offset <= 0; offset++) expect(lifts(plan, shiftDate(raceDate, offset))).toHaveLength(0);
    expect(describeRoadTrailWeek(plan, shiftDate(raceDate, 1))).toMatchObject({ completed: true, phase: "Recovery" });
    expect(getProgramSessions(day(plan, shiftDate(raceDate, 1)))).toHaveLength(0);
    expect(lifts(plan, shiftDate(raceDate, 9))).toHaveLength(0);
  });

  it("applies the event-relative lift break across weeks for an early-week race", () => {
    const edited = structuredClone(block);
    for (const name of ["Saturday", "Sunday"]) edited[name] = { ...edited.Thursday };
    const plan = withRevisions([revision("2026-11-27", "2027-01-25")], edited);
    expect(lifts(plan, "2027-01-22").length).toBeGreaterThan(0);
    expect(lifts(plan, "2027-01-23")).toHaveLength(0);
    expect(lifts(plan, "2027-01-24")).toHaveLength(0);
    expect(lifts(plan, "2027-01-25")).toHaveLength(0);
    expect(lifts(plan, "2027-01-26")).toHaveLength(0);
  });

  it("keeps scheduled cutbacks and edited exercise doses when adding build weeks", () => {
    const edited = structuredClone(block);
    edited.Monday.sessions[0].lifting[0] = { ...edited.Monday.sessions[0].lifting[0], name: "Close-Grip Bench Press", sets: 5 };
    const plan = withRevisions([revision("2026-11-27", "2027-03-06")], edited);
    for (const dayKey of ["2026-12-14", "2027-01-11", "2027-02-08"]) {
      expect(describeRoadTrailWeek(plan, dayKey).phase).toBe("Cutback");
      expect(lifts(plan, dayKey)[0]).toMatchObject({ name: "Close-Grip Bench Press", sets: 3, rir: 3 });
    }
    expect(lifts(plan, "2027-01-18")[0]).toMatchObject({ name: "Close-Grip Bench Press", sets: 5 });
    expect(lifts(plan, "2027-02-22")[0]).toMatchObject({ name: "Close-Grip Bench Press", sets: 3, rir: 3 });
    expect(edited.Monday.sessions[0].lifting[0].sets).toBe(5);
  });

  it("preserves earlier prescriptions across both a midweek acceptance and a later restoration", () => {
    const once = withRevisions([revision("2027-01-13", "2027-01-30")]);
    const twice = withRevisions([...once.__hybridBlock.alignments, revision("2027-01-20", null)]);
    for (const key of ["2027-01-11", "2027-01-12"]) expect(day(twice, key)).toEqual(day(block, key));
    expect(lifts(twice, "2027-01-14").length).toBeGreaterThan(0);
    expect(lifts(block, "2027-01-14")).toHaveLength(0);
    expect(lifts(twice, "2027-01-18")).toEqual(lifts(once, "2027-01-18"));
    expect(day(twice, "2027-01-21")).toEqual(day(block, "2027-01-21"));
    expect(describeRoadTrailWeek(twice, "2027-01-20")).toMatchObject({ aligned: false, raceDate: "2027-01-16" });
    expect(resolveRoadTrailWeek(twice, "2027-01-12").Thursday).toEqual(day(twice, "2027-01-14"));
    expect(resolveRoadTrailWeek(twice, "2027-01-21").Monday).toEqual(day(twice, "2027-01-18"));
    expect(JSON.parse(JSON.stringify(twice)).__hybridBlock.alignments).toEqual(twice.__hybridBlock.alignments);
  });

  it("retains the original hybrid run before its standalone benchmark and suppresses the duplicate benchmark", () => {
    const plan = withRevisions([revision("2026-11-27", "2027-01-31")]);
    for (const key of ["2026-12-15", "2027-01-09", "2027-01-15"]) expect(cardios(plan, key)).toEqual(cardios(block, key));
    expect(cardios(block, "2027-01-16")[0].planRole).toBe("race");
    expect(cardios(plan, "2027-01-16")).toHaveLength(0);
  });

  it("ignores unusable imported revisions", () => {
    const plan = withRevisions([null, revision("2026-02-30", "2027-01-31"), revision("2026-12-01", "not a date"),
      revision("2026-12-01", "2026-11-02")]);
    expect(describeRoadTrailWeek(plan, "2027-01-16")).toEqual(describeRoadTrailWeek(block, "2027-01-16"));
    expect(day(plan, "2027-01-16")).toEqual(day(block, "2027-01-16"));
  });

  it("counts calendar weeks across daylight-saving changes and falls back to the target name on import", () => {
    const march = startRoadTrailHybrid(ROAD_TRAIL_HYBRID.program, "2027-03-03");
    const plan = withRevisions([{ effectiveDate: "2027-03-03", raceDate: "2027-05-16", raceName: {} }], march);
    expect(describeRoadTrailWeek(plan, "2027-03-15")).toMatchObject({ weekNumber: 3, totalWeeks: 11, raceName: "Road 10K" });
    expect(describeRoadTrailWeek(plan, "2027-05-10")).toMatchObject({ weekNumber: 11, phase: "Race week" });
  });
});
