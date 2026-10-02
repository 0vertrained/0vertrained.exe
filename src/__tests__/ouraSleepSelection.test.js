import { describe, expect, it } from "vitest";
import { getSleepDoc } from "../oura/normalization";
import { calcRecoveryScore } from "../oura/algorithms";

const shortNap = {
  id: "nap-1",
  day: "2026-06-25",
  type: "sleep",
  total_sleep_duration: 1800,
  time_in_bed: 2400,
  awake_time: 600,
  sleep_latency: 300,
  skin_temperature_deviation: 0.08,
};

const mainSleep = {
  id: "main-1",
  day: "2026-06-25",
  type: "long_sleep",
  score: 82,
  total_sleep_duration: 7.5 * 3600,
  time_in_bed: 8 * 3600,
  awake_time: 1800,
  deep_sleep_duration: 1.4 * 3600,
  rem_sleep_duration: 1.7 * 3600,
  sleep_latency: 600,
  sleep_efficiency: 0.91,
  lowest_heart_rate: 55,
  average_heart_rate: 61,
  heart_rate_variability: { average: 72, rmssd: 72 },
  skin_temperature_deviation: 0.08,
};

const readiness = {
  data: [{
    day: "2026-06-25",
    score: 80,
    temperature_deviation: 0.08,
    contributors: {
      hrv_balance: 78,
      resting_heart_rate: 82,
      previous_night: 82,
      sleep_balance: 75,
      body_temperature: 96,
    },
  }],
};

describe("Oura merged sleep payload selection", () => {
  it("selects the main/best sleep document rather than the first same-day segment", () => {
    const day = { sleep: { data: [shortNap, mainSleep] }, readiness };

    expect(getSleepDoc(day)).toMatchObject({ id: "main-1", score: 82 });
  });

  it("does not collapse recovery to temp-only when merged sleep starts with a nap segment", () => {
    const ouraData = {
      "2026-06-25": { sleep: { data: [shortNap, mainSleep] }, readiness },
    };

    const recovery = calcRecoveryScore(ouraData);

    expect(recovery.subscores.hrv).toBeGreaterThan(0);
    expect(recovery.subscores.rhr).toBeGreaterThan(0);
    expect(recovery.subscores.sleep).toBeGreaterThan(0);
    expect(recovery.score).toBeGreaterThan(50);
  });
});
