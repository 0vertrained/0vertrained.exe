// src/__tests__/conservativeBlending.test.js
// V3.2 Conservative Blending — Whoop supplements the decision context without
// changing/averaging the recovery score. Confidence downgrades on conflict/
// fallback; conservative bias never makes training harder; manual stays first-class.

import { describe, it, expect } from "vitest";
import {
  buildConservativeBlendContext,
  applyWearableConfidenceAdjustment,
  buildBlendExplanation,
} from "../recovery/conservativeBlending";
import { resolveRecoveryContext } from "../recovery/wearableSourceResolver";

const DATE = "2026-07-01";

function ouraDay(overrides = {}) {
  const {
    sleepDuration = 27000,
    sleepScore = 82,
    hrv = 60,
    rhr = 50,
    tempDeviation = 0.1,
    readinessScore = 80,
    respiratoryRate = 14.5,
    activityScore = 70,
    spo2 = 97,
  } = overrides;
  return {
    [DATE]: {
      sleep: [{
        total_sleep_duration: sleepDuration,
        score: sleepScore,
        hrv: { rmssd: hrv },
        lowest_heart_rate: rhr,
        temperature: { deviation: tempDeviation },
        respiratory_rate: respiratoryRate,
      }],
      readiness: [{ score: readinessScore, respiratory_rate: respiratoryRate }],
      activity: [{ score: activityScore }],
      spo2: [{ average: spo2 }],
    },
  };
}

function whoopDay(overrides = {}) {
  const {
    recoveryScore = 72,
    hrvMilli = 55,
    rhr = 52,
    spo2 = 96,
    skinTemp = 33.2,
    inBedMin = 480,
    awakeMin = 30,
    performancePct = 85,
    respiratoryRate = 16,
    strain = 12.5,
    workoutStrain = 8,
  } = overrides;
  return {
    [DATE]: {
      recovery: {
        score: {
          recovery_score: recoveryScore,
          hrv_rmssd_milli: hrvMilli,
          resting_heart_rate: rhr,
          spo2_percentage: spo2,
          skin_temp_celsius: skinTemp,
        },
      },
      sleep: {
        score: {
          stage_summary: {
            total_in_bed_time_milli: inBedMin * 60000,
            total_awake_time_milli: awakeMin * 60000,
          },
          sleep_performance_percentage: performancePct,
          respiratory_rate: respiratoryRate,
        },
      },
      cycle: { score: { strain } },
      workout: [{ id: 1, sport_id: 1, score: { strain: workoutStrain } }],
    },
  };
}

const manualBody = { sleep: 7, sleepQuality: 8, energy: 6, soreness: 3, stress: 4, motivation: 7, restingHeartRate: 54, hrv: 48 };

function ctxWith({ oura = ouraDay(), whoop = whoopDay(), manual = manualBody } = {}) {
  return resolveRecoveryContext({ ouraData: oura, whoopData: whoop, manualData: manual, date: DATE });
}

const recovery = { score: 80, source: "oura", band: "good" };
const recommendation = { label: "Push", readiness: "push", confidence: "high", modifiers: [] };

// ── Core invariant: recovery score is never changed / averaged ────────────────

describe("conservative blend never alters the recovery score", () => {
  it("echoes the recovery score verbatim and flags it unchanged", () => {
    const ctx = ctxWith();
    const blend = buildConservativeBlendContext({ resolvedContext: ctx, recovery });
    expect(blend.recoveryScore).toBe(80);
    expect(blend.recoveryScoreUnchanged).toBe(true);
  });

  it("does not average Oura and Whoop recovery even when they differ", () => {
    // Oura readiness 80 vs Whoop recovery 60 → an average would be 70.
    const ctx = ctxWith({ whoop: whoopDay({ recoveryScore: 60 }) });
    const blend = buildConservativeBlendContext({ resolvedContext: ctx, recovery: { score: 80, source: "oura" } });
    expect(blend.recoveryScore).toBe(80);
    expect(blend.recoveryScore).not.toBe(70);
  });

  it("applyWearableConfidenceAdjustment never writes a score field", () => {
    const ctx = ctxWith({ oura: ouraDay({ readinessScore: 90 }), whoop: whoopDay({ recoveryScore: 45 }) });
    const out = applyWearableConfidenceAdjustment({ recommendation, resolvedContext: ctx });
    expect(out).not.toHaveProperty("score");
    expect(out).not.toHaveProperty("recoveryScore");
  });
});

// ── Whoop strain supplements but never pushes harder ──────────────────────────

describe("Whoop strain supplements load context but never pushes harder", () => {
  it("surfaces strain as a Whoop-sourced supplemental signal", () => {
    const blend = buildConservativeBlendContext({ resolvedContext: ctxWith({ whoop: whoopDay({ strain: 12 }) }), recovery });
    expect(blend.strainSignal.present).toBe(true);
    expect(blend.strainSignal.source).toBe("whoop");
    expect(blend.strainSignal.level).toBe("normal");
  });

  it("high strain biases conservative and never raises readiness", () => {
    const ctx = ctxWith({ whoop: whoopDay({ strain: 19 }) });
    const blend = buildConservativeBlendContext({ resolvedContext: ctx, recovery });
    expect(blend.strainSignal.level).toBe("high");
    expect(blend.biasConservative).toBe(true);
    const out = applyWearableConfidenceAdjustment({ recommendation, resolvedContext: ctx, blendContext: blend });
    // push must be capped back toward caution, never left as push
    expect(out.readiness).toBe("moderate");
    expect(out.wearableAdjustment.biasedConservative).toBe(true);
  });

  it("high strain copy explicitly says it is not a reason to train harder", () => {
    const blend = buildConservativeBlendContext({ resolvedContext: ctxWith({ whoop: whoopDay({ strain: 20 }) }), recovery });
    expect(blend.strainSignal.note).toMatch(/not a reason to train harder/i);
  });
});

// ── Conflicts downgrade confidence ────────────────────────────────────────────

describe("conflicts downgrade confidence", () => {
  it("a minor conflict lowers confidence one step", () => {
    // rhr 48 vs 54 → 6 bpm = minor (>=5, <10)
    const ctx = ctxWith({ oura: ouraDay({ rhr: 48 }), whoop: whoopDay({ rhr: 54 }) });
    const blend = buildConservativeBlendContext({ resolvedContext: ctx, recovery });
    expect(blend.confidenceAdjustment.direction).toBe("down");
    expect(blend.confidenceAdjustment.steps).toBe(1);
    const out = applyWearableConfidenceAdjustment({ recommendation, resolvedContext: ctx, blendContext: blend });
    expect(out.confidence).toBe("medium"); // high → medium
  });

  it("a major conflict lowers confidence two steps", () => {
    const ctx = ctxWith({ oura: ouraDay({ readinessScore: 90 }), whoop: whoopDay({ recoveryScore: 45 }) });
    const blend = buildConservativeBlendContext({ resolvedContext: ctx, recovery });
    expect(blend.conflictSeverity).toBe("major");
    expect(blend.confidenceAdjustment.steps).toBe(2);
    const out = applyWearableConfidenceAdjustment({ recommendation, resolvedContext: ctx, blendContext: blend });
    expect(out.confidence).toBe("low"); // high → low
  });

  it("confidence adjustment is one-directional (never raised)", () => {
    const ctx = ctxWith({ oura: ouraDay({ readinessScore: 90 }), whoop: whoopDay({ recoveryScore: 45 }) });
    const lowRec = { ...recommendation, confidence: "low" };
    const out = applyWearableConfidenceAdjustment({ recommendation: lowRec, resolvedContext: ctx });
    expect(out.confidence).toBe("low"); // stays low, never bumped up
  });
});

// ── Major conflict returns conservative copy + biases the call conservative ───

describe("major conflict → conservative", () => {
  it("returns conservative user-facing copy", () => {
    const ctx = ctxWith({ oura: ouraDay({ readinessScore: 92 }), whoop: whoopDay({ recoveryScore: 40 }) });
    const blend = buildConservativeBlendContext({ resolvedContext: ctx, recovery });
    expect(blend.conservativeCopy).toMatch(/mixed signal/i);
    expect(blend.conservativeCopy).toMatch(/unchanged/i);
    expect(blend.biasConservative).toBe(true);
  });

  it("caps a push recommendation to moderate, never harder", () => {
    const ctx = ctxWith({ oura: ouraDay({ readinessScore: 92 }), whoop: whoopDay({ recoveryScore: 40 }) });
    const out = applyWearableConfidenceAdjustment({ recommendation, resolvedContext: ctx });
    expect(out.readiness).toBe("moderate");
  });

  it("never raises a rest recommendation upward", () => {
    const ctx = ctxWith({ oura: ouraDay({ readinessScore: 92 }), whoop: whoopDay({ recoveryScore: 40 }) });
    const restRec = { ...recommendation, readiness: "rest", label: "Rest / Recovery" };
    const out = applyWearableConfidenceAdjustment({ recommendation: restRec, resolvedContext: ctx });
    expect(out.readiness).toBe("rest");
  });
});

// ── Fallback source usage is surfaced ─────────────────────────────────────────

describe("fallback source usage is surfaced", () => {
  it("marks Whoop HRV fallback when Oura HRV is missing", () => {
    // Oura present for other metrics but HRV missing → Whoop HRV fallback used.
    const oura = ouraDay();
    delete oura[DATE].sleep[0].hrv; // remove Oura HRV
    const ctx = ctxWith({ oura });
    const blend = buildConservativeBlendContext({ resolvedContext: ctx, recovery });
    const hrvFallback = blend.fallbacks.find((f) => f.metric === "hrv");
    expect(hrvFallback).toBeTruthy();
    expect(hrvFallback.source).toBe("whoop");
    expect(blend.confidenceAdjustment.direction).toBe("down");
  });

  it("conservative copy mentions the fallback when there is no conflict", () => {
    const oura = ouraDay();
    delete oura[DATE].sleep[0].hrv;
    const ctx = ctxWith({ oura });
    const blend = buildConservativeBlendContext({ resolvedContext: ctx, recovery });
    // no conflict expected here, so the fallback drives the copy
    if (!blend.conflicts.length && blend.strainSignal.level !== "high") {
      expect(blend.conservativeCopy).toMatch(/fallback/i);
    }
  });
});

// ── Manual subjective remains first-class ─────────────────────────────────────

describe("manual subjective remains first-class", () => {
  it("flags manual as first-class when a check-in is present", () => {
    const blend = buildConservativeBlendContext({ resolvedContext: ctxWith(), recovery });
    expect(blend.manualFirstClass).toBe(true);
    expect(blend.notes.some((n) => /first-class/i.test(n))).toBe(true);
  });

  it("does not claim manual first-class when no check-in exists", () => {
    const blend = buildConservativeBlendContext({ resolvedContext: ctxWith({ manual: null }), recovery });
    expect(blend.manualFirstClass).toBe(false);
  });
});

// ── Source labels for HRV / RHR / sleep / strain ──────────────────────────────

describe("source labels are included for HRV/RHR/sleep/strain", () => {
  it("labels each supplemental metric with its winning source", () => {
    const blend = buildConservativeBlendContext({ resolvedContext: ctxWith(), recovery });
    expect(blend.sourceLabels.hrv.source).toBe("oura");
    expect(blend.sourceLabels.rhr.source).toBe("oura");
    expect(blend.sourceLabels.sleep.source).toBe("oura");
    expect(blend.sourceLabels.strain.source).toBe("whoop");
    expect(blend.sourceLabels.strain.label).toBe("Whoop");
  });

  it("buildBlendExplanation renders a compact per-metric source line", () => {
    const blend = buildConservativeBlendContext({ resolvedContext: ctxWith(), recovery });
    const exp = buildBlendExplanation(blend);
    expect(exp.available).toBe(true);
    expect(exp.sourceLine).toMatch(/HRV Oura/);
    expect(exp.sourceLine).toMatch(/Strain Whoop/);
    expect(exp.disclaimer).toMatch(/never averaged/i);
  });
});

// ── Oura-only path is unchanged / null-safe ───────────────────────────────────

describe("Oura-only path is unchanged and null-safe", () => {
  it("blend is not applicable when only Oura is connected", () => {
    const ctx = resolveRecoveryContext({ ouraData: ouraDay(), manualData: manualBody, date: DATE });
    const blend = buildConservativeBlendContext({ resolvedContext: ctx, recovery });
    expect(blend.applicable).toBe(false);
    expect(blend.conservativeCopy).toBeNull();
  });

  it("recommendation is returned unchanged on the Oura-only path", () => {
    const ctx = resolveRecoveryContext({ ouraData: ouraDay(), manualData: manualBody, date: DATE });
    const out = applyWearableConfidenceAdjustment({ recommendation, resolvedContext: ctx });
    expect(out.readiness).toBe("push");
    expect(out.confidence).toBe("high");
  });

  it("no function throws on empty / undefined inputs", () => {
    expect(() => buildConservativeBlendContext()).not.toThrow();
    expect(() => buildConservativeBlendContext({})).not.toThrow();
    expect(() => applyWearableConfidenceAdjustment()).not.toThrow();
    expect(() => applyWearableConfidenceAdjustment({})).not.toThrow();
    expect(() => buildBlendExplanation(null)).not.toThrow();
    expect(() => buildBlendExplanation(undefined)).not.toThrow();
  });

  it("applyWearableConfidenceAdjustment returns null for a null recommendation", () => {
    expect(applyWearableConfidenceAdjustment({ recommendation: null })).toBeNull();
  });

  it("buildBlendExplanation reports unavailable when the blend does not apply", () => {
    const exp = buildBlendExplanation({ applicable: false });
    expect(exp.available).toBe(false);
    expect(exp.disclaimer).toMatch(/unchanged/i);
  });
});

// ── Purity: inputs are never mutated ──────────────────────────────────────────

describe("purity", () => {
  it("does not mutate the input recommendation", () => {
    const ctx = ctxWith({ oura: ouraDay({ readinessScore: 92 }), whoop: whoopDay({ recoveryScore: 40 }) });
    const input = { label: "Push", readiness: "push", confidence: "high", modifiers: [] };
    const snapshot = JSON.stringify(input);
    applyWearableConfidenceAdjustment({ recommendation: input, resolvedContext: ctx });
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
