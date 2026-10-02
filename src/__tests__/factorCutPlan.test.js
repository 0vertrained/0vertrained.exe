import { describe, expect, it } from "vitest";
import { FACTOR_SCHEDULE, factorDayPlan, factorInventoryThroughDay, getFactorDayIndex } from "../factorCutPlan";

describe("Factor cut plan", () => {
  it("maps the 12-day date window", () => {
    expect(getFactorDayIndex("2026-07-20")).toBe(0);
    expect(getFactorDayIndex("2026-07-31")).toBe(11);
    expect(getFactorDayIndex("2026-08-01")).toBe(-1);
  });

  it("lands known days in the intended protein range", () => {
    const known = FACTOR_SCHEDULE.map((_, i) => factorDayPlan(i)).filter(d => d.known);
    expect(known.every(d => d.preFlexProtein >= 220 && d.preFlexProtein <= 230)).toBe(true);
  });

  it("decrements inventory from scheduled meals", () => {
    const start = factorInventoryThroughDay(0).reduce((s, m) => s + m.remaining, 0);
    const afterThree = factorInventoryThroughDay(3).reduce((s, m) => s + m.remaining, 0);
    expect(start).toBe(24);
    expect(afterThree).toBe(18);
  });
});
