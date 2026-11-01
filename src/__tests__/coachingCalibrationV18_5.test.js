import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCoachingCalibrationProfile, collectWeeklyRecommendationSamples } from "../coachingCalibration";

function day({ response = null, weekly = null, weight = 190, sleep = 7, protein = 200, workout = true } = {}) {
  return {
    workout: { exercises: workout ? { Row: { sets: [] } } : {}, cardio: { miles: "0" } },
    nutrition: { calories: "2400", protein: String(protein) },
    body: { weight: String(weight), sleep: String(sleep), energy: "7", soreness: "3" },
    intelligence: {
      todayDecisionResponse: response,
      weeklyCoachReviewResponse: weekly,
    },
  };
}

 describe("V18.5 coaching calibration", () => {
  // V19.4 · The fixtures sit in May–June 2026 and the calibration report reads
  // a 90-day window back from "now", so on the real clock these started
  // failing as the calendar moved on. Pin "now" to when they were written.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-01T12:00:00"));
  });
  afterEach(() => { vi.useRealTimers(); });

  it("starts in observation mode with no personal outcomes", () => {
    const profile = buildCoachingCalibrationProfile({ data: {} });
    expect(profile.authority).toBe("observe");
    expect(profile.confidenceAdjustment).toBe(-1);
    expect(profile.falsePositiveGuard.requireSecondWeek).toBe(true);
  });

  it("is provider-neutral for Whoop-only and Oura-only trend inputs", () => {
    const whoop = buildCoachingCalibrationProfile({ data: {}, wearableTrends: { sources: { hrv: "whoop", sleep: "whoop" } } });
    const oura = buildCoachingCalibrationProfile({ data: {}, wearableTrends: { sources: { hrv: "oura", sleep: "oura" } } });
    expect(whoop.sourceCoverage.hasWearable).toBe(true);
    expect(oura.sourceCoverage.hasWearable).toBe(true);
    expect(whoop.sourceCoverage.providerNeutral).toBe(true);
    expect(oura.sourceCoverage.providerNeutral).toBe(true);
  });

  it("builds weekly outcome samples only after a follow-up window exists", () => {
    const data = {
      "2026-06-01": day({ weekly: { response: "approved", recommendationKind: "continue", baseline: { weight: 192, waist: 39, protein: 195, sleep: 7, workouts: 4 } }, weight: 192 }),
      "2026-06-07": day({ weight: 191, protein: 205 }),
      "2026-06-08": day({ weight: 190.8, protein: 205 }),
    };
    const samples = collectWeeklyRecommendationSamples(data);
    expect(samples).toHaveLength(1);
    expect(samples[0].followed).toBe(true);
    expect(samples[0].favorable).toBe(true);
  });

  it("raises the false-positive threshold after repeated rejected weekly calls", () => {
    const data = {};
    for (let week = 0; week < 3; week += 1) {
      const start = new Date("2026-05-01T12:00:00");
      start.setDate(start.getDate() + week * 8);
      const reviewKey = start.toISOString().slice(0, 10);
      const future = new Date(start);
      future.setDate(future.getDate() + 7);
      data[reviewKey] = day({ weekly: { response: "rejected", recommendationKind: "calories", baseline: { weight: 190, protein: 200, sleep: 7, workouts: 5 } } });
      data[future.toISOString().slice(0, 10)] = day({ weight: 190 });
    }
    const profile = buildCoachingCalibrationProfile({ data });
    expect(profile.weekly.rejected).toBeGreaterThanOrEqual(2);
    expect(profile.falsePositiveGuard.minStallDays).toBe(21);
    expect(profile.falsePositiveGuard.minRecoverySignals).toBe(4);
  });

  it("advances to calibrated authority after enough daily and weekly outcomes", () => {
    const data = {};
    const start = new Date("2026-05-01T12:00:00");
    for (let i = 0; i < 10; i += 1) {
      const date = new Date(start);
      date.setDate(date.getDate() + i);
      const next = new Date(date);
      next.setDate(next.getDate() + 1);
      data[date.toISOString().slice(0, 10)] = day({ response: { response: "followed", decisionCall: "maintain" }, weight: 192 - i * 0.1 });
      data[next.toISOString().slice(0, 10)] = day({ weight: 191.9 - i * 0.1 });
    }
    for (let week = 0; week < 4; week += 1) {
      const review = new Date("2026-05-20T12:00:00");
      review.setDate(review.getDate() + week * 8);
      const future = new Date(review);
      future.setDate(future.getDate() + 7);
      data[review.toISOString().slice(0, 10)] = day({ weekly: { response: "approved", recommendationKind: "continue", baseline: { weight: 190 - week, protein: 200, sleep: 7, workouts: 5 } }, weight: 190 - week });
      data[future.toISOString().slice(0, 10)] = day({ weight: 189.5 - week, protein: 205 });
    }
    const profile = buildCoachingCalibrationProfile({ data });
    expect(profile.daily.sampleCount).toBeGreaterThanOrEqual(8);
    expect(profile.weekly.followedCount).toBeGreaterThanOrEqual(4);
    expect(profile.authority).toBe("calibrated");
  });
});
