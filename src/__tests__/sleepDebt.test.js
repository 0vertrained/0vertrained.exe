// V15.5.1 · Sleep-debt model contracts. Written against the real-data report
// that motivated the rewrite: 9h of app-computed debt while both Oura and
// Whoop showed 0. The reproduction case is pinned first.
import { describe, expect, it } from "vitest";
import { calcSleepDebt } from "../oura/algorithms";

describe("calcSleepDebt", () => {
  it("REPRO: a healthy 7.2h sleeper no longer accrues phantom debt", () => {
    // Old model: 7 × (8 − 7.2) = 5.6h "debt", verdict docked one point.
    // New model: personal norm = 7.2h (clamped to 7) → tiny honest remainder.
    const week = [7.2, 7.1, 7.3, 7.2, 7.0, 7.4, 7.2];
    const sd = calcSleepDebt(week);
    expect(sd.baselineSource).toBe("personal-norm");
    expect(sd.debtHours).toBeLessThan(1.5);
    expect(sd.band).toBe("Well-rested");
  });

  it("grades against the wearable's own need when provided", () => {
    const sd = calcSleepDebt([7.2, 7.1, 7.3, 7.2, 7.0, 7.4, 7.2], { needHours: 7.2 });
    expect(sd.baselineSource).toBe("wearable-need");
    expect(sd.baselineHours).toBe(7.2);
    expect(sd.debtHours).toBeLessThan(0.5);
  });

  it("real deprivation still registers, against any baseline", () => {
    const sd = calcSleepDebt([5.5, 6.0, 5.8, 6.2, 5.9, 6.1, 5.7], { needHours: 7.5 });
    expect(sd.debtHours).toBeGreaterThan(9);
    expect(sd.band).toMatch(/Moderate|Significant/);
  });

  it("surpluses repay at half credit and debt floors at zero", () => {
    // One 10h night against a 7.5h need: 2.5h surplus → 1.25h credit.
    const sd = calcSleepDebt([6.5, 7.5, 10, 7.5, 7.5, 7.5, 7.5], { needHours: 7.5 });
    expect(sd.debtHours).toBe(0); // 1.0 deficit − 1.25 credit → floored
  });

  it("a chronically deprived stretch cannot normalize itself (norm floors at 6.5)", () => {
    // V16.9 · Floor lowered 7 → 6.5: the 7h floor manufactured ~4h/week of
    // phantom debt for healthy sub-7h sleepers (the reporting user's 6.4h
    // median read 9h+ while both wearables said minimal). The INTENT of this
    // pin is unchanged — a genuinely deprived stretch still clamps UP:
    const sd = calcSleepDebt([6, 6.1, 6, 5.9, 6, 6.1, 6]);
    expect(sd.baselineHours).toBe(6.5);
    expect(sd.debtHours).toBeGreaterThan(2.5);
    // And a healthy 6.4–6.5h sleeper is no longer graded against 7h:
    expect(calcSleepDebt([6.4, 6.5, 6.4, 6.3, 6.5, 6.4, 6.5]).debtHours).toBeLessThanOrEqual(0.7);
  });

  it("implausible need figures clamp; fewer than 5 samples falls back to 8h", () => {
    expect(calcSleepDebt([7, 7, 7, 7, 7], { needHours: 14 }).baselineHours).toBe(10);
    const sparse = calcSleepDebt([7.5, 7.5]);
    expect(sparse.baselineSource).toBe("default");
    expect(sparse.baselineHours).toBe(8);
  });

  it("empty input stays the safe well-rested shape", () => {
    expect(calcSleepDebt([])).toEqual({ debtHours: 0, band: "Well-rested", baselineHours: 8, baselineSource: "default" });
  });
});
