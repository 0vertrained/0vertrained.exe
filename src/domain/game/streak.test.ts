import { describe, expect, it } from "vitest";
import { addDays } from "../dates";
import { STREAK } from "./config";
import { emptyStreak, foldStreak, streakNotice } from "./streak";
import type { DayResult, DayStatus } from "./types";

function results(statuses: DayStatus[]): DayResult[] {
  return statuses.map((status, i) => ({ dateKey: addDays("2026-09-01", i), status }) as DayResult);
}

const K = "kept", M = "missed", P = "protected", O = "open", N = "neutral";

describe("foldStreak", () => {
  it("counts consecutive kept days and remembers the best", () => {
    expect(foldStreak(results([K, K, K]))).toMatchObject({ current: 3, best: 3, shields: 0 });
    expect(foldStreak(results([K, K, K, M, K]))).toMatchObject({ current: 1, best: 3, shields: 0, shieldUsedOn: [] });
    expect(foldStreak([])).toEqual(emptyStreak());
  });

  it("earns a shield every seven kept days in a row, two at most", () => {
    expect(foldStreak(results(Array(6).fill(K))).shields).toBe(0);
    expect(foldStreak(results(Array(7).fill(K))).shields).toBe(1);
    expect(foldStreak(results(Array(14).fill(K))).shields).toBe(STREAK.maxShields);
    expect(foldStreak(results(Array(28).fill(K))).shields).toBe(STREAK.maxShields);
  });

  it("spends a shield on a missed day: the streak survives, the missed day adds nothing", () => {
    const s = foldStreak(results([...Array(7).fill(K), M, K]));
    expect(s).toMatchObject({ current: 8, best: 8, shields: 0, shieldUsedOn: ["2026-09-08"] });
  });

  it("resets only once the shields are gone", () => {
    const s = foldStreak(results([...Array(14).fill(K), M, M, M, K]));
    expect(s).toMatchObject({ current: 1, best: 14, shields: 0 });
    expect(s.shieldUsedOn).toEqual(["2026-09-15", "2026-09-16"]);
  });

  it("skips protected, neutral and open days without breaking anything", () => {
    expect(foldStreak(results([K, K, P, P, K, N, K, O]))).toMatchObject({ current: 4, best: 4 });
  });

  it("restarts the shield counter after a reset", () => {
    const s = foldStreak(results([...Array(6).fill(K), M, ...Array(6).fill(K)]));
    expect(s.shields).toBe(0);
    expect(foldStreak(results([...Array(6).fill(K), M, ...Array(7).fill(K)])).shields).toBe(1);
  });
});

describe("streakNotice", () => {
  it("announces a spent shield", () => {
    const before = foldStreak(results(Array(7).fill(K)));
    const after = foldStreak(results([...Array(7).fill(K), M]));
    expect(streakNotice(before, after)).toBe("[SHIELD] Streak protected. 0 left.");
  });

  it("announces a reset without shame", () => {
    // Both shields already spent; the next miss is the reset.
    const before = foldStreak(results([...Array(23).fill(K), M, M]));
    const after = foldStreak(results([...Array(23).fill(K), M, M, M]));
    expect(before).toMatchObject({ current: 23, shields: 0 });
    expect(streakNotice(before, after)).toBe("Streak reset. Best: 23 days. Today is day 1.");
  });

  it("stays quiet otherwise", () => {
    const a = foldStreak(results([K]));
    expect(streakNotice(a, foldStreak(results([K, K])))).toBeNull();
    expect(streakNotice(emptyStreak(), emptyStreak())).toBeNull();
  });
});
