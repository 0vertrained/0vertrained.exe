import { describe, expect, it } from "vitest";
import { analyzeBenchpress, classifyBenchDepth } from "../formCheck/benchpressAnalyzer";

describe("classifyBenchDepth", () => {
  it("labels a full range when the elbow bends to roughly a right angle at the chest", () => {
    expect(classifyBenchDepth(90)).toBe("full-range");
  });

  it("labels a limited range when the elbow barely bends", () => {
    expect(classifyBenchDepth(150)).toBe("limited-range");
  });

  it("returns unknown for missing input", () => {
    expect(classifyBenchDepth(null)).toBe("unknown");
    expect(classifyBenchDepth(undefined)).toBe("unknown");
  });
});

describe("analyzeBenchpress", () => {
  it("returns a low-confidence retake result instead of cues", () => {
    const r = analyzeBenchpress(
      { minElbowAngleDeg: 90, maxElbowAngleDeg: 175, elbowRangeDeg: 85 },
      { confidence: { level: "low", reasons: ["Body not clearly detected"] } },
    );
    expect(r.movement).toBe("benchpress");
    expect(r.assessable).toBe(false);
    expect(r.cues).toEqual([]);
    expect(r.summary.toLowerCase()).toMatch(/retake|again|not enough|unable/);
  });

  it("gives a positive depth + lockout read and carries a disclaimer", () => {
    const r = analyzeBenchpress({
      minElbowAngleDeg: 90,
      maxElbowAngleDeg: 172,
      elbowRangeDeg: 82,
      wristPathDevDeg: 6,
      shoulderShiftDeg: 4,
    });
    expect(r.assessable).toBe(true);
    expect(r.depthAssessment).toBe("full-range");
    expect(r.cues.length).toBeGreaterThan(0);
    const text = r.cues.map((c) => c.text).join(" ").toLowerCase();
    expect(text).toMatch(/appears|may|rough|seems|if/);
    expect(r.disclaimer.toLowerCase()).toMatch(/estimate|educational|not.*clinical|not.*medical/);
  });

  it("never claims barbell or precise bar-path tracking", () => {
    const r = analyzeBenchpress({
      minElbowAngleDeg: 90,
      maxElbowAngleDeg: 172,
      elbowRangeDeg: 82,
      wristPathDevDeg: 30,
      shoulderShiftDeg: 4,
    });
    const blob = JSON.stringify(r).toLowerCase();
    expect(blob).not.toMatch(/barbell/);
    // A wrist-path note is allowed, but it must be hedged as a rough proxy.
    const wrist = r.cues.find((c) => c.id === "wrist-path");
    if (wrist) expect(wrist.text.toLowerCase()).toMatch(/appears|rough|proxy|estimate|may/);
  });

  it("flags a shallow press as a watch cue without commanding", () => {
    const r = analyzeBenchpress({
      minElbowAngleDeg: 150,
      maxElbowAngleDeg: 175,
      elbowRangeDeg: 25,
      wristPathDevDeg: 5,
    });
    const depth = r.cues.find((c) => c.id === "depth");
    expect(depth).toBeTruthy();
    expect(depth.severity).toBe("watch");
    expect(depth.text.toLowerCase()).toMatch(/appears|may|consider|if/);
  });

  it("notes a drifting wrist path conservatively", () => {
    const r = analyzeBenchpress({
      minElbowAngleDeg: 95,
      maxElbowAngleDeg: 172,
      elbowRangeDeg: 77,
      wristPathDevDeg: 30,
    });
    const wrist = r.cues.find((c) => c.id === "wrist-path");
    expect(wrist).toBeTruthy();
    expect(wrist.severity).toBe("watch");
  });
});
