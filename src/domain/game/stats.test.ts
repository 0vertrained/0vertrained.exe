import { describe, expect, it } from "vitest";
import { day, doneSets, logged, set } from "../../test/gameFixtures";
import { addDays, type DateKey } from "../dates";
import type { DayMap, DayV2, ExerciseLog, SetLog } from "../day/schema";
import { guessMeta, type Equipment, type ExerciseMeta, type MovementPattern } from "../exercise";
import { DEFAULT_BODYWEIGHT_KG, STATS } from "./config";
import { cardioMinutesOf, computeStats, DELTA_DAYS, type StatsInput } from "./stats";
import type { DayResult, GameSettings } from "./types";

const TODAY: DateKey = "2026-10-02";
const BW = 80;
const STARTED: DateKey = addDays(TODAY, -59);

const loaded = (pattern: MovementPattern, equipment: Equipment = "barbell"): ExerciseMeta =>
  ({ trackingMode: "loaded_reps", isBarbell: equipment === "barbell", pattern, equipment });
const bodyweight = (pattern: MovementPattern, bwFactor?: number, trackingMode: ExerciseMeta["trackingMode"] = "bodyweight_reps"): ExerciseMeta =>
  ({ trackingMode, isBarbell: false, pattern, equipment: "bodyweight", ...(bwFactor === undefined ? {} : { bwFactor }) });

const META: Record<string, ExerciseMeta> = {
  "Back Squat": loaded("squat"),
  Deadlift: loaded("hinge"),
  "Bench Press": loaded("horizontalPush"),
  "Barbell Row": loaded("horizontalPull"),
  "Overhead Press": loaded("verticalPush"),
  "DB Bench": loaded("horizontalPush", "dumbbell"),
  "DB Shoulder Press": loaded("verticalPush", "dumbbell"),
  "Biceps Curl": loaded("biceps"),
  "Push-Up": bodyweight("horizontalPush", 0.64),
  "Assisted Pull-Up": bodyweight("verticalPull", 1, "assisted_reps"),
  "Air Squat": bodyweight("squat"),
  Plank: bodyweight("core", undefined, "timed_hold"),
  "Wall Sit": bodyweight("squat", undefined, "timed_hold"),
};
const metaFor = (log: ExerciseLog): ExerciseMeta => META[log.performedName ?? log.name] ?? guessMeta(log.name);

const single = (weightKg: number): SetLog[] => [set(0, { weightKg, reps: 1 })];

function lifts(entries: [string, SetLog[]][]): DayV2 {
  return day({ exercises: entries.map(([name, sets]) => logged(name, { sets })) });
}

/** The worked example: ratios squat 1.0 / hinge 1.25 / push 0.75 / pull 0.7 at 80 kg. */
const EXAMPLE: DayMap = {
  [TODAY]: lifts([["Back Squat", single(80)], ["Deadlift", single(100)], ["Bench Press", single(60)], ["Barbell Row", single(56)]]),
};

function stats(days: DayMap, extra: Partial<StatsInput> = {}) {
  const settings: GameSettings = { bodyweightKg: BW, startedOn: STARTED };
  return computeStats({ days, todayKey: TODAY, results: {}, settings, metaFor, ...extra });
}

/** Cardio logs over the four weeks ending today: `perWeek[i]` minutes on day i of each week. */
function cardioWeeks(perWeek: number[], extra: DayMap = {}): DayMap {
  const days: DayMap = { ...extra };
  for (let w = 0; w < STATS.end.weeks; w += 1) {
    perWeek.forEach((minutes, i) => {
      days[addDays(TODAY, -(7 * w + i))] = day({ cardio: [{ minutes }] });
    });
  }
  return days;
}

const result = (dateKey: DateKey, tier: DayResult["tier"]): DayResult => ({ dateKey, tier }) as DayResult;

/** Check-ins on the `n` days ending today. */
function checkins(n: number, checkin: DayV2["checkin"], exercises: [string, ExerciseLog][] = []): DayMap {
  const days: DayMap = {};
  for (let i = 0; i < n; i += 1) days[addDays(TODAY, -i)] = day({ checkin, exercises });
  return days;
}

const WELL = { sleepQuality: 9, soreness: 2, stress: 2, energy: 9 };

describe("STR", () => {
  it("scores the worked example at 41 from four measured groups", () => {
    const { str } = stats(EXAMPLE);
    expect(str.value).toBe(41);
    expect(str.measuredGroups).toBe(4);
    expect(str.groups).toEqual({ squat: 40, hinge: 42, push: 43, pull: 40 });
  });

  it("counts an untrained group as zero and saturates a group at the elite ratio", () => {
    const { str } = stats({ [TODAY]: lifts([["Back Squat", single(BW * STATS.str.elite.squat * 1.2)]]) });
    expect(str).toMatchObject({ value: 25, measuredGroups: 1, groups: { squat: 100, hinge: null, push: null, pull: null } });
  });

  it("estimates the max with Epley and keeps the best set per group", () => {
    const { str } = stats({ [TODAY]: lifts([["Back Squat", [set(0, { weightKg: 100, reps: 5 }), set(1, { weightKg: 60, reps: 12 })]]]) });
    // 100 × (1 + 5/30) = 116.7 kg → ratio 1.458 → 58.3
    expect(str.groups.squat).toBe(58);
    expect(str.value).toBe(15);
  });

  it("ignores undone, pain and skipped work and logs outside the four groups", () => {
    const days: DayMap = {
      [TODAY]: day({
        exercises: [
          logged("Back Squat", { sets: [set(0, { weightKg: 200, reps: 1, done: false }), set(1, { weightKg: 200, reps: 1, pain: true })] }),
          logged("Deadlift", { sets: single(300), skipped: "pain" }),
          logged("Biceps Curl", { sets: single(100) }),
          logged("Plank", { sets: [set(0, { weightKg: null, reps: null, seconds: 60 })] }),
          logged("Wall Sit", { sets: [set(0, { weightKg: null, reps: null, seconds: 60 })] }),
          logged("Air Squat", { sets: [set(0, { weightKg: null, reps: 20 })] }),
        ],
      }),
    };
    expect(stats(days).str).toMatchObject({ value: 1, measuredGroups: 0, groups: { squat: null, hinge: null, push: null, pull: null } });
  });

  it("loads bodyweight moves at bodyweight × bwFactor plus added load minus assistance", () => {
    const days: DayMap = {
      [TODAY]: day({
        exercises: [
          logged("Push-Up", { sets: [set(0, { weightKg: null, reps: 1 }), set(1, { weightKg: 10, reps: 1 })] }),
          logged("Assisted Pull-Up", { sets: [{ id: "s1", weightKg: null, reps: 1, assistanceKg: 20, done: true }] }),
        ],
      }),
    };
    const { str } = stats(days);
    // push: 80 × 0.64 + 10 = 61.2 kg → 0.765 / 1.75; pull: 80 − 20 = 60 kg → 0.75 / 1.75
    expect(str.groups).toEqual({ squat: null, hinge: null, push: 44, pull: 43 });
    const over = stats({ [TODAY]: lifts([["Assisted Pull-Up", [{ id: "s1", weightKg: null, reps: 1, assistanceKg: 90, done: true }]]]) });
    expect(over.str.measuredGroups).toBe(0);
  });

  it("converts vertical pressing and per-hand dumbbell loads to a bar equivalent", () => {
    const ohp = stats({ [TODAY]: lifts([["Overhead Press", single(40)]]) });
    const db = stats({ [TODAY]: lifts([["DB Bench", single(30)]]) });
    const dbOhp = stats({ [TODAY]: lifts([["DB Shoulder Press", single(20)]]) });
    for (const s of [ohp, db, dbOhp]) expect(s.str.groups.push).toBe(43);
  });

  it("reads the movement performed, not the one planned", () => {
    const days: DayMap = { [TODAY]: day({ exercises: [logged("Bench Press", { sets: single(80), performedName: "Back Squat" })] }) };
    expect(stats(days).str.groups).toEqual({ squat: 40, hinge: null, push: null, pull: null });
  });

  it("looks back exactly 90 calendar days", () => {
    const inside = { [addDays(TODAY, -(STATS.str.windowDays - 1))]: lifts([["Back Squat", single(80)]]) };
    const outside = { [addDays(TODAY, -STATS.str.windowDays)]: lifts([["Back Squat", single(80)]]) };
    expect(stats(inside).str.measuredGroups).toBe(1);
    expect(stats(outside).str.measuredGroups).toBe(0);
  });

  it("falls back to the default bodyweight until one is entered", () => {
    const days = { [TODAY]: lifts([["Back Squat", single(DEFAULT_BODYWEIGHT_KG)]]) };
    expect(stats(days, { settings: { bodyweightKg: null } }).str.groups.squat).toBe(40);
    expect(stats(days, { settings: { bodyweightKg: 0 } }).str.groups.squat).toBe(40);
    expect(stats(days, { settings: {} }).str.groups.squat).toBe(40);
  });

  it("compares with 28 days ago: up, down, steady, or none without history", () => {
    const old = addDays(TODAY, -DELTA_DAYS - 20);
    const base = { [old]: lifts([["Back Squat", single(80)]]) };
    expect(stats(base).str).toMatchObject({ value: 10, previous: 10, delta: 0, trend: "steady" });
    expect(stats({ ...base, [TODAY]: lifts([["Back Squat", single(120)]]) }).str).toMatchObject({ value: 15, previous: 10, delta: 5, trend: "up" });
    expect(stats({ ...base, [TODAY]: lifts([["Back Squat", single(88)]]) }).str).toMatchObject({ value: 11, delta: 1, trend: "steady" });
    const faded = { [addDays(TODAY, -100)]: lifts([["Back Squat", single(200)]]), [TODAY]: lifts([["Back Squat", single(80)]]) };
    expect(stats(faded).str).toMatchObject({ value: 10, previous: 25, delta: -15, trend: "down" });
    expect(stats(EXAMPLE).str).toMatchObject({ previous: null, delta: null, trend: "none" });
  });
});

describe("END", () => {
  it("matches the published checkpoints", () => {
    expect(stats(cardioWeeks([180, 90, 90, 90])).end).toMatchObject({ value: 100, weeklyMinutes: 450, longestMinutes: 180 });
    expect(stats(cardioWeeks([90, 75, 75])).end).toMatchObject({ value: 52, weeklyMinutes: 240, longestMinutes: 90 });
    expect(stats(cardioWeeks([60, 45, 45])).end).toMatchObject({ value: 33, weeklyMinutes: 150, longestMinutes: 60 });
  });

  it("converts distance-only logs at the configured pace", () => {
    expect(cardioMinutesOf({ id: "c", kind: "run", minutes: null, km: 5, source: "manual" })).toBe(30);
    expect(cardioMinutesOf({ id: "c", kind: "run", minutes: 0, km: 5, source: "manual" })).toBe(30);
    expect(cardioMinutesOf({ id: "c", kind: "run", minutes: 20, km: 5, source: "runner" })).toBe(20);
    expect(cardioMinutesOf({ id: "c", kind: "run", minutes: null, km: null, source: "manual" })).toBe(0);
    const { end } = stats({ [TODAY]: day({ cardio: [{ minutes: null, km: 10 }] }) });
    expect(end).toMatchObject({ weeklyMinutes: 15, longestMinutes: 60 });
  });

  it("finds the longest session over 90 days but weekly minutes over 28", () => {
    const { end } = stats({ [addDays(TODAY, -60)]: day({ cardio: [{ minutes: 180 }] }) });
    expect(end).toMatchObject({ value: 40, weeklyMinutes: 0, longestMinutes: 180 });
    const gone = stats({ [addDays(TODAY, -STATS.end.longestWindowDays)]: day({ cardio: [{ minutes: 180 }] }) });
    expect(gone.end).toMatchObject({ value: 1, weeklyMinutes: 0, longestMinutes: 0, previous: 40, trend: "down" });
    expect(stats({}).end).toMatchObject({ previous: null, delta: null, trend: "none" });
  });

  it("saturates at the full marks and never drops below 1", () => {
    expect(stats(cardioWeeks([300, 300, 300])).end.value).toBe(100);
    expect(stats({}).end.value).toBe(1);
  });

  it("compares with 28 days ago", () => {
    const earlier: DayMap = {};
    for (let i = 0; i < 4; i += 1) earlier[addDays(TODAY, -DELTA_DAYS - 1 - 7 * i)] = day({ cardio: [{ minutes: 90 }] });
    expect(stats(earlier).end).toMatchObject({ value: 20, previous: 32, delta: -12, trend: "down" });
    expect(stats(cardioWeeks([90, 75, 75], earlier)).end).toMatchObject({ value: 52, previous: 32, trend: "up" });
  });
});

describe("VIT", () => {
  it("is 25 with no check-ins at all: only honoured rest counts", () => {
    const { vit } = stats({});
    expect(vit).toMatchObject({ value: 25, calibrating: false, checkinRate: 0, sleepScore: 0, restHonor: 1 });
    expect(vit.value).toBeLessThanOrEqual(25);
  });

  it("calibrates over the first week, dividing by seven days at least", () => {
    const { vit } = stats(checkins(3, WELL), { settings: { startedOn: addDays(TODAY, -2) } });
    expect(vit.calibrating).toBe(true);
    expect(vit.checkinRate).toBeCloseTo(3 / 7);
    expect(vit.sleepScore).toBeCloseTo(3 / 7);
    expect(vit.value).toBe(57);
    expect(stats(checkins(3, WELL), { settings: {} }).vit).toMatchObject({ calibrating: true, value: 33 });
  });

  it("reaches 100 with a counted check-in and good sleep every day of the window", () => {
    const { vit } = stats(checkins(STATS.vit.windowDays + 5, WELL));
    expect(vit).toMatchObject({ value: 100, calibrating: false, checkinRate: 1, sleepScore: 1, restHonor: 1 });
  });

  it("scores the Slept tap and only counts a check-in with three answers", () => {
    const n = STATS.vit.windowDays;
    expect(stats(checkins(n, { ...WELL, sleepQuality: 3 })).vit.value).toBe(79);
    expect(stats(checkins(n, { ...WELL, sleepQuality: 6 })).vit.value).toBe(91);
    expect(stats(checkins(n, { soreness: 2, stress: 2, energy: 9 })).vit).toMatchObject({ value: 65, sleepScore: 0 });
    expect(stats(checkins(n, { sleepQuality: 9, energy: 9 })).vit).toMatchObject({ value: 25, checkinRate: 0 });
  });

  it("reads rest honour from REST and RECOVER days without completed sets", () => {
    const rest = addDays(TODAY, -1);
    const recover = addDays(TODAY, -2);
    const results = { [rest]: result(rest, "REST"), [recover]: result(recover, "RECOVER"), [TODAY]: result(TODAY, "FULL") };
    const trained = lifts([["Back Squat", single(80)]]);
    expect(stats({ [rest]: trained, [recover]: trained }, { results }).vit).toMatchObject({ value: 1, restHonor: 0 });
    expect(stats({ [rest]: trained }, { results }).vit).toMatchObject({ value: 13, restHonor: 0.5 });
    const undone = day({ exercises: [logged("Back Squat", { sets: [set(0, { done: false })] })] });
    expect(stats({ [rest]: undone }, { results }).vit).toMatchObject({ value: 25, restHonor: 1 });
  });

  it("training more never raises VIT", () => {
    const rest = addDays(TODAY, -3);
    const results = { [rest]: result(rest, "REST") };
    const quiet = stats(checkins(10, WELL), { results }).vit.value;
    const busy = stats(checkins(10, WELL, [logged("Back Squat", { sets: doneSets(5, { weightKg: 150, reps: 5 }) })]), { results }).vit.value;
    expect(busy).toBeLessThan(quiet);
    const noRest = stats(checkins(10, WELL)).vit.value;
    const busyNoRest = stats(checkins(10, WELL, [logged("Back Squat", { sets: doneSets(5) })])).vit.value;
    expect(busyNoRest).toBe(noRest);
  });

  it("has no previous value before the game started, and is 25 before the start day", () => {
    expect(stats(checkins(10, WELL), { settings: { startedOn: addDays(TODAY, -9) } }).vit).toMatchObject({ previous: null, trend: "none" });
    expect(stats(checkins(10, WELL), { settings: { startedOn: addDays(TODAY, 5) } }).vit).toMatchObject({ value: 25, calibrating: true, checkinRate: 0 });
  });

  it("compares with 28 days ago", () => {
    const earlier: DayMap = {};
    for (let i = 0; i < STATS.vit.windowDays; i += 1) earlier[addDays(TODAY, -DELTA_DAYS - i)] = day({ checkin: WELL });
    const settings: GameSettings = { startedOn: addDays(TODAY, -120) };
    expect(stats(earlier, { settings }).vit).toMatchObject({ value: 25, previous: 100, delta: -75, trend: "down" });
    expect(stats({ ...earlier, ...checkins(STATS.vit.windowDays, WELL) }, { settings }).vit).toMatchObject({ value: 100, previous: 100, delta: 0, trend: "steady" });
    expect(stats(checkins(STATS.vit.windowDays, WELL), { settings }).vit).toMatchObject({ value: 100, previous: 25, trend: "up" });
  });
});

describe("fixtures", () => {
  it("a lifter at 1.25/1.5/0.9/0.9 × BW and a runner at 240 min/week with a 90-min long run land within 5 points of each other", () => {
    const lifter = stats({ [TODAY]: lifts([["Back Squat", single(100)], ["Deadlift", single(120)], ["Bench Press", single(72)], ["Barbell Row", single(72)]]) });
    const runner = stats(cardioWeeks([90, 75, 75]));
    expect(lifter.str.value).toBe(51);
    expect(runner.end.value).toBe(52);
    expect(Math.abs(lifter.str.value - runner.end.value)).toBeLessThanOrEqual(5);
  });
});
