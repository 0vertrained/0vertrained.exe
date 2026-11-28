// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { defaultDay, presetProgram } from "../constants";
import { shiftDate } from "../coachWindows";
import { liveTrainingWeek } from "../customTrainingDay";
import { previewHybridRaceAlignment } from "../hybridRaceAlignment";
import { describeRoadTrailWeek, startRoadTrailHybrid } from "../plans/roadTrailHybrid";
import { countProgramSets, getProgramSessions } from "../programSessions";
import { buildTodayPlan } from "../todaySummary";
import { buildTrainWeek } from "../TrainTab";
import { buildWatchPlan, buildWatchWeek } from "../watch/watchPlan";
import { swapDays, weekdayOf, weekStartOf } from "../weekMoves";

const todayKey = "2027-01-11"; // Monday of the original block's race week.
const blockStart = "2026-11-27";
const saturday = { raceDate: "2027-01-30", raceName: "River Road 10K", raceTarget: "road10k" };
const sunday = { raceDate: "2027-01-31", raceName: "Foothills Trail 10K", raceTarget: "trail10k" };

function independentProgram({ raceDate, raceName, raceTarget }) {
  const program = startRoadTrailHybrid(presetProgram("roadTrailHybrid"), blockStart, { raceTarget });
  return { ...program, __raceBuild: {
    kind: "runPlan", raceName, raceDate, startDate: blockStart, distance: "10k",
    runsPerWeek: 4, qualityDay: "Tuesday", longRunDay: weekdayOf(raceDate), benchmarkTest: "none",
  } };
}

function liveWeek(program, dateKey, entries) {
  return liveTrainingWeek({ program, dateKey, currentDateKey: dateKey, data: entries });
}

function logFirstSet(program, dateKey) {
  const first = getProgramSessions(liveWeek(program, dateKey, {})[weekdayOf(dateKey)]).find(s => s.lifting.length);
  const entry = defaultDay();
  entry.workout.exercises[first.lifting[0].name] = { sets: [{ done: true, weight: "135", reps: "5" }] };
  return { [dateKey]: entry };
}

describe("race alignment on Today, Train and Apple Watch", () => {
  it.each([saturday, sunday])("keeps the logged Monday and delivers the taper and $raceName on $raceDate", race => {
    const original = independentProgram(race);
    const entries = logFirstSet(original, todayKey);
    const originalEntries = structuredClone(entries);
    const preview = previewHybridRaceAlignment({ program: original, entries, todayKey, align: true });
    expect(preview.effectiveDate).toBe("2027-01-12");
    expect(preview.changes.length).toBeGreaterThan(0);
    const aligned = JSON.parse(JSON.stringify(preview.program));
    expect(aligned.__hybridBlock.startDate).toBe(blockStart);
    expect(aligned.__raceBuild).toEqual(original.__raceBuild);

    const beforeWeek = liveWeek(original, todayKey, entries);
    const afterWeek = liveWeek(aligned, todayKey, entries);
    expect(afterWeek.Monday).toEqual(beforeWeek.Monday);
    expect(countProgramSets(afterWeek.Tuesday)).toBeGreaterThan(countProgramSets(beforeWeek.Tuesday));
    const watchToday = program => buildWatchPlan({ program, dateKey: todayKey, data: entries, sentAt: "2027-01-11T12:00:00Z" });
    expect(watchToday(aligned)).toEqual(watchToday(original));
    expect(watchToday(aligned).sessions[0].exercises[0].sets[0]).toMatchObject({ done: true, values: { weight: 135, reps: 5 } });
    expect(entries).toEqual(originalEntries);

    // Confirm the prior event day is an ordinary date and there is exactly one race.
    const events = [];
    for (let key = todayKey; key <= shiftDate(race.raceDate, 7); key = shiftDate(key, 1)) {
      const day = liveWeek(aligned, key, entries)[weekdayOf(key)];
      if (getProgramSessions(day).some(s => s.cardio?.planRole === "race")) events.push(key);
    }
    expect(events).toEqual([race.raceDate]);
    expect(describeRoadTrailWeek(aligned, race.raceDate)).toMatchObject({ aligned: true, raceDate: race.raceDate, phase: "Race week" });

    // The Watch loads a seven-day offline calendar from one phone sync. Compare each day to Train and Today.
    const raceMonday = weekStartOf(race.raceDate);
    const raceWeek = liveWeek(aligned, raceMonday, entries);
    const train = buildTrainWeek({ program: raceWeek, entries, todayKey: raceMonday });
    const watch = buildWatchWeek({ program: aligned, todayKey: raceMonday, data: entries });
    expect(watch.days).toHaveLength(7);
    for (const deviceDay of watch.days) {
      const date = deviceDay.date;
      const row = train.find(d => d.dateKey === date);
      const phone = buildTodayPlan({ programDay: liveWeek(aligned, date, entries)[weekdayOf(date)] });
      expect(phone.liftCount).toBe(row.liftCount);
      expect(phone.isRest).toBe(row.isRest);
      const sets = row.sessions.flatMap(s => s.lifting.map(ex => [s.id, ex.name, ex.sets]));
      expect(deviceDay.sessions.flatMap(s => s.exercises.map(ex => [s.id, ex.name, ex.sets.length]))).toEqual(sets);
      expect(deviceDay.cardio.map(s => s.name)).toEqual(row.sessions.filter(s => s.cardio).map(s => s.cardio.type));
    }
    const watchRace = watch.days.find(d => d.date === race.raceDate);
    expect(watchRace.sessions).toEqual([]);
    expect(watchRace.runs).toHaveLength(1);
    expect(watchRace.runs[0].blocks.flatMap(b => b.steps).some(s => s.goal.meters === 10000)).toBe(true);
  });

  it("restores the original calendar going forward and keeps a workout logged under the aligned taper", () => {
    const original = independentProgram(sunday);
    const aligned = previewHybridRaceAlignment({ program: original, entries: {}, todayKey, align: true }).program;
    const later = "2027-01-18";
    const entries = logFirstSet(aligned, later);
    const preview = previewHybridRaceAlignment({ program: aligned, entries, todayKey: later, align: false });
    expect(preview.effectiveDate).toBe("2027-01-19");
    const restored = preview.program;
    expect(restored.__raceBuild).toEqual(original.__raceBuild);
    const before = liveWeek(aligned, later, entries);
    const after = liveWeek(restored, later, entries);
    expect(after.Monday).toEqual(before.Monday);
    expect(countProgramSets(after.Monday)).toBeGreaterThan(0);
    expect(after.Tuesday).toEqual(liveWeek(original, later, entries).Tuesday);
    expect(countProgramSets(after.Tuesday)).toBe(0);
    expect(describeRoadTrailWeek(restored, "2027-01-12").raceDate).toBe(sunday.raceDate);
    expect(describeRoadTrailWeek(restored, "2027-01-19").raceDate).toBe("2027-01-16");
  });

  it("previews a generated run moving from morning to evening even when its prescription is identical", () => {
    const original = structuredClone(independentProgram(sunday));
    original.Friday.sessions[1].cardio.minutes = 20;
    const preview = previewHybridRaceAlignment({ program: original, todayKey: blockStart });
    expect(preview.unchangedRuns).toBe(false);
    for (const dateKey of ["2027-01-22", "2027-01-29"]) {
      const row = preview.changes.find(change => change.dateKey === dateKey);
      const before = buildWatchPlan({ program: original, dateKey }).runs[0];
      const after = buildWatchPlan({ program: preview.program, dateKey }).runs[0];
      expect(before.time).toBe("07:00");
      expect(after.time).toBe("17:30");
      expect(after.name).toBe(before.name);
      expect(row.before).toContain(before.time);
      expect(row.after).toContain(after.time);
    }
    expect(preview.changes.find(change => change.dateKey === "2027-01-29").liftChanges).toEqual([]);
  });

  it("preserves an already-logged day whose workout was moved from across the effective date", () => {
    // In original week seven Thursday's sets are tapered. The linked race runs two weeks later.
    const monday = "2027-01-04";
    const original = swapDays(independentProgram(saturday), monday, "Monday", "Thursday");
    const entries = logFirstSet(original, monday);
    const preview = previewHybridRaceAlignment({ program: original, entries, todayKey: monday, align: true });
    expect(preview.effectiveDate).toBe("2027-01-05");
    const before = liveWeek(original, monday, entries);
    const after = liveWeek(preview.program, monday, entries);
    expect(after.Monday).toEqual(before.Monday);
    expect(preview.changes.map(c => c.dateKey)).not.toContain(monday);
  });
});
