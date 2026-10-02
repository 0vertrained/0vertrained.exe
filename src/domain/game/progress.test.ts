import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { addDays } from "../dates";
import type { DayMap } from "../day/schema";
import { CHECKIN_FINE, day, doneSets, logged, metaFor, snapshot, threeDayProgram, trainingDay, week } from "../../test/gameFixtures";
import { scenario } from "../../test/gameScenario";
import { appendRevision } from "../program/revisions";
import { ACHIEVEMENTS, XP } from "./config";
import { levelFromXp } from "./levels";
import { buildProgress, daysSinceStart } from "./progress";
import type { ProgressInput } from "./types";

// 2026-09-28 is a Monday; two full weeks end on Sunday 2026-10-11.
const START = "2026-09-28";
const TODAY = "2026-10-12";

function build(partial: Partial<ProgressInput> & Pick<ProgressInput, "days" | "settings">) {
  return buildProgress({ program: threeDayProgram(), todayKey: TODAY, metaFor, ...partial });
}

describe("two honest weeks on a 3-day plan", () => {
  // Flat loads: no records, so the arithmetic below is exact.
  const s = scenario({ program: threeDayProgram(), startedOn: START, todayKey: TODAY, todayUntouched: true, weeklyStepKg: 0, weeklyStepReps: 0 });
  const p = build({ days: s.days, settings: s.settings, nowMs: Date.parse(`${TODAY}T07:00:00Z`) });

  it("adds up the published weekly totals plus the achievements it unlocked", () => {
    const perWeek = 360 + 7 * XP.checkin + 4 * XP.restDay + XP.weeklyObjective * 2 + XP.weeklyBothBonus; // 660
    const unlocked = p.achievements.filter((a) => a.unlocked).map((a) => a.id).sort();
    expect(unlocked).toEqual(["calibrated", "first_quest", "full_week", "unbroken_1"]);
    const achievementXp = ACHIEVEMENTS.filter((a) => unlocked.includes(a.id)).reduce((n, a) => n + a.xp, 0);
    expect(p.xp).toBe(perWeek * 2 + XP.checkin + achievementXp); // + today's check-in
    expect(p.level).toBe(levelFromXp(p.xp));
    expect(p.level).toBe(7);
  });

  it("keeps the streak, counts kept days and qualifying weeks", () => {
    expect(p.streak).toMatchObject({ current: 14, best: 14, shields: 2, shieldUsedOn: [] });
    expect(p.keptDays).toBe(14);
    expect(p.weeks.map((w) => [w.closed, w.qualifying, w.xp])).toEqual([[true, true, 150], [true, true, 150], [false, false, 0]]);
    expect(p.qualifyingWeeks).toBe(2);
  });

  it("is Rank D with Rank C's requirements listed and the trial locked", () => {
    expect(p.rank).toBe("D");
    expect(p.derivedRank).toBe("D");
    expect(p.rankTitle).toBe("Initiate");
    expect(p.nextRank.rank).toBe("C");
    expect(p.nextRank.requirements.find((r) => r.key === "level")).toMatchObject({ target: 12, current: 7, met: false });
    expect(p.nextRank.requirements.find((r) => r.key === "weeks")).toMatchObject({ target: 4, current: 2, met: false });
    expect(p.nextRank.trialAvailable).toBe(false);
    expect(p.trial).toBeNull();
  });

  it("describes today as an issued, untouched FULL quest", () => {
    expect(p.today).toMatchObject({ dateKey: TODAY, tier: "FULL", status: "open", completedSets: 0, plannedSets: 12, checkinCounted: true });
    expect(p.status).toBe("ready");
    expect(p.rulesVersion).toBe(1);
    expect(p.titles.total).toBe(18);
    expect(p.titles.unlocked).toEqual(expect.arrayContaining(["Initiate", "First Quest"]));
  });

  it("reports the high-water marks the caller should persist", () => {
    expect(p.newHighs.rank).toBe("D");
    expect(p.newHighs.achievements?.sort()).toEqual(["calibrated", "first_quest", "full_week", "unbroken_1"]);
    expect(p.newHighs.trialsPassed).toBeUndefined();
    const again = build({ days: s.days, settings: { ...s.settings, high: { rank: "D", achievements: p.newHighs.achievements, trialsPassed: [] } }, nowMs: Date.parse(`${TODAY}T07:00:00Z`) });
    expect(again.newHighs).toEqual({});
  });
});

describe("events", () => {
  it("protects an illness day, spends a shield on a missed day, and pays a reduced day in full", () => {
    const s = scenario({ program: threeDayProgram(), startedOn: START, todayKey: TODAY, illnessOn: ["2026-10-02"], missedOn: ["2026-10-07"], reducedOn: ["2026-10-09"], todayUntouched: true });
    const p = build({ days: s.days, settings: s.settings });
    expect(p.days["2026-10-02"]).toMatchObject({ status: "protected", illness: true, xp: XP.checkin });
    expect(p.days["2026-10-07"]).toMatchObject({ status: "missed", isTrainingDay: true });
    expect(p.days["2026-10-09"]).toMatchObject({ tier: "REDUCED", engineIssued: true, cleared: true, xp: 120 + XP.checkin });
    expect(p.streak.shieldUsedOn).toEqual(["2026-10-07"]);
    expect(p.streak.current).toBe(12);
  });

  it("marks paused days protected and stops protecting once the allowance is spent", () => {
    const s = scenario({ program: threeDayProgram(), startedOn: START, todayKey: TODAY });
    const paused = build({ days: s.days, settings: { ...s.settings, pauses: [{ from: "2026-09-30", to: "2026-10-02", reason: "travel" }] } });
    expect(["2026-09-30", "2026-10-01", "2026-10-02"].map((k) => paused.days[k]?.status)).toEqual(["protected", "protected", "protected"]);
    const long = scenario({ program: threeDayProgram(), startedOn: "2026-08-01", todayKey: TODAY });
    const exhausted = build({ days: long.days, settings: { ...long.settings, pauses: [{ from: "2026-08-10", to: "2026-08-30", reason: "sick" }] } });
    const statuses = Object.entries(exhausted.days).filter(([k]) => k >= "2026-08-10" && k <= "2026-08-30").map(([, r]) => r.status);
    expect(statuses.filter((x) => x === "protected")).toHaveLength(14);
    expect(statuses.filter((x) => x !== "protected").length).toBeGreaterThan(0);
  });

  it("scores imported history by the legacy rule and ignores empty imported days", () => {
    const days: DayMap = {
      "2026-09-20": day({ exercises: [logged("x", { sets: doneSets(2) })] }),
      "2026-09-21": day({ checkin: CHECKIN_FINE }),
      ...scenario({ program: threeDayProgram(), startedOn: START, todayKey: TODAY, todayUntouched: true }).days,
    };
    const p = build({ days, settings: { startedOn: START, importedThrough: "2026-09-27", bodyweightKg: 80 } });
    expect(p.days["2026-09-20"]).toMatchObject({ legacy: true, status: "kept", xp: XP.legacyTrainingDay });
    expect(p.days["2026-09-21"]).toMatchObject({ legacy: true, status: "neutral", xp: 0 });
    expect(p.days["2026-09-22"]).toBeUndefined();
    expect(p.keptDays).toBe(15);
  });

  it("withholds records and reports loading while history is incomplete", () => {
    const s = scenario({ program: threeDayProgram(), startedOn: "2026-08-24", todayKey: TODAY, weeklyStepKg: 5 });
    const complete = build({ days: s.days, settings: s.settings });
    const loading = build({ days: s.days, settings: s.settings, historyComplete: false });
    expect(complete.days[TODAY]?.recordXp.length).toBeGreaterThan(0);
    expect(loading.status).toBe("loading-history");
    expect(Object.values(loading.days).every((r) => r.recordXp.length === 0)).toBe(true);
    expect(loading.trial).toBeNull();
  });
});

describe("invariants", () => {
  it("a program change never alters a past day", () => {
    const s = scenario({ program: threeDayProgram(), startedOn: START, todayKey: TODAY, todayUntouched: true });
    const before = build({ days: s.days, settings: s.settings });
    const changed = appendRevision(s.program, week({ Tuesday: trainingDay("New", [{ id: "squat", sets: 5 }]) }), { effectiveFrom: addDays(TODAY, 1), source: "custom" });
    const after = build({ days: s.days, settings: s.settings, program: changed });
    for (const key of Object.keys(before.days)) expect(after.days[key]).toEqual(before.days[key]);
    expect(after.xp).toBe(before.xp);
  });

  it("appending a later day never lowers total XP", () => {
    const s = scenario({ program: threeDayProgram(), startedOn: START, todayKey: TODAY });
    const base = build({ days: s.days, settings: s.settings });
    const nextKey = addDays(TODAY, 1);
    const arbSets = fc.integer({ min: 0, max: 3 });
    fc.assert(fc.property(arbSets, arbSets, arbSets, arbSets, fc.boolean(), (a, b, c, d, checkin) => {
      const extra = day({
        exercises: [logged("squat", { sets: doneSets(a) }), logged("bench", { sets: doneSets(b) }), logged("row", { sets: doneSets(c) }), logged("pushup", { sets: doneSets(d, { weightKg: null }) })],
        ...(checkin ? { checkin: CHECKIN_FINE } : {}),
      });
      const after = build({ days: { ...s.days, [nextKey]: extra }, settings: s.settings, todayKey: nextKey });
      expect(after.xp).toBeGreaterThanOrEqual(base.xp);
    }), { numRuns: 60 });
  });

  it("the displayed rank never decreases under deletes, and never drops below the persisted high", () => {
    const s = scenario({ program: threeDayProgram(), startedOn: START, todayKey: TODAY });
    const keys = Object.keys(s.days);
    fc.assert(fc.property(fc.subarray(keys), (removed) => {
      const days = { ...s.days };
      for (const k of removed) delete days[k];
      const p = build({ days, settings: { ...s.settings, high: { rank: "C", trialsPassed: [{ rank: "C", date: "2026-09-01" }], achievements: [] } } });
      expect(["C", "B", "A", "S"]).toContain(p.rank);
      expect(p.newHighs.rank).toBeUndefined();
    }), { numRuns: 60 });
  });

  it("works with no program, no days and no start date", () => {
    const p = buildProgress({ days: {}, program: null, settings: {}, todayKey: TODAY, metaFor });
    expect(p).toMatchObject({ xp: 0, level: 1, rank: "E", keptDays: 0, qualifyingWeeks: 0, weeks: [], trial: null });
    expect(p.today).toMatchObject({ dateKey: TODAY, status: "neutral", tier: null });
    expect(p.streak).toEqual({ current: 0, best: 0, shields: 0, shieldUsedOn: [] });
    const withDays = buildProgress({ days: { "2026-10-01": day({ exercises: [logged("x", { sets: doneSets(2) })] }) }, program: null, settings: {}, todayKey: TODAY, metaFor });
    expect(withDays.days["2026-10-01"]).toMatchObject({ status: "neutral", xp: 0 });
    expect(daysSinceStart({}, TODAY)).toBeNull();
    expect(daysSinceStart({ startedOn: START }, TODAY)).toBe(15);
  });

  it("includes a day logged before the start date without judging empty days before it", () => {
    const early = day({ exercises: [logged("squat", { sets: doneSets(3) })], quest: snapshot("FULL", [{ id: "squat", sets: 3 }]) });
    const p = build({ days: { "2026-09-25": early }, settings: { startedOn: START } });
    expect(p.days["2026-09-25"]).toMatchObject({ status: "kept" });
    expect(p.days["2026-09-26"]).toBeUndefined();
    expect(p.days["2026-09-28"]).toBeDefined();
  });
});

describe("rank trial", () => {
  const eight = scenario({ program: threeDayProgram(), startedOn: "2026-08-17", todayKey: TODAY, startKg: { squat: 85, bench: 65, row: 60 }, weeklyStepKg: 2.5, todayUntouched: true });

  it("becomes available once every other requirement for the next rank is met", () => {
    const p = build({ days: eight.days, settings: eight.settings, units: "imperial" });
    expect(p.level).toBeGreaterThanOrEqual(12);
    expect(p.qualifyingWeeks).toBeGreaterThanOrEqual(4);
    expect(Math.max(p.stats.str.value, p.stats.end.value)).toBeGreaterThanOrEqual(25);
    expect(p.rank).toBe("D");
    expect(p.nextRank.trialAvailable).toBe(true);
    expect(p.trial).toMatchObject({ targetRank: "C", kind: "loaded", reps: 5 });
    expect(p.trial?.spec).toMatch(/lb/);
  });

  it("promotes once a day records the trial as passed, and records the high-water mark", () => {
    const days = { ...eight.days };
    const yesterday = addDays(TODAY, -1);
    const d = days[yesterday]!;
    days[yesterday] = { ...d, quest: { ...d.quest!, trial: { targetRank: "C", exerciseId: "squat", spec: "x", passed: true } } };
    const p = build({ days, settings: eight.settings });
    expect(p.derivedRank).toBe("C");
    expect(p.rank).toBe("C");
    expect(p.newHighs.rank).toBe("C");
    expect(p.newHighs.trialsPassed).toEqual([{ rank: "C", date: yesterday }]);
    expect(p.xp).toBe(build({ days: eight.days, settings: eight.settings }).xp + XP.rankTrial);
    expect(p.trial).toBeNull();
  });

  it("waits seven days after an attempt before offering another", () => {
    const days = { ...eight.days };
    const recent = addDays(TODAY, -3);
    const d = days[recent]!;
    days[recent] = { ...d, quest: { ...d.quest!, trial: { targetRank: "C", exerciseId: "squat", spec: "x", passed: false } } };
    expect(build({ days, settings: eight.settings }).trial).toBeNull();
  });
});
