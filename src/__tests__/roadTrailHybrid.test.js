import { describe, expect, it } from "vitest";
import { DAYS, PROGRAM_PRESETS, RESEARCH_PRESET_IDS, presetProgram } from "../constants";
import { getProgramSessions } from "../programSessions";
import { startRoadTrailHybrid, describeRoadTrailWeek } from "../plans/roadTrailHybrid";
import { applyRaceBuild } from "../raceBuild";
import { liveTrainingWeek } from "../customTrainingDay";
import { shiftDate } from "../coachWindows";
import { suggestPlanForCardio, totalPlannedSeconds } from "../cardioSession";
import { buildWatchPlan } from "../watch/watchPlan";
import { loggedRuns } from "../runProgress";
import { dayCard } from "../widgets/widgetCards";

const monday = "2027-03-01"; // The block crosses the spring daylight-saving transition.
const date = (week, offset = 0) => shiftDate(monday, 7 * (week - 1) + offset);
const template = presetProgram("roadTrailHybrid");
const program = startRoadTrailHybrid(template, monday);
const sessions = week => DAYS.flatMap(day => getProgramSessions(week[day]));
const phoneWeek = dateKey => liveTrainingWeek({ program, data: {}, dateKey, currentDateKey: dateKey });
const watchSeconds = workout => (workout.warmup?.goal.seconds || 0) + (workout.cooldown?.goal.seconds || 0) +
  workout.blocks.reduce((sum, block) => sum + block.iterations * block.steps.reduce((n, step) => n + step.goal.seconds, 0), 0);

describe("Road & Trail Hybrid", () => {
  it.each(DAYS.map((day, index) => [day, index]))("starts on %s, with the same partial calendar from either side of the start date", (day, index) => {
    const start = date(1, index);
    const selected = startRoadTrailHybrid(template, start, { raceTarget: "trail15k" });
    expect(describeRoadTrailWeek(selected, shiftDate(start, -1))).toMatchObject({ phase: "Upcoming", weekNumber: 0, startDate: start });
    expect(describeRoadTrailWeek(selected, start)).toMatchObject({ phase: "Foundation", weekNumber: 1, startMonday: monday, startDate: start });
    for (const lookup of [monday, start, date(1, 6)]) {
      const week = applyRaceBuild(selected, lookup);
      for (const [i, weekday] of DAYS.entries()) {
        if (i < index) expect(week[weekday]).toMatchObject({ type: "Before the block", code: "REST" });
        else expect(getProgramSessions(week[weekday])).toEqual(getProgramSessions(template[weekday]));
      }
    }
    expect(describeRoadTrailWeek(selected, date(2))).toMatchObject({ phase: "Build", weekNumber: 2 });
    expect(describeRoadTrailWeek(selected, date(8, 5))).toMatchObject({ phase: "Race week", raceDate: date(8, 5) });
  });

  it("reschedules a saved Monday block to Friday without replacing edits, race settings or week moves", () => {
    const saved = structuredClone(program);
    saved.__hybridBlock = { id: "roadTrailHybrid", startMonday: "2026-11-30", raceTarget: "trail10k", preference: "saved" };
    saved.__raceBuild = { kind: "runPlan", raceName: "My race", startDate: "2026-12-07", raceDate: "2027-03-06" };
    saved.__weekMoves = { "2026-12-07": { Monday: "Tuesday", Tuesday: "Monday" } };
    saved.Friday.sessions[0].lifting[0].sets = 2;
    expect(describeRoadTrailWeek(saved, "2026-11-27")).toMatchObject({ startDate: "2026-11-30", weekNumber: 0 });
    const selected = JSON.parse(JSON.stringify(startRoadTrailHybrid(saved, "2026-11-27")));
    expect(selected).toEqual({ ...saved, __hybridBlock: { ...saved.__hybridBlock, startDate: "2026-11-27", startMonday: "2026-11-23" } });
    expect(saved.__hybridBlock.startDate).toBeUndefined();
    expect(describeRoadTrailWeek(selected, "2026-11-27")).toMatchObject({ raceTarget: "trail10k", raceDate: "2027-01-16" });
    const watch = key => buildWatchPlan({ program: selected, dateKey: key });
    expect(watch("2026-11-26")).toMatchObject({ sessions: [], runs: [] });
    const friday = watch("2026-11-27");
    expect(friday.sessions.map(s => s.id)).toEqual(["am"]);
    expect(friday.sessions[0].exercises[0].sets).toHaveLength(2);
    expect(friday.runs[0]).toMatchObject({ sessionId: "pm", name: "Easy shakeout run" });
  });

  it("rejects invalid calendar dates and lets an athlete repair a malformed saved start", () => {
    expect(startRoadTrailHybrid(program, "2027-02-30")).toBe(program);
    expect(describeRoadTrailWeek(program, "2027-02-30")).toBeNull();
    for (const marker of [{ startMonday: date(1, 1) }, { startDate: "2027-02-30", startMonday: monday }]) {
      const saved = { ...program, __hybridBlock: { id: "roadTrailHybrid", ...marker } };
      expect(describeRoadTrailWeek(saved, monday)).toBeNull();
      expect(describeRoadTrailWeek(startRoadTrailHybrid(saved, date(1, 4)), date(1, 4))?.weekNumber).toBe(1);
    }
  });

  it("publishes an opt-in research preset, with a dated progression that survives a save and reload", () => {
    expect(RESEARCH_PRESET_IDS).toContain("roadTrailHybrid");
    expect(PROGRAM_PRESETS.roadTrailHybrid.guide.sources.length).toBeGreaterThanOrEqual(5);
    const restored = JSON.parse(JSON.stringify(program));
    const workloads = Array.from({ length: 8 }, (_, index) => {
      const week = index + 1;
      const key = date(week);
      expect(describeRoadTrailWeek(restored, shiftDate(key, 6)).weekNumber).toBe(week);
      const calendar = applyRaceBuild(restored, key);
      const all = sessions(calendar);
      expect(getProgramSessions(calendar.Sunday)).toEqual([]);
      return [all.flatMap(s => s.lifting).reduce((n, ex) => n + ex.sets, 0),
        all.reduce((n, s) => n + (s.cardio?.minutes || 0), 0)];
    });
    expect(workloads).toEqual([[70, 197], [70, 212], [70, 235], [42, 155], [70, 233], [70, 259], [42, 166], [11, 85]]);
    expect(sessions(applyRaceBuild(restored, shiftDate(monday, -1)))).toHaveLength(0);
    expect(describeRoadTrailWeek(restored, date(11)).completed).toBe(true);
    expect(sessions(applyRaceBuild(restored, date(11))).every(s => !s.lifting.length && /optional/i.test(s.cardio.type))).toBe(true);
    expect(template.__hybridBlock.startMonday).toBeUndefined();
  });

  it("delivers the same timed workouts and independent AM/PM slots to the phone, Watch and widget", () => {
    for (let week = 1; week <= 8; week++) {
      const tuesday = date(week, 1);
      const day = phoneWeek(tuesday).Tuesday;
      const [run, weights] = getProgramSessions(day);
      expect([run.id, weights.id]).toEqual(["am", "pm"]);
      const watch = buildWatchPlan({ owner: "athlete", program, dateKey: tuesday });
      expect(watch.sessions.map(s => s.id)).toEqual(["pm"]);
      expect(watch.sessions[0].exercises[0].sets).toHaveLength(weights.lifting[0].sets);
      expect(watch.runs).toHaveLength(1);
      expect(watch.runs[0]).toMatchObject({ sessionId: "am", name: run.cardio.type, location: "outdoor" });
      expect(totalPlannedSeconds(suggestPlanForCardio(run.cardio))).toBe(run.cardio.minutes * 60);
      expect(watchSeconds(watch.runs[0])).toBe(run.cardio.minutes * 60);
      if (week !== 4) expect(watch.runs[0].blocks[0].steps[0].alert).toEqual({ kind: "hrZone", zone: 4 });
      expect(dayCard(program, tuesday).detail).toContain(run.cardio.type);
    }
  });

  it.each([["road10k", 6.21], ["trail10k", 6.21], ["trail15k", 9.32]])("delivers the selected %s distance to race day", (raceTarget, miles) => {
    const selected = startRoadTrailHybrid(template, monday, { raceTarget });
    const raceDate = date(8, 5);
    expect(describeRoadTrailWeek(selected, date(1)).raceDate).toBe(raceDate);
    const [race] = getProgramSessions(applyRaceBuild(selected, raceDate).Saturday);
    expect(race.cardio.miles).toBe(miles);
    const watch = buildWatchPlan({ program: selected, dateKey: raceDate });
    expect(watch.runs[0].name).toBe(race.cardio.type);
    expect(watch.runs[0].blocks[0].steps[0].goal.meters).toBe(raceTarget === "trail15k" ? 15000 : 10000);
  });

  it("keeps an edited lift and run and resolves a moved session in its own calendar week", () => {
    const edited = structuredClone(program);
    edited.Tuesday.sessions[1].lifting[0].name = "Front Squat";
    edited.Tuesday.sessions[1].lifting[0].sets = 5;
    edited.Wednesday.cardio.minutes = 22;
    edited.__weekMoves = { [date(4)]: { Thursday: "Tuesday", Tuesday: "Thursday" } };
    const cutback = applyRaceBuild(edited, date(4));
    const squat = getProgramSessions(cutback.Thursday)[1].lifting[0];
    expect(squat).toMatchObject({ name: "Front Squat", sets: 3, rir: 3 });
    expect(cutback.Wednesday.cardio.minutes).toBe(22);
    expect(getProgramSessions(applyRaceBuild(edited, date(5)).Tuesday)[1].lifting[0].sets).toBe(5);
    expect(template.Tuesday.sessions[1].lifting[0]).toMatchObject({ name: "Back Squat", sets: 4 });
  });

  it("counts easy, timed trail runs and cutback runs in the athlete’s history, and excludes hill intervals", () => {
    const entry = { workout: { cardioSessions: { am: { miles: "3", time: "27:00", modality: "run" } } } };
    const entries = {
      [date(2, 1)]: entry, [date(4, 1)]: entry,
      [date(4, 2)]: { workout: { cardio: { miles: "3", time: "31:00", modality: "run" } } },
    };
    const runs = loggedRuns(entries, program, { todayKey: date(8) });
    expect(runs.map(r => [r.dateKey, r.easy])).toEqual([[date(2, 1), false], [date(4, 1), true], [date(4, 2), true]]);
  });
});
