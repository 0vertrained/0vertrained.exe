import { describe, expect, it } from "vitest";
import {
  buildPlanVersion,
  collectRecommendationRecords,
  evaluateRecommendation,
  buildOutcomeLoop,
  buildGoalProjection,
  buildMonthlyPhysiqueReview,
  buildPhaseTransitionRecommendation,
  buildCoachingInbox,
  buildCoachingSettingsPatch,
} from "../coachingOutcomeLoop";

function day({ weight = 190, waist = 38, calories = 2400, protein = 205, steps = 9500, sleep = 7.5, soreness = 3, workout = true } = {}) {
  return {
    workout: { exercises: workout ? { Press: { sets: [{ done: true, weight: "80", reps: "8", rir: "2", quality: "clean" }] } } : {}, cardio: { miles: "0" } },
    nutrition: { calories: String(calories), protein: String(protein) },
    activity: { steps: String(steps) },
    body: { weight: String(weight), waist: String(waist), sleep: String(sleep), soreness: String(soreness), energy: "7" },
    intelligence: {},
  };
}

function range(startKey, count, factory) {
  const out = {};
  const start = new Date(`${startKey}T12:00:00`);
  for (let index = 0; index < count; index += 1) {
    const date = new Date(start);
    date.setDate(date.getDate() + index);
    out[date.toISOString().slice(0, 10)] = factory(index);
  }
  return out;
}

const settings = {
  goals: { calories: 2400, protein: 200, steps: 9000 },
  coachingPhase: { phase: "fat_loss" },
};

describe("V18.6 coaching outcome loop", () => {
  it("creates a versioned plan and applies approved goal deltas", () => {
    const review = { weekEndKey: "2026-07-20", phase: "fat_loss", recommendation: { id: "weekly-1", kind: "calories", changes: { caloriesDelta: -125 } } };
    const plan = buildPlanVersion({ review, response: "approved", settings });
    expect(plan.label).toBe("Plan v1");
    expect(plan.snapshot.goals.calories).toBe(2275);
    expect(plan.effectiveDate).toBe("2026-07-21");
    expect(plan.evaluationDue).toBe("2026-08-03");
  });

  it("normalizes legacy weekly responses into an active lifecycle", () => {
    const data = { "2026-07-01": day() };
    data["2026-07-01"].intelligence.weeklyCoachReviewResponse = { response: "approved", recommendationId: "r1", recommendationKind: "continue", baseline: { weight: 190 } };
    const records = collectRecommendationRecords(data);
    expect(records).toHaveLength(1);
    expect(records[0].lifecycle.effectiveDate).toBe("2026-07-02");
  });

  it("marks a well-followed calorie adjustment effective when body trend improves and performance holds", () => {
    const data = range("2026-07-02", 14, (index) => day({ weight: 190 - index * 0.08, waist: 38 - index * 0.02 }));
    const record = {
      date: "2026-07-01",
      response: "approved",
      kind: "calories",
      baseline: { weight: 190.5, waist: 38.3, sleep: 7.3, soreness: 3, volume: 8500, workouts: 5 },
      lifecycle: { effectiveDate: "2026-07-02", evaluationDue: "2026-07-15" },
      planVersion: { snapshot: { goals: settings.goals } },
    };
    const result = evaluateRecommendation(record, data, settings.goals, "2026-07-15");
    expect(result.status).toBe("effective");
  });

  it("does not evaluate a recommendation that was not followed closely enough", () => {
    const data = range("2026-07-02", 4, () => day({ calories: 3200, protein: 100, steps: 2000, workout: false }));
    const record = { date: "2026-07-01", response: "approved", kind: "activity", baseline: { weight: 190 }, lifecycle: { effectiveDate: "2026-07-02", evaluationDue: "2026-07-15" } };
    expect(evaluateRecommendation(record, data, settings.goals, "2026-07-15").status).toBe("not_followed");
  });

  it("builds an active outcome loop and preserves plan history", () => {
    const data = { "2026-07-01": day() };
    data["2026-07-01"].intelligence.weeklyCoachReviewResponse = {
      response: "approved", recommendationId: "r1", recommendationKind: "activity", recordedAt: "2026-07-01T12:00:00Z",
      lifecycle: { effectiveDate: "2026-07-02", evaluationDue: "2026-07-15" },
      planVersion: { id: "p1", version: 1, label: "Plan v1", createdAt: "2026-07-01T12:00:00Z", effectiveDate: "2026-07-02", evaluationDue: "2026-07-15", status: "active", snapshot: { goals: settings.goals } },
      baseline: { weight: 190 },
    };
    const loop = buildOutcomeLoop({ data, settings, todayKey: "2026-07-05" });
    expect(loop.records[0].outcome.status).toBe("active");
    expect(loop.planVersions[0].id).toBe("p1");
  });

  it("projects a range from a real 28-day downward trend", () => {
    const data = range("2026-06-23", 28, (index) => day({ weight: 200 - index * 0.12 }));
    const result = buildGoalProjection({ data, settings: { ...settings, coachingSystem: { goalWeightRange: { min: 178, max: 185 } } }, todayKey: "2026-07-20" });
    expect(result.recentRate).toBeLessThan(0);
    expect(result.estimatedWindow).not.toBeNull();
    expect(result.confidence).toBe("moderate");
  });

  it("recommends a maintenance transition when the goal range is reached", () => {
    const transition = buildPhaseTransitionRecommendation({
      monthlyReview: { current: { sleep: 7.5, soreness: 3 }, strengthStatus: "stable" },
      settings,
      projection: { currentWeight: 184, goalRange: { min: 178, max: 185 } },
    });
    expect(transition.to).toBe("maintenance");
  });

  it("creates inbox items and default hard-constraint settings", () => {
    const patched = buildCoachingSettingsPatch(settings);
    expect(patched.coachingSystem.clinicianGuardrails.stopRules).toContain("Chest discomfort");
    const inbox = buildCoachingInbox({
      review: { weekEndKey: "2026-07-20", recommendation: { id: "new", title: "Continue" } },
      outcomeLoop: { records: [] },
      nutritionAutopilot: { traysRemaining: 3 },
      phaseTransition: { kind: "stay" },
      todayKey: "2026-07-20",
    });
    expect(inbox.items.some((item) => item.kind === "review")).toBe(true);
    expect(inbox.items.some((item) => item.kind === "nutrition")).toBe(true);
  });

  it("summarizes a monthly block without pretending sparse data is definitive", () => {
    const data = range("2026-07-01", 10, (index) => day({ weight: 190 - index * 0.1 }));
    const review = buildMonthlyPhysiqueReview({ data, settings, todayKey: "2026-07-20" });
    expect(review.assessment.toLowerCase()).toContain("sparse");
  });
});
