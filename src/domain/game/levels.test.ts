import { describe, expect, it } from "vitest";
import { LEVELS } from "./config";
import { levelFromXp, levelProgress, xpToNextLevel, xpToReachLevel } from "./levels";

describe("level curve", () => {
  it("matches the published checkpoints", () => {
    expect(xpToReachLevel(2)).toBe(60);
    expect(xpToReachLevel(5)).toBe(600);
    expect(xpToReachLevel(10)).toBe(2700);
    expect(xpToReachLevel(12)).toBe(3960);
    expect(xpToReachLevel(22)).toBe(13860);
    expect(xpToReachLevel(35)).toBe(35700);
    expect(xpToReachLevel(50)).toBe(73500);
    expect(xpToReachLevel(99)).toBe(291060);
  });

  it("inverts the cumulative table exactly at every level from 1 to 99", () => {
    for (let L = 1; L <= LEVELS.max; L += 1) {
      const floor = xpToReachLevel(L);
      expect(levelFromXp(floor)).toBe(L);
      if (L > 1) expect(levelFromXp(floor - 1)).toBe(L - 1);
      if (L < LEVELS.max) expect(xpToReachLevel(L + 1) - floor).toBe(xpToNextLevel(L));
    }
  });

  it("is monotonic and bounded", () => {
    let last = 1;
    for (let xp = 0; xp <= 300_000; xp += 97) {
      const level = levelFromXp(xp);
      expect(level).toBeGreaterThanOrEqual(last);
      expect(level).toBeLessThanOrEqual(LEVELS.max);
      last = level;
    }
    expect(levelFromXp(0)).toBe(1);
    expect(levelFromXp(-50)).toBe(1);
    expect(levelFromXp(Number.NaN)).toBe(1);
    expect(levelFromXp(10_000_000)).toBe(LEVELS.max);
    expect(xpToReachLevel(0)).toBe(0);
    expect(xpToReachLevel(500)).toBe(xpToReachLevel(LEVELS.max));
  });

  it("reports progress into the current level", () => {
    expect(levelProgress(0)).toEqual({ level: 1, into: 0, needed: 60, fraction: 0 });
    expect(levelProgress(90)).toEqual({ level: 2, into: 30, needed: 120, fraction: 0.25 });
    expect(levelProgress(1140)).toMatchObject({ level: 6, into: 240, needed: 360 });
    expect(levelProgress(xpToReachLevel(LEVELS.max) + 5)).toEqual({ level: LEVELS.max, into: 0, needed: 0, fraction: 1 });
  });
});
