import { describe, expect, it } from "vitest";
import { calcRecoveryScore, resolveRecovery } from "../recovery";

describe("calcRecoveryScore — old data compatibility", () => {
  it("scores old data (without new manual fields) identically to before", () => {
    const day = { body: { sleep: 8, soreness: 3, energy: 8 } };
    const out = calcRecoveryScore(day, {});
    // No new manual fields → modifiers should be 0 → score should equal baseScore
    expect(out.score).toBe(out.baseScore);
    expect(out.modifiers).toEqual({});
  });

  it("does NOT apply modifiers when new fields are absent", () => {
    const day = { body: { sleep: 7, energy: 7, soreness: 4 } };
    const out = calcRecoveryScore(day, {});
    // Old shape only → no modifiers applied
    expect(out.baseScore).toBeGreaterThanOrEqual(60);
    expect(out.score).toBe(out.baseScore);
  });
});

describe("calcRecoveryScore — missing data handling", () => {
  it("scores from recovery state only (sleep/soreness/energy), training load excluded", () => {
    const day = { body: { sleep: 8, soreness: 3, energy: 8 } };
    const out = calcRecoveryScore(day, {});
    // V4 calibration: sleep 45 + soreness ~26.9 (concave curve) + energy ~19.4 ≈ 91
    // (no volume/cardio terms). Soreness 3 is normal training — minimal penalty.
    expect(out.score).toBeGreaterThanOrEqual(88);
    expect(out.score).toBeLessThanOrEqual(93);
    expect(out.confidence).toBe("high");
    expect(out.missing).toHaveLength(0);
    expect(out.components.volume).toBeUndefined();
    expect(out.components.cardio).toBeUndefined();
  });

  it("does NOT tank the score when sleep is missing (renormalizes instead of scoring 0/30)", () => {
    const day = { body: { soreness: 3, energy: 8 } }; // no sleep logged, no history
    const out = calcRecoveryScore(day, {});
    // Old behavior scored sleep 0/30 -> ~53. Renormalized should land far higher.
    expect(out.score).toBeGreaterThanOrEqual(70);
    expect(out.confidence).toBe("medium");
    expect(out.missing).toContain("sleep");
    expect(out.components.sleep.value).toBe("not logged");
  });

  it("reports low confidence when no subjective inputs are present", () => {
    const day = { workout: { exercises: { Squat: { sets: [{ weight: 200, reps: 5, done: true }] } } } };
    const out = calcRecoveryScore(day, {});
    expect(out.confidence).toBe("low");
  });
});

describe("calcRecoveryScore — sleep window anchoring", () => {
  it("anchors the 7-day sleep average to the scored day, not to today", () => {
    // Three consecutive days of sleep ending at D; today (far in the future of D)
    // has unrelated sleep. A today-anchored window would miss these past nights.
    const data = {
      "2026-03-13": { body: { sleep: 6, soreness: 4, energy: 6 } },
      "2026-03-14": { body: { sleep: 7, soreness: 4, energy: 6 } },
      "2026-03-15": { body: { sleep: 8, soreness: 4, energy: 6 } },
    };
    const out = calcRecoveryScore(data["2026-03-15"], data, "2026-03-15");
    // V4 calibration: 60% acute (8) + 40% 7d avg ([8,7,6]=7.0) = 7.6hrs blended.
    // Window is anchored to the scored day — a today-anchored window would miss
    // these past nights entirely.
    expect(out.components.sleep.value).toContain("7.6hrs");
    expect(out.components.sleep.value).toContain("60% acute");
  });

  it("falls back to the day's own night when there isn't enough history to average", () => {
    const data = { "2026-01-10": { body: { sleep: 5, soreness: 5, energy: 5 } } };
    const out = calcRecoveryScore(data["2026-01-10"], data, "2026-01-10");
    expect(out.components.sleep.value).toBe("5hrs");
  });
});

describe("resolveRecovery — source selection", () => {
  it("prefers the Oura biometric score when available", () => {
    const out = resolveRecovery({ subjective: { score: 50, source: "subjective" }, ouraScore: 82 });
    expect(out.score).toBe(82);
    expect(out.source).toBe("oura");
  });

  it("falls back to the subjective score when no Oura score is present", () => {
    const out = resolveRecovery({ subjective: { score: 64, source: "subjective" }, ouraScore: null });
    expect(out.score).toBe(64);
    expect(out.source).toBe("subjective");
  });

  it("returns null when neither source is available", () => {
    expect(resolveRecovery({})).toBeNull();
  });
});
