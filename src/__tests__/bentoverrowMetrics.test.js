import { describe, expect, it } from "vitest";
import {
  BENTOVERROW_LANDMARKS,
  extractBentoverrowFrameMetrics,
  aggregateBentoverrowMetrics,
  buildBentoverrowSeries,
} from "../formCheck/bentoverrowMetrics";

const L = BENTOVERROW_LANDMARKS;

function makeLandmarks(overrides = {}, defaultVis = 0.95) {
  const arr = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: defaultVis }));
  for (const [idx, p] of Object.entries(overrides)) {
    arr[idx] = { x: 0, y: 0, z: 0, visibility: defaultVis, ...p };
  }
  return arr;
}

// Hinged torso, arms extended (bottom of the rep): elbow ~180.
function extendedFrame(tMs) {
  return {
    tMs,
    landmarks: makeLandmarks({
      [L.LEFT_SHOULDER]: { x: 0.4, y: 0.4 },
      [L.LEFT_HIP]: { x: 0.6, y: 0.5 },
      [L.LEFT_ELBOW]: { x: 0.45, y: 0.55 },
      [L.LEFT_WRIST]: { x: 0.5, y: 0.7 },
    }),
  };
}

// Hinged torso, elbow pulled back (top of the rep): elbow bent.
function pulledFrame(tMs) {
  return {
    tMs,
    landmarks: makeLandmarks({
      [L.LEFT_SHOULDER]: { x: 0.4, y: 0.4 },
      [L.LEFT_HIP]: { x: 0.6, y: 0.5 },
      [L.LEFT_ELBOW]: { x: 0.45, y: 0.55 },
      [L.LEFT_WRIST]: { x: 0.35, y: 0.5 },
    }),
  };
}

// Torso shifts noticeably more upright (hinge drift).
function uprightShiftFrame(tMs) {
  return {
    tMs,
    landmarks: makeLandmarks({
      [L.LEFT_SHOULDER]: { x: 0.45, y: 0.35 },
      [L.LEFT_HIP]: { x: 0.5, y: 0.6 },
      [L.LEFT_ELBOW]: { x: 0.45, y: 0.55 },
      [L.LEFT_WRIST]: { x: 0.4, y: 0.5 },
    }),
  };
}

describe("extractBentoverrowFrameMetrics", () => {
  it("reads a near-straight elbow when the arms hang extended", () => {
    const m = extractBentoverrowFrameMetrics(extendedFrame().landmarks);
    expect(m).toBeTruthy();
    expect(m.elbowAngleDeg).toBeGreaterThan(150);
    expect(Number.isFinite(m.torsoLeanDeg)).toBe(true);
  });

  it("reads a bent elbow at the top of the pull", () => {
    const m = extractBentoverrowFrameMetrics(pulledFrame().landmarks);
    expect(m).toBeTruthy();
    expect(m.elbowAngleDeg).toBeLessThan(110);
  });

  it("returns null when the arm joints are not visible enough", () => {
    const lm = makeLandmarks(
      {
        [L.LEFT_SHOULDER]: { x: 0.4, y: 0.4, visibility: 0.2 },
        [L.LEFT_ELBOW]: { x: 0.45, y: 0.55, visibility: 0.2 },
        [L.LEFT_WRIST]: { x: 0.5, y: 0.7, visibility: 0.2 },
        [L.RIGHT_SHOULDER]: { x: 0.4, y: 0.4, visibility: 0.2 },
        [L.RIGHT_ELBOW]: { x: 0.45, y: 0.55, visibility: 0.2 },
        [L.RIGHT_WRIST]: { x: 0.5, y: 0.7, visibility: 0.2 },
      },
      0.2,
    );
    expect(extractBentoverrowFrameMetrics(lm)).toBeNull();
  });

  it("returns null for malformed input", () => {
    expect(extractBentoverrowFrameMetrics(null)).toBeNull();
    expect(extractBentoverrowFrameMetrics([])).toBeNull();
  });
});

describe("aggregateBentoverrowMetrics", () => {
  it("captures pull depth (min elbow) and a small torso shift for a stable hinge", () => {
    const frames = [extendedFrame(0), pulledFrame(166), extendedFrame(332), pulledFrame(498)];
    const out = aggregateBentoverrowMetrics(frames);
    expect(out.framesAnalyzed).toBe(4);
    expect(out.framesWithLandmarks).toBe(4);
    expect(out.metrics.minElbowAngleDeg).toBeLessThan(110);
    expect(out.metrics.maxElbowAngleDeg).toBeGreaterThan(150);
    expect(out.metrics.torsoLeanDeg).toBeLessThan(15);
  });

  it("reports a larger torso shift when the hinge drifts", () => {
    const out = aggregateBentoverrowMetrics([extendedFrame(0), pulledFrame(166), uprightShiftFrame(332)]);
    expect(out.metrics.torsoLeanDeg).toBeGreaterThan(20);
  });

  it("yields null metrics for an empty clip", () => {
    const out = aggregateBentoverrowMetrics([]);
    expect(out.framesAnalyzed).toBe(0);
    expect(out.metrics.minElbowAngleDeg).toBeNull();
  });

  it("tolerates non-array input", () => {
    const out = aggregateBentoverrowMetrics(undefined);
    expect(out.framesAnalyzed).toBe(0);
    expect(out.metrics.minElbowAngleDeg).toBeNull();
  });
});

describe("buildBentoverrowSeries", () => {
  it("emits one {tMs, elbowAngleDeg} sample per detectable frame", () => {
    const series = buildBentoverrowSeries([extendedFrame(0), pulledFrame(166), extendedFrame(332)]);
    expect(series).toHaveLength(3);
    expect(series[0].elbowAngleDeg).toBeGreaterThan(150);
    expect(series[1].elbowAngleDeg).toBeLessThan(110);
  });

  it("skips frames with no usable landmarks", () => {
    const series = buildBentoverrowSeries([extendedFrame(0), { tMs: 100, landmarks: null }, extendedFrame(200)]);
    expect(series.map((s) => s.tMs)).toEqual([0, 200]);
  });

  it("tolerates non-array input", () => {
    expect(buildBentoverrowSeries(undefined)).toEqual([]);
  });
});
