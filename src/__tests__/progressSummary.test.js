import { describe, expect, it } from "vitest";
import {
  buildProgressHero,
  buildProgressLimiters,
  buildProgressEvidence,
  buildFormCheckProgressPreview,
  buildBlockProgressPreview,
} from "../progressSummary";

// ── Fixtures ──────────────────────────────────────────────────────────────────
const GOALS = { protein: 200, miles: 15, workouts: 5, water: 128 };

// A "strong week" coach review as the real buildWeeklyCoachReview would emit it.
const strongReview = {
  score: 88,
  summary: "Excellent consistency across training, recovery, and fueling.",
  confidence: "high",
  daysLogged: 6,
  watchouts: [],
  nextWeekActions: ["Maintain the current rhythm; avoid extra load."],
  metrics: { workoutDays: 6, totalMiles: 22, avgProtein: 210, avgSleep: 7.6, avgEnergy: 8, avgSoreness: 2 },
};

// A "pressured week" coach review — low score.
const weakReview = {
  score: 38,
  summary: "Recovery and fueling signals are tight.",
  confidence: "medium",
  daysLogged: 5,
  watchouts: ["Sleep recovery: 5.4h average (goal 7h)."],
  nextWeekActions: ["Stabilize sleep and recovery before increasing intensity."],
  metrics: { workoutDays: 2, totalMiles: 4, avgProtein: 120, avgSleep: 5.4, avgEnergy: 5, avgSoreness: 6 },
};

// calcWeeklyReview-shaped objects for the limiter tests.
const weeklyReviewStrong = {
  daysLogged: 6, workoutsDone: 6, totalMiles: 22, avgProtein: 210, avgSleep: 7.6, proteinDays: 6, waterDays: 6,
};
const weeklyReviewLowConsistency = {
  daysLogged: 6, workoutsDone: 1, totalMiles: 3, avgProtein: 205, avgSleep: 7.5, proteinDays: 6, waterDays: 6,
};
const weeklyReviewLowFuelSleep = {
  daysLogged: 6, workoutsDone: 5, totalMiles: 16, avgProtein: 110, avgSleep: 5.5, proteinDays: 1, waterDays: 5,
};

describe("buildProgressHero", () => {
  it("returns a good/improving verdict for a strong, consistent week", () => {
    const hero = buildProgressHero({ goals: GOALS, coachReview: strongReview });
    expect(hero.verdict).toBe("Improving");
    expect(hero.tone).toBe("good");
    expect(hero.score).toBe(88);
    expect(hero.confidence).toBe("high");
    expect(hero.primaryDrivers).toHaveLength(4);
    expect(hero.primaryDrivers[0]).toMatchObject({ label: "Workouts", tone: "good" });
    expect(typeof hero.nextFocus).toBe("string");
    expect(hero.nextFocus.length).toBeGreaterThan(0);
  });

  it("returns a warning verdict for a pressured week", () => {
    const hero = buildProgressHero({ goals: GOALS, coachReview: weakReview });
    expect(hero.verdict).toBe("Needs adjustment");
    expect(hero.tone).toBe("warning");
  });

  it("is null-safe with empty data: neutral, low confidence, no NaN", () => {
    const hero = buildProgressHero({});
    expect(hero.tone).toBe("neutral");
    expect(hero.confidence).toBe("low");
    expect(hero.score).toBeNull();
    expect(hero.verdict).toBe("Not enough data yet");
    expect(typeof hero.summary).toBe("string");
    // No NaN leaks into any driver value.
    for (const d of hero.primaryDrivers) {
      expect(d.value).not.toMatch(/NaN/);
    }
  });
});

describe("buildProgressLimiters", () => {
  it("surfaces a training-consistency limiter when workouts are low", () => {
    const cards = buildProgressLimiters({ goals: GOALS, review: weeklyReviewLowConsistency });
    const training = cards.find((c) => c.id === "training");
    expect(training).toBeTruthy();
    expect(["warning", "caution"]).toContain(training.tone);
    expect(training.body.toLowerCase()).toMatch(/limiter|worth watching/);
  });

  it("surfaces fuel and recovery limiters when protein and sleep are low", () => {
    const cards = buildProgressLimiters({ goals: GOALS, review: weeklyReviewLowFuelSleep });
    expect(cards.find((c) => c.id === "fuel")).toBeTruthy();
    expect(cards.find((c) => c.id === "recovery")).toBeTruthy();
  });

  it("returns a positive 'no single limiter' card for a strong week", () => {
    const cards = buildProgressLimiters({ goals: GOALS, review: weeklyReviewStrong });
    expect(cards).toHaveLength(1);
    expect(cards[0].id).toBe("none");
    expect(cards[0].tone).toBe("good");
  });

  it("is null-safe with empty data (single neutral pending card, no NaN)", () => {
    const cards = buildProgressLimiters({});
    expect(cards).toHaveLength(1);
    expect(cards[0].id).toBe("nodata");
    expect(cards[0].tone).toBe("neutral");
    expect(cards[0].metric).not.toMatch(/NaN/);
  });
});

describe("buildProgressEvidence", () => {
  it("aggregates 30-day roll-ups from the daily data map", () => {
    const data = {
      "2026-06-01": { workout: { cardio: { miles: 5 } }, nutrition: { protein: 200 }, body: { sleep: 8, weight: 180 } },
      "2026-06-02": { workout: { exercises: { squat: { sets: [] } } }, nutrition: { protein: 180 }, body: { sleep: 7, weight: 179 } },
    };
    const ev = buildProgressEvidence({ data, goals: GOALS });
    expect(ev.workouts30d).toBe(2);
    expect(ev.miles30d).toBe(5);
    expect(ev.proteinAvg).toBe(190);
    expect(ev.sleepAvg).toBe(7.5);
    expect(ev.weightTrend).toMatch(/down 1 lb/);
    expect(ev.cards.length).toBeGreaterThanOrEqual(4);
  });

  it("is null-safe with empty data (no NaN, dashes for missing averages)", () => {
    const ev = buildProgressEvidence({});
    expect(ev.workouts30d).toBe(0);
    expect(ev.miles30d).toBe(0);
    expect(ev.proteinAvg).toBeNull();
    expect(ev.sleepAvg).toBeNull();
    for (const card of ev.cards) {
      expect(String(card.value)).not.toMatch(/NaN/);
    }
  });
});

describe("buildFormCheckProgressPreview", () => {
  it("returns a helpful unavailable preview when there are no saved checks", () => {
    const preview = buildFormCheckProgressPreview({ formCheckHistory: [], formCheckSummary: { total: 0 } });
    expect(preview.available).toBe(false);
    expect(preview.nextAction).toMatch(/two checks/i);
    expect(preview.privacyNote).toMatch(/no raw video/i);
  });

  it("returns latest movement + trend when checks and movement trends exist", () => {
    const formCheckSummary = {
      total: 3,
      latest: { movement: "squat", movementLabel: "Back Squat", formScore: { score: 82 }, confidence: { level: "high" } },
      movements: [{ label: "Back Squat", latestScore: 82 }],
    };
    const movementTrends = [
      { label: "Back Squat", scoreTrend: "improving", nextCheckRecommendation: "Re-check squat next week." },
    ];
    const preview = buildFormCheckProgressPreview({ formCheckHistory: [{}, {}, {}], formCheckSummary, movementTrends });
    expect(preview.available).toBe(true);
    expect(preview.latestLabel).toBe("Back Squat");
    expect(preview.scoreLabel).toMatch(/Score 82/);
    expect(preview.trendLabel).toMatch(/improving/i);
    expect(preview.nextAction).toMatch(/Re-check squat/);
  });

  it("does not fabricate a trend from a single check", () => {
    const formCheckSummary = { total: 1, latest: { movementLabel: "Deadlift", formScore: 70 }, movements: [{ label: "Deadlift", latestScore: 70 }] };
    const movementTrends = [{ label: "Deadlift", scoreTrend: "insufficient-data", nextCheckRecommendation: null }];
    const preview = buildFormCheckProgressPreview({ formCheckHistory: [{}], formCheckSummary, movementTrends });
    expect(preview.available).toBe(true);
    expect(preview.trendLabel).toMatch(/not enough history/i);
  });
});

describe("buildBlockProgressPreview", () => {
  it("formats block + suggested action with suggest-only copy", () => {
    const plan = { name: "Base Block", currentWeekNumber: 2, blockLengthWeeks: 4 };
    const action = { title: "Progress carefully", risk: "low", action: "progress", rationale: "Readiness supports a small progression." };
    const preview = buildBlockProgressPreview({ plan, action });
    expect(preview.available).toBe(true);
    expect(preview.weekLabel).toBe("Week 2/4");
    expect(preview.blockLabel).toBe("Base Block");
    expect(preview.actionLabel).toBe("Progress carefully");
    expect(preview.riskTone).toBe("good");
    expect(preview.suggestOnlyNote).toMatch(/suggest-only/i);
    expect(preview.suggestOnlyNote).toMatch(/no training program or workout is changed/i);
  });

  it("maps high risk to a warning tone", () => {
    const plan = { name: "Peak", currentWeekNumber: 4, blockLengthWeeks: 4 };
    const action = { title: "Deload now", risk: "high", action: "deload_now", rationale: "Load is high." };
    const preview = buildBlockProgressPreview({ plan, action });
    expect(preview.riskTone).toBe("warning");
  });

  it("is null-safe with no plan (unavailable, suggest-only note still present)", () => {
    const preview = buildBlockProgressPreview({});
    expect(preview.available).toBe(false);
    expect(preview.suggestOnlyNote).toMatch(/suggest-only/i);
    expect(typeof preview.rationale).toBe("string");
  });
});
