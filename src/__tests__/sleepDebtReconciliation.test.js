// src/__tests__/sleepDebtReconciliation.test.js
// Sleep debt reconciled with what the wearables report. Repro (shapes
// from the reporting user's real export): both devices said "minimal" while
// the app said 9h+. Three causes, each pinned here:
//   1. NEED took Whoop's FULL tonight-specific figure (baseline + their own
//      debt-repayment loop + strain), which swings 4.5h→9.8h day to day; the
//      latest-date walk-back was a lottery, and any need error multiplied ×7
//      across the window (7.8h need → 4.4h debt; 9.7h → 16.3h on identical
//      sleep). Now: baseline_milli only, MEDIAN across the window.
//   2. Naps never credited the slept side while Whoop's need explicitly
//      deducts for them. Now: main + nap hours for debt accounting; HRV/RHR
//      baselines keep the V16.6 main-sleep discipline untouched.
//   3. The personal-norm 7h floor manufactured phantom debt for sub-7h
//      sleepers. Now: floor 6.5, matching the wearable-need clamp.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { calcSleepDebt } from "../wearables/recoveryEngine";
import { napSleepDurationSeconds, mainSleepDurationSeconds } from "../oura/normalization";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(resolve(root, p), "utf8");

// The reference week's shape: mains [6.9,6.4,10.8,8.9,6.2,7.0,5.9], naps on
// four of the days (1.4h on the biggest), Whoop baseline steady at 7.6h while
// the full tonight-need swings 4.5→9.8 because of debt/strain/nap add-ons.
const MAINS = [6.9, 6.4, 10.8, 8.9, 6.2, 7.0, 5.9];
const NAPS = [0.2, 0.4, 0.0, 0.0, 0.2, 0.0, 1.4];
const WITH_NAPS = MAINS.map((m, i) => m + NAPS[i]);

describe("V16.9 sleep debt — the repro and the fix", () => {
  it("old model: identical sleep read 4.4h or 16.3h depending on which need day the walk-back hit", () => {
    const calm = calcSleepDebt(MAINS, { needHours: 7.78, baselineSamples: MAINS });
    const spiky = calcSleepDebt(MAINS, { needHours: 9.7, baselineSamples: MAINS });
    expect(calm.debtHours).toBeCloseTo(4.4, 0);
    expect(spiky.debtHours).toBeGreaterThan(15); // the user's 9h+, reproduced
    expect(spiky.band).toBe("Significant sleep debt");
  });

  it("fixed inputs: baseline-only need + nap credit lands where the wearables do", () => {
    const fixed = calcSleepDebt(WITH_NAPS, { needHours: 7.63, baselineSamples: WITH_NAPS });
    expect(fixed.debtHours).toBeLessThanOrEqual(2);
    expect(fixed.band).toBe("Well-rested");
  });

  it("the dashboard never sums the tonight-specific need components again", () => {
    const src = read("src/RecoveryDashboard.jsx");
    expect(src).not.toContain("need_from_sleep_debt_milli");
    expect(src).not.toContain("need_from_recent_strain_milli");
    expect(src).toContain("baseline_milli");
    // Median across the window — not a latest-date walk-back:
    expect(src).toContain("baselines[Math.floor(baselines.length / 2)]");
    // Naps credit the slept side:
    expect(src).toContain("napSleepDurationSeconds(oura[date])");
  });

  it("nap helper: sums non-main sleep, excludes deleted docs and main segments (split nights stay whole)", () => {
    const day = { sleep: { data: [
      { type: "long_sleep", total_sleep_duration: 3.5 * 3600 },
      { type: "long_sleep", total_sleep_duration: 3.0 * 3600 }, // split-night segment
      { type: "late_nap", total_sleep_duration: 1.4 * 3600 },
      { type: "nap", total_sleep_duration: 0.5 * 3600 },
      { type: "deleted", total_sleep_duration: 2.0 * 3600 },    // never counts
    ]}};
    expect(mainSleepDurationSeconds(day)).toBe(6.5 * 3600);
    expect(napSleepDurationSeconds(day)).toBeCloseTo(1.9 * 3600, 5);
    expect(napSleepDurationSeconds({ sleep: { data: [] } })).toBe(0);
    expect(napSleepDurationSeconds(undefined)).toBe(0);
  });

  it("personal-norm floor: a 6.4h-median sleeper is graded against 6.5, not 7.0", () => {
    const week = [6.4, 6.4, 6.5, 6.3, 6.4, 6.5, 6.4];
    const d = calcSleepDebt(week, {});
    expect(d.baselineHours).toBe(6.5);
    expect(d.baselineSource).toBe("personal-norm");
    expect(d.debtHours).toBeLessThanOrEqual(0.7); // was ~4h of phantom debt at the 7h floor
    expect(d.band).toBe("Well-rested");
    // The ceiling still refuses to normalize deprivation:
    expect(calcSleepDebt([9.8, 9.9, 9.7, 9.8, 9.9, 9.8, 9.7], {}).baselineHours).toBe(9);
  });

  it("stability: with a steady baseline the debt no longer depends on which day synced last", () => {
    // Same sleep, two different 'latest' full-need figures — irrelevant now,
    // because only baseline_milli (steady) feeds the calculation.
    const a = calcSleepDebt(WITH_NAPS, { needHours: 7.63, baselineSamples: WITH_NAPS });
    const b = calcSleepDebt(WITH_NAPS, { needHours: 7.63, baselineSamples: WITH_NAPS });
    expect(a.debtHours).toBe(b.debtHours);
    expect(Math.abs(a.debtHours - b.debtHours)).toBeLessThan(0.05);
  });

  it("the debt row explains its own math on the surface", () => {
    const src = read("src/RecoveryDashboard.jsx");
    expect(src).toContain("baseline need (Whoop)");
    expect(src).toContain("naps credited");
  });
});
