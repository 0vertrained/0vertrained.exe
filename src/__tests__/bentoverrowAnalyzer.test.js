import { describe, expect, it } from "vitest";
import {
  analyzeBentoverrow,
  classifyRowPull,
  classifyRowHinge,
} from "../formCheck/bentoverrowAnalyzer";

describe("classifyRowPull", () => {
  it("labels a full pull range when the elbow bends well", () => {
    expect(classifyRowPull(80)).toBe("full-range");
  });

  it("labels a limited pull range when the elbow barely bends", () => {
    expect(classifyRowPull(150)).toBe("limited-range");
  });

  it("returns unknown for missing input", () => {
    expect(classifyRowPull(null)).toBe("unknown");
  });
});

describe("classifyRowHinge", () => {
  it("labels a stable hinge for a small torso shift", () => {
    expect(classifyRowHinge(5)).toBe("stable-hinge");
  });

  it("labels a drifting hinge for a large torso shift", () => {
    expect(classifyRowHinge(30)).toBe("drifting-hinge");
  });

  it("returns unknown for missing input", () => {
    expect(classifyRowHinge(null)).toBe("unknown");
  });
});

describe("analyzeBentoverrow", () => {
  it("returns a low-confidence retake result instead of cues", () => {
    const r = analyzeBentoverrow(
      { minElbowAngleDeg: 80, maxElbowAngleDeg: 170, torsoLeanDeg: 5 },
      { confidence: { level: "low", reasons: ["Body not clearly detected"] } },
    );
    expect(r.movement).toBe("bentoverrow");
    expect(r.assessable).toBe(false);
    expect(r.cues).toEqual([]);
    expect(r.summary.toLowerCase()).toMatch(/retake|again|not enough|unable/);
  });

  it("gives a positive pull + stable-hinge read and carries a disclaimer", () => {
    const r = analyzeBentoverrow({
      minElbowAngleDeg: 80,
      maxElbowAngleDeg: 170,
      elbowRangeDeg: 90,
      torsoLeanDeg: 5,
    });
    expect(r.assessable).toBe(true);
    expect(r.depthAssessment).toBe("full-range");
    expect(r.hingeAssessment).toBe("stable-hinge");
    expect(r.cues.length).toBeGreaterThan(0);
    const text = r.cues.map((c) => c.text).join(" ").toLowerCase();
    expect(text).toMatch(/appears|may|rough|seems|if/);
    expect(r.disclaimer.toLowerCase()).toMatch(/estimate|educational|not.*clinical|not.*medical/);
  });

  it("flags a limited pull as a watch cue without commanding", () => {
    const r = analyzeBentoverrow({
      minElbowAngleDeg: 150,
      maxElbowAngleDeg: 172,
      elbowRangeDeg: 22,
      torsoLeanDeg: 6,
    });
    const pull = r.cues.find((c) => c.id === "pull");
    expect(pull).toBeTruthy();
    expect(pull.severity).toBe("watch");
    expect(pull.text.toLowerCase()).toMatch(/appears|may|consider|if/);
  });

  it("notes a drifting torso conservatively", () => {
    const r = analyzeBentoverrow({
      minElbowAngleDeg: 85,
      maxElbowAngleDeg: 170,
      elbowRangeDeg: 85,
      torsoLeanDeg: 30,
    });
    expect(r.hingeAssessment).toBe("drifting-hinge");
    const hinge = r.cues.find((c) => c.id === "hinge");
    expect(hinge).toBeTruthy();
    expect(hinge.severity).toBe("watch");
    expect(hinge.text.toLowerCase()).toMatch(/appears|may|torso|shift|if/);
  });

  it("never claims barbell tracking", () => {
    const r = analyzeBentoverrow({
      minElbowAngleDeg: 80,
      maxElbowAngleDeg: 170,
      elbowRangeDeg: 90,
      torsoLeanDeg: 5,
    });
    expect(JSON.stringify(r).toLowerCase()).not.toMatch(/barbell/);
  });
});
