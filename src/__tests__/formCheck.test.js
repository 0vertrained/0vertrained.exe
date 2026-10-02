import { describe, expect, it } from "vitest";
import { getProtocol, listProtocols, DEFAULT_MOVEMENT, movementLabel } from "../formCheck/protocols";
import { validateVideo, VIDEO_LIMITS } from "../formCheck/videoValidation";
import { assessConfidence, CONFIDENCE_THRESHOLDS } from "../formCheck/confidence";
import { analyzeSquat } from "../formCheck/squatAnalyzer";

describe("protocols", () => {
  it("lists the full V1.9 movement-expansion protocol catalog", () => {
    const all = listProtocols();
    const keys = new Set(all.map(p => p.key));
    const movements = new Set(all.map(p => p.movement));
    expect(Array.isArray(all)).toBe(true);
    expect(all.length).toBe(22);
    for (const key of [
      "squat-side-view",
      "deadlift-side-view",
      "pushup-side-view",
      "benchpress-side-view",
      "overheadpress-side-view",
      "bentoverrow-side-view",
      "front-squat-side-view",
      "romanian-deadlift-side-view",
      "incline-benchpress-side-view",
      "dumbbell-shoulder-press-side-view",
      "pullup-front-view",
      "lunge-side-view",
      "hip-thrust-side-view",
      "goblet-squat-side-view",
      "dumbbell-benchpress-side-view",
      "seated-cable-row-side-view",
      "lat-pulldown-front-view",
      "dip-side-view",
      "power-clean-side-view",
      "snatch-side-view",
      "clean-and-jerk-side-view",
      "kettlebell-swing-side-view",
    ]) {
      expect(keys.has(key)).toBe(true);
    }
    expect(movements).toEqual(
      new Set([
        "squat", "deadlift", "pushup", "benchpress", "overheadpress", "bentoverrow",
        "frontsquat", "rdl", "inclinebench", "dbshoulderpress", "pullup", "lunge",
        "hipthrust", "gobletsquat", "dbbench", "cablerow", "latpulldown", "dip",
        "powerclean", "snatch", "cleanjerk", "kettlebellswing",
      ]),
    );
  });

  it("protocol for squat side view includes camera setup instructions", () => {
    const p = getProtocol("squat-side-view");
    expect(p).toBeTruthy();
    expect(p.view).toBe("side");
    expect(Array.isArray(p.cameraSetup)).toBe(true);
    expect(p.cameraSetup.length).toBeGreaterThan(0);
    // Setup guidance should actually mention camera/phone placement.
    expect(p.cameraSetup.join(" ").toLowerCase()).toMatch(/camera|phone|tripod/);
  });

  it("every protocol carries setup + recording guidance", () => {
    for (const p of listProtocols()) {
      expect(["side", "front"]).toContain(p.view);
      expect(Array.isArray(p.cameraSetup)).toBe(true);
      expect(p.cameraSetup.length).toBeGreaterThan(0);
      expect(Array.isArray(p.recordingTips)).toBe(true);
      expect(typeof p.label).toBe("string");
      expect(p.label.length).toBeGreaterThan(0);
    }
  });

  it("falls back to the default movement for unknown keys", () => {
    expect(getProtocol("does-not-exist")).toEqual(getProtocol(DEFAULT_MOVEMENT));
  });

  it("resolves a human label for known keys and echoes unknown keys safely", () => {
    expect(movementLabel("deadlift-side-view")).toMatch(/deadlift/i);
    expect(movementLabel("totally-unknown")).toBe("totally-unknown");
    expect(movementLabel(null)).toBeTruthy();
  });
});

describe("validateVideo", () => {
  it("rejects a missing file", () => {
    const r = validateVideo({ file: null, durationSec: 5 });
    expect(r.valid).toBe(false);
    expect(r.code).toBe("missing-file");
  });

  it("rejects a non-video file", () => {
    const r = validateVideo({ file: { type: "image/png", size: 1000 }, durationSec: 5 });
    expect(r.valid).toBe(false);
    expect(r.code).toBe("invalid-type");
  });

  it("rejects an overly long clip", () => {
    const r = validateVideo({
      file: { type: "video/mp4", size: 1000 },
      durationSec: VIDEO_LIMITS.maxDurationSec + 5,
    });
    expect(r.valid).toBe(false);
    expect(r.code).toBe("too-long");
  });

  it("rejects an oversized file", () => {
    const r = validateVideo({
      file: { type: "video/mp4", size: VIDEO_LIMITS.maxBytes + 1 },
      durationSec: 5,
    });
    expect(r.valid).toBe(false);
    expect(r.code).toBe("too-large");
  });

  it("accepts a short valid clip", () => {
    const r = validateVideo({ file: { type: "video/mp4", size: 1000 }, durationSec: 5 });
    expect(r.valid).toBe(true);
    expect(r.code).toBe("ok");
  });

  it("tolerates unknown duration (metadata not yet read)", () => {
    const r = validateVideo({ file: { type: "video/mp4", size: 1000 }, durationSec: null });
    expect(r.valid).toBe(true);
  });

  // V1.1: Test warnings for non-ideal duration
  it("warns when clip is shorter than ideal (< 5s)", () => {
    const r = validateVideo({
      file: { type: "video/mp4", size: 5000 },
      durationSec: 3,
    });
    expect(r.valid).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.warnings[0].toLowerCase()).toMatch(/ideal|length/);
    expect(r.retakeTips.length).toBeGreaterThan(0);
  });

  // V1.1: Test warnings for clips longer than ideal (> 12s)
  it("warns when clip is longer than ideal (> 12s)", () => {
    const r = validateVideo({
      file: { type: "video/mp4", size: 10000 },
      durationSec: 15,
    });
    expect(r.valid).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.retakeTips.length).toBeGreaterThan(0);
  });

  // V1.1: Test warnings for low resolution
  it("warns when video resolution is low (< 360p)", () => {
    const r = validateVideo({
      file: { type: "video/mp4", size: 5000 },
      durationSec: 8,
      width: 320,
      height: 240,
    });
    expect(r.valid).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.warnings[0].toLowerCase()).toMatch(/resolution|360/);
    expect(r.retakeTips.length).toBeGreaterThan(0);
  });

  // V1.1: Test warnings for large file size (> 20MB)
  it("warns when file is large (> 20MB)", () => {
    const r = validateVideo({
      file: { type: "video/mp4", size: 25 * 1024 * 1024 },
      durationSec: 10,
    });
    expect(r.valid).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.warnings[0].toLowerCase()).toMatch(/mb|large|size/);
  });

  // V1.1: Test that ideal-range clips pass cleanly
  it("passes cleanly for ideal-range clips (5-12s, good resolution)", () => {
    const r = validateVideo({
      file: { type: "video/mp4", size: 8 * 1024 * 1024 },
      durationSec: 8,
      width: 1280,
      height: 720,
    });
    expect(r.valid).toBe(true);
    expect(r.warnings.length).toBe(0);
    expect(r.retakeTips.length).toBe(0);
    expect(r.code).toBe("ok");
  });
});

describe("assessConfidence", () => {
  it("explains low confidence when few frames have landmarks", () => {
    const r = assessConfidence({ framesAnalyzed: 30, framesWithLandmarks: 3, avgVisibility: 0.9 });
    expect(r.level).toBe("low");
    expect(r.reasons.join(" ").toLowerCase()).toMatch(/landmark|detect|body/);
  });

  it("explains low confidence when visibility is poor", () => {
    const r = assessConfidence({ framesAnalyzed: 30, framesWithLandmarks: 30, avgVisibility: 0.2 });
    expect(r.level).toBe("low");
    expect(r.reasons.join(" ").toLowerCase()).toMatch(/visib|clear|lighting/);
  });

  it("reports high confidence when detection and visibility are strong", () => {
    const r = assessConfidence({ framesAnalyzed: 30, framesWithLandmarks: 30, avgVisibility: 0.92 });
    expect(r.level).toBe("high");
    expect(r.reasons.length).toBe(0);
  });

  it("treats no analyzed frames as low confidence", () => {
    const r = assessConfidence({ framesAnalyzed: 0, framesWithLandmarks: 0, avgVisibility: 0 });
    expect(r.level).toBe("low");
  });

  it("exposes thresholds for reuse", () => {
    expect(CONFIDENCE_THRESHOLDS.minDetectionRate).toBeGreaterThan(0);
    expect(CONFIDENCE_THRESHOLDS.minVisibility).toBeGreaterThan(0);
  });
});

describe("analyzeSquat", () => {
  it("returns a low-confidence retake result instead of cues", () => {
    const r = analyzeSquat(
      { minKneeAngleDeg: 80 },
      { confidence: { level: "low", reasons: ["Body not clearly detected"] } },
    );
    expect(r.assessable).toBe(false);
    expect(r.depthAssessment).toBe("unknown");
    expect(r.summary.toLowerCase()).toMatch(/retake|again|unable|not enough/);
  });

  it("returns conservative depth cue when at/below parallel", () => {
    const r = analyzeSquat({ minKneeAngleDeg: 85, torsoForwardLeanDeg: 30 });
    expect(r.assessable).toBe(true);
    expect(r.depthAssessment).toBe("at-or-below-parallel");
    expect(Array.isArray(r.cues)).toBe(true);
    expect(r.cues.length).toBeGreaterThan(0);
    // Always conservative — must carry an educational disclaimer.
    expect(r.disclaimer.toLowerCase()).toMatch(/estimate|educational|not.*clinical|not.*medical/);
  });

  it("flags shallow depth as a watch cue without commanding", () => {
    const r = analyzeSquat({ minKneeAngleDeg: 130, torsoForwardLeanDeg: 20 });
    expect(r.depthAssessment).toBe("above-parallel");
    const watch = r.cues.find(c => c.id === "depth");
    expect(watch).toBeTruthy();
    expect(watch.severity).toBe("watch");
    // Conservative language — hedged, not absolute commands.
    expect(watch.text.toLowerCase()).toMatch(/appears|may|consider|if/);
  });

  it("flags large forward torso lean conservatively", () => {
    const r = analyzeSquat({ minKneeAngleDeg: 85, torsoForwardLeanDeg: 65 });
    const lean = r.cues.find(c => c.id === "torso");
    expect(lean).toBeTruthy();
    expect(lean.severity).toBe("watch");
  });

  it("marks depth unknown when no angle is provided", () => {
    const r = analyzeSquat({});
    expect(r.assessable).toBe(true);
    expect(r.depthAssessment).toBe("unknown");
  });
});

// V1.2: Test history building with new coaching fields
describe("formCheckHistory with V1.2 coaching fields", () => {
  it("preserves formScore, captureQuality, coaching, and metricConfidence in summary entries", () => {
    const { buildSummaryEntry } = require("../formCheck/formCheckHistory");
    
    const analysis = {
      movement: "squat-side-view",
      formScore: 78,
      metricConfidence: 0.88,
      captureQuality: {
        lighting: "good",
        framing: "excellent",
        motionBlur: "minimal",
        bodyVisibility: "clear",
        overallQuality: "high",
      },
      coaching: {
        nextSetCue: "Focus on depth in your next set.",
        retakeRecommendation: null,
      },
      result: {
        movement: "squat",
        confidence: { level: "high", score: 0.88, reasons: [] },
        cues: [{ id: "depth", severity: "info", text: "Nice depth." }],
      },
      segmentation: {
        reps: [{ index: 1, depthAssessment: "at-or-below-parallel", tempoSec: 1.5 }],
        repCount: 1,
      },
      metrics: {},
    };
    
    const entry = buildSummaryEntry(analysis, "2026-06-30T10:00:00Z");
    expect(entry.formScore?.score).toBe(78);
    expect(entry.metricConfidence?.overall?.confidence).toBe(0.88);
    expect(entry.captureQuality).toBeTruthy();
    expect(entry.captureQuality.lighting).toBe("good");
    expect(entry.coaching).toBeTruthy();
    expect(entry.coaching.nextSetCue).toMatch(/depth/i);
  });

  it("allows V1.2 fields to be optional (backward compatible)", () => {
    const { buildSummaryEntry } = require("../formCheck/formCheckHistory");
    
    const analysis = {
      movement: "squat-side-view",
      // No V1.2 fields
      result: {
        movement: "squat",
        confidence: { level: "high", score: 0.88, reasons: [] },
        cues: [],
      },
      segmentation: { reps: [], repCount: 0 },
      metrics: {},
    };
    
    const entry = buildSummaryEntry(analysis, "2026-06-30T10:00:00Z");
    expect(entry.formScore).toBeNull();
    expect(entry.metricConfidence).toBeNull();
    expect(entry.captureQuality).toBeNull();
    expect(entry.coaching).toBeNull();
  });
});
