import { describe, expect, it } from "vitest";
import {
  POSE_LANDMARKS,
  angleDeg,
  torsoLeanFromVertical,
  extractFrameMetrics,
  aggregateSquatMetrics,
  buildKneeSeries,
} from "../formCheck/squatMetrics";

// Build a full 33-slot landmark array, then overlay the joints we care about.
// All points default to fully-visible so callers can selectively dim them.
function makeLandmarks(overrides = {}, defaultVis = 0.95) {
  const arr = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: defaultVis }));
  for (const [idx, p] of Object.entries(overrides)) {
    arr[idx] = { x: 0, y: 0, z: 0, visibility: defaultVis, ...p };
  }
  return arr;
}

describe("angleDeg", () => {
  it("computes a right angle", () => {
    const a = { x: 0, y: 1 };
    const b = { x: 0, y: 0 };
    const c = { x: 1, y: 0 };
    expect(angleDeg(a, b, c)).toBeCloseTo(90, 5);
  });

  it("computes a straight (180°) angle for collinear points", () => {
    const a = { x: -1, y: 0 };
    const b = { x: 0, y: 0 };
    const c = { x: 1, y: 0 };
    expect(angleDeg(a, b, c)).toBeCloseTo(180, 5);
  });

  it("returns null for degenerate (zero-length) segments", () => {
    const b = { x: 0, y: 0 };
    expect(angleDeg(b, b, { x: 1, y: 0 })).toBeNull();
  });

  it("returns null for missing points", () => {
    expect(angleDeg(null, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeNull();
  });
});

describe("torsoLeanFromVertical", () => {
  it("is ~0 for an upright torso (shoulder directly above hip)", () => {
    const shoulder = { x: 0.5, y: 0.2 };
    const hip = { x: 0.5, y: 0.5 };
    expect(torsoLeanFromVertical(shoulder, hip)).toBeCloseTo(0, 5);
  });

  it("is 45° when horizontal and vertical offsets match", () => {
    const shoulder = { x: 0.7, y: 0.3 };
    const hip = { x: 0.5, y: 0.5 };
    expect(torsoLeanFromVertical(shoulder, hip)).toBeCloseTo(45, 5);
  });

  it("ignores lean direction (always reports magnitude)", () => {
    const hip = { x: 0.5, y: 0.5 };
    const leanRight = torsoLeanFromVertical({ x: 0.7, y: 0.35 }, hip);
    const leanLeft = torsoLeanFromVertical({ x: 0.3, y: 0.35 }, hip);
    expect(leanRight).toBeCloseTo(leanLeft, 5);
  });

  it("returns null when points coincide", () => {
    expect(torsoLeanFromVertical({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 })).toBeNull();
  });
});

describe("extractFrameMetrics", () => {
  const L = POSE_LANDMARKS;

  it("computes a near-straight knee angle for a standing pose", () => {
    // Hip, knee, ankle vertically stacked -> ~180° knee.
    const lm = makeLandmarks({
      [L.LEFT_SHOULDER]: { x: 0.5, y: 0.2 },
      [L.LEFT_HIP]: { x: 0.5, y: 0.5 },
      [L.LEFT_KNEE]: { x: 0.5, y: 0.7 },
      [L.LEFT_ANKLE]: { x: 0.5, y: 0.9 },
    });
    const m = extractFrameMetrics(lm);
    expect(m).toBeTruthy();
    expect(m.kneeAngleDeg).toBeCloseTo(180, 1);
    expect(m.torsoLeanDeg).toBeCloseTo(0, 1);
  });

  it("computes a bent knee angle for a deep squat", () => {
    // Knee pushed forward of the hip/ankle line -> sharper angle.
    const lm = makeLandmarks({
      [L.LEFT_SHOULDER]: { x: 0.4, y: 0.3 },
      [L.LEFT_HIP]: { x: 0.5, y: 0.6 },
      [L.LEFT_KNEE]: { x: 0.7, y: 0.65 },
      [L.LEFT_ANKLE]: { x: 0.5, y: 0.9 },
    });
    const m = extractFrameMetrics(lm);
    expect(m).toBeTruthy();
    expect(m.kneeAngleDeg).toBeLessThan(120);
  });

  it("picks the more-visible body side", () => {
    // Left side dim, right side clear -> should read the right knee geometry.
    const lm = makeLandmarks(
      {
        [L.RIGHT_SHOULDER]: { x: 0.5, y: 0.2, visibility: 0.95 },
        [L.RIGHT_HIP]: { x: 0.5, y: 0.5, visibility: 0.95 },
        [L.RIGHT_KNEE]: { x: 0.5, y: 0.7, visibility: 0.95 },
        [L.RIGHT_ANKLE]: { x: 0.5, y: 0.9, visibility: 0.95 },
        [L.LEFT_HIP]: { x: 0.1, y: 0.5, visibility: 0.1 },
        [L.LEFT_KNEE]: { x: 0.1, y: 0.7, visibility: 0.1 },
        [L.LEFT_ANKLE]: { x: 0.1, y: 0.9, visibility: 0.1 },
      },
      0.1,
    );
    const m = extractFrameMetrics(lm);
    expect(m).toBeTruthy();
    expect(m.kneeAngleDeg).toBeCloseTo(180, 1);
  });

  it("returns null when lower-body joints are not visible enough", () => {
    const lm = makeLandmarks(
      {
        [L.LEFT_HIP]: { x: 0.5, y: 0.5, visibility: 0.2 },
        [L.LEFT_KNEE]: { x: 0.5, y: 0.7, visibility: 0.2 },
        [L.LEFT_ANKLE]: { x: 0.5, y: 0.9, visibility: 0.2 },
        [L.RIGHT_HIP]: { x: 0.5, y: 0.5, visibility: 0.2 },
        [L.RIGHT_KNEE]: { x: 0.5, y: 0.7, visibility: 0.2 },
        [L.RIGHT_ANKLE]: { x: 0.5, y: 0.9, visibility: 0.2 },
      },
      0.2,
    );
    expect(extractFrameMetrics(lm)).toBeNull();
  });

  it("returns null for malformed input", () => {
    expect(extractFrameMetrics(null)).toBeNull();
    expect(extractFrameMetrics([])).toBeNull();
  });
});

describe("aggregateSquatMetrics", () => {
  const L = POSE_LANDMARKS;

  function standingFrame() {
    return {
      landmarks: makeLandmarks({
        [L.LEFT_SHOULDER]: { x: 0.5, y: 0.2 },
        [L.LEFT_HIP]: { x: 0.5, y: 0.5 },
        [L.LEFT_KNEE]: { x: 0.5, y: 0.7 },
        [L.LEFT_ANKLE]: { x: 0.5, y: 0.9 },
      }),
    };
  }

  function squatFrame() {
    return {
      landmarks: makeLandmarks({
        [L.LEFT_SHOULDER]: { x: 0.35, y: 0.45 },
        [L.LEFT_HIP]: { x: 0.5, y: 0.6 },
        [L.LEFT_KNEE]: { x: 0.72, y: 0.62 },
        [L.LEFT_ANKLE]: { x: 0.5, y: 0.9 },
      }),
    };
  }

  it("counts frames and reports the minimum knee angle across the clip", () => {
    const frames = [standingFrame(), squatFrame(), standingFrame()];
    const out = aggregateSquatMetrics(frames);
    expect(out.framesAnalyzed).toBe(3);
    expect(out.framesWithLandmarks).toBe(3);
    expect(out.avgVisibility).toBeGreaterThan(0.5);
    // The deepest frame (squat) should drive the minimum.
    expect(out.metrics.minKneeAngleDeg).toBeLessThan(120);
  });

  it("captures torso lean from the deepest frame, not a standing one", () => {
    const frames = [standingFrame(), squatFrame()];
    const out = aggregateSquatMetrics(frames);
    // Squat frame leans forward; the reported lean should reflect that frame.
    expect(out.metrics.torsoForwardLeanDeg).toBeGreaterThan(10);
  });

  it("counts undetected frames toward framesAnalyzed but not framesWithLandmarks", () => {
    const frames = [standingFrame(), { landmarks: null }, { landmarks: [] }];
    const out = aggregateSquatMetrics(frames);
    expect(out.framesAnalyzed).toBe(3);
    expect(out.framesWithLandmarks).toBe(1);
  });

  it("yields null metrics and zero detection for an empty clip", () => {
    const out = aggregateSquatMetrics([]);
    expect(out.framesAnalyzed).toBe(0);
    expect(out.framesWithLandmarks).toBe(0);
    expect(out.avgVisibility).toBe(0);
    expect(out.metrics.minKneeAngleDeg).toBeNull();
    expect(out.metrics.torsoForwardLeanDeg).toBeNull();
  });

  it("tolerates non-array input", () => {
    const out = aggregateSquatMetrics(undefined);
    expect(out.framesAnalyzed).toBe(0);
    expect(out.metrics.minKneeAngleDeg).toBeNull();
  });
});

describe("buildKneeSeries", () => {
  const L = POSE_LANDMARKS;

  function standingFrame(tMs) {
    return {
      tMs,
      landmarks: makeLandmarks({
        [L.LEFT_SHOULDER]: { x: 0.5, y: 0.2 },
        [L.LEFT_HIP]: { x: 0.5, y: 0.5 },
        [L.LEFT_KNEE]: { x: 0.5, y: 0.7 },
        [L.LEFT_ANKLE]: { x: 0.5, y: 0.9 },
      }),
    };
  }

  it("emits one {tMs, kneeAngleDeg} sample per detectable frame", () => {
    const series = buildKneeSeries([standingFrame(0), standingFrame(166), standingFrame(332)]);
    expect(series).toHaveLength(3);
    expect(series[0]).toHaveProperty("tMs", 0);
    expect(series[0].kneeAngleDeg).toBeCloseTo(180, 0);
    expect(series[1].tMs).toBe(166);
  });

  it("skips frames with no usable landmarks", () => {
    const series = buildKneeSeries([standingFrame(0), { tMs: 100, landmarks: null }, standingFrame(200)]);
    expect(series).toHaveLength(2);
    expect(series.map((s) => s.tMs)).toEqual([0, 200]);
  });

  it("synthesizes timestamps when frames lack tMs", () => {
    const f = standingFrame(0);
    delete f.tMs;
    const series = buildKneeSeries([f, { ...standingFrame(0), tMs: undefined }]);
    expect(series).toHaveLength(2);
    expect(series[0].tMs).toBe(0);
    expect(series[1].tMs).toBeGreaterThan(0);
  });

  it("tolerates non-array input", () => {
    expect(buildKneeSeries(undefined)).toEqual([]);
  });
});
