import { describe, expect, it } from "vitest";
import { analyzeOverheadpress, classifyOverheadDepth } from "../formCheck/overheadpressAnalyzer";

describe("classifyOverheadDepth", () => {
  it("labels a full range when the elbow bends well at the rack", () => {
    expect(classifyOverheadDepth(90)).toBe("full-range");
  });

  it("labels a limited range when the elbow barely bends", () => {
    expect(classifyOverheadDepth(150)).toBe("limited-range");
  });

  it("returns unknown for missing input", () => {
    expect(classifyOverheadDepth(null)).toBe("unknown");
  });
});

describe("analyzeOverheadpress", () => {
  it("returns a low-confidence retake result instead of cues", () => {
    const r = analyzeOverheadpress(
      { minElbowAngleDeg: 90, maxElbowAngleDeg: 175, elbowRangeDeg: 85 },
      { confidence: { level: "low", reasons: ["Body not clearly detected"] } },
    );
    expect(r.movement).toBe("overheadpress");
    expect(r.assessable).toBe(false);
    expect(r.cues).toEqual([]);
    expect(r.summary.toLowerCase()).toMatch(/retake|again|not enough|unable/);
  });

  it("gives depth + lockout reads and carries a disclaimer", () => {
    const r = analyzeOverheadpress({
      minElbowAngleDeg: 90,
      maxElbowAngleDeg: 172,
      elbowRangeDeg: 82,
      forwardLeanDeg: 8,
    });
    expect(r.assessable).toBe(true);
    expect(r.depthAssessment).toBe("full-range");
    expect(r.cues.length).toBeGreaterThan(0);
    const text = r.cues.map((c) => c.text).join(" ").toLowerCase();
    expect(text).toMatch(/appears|may|rough|seems|if/);
    expect(r.disclaimer.toLowerCase()).toMatch(/estimate|educational|not.*clinical|not.*medical/);
  });

  it("flags a limited lockout as a watch cue", () => {
    const r = analyzeOverheadpress({
      minElbowAngleDeg: 95,
      maxElbowAngleDeg: 140,
      elbowRangeDeg: 45,
      forwardLeanDeg: 6,
    });
    const lockout = r.cues.find((c) => c.id === "lockout");
    expect(lockout).toBeTruthy();
    expect(lockout.severity).toBe("watch");
    expect(lockout.text.toLowerCase()).toMatch(/appears|may|consider|if/);
  });

  it("notes a large forward lean conservatively", () => {
    const r = analyzeOverheadpress({
      minElbowAngleDeg: 95,
      maxElbowAngleDeg: 172,
      elbowRangeDeg: 77,
      forwardLeanDeg: 25,
    });
    const lean = r.cues.find((c) => c.id === "lean");
    expect(lean).toBeTruthy();
    expect(lean.severity).toBe("watch");
    expect(lean.text.toLowerCase()).toMatch(/appears|may|lean|if/);
  });

  it("never claims barbell tracking", () => {
    const r = analyzeOverheadpress({
      minElbowAngleDeg: 90,
      maxElbowAngleDeg: 172,
      elbowRangeDeg: 82,
      forwardLeanDeg: 6,
    });
    expect(JSON.stringify(r).toLowerCase()).not.toMatch(/barbell/);
  });
});
