import { describe, expect, it } from "vitest";
import {
  OVERHEADPRESS_LANDMARKS,
  extractOverheadpressFrameMetrics,
  aggregateOverheadpressMetrics,
  buildOverheadpressSeries,
} from "../formCheck/overheadpressMetrics";

const L = OVERHEADPRESS_LANDMARKS;

function makeLandmarks(overrides = {}, defaultVis = 0.95) {
  const arr = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: defaultVis }));
  for (const [idx, p] of Object.entries(overrides)) {
    arr[idx] = { x: 0, y: 0, z: 0, visibility: defaultVis, ...p };
  }
  return arr;
}

// Overhead lockout: arm straight up, torso upright.
function topFrame(tMs) {
  return {
    tMs,
    landmarks: makeLandmarks({
      [L.LEFT_SHOULDER]: { x: 0.5, y: 0.4 },
      [L.LEFT_HIP]: { x: 0.5, y: 0.7 },
      [L.LEFT_ELBOW]: { x: 0.5, y: 0.25 },
      [L.LEFT_WRIST]: { x: 0.5, y: 0.1 },
    }),
  };
}

// Rack / bottom: elbow bent, hands near shoulder, torso upright.
function bottomFrame(tMs) {
  return {
    tMs,
    landmarks: makeLandmarks({
      [L.LEFT_SHOULDER]: { x: 0.5, y: 0.4 },
      [L.LEFT_HIP]: { x: 0.5, y: 0.7 },
      [L.LEFT_ELBOW]: { x: 0.4, y: 0.45 },
      [L.LEFT_WRIST]: { x: 0.45, y: 0.3 },
    }),
  };
}

// Forward lean: shoulder drifts ahead of the hip.
function leanFrame(tMs) {
  return {
    tMs,
    landmarks: makeLandmarks({
      [L.LEFT_SHOULDER]: { x: 0.65, y: 0.4 },
      [L.LEFT_HIP]: { x: 0.5, y: 0.7 },
      [L.LEFT_ELBOW]: { x: 0.65, y: 0.25 },
      [L.LEFT_WRIST]: { x: 0.65, y: 0.1 },
    }),
  };
}

describe("extractOverheadpressFrameMetrics", () => {
  it("reads a near-straight elbow overhead and an upright torso", () => {
    const m = extractOverheadpressFrameMetrics(topFrame().landmarks);
    expect(m).toBeTruthy();
    expect(m.elbowAngleDeg).toBeCloseTo(180, 0);
    expect(m.forwardLeanDeg).toBeLessThan(10);
  });

  it("reads a bent elbow at the rack position", () => {
    const m = extractOverheadpressFrameMetrics(bottomFrame().landmarks);
    expect(m).toBeTruthy();
    expect(m.elbowAngleDeg).toBeLessThan(120);
  });

  it("reads a larger forward lean when the shoulder drifts ahead of the hip", () => {
    const upright = extractOverheadpressFrameMetrics(topFrame().landmarks);
    const lean = extractOverheadpressFrameMetrics(leanFrame().landmarks);
    expect(lean.forwardLeanDeg).toBeGreaterThan(upright.forwardLeanDeg);
    expect(lean.forwardLeanDeg).toBeGreaterThan(15);
  });

  it("returns null when the arm joints are not visible enough", () => {
    const lm = makeLandmarks(
      {
        [L.LEFT_SHOULDER]: { x: 0.5, y: 0.4, visibility: 0.2 },
        [L.LEFT_ELBOW]: { x: 0.5, y: 0.25, visibility: 0.2 },
        [L.LEFT_WRIST]: { x: 0.5, y: 0.1, visibility: 0.2 },
        [L.RIGHT_SHOULDER]: { x: 0.5, y: 0.4, visibility: 0.2 },
        [L.RIGHT_ELBOW]: { x: 0.5, y: 0.25, visibility: 0.2 },
        [L.RIGHT_WRIST]: { x: 0.5, y: 0.1, visibility: 0.2 },
      },
      0.2,
    );
    expect(extractOverheadpressFrameMetrics(lm)).toBeNull();
  });

  it("returns null for malformed input", () => {
    expect(extractOverheadpressFrameMetrics(null)).toBeNull();
    expect(extractOverheadpressFrameMetrics([])).toBeNull();
  });
});

describe("aggregateOverheadpressMetrics", () => {
  it("captures elbow range, overhead shoulder reach, and worst forward lean", () => {
    const frames = [bottomFrame(0), topFrame(166), leanFrame(332), bottomFrame(498)];
    const out = aggregateOverheadpressMetrics(frames);
    expect(out.framesAnalyzed).toBe(4);
    expect(out.framesWithLandmarks).toBe(4);
    expect(out.metrics.minElbowAngleDeg).toBeLessThan(120);
    expect(out.metrics.maxElbowAngleDeg).toBeGreaterThan(160);
    expect(out.metrics.elbowRangeDeg).toBeGreaterThan(40);
    expect(out.metrics.forwardLeanDeg).toBeGreaterThan(15);
    expect(Number.isFinite(out.metrics.shoulderAngleDeg)).toBe(true);
  });

  it("yields null metrics for an empty clip", () => {
    const out = aggregateOverheadpressMetrics([]);
    expect(out.framesAnalyzed).toBe(0);
    expect(out.metrics.minElbowAngleDeg).toBeNull();
    expect(out.metrics.maxElbowAngleDeg).toBeNull();
  });

  it("tolerates non-array input", () => {
    const out = aggregateOverheadpressMetrics(undefined);
    expect(out.framesAnalyzed).toBe(0);
    expect(out.metrics.minElbowAngleDeg).toBeNull();
  });
});

describe("buildOverheadpressSeries", () => {
  it("emits one {tMs, elbowAngleDeg} sample per detectable frame", () => {
    const series = buildOverheadpressSeries([bottomFrame(0), topFrame(166), bottomFrame(332)]);
    expect(series).toHaveLength(3);
    expect(series[0].elbowAngleDeg).toBeLessThan(120);
    expect(series[1].elbowAngleDeg).toBeCloseTo(180, 0);
  });

  it("skips frames with no usable landmarks", () => {
    const series = buildOverheadpressSeries([topFrame(0), { tMs: 100, landmarks: null }, topFrame(200)]);
    expect(series.map((s) => s.tMs)).toEqual([0, 200]);
  });

  it("tolerates non-array input", () => {
    expect(buildOverheadpressSeries(undefined)).toEqual([]);
  });
});
