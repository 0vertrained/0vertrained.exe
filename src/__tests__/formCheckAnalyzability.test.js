// V1.5 + V1.7 — analyzability mapping + movement-metrics allow-list tests.
//
// Confirms serverPoseClient maps the new derived fields, and that
// formCheckHistory persists only the derived analyzability/movementMetrics
// summary (no raw signals).
import { describe, expect, it } from "vitest";
import { mapHostedResultToAnalysis } from "../formCheck/serverPoseClient";
import { buildSummaryEntry } from "../formCheck/formCheckHistory";

const baseResult = {
  ok: true,
  status: "analyzed",
  movement: "squat-side-view",
  confidence: { score: 0.82, level: "high", reasons: [], framesWithPose: 22, avgVisibility: 0.8 },
  summary: { repCount: 3, overall: "Analyzed squat." },
  reps: [],
  cues: [],
  metrics: { minKneeAngleDeg: 92 },
  analyzability: {
    level: "usable",
    score: 74,
    blockingIssues: [],
    improvements: ["Improve lighting so joints track cleanly."],
    shouldShowFullCoaching: true,
  },
  movementMetrics: {
    depthConsistency: { score: 82, label: "consistent", spread: 6.0, note: "Estimate only." },
    torsoDrift: { score: 55, label: "variable", spread: 12.4, note: "Proxy only." },
  },
  privacy: { videoStored: false },
};

describe("mapHostedResultToAnalysis — V1.5/V1.7", () => {
  it("maps analyzability with all derived fields", () => {
    const out = mapHostedResultToAnalysis(baseResult, {});
    expect(out.analyzability).toEqual({
      level: "usable",
      score: 74,
      blockingIssues: [],
      improvements: ["Improve lighting so joints track cleanly."],
      shouldShowFullCoaching: true,
    });
  });

  it("maps movementMetrics scalar fields only", () => {
    const out = mapHostedResultToAnalysis(baseResult, {});
    expect(out.movementMetrics.depthConsistency).toEqual({
      score: 82,
      label: "consistent",
      spread: 6.0,
      note: "Estimate only.",
    });
  });

  it("tolerates a missing analyzability/movementMetrics", () => {
    const out = mapHostedResultToAnalysis({ ...baseResult, analyzability: undefined, movementMetrics: undefined }, {});
    expect(out.analyzability).toBeNull();
    expect(out.movementMetrics).toBeNull();
  });

  it("defaults shouldShowFullCoaching to true only when not explicitly false", () => {
    const weak = mapHostedResultToAnalysis(
      { ...baseResult, analyzability: { ...baseResult.analyzability, shouldShowFullCoaching: false } },
      {},
    );
    expect(weak.analyzability.shouldShowFullCoaching).toBe(false);
  });
});

describe("buildSummaryEntry — V1.5/V1.7 allow-list", () => {
  it("persists the derived analyzability summary", () => {
    const analysis = mapHostedResultToAnalysis(baseResult, {});
    const entry = buildSummaryEntry(analysis, "2026-06-30T00:00:00.000Z");
    expect(entry.analyzability.level).toBe("usable");
    expect(entry.analyzability.score).toBe(74);
    expect(Array.isArray(entry.analyzability.improvements)).toBe(true);
  });

  it("persists movementMetrics as scalar-only records", () => {
    const analysis = mapHostedResultToAnalysis(baseResult, {});
    const entry = buildSummaryEntry(analysis, "2026-06-30T00:00:00.000Z");
    expect(entry.movementMetrics.depthConsistency).toEqual({ score: 82, label: "consistent", spread: 6 });
    // No note/free-text carried into persistence.
    expect(entry.movementMetrics.depthConsistency).not.toHaveProperty("note");
  });

  it("never persists raw media even if present on the source object", () => {
    const analysis = mapHostedResultToAnalysis(baseResult, {});
    // Attacker-ish: try to smuggle raw fields onto the analysis object.
    analysis.videoBlob = "data:video/webm;base64,AAAA";
    analysis.frames = [{ landmarks: [1, 2, 3] }];
    analysis.analyzability.rawLandmarks = [[0.1, 0.2]];
    const entry = buildSummaryEntry(analysis, "2026-06-30T00:00:00.000Z");
    const json = JSON.stringify(entry);
    expect(json).not.toContain("base64");
    expect(json).not.toContain("landmarks");
    expect(json).not.toContain("videoBlob");
  });
});
