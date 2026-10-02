import { describe, expect, it } from "vitest";
import {
  parseManualRecovery,
  summarizeManualRecovery,
  getManualRecoveryCompleteness,
  calcRecoveryModifiers,
} from "../manualRecovery";

describe("parseManualRecovery", () => {
  it("parses all valid recovery fields", () => {
    const body = {
      sleep: 7.5,
      sleepQuality: 8,
      restingHeartRate: 58,
      hrv: 42,
      energy: 7,
      soreness: 3,
      stress: 4,
      motivation: 8,
      weight: 184.5,
      illnessOrInjury: true,
    };
    const out = parseManualRecovery(body);
    expect(out.sleep).toBe(7.5);
    expect(out.sleepQuality).toBe(8);
    expect(out.restingHeartRate).toBe(58);
    expect(out.hrv).toBe(42);
    expect(out.energy).toBe(7);
    expect(out.soreness).toBe(3);
    expect(out.stress).toBe(4);
    expect(out.motivation).toBe(8);
    expect(out.weight).toBe(184.5);
    expect(out.illnessOrInjury).toBe(true);
    expect(out.present).toHaveLength(10);
    expect(out.missing).toHaveLength(0);
  });

  it("handles empty/missing body object", () => {
    const out = parseManualRecovery({});
    expect(out.sleep).toBeNull();
    expect(out.energy).toBeNull();
    expect(out.missing.length).toBeGreaterThan(0);
  });

  it("handles string-parsed numbers", () => {
    const body = { sleep: "7.5", energy: "7", soreness: "3" };
    const out = parseManualRecovery(body);
    expect(out.sleep).toBe(7.5);
    expect(out.energy).toBe(7);
    expect(out.soreness).toBe(3);
  });

  it("rejects invalid number strings", () => {
    const body = { sleep: "invalid", energy: "abc" };
    const out = parseManualRecovery(body);
    expect(out.sleep).toBeNull();
    expect(out.energy).toBeNull();
  });

  it("clamps subjective fields to [1, 10] range", () => {
    const body = {
      energy: 15,
      soreness: 0,
      stress: 11,
      motivation: -5,
      sleepQuality: 100,
    };
    const out = parseManualRecovery(body);
    expect(out.energy).toBe(10);
    expect(out.soreness).toBe(1);
    expect(out.stress).toBe(10);
    expect(out.motivation).toBe(1);
    expect(out.sleepQuality).toBe(10);
  });

  it("does not clamp non-subjective fields", () => {
    const body = { sleep: 12, restingHeartRate: 200, hrv: 999, weight: 999 };
    const out = parseManualRecovery(body);
    expect(out.sleep).toBe(12);
    expect(out.restingHeartRate).toBe(200);
    expect(out.hrv).toBe(999);
    expect(out.weight).toBe(999);
  });

  it("tracks present vs missing fields", () => {
    const body = { sleep: 7, energy: 8 };
    const out = parseManualRecovery(body);
    expect(out.present).toContain("sleep");
    expect(out.present).toContain("energy");
    expect(out.missing).toContain("soreness");
    expect(out.missing).toContain("sleepQuality");
  });
});

describe("summarizeManualRecovery", () => {
  it("builds a compact summary string from present fields", () => {
    const body = {
      sleep: 7.2,
      sleepQuality: 8,
      restingHeartRate: 58,
      hrv: 42,
      stress: 4,
      motivation: 8,
    };
    const summary = summarizeManualRecovery(body);
    expect(summary).toContain("Sleep 7.2h");
    expect(summary).toContain("Quality 8/10");
    expect(summary).toContain("RHR 58");
    expect(summary).toContain("HRV 42");
    expect(summary).toContain("Stress 4/10");
    expect(summary).toContain("Motivation 8/10");
  });

  it("omits missing fields from the summary", () => {
    const body = { sleep: 7.5, energy: 7 };
    const summary = summarizeManualRecovery(body);
    expect(summary).toContain("Sleep 7.5h");
    expect(summary).not.toContain("Quality");
    expect(summary).not.toContain("HRV");
  });

  it("returns empty string when no fields are present", () => {
    const summary = summarizeManualRecovery({});
    expect(summary).toBe("");
  });
});

describe("getManualRecoveryCompleteness", () => {
  it("calculates completeness ratio", () => {
    const body = {
      sleep: 7,
      energy: 8,
      soreness: 3,
      sleepQuality: 8,
      illnessOrInjury: true,
    };
    const out = getManualRecoveryCompleteness(body);
    expect(out.filled).toBe(5);
    expect(out.total).toBe(9);
    expect(out.ratio).toBeCloseTo(5 / 9);
  });

  it("returns 0 for empty body", () => {
    const out = getManualRecoveryCompleteness({});
    expect(out.filled).toBe(0);
    expect(out.total).toBe(9);
    expect(out.ratio).toBe(0);
  });

  it("returns 1 for fully filled body", () => {
    const body = {
      sleep: 7,
      sleepQuality: 8,
      energy: 8,
      soreness: 3,
      stress: 4,
      motivation: 8,
      restingHeartRate: 58,
      hrv: 42,
      illnessOrInjury: false,
    };
    const out = getManualRecoveryCompleteness(body);
    expect(out.filled).toBe(9);
    expect(out.ratio).toBe(1);
  });

  it("counts illness/injury flag as manual recovery context when explicitly set", () => {
    const out = getManualRecoveryCompleteness({ illnessOrInjury: true });
    expect(out.filled).toBe(1);
    expect(out.total).toBe(9);
    expect(out.ratio).toBeCloseTo(1 / 9);
  });

  it("excludes weight from completeness count", () => {
    const body = { weight: 184.5 };
    const out = getManualRecoveryCompleteness(body);
    expect(out.filled).toBe(0); // weight doesn't count
  });
});

describe("calcRecoveryModifiers", () => {
  it("returns zero modifier when no new fields present", () => {
    const body = { sleep: 7, energy: 8, soreness: 3 };
    const out = calcRecoveryModifiers(body);
    expect(out.modifierDelta).toBe(0);
    expect(Object.keys(out.components).length).toBe(0);
  });

  it("increases score with high sleep quality", () => {
    const body = { sleepQuality: 10 };
    const out = calcRecoveryModifiers(body);
    expect(out.modifierDelta).toBeGreaterThan(0);
    expect(out.components.sleepQuality.delta).toBeGreaterThan(0);
  });

  it("decreases score with low sleep quality", () => {
    const body = { sleepQuality: 1 };
    const out = calcRecoveryModifiers(body);
    expect(out.modifierDelta).toBeLessThan(0);
    expect(out.components.sleepQuality.delta).toBeLessThan(0);
  });

  it("decreases score with high stress", () => {
    const body = { stress: 10 };
    const out = calcRecoveryModifiers(body);
    expect(out.modifierDelta).toBeLessThan(0);
    expect(out.components.stress.delta).toBeLessThan(0);
  });

  it("increases score with low stress", () => {
    const body = { stress: 1 };
    const out = calcRecoveryModifiers(body);
    expect(out.modifierDelta).toBeGreaterThan(0);
  });

  it("increases score with high motivation", () => {
    const body = { motivation: 10 };
    const out = calcRecoveryModifiers(body);
    expect(out.modifierDelta).toBeGreaterThan(0);
    expect(out.components.motivation.delta).toBeGreaterThan(0);
  });

  it("caps total modifier at +/- 8", () => {
    const body = {
      sleepQuality: 10,
      stress: 1,
      motivation: 10,
    };
    const out = calcRecoveryModifiers(body);
    expect(Math.abs(out.modifierDelta)).toBeLessThanOrEqual(8);
  });

  it("handles mixed positive/negative modifiers", () => {
    const body = {
      sleepQuality: 9, // positive
      stress: 8, // negative
      motivation: 5, // neutral
    };
    const out = calcRecoveryModifiers(body);
    expect(out.components.sleepQuality.delta).toBeGreaterThan(0);
    expect(out.components.stress.delta).toBeLessThan(0);
    expect(out.components.motivation.delta).toBeLessThanOrEqual(0);
  });

  it("does not include HRV/RHR in modifiers (context only)", () => {
    const body = {
      restingHeartRate: 58,
      hrv: 42,
    };
    const out = calcRecoveryModifiers(body);
    expect(out.modifierDelta).toBe(0);
    expect(out.components.restingHeartRate).toBeUndefined();
    expect(out.components.hrv).toBeUndefined();
  });

  it("applies a strong caution modifier when illness/injury is flagged", () => {
    const out = calcRecoveryModifiers({ illnessOrInjury: true });
    expect(out.modifierDelta).toBeLessThan(0);
    expect(out.components.illnessOrInjury.delta).toBe(-8);
  });
});
