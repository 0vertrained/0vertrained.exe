import { describe, it, expect } from "vitest";
import { buildWeeklyCoachReview } from "../weeklyCoachReview";

/**
 * TEST SUITE: buildWeeklyCoachReview
 *
 * Covers:
 * - Missing/old data (low confidence fallback)
 * - Good week generation (wins, actions)
 * - Under-fueled + recovery dip patterns
 * - Decision response counting
 * - Old entries without intelligence (no throw)
 * - Edge cases: empty data, single day, partial week
 */

// Helper to create a day offset from today
function dayKey(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Helper to build a sample day
function sampleDay(overrides = {}) {
  return {
    workout: {
      exercises: {},
      cardio: { miles: "0" },
      notes: "",
      ...overrides.workout,
    },
    nutrition: {
      calories: "3200",
      protein: "200",
      carbs: "350",
      fats: "90",
      water: "128",
      ...overrides.nutrition,
    },
    body: {
      sleep: "7.5",
      weight: "185",
      energy: "8",
      soreness: "3",
      ...overrides.body,
    },
    intelligence: {
      todayDecisionResponse: null,
      ...overrides.intelligence,
    },
    ...overrides,
  };
}

// Helper to create decision response
function decisionResponse(response, call = "maintain") {
  return {
    version: 1,
    decisionCall: call,
    response,
    recordedAt: new Date().toISOString(),
  };
}

describe("buildWeeklyCoachReview", () => {
  // ─────────────────────────────────────────────────────────────────────
  // MISSING DATA & CONFIDENCE
  // ─────────────────────────────────────────────────────────────────────

  it("returns low-confidence result when data is empty", () => {
    const result = buildWeeklyCoachReview({ data: {}, goals: {} });
    expect(result).toBeDefined();
    expect(result.confidence).toBe("low");
    expect(result.version).toBe(1);
  });

  it("returns low confidence when only 1-2 days logged in week", () => {
    const data = {
      [dayKey(0)]: sampleDay(),
      [dayKey(1)]: sampleDay(),
    };
    const result = buildWeeklyCoachReview({ data, goals: {} });
    expect(result.confidence).toBe("low");
  });

  it("returns medium confidence when 3-4 days logged", () => {
    const data = Object.fromEntries(
      [0, 1, 2, 3].map(i => [dayKey(i), sampleDay()])
    );
    const result = buildWeeklyCoachReview({ data, goals: {} });
    expect(result.confidence).toBe("medium");
  });

  it("returns high confidence when 5+ days logged with complete data", () => {
    const data = Object.fromEntries(
      [0, 1, 2, 3, 4].map(i => [dayKey(i), sampleDay()])
    );
    const result = buildWeeklyCoachReview({ data, goals: {} });
    expect(result.confidence).toBe("high");
  });

  // ─────────────────────────────────────────────────────────────────────
  // STRUCTURE & FIELDS
  // ─────────────────────────────────────────────────────────────────────

  it("includes all required fields in response", () => {
    const data = Object.fromEntries(
      [0, 1, 2, 3, 4].map(i => [dayKey(i), sampleDay()])
    );
    const result = buildWeeklyCoachReview({ data, goals: {} });

    expect(result.version).toBe(1);
    expect(result.weekStartKey).toBeDefined();
    expect(result.weekEndKey).toBeDefined();
    expect(result.confidence).toMatch(/low|medium|high/);
    expect(typeof result.score).toBe("number");
    expect(typeof result.headline).toBe("string");
    expect(typeof result.summary).toBe("string");
    expect(Array.isArray(result.wins)).toBe(true);
    expect(Array.isArray(result.watchouts)).toBe(true);
    expect(Array.isArray(result.nextWeekActions)).toBe(true);
    expect(result.decisionStats).toBeDefined();
    expect(Array.isArray(result.fuelRecoveryLinks)).toBe(true);
    expect(Array.isArray(result.trainingSignals)).toBe(true);
  });

  it("calculates week start and end keys correctly", () => {
    const data = Object.fromEntries(
      [6, 5, 4, 3, 2, 1, 0].map(i => [dayKey(i), sampleDay()])
    );
    const result = buildWeeklyCoachReview({ data, goals: {} });
    
    // Week should span from 6 days ago to today
    expect(result.weekStartKey).toBeDefined();
    expect(result.weekEndKey).toBe(dayKey(0));
  });

  // ─────────────────────────────────────────────────────────────────────
  // GOOD WEEK: WINS & ACTIONS
  // ─────────────────────────────────────────────────────────────────────

  it("identifies wins when targets are hit", () => {
    const strongDay = sampleDay({
      workout: { exercises: { Squat: { sets: [] } }, cardio: { miles: "5" } },
      nutrition: { calories: "3400", protein: "220" },
      body: { sleep: "8", energy: "9" },
    });
    const data = Object.fromEntries(
      [0, 1, 2, 3, 4, 5, 6].map(i => [dayKey(i), strongDay])
    );

    const result = buildWeeklyCoachReview({
      data,
      goals: { workouts: 5, miles: 20, protein: 200 },
    });

    expect(result.wins.length).toBeGreaterThan(0);
    expect(result.wins.some(w => w.includes("workout") || w.includes("training"))).toBe(true);
  });

  it("generates constructive next-week actions for strong week", () => {
    const strongDay = sampleDay({
      workout: { exercises: { Squat: {} }, cardio: { miles: "4" } },
      nutrition: { calories: "3400", protein: "220" },
      body: { sleep: "8", energy: "9" },
    });
    const data = Object.fromEntries(
      [0, 1, 2, 3, 4, 5, 6].map(i => [dayKey(i), strongDay])
    );

    const result = buildWeeklyCoachReview({
      data,
      goals: { workouts: 5, miles: 15, protein: 200 },
    });

    expect(result.nextWeekActions.length).toBeGreaterThan(0);
    expect(Array.isArray(result.nextWeekActions)).toBe(true);
    expect(result.nextWeekActions[0]).toMatch(/progression|maintain|consistency|one variable/i);
  });

  // ─────────────────────────────────────────────────────────────────────
  // WATCHOUTS: UNDER-FUELED + RECOVERY DIP
  // ─────────────────────────────────────────────────────────────────────

  it("detects under-fueling and recovery dips", () => {
    const weakDay = sampleDay({
      workout: { exercises: {}, cardio: { miles: "2" } },
      nutrition: { calories: "2400", protein: "120", water: "70" },
      body: { sleep: "5.5", energy: "4", soreness: "7" },
    });
    const data = Object.fromEntries(
      [0, 1, 2, 3, 4].map(i => [dayKey(i), weakDay])
    );

    const result = buildWeeklyCoachReview({ data, goals: { protein: 200 } });

    // Should have watchouts
    expect(result.watchouts.length).toBeGreaterThan(0);
    // Should suggest fuel/recovery actions
    expect(result.fuelRecoveryLinks.length).toBeGreaterThan(0);
  });

  it("includes fuelRecoveryLinks when protein/calories gap detected", () => {
    const lowFuelDay = sampleDay({
      nutrition: { calories: "2600", protein: "140" },
      body: { sleep: "6", energy: "5" },
    });
    const data = Object.fromEntries(
      [0, 1, 2, 3, 4].map(i => [dayKey(i), lowFuelDay])
    );

    const result = buildWeeklyCoachReview({
      data,
      goals: { calories: 3400, protein: 200 },
    });

    expect(result.fuelRecoveryLinks.length).toBeGreaterThan(0);
    expect(
      result.fuelRecoveryLinks.some(link =>
        link.toLowerCase().includes("protein") ||
        link.toLowerCase().includes("fuel") ||
        link.toLowerCase().includes("calorie")
      )
    ).toBe(true);
  });

  it("includes trainingSignals describing volume/load pattern", () => {
    const data = Object.fromEntries(
      [0, 1, 2, 3, 4, 5, 6].map(i =>
        i % 2 === 0
          ? [dayKey(i), sampleDay({
              workout: { exercises: { Squat: {} }, cardio: { miles: "4" } },
            })]
          : [dayKey(i), sampleDay()]
      )
    );

    const result = buildWeeklyCoachReview({ data, goals: {} });
    expect(result.trainingSignals).toBeDefined();
    expect(Array.isArray(result.trainingSignals)).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────
  // DECISION RESPONSE STATS
  // ─────────────────────────────────────────────────────────────────────

  it("counts decision responses correctly", () => {
    const data = Object.fromEntries([
      [dayKey(0), sampleDay({
        intelligence: { todayDecisionResponse: decisionResponse("followed") },
      })],
      [dayKey(1), sampleDay({
        intelligence: { todayDecisionResponse: decisionResponse("modified") },
      })],
      [dayKey(2), sampleDay({
        intelligence: { todayDecisionResponse: decisionResponse("ignored") },
      })],
      [dayKey(3), sampleDay({
        intelligence: { todayDecisionResponse: decisionResponse("skipped") },
      })],
      [dayKey(4), sampleDay()], // No decision response
      [dayKey(5), sampleDay({
        intelligence: { todayDecisionResponse: decisionResponse("followed") },
      })],
    ]);

    const result = buildWeeklyCoachReview({ data, goals: {} });

    expect(result.decisionStats.followed).toBe(2);
    expect(result.decisionStats.modified).toBe(1);
    expect(result.decisionStats.ignored).toBe(1);
    expect(result.decisionStats.skipped).toBe(1);
    expect(result.decisionStats.total).toBe(5);
  });

  it("returns zero counts when no decision responses present", () => {
    const data = Object.fromEntries(
      [0, 1, 2, 3, 4].map(i => [dayKey(i), sampleDay()])
    );

    const result = buildWeeklyCoachReview({ data, goals: {} });
    expect(result.decisionStats.total).toBe(0);
    expect(result.decisionStats.followed).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────────────
  // ROBUSTNESS: OLD DATA WITHOUT INTELLIGENCE
  // ─────────────────────────────────────────────────────────────────────

  it("does not throw on entries without intelligence field", () => {
    const oldDay = {
      workout: { exercises: { Squat: {} }, cardio: { miles: "3" } },
      nutrition: { calories: "3200", protein: "200" },
      body: { sleep: "7.5", weight: "185" },
      // No intelligence field — like old data
    };
    const data = Object.fromEntries(
      [0, 1, 2, 3, 4].map(i => [dayKey(i), oldDay])
    );

    expect(() => {
      buildWeeklyCoachReview({ data, goals: {} });
    }).not.toThrow();
  });

  it("safely handles partial intelligence.todayDecisionResponse", () => {
    const data = Object.fromEntries([
      [dayKey(0), sampleDay({
        intelligence: { todayDecisionResponse: null },
      })],
      [dayKey(1), sampleDay({
        intelligence: { todayDecisionResponse: undefined },
      })],
      [dayKey(2), sampleDay({
        intelligence: {}, // Missing todayDecisionResponse key
      })],
      [dayKey(3), sampleDay()],
    ]);

    const result = buildWeeklyCoachReview({ data, goals: {} });
    expect(result.decisionStats.total).toBe(0);
    expect(() => buildWeeklyCoachReview({ data, goals: {} })).not.toThrow();
  });

  // ─────────────────────────────────────────────────────────────────────
  // SCORE & RECOMMENDATION LOGIC
  // ─────────────────────────────────────────────────────────────────────

  it("generates higher score for week with good consistency", () => {
    const consistentDay = sampleDay({
      workout: { exercises: { Squat: {} }, cardio: { miles: "4" } },
      nutrition: { calories: "3300", protein: "210" },
      body: { sleep: "7.8", energy: "8", soreness: "2" },
    });
    const data = Object.fromEntries(
      [0, 1, 2, 3, 4, 5, 6].map(i => [dayKey(i), consistentDay])
    );

    const result = buildWeeklyCoachReview({
      data,
      goals: { workouts: 5, miles: 15, protein: 200 },
    });

    expect(result.score).toBeGreaterThan(50);
  });

  it("generates lower score for week with gaps", () => {
    const gapDay = sampleDay({
      workout: { exercises: {}, cardio: { miles: "0" } },
      nutrition: { calories: "2200", protein: "100" },
      body: { sleep: "5.5", energy: "3" },
    });
    const data = Object.fromEntries(
      [0, 1, 2, 3, 4].map(i => [dayKey(i), gapDay])
    );

    const result = buildWeeklyCoachReview({
      data,
      goals: { workouts: 5, miles: 15, protein: 200 },
    });

    expect(result.score).toBeLessThan(60);
  });

  it("headline reflects week quality", () => {
    const strongDay = sampleDay({
      workout: { exercises: { Squat: {} }, cardio: { miles: "4" } },
      nutrition: { calories: "3400", protein: "220" },
      body: { sleep: "8", energy: "9" },
    });
    const strongData = Object.fromEntries(
      [0, 1, 2, 3, 4, 5, 6].map(i => [dayKey(i), strongDay])
    );

    const weakDay = sampleDay({
      nutrition: { calories: "2200", protein: "100" },
      body: { sleep: "5.5" },
    });
    const weakData = Object.fromEntries(
      [0, 1, 2, 3, 4].map(i => [dayKey(i), weakDay])
    );

    const strongResult = buildWeeklyCoachReview({
      data: strongData,
      goals: { workouts: 5, miles: 15, protein: 200 },
    });

    const weakResult = buildWeeklyCoachReview({
      data: weakData,
      goals: { workouts: 5, miles: 15, protein: 200 },
    });

    // Headlines should differ in tone
    expect(strongResult.headline).toBeDefined();
    expect(weakResult.headline).toBeDefined();
    expect(strongResult.headline).not.toBe(weakResult.headline);
  });

  // ─────────────────────────────────────────────────────────────────────
  // EDGE CASES
  // ─────────────────────────────────────────────────────────────────────

  it("handles single-day week gracefully", () => {
    const data = { [dayKey(0)]: sampleDay() };
    const result = buildWeeklyCoachReview({ data, goals: {} });

    expect(result).toBeDefined();
    expect(result.confidence).toBe("low");
  });

  it("handles week with mixed missing data fields", () => {
    const partialDay1 = sampleDay({
      nutrition: { calories: "0", protein: "0" }, // Missing nutrition
    });
    const partialDay2 = sampleDay({
      body: { sleep: "0", energy: "0" }, // Missing recovery
    });
    const data = {
      [dayKey(0)]: partialDay1,
      [dayKey(1)]: partialDay2,
      [dayKey(2)]: sampleDay(),
    };

    expect(() => {
      buildWeeklyCoachReview({ data, goals: {} });
    }).not.toThrow();
  });

  it("summary is a coherent sentence", () => {
    const data = Object.fromEntries(
      [0, 1, 2, 3, 4].map(i => [dayKey(i), sampleDay()])
    );
    const result = buildWeeklyCoachReview({ data, goals: {} });

    expect(result.summary).toBeDefined();
    expect(typeof result.summary).toBe("string");
    expect(result.summary.length).toBeGreaterThan(10);
  });

  it("does not include medical claims or causation language", () => {
    const data = Object.fromEntries(
      [0, 1, 2, 3, 4].map(i => [dayKey(i), sampleDay()])
    );
    const result = buildWeeklyCoachReview({ data, goals: {} });

    const text = [
      result.headline,
      result.summary,
      ...result.wins,
      ...result.watchouts,
      ...result.nextWeekActions,
      ...result.fuelRecoveryLinks,
    ].join(" ");

    // Should use cautious language
    expect(text).not.toMatch(/will cause|guarantees|must|definitely/i);
    // Should avoid medical claims
    expect(text).not.toMatch(/heal|cure|disease|syndrome|disorder/i);
  });
});
