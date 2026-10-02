import { describe, expect, it } from "vitest";
import { buildWeeklyCoachReview, buildWeeklyReviewResponse } from "../weeklyCoachReview";

const endKey = "2026-07-20";

function key(offset) {
  const date = new Date(`${endKey}T12:00:00`);
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function day({ weight = 190, waist = 38, calories = 2400, protein = 205, steps = 9500, sleep = 7.5, workout = true } = {}) {
  return {
    workout: { exercises: workout ? { "Incline Press": { sets: [{ weight: "80", reps: "8", rir: "2", done: true, quality: "clean" }] } } : {}, cardio: { miles: "0" } },
    nutrition: { calories: String(calories), protein: String(protein), water: "128" },
    activity: { steps: String(steps) },
    body: { weight: String(weight), waist: String(waist), sleep: String(sleep), energy: "7", soreness: "3" },
    intelligence: {},
  };
}

function twoWeeks({ previousWeight = 191, currentWeight = 190, previousWaist = 38.5, currentWaist = 38, current = {}, previous = {} } = {}) {
  const data = {};
  for (let i = -13; i <= -7; i += 1) data[key(i)] = day({ weight: previousWeight, waist: previousWaist, ...previous });
  for (let i = -6; i <= 0; i += 1) data[key(i)] = day({ weight: currentWeight, waist: currentWaist, ...current });
  return data;
}

const goals = { calories: 2400, protein: 200, steps: 9000, workouts: 5, miles: 15, water: 128 };
const calibrated = { authority: "calibrated", confidenceAdjustment: 0, falsePositiveGuard: { minStallDays: 14, minRecoverySignals: 3, requireSecondWeek: true }, summary: "Calibrated." };

 describe("V18.3 weekly coaching review", () => {
  it("continues an effective fat-loss week without adding another lever", () => {
    const result = buildWeeklyCoachReview({ data: twoWeeks(), goals, settings: { coachingPhase: { phase: "fat_loss" } }, weekEndKey: endKey, calibrationProfile: calibrated });
    expect(result.recommendation.kind).toBe("continue");
    expect(result.trend.weightDelta).toBeLessThan(0);
    expect(result.adherence.protein).toBeGreaterThanOrEqual(80);
    expect(result.observationMode).toBe(false);
  });

  it("prioritizes adherence instead of lowering calories when execution is inconsistent", () => {
    const result = buildWeeklyCoachReview({
      data: twoWeeks({ currentWeight: 190, previousWeight: 190, currentWaist: 38, previousWaist: 38, current: { calories: 3000, protein: 130 } }),
      goals,
      settings: { coachingPhase: { phase: "fat_loss" } },
      weekEndKey: endKey,
      calibrationProfile: calibrated,
    });
    expect(result.recommendation.kind).toBe("adherence");
    expect(result.recommendation.changes.caloriesDelta).toBe(0);
    expect(result.recommendation.summary.toLowerCase()).toContain("not been tested");
  });

  it("uses one small calorie lever for a true adherent stall", () => {
    const result = buildWeeklyCoachReview({
      data: twoWeeks({ currentWeight: 190, previousWeight: 190, currentWaist: 38, previousWaist: 38 }),
      goals,
      settings: { coachingPhase: { phase: "fat_loss" } },
      weekEndKey: endKey,
      calibrationProfile: calibrated,
    });
    expect(["calories", "activity"]).toContain(result.recommendation.kind);
    expect(result.recommendation.changes.caloriesDelta ?? result.recommendation.changes.stepsDelta).not.toBe(0);
  });

  it("holds restriction when recovery signals converge", () => {
    const wearableTrends = {
      hasEnoughData: true,
      notes: [
        { metric: "hrv", trend: "falling", note: "HRV is below baseline." },
        { metric: "rhr", trend: "rising", note: "Resting heart rate is elevated." },
        { metric: "sleep", trend: "falling", note: "Sleep duration is declining." },
      ],
    };
    const result = buildWeeklyCoachReview({
      data: twoWeeks({ current: { sleep: 6.1 } }),
      goals,
      settings: { coachingPhase: { phase: "fat_loss" } },
      weekEndKey: endKey,
      wearableTrends,
      calibrationProfile: calibrated,
    });
    expect(["recovery", "diet_break"]).toContain(result.recommendation.kind);
    expect(result.recommendation.summary.toLowerCase()).toMatch(/do not reduce calories|hold restriction/);
  });

  it("persists a review response with the comparison baseline", () => {
    const review = buildWeeklyCoachReview({ data: twoWeeks(), goals, weekEndKey: endKey, calibrationProfile: calibrated });
    const response = buildWeeklyReviewResponse(review, "modified", { modifiedKind: "recovery", reason: "Leg fatigue" });
    expect(response.response).toBe("modified");
    expect(response.modifiedKind).toBe("recovery");
    expect(response.baseline.loggedDays).toBe(7);
    expect(response.baseline.weight).toBeGreaterThan(0);
  });
});
