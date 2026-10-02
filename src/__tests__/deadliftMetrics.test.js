import { describe, expect, it } from "vitest";
import { POSE_LANDMARKS } from "../formCheck/squatMetrics";
import {
  extractDeadliftFrameMetrics,
  aggregateDeadliftMetrics,
  buildHipSeries,
} from "../formCheck/deadliftMetrics";

const L = POSE_LANDMARKS;

// Full 33-slot landmark array with the joints we care about overlaid.
function makeLandmarks(overrides = {}, defaultVis = 0.95) {
  const arr = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: defaultVis }));
  for (const [idx, p] of Object.entries(overrides)) {
    arr[idx] = { x: 0, y: 0, z: 0, visibility: defaultVis, ...p };
  }
  return arr;
}

// Standing/lockout: shoulder above hip above knee -> ~180° hip angle.
function lockoutFrame(tMs) {
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

// Hinged: torso roughly horizontal -> sharp (~90°) hip angle.
function hingeFrame(tMs) {
  return {
    tMs,
    landmarks: makeLandmarks({
      [L.LEFT_SHOULDER]: { x: 0.2, y: 0.5 },
      [L.LEFT_HIP]: { x: 0.5, y: 0.5 },
      [L.LEFT_KNEE]: { x: 0.5, y: 0.7 },
      [L.LEFT_ANKLE]: { x: 0.5, y: 0.9 },
    }),
  };
}

describe("extractDeadliftFrameMetrics", () => {
  it("reads a near-straight hip angle for a tall lockout", () => {
    const m = extractDeadliftFrameMetrics(lockoutFrame().landmarks);
    expect(m).toBeTruthy();
    expect(m.hipAngleDeg).toBeCloseTo(180, 0);
    expect(m.torsoLeanDeg).toBeCloseTo(0, 1);
  });

  it("reads a sharp hip angle and large torso lean at the bottom of a hinge", () => {
    const m = extractDeadliftFrameMetrics(hingeFrame().landmarks);
    expect(m).toBeTruthy();
    expect(m.hipAngleDeg).toBeLessThan(110);
    expect(m.torsoLeanDeg).toBeGreaterThan(45);
  });

  it("returns null when the hinge joints are not visible enough", () => {
    const lm = makeLandmarks(
      {
        [L.LEFT_SHOULDER]: { x: 0.5, y: 0.2, visibility: 0.2 },
        [L.LEFT_HIP]: { x: 0.5, y: 0.5, visibility: 0.2 },
        [L.LEFT_KNEE]: { x: 0.5, y: 0.7, visibility: 0.2 },
        [L.RIGHT_SHOULDER]: { x: 0.5, y: 0.2, visibility: 0.2 },
        [L.RIGHT_HIP]: { x: 0.5, y: 0.5, visibility: 0.2 },
        [L.RIGHT_KNEE]: { x: 0.5, y: 0.7, visibility: 0.2 },
      },
      0.2,
    );
    expect(extractDeadliftFrameMetrics(lm)).toBeNull();
  });

  it("returns null for malformed input", () => {
    expect(extractDeadliftFrameMetrics(null)).toBeNull();
    expect(extractDeadliftFrameMetrics([])).toBeNull();
  });
});

describe("aggregateDeadliftMetrics", () => {
  it("captures the bottom (min hip angle) and lockout (max hip angle)", () => {
    const frames = [lockoutFrame(0), hingeFrame(166), lockoutFrame(332)];
    const out = aggregateDeadliftMetrics(frames);
    expect(out.framesAnalyzed).toBe(3);
    expect(out.framesWithLandmarks).toBe(3);
    expect(out.metrics.minHipAngleDeg).toBeLessThan(110);
    expect(out.metrics.maxHipAngleDeg).toBeGreaterThan(160);
    expect(out.metrics.hipRangeDeg).toBeGreaterThan(40);
    // Torso lean is reported from the deepest hinge frame.
    expect(out.metrics.torsoLeanAtBottomDeg).toBeGreaterThan(45);
  });

  it("counts undetected frames toward framesAnalyzed only", () => {
    const out = aggregateDeadliftMetrics([lockoutFrame(0), { landmarks: null }, { landmarks: [] }]);
    expect(out.framesAnalyzed).toBe(3);
    expect(out.framesWithLandmarks).toBe(1);
  });

  it("yields null metrics for an empty clip", () => {
    const out = aggregateDeadliftMetrics([]);
    expect(out.framesAnalyzed).toBe(0);
    expect(out.metrics.minHipAngleDeg).toBeNull();
    expect(out.metrics.maxHipAngleDeg).toBeNull();
  });

  it("tolerates non-array input", () => {
    const out = aggregateDeadliftMetrics(undefined);
    expect(out.framesAnalyzed).toBe(0);
    expect(out.metrics.minHipAngleDeg).toBeNull();
  });
});

describe("buildHipSeries", () => {
  it("emits one {tMs, hipAngleDeg} sample per detectable frame", () => {
    const series = buildHipSeries([lockoutFrame(0), hingeFrame(166), lockoutFrame(332)]);
    expect(series).toHaveLength(3);
    expect(series[0]).toHaveProperty("tMs", 0);
    expect(series[0].hipAngleDeg).toBeCloseTo(180, 0);
    expect(series[1].hipAngleDeg).toBeLessThan(110);
  });

  it("skips frames with no usable landmarks", () => {
    const series = buildHipSeries([lockoutFrame(0), { tMs: 100, landmarks: null }, lockoutFrame(200)]);
    expect(series.map((s) => s.tMs)).toEqual([0, 200]);
  });

  it("tolerates non-array input", () => {
    expect(buildHipSeries(undefined)).toEqual([]);
  });
});
