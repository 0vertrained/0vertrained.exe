import { describe, expect, it } from "vitest";
import { trackBarPath } from "../formCheck/barPathTracker";

// Build a vertical-ish trajectory of {tMs, x, y} points. Image coords: y grows
// downward, x rightward. All values normalized [0,1] like MediaPipe landmarks.
function vertical(x = 0.5, n = 11) {
  const pts = [];
  for (let i = 0; i < n; i += 1) pts.push({ tMs: i * 100, x, y: 0.2 + (i * 0.4) / (n - 1) });
  return pts;
}

describe("trackBarPath", () => {
  it("returns an unknown result for too few usable points", () => {
    const empty = trackBarPath([]);
    expect(empty.deviationPattern).toBe("unknown");
    expect(empty.straightness).toBeNull();
    expect(empty.pathPoints).toEqual([]);

    const one = trackBarPath([{ tMs: 0, x: 0.5, y: 0.5 }]);
    expect(one.deviationPattern).toBe("unknown");
    expect(one.straightness).toBeNull();
  });

  it("tolerates non-array input", () => {
    const r = trackBarPath(undefined);
    expect(r.deviationPattern).toBe("unknown");
    expect(r.pathPoints).toEqual([]);
  });

  it("scores a perfectly vertical path as straight with high straightness", () => {
    const r = trackBarPath(vertical(0.5, 11));
    expect(r.deviationPattern).toBe("straight");
    expect(r.straightness).toBeGreaterThan(0.9);
    expect(r.pathPoints).toHaveLength(11);
    expect(r.maxDeviationMm).toBeCloseTo(0, 5);
    expect(r.directDistanceMm).toBeGreaterThan(0);
    expect(r.pathLengthMm).toBeGreaterThan(0);
  });

  it("flags a one-directional forward drift (bulge toward +x)", () => {
    const r = trackBarPath([
      { tMs: 0, x: 0.5, y: 0.2 },
      { tMs: 100, x: 0.6, y: 0.4 },
      { tMs: 200, x: 0.5, y: 0.6 },
    ]);
    expect(r.deviationPattern).toBe("forward-drift");
    expect(r.straightness).toBeLessThan(0.9);
    expect(r.maxDeviationMm).toBeGreaterThan(0);
  });

  it("flags a one-directional backward drift (bulge toward -x)", () => {
    const r = trackBarPath([
      { tMs: 0, x: 0.5, y: 0.2 },
      { tMs: 100, x: 0.4, y: 0.4 },
      { tMs: 200, x: 0.5, y: 0.6 },
    ]);
    expect(r.deviationPattern).toBe("backward-drift");
  });

  it("flags inconsistent swings to both sides", () => {
    const r = trackBarPath([
      { tMs: 0, x: 0.5, y: 0.2 },
      { tMs: 100, x: 0.62, y: 0.35 },
      { tMs: 200, x: 0.38, y: 0.5 },
      { tMs: 300, x: 0.5, y: 0.65 },
    ]);
    expect(r.deviationPattern).toBe("inconsistent");
    expect(r.straightness).toBeLessThan(0.9);
  });

  it("ignores non-finite points but keeps the rest", () => {
    const r = trackBarPath([
      { tMs: 0, x: 0.5, y: 0.2 },
      { tMs: 100, x: Number.NaN, y: 0.4 },
      { tMs: 200, x: 0.5, y: 0.6 },
    ]);
    expect(r.pathPoints).toHaveLength(2);
  });

  it("never reports a path length shorter than the direct start→end distance", () => {
    const r = trackBarPath([
      { tMs: 0, x: 0.5, y: 0.2 },
      { tMs: 100, x: 0.6, y: 0.4 },
      { tMs: 200, x: 0.5, y: 0.6 },
    ]);
    expect(r.pathLengthMm).toBeGreaterThanOrEqual(r.directDistanceMm - 1e-6);
  });

  it("clamps straightness to [0,1]", () => {
    const r = trackBarPath([
      { tMs: 0, x: 0.5, y: 0.5 },
      { tMs: 100, x: 0.9, y: 0.5 },
      { tMs: 200, x: 0.1, y: 0.5 },
      { tMs: 300, x: 0.5, y: 0.5 },
    ]);
    expect(r.straightness).toBeGreaterThanOrEqual(0);
    expect(r.straightness).toBeLessThanOrEqual(1);
  });
});
