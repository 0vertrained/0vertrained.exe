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
  // The fixtures sit in May–June 2026 and the calibration report reads
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

  it("keeps legacy approval and an empty entry 50 days later out of the success rate", () => {
    const data = {
      "2026-05-01": day({ weekly: { response: "approved", recommendationKind: "continue", baseline: { weight: 192, sleep: 7 } } }),
      "2026-06-20": {},
    };
    const profile = buildCoachingCalibrationProfile({ data });
    expect(profile.weekly).toMatchObject({ approved: 1, followedCount: 0, evaluatedCount: 0, successRate: null });
    expect(profile.weekly.samples[0]).toMatchObject({ outcomeEnd: "2026-05-08", outcome: "unknown", followed: false, favorable: null });
    expect(profile.authority).toBe("observe");
  });

  it("scores the recommended step change only with a mature window and explicit follow-through", () => {
    const intent = { response: "approved", recommendationKind: "activity", stepsDelta: 1000, followThrough: "followed", followThroughOn: "2026-06-18" };
    const data = {};
    for (const date of ["05", "06", "10", "11", "15", "17", "18"]) {
      data[`2026-06-${date}`] = { activity: { steps: Number(date) <= 10 ? 5000 : Number(date) <= 17 ? 6000 : 1 } };
    }
    data["2026-06-10"].intelligence = { weeklyCoachReviewResponse: intent };
    const sample = asOf => collectWeeklyRecommendationSamples(data, { asOf })[0];
    expect(sample("2026-06-09")).toBeUndefined();
    expect(sample("2026-06-16")).toMatchObject({ outcome: "pending", execution: null });
    expect(sample("2026-06-17")).toMatchObject({ outcome: "unknown", execution: null });
    expect(sample("2026-06-18")).toMatchObject({ outcome: "favorable", execution: "followed", before: { steps: 5000 }, after: { steps: 6000, stepCount: 3 } });
    data["2026-06-11"].activity.steps = 0;
    expect(sample("2026-06-18")).toMatchObject({ outcome: "unfavorable", after: { steps: 4000, stepCount: 3 } });
    delete data["2026-06-11"];
    expect(sample("2026-06-18").outcome).toBe("unknown");

    for (const response of ["modified", "rejected"]) {
      intent.response = response;
      expect(sample("2026-06-18").favorable).toBeNull();
    }
    intent.response = "approved";
    intent.followThroughOn = "2026-06-11";
    expect(sample("2026-06-18").execution).toBeNull();
  });

  it("isolates nutrition, sleep and weight outcomes and preserves unknowns in incomplete logs", () => {
    const data = {};
    for (let d = 1; d <= 14; d++) {
      const key = `2026-06-${String(d).padStart(2, "0")}`;
      data[key] = day({ weight: d <= 7 ? 200 : 199, sleep: 7, protein: d <= 7 ? 80 : 150 });
      data[key].nutrition.foodLogConfirmation = { calories: 2400, confirmedOn: key };
    }
    const intent = { response: "approved", followThrough: "followed", followThroughOn: "2026-06-15", phase: "fat_loss", goals: { calories: 2400, protein: 150 } };
    data["2026-06-07"].intelligence.weeklyCoachReviewResponse = intent;
    const result = kind => {
      intent.recommendationKind = kind;
      return collectWeeklyRecommendationSamples(data, { asOf: "2026-06-15" })[0].outcome;
    };
    expect(result("calories")).toBe("favorable");
    expect(result("diet_break")).toBe("unfavorable");
    expect(result("recovery")).toBe("unfavorable");
    expect(result("adherence")).toBe("favorable");
    expect(result("continue")).toBe("favorable");
    expect(result("collect_food")).toBe("favorable");
    expect(result("unrecognized")).toBe("unknown");
    for (const entry of Object.values(data)) delete entry.nutrition.foodLogConfirmation;
    expect(result("continue")).toBe("unknown");
    expect(result("adherence")).toBe("unknown");
    expect(result("collect_food")).toBe("unknown");
    intent.response = "modified";
    expect(result("calories")).toBe("unknown");
    intent.response = "approved";
    intent.followThrough = "skipped";
    expect(result("calories")).toBe("unknown");
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
      data[review.toISOString().slice(0, 10)] = day({ weekly: {
        response: "approved", recommendationKind: "collect_data", followThrough: "followed",
        followThroughOn: future.toISOString().slice(0, 10),
      } });
      for (const days of [1, 3, 5, 7]) {
        const reading = new Date(review);
        reading.setDate(reading.getDate() + days);
        data[reading.toISOString().slice(0, 10)] = day({ weight: 189.5 - week });
      }
    }
    const profile = buildCoachingCalibrationProfile({ data });
    expect(profile.daily.sampleCount).toBeGreaterThanOrEqual(8);
    expect(profile.weekly).toMatchObject({ followedCount: 4, evaluatedCount: 4, successRate: 100 });
    expect(profile.authority).toBe("calibrated");
  });
});
