/**
 * V1.3 Contract Test: Verify backend V1.3 fields can be safely persisted to history.
 * Tests the mapping of evidence and progressSignals from backend to frontend allow-list.
 */
import { describe, expect, it } from "vitest";
import {
  buildSummaryEntry,
} from "../formCheck/formCheckHistory";

// Mock a V1.3 backend response with evidence and progressSignals
function makeV13Analysis() {
  return {
    status: "analyzed",
    movement: "squat-side-view",
    metrics: {
      minKneeAngleDeg: 82.4,
      minHipAngleDeg: 65.2,
      maxTorsoLeanProxy: 0.18,
    },
    result: {
      movement: "squat",
      confidence: { level: "high", reasons: [] },
    },
    formScore: {
      score: 78,
      label: "good",
      reasons: ["Depth looks solid"],
    },
    captureQuality: {
      score: 85,
      label: "high",
      checks: [
        { item: "visibility", status: "good", note: "Clear joint visibility" },
      ],
    },
    coaching: {
      overall: "Good squat form.",
      topPriority: "",
      whatLookedGood: ["Strong range of motion"],
      watchItems: [],
      nextSetCue: "Maintain this form.",
      retakeRecommended: false,
    },
    metricConfidence: {
      minKneeAngleDeg: { confidence: 0.9 },
    },
    segmentation: {
      repCount: 3,
      reps: [
        {
          index: 1,
          startMs: 0,
          bottomMs: 500,
          endMs: 1000,
          depthAssessment: "at-or-below-parallel",
          minKneeAngleDeg: 82.4,
          tempoSec: 1.0,
          flags: [],
        },
      ],
    },
    // V1.3 FIELDS
    evidence: {
      summary: "Analyzed squat form from clear pose detection.",
      keyMoments: [
        {
          label: "rep_start",
          timestampMs: 0,
          confidence: 0.75,
          reason: "Full knee extension at setup.",
        },
        {
          label: "bottom",
          timestampMs: 500,
          confidence: 0.65,
          reason: "Minimum knee angle detected.",
        },
        {
          label: "rep_end",
          timestampMs: 1000,
          confidence: 0.70,
          reason: "Lockout position estimated.",
        },
      ],
      timeline: [
        { phase: "video_start", timestampMs: 0 },
        { phase: "video_end", timestampMs: 2000 },
      ],
      metricHighlights: [
        {
          metric: "kneeDepth",
          value: 82.4,
          observation: "Knee depth is good.",
          label: "note",
        },
      ],
      limitations: ["Side-view only; no multi-angle validation."],
    },
    progressSignals: {
      movement: "squat",
      repCount: 3,
      primaryFocus: "kneeDepth",
      comparableMetrics: [
        {
          name: "minKneeAngleDeg",
          value: 82.4,
          unit: "degrees",
        },
      ],
      trendKey: 82.4,
      scoreComponents: [
        { component: "depth", score: 85, weight: 0.4 },
      ],
    },
  };
}

const DATE = "2026-07-01T12:00:00.000Z";

describe("V1.3 Contract: evidence and progressSignals", () => {
  it("should safely handle V1.3 evidence field in buildSummaryEntry", () => {
    const analysis = makeV13Analysis();
    expect(() => {
      buildSummaryEntry(analysis, DATE);
    }).not.toThrow();
  });

  it("should safely handle V1.3 progressSignals field in buildSummaryEntry", () => {
    const analysis = makeV13Analysis();
    expect(() => {
      buildSummaryEntry(analysis, DATE);
    }).not.toThrow();
  });

  it("persists only derived V1.3 evidence/progress fields in the history allow-list", () => {
    const analysis = makeV13Analysis();
    const entry = buildSummaryEntry(analysis, DATE);

    expect(entry.evidence).toBeDefined();
    expect(entry.evidence.summary).toMatch(/squat/i);
    expect(entry.evidence.keyMoments[0]).toEqual({
      label: "rep_start",
      phase: null,
      tMs: 0,
      confidence: 0.75,
      reason: "Full knee extension at setup.",
    });
    expect(entry.evidence.metricHighlights[0].name).toBe("kneeDepth");
    expect(entry.progressSignals).toBeDefined();
    expect(entry.progressSignals.primaryFocus).toBe("kneeDepth");
    expect(entry.progressSignals.comparableMetrics[0]).toEqual({
      name: "minKneeAngleDeg",
      value: 82.4,
      unit: "degrees",
    });
  });

  it("should preserve existing V1.2 fields even when V1.3 fields present", () => {
    const analysis = makeV13Analysis();
    const entry = buildSummaryEntry(analysis, DATE);
    
    // V1.2 fields should still be there
    expect(entry.formScore).toBeDefined();
    expect(entry.formScore.score).toBe(78);
    expect(entry.formScore.label).toBe("good");
    
    expect(entry.captureQuality).toBeDefined();
    expect(entry.captureQuality.score).toBe(85);
    
    expect(entry.coaching).toBeDefined();
    expect(entry.coaching.overall).toBe("Good squat form.");
  });

  it("does not persist raw media, raw frames, base64 images, or raw landmarks", () => {
    const analysis = makeV13Analysis();
    analysis.evidence.rawLandmarks = [{ x: 0.1, y: 0.2, z: 0.3 }];
    analysis.evidence.frameImageBase64 = "data:image/png;base64,abc123";
    analysis.evidence.frames = [{ tMs: 0, pixels: "nope" }];
    analysis.progressSignals.videoObjectUrl = "blob:https://0vertrained.netlify.app/fake";
    const entry = buildSummaryEntry(analysis, DATE);
    const json = JSON.stringify(entry);

    expect(json).not.toMatch(/rawLandmarks|frameImageBase64|pixels|videoObjectUrl|base64|blob:https/);
  });
});
