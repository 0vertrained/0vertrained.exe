import { describe, expect, it } from "vitest";
import {
  BENCHPRESS_LANDMARKS,
  extractBenchpressFrameMetrics,
  aggregateBenchpressMetrics,
  buildBenchpressSeries,
} from "../formCheck/benchpressMetrics";

const L = BENCHPRESS_LANDMARKS;

function makeLandmarks(overrides = {}, defaultVis = 0.95) {
  const arr = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: defaultVis }));
  for (const [idx, p] of Object.entries(overrides)) {
    arr[idx] = { x: 0, y: 0, z: 0, visibility: defaultVis, ...p };
  }
  return arr;
}

// Lockout: arm straight up (shoulder-elbow-wrist ~180). Shoulder/hip held fixed
// across frames so torso/shoulder drift stays ~0.
function topFrame(tMs) {
  return {
    tMs,
    landmarks: makeLandmarks({
      [L.LEFT_SHOULDER]: { x: 0.5, y: 0.5 },
      [L.LEFT_HIP]: { x: 0.3, y: 0.5 },
      [L.LEFT_ELBOW]: { x: 0.5, y: 0.35 },
      [L.LEFT_WRIST]: { x: 0.5, y: 0.2 },
    }),
  };
}

// Chest / bottom: bent elbow (~70-90) while shoulder + hip stay put. Wrist tracks
// roughly straight down from the lockout wrist (no horizontal drift).
function bottomFrame(tMs) {
  return {
    tMs,
    landmarks: makeLandmarks({
      [L.LEFT_SHOULDER]: { x: 0.5, y: 0.5 },
      [L.LEFT_HIP]: { x: 0.3, y: 0.5 },
      [L.LEFT_ELBOW]: { x: 0.35, y: 0.45 },
      [L.LEFT_WRIST]: { x: 0.5, y: 0.6 },
    }),
  };
}

describe("extractBenchpressFrameMetrics", () => {
  it("reads a near-straight elbow at lockout", () => {
    const m = extractBenchpressFrameMetrics(topFrame().landmarks);
    expect(m).toBeTruthy();
    expect(m.elbowAngleDeg).toBeCloseTo(180, 0);
    expect(Number.isFinite(m.wristX)).toBe(true);
    expect(Number.isFinite(m.wristY)).toBe(true);
  });

  it("reads a bent elbow at the chest", () => {
    const m = extractBenchpressFrameMetrics(bottomFrame().landmarks);
    expect(m).toBeTruthy();
    expect(m.elbowAngleDeg).toBeLessThan(110);
  });

  it("returns null when the arm joints are not visible enough", () => {
    const lm = makeLandmarks(
      {
        [L.LEFT_SHOULDER]: { x: 0.5, y: 0.5, visibility: 0.2 },
        [L.LEFT_ELBOW]: { x: 0.5, y: 0.35, visibility: 0.2 },
        [L.LEFT_WRIST]: { x: 0.5, y: 0.2, visibility: 0.2 },
        [L.RIGHT_SHOULDER]: { x: 0.5, y: 0.5, visibility: 0.2 },
        [L.RIGHT_ELBOW]: { x: 0.5, y: 0.35, visibility: 0.2 },
        [L.RIGHT_WRIST]: { x: 0.5, y: 0.2, visibility: 0.2 },
      },
      0.2,
    );
    expect(extractBenchpressFrameMetrics(lm)).toBeNull();
  });

  it("returns null for malformed input", () => {
    expect(extractBenchpressFrameMetrics(null)).toBeNull();
    expect(extractBenchpressFrameMetrics([])).toBeNull();
  });
});

describe("aggregateBenchpressMetrics", () => {
  it("captures elbow range and a small wrist-path deviation for a straight press", () => {
    const frames = [topFrame(0), bottomFrame(166), topFrame(332), bottomFrame(498)];
    const out = aggregateBenchpressMetrics(frames);
    expect(out.framesAnalyzed).toBe(4);
    expect(out.framesWithLandmarks).toBe(4);
    expect(out.metrics.minElbowAngleDeg).toBeLessThan(110);
    expect(out.metrics.maxElbowAngleDeg).toBeGreaterThan(160);
    expect(out.metrics.elbowRangeDeg).toBeGreaterThan(40);
    // Wrist tracks straight down -> low deviation from vertical.
    expect(out.metrics.wristPathDevDeg).toBeLessThan(20);
  });

  it("reports a larger wrist-path deviation when the wrist drifts horizontally", () => {
    const drift = {
      tMs: 166,
      landmarks: makeLandmarks({
        [L.LEFT_SHOULDER]: { x: 0.5, y: 0.5 },
        [L.LEFT_HIP]: { x: 0.3, y: 0.5 },
        [L.LEFT_ELBOW]: { x: 0.3, y: 0.45 },
        [L.LEFT_WRIST]: { x: 0.2, y: 0.55 },
      }),
    };
    const out = aggregateBenchpressMetrics([topFrame(0), drift, topFrame(332)]);
    expect(out.metrics.wristPathDevDeg).toBeGreaterThan(25);
  });

  it("counts undetected frames toward framesAnalyzed only", () => {
    const out = aggregateBenchpressMetrics([topFrame(0), { landmarks: null }, { landmarks: [] }]);
    expect(out.framesAnalyzed).toBe(3);
    expect(out.framesWithLandmarks).toBe(1);
  });

  it("yields null metrics for an empty clip", () => {
    const out = aggregateBenchpressMetrics([]);
    expect(out.framesAnalyzed).toBe(0);
    expect(out.metrics.minElbowAngleDeg).toBeNull();
    expect(out.metrics.maxElbowAngleDeg).toBeNull();
    expect(out.metrics.elbowRangeDeg).toBeNull();
  });

  it("tolerates non-array input", () => {
    const out = aggregateBenchpressMetrics(undefined);
    expect(out.framesAnalyzed).toBe(0);
    expect(out.metrics.minElbowAngleDeg).toBeNull();
  });
});

describe("buildBenchpressSeries", () => {
  it("emits one {tMs, elbowAngleDeg} sample per detectable frame", () => {
    const series = buildBenchpressSeries([topFrame(0), bottomFrame(166), topFrame(332)]);
    expect(series).toHaveLength(3);
    expect(series[0]).toHaveProperty("tMs", 0);
    expect(series[0].elbowAngleDeg).toBeCloseTo(180, 0);
    expect(series[1].elbowAngleDeg).toBeLessThan(110);
  });

  it("skips frames with no usable landmarks", () => {
    const series = buildBenchpressSeries([topFrame(0), { tMs: 100, landmarks: null }, topFrame(200)]);
    expect(series.map((s) => s.tMs)).toEqual([0, 200]);
  });

  it("tolerates non-array input", () => {
    expect(buildBenchpressSeries(undefined)).toEqual([]);
  });
});
