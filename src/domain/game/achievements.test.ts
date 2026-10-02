import { describe, expect, it } from "vitest";
import { addDays, type DateKey } from "../dates";
import { achievementXp, evaluateAchievements, isClearedQuest, newlyUnlocked, progressFor, TITLE_COUNT, titlesUnlocked, type AchievementInput } from "./achievements";
import { ACHIEVEMENTS, TITLE_COUNT as CONFIG_TITLE_COUNT } from "./config";
import type { AchievementState, DayResult, StreakState, WeeklyResult } from "./types";

const START: DateKey = "2026-09-01";

/** A cleared FULL training day unless overridden. */
function results(partials: Partial<DayResult>[]): Record<DateKey, DayResult> {
  return Object.fromEntries(partials.map((p, i) => {
    const dateKey = addDays(START, i);
    const r = { dateKey, status: "kept", tier: "FULL", engineIssued: true, isTrainingDay: true, legacy: false, cleared: true, checkinCounted: false, recoveryDone: false, ...p } as DayResult;
    return [dateKey, r];
  }));
}

const repeat = (n: number, p: Partial<DayResult> = {}): Partial<DayResult>[] => Array.from({ length: n }, () => ({ ...p }));
const streak = (best: number): StreakState => ({ current: 0, best, shields: 0, shieldUsedOn: [] });
const week = (closed: boolean, training: boolean, checkins: boolean): WeeklyResult => ({
  weekStart: START, closed, qualifying: closed && training, xp: 0,
  objectives: [
    { key: "training", label: "", done: 0, target: 2, met: training },
    { key: "checkins", label: "", done: 0, target: 5, met: checkins },
  ],
});

function evaluate(partial: Partial<AchievementInput> = {}): AchievementState[] {
  return evaluateAchievements({ results: {}, streak: streak(0), weeks: [], recordCount: 0, longestCardioMinutes: 0, ...partial });
}

const byId = (states: AchievementState[], id: string): AchievementState => states.find((s) => s.id === id) as AchievementState;
const unlockedIds = (states: AchievementState[]): string[] => states.filter((s) => s.unlocked).map((s) => s.id);

describe("evaluateAchievements", () => {
  it("lists every achievement, locked and at zero, for a new athlete", () => {
    const states = evaluate();
    expect(states.map((s) => s.id)).toEqual(ACHIEVEMENTS.map((a) => a.id));
    expect(states.every((s) => !s.unlocked && s.progress === 0)).toBe(true);
    expect(Object.fromEntries(states.map((s) => [s.id, s.target]))).toEqual({
      first_quest: 1, calibrated: 7, rest_is_training: 10, listener: 5, full_week: 1,
      unbroken_1: 7, unbroken_2: 30, unbroken_3: 100, record_1: 1, record_2: 10, record_3: 50, long_haul: 60, century: 100,
    });
    expect(byId(states, "century")).toMatchObject({ title: "Century", xp: 250 });
  });

  it("counts cleared training quests for First Quest and Century", () => {
    expect(unlockedIds(evaluate({ results: results([{}]) }))).toEqual(["first_quest"]);
    expect(unlockedIds(evaluate({ results: results([{ tier: "REDUCED" }]) }))).toEqual(["first_quest"]);
    for (const p of [{ tier: "RECOVER" }, { tier: "REST" }, { legacy: true }, { isTrainingDay: false }, { cleared: false }] as Partial<DayResult>[]) {
      expect(evaluate({ results: results([p]) }).some((s) => s.unlocked)).toBe(false);
    }
    expect(isClearedQuest(results([{}])[START] as DayResult)).toBe(true);
    expect(byId(evaluate({ results: results(repeat(99)) }), "century")).toMatchObject({ unlocked: false, progress: 99 });
    expect(byId(evaluate({ results: results(repeat(100)) }), "century").unlocked).toBe(true);
  });

  it("unlocks Calibrated after seven counted check-ins, on any kind of day", () => {
    const states = evaluate({ results: results(repeat(7, { isTrainingDay: false, tier: "REST", checkinCounted: true })) });
    expect(byId(states, "calibrated")).toMatchObject({ unlocked: true, progress: 7 });
    expect(byId(evaluate({ results: results(repeat(6, { checkinCounted: true })) }), "calibrated")).toMatchObject({ unlocked: false, progress: 6 });
  });

  it("unlocks Rest Is Training after ten rest-day recovery objectives", () => {
    const rest = { isTrainingDay: false, tier: "REST", recoveryDone: true } as Partial<DayResult>;
    expect(byId(evaluate({ results: results(repeat(10, rest)) }), "rest_is_training").unlocked).toBe(true);
    expect(byId(evaluate({ results: results(repeat(10, { ...rest, tier: "RECOVER" })) }), "rest_is_training").progress).toBe(0);
    expect(byId(evaluate({ results: results(repeat(10, { ...rest, recoveryDone: false })) }), "rest_is_training").progress).toBe(0);
  });

  it("unlocks Listener for five engine-issued reduced quests cleared as issued", () => {
    const reduced = { tier: "REDUCED" } as Partial<DayResult>;
    expect(byId(evaluate({ results: results(repeat(5, reduced)) }), "listener").unlocked).toBe(true);
    expect(byId(evaluate({ results: results(repeat(5, { ...reduced, engineIssued: false })) }), "listener").progress).toBe(0);
    expect(byId(evaluate({ results: results(repeat(5, { ...reduced, cleared: false })) }), "listener").progress).toBe(0);
  });

  it("unlocks Full Week for a closed week with both objectives met", () => {
    expect(byId(evaluate({ weeks: [week(true, true, true)] }), "full_week").unlocked).toBe(true);
    expect(byId(evaluate({ weeks: [week(false, true, true)] }), "full_week").unlocked).toBe(false);
    expect(byId(evaluate({ weeks: [week(true, true, false), week(true, false, true)] }), "full_week").progress).toBe(0);
  });

  it("reads the streak's best for the Unbroken tiers and caps progress at the target", () => {
    expect(unlockedIds(evaluate({ streak: streak(7) }))).toEqual(["unbroken_1"]);
    expect(unlockedIds(evaluate({ streak: streak(45) }))).toEqual(["unbroken_1", "unbroken_2"]);
    expect(unlockedIds(evaluate({ streak: streak(100) }))).toEqual(["unbroken_1", "unbroken_2", "unbroken_3"]);
    const states = evaluate({ streak: streak(45) });
    expect(byId(states, "unbroken_2").progress).toBe(30);
    expect(byId(states, "unbroken_3").progress).toBe(45);
  });

  it("reads the record count and the longest cardio session", () => {
    expect(unlockedIds(evaluate({ recordCount: 10 }))).toEqual(["record_1", "record_2"]);
    expect(unlockedIds(evaluate({ recordCount: 50 }))).toEqual(["record_1", "record_2", "record_3"]);
    expect(byId(evaluate({ longestCardioMinutes: 59 }), "long_haul")).toMatchObject({ unlocked: false, progress: 59 });
    expect(byId(evaluate({ longestCardioMinutes: 95 }), "long_haul")).toMatchObject({ unlocked: true, progress: 60 });
  });

  it("keeps anything the high-water mark holds unlocked", () => {
    const states = evaluate({ high: { achievements: ["century", "nope"] } });
    expect(byId(states, "century")).toMatchObject({ unlocked: true, progress: 0 });
    expect(unlockedIds(states)).toEqual(["century"]);
    expect(unlockedIds(evaluate({ high: {} }))).toEqual([]);
  });
});

describe("progressFor", () => {
  it("reports progress for a known id and never unlocks an unknown one", () => {
    const input: AchievementInput = { results: results(repeat(3, { checkinCounted: true })), streak: streak(0), weeks: [], recordCount: 0, longestCardioMinutes: 0 };
    expect(progressFor("calibrated", input)).toEqual([3, 7]);
    expect(progressFor("mystery", input)).toEqual([0, 1]);
  });
});

describe("newlyUnlocked and XP", () => {
  it("names unlocked ids the stored high-water mark lacks", () => {
    const states = evaluate({ results: results(repeat(7, { checkinCounted: true })) });
    expect(newlyUnlocked(states)).toEqual(["first_quest", "calibrated"]);
    expect(newlyUnlocked(states, { achievements: ["first_quest"] })).toEqual(["calibrated"]);
    expect(newlyUnlocked(states, { achievements: ["first_quest", "calibrated"] })).toEqual([]);
  });

  it("sums achievement XP and ignores ids it doesn't know", () => {
    expect(achievementXp(["first_quest", "century"])).toBe(300);
    expect(achievementXp(["mystery"])).toBe(0);
    expect(achievementXp([])).toBe(0);
  });
});

describe("titlesUnlocked", () => {
  it("adds every rank title up to the current rank, except Recruit", () => {
    const states = evaluate({ streak: streak(7), recordCount: 1 });
    expect(titlesUnlocked(states, "E")).toEqual(["Unbroken I", "Record Breaker I"]);
    expect(titlesUnlocked(states, "C")).toEqual(["Unbroken I", "Record Breaker I", "Initiate", "Contender"]);
    expect(titlesUnlocked(evaluate(), "S")).toEqual(["Initiate", "Contender", "Veteran", "Elite", "Paragon"]);
  });

  it("counts one title per achievement plus one per rank above E", () => {
    expect(TITLE_COUNT).toBe(CONFIG_TITLE_COUNT);
    expect(TITLE_COUNT).toBe(ACHIEVEMENTS.length + 5);
    const all = evaluate({ high: { achievements: ACHIEVEMENTS.map((a) => a.id) } });
    expect(titlesUnlocked(all, "S")).toHaveLength(TITLE_COUNT);
  });
});
