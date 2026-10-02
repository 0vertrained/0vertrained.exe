import { describe, expect, it } from "vitest";
import { analyzePushup, classifyPushupDepth } from "../formCheck/pushupAnalyzer";

describe("classifyPushupDepth", () => {
  it("labels a deep rep when the elbow bends well past a right angle", () => {
    expect(classifyPushupDepth(90)).toBe("deep");
  });

  it("labels a shallow rep when the elbow barely bends", () => {
    expect(classifyPushupDepth(150)).toBe("shallow");
  });

  it("returns unknown for missing input", () => {
    expect(classifyPushupDepth(null)).toBe("unknown");
  });
});

describe("analyzePushup", () => {
  it("returns a low-confidence retake result instead of cues", () => {
    const r = analyzePushup(
      { minElbowAngleDeg: 90, bodyLineDevDeg: 5 },
      { confidence: { level: "low", reasons: ["Body not clearly detected"] } },
    );
    expect(r.movement).toBe("pushup");
    expect(r.assessable).toBe(false);
    expect(r.cues).toEqual([]);
    expect(r.summary.toLowerCase()).toMatch(/retake|again|not enough|unable/);
  });

  it("gives a positive depth cue and carries a disclaimer", () => {
    const r = analyzePushup({ minElbowAngleDeg: 90, bodyLineDevDeg: 6 });
    expect(r.assessable).toBe(true);
    expect(r.depthAssessment).toBe("deep");
    expect(r.cues.length).toBeGreaterThan(0);
    const text = r.cues.map((c) => c.text).join(" ").toLowerCase();
    expect(text).toMatch(/appears|may|rough|seems|if/);
    expect(r.disclaimer.toLowerCase()).toMatch(/estimate|educational|not.*clinical|not.*medical/);
  });

  it("flags a shallow rep as a watch cue without commanding", () => {
    const r = analyzePushup({ minElbowAngleDeg: 150, bodyLineDevDeg: 5 });
    const depth = r.cues.find((c) => c.id === "depth");
    expect(depth).toBeTruthy();
    expect(depth.severity).toBe("watch");
    expect(depth.text.toLowerCase()).toMatch(/appears|may|consider|if/);
  });

  it("flags a sagging/piking body line conservatively", () => {
    const r = analyzePushup({ minElbowAngleDeg: 95, bodyLineDevDeg: 25 });
    const line = r.cues.find((c) => c.id === "body-line");
    expect(line).toBeTruthy();
    expect(line.severity).toBe("watch");
    expect(line.text.toLowerCase()).toMatch(/appears|may|hip|line|brace/);
  });
});
