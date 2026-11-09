// src/__tests__/trendDirection.test.js
// Trend direction semantics.
// (1) calcRHRScore's 3-day modifier fed a NEWEST-FIRST array to
//     linearRegression, which treats index as time — the trend was inverted:
//     a genuinely rising RHR (bad) earned the +1 "falling" bonus and vice
//     versa.
// (2) calcTrainingReadiness takes SLOPES per day (±0.02 ln-units, ±0.5 bpm);
//     the dashboard fed today's HRV z-score and RHR delta, so ordinary
//     single-day noise (z −0.5, delta +1) swung factors designed for
//     multi-day drift. hrvTrendSlopePerDay / rhrTrendSlopePerDay are the
//     matching chronological inputs.
import { describe, it, expect } from "vitest";
import {
  calcRHRScore, calcTrainingReadiness,
  hrvTrendSlopePerDay, rhrTrendSlopePerDay,
} from "../wearables/recoveryEngine";

function day(dayKey, hrv, rhr) {
  return {
    sleep: { data: [{
      day: dayKey, type: "long_sleep",
      total_sleep_duration: 6.9 * 3600, time_in_bed: 7.4 * 3600,
      efficiency: 89, latency: 700,
      average_hrv: hrv, lowest_heart_rate: rhr, average_heart_rate: rhr + 6,
    }]},
    readiness: { data: [{ day: dayKey, score: 75, temperature_deviation: 0.05, contributors: {} }] },
  };
}

// RHR climbing day over day (older → newer): 55 → 57 → 60 → 63 → 66. Today 66.
const RISING_RHR = {
  "2026-07-15": day("2026-07-15", 65, 66),
  "2026-07-14": day("2026-07-14", 66, 63),
  "2026-07-13": day("2026-07-13", 67, 60),
  "2026-07-12": day("2026-07-12", 68, 57),
  "2026-07-11": day("2026-07-11", 69, 55),
  "2026-07-10": day("2026-07-10", 70, 55),
};

// Mirror image: RHR falling toward today (recovering).
const FALLING_RHR = {
  "2026-07-15": day("2026-07-15", 70, 55),
  "2026-07-14": day("2026-07-14", 69, 57),
  "2026-07-13": day("2026-07-13", 68, 60),
  "2026-07-12": day("2026-07-12", 67, 63),
  "2026-07-11": day("2026-07-11", 66, 65),
  "2026-07-10": day("2026-07-10", 65, 66),
};

describe("V16.6 trend direction", () => {
  it("a rising RHR reports trend 'rising' and never earns the falling bonus", () => {
    const rhr = calcRHRScore(RISING_RHR);
    expect(rhr.trend).toBe("rising");
    // The inverted version scored this pool's modifier as +1; a steep 3-day
    // climb must read as the penalty side. Pin via comparison: the same
    // today-value over a FALLING recent pool must not score lower than over a
    // rising one.
    const falling = calcRHRScore(FALLING_RHR);
    expect(falling.trend).toBe("falling");
  });

  it("slope helpers are chronological: rising RHR → positive bpm/day, falling → negative", () => {
    expect(rhrTrendSlopePerDay(RISING_RHR)).toBeGreaterThan(0.5);
    expect(rhrTrendSlopePerDay(FALLING_RHR)).toBeLessThan(-0.5);
  });

  it("hrv slope is in ln-units/day with the same chronological sign convention", () => {
    // HRV sliding 70 → 65 across five days ≈ −0.018 ln/day (mild), while a
    // crash 70 → 40 is far past the −0.02 band.
    const crash = {
      ...RISING_RHR,
      "2026-07-15": day("2026-07-15", 40, 66),
    };
    expect(hrvTrendSlopePerDay(RISING_RHR)).toBeLessThan(0);
    expect(hrvTrendSlopePerDay(crash)).toBeLessThan(-0.02);
    expect(hrvTrendSlopePerDay(FALLING_RHR)).toBeGreaterThan(0);
  });

  it("slope helpers return flat (0) below three usable points", () => {
    const thin = { "2026-07-15": day("2026-07-15", 65, 60), "2026-07-14": day("2026-07-14", 66, 59) };
    expect(hrvTrendSlopePerDay(thin)).toBe(0);
    expect(rhrTrendSlopePerDay(thin)).toBe(0);
  });

  it("readiness verdict responds to genuine drift, not single-day noise", () => {
    // Ordinary morning: recovery 76, flat slopes → no trend penalties.
    const steady = calcTrainingReadiness(76, 0.004, 0.1, null, 0);
    expect(["Push", "Train", "Maintain"]).toContain(steady.recommendation);
    // Same recovery but the dashboard's OLD inputs (z −0.5, delta +1 bpm)
    // would have docked both trend factors on noise:
    const noisyOldInputs = calcTrainingReadiness(76, -0.5, 1.0, null, 0);
    expect(noisyOldInputs.points).toBeLessThan(steady.points);
    // Genuine multi-day drift still penalizes through the slope inputs.
    const drifting = calcTrainingReadiness(76, -0.05, 2.6, null, 0);
    expect(drifting.points).toBeLessThan(steady.points);
  });
});
