import { describe, expect, it } from "vitest";
import { buildDecisionContext, getDailyRecommendation, computeReadinessIndex } from "../decisionEngine";

function rec({ recovery, ratio, zone = "optimal" }) {
  const ctx = buildDecisionContext({
    recovery: { score: recovery },
    trainingLoad: { ratio, zone },
    todayProgram: { type: "Strength", lifting: [{ name: "Squat" }] },
  });
  return getDailyRecommendation(ctx);
}

describe("decisionEngine", () => {
  it("returns rest for low recovery plus elevated ACWR", () => {
    const out = rec({ recovery: 42, ratio: 1.36, zone: "overreaching" });
    expect(out.readiness).toBe("rest");
    expect(out.warnings.length).toBeGreaterThan(0);
  });

  it("returns push for high recovery and stable load", () => {
    const out = rec({ recovery: 84, ratio: 1.05 });
    expect(out.readiness).toBe("push");
    expect(out.confidence).toBe("high");
  });

  it("handles missing recovery without throwing", () => {
    const ctx = buildDecisionContext({ trainingLoad: { ratio: 1.1, zone: "optimal" }, todayProgram: { type: "Run" } });
    const out = getDailyRecommendation(ctx);
    expect(out.readiness).toBe("normal");
    expect(out.missingData).toContain("recovery");
  });

  it("handles empty input safely", () => {
    const out = getDailyRecommendation(buildDecisionContext({}));
    expect(out.title).toBeTruthy();
    expect(out.confidence).toBe("low");
    expect(JSON.stringify(out)).not.toMatch(/NaN/);
  });
});

describe("readiness index (continuous)", () => {
  it("scales with recovery and is discounted by high load", () => {
    expect(computeReadinessIndex(85, { ratio: 1.0 }).index).toBe(100);
    expect(computeReadinessIndex(35, { ratio: 1.0 }).index).toBe(0);
    // Same strong recovery, but ACWR at the high knee discounts readiness.
    expect(computeReadinessIndex(85, { ratio: 1.6 }).index).toBe(40);
    expect(computeReadinessIndex(85, { ratio: 1.6 }).index)
      .toBeLessThan(computeReadinessIndex(85, { ratio: 1.0 }).index);
  });

  it("returns null with no recovery signal", () => {
    expect(computeReadinessIndex(null, { ratio: 1.0 })).toBeNull();
  });

  it("exposes the index on the recommendation", () => {
    const out = getDailyRecommendation(buildDecisionContext({
      recovery: { score: 84 }, trainingLoad: { ratio: 1.05, zone: "optimal" }, todayProgram: { type: "Run" },
    }));
    expect(typeof out.readinessIndex).toBe("number");
    expect(out.readinessIndex).toBeGreaterThan(80);
  });
});

describe("hysteresis", () => {
  it("holds the previous band when the index sits just inside a boundary", () => {
    const base = { recovery: { score: 65 }, trainingLoad: { ratio: 1.0, zone: "optimal" }, todayProgram: { type: "Run" } };
    // index ~60 -> raw band is "moderate"
    const fresh = getDailyRecommendation(buildDecisionContext(base));
    expect(fresh.readiness).toBe("moderate");
    // ...but coming from "normal", the deadband keeps it at normal (no flicker).
    const sticky = getDailyRecommendation(buildDecisionContext({ ...base, previousReadiness: "normal" }));
    expect(sticky.readiness).toBe("normal");
  });
});

describe("personalization", () => {
  const base = { recovery: { score: 60 }, trainingLoad: { ratio: 1.0, zone: "optimal" }, todayProgram: { type: "Run" } };

  it("is more conservative when recovery is low for the athlete's own baseline", () => {
    const generic = getDailyRecommendation(buildDecisionContext(base));
    expect(generic.readiness).toBe("moderate");
    // 60 is ~1.9 SD below a personal mean of 75 -> pull back, and flag it.
    const personalized = getDailyRecommendation(buildDecisionContext({ ...base, personal: { mean: 75, sd: 8, n: 20 } }));
    expect(personalized.readiness).toBe("pull_back");
    expect(personalized.recoveryZ).toBeLessThan(-1);
    expect(personalized.reasons.some(r => r.label === "Low for your baseline")).toBe(true);
  });

  it("ignores a baseline that is too thin to trust", () => {
    const out = getDailyRecommendation(buildDecisionContext({ ...base, personal: { mean: 75, sd: 8, n: 5 } }));
    expect(out.readiness).toBe("moderate"); // n < minDays -> no nudge
  });
});
