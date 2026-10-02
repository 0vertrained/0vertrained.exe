// V1.8 — Personalized Coach Layer tests (pure helper).
import { describe, expect, it } from "vitest";
import { buildPersonalizedCoachContext, normalizeRecoveryLevel } from "../formCheck/personalizedCoach";

describe("normalizeRecoveryLevel", () => {
  it("maps recovery-score colors to levels", () => {
    expect(normalizeRecoveryLevel("good")).toBe("high");
    expect(normalizeRecoveryLevel("warn")).toBe("moderate");
    expect(normalizeRecoveryLevel("low")).toBe("low");
  });
  it("returns null for unknown/empty", () => {
    expect(normalizeRecoveryLevel("")).toBeNull();
    expect(normalizeRecoveryLevel(null)).toBeNull();
    expect(normalizeRecoveryLevel("banana")).toBeNull();
  });
});

describe("buildPersonalizedCoachContext", () => {
  it("returns unavailable when nothing to say", () => {
    const ctx = buildPersonalizedCoachContext({});
    expect(ctx.available).toBe(false);
    expect(ctx.notes).toEqual([]);
    expect(ctx.cameraTip).toBeNull();
  });

  it("low recovery frames a technique focus and avoids max-effort language", () => {
    const ctx = buildPersonalizedCoachContext({ recovery: "low", movementLabel: "Squat" });
    expect(ctx.available).toBe(true);
    expect(ctx.emphasis).toBe("technique");
    expect(ctx.headline).toBe("Today: technique focus");
    const joined = ctx.notes.join(" ").toLowerCase();
    expect(joined).toContain("technique");
    expect(joined).not.toContain("max-effort test — go");
  });

  it("strength emphasis prioritizes consistency/bracing/depth", () => {
    const ctx = buildPersonalizedCoachContext({ strengthEmphasis: true });
    expect(ctx.emphasis).toBe("consistency");
    expect(ctx.notes.join(" ").toLowerCase()).toMatch(/depth|bracing|consistent/);
  });

  it("recurring focus produces a same-camera-angle tip", () => {
    const ctx = buildPersonalizedCoachContext({
      recurringFocus: { label: "knee depth", count: 3 },
      movementLabel: "Squat",
    });
    expect(ctx.cameraTip).toMatch(/same angle/i);
    expect(ctx.cameraTip).toContain("knee depth");
  });

  it("does not surface a camera tip for a one-off focus", () => {
    const ctx = buildPersonalizedCoachContext({ recurringFocus: { label: "knee depth", count: 1 } });
    expect(ctx.cameraTip).toBeNull();
  });

  it("adds positive reinforcement for a strong best score", () => {
    const ctx = buildPersonalizedCoachContext({ bestRecentScore: 90, movementLabel: "Bench Press" });
    expect(ctx.notes.join(" ")).toContain("90");
  });

  it("makes no medical/diagnostic claims", () => {
    const ctx = buildPersonalizedCoachContext({ recovery: "low", strengthEmphasis: true, goal: "strength" });
    const text = [ctx.headline, ...ctx.notes, ctx.cameraTip].filter(Boolean).join(" ").toLowerCase();
    expect(text).not.toMatch(/injur|diagnos|medical|pain|disease/);
  });
});
