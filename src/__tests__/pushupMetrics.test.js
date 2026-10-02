import { describe, expect, it } from "vitest";
import {
  PUSHUP_LANDMARKS,
  extractPushupFrameMetrics,
  aggregatePushupMetrics,
  buildElbowSeries,
} from "../formCheck/pushupMetrics";

const L = PUSHUP_LANDMARKS;

function makeLandmarks(overrides = {}, defaultVis = 0.95) {
  const arr = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: defaultVis }));
  for (const [idx, p] of Object.entries(overrides)) {
    arr[idx] = { x: 0, y: 0, z: 0, visibility: defaultVis, ...p };
  }
  return arr;
}

// Top of a push-up: straight arm (shoulder-elbow-wrist ~180) and a straight
// body line (shoulder-hip-ankle ~180).
function topFrame(tMs) {
  return {
    tMs,
    landmarks: makeLandmarks({
      [L.LEFT_SHOULDER]: { x: 0.5, y: 0.4 },
      [L.LEFT_ELBOW]: { x: 0.5, y: 0.6 },
      [L.LEFT_WRIST]: { x: 0.5, y: 0.8 },
      [L.LEFT_HIP]: { x: 0.7, y: 0.4 },
      [L.LEFT_KNEE]: { x: 0.85, y: 0.4 },
      [L.LEFT_ANKLE]: { x: 0.9, y: 0.4 },
    }),
  };
}

// Bottom of a push-up: bent elbow (~90) while the body line stays straight.
function bottomFrame(tMs) {
  return {
    tMs,
    landmarks: makeLandmarks({
      [L.LEFT_SHOULDER]: { x: 0.5, y: 0.5 },
      [L.LEFT_ELBOW]: { x: 0.3, y: 0.5 },
      [L.LEFT_WRIST]: { x: 0.3, y: 0.8 },
      [L.LEFT_HIP]: { x: 0.7, y: 0.5 },
      [L.LEFT_KNEE]: { x: 0.85, y: 0.5 },
      [L.LEFT_ANKLE]: { x: 0.9, y: 0.5 },
    }),
  };
}

// Sagging hips: body line bends noticeably at the hip.
function sagFrame(tMs) {
  return {
    tMs,
    landmarks: makeLandmarks({
      [L.LEFT_SHOULDER]: { x: 0.5, y: 0.4 },
      [L.LEFT_ELBOW]: { x: 0.5, y: 0.6 },
      [L.LEFT_WRIST]: { x: 0.5, y: 0.8 },
      [L.LEFT_HIP]: { x: 0.7, y: 0.6 },
      [L.LEFT_KNEE]: { x: 0.85, y: 0.45 },
      [L.LEFT_ANKLE]: { x: 0.9, y: 0.4 },
    }),
  };
}

describe("extractPushupFrameMetrics", () => {
  it("reads a near-straight elbow and straight body line at the top", () => {
    const m = extractPushupFrameMetrics(topFrame().landmarks);
    expect(m).toBeTruthy();
    expect(m.elbowAngleDeg).toBeCloseTo(180, 0);
    expect(m.bodyLineDevDeg).toBeLessThan(10);
  });

  it("reads a bent elbow at the bottom", () => {
    const m = extractPushupFrameMetrics(bottomFrame().landmarks);
    expect(m).toBeTruthy();
    expect(m.elbowAngleDeg).toBeLessThan(120);
  });

  it("reads a larger body-line deviation when the hips sag", () => {
    const straight = extractPushupFrameMetrics(topFrame().landmarks);
    const sag = extractPushupFrameMetrics(sagFrame().landmarks);
    expect(sag.bodyLineDevDeg).toBeGreaterThan(straight.bodyLineDevDeg);
    expect(sag.bodyLineDevDeg).toBeGreaterThan(15);
  });

  it("returns null when the arm joints are not visible enough", () => {
    const lm = makeLandmarks(
      {
        [L.LEFT_SHOULDER]: { x: 0.5, y: 0.4, visibility: 0.2 },
        [L.LEFT_ELBOW]: { x: 0.5, y: 0.6, visibility: 0.2 },
        [L.LEFT_WRIST]: { x: 0.5, y: 0.8, visibility: 0.2 },
        [L.RIGHT_SHOULDER]: { x: 0.5, y: 0.4, visibility: 0.2 },
        [L.RIGHT_ELBOW]: { x: 0.5, y: 0.6, visibility: 0.2 },
        [L.RIGHT_WRIST]: { x: 0.5, y: 0.8, visibility: 0.2 },
      },
      0.2,
    );
    expect(extractPushupFrameMetrics(lm)).toBeNull();
  });

  it("returns null for malformed input", () => {
    expect(extractPushupFrameMetrics(null)).toBeNull();
    expect(extractPushupFrameMetrics([])).toBeNull();
  });
});

describe("aggregatePushupMetrics", () => {
  it("captures bottom depth (min elbow) and the worst body-line deviation", () => {
    const frames = [topFrame(0), bottomFrame(166), sagFrame(332), topFrame(498)];
    const out = aggregatePushupMetrics(frames);
    expect(out.framesAnalyzed).toBe(4);
    expect(out.framesWithLandmarks).toBe(4);
    expect(out.metrics.minElbowAngleDeg).toBeLessThan(120);
    expect(out.metrics.bodyLineDevDeg).toBeGreaterThan(15);
  });

  it("counts undetected frames toward framesAnalyzed only", () => {
    const out = aggregatePushupMetrics([topFrame(0), { landmarks: null }, { landmarks: [] }]);
    expect(out.framesAnalyzed).toBe(3);
    expect(out.framesWithLandmarks).toBe(1);
  });

  it("yields null metrics for an empty clip", () => {
    const out = aggregatePushupMetrics([]);
    expect(out.framesAnalyzed).toBe(0);
    expect(out.metrics.minElbowAngleDeg).toBeNull();
    expect(out.metrics.bodyLineDevDeg).toBeNull();
  });

  it("tolerates non-array input", () => {
    const out = aggregatePushupMetrics(undefined);
    expect(out.framesAnalyzed).toBe(0);
    expect(out.metrics.minElbowAngleDeg).toBeNull();
  });
});

describe("buildElbowSeries", () => {
  it("emits one {tMs, elbowAngleDeg} sample per detectable frame", () => {
    const series = buildElbowSeries([topFrame(0), bottomFrame(166), topFrame(332)]);
    expect(series).toHaveLength(3);
    expect(series[0]).toHaveProperty("tMs", 0);
    expect(series[0].elbowAngleDeg).toBeCloseTo(180, 0);
    expect(series[1].elbowAngleDeg).toBeLessThan(120);
  });

  it("skips frames with no usable landmarks", () => {
    const series = buildElbowSeries([topFrame(0), { tMs: 100, landmarks: null }, topFrame(200)]);
    expect(series.map((s) => s.tMs)).toEqual([0, 200]);
  });

  it("tolerates non-array input", () => {
    expect(buildElbowSeries(undefined)).toEqual([]);
  });
});
