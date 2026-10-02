// src/__tests__/dataDrivenCalibration.test.js
// ─────────────────────────────────────────────────────────────────────────────
// V16.7 · Calibration fixes surfaced by running the engine against a real
// 14-day dual-wearable export:
//   Z1 · Whoop load: strain is logarithmic and NOT additive across workouts
//        (export: 5 workouts summed to 17.9 strain → 626 load, on a day whose
//        actual day-strain was 4.1). Zone minutes ARE additive — load is now
//        Σ zone-minutes × sRPE-equivalent weight, the manual model's currency.
//   C1 · Conflicts: Whoop RHR reads +5.8 bpm above Oura's lowest-HR EVERY day
//        of the export — a definitional offset the raw 5 bpm rule flagged as
//        a standing daily "conflict". HRV/RHR now compare deviations from
//        each device's OWN baseline (the codebase's stated V16.0 doctrine).
//   R1 · Robust spread: one crash night inflated the plain SD and masked the
//        next real dip (export: 07-05 crash widened ln-SD 0.15→0.24, so a
//        −16% morning both wearables flagged read z −0.45 here).
//   A1 · resp_elevated could never fire: V2 readiness has no respiratory_rate
//        — it lives on sleep as average_breath.
//   P1 · Nap-skip transparency: when a nap-only newer day is (correctly)
//        skipped, the provenance line says so.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { buildWearableLoadRows } from "../wearableWorkoutLoad";
import { detectConflicts } from "../recovery/wearableSourceResolver";
import { trimmedStdDev, stdDev } from "../oura/statistics";
import { calcHRVScore, calcRecoveryScore } from "../wearables/recoveryEngine";
import { checkAlerts } from "../oura/alerts";
import { buildSignalProvenance } from "../wearables/signalProvenance";

const Z = (mins) => mins * 60000;

function whoopWorkout(zones, strain = 5) {
  return { id: Math.random().toString(36).slice(2), score_state: "SCORED", score: { strain, zone_durations: zones } };
}

function ouraMainDay(day, hrv, rhr, extra = {}) {
  return {
    sleep: { data: [{
      day, type: "long_sleep", total_sleep_duration: 6.9 * 3600, time_in_bed: 7.4 * 3600,
      efficiency: 89, latency: 700, average_hrv: hrv, lowest_heart_rate: rhr, average_heart_rate: rhr + 6,
      ...extra,
    }]},
    readiness: { data: [{ day, score: 76, temperature_deviation: 0.05, contributors: {} }] },
  };
}

describe("Z1 · zone-based Whoop load", () => {
  it("computes sRPE-equivalent load from zone minutes and is additive across workouts", () => {
    // 60 min of zone 2 ≈ RPE4 × 60 = 240 — the manual model's exact currency.
    const single = { workout: [whoopWorkout({ zone_two_milli: Z(60) })] };
    const rows1 = buildWearableLoadRows({ entries: {}, whoopData: { "2026-07-10": single }, ouraData: {}, stravaByDate: {}, maxDays: 2, asOf: new Date("2026-07-10T12:00:00") });
    expect(rows1.find((r) => r.date === "2026-07-10").load).toBe(240);

    // Two identical 30-min z2 workouts must equal one 60-min z2 workout.
    const split = { workout: [whoopWorkout({ zone_two_milli: Z(30) }), whoopWorkout({ zone_two_milli: Z(30) })] };
    const rows2 = buildWearableLoadRows({ entries: {}, whoopData: { "2026-07-10": split }, ouraData: {}, stravaByDate: {}, maxDays: 2, asOf: new Date("2026-07-10T12:00:00") });
    expect(rows2.find((r) => r.date === "2026-07-10").load).toBe(240);
  });

  it("no longer explodes on multi-workout days the way strain-summing did", () => {
    // Export-shaped day: five easy workouts, mostly z0/z1 walking (82 + 72 min),
    // whose strains summed to 17.9. Old load: 17.9 × 35 = 626.
    const day = { workout: [
      whoopWorkout({ zone_zero_milli: Z(40), zone_one_milli: Z(30) }, 4.8),
      whoopWorkout({ zone_zero_milli: Z(20), zone_one_milli: Z(20), zone_two_milli: Z(7) }, 9.0),
      whoopWorkout({ zone_zero_milli: Z(10), zone_one_milli: Z(10) }, 4.1),
      whoopWorkout({ zone_zero_milli: Z(6), zone_one_milli: Z(6) }, 0),
      whoopWorkout({ zone_zero_milli: Z(6), zone_one_milli: Z(6), zone_three_milli: Z(1) }, 0),
    ] };
    const rows = buildWearableLoadRows({ entries: {}, whoopData: { "2026-07-05": day }, ouraData: {}, stravaByDate: {}, maxDays: 2, asOf: new Date("2026-07-05T12:00:00") });
    const load = rows.find((r) => r.date === "2026-07-05").load;
    // Σ = 82×1 + 72×2 + 7×4 + 1×6 = 260 — easy-movement scale, not 626.
    expect(load).toBe(260);
    expect(load).toBeLessThan(400);
  });

  it("falls back to the strain heuristic when zone_durations are absent", () => {
    const legacy = { workout: [{ id: "old", score: { strain: 10 } }] };
    const rows = buildWearableLoadRows({ entries: {}, whoopData: { "2026-07-10": legacy }, ouraData: {}, stravaByDate: {}, maxDays: 2, asOf: new Date("2026-07-10T12:00:00") });
    expect(rows.find((r) => r.date === "2026-07-10").load).toBe(350);
  });
});

describe("C1 · baseline-relative conflicts", () => {
  const OFFSET = 6; // Whoop reads ~+6 bpm over Oura, every day — definitional.
  function dualHistory(days, { ouraToday, whoopToday }) {
    const oura = {}; const whoop = {};
    for (let i = 1; i <= days; i++) {
      const d = `2026-07-${String(i).padStart(2, "0")}`;
      oura[d] = ouraMainDay(d, 70, 58);
      whoop[d] = { recovery: { score_state: "SCORED", score: { recovery_score: 65, hrv_rmssd_milli: 72, resting_heart_rate: 58 + OFFSET } } };
    }
    const today = `2026-07-${String(days + 1).padStart(2, "0")}`;
    oura[today] = ouraMainDay(today, ouraToday.hrv, ouraToday.rhr);
    whoop[today] = { recovery: { score_state: "SCORED", score: { recovery_score: 60, hrv_rmssd_milli: whoopToday.hrv, resting_heart_rate: whoopToday.rhr } }, sleep: { nap: false, score_state: "SCORED", score: { stage_summary: { total_in_bed_time_milli: Z(430), total_awake_time_milli: Z(20) } } } };
    return { oura, whoop, today };
  }

  it("a stable systematic RHR offset is NOT a conflict", () => {
    const { oura, whoop, today } = dualHistory(8, { ouraToday: { hrv: 70, rhr: 58 }, whoopToday: { hrv: 72, rhr: 58 + OFFSET } });
    const conflicts = detectConflicts({ ouraData: oura, whoopData: whoop, date: today });
    expect(conflicts.find((c) => c.metric === "rhr")).toBeUndefined();
  });

  it("genuine divergence — one device elevated vs its own baseline, the other flat — still fires, in baseline-relative mode", () => {
    const { oura, whoop, today } = dualHistory(8, { ouraToday: { hrv: 70, rhr: 58 }, whoopToday: { hrv: 72, rhr: 58 + OFFSET + 7 } });
    const rhr = detectConflicts({ ouraData: oura, whoopData: whoop, date: today }).find((c) => c.metric === "rhr");
    expect(rhr).toBeDefined();
    expect(rhr.mode).toBe("baseline-relative");
    expect(rhr.whoopDeviation).toBeGreaterThan(5);
    expect(Math.abs(rhr.ouraDeviation)).toBeLessThan(2);
  });

  it("falls back to the absolute comparison below 4 baseline days", () => {
    const { oura, whoop, today } = dualHistory(2, { ouraToday: { hrv: 70, rhr: 58 }, whoopToday: { hrv: 72, rhr: 58 + OFFSET } });
    const rhr = detectConflicts({ ouraData: oura, whoopData: whoop, date: today }).find((c) => c.metric === "rhr");
    expect(rhr).toBeDefined(); // raw 6 bpm gap ≥ 5 bpm rule — old behavior preserved
    expect(rhr.mode).toBe("absolute");
  });
});

describe("R1 · robust spread", () => {
  it("trimmedStdDev drops the extremes the way trimmedMean does", () => {
    const pool = [4.25, 4.22, 4.28, 4.24, 4.26, 4.23, 4.27, 3.61, 4.25, 4.24]; // one crash
    expect(trimmedStdDev(pool, 0.1)).toBeLessThan(stdDev(pool) / 3);
    expect(trimmedStdDev([4.2, 4.3], 0.1)).toBe(stdDev([4.2, 4.3])); // <5 samples → plain
  });

  it("a real dip after a crash night now registers (export repro: −16% read z −0.45)", () => {
    const oura = {};
    const hrvs = [70, 72, 69, 71, 37, 70, 73, 68, 71, 70]; // 07-05-style crash in-pool
    hrvs.forEach((h, i) => { const d = `2026-07-${String(i + 1).padStart(2, "0")}`; oura[d] = ouraMainDay(d, h, 58); });
    oura["2026-07-11"] = ouraMainDay("2026-07-11", 59, 58); // −16% vs ~70 baseline
    const hrv = calcHRVScore(oura, {});
    expect(Number(hrv.zScore)).toBeLessThanOrEqual(-1.0);
    expect(hrv.score).toBeLessThanOrEqual(24);
    // …while a genuinely ordinary morning stays in the healthy band.
    oura["2026-07-11"] = ouraMainDay("2026-07-11", 69, 58);
    expect(calcHRVScore(oura, {}).score).toBeGreaterThanOrEqual(28);
  });
});

describe("A1 · respiratory alert reads the V2 field", () => {
  it("fires on elevated sleep.average_breath (previously impossible on synced data)", () => {
    const oura = {};
    for (let i = 1; i <= 8; i++) {
      const d = `2026-07-${String(i).padStart(2, "0")}`;
      oura[d] = ouraMainDay(d, 70, 58, { average_breath: 16.5 });
    }
    oura["2026-07-09"] = ouraMainDay("2026-07-09", 70, 58, { average_breath: 19.4 });
    const result = checkAlerts(oura);
    expect(result.markers).toContain("resp_elevated");
  });
});

describe("P1 · nap-skip provenance", () => {
  it("explains the skipped nap-only day at the verdict", () => {
    const oura = {
      "2026-07-15": { sleep: { data: [{ day: "2026-07-15", type: "late_nap", total_sleep_duration: 6750, average_hrv: 39, lowest_heart_rate: 68 }] } },
      "2026-07-14": ouraMainDay("2026-07-14", 64, 57),
      "2026-07-13": ouraMainDay("2026-07-13", 70, 58),
      "2026-07-12": ouraMainDay("2026-07-12", 72, 57),
      "2026-07-11": ouraMainDay("2026-07-11", 69, 59),
      "2026-07-10": ouraMainDay("2026-07-10", 71, 58),
    };
    const rec = calcRecoveryScore(oura, {});
    const line = buildSignalProvenance(rec, oura, {}, rec.scoredDay);
    expect(rec.scoredDay).toBe("2026-07-14");
    expect(line).toMatch(/nap/i);
    expect(line).toMatch(/2026-07-15/);
    expect(line).toMatch(/last night/i);
  });
});
