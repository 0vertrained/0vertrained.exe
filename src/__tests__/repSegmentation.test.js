import { describe, expect, it } from "vitest";
import {
  segmentReps,
  segmentBenchpressReps,
  segmentOverheadpressReps,
  segmentBentoverrowReps,
} from "../formCheck/repSegmentation";

// Build a synthetic elbow-angle series for `count` reps. Mirrors makeRepSeries
// but emits the `elbowAngleDeg` field the upper-body wrappers read. The series
// starts at a straight `top` angle, bends to `bottom`, and returns — the same
// high→low→high shape the movement-agnostic engine expects, so the contracted
// position (chest / rack / pulled-in) is the detected bottom.
function makeElbowSeries({ count = 1, top = 170, bottom = 80, stepMs = 100, phase = 5, lead = 2 } = {}) {
  const samples = [];
  let tMs = 0;
  const push = (deg) => {
    samples.push({ tMs, elbowAngleDeg: deg });
    tMs += stepMs;
  };
  for (let i = 0; i < lead; i += 1) push(top);
  for (let r = 0; r < count; r += 1) {
    for (let i = 1; i <= phase; i += 1) push(top + ((bottom - top) * i) / phase);
    for (let i = 1; i <= phase; i += 1) push(bottom + ((top - bottom) * i) / phase);
  }
  return samples;
}

// Build a synthetic knee-angle series for `count` reps. Each rep descends from a
// standing `top` angle to a `bottom` angle and back up, sampled every `stepMs`.
// `phase` controls how many samples each descent/ascent half uses.
function makeRepSeries({
  count = 1,
  top = 170,
  bottom = 80,
  stepMs = 100,
  phase = 5,
  lead = 2,
} = {}) {
  const samples = [];
  let tMs = 0;
  const push = (deg) => {
    samples.push({ tMs, kneeAngleDeg: deg });
    tMs += stepMs;
  };
  // A short standing lead-in so the series clearly starts "up".
  for (let i = 0; i < lead; i += 1) push(top);
  for (let r = 0; r < count; r += 1) {
    // Descent: top -> bottom (exclusive of top, which is the previous standing).
    for (let i = 1; i <= phase; i += 1) {
      push(top + ((bottom - top) * i) / phase);
    }
    // Ascent: bottom -> top.
    for (let i = 1; i <= phase; i += 1) {
      push(bottom + ((top - bottom) * i) / phase);
    }
  }
  return samples;
}

describe("segmentReps — guards", () => {
  it("returns no reps with a reason when there are too few samples", () => {
    const out = segmentReps([{ tMs: 0, kneeAngleDeg: 170 }, { tMs: 100, kneeAngleDeg: 90 }]);
    expect(out.repCount).toBe(0);
    expect(out.reps).toEqual([]);
    expect(out.confident).toBe(false);
    expect(out.reason).toBeTruthy();
  });

  it("returns no reps when the knee angle barely moves (noise, not squatting)", () => {
    const flat = Array.from({ length: 20 }, (_, i) => ({
      tMs: i * 100,
      kneeAngleDeg: 168 + (i % 2), // ~1° wiggle
    }));
    const out = segmentReps(flat);
    expect(out.repCount).toBe(0);
    expect(out.confident).toBe(false);
    expect(out.reason.toLowerCase()).toMatch(/movement|enough|reps/);
  });

  it("tolerates non-array / empty input without throwing", () => {
    expect(segmentReps(undefined).repCount).toBe(0);
    expect(segmentReps([]).repCount).toBe(0);
  });

  it("ignores samples with non-finite values", () => {
    const series = makeRepSeries({ count: 1 });
    series.splice(3, 0, { tMs: 250, kneeAngleDeg: NaN });
    const out = segmentReps(series);
    expect(out.repCount).toBe(1);
  });
});

describe("segmentReps — counting", () => {
  it("detects a single clean rep", () => {
    const out = segmentReps(makeRepSeries({ count: 1, top: 175, bottom: 75 }));
    expect(out.repCount).toBe(1);
    expect(out.reps).toHaveLength(1);
    const rep = out.reps[0];
    expect(rep.index).toBe(1);
    expect(rep.startMs).toBeLessThan(rep.bottomMs);
    expect(rep.bottomMs).toBeLessThan(rep.endMs);
    expect(rep.minKneeAngleDeg).toBeLessThan(100);
    expect(rep.tempoSec).toBeGreaterThan(0);
    expect(Array.isArray(rep.flags)).toBe(true);
  });

  it("detects three reps in a multi-rep clip", () => {
    const out = segmentReps(makeRepSeries({ count: 3, top: 172, bottom: 78 }));
    expect(out.repCount).toBe(3);
    expect(out.reps.map((r) => r.index)).toEqual([1, 2, 3]);
    expect(out.confident).toBe(true);
    expect(out.timelineSummary.toLowerCase()).toMatch(/3 rep/);
  });

  it("classifies a deep rep as at-or-below parallel", () => {
    const out = segmentReps(makeRepSeries({ count: 1, top: 175, bottom: 70 }));
    expect(out.reps[0].depthAssessment).toBe("at-or-below-parallel");
    expect(out.reps[0].flags).not.toContain("shallow");
  });

  it("flags a shallow rep that stays above parallel", () => {
    // Bottom ~135° never approaches parallel.
    const out = segmentReps(makeRepSeries({ count: 1, top: 175, bottom: 135 }));
    expect(out.repCount).toBe(1);
    expect(out.reps[0].depthAssessment).toBe("above-parallel");
    expect(out.reps[0].flags).toContain("shallow");
  });

  it("does not count an incomplete rep that never returns to standing", () => {
    const series = makeRepSeries({ count: 1, top: 175, bottom: 75 });
    // Drop the ascent tail so the athlete is left at the bottom.
    const truncated = series.slice(0, series.length - 4);
    const out = segmentReps(truncated);
    expect(out.repCount).toBe(0);
  });
});

describe("upper-body elbow-angle wrappers", () => {
  it("segments bench-press reps with the contracted (chest) elbow as the bottom", () => {
    const out = segmentBenchpressReps(makeElbowSeries({ count: 3, top: 172, bottom: 88 }));
    expect(out.repCount).toBe(3);
    const rep = out.reps[0];
    // The detected bottom is the bent-elbow chest position, not the lockout.
    expect(rep.minElbowAngleDeg).toBeLessThan(110);
    expect(rep.depthAssessment).toBe(rep.assessment);
    expect(rep.depthAssessment).not.toBe("unknown");
  });

  it("flags a shallow bench press whose elbow never really bends", () => {
    const out = segmentBenchpressReps(makeElbowSeries({ count: 1, top: 175, bottom: 140 }));
    expect(out.repCount).toBe(1);
    expect(out.reps[0].minElbowAngleDeg).toBeGreaterThan(125);
    expect(out.reps[0].flags).toContain("shallow");
  });

  it("segments overhead-press reps and reports the rack elbow as the bottom", () => {
    const out = segmentOverheadpressReps(makeElbowSeries({ count: 2, top: 172, bottom: 85 }));
    expect(out.repCount).toBe(2);
    expect(out.reps[0].minElbowAngleDeg).toBeLessThan(110);
    expect(out.reps[0].depthAssessment).not.toBe("unknown");
  });

  it("segments bent-over-row reps with the pulled-in elbow as the bottom", () => {
    const out = segmentBentoverrowReps(makeElbowSeries({ count: 3, top: 170, bottom: 70 }));
    expect(out.repCount).toBe(3);
    expect(out.reps[0].minElbowAngleDeg).toBeLessThan(100);
    expect(out.reps[0].depthAssessment).toBe("full-range");
  });

  it("tolerates empty / non-array input across wrappers", () => {
    expect(segmentBenchpressReps([]).repCount).toBe(0);
    expect(segmentOverheadpressReps(undefined).repCount).toBe(0);
    expect(segmentBentoverrowReps(null).repCount).toBe(0);
  });
});
