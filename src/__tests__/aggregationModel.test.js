// src/__tests__/aggregationModel.test.js
// V3.6 Full Aggregation Model — tests the enrichment layer that sits between
// the wearable source resolver + conservative blending and the decision engine.

import { describe, it, expect } from "vitest";
import {
  buildAggregatedRecoveryContext,
  buildAggregatedCoachSummary,
  buildConfidenceExplanation,
} from "../recovery/aggregationModel";

const DATE = "2026-07-01";

function ouraDay(overrides = {}) {
  const {
    sleepDuration = 27000, sleepScore = 82, hrv = 60, rhr = 50,
    tempDeviation = 0.1, readinessScore = 80, respiratoryRate = 14.5,
    activityScore = 70, spo2 = 97,
  } = overrides;
  return {
    [DATE]: {
      sleep: [{ total_sleep_duration: sleepDuration, score: sleepScore, hrv: { rmssd: hrv }, lowest_heart_rate: rhr, temperature: { deviation: tempDeviation }, respiratory_rate: respiratoryRate }],
      readiness: [{ score: readinessScore, respiratory_rate: respiratoryRate }],
      activity: [{ score: activityScore }],
      spo2: [{ average: spo2 }],
    },
  };
}

function whoopDay(overrides = {}) {
  const {
    recoveryScore = 72, hrvMilli = 55, rhr = 52, spo2 = 96, skinTemp = 33.2,
    inBedMin = 480, awakeMin = 30, performancePct = 85, respiratoryRate = 16,
    strain = 12.5, workoutStrain = 8,
  } = overrides;
  return {
    [DATE]: {
      recovery: { score: { recovery_score: recoveryScore, hrv_rmssd_milli: hrvMilli, resting_heart_rate: rhr, spo2_percentage: spo2, skin_temp_celsius: skinTemp } },
      sleep: { score: { stage_summary: { total_in_bed_time_milli: inBedMin * 60000, total_awake_time_milli: awakeMin * 60000 }, sleep_performance_percentage: performancePct, respiratory_rate: respiratoryRate } },
      cycle: { score: { strain } },
      workout: [{ id: 1, sport_id: 1, score: { strain: workoutStrain } }],
    },
  };
}

const manualBody = { sleep: 7, sleepQuality: 8, energy: 6, soreness: 3, stress: 4, motivation: 7, restingHeartRate: 54, hrv: 48 };
const recovery = { score: 80, source: "oura", band: "good" };
const recommendation = { label: "Push", readiness: "push", confidence: "high", modifiers: [] };

// ── Core invariant: recovery score is never modified ─────────────────────────

describe("recovery score invariants", () => {
  it("echoes the canonical recovery score verbatim", () => {
    const agg = buildAggregatedRecoveryContext({ ouraData: ouraDay(), whoopData: whoopDay(), manualData: manualBody, recovery, recommendation });
    expect(agg.recoveryScore).toBe(80);
    expect(agg.recoveryScoreUnchanged).toBe(true);
  });

  it("does not average Oura and Whoop recovery scores", () => {
    // Oura 80, Whoop 60 → average would be 70. Must stay 80.
    const agg = buildAggregatedRecoveryContext({
      ouraData: ouraDay({ readinessScore: 80 }),
      whoopData: whoopDay({ recoveryScore: 60 }),
      manualData: manualBody, recovery, recommendation,
    });
    expect(agg.recoveryScore).toBe(80);
    expect(agg.recoveryScore).not.toBe(70);
  });

  it("whoop recovery is context only, never in the score", () => {
    const agg = buildAggregatedRecoveryContext({ ouraData: ouraDay(), whoopData: whoopDay(), manualData: manualBody, recovery, recommendation });
    expect(agg.whoopRecoveryContext).not.toBeNull();
    expect(agg.whoopRecoveryContext.score).toBe(72);
    // The recovery score is still the Oura-based canonical score
    expect(agg.recoveryScore).toBe(80);
  });
});

// ── Whoop strain supplements but never pushes harder ─────────────────────────

describe("Whoop strain context", () => {
  it("classifies normal strain", () => {
    const agg = buildAggregatedRecoveryContext({ ouraData: ouraDay(), whoopData: whoopDay({ strain: 10 }), manualData: manualBody, recovery, recommendation });
    expect(agg.whoopStrainContext.level).toBe("normal");
  });

  it("classifies elevated strain", () => {
    const agg = buildAggregatedRecoveryContext({ ouraData: ouraDay(), whoopData: whoopDay({ strain: 15 }), manualData: manualBody, recovery, recommendation });
    expect(agg.whoopStrainContext.level).toBe("elevated");
  });

  it("classifies high strain and notes it is not a reason to train harder", () => {
    const agg = buildAggregatedRecoveryContext({ ouraData: ouraDay(), whoopData: whoopDay({ strain: 19 }), manualData: manualBody, recovery, recommendation });
    expect(agg.whoopStrainContext.level).toBe("high");
    expect(agg.whoopStrainContext.note).toMatch(/not a reason to train harder/i);
  });

  it("strain supplement type is load_context, never scoring", () => {
    const agg = buildAggregatedRecoveryContext({ ouraData: ouraDay(), whoopData: whoopDay(), manualData: manualBody, recovery, recommendation });
    expect(agg.whoopStrainContext.supplementType).toBe("load_context");
  });
});

// ── Confidence aggregation ───────────────────────────────────────────────────

describe("aggregated confidence", () => {
  it("stays high when everything agrees and no fallbacks", () => {
    const agg = buildAggregatedRecoveryContext({ ouraData: ouraDay(), whoopData: whoopDay(), manualData: manualBody, recovery, recommendation });
    expect(agg.aggregatedConfidence).toBe("high");
  });

  it("downgrades on a minor conflict (one step)", () => {
    // RHR 48 vs 54 → 6 bpm = minor conflict
    const agg = buildAggregatedRecoveryContext({
      ouraData: ouraDay({ rhr: 48 }),
      whoopData: whoopDay({ rhr: 54 }),
      manualData: manualBody, recovery, recommendation,
    });
    expect(agg.aggregatedConfidence).toBe("medium");
    expect(agg.confidenceReasons.some((r) => /disagreement/i.test(r))).toBe(true);
  });

  it("downgrades two steps on a major conflict", () => {
    // Recovery 90 vs 45 → 45 pt gap = major conflict
    const agg = buildAggregatedRecoveryContext({
      ouraData: ouraDay({ readinessScore: 90 }),
      whoopData: whoopDay({ recoveryScore: 45 }),
      manualData: manualBody, recovery, recommendation,
    });
    expect(agg.aggregatedConfidence).toBe("low");
  });

  it("downgrades when Whoop fallback is used for missing Oura metric", () => {
    const oura = ouraDay();
    delete oura[DATE].sleep[0].hrv; // remove Oura HRV → Whoop fallback
    const agg = buildAggregatedRecoveryContext({ ouraData: oura, whoopData: whoopDay(), manualData: manualBody, recovery, recommendation });
    expect(agg.aggregatedConfidence).not.toBe("high");
    expect(agg.confidenceReasons.some((r) => /fallback/i.test(r))).toBe(true);
  });

  it("downgrades when core metrics are missing", () => {
    // Oura with no sleep doc → sleep metric missing
    const oura = { [DATE]: { readiness: [{ score: 80 }], activity: [{ score: 70 }] } };
    const agg = buildAggregatedRecoveryContext({ ouraData: oura, whoopData: whoopDay(), manualData: manualBody, recovery, recommendation });
    expect(agg.aggregatedConfidence).not.toBe("high");
  });

  it("forces low confidence when no recovery score exists", () => {
    const agg = buildAggregatedRecoveryContext({ ouraData: ouraDay(), whoopData: whoopDay(), manualData: manualBody, recovery: { score: null, source: "oura" }, recommendation });
    expect(agg.aggregatedConfidence).toBe("low");
  });

  it("confidence only ever goes down, never up", () => {
    // Start with a low-confidence recommendation → should stay low, not be raised
    const lowRec = { ...recommendation, confidence: "low" };
    const agg = buildAggregatedRecoveryContext({ ouraData: ouraDay(), whoopData: whoopDay(), manualData: manualBody, recovery, recommendation: lowRec });
    expect(agg.aggregatedConfidence).toBe("low");
  });
});

// ── Manual subjective is always first-class ──────────────────────────────────

describe("manual first-class invariant", () => {
  it("subjective metric resolves to manual source", () => {
    const agg = buildAggregatedRecoveryContext({ ouraData: ouraDay(), whoopData: whoopDay(), manualData: manualBody, recovery, recommendation });
    expect(agg.metrics.subjective.source).toBe("manual");
    expect(agg.metrics.subjective.fallbackUsed).toBe(false);
  });

  it("manual is first-class even with both wearables present", () => {
    const agg = buildAggregatedRecoveryContext({ ouraData: ouraDay(), whoopData: whoopDay(), manualData: manualBody, recovery, recommendation });
    expect(agg.sourceMap.subjective).toBe("manual");
  });
});

// ── Oura-only path ────────────────────────────────────────────────────────────

describe("Oura-only path", () => {
  it("returns null when Whoop is not connected", () => {
    const agg = buildAggregatedRecoveryContext({ ouraData: ouraDay(), whoopData: {}, manualData: manualBody, recovery, recommendation });
    expect(agg).toBeNull();
  });

  it("returns null when Whoop data is null", () => {
    const agg = buildAggregatedRecoveryContext({ ouraData: ouraDay(), whoopData: null, manualData: manualBody, recovery, recommendation });
    expect(agg).toBeNull();
  });
});

// ── Source map ────────────────────────────────────────────────────────────────

describe("source map", () => {
  it("has correct sources for all metrics", () => {
    const agg = buildAggregatedRecoveryContext({ ouraData: ouraDay(), whoopData: whoopDay(), manualData: manualBody, recovery, recommendation });
    expect(agg.sourceMap.hrv).toBe("oura");
    expect(agg.sourceMap.rhr).toBe("oura");
    expect(agg.sourceMap.sleep).toBe("oura");
    expect(agg.sourceMap.temp).toBe("oura");
    expect(agg.sourceMap.strain).toBe("whoop");
    expect(agg.sourceMap.respiratoryRate).toBe("whoop");
    expect(agg.sourceMap.spo2).toBe("whoop");
    expect(agg.sourceMap.subjective).toBe("manual");
  });

  it("source note is a readable disclosure string", () => {
    const agg = buildAggregatedRecoveryContext({ ouraData: ouraDay(), whoopData: whoopDay(), manualData: manualBody, recovery, recommendation });
    expect(agg.sourceNote).toMatch(/Oura/);
    expect(agg.sourceNote).toMatch(/Whoop/);
    expect(agg.sourceNote).toMatch(/feel/i);
  });
});

// ── Whoop recovery context (display only) ─────────────────────────────────────

describe("whoop recovery context", () => {
  it("computes delta from Oura readiness", () => {
    const agg = buildAggregatedRecoveryContext({
      ouraData: ouraDay({ readinessScore: 80 }),
      whoopData: whoopDay({ recoveryScore: 60 }),
      manualData: manualBody, recovery, recommendation,
    });
    expect(agg.whoopRecoveryContext.score).toBe(60);
    expect(agg.whoopRecoveryContext.deltaFromOura).toBe(-20);
    expect(agg.whoopRecoveryContext.severity).toBe("moderate");
  });

  it("severity is small when scores align", () => {
    const agg = buildAggregatedRecoveryContext({
      ouraData: ouraDay({ readinessScore: 72 }),
      whoopData: whoopDay({ recoveryScore: 70 }),
      manualData: manualBody, recovery, recommendation,
    });
    expect(agg.whoopRecoveryContext.severity).toBe("small");
  });

  it("severity is large for big gaps", () => {
    const agg = buildAggregatedRecoveryContext({
      ouraData: ouraDay({ readinessScore: 90 }),
      whoopData: whoopDay({ recoveryScore: 40 }),
      manualData: manualBody, recovery, recommendation,
    });
    expect(agg.whoopRecoveryContext.severity).toBe("large");
  });

  it("note says scores are never averaged", () => {
    const agg = buildAggregatedRecoveryContext({ ouraData: ouraDay(), whoopData: whoopDay(), manualData: manualBody, recovery, recommendation });
    expect(agg.whoopRecoveryContext.note).toMatch(/never averaged/i);
  });
});

// ── Null safety ───────────────────────────────────────────────────────────────

describe("null safety", () => {
  it("does not throw on empty inputs", () => {
    expect(() => buildAggregatedRecoveryContext()).not.toThrow();
    expect(() => buildAggregatedRecoveryContext({})).not.toThrow();
  });

  it("returns null when no wearable data at all", () => {
    expect(buildAggregatedRecoveryContext({})).toBeNull();
    expect(buildAggregatedRecoveryContext({ ouraData: {}, whoopData: {} })).toBeNull();
  });
});

// ── Coach summary ─────────────────────────────────────────────────────────────

describe("buildAggregatedCoachSummary", () => {
  it("includes base context + strain + sources", () => {
    const agg = buildAggregatedRecoveryContext({ ouraData: ouraDay(), whoopData: whoopDay({ strain: 19 }), manualData: manualBody, recovery, recommendation });
    const summary = buildAggregatedCoachSummary(agg, "Recovery: 80/100 (good). HRV at baseline.");
    expect(summary).toContain("Recovery: 80/100");
    expect(summary).toMatch(/strain/i);
    expect(summary).toMatch(/Sources:/);
  });

  it("includes conflict flag when conflicts exist", () => {
    const agg = buildAggregatedRecoveryContext({
      ouraData: ouraDay({ readinessScore: 90 }),
      whoopData: whoopDay({ recoveryScore: 40 }),
      manualData: manualBody, recovery, recommendation,
    });
    const summary = buildAggregatedCoachSummary(agg, "Base context.");
    expect(summary).toMatch(/mixed signal/i);
  });

  it("is capped at ~300 chars", () => {
    const agg = buildAggregatedRecoveryContext({ ouraData: ouraDay(), whoopData: whoopDay(), manualData: manualBody, recovery, recommendation });
    const longBase = "A".repeat(400);
    const summary = buildAggregatedCoachSummary(agg, longBase);
    expect(summary.length).toBeLessThanOrEqual(301);
  });

  it("returns base context when agg is null", () => {
    expect(buildAggregatedCoachSummary(null, "base")).toBe("base");
    expect(buildAggregatedCoachSummary(null, null)).toBeNull();
  });
});

// ── Confidence explanation ────────────────────────────────────────────────────

describe("buildConfidenceExplanation", () => {
  it("returns good tone for high confidence", () => {
    const agg = buildAggregatedRecoveryContext({ ouraData: ouraDay(), whoopData: whoopDay(), manualData: manualBody, recovery, recommendation });
    const exp = buildConfidenceExplanation(agg);
    expect(exp.tone).toBe("good");
    expect(exp.label).toBe("high confidence");
  });

  it("returns warning tone for low confidence", () => {
    const agg = buildAggregatedRecoveryContext({
      ouraData: ouraDay({ readinessScore: 90 }),
      whoopData: whoopDay({ recoveryScore: 40 }),
      manualData: manualBody, recovery, recommendation,
    });
    const exp = buildConfidenceExplanation(agg);
    expect(exp.tone).toBe("warning");
    expect(exp.reasons.length).toBeGreaterThan(0);
  });

  it("returns empty for null context", () => {
    const exp = buildConfidenceExplanation(null);
    expect(exp.label).toBeNull();
    expect(exp.reasons).toEqual([]);
  });
});

// ── Purity ────────────────────────────────────────────────────────────────────

describe("purity", () => {
  it("does not mutate the input recommendation", () => {
    const input = { label: "Push", readiness: "push", confidence: "high", modifiers: [] };
    const snapshot = JSON.stringify(input);
    buildAggregatedRecoveryContext({ ouraData: ouraDay(), whoopData: whoopDay(), manualData: manualBody, recovery, recommendation: input });
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("does not mutate the input recovery object", () => {
    const rec = { score: 80, source: "oura", band: "good" };
    const snapshot = JSON.stringify(rec);
    buildAggregatedRecoveryContext({ ouraData: ouraDay(), whoopData: whoopDay(), manualData: manualBody, recovery: rec, recommendation });
    expect(JSON.stringify(rec)).toBe(snapshot);
  });
});