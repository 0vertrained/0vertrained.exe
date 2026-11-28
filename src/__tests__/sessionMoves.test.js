import { describe, expect, it } from "vitest";
import { changeDatedSession, applyRaceBuild } from "../raceBuild";
import { ROAD_TRAIL_HYBRID, startRoadTrailHybrid } from "../plans/roadTrailHybrid";
import { getProgramSessions } from "../programSessions";
import { liveTrainingWeek } from "../customTrainingDay";
import { buildWatchPlan } from "../watch/watchPlan";
import { runSchedule, runWorkoutsFor } from "../watch/runWorkouts";
import { swapDays } from "../weekMoves";
import { buildTrainWeek } from "../TrainTab";

const friday = "2026-11-27";
const saturday = "2026-11-28";
const monday = "2026-11-30";
const block = startRoadTrailHybrid(ROAD_TRAIL_HYBRID.program, friday);
const fridayPlan = getProgramSessions(applyRaceBuild(block, friday).Friday);
const data = { [friday]: { workout: { completed: true, sessionState: { am: { status: "complete" } },
  exercises: Object.fromEntries(fridayPlan[0].lifting.map(ex => [ex.name, { sets: Array.from({ length: ex.sets }, () => ({ done: true, weight: "35", reps: "8" })) }])) } } };
const change = (program, to, entries = data, extra = {}) => changeDatedSession(program, entries, { from: friday, id: "pm", todayKey: friday, to, ...extra });

describe("a dated session in the Road & Trail calendar", () => {
  it("moves just Friday PM beside Saturday’s long run, survives a reload, and keeps the completed AM and its log intact", () => {
    const stored = JSON.stringify(data);
    const result = change(block, saturday);
    expect(result.error).toBeUndefined();
    const program = JSON.parse(JSON.stringify(result.program));
    expect(program.Friday).toEqual(block.Friday);
    const phone = liveTrainingWeek({ program, data, dateKey: friday, currentDateKey: friday });
    expect(getProgramSessions(phone.Friday)).toEqual([fridayPlan[0]]);
    const source = buildTrainWeek({ program: phone, entries: data, todayKey: friday }).find(d => d.dateKey === friday);
    expect(source.done).toBe(true);
    const sourceWatch = buildWatchPlan({ program, data, dateKey: friday });
    expect(sourceWatch.sessions.map(s => s.id)).toEqual(["am"]);
    expect(sourceWatch.cardio).toEqual([]);
    const saturdayRuns = runWorkoutsFor(program, saturday);
    expect(saturdayRuns.map(run => [run.sessionId, run.time])).toEqual([["main", "07:00"], ["moved-2026-11-27-pm", "17:30"]]);
    expect(saturdayRuns[0].id).toBe(runWorkoutsFor(block, saturday)[0].id);
    const oneRunLogged = { [saturday]: { workout: { cardioSessions: { main: { time: "1:02:00" } } } } };
    expect(buildTrainWeek({ program: phone, entries: oneRunLogged, todayKey: saturday }).find(d => d.dateKey === saturday).done).toBe(false);
    expect(change(program, saturday, data, { undo: true }).program).toEqual(block);
    expect(change(program, saturday, oneRunLogged, { undo: true }).error).toMatch(/logged/);
    expect(swapDays(program, saturday, "Saturday", "Tuesday")).toBe(program);
    expect(JSON.stringify(data)).toBe(stored);
  });

  it("schedules next week exactly once, preserves that Monday’s existing PM, and keeps later Fridays intact", () => {
    const program = change(block, monday).program;
    const schedule = runSchedule(program, friday, { days: 8, now: new Date(friday + "T08:00:00") });
    const moved = schedule.filter(run => run.sessionId.startsWith("moved-"));
    expect(moved).toHaveLength(1);
    expect(moved[0].date).toBe(monday);
    expect(moved[0].time).toBe("19:00");
    expect(schedule.filter(run => run.date === monday).map(r => r.sessionId)).toEqual(["pm", moved[0].sessionId]);
    expect(runWorkoutsFor(program, "2026-12-04")).toEqual(runWorkoutsFor(block, "2026-12-04"));
    const logged = { [monday]: { workout: { cardioSessions: { [moved[0].sessionId]: { time: "9:04" } } } } };
    expect(change(program, monday, logged, { undo: true }).error).toMatch(/already started/);
    const siblingOnly = { [monday]: { workout: { sessionState: { am: { status: "active" } } } } };
    expect(change(program, monday, siblingOnly, { undo: true }).program).toEqual(block);
    expect(change(block, monday, siblingOnly).program).toEqual(program);
    expect(change(block, monday, { [monday]: { workout: { cardio: { miles: 4, time: "36:04" } } } }).error).toMatch(/logged/);
  });

  it("skips and restores the pending run without logging activity and rejects a retry or edits to a started slot", () => {
    const skipped = change(block, null).program;
    expect(runWorkoutsFor(skipped, friday)).toEqual([]);
    expect(change(skipped, null).error).toMatch(/changed/);
    expect(change(skipped, null, data, { undo: true }).program).toEqual(block);
    expect(change(block, saturday, data, { id: "am" }).error).toMatch(/logged/);
    for (const workout of [{ cardio: { time: "22:00", miles: 2.5 } }, { cardioSessions: { pm: { time: "00:31" } } }, { cardioSessions: { pm: { startedAt: "2026-11-27T18:32:00Z" } } }, { whoopHeartRate: { "cardio-pm": { count: 2 } } },
      { sessionState: { pm: { status: "active" } } }]) {
      expect(change(block, null, { [friday]: { workout } }).error).toMatch(/logged/);
    }
    expect(change(block, null, { [friday]: { workout: { cardio: { miles: 3, unplanned: true } } } }).error).toBeUndefined();
    expect(change(block, saturday, { [saturday]: { workout: { cardio: { notes: "First mile" } } } }).error).toMatch(/destination/);
    expect(change({ ...block, __raceBuild: { raceDate: "2026-12-02" } }, monday).error).toBe("Race taper");
    expect(change({ ...block, __raceBuild: { raceDate: friday } }, null).error).toBe("Race day");
  });
});
