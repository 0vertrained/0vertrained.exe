// src/__tests__/mainSleepDiscipline.test.js
// ─────────────────────────────────────────────────────────────────────────────
// V16.6 · Main-sleep discipline — pinned against the real-data report behind
// V16.5.1's "recovery 37 on an ordinary morning". The user's own export shows
// the actual root cause: the newest day carried ONLY a `late_nap` (1.9h,
// avg_hrv 39, lowest_hr 68 — nap physiology), and the engine scored it against
// a main-sleep baseline (~71 ms HRV, ~58 bpm RHR): z=−2.54 / z=+2.98 → 37,
// while the last real night scored 87. The SD floors were treating a symptom;
// the deviation was real, just measured against the wrong kind of sleep.
// These tests pin: naps never score, never enter baselines, never count as a
// night of sleep — and split nights sum their long_sleep segments.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import {
  getSleepDoc, getAnySleepDoc, isMainSleepDoc, mainSleepDurationSeconds,
  recoveryDates, latestRecoveryDay, tempDeviation,
} from "../oura/normalization";
import { calcRecoveryScore, calcHRVScore, calcRHRScore, calcSleepSubscore, calcSleepDebt } from "../wearables/recoveryEngine";

// Miniaturized real-shape fixture: 5 ordinary main-sleep days + a nap-only
// newest day, values lifted from the reporting user's export.
function mainDay(day, hrv, rhr, durH = 6.8) {
  return {
    sleep: { data: [{
      day, type: "long_sleep",
      total_sleep_duration: durH * 3600, time_in_bed: durH * 3600 + 1800,
      awake_time: 1500, deep_sleep_duration: durH * 3600 * 0.17,
      rem_sleep_duration: durH * 3600 * 0.21, latency: 800, efficiency: 88,
      average_hrv: hrv, lowest_heart_rate: rhr, average_heart_rate: rhr + 6,
      readiness: { temperature_deviation: 0.05 },
    }]},
    readiness: { data: [{ day, score: 78, temperature_deviation: 0.05, contributors: { hrv_balance: 70, resting_heart_rate: 95, previous_night: 75, sleep_balance: 72 } }] },
  };
}

const NAP_ONLY_DAY = {
  sleep: { data: [{
    day: "2026-07-15", type: "late_nap",
    total_sleep_duration: 6750, time_in_bed: 10160, awake_time: 3410,
    latency: 720, efficiency: 66,
    average_hrv: 39, lowest_heart_rate: 68, average_heart_rate: 71,
    readiness: { score: 44, temperature_deviation: 0.07 },
  }]},
  // No standalone readiness — Oura had not produced tomorrow's yet.
};

function buildFixture() {
  return {
    "2026-07-15": NAP_ONLY_DAY,
    "2026-07-14": mainDay("2026-07-14", 64, 57),
    "2026-07-13": mainDay("2026-07-13", 57, 58),
    "2026-07-12": mainDay("2026-07-12", 76, 57),
    "2026-07-11": mainDay("2026-07-11", 71, 60),
    "2026-07-10": mainDay("2026-07-10", 70, 59),
  };
}

describe("V16.6 main-sleep discipline (real-data nap repro)", () => {
  it("classifies the real nap and main shapes correctly", () => {
    expect(isMainSleepDoc(NAP_ONLY_DAY.sleep.data[0])).toBe(false);
    expect(isMainSleepDoc(buildFixture()["2026-07-14"].sleep.data[0])).toBe(true);
    // Untyped short segment (Oura "sleep" fragments run minutes long) → not main.
    expect(isMainSleepDoc({ type: "sleep", total_sleep_duration: 600 })).toBe(false);
    // Untyped, durationless legacy/partial record → benefit of the doubt.
    expect(isMainSleepDoc({ average_hrv: 62, lowest_heart_rate: 48 })).toBe(true);
  });

  it("a nap-only newest day is not a recovery day and never becomes the scoring anchor", () => {
    const oura = buildFixture();
    expect(getSleepDoc(oura["2026-07-15"])).toBe(null);
    expect(getAnySleepDoc(oura["2026-07-15"])?.type).toBe("late_nap"); // display path still sees it
    expect(recoveryDates(oura)[0]).toBe("2026-07-14");
    expect(latestRecoveryDay(oura)).toBe("2026-07-14");
  });

  it("the composite scores the last real night, not the nap (37 → ordinary-morning band)", () => {
    const oura = buildFixture();
    const rec = calcRecoveryScore(oura, {});
    expect(rec.scoredDay).toBe("2026-07-14");
    // The nap repro read 37/consider_rest; a real night must land in a
    // training band. Pin the floor generously — the point is band, not digit.
    expect(rec.score).toBeGreaterThanOrEqual(70);
    expect(["ready_to_push", "good_to_train"]).toContain(rec.band);
  });

  it("nap HRV/RHR never enter the leave-one-out pools", () => {
    const oura = buildFixture();
    const hrv = calcHRVScore(oura, {});
    const rhr = calcRHRScore(oura);
    // Pool = 4 prior main nights (scoring day 07-14 excluded, nap invisible).
    expect(hrv.sampleCount).toBe(4);
    expect(rhr.sampleCount).toBe(4);
    // A nap in the pool would drag the RHR baseline above 60; the real
    // baseline of {57,58,76→(hrv), rhr 58,57,60,59} sits below it.
    expect(Number(rhr.baseline)).toBeLessThan(60);
  });

  it("naps never count as a night of sleep in the debt ledger", () => {
    const oura = buildFixture();
    const hours = recoveryDates(oura)
      .map((d) => (mainSleepDurationSeconds(oura[d]) ?? 0) / 3600)
      .filter(Boolean);
    // 5 main nights — the 1.9h nap is not one of them.
    expect(hours).toHaveLength(5);
    expect(Math.min(...hours)).toBeGreaterThan(3);
    const sd = calcSleepDebt(hours, { needHours: null, baselineSamples: hours });
    expect(sd.debtHours).toBeLessThan(3); // no 5h phantom deficit from the nap
  });

  it("split nights sum their long_sleep segments (real 6.5h + 4.3h export shape)", () => {
    const day = {
      sleep: { data: [
        { day: "2026-07-12", type: "long_sleep", total_sleep_duration: 23430, time_in_bed: 27900, efficiency: 84, average_hrv: 76, lowest_heart_rate: 57, latency: 2220 },
        { day: "2026-07-12", type: "long_sleep", total_sleep_duration: 15390, time_in_bed: 18770, efficiency: 82, average_hrv: 65, lowest_heart_rate: 61, latency: 510 },
      ]},
    };
    expect(mainSleepDurationSeconds(day)).toBe(23430 + 15390);
    // Primary segment (longest) still anchors HRV/RHR.
    expect(getSleepDoc(day).average_hrv).toBe(76);
    // Duration subscore sees the full night: 10.8h → max duration points.
    const oura = { "2026-07-12": day };
    const sub = calcSleepSubscore(getSleepDoc(day), oura, "2026-07-12");
    expect(sub.components.dScore).toBe(8);
  });

  it("tempDeviation falls back to the sleep-embedded readiness block", () => {
    const sleep = { readiness: { temperature_deviation: 0.31 } };
    expect(tempDeviation(sleep, null)).toBe(0.31);
    // Standalone readiness still wins when present.
    expect(tempDeviation(sleep, { temperature_deviation: -0.1 })).toBe(-0.1);
  });

  it("a day with both nap and main sleep still anchors on the main sleep", () => {
    const day = {
      sleep: { data: [
        { day: "2026-07-08", type: "late_nap", total_sleep_duration: 4920, average_hrv: 35, lowest_heart_rate: 74 },
        { day: "2026-07-08", type: "long_sleep", total_sleep_duration: 21270, average_hrv: 70, lowest_heart_rate: 60, efficiency: 97 },
      ]},
    };
    expect(getSleepDoc(day).type).toBe("long_sleep");
    expect(mainSleepDurationSeconds(day)).toBe(21270); // nap excluded from the sum
  });
});
