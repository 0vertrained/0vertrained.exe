import { describe, expect, it } from "vitest";
import { analyzeDeadlift, classifyHinge } from "../formCheck/deadliftAnalyzer";

describe("classifyHinge", () => {
  it("labels a clear hinge for a sharp bottom hip angle", () => {
    expect(classifyHinge(95)).toBe("clear-hinge");
  });

  it("labels a minimal hinge when the hip barely closes", () => {
    expect(classifyHinge(170)).toBe("minimal-hinge");
  });

  it("returns unknown for missing input", () => {
    expect(classifyHinge(null)).toBe("unknown");
    expect(classifyHinge(undefined)).toBe("unknown");
  });
});

describe("analyzeDeadlift", () => {
  it("returns a low-confidence retake result instead of cues", () => {
    const r = analyzeDeadlift(
      { minHipAngleDeg: 95, maxHipAngleDeg: 175 },
      { confidence: { level: "low", reasons: ["Body not clearly detected"] } },
    );
    expect(r.movement).toBe("deadlift");
    expect(r.assessable).toBe(false);
    expect(r.cues).toEqual([]);
    expect(r.summary.toLowerCase()).toMatch(/retake|again|not enough|unable/);
  });

  it("gives a tall-lockout info cue and a hinge note conservatively", () => {
    const r = analyzeDeadlift({
      minHipAngleDeg: 100,
      maxHipAngleDeg: 172,
      hipRangeDeg: 72,
      torsoLeanAtBottomDeg: 55,
    });
    expect(r.assessable).toBe(true);
    expect(Array.isArray(r.cues)).toBe(true);
    expect(r.cues.length).toBeGreaterThan(0);
    // Conservative, hedged language — never absolute commands.
    const text = r.cues.map((c) => c.text).join(" ").toLowerCase();
    expect(text).toMatch(/appears|may|rough|seems|if/);
    // Always carries an educational, non-clinical disclaimer.
    expect(r.disclaimer.toLowerCase()).toMatch(/estimate|educational|not.*clinical|not.*medical/);
  });

  it("flags an incomplete lockout as a watch cue", () => {
    const r = analyzeDeadlift({
      minHipAngleDeg: 105,
      maxHipAngleDeg: 140,
      hipRangeDeg: 35,
      torsoLeanAtBottomDeg: 50,
    });
    const lockout = r.cues.find((c) => c.id === "lockout");
    expect(lockout).toBeTruthy();
    expect(lockout.severity).toBe("watch");
    expect(lockout.text.toLowerCase()).toMatch(/appears|may|consider|if/);
  });

  it("does not claim bar-path precision anywhere in its output", () => {
    const r = analyzeDeadlift({
      minHipAngleDeg: 100,
      maxHipAngleDeg: 172,
      hipRangeDeg: 72,
      torsoLeanAtBottomDeg: 55,
    });
    const blob = JSON.stringify(r).toLowerCase();
    expect(blob).not.toMatch(/bar path|bar-path|barbell/);
  });

  it("explains that it cannot assess a hinge when none is detected", () => {
    const r = analyzeDeadlift({
      minHipAngleDeg: 172,
      maxHipAngleDeg: 178,
      hipRangeDeg: 6,
      torsoLeanAtBottomDeg: 5,
    });
    expect(r.assessable).toBe(true);
    expect(r.hingeAssessment).toBe("minimal-hinge");
    const text = r.cues.map((c) => c.text).join(" ").toLowerCase();
    expect(text).toMatch(/couldn'?t|could not|unable|didn'?t|did not|not.*detect|hard to/);
  });
});
