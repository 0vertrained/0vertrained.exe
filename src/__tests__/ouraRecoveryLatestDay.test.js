import { describe, expect, it } from "vitest";
import { calcHRVScore, calcRecoveryScore } from "../oura/algorithms";
import { hrvRmssd, hrvRmssdWithSource } from "../oura/normalization";

const sleepDoc = {
  id: "sleep-2026-06-30",
  day: "2026-06-30",
  type: "long_sleep",
  total_sleep_duration: 26370,
  time_in_bed: 28800,
  awake_time: 1800,
  deep_sleep_duration: 4890,
  rem_sleep_duration: 5550,
  sleep_latency: 600,
  lowest_heart_rate: 58,
  average_heart_rate: 65,
  hrv: {
    items: [null, null, 32, 73, null, 65, 77, 90],
    interval: 300,
    timestamp: "2026-06-29T23:30:30.000-05:00",
  },
  skin_temperature_deviation: -0.09,
};

const readiness = {
  data: [{
    day: "2026-06-30",
    score: 80,
    temperature_deviation: -0.09,
    contributors: {
      hrv_balance: 74,
      sleep_balance: 72,
      previous_night: 84,
      recovery_index: 65,
      activity_balance: 91,
      body_temperature: 100,
      sleep_regularity: 77,
      resting_heart_rate: 100,
      previous_day_activity: 71,
    },
  }],
};

describe("Oura recovery scoring with heartrate-only latest day", () => {
  it("extracts RMSSD from Oura hrv.items arrays", () => {
    expect(hrvRmssd(sleepDoc)).toBeGreaterThan(60);
  });

  it("prefers Oura average_hrv over hrv.items average so UI matches the app nightly HRV", () => {
    const withAggregate = {
      ...sleepDoc,
      average_hrv: 70,
      hrv: { items: [28, 31, 34], interval: 300 },
    };

    expect(hrvRmssd(withAggregate)).toBe(70);
    expect(hrvRmssdWithSource(withAggregate)).toEqual({
      value: 70,
      source: "raw sleep average HRV",
    });
  });

  it("scores recovery from latest sleep/readiness day, not heartrate-only sync date", () => {
    const ouraData = {
      "2026-07-01": {
        heartrate: { data: [{ bpm: 90, source: "awake", timestamp: "2026-06-17T00:03:36.000Z" }] },
      },
      "2026-06-30": {
        sleep: { data: [sleepDoc] },
        readiness,
      },
    };

    const recovery = calcRecoveryScore(ouraData);

    expect(recovery.subscores.hrv).toBeGreaterThan(0);
    expect(recovery.subscores.sleep).toBeGreaterThan(0);
    expect(recovery.score).toBeGreaterThan(40);
  });

  it("uses Oura readiness HRV balance instead of showing 0/35 when the latest readiness day lacks sleep HRV", () => {
    const ouraData = {
      "2026-07-01": {
        readiness: {
          data: [{
            day: "2026-07-01",
            score: 79,
            contributors: { hrv_balance: 86, resting_heart_rate: 80, previous_night: 76, body_temperature: 100 },
          }],
        },
      },
      "2026-06-30": {
        sleep: { data: [{ ...sleepDoc, average_hrv: 70 }] },
        readiness,
      },
    };

    const hrv = calcHRVScore(ouraData);

    expect(hrv.score).toBe(30);
    expect(hrv.source).toBe("readiness fallback");
    expect(hrv.detail).toContain("86/100");
  });

  it("maps numeric Oura HRV balance when the user selects Oura-mapped HRV", () => {
    const ouraData = {
      "2026-06-30": {
        sleep: { data: [{ ...sleepDoc, average_hrv: 70 }] },
        readiness,
      },
    };

    const hrv = calcHRVScore(ouraData, { hrvSource: "ouraMapped" });

    expect(hrv.score).toBe(26);
    expect(hrv.source).toBe("readiness fallback");
    expect(hrv.detail).toContain("74/100");
  });
});
