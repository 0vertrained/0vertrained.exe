import { describe, expect, it } from "vitest";
import { addDays } from "../dates";
import { XP } from "./config";
import type { DayResult } from "./types";
import { CHECKIN_DAYS_TARGET, scoreWeek, trainingTarget } from "./weekly";

const MON = "2026-09-28"; // a Monday

function fakeDay(offset: number, partial: Partial<DayResult>): DayResult {
  return { dateKey: addDays(MON, offset), status: "kept", tier: "FULL", isTrainingDay: true, cleared: true, checkinCounted: true, legacy: false, ...partial } as DayResult;
}

function week(days: DayResult[]): Record<string, DayResult> {
  return Object.fromEntries(days.map((d) => [d.dateKey, d]));
}

describe("trainingTarget", () => {
  it("is one less than the planned days, never below one", () => {
    expect(trainingTarget(2)).toBe(1);
    expect(trainingTarget(3)).toBe(2);
    expect(trainingTarget(6)).toBe(5);
    expect(trainingTarget(1)).toBe(1);
    expect(trainingTarget(0)).toBe(1);
  });
});

describe("scoreWeek", () => {
  const full = week([
    fakeDay(0, {}), fakeDay(1, { isTrainingDay: false, tier: "REST" }), fakeDay(2, {}), fakeDay(3, { isTrainingDay: false, tier: "REST" }),
    fakeDay(4, { tier: "REDUCED" }), fakeDay(5, { isTrainingDay: false, tier: "REST", checkinCounted: false }), fakeDay(6, { isTrainingDay: false, tier: "REST", checkinCounted: false }),
  ]);

  it("awards both objectives and the bonus once the week has closed", () => {
    const r = scoreWeek({ weekStart: MON, plannedTrainingDays: 3, results: full, todayKey: addDays(MON, 7) });
    expect(r.objectives).toEqual([
      { key: "training", label: "Clear 2 training quests", done: 3, target: 2, met: true },
      { key: "checkins", label: `Check in on ${CHECKIN_DAYS_TARGET} days`, done: 5, target: 5, met: true },
    ]);
    expect(r).toMatchObject({ closed: true, qualifying: true, xp: XP.weeklyObjective * 2 + XP.weeklyBothBonus });
  });

  it("shows progress but pays nothing while the week is still running", () => {
    const r = scoreWeek({ weekStart: MON, plannedTrainingDays: 3, results: full, todayKey: addDays(MON, 6) });
    expect(r).toMatchObject({ closed: false, qualifying: false, xp: 0 });
    expect(r.objectives[0]?.met).toBe(true);
  });

  it("pays one objective alone without the bonus", () => {
    const results = week([fakeDay(0, {}), fakeDay(2, {}), fakeDay(4, { checkinCounted: false })]);
    const r = scoreWeek({ weekStart: MON, plannedTrainingDays: 3, results, todayKey: addDays(MON, 7) });
    expect(r.objectives.map((o) => o.met)).toEqual([true, false]);
    expect(r.xp).toBe(XP.weeklyObjective);
    expect(r.qualifying).toBe(true);
  });

  it("counts only training quests cleared at FULL or REDUCED, never RECOVER, rest or imported days", () => {
    const results = week([
      fakeDay(0, { tier: "RECOVER" }), fakeDay(2, { legacy: true }), fakeDay(4, { cleared: false, status: "missed" }),
      fakeDay(1, { isTrainingDay: false, tier: "REST" }), fakeDay(3, {}),
    ]);
    const r = scoreWeek({ weekStart: MON, plannedTrainingDays: 3, results, todayKey: addDays(MON, 7) });
    expect(r.objectives[0]).toMatchObject({ done: 1, met: false });
    expect(r.qualifying).toBe(false);
  });

  it("uses only the week's own days", () => {
    const results = { ...full, [addDays(MON, 7)]: fakeDay(7, {}), [addDays(MON, -1)]: fakeDay(-1, {}) };
    const r = scoreWeek({ weekStart: MON, plannedTrainingDays: 3, results, todayKey: addDays(MON, 8) });
    expect(r.objectives[0]?.done).toBe(3);
    expect(r.objectives[1]?.done).toBe(5);
  });
});
