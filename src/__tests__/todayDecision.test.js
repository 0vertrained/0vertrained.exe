import { describe, expect, it } from "vitest";
import {
  buildTodayDecision,
  isValidDecisionResponse,
  buildDecisionResponseEntry,
} from "../todayDecision";

describe("buildTodayDecision", () => {
  it("returns a fallback decision when recommendation is missing", () => {
    const out = buildTodayDecision({});
    expect(out.call).toBe("maintain");
    expect(out.confidence).toBe("low");
    expect(out.reasons.some((r) => r.includes("Missing readiness"))).toBe(true);
  });

  it("maps rest readiness to recover call", () => {
    const rec = { readiness: "rest", confidence: "high", reasons: [] };
    const out = buildTodayDecision({ recommendation: rec });
    expect(out.call).toBe("recover");
    expect(out.risk).toBe("Medium");
    expect(out.trainingAction).toContain("Skip");
  });

  it("maps pull_back readiness to modify call", () => {
    const rec = { readiness: "pull_back", confidence: "high", reasons: [] };
    const out = buildTodayDecision({ recommendation: rec });
    expect(out.call).toBe("modify");
    expect(out.trainingAction).toContain("Reduce");
  });

  it("maps moderate readiness to maintain call", () => {
    const rec = { readiness: "moderate", confidence: "high", reasons: [] };
    const out = buildTodayDecision({ recommendation: rec });
    expect(out.call).toBe("maintain");
  });

  it("maps normal readiness to maintain call", () => {
    const rec = { readiness: "normal", confidence: "high", reasons: [] };
    const out = buildTodayDecision({ recommendation: rec });
    expect(out.call).toBe("maintain");
  });

  it("maps push readiness to push call", () => {
    const rec = { readiness: "push", confidence: "high", reasons: [] };
    const program = { type: "Upper A", lifting: [{ name: "Bench Press", sets: 4, reps: 6 }] };
    const out = buildTodayDecision({ recommendation: rec, todayProgram: program });
    expect(out.call).toBe("push");
    expect(out.trainingAction).toContain("intensity");
  });

  it("does not tell the user to push hard on a programmed rest day", () => {
    const rec = { readiness: "push", confidence: "high", reasons: [] };
    const out = buildTodayDecision({ recommendation: rec, todayProgram: { type: "Rest Day", lifting: [], cardio: null } });
    expect(out.call).toBe("maintain");
    expect(out.title).toBe("Recovery day");
    expect(out.primaryAction).toMatch(/rest day/i);
    expect(out.doList.some((d) => /rest day/i.test(d))).toBe(true);
    expect(out.avoidList.some((a) => /extra workout/i.test(a))).toBe(true);
  });

  it("includes recovery score in reasons when available", () => {
    const rec = { readiness: "normal", confidence: "high", reasons: [] };
    const recovery = { score: 75, source: "subjective" };
    const out = buildTodayDecision({ recommendation: rec, recovery });
    expect(out.reasons.some((r) => r.includes("75"))).toBe(true);
  });

  it("prefers Oura source label in reasons", () => {
    const rec = { readiness: "normal", confidence: "high", reasons: [] };
    const recovery = { score: 75, source: "oura" };
    const out = buildTodayDecision({ recommendation: rec, recovery });
    expect(out.reasons.some((r) => r.includes("Oura"))).toBe(true);
  });

  it("includes manual check-in label when source is subjective", () => {
    const rec = { readiness: "normal", confidence: "high", reasons: [] };
    const recovery = { score: 75, source: "subjective" };
    const out = buildTodayDecision({ recommendation: rec, recovery });
    expect(out.reasons.some((r) => r.includes("check-in"))).toBe(true);
  });

  it("does not add fuel action when gap is small", () => {
    const rec = { readiness: "normal", confidence: "high", reasons: [] };
    const fuelNeeds = { stillNeedCalories: 100, stillNeedProtein: 5 };
    const out = buildTodayDecision({ recommendation: rec, fuelNeeds });
    expect(out.fuelAction).toBeNull();
  });

  it("adds fuel action when calorie gap is material", () => {
    const rec = { readiness: "normal", confidence: "high", reasons: [] };
    const fuelNeeds = { stillNeedCalories: 400, stillNeedProtein: 15 };
    const out = buildTodayDecision({ recommendation: rec, fuelNeeds });
    expect(out.fuelAction).toBeTruthy();
    expect(out.fuelAction).toContain("400");
  });

  it("includes program label when present", () => {
    const rec = { readiness: "normal", confidence: "high", reasons: [] };
    const program = { type: "Upper A — Push + Triceps" };
    const out = buildTodayDecision({ recommendation: rec, todayProgram: program });
    expect(out.programLabel).toBe("Upper A — Push + Triceps");
  });

  it("keeps short run visible when added to an existing lifting day", () => {
    const rec = { readiness: "normal", confidence: "high", reasons: [] };
    const program = {
      type: "Upper A — Push + Triceps",
      lifting: [{ name: "Barbell Bench Press", sets: 4, reps: 6 }],
      cardio: { type: "Short Run", miles: 1.5, effort: "Zone 2" },
    };
    const out = buildTodayDecision({ recommendation: rec, todayProgram: program });
    expect(out.programLabel).toBe("Upper A — Push + Triceps + Short Run · 1.5mi · Zone 2");
    expect(out.doList.some((item) => item.includes("Short Run"))).toBe(true);
  });

  it("includes reason detail from recommendation", () => {
    const rec = {
      readiness: "normal",
      confidence: "high",
      reasons: [
        { label: "Sleep", detail: "Below baseline" },
        { label: "Load", detail: "Elevated" },
      ],
    };
    const out = buildTodayDecision({ recommendation: rec });
    expect(out.reasons.some((r) => r.includes("Sleep"))).toBe(true);
    expect(out.reasons.some((r) => r.includes("Load"))).toBe(true);
  });
});

describe("buildTodayDecision — v2 shape", () => {
  it("always returns version 2 with the v2 fields", () => {
    const out = buildTodayDecision({ recommendation: { readiness: "normal", confidence: "high", reasons: [] } });
    expect(out.version).toBe(2);
    expect(Array.isArray(out.doList)).toBe(true);
    expect(Array.isArray(out.avoidList)).toBe(true);
    expect(Array.isArray(out.watchList)).toBe(true);
    expect(Array.isArray(out.sourceBadges)).toBe(true);
    expect(typeof out.primaryAction).toBe("string");
    expect(typeof out.responsePrompt).toBe("string");
  });

  it("fallback (no recommendation) is v2-shaped and conservative", () => {
    const out = buildTodayDecision({});
    expect(out.version).toBe(2);
    expect(out.call).toBe("maintain");
    expect(out.confidence).toBe("low");
    expect(out.sourceBadges).toContain("Limited data");
    expect(out.watchList.length).toBeGreaterThan(0);
  });

  it("high recovery + stable load + planned workout => push with planned workout in doList, junk volume avoided", () => {
    const rec = { readiness: "push", confidence: "high", reasons: [] };
    const out = buildTodayDecision({
      recommendation: rec,
      recovery: { score: 88, source: "oura" },
      trainingLoad: { ratio: 1.0, zone: "optimal", monotony: 1.2 },
      todayProgram: { type: "Upper A" },
    });
    expect(out.call).toBe("push");
    expect(out.doList.some((d) => d.includes("Upper A"))).toBe(true);
    expect(out.avoidList.some((a) => /junk volume/i.test(a))).toBe(true);
    expect(out.risk).toBe("Low");
  });

  it("high recovery + high ACWR => held back and names load as the limiting factor", () => {
    const rec = { readiness: "moderate", confidence: "high", reasons: [] };
    const out = buildTodayDecision({
      recommendation: rec,
      recovery: { score: 82, source: "oura" },
      trainingLoad: { ratio: 1.45, zone: "overreaching", monotony: 1.5 },
      todayProgram: { type: "Lower A" },
    });
    expect(["maintain", "modify"]).toContain(out.call);
    expect(out.reasons.some((r) => /limiter/i.test(r) && r.includes("1.45"))).toBe(true);
    expect(out.risk).toBe("Medium");
  });

  it("low recovery + high ACWR => recover/modify and avoids hard intervals/max sets", () => {
    const rec = { readiness: "pull_back", confidence: "high", reasons: [] };
    const out = buildTodayDecision({
      recommendation: rec,
      recovery: { score: 40, source: "oura" },
      trainingLoad: { ratio: 1.6, zone: "high_risk", monotony: 2.4 },
      todayProgram: { type: "Lower B" },
    });
    expect(["recover", "modify"]).toContain(out.call);
    expect(out.avoidList.some((a) => /interval|max/i.test(a))).toBe(true);
    expect(out.risk).toBe("High");
    expect(out.watchList.some((w) => /monotony/i.test(w))).toBe(true);
  });

  it("missing recovery => limited-data source badge and soft-call watch note", () => {
    const rec = { readiness: "normal", confidence: "low", reasons: [], missingData: ["recovery"] };
    const out = buildTodayDecision({ recommendation: rec, todayProgram: { type: "Upper B" } });
    expect(out.sourceBadges).toContain("Limited data");
    expect(out.watchList.some((w) => /limited data/i.test(w))).toBe(true);
    expect(out.confidence).toBe("low");
  });

  it("material fuel gap => fuelAction set and fuel guidance in doList", () => {
    const rec = { readiness: "normal", confidence: "high", reasons: [] };
    const out = buildTodayDecision({
      recommendation: rec,
      fuelNeeds: { calories: 500, protein: 40 },
      todayProgram: { type: "Upper A" },
    });
    expect(out.fuelAction).toBeTruthy();
    expect(out.doList.some((d) => /fuel gap/i.test(d))).toBe(true);
  });

  it("illness flag conservatively overrides biometric optimism", () => {
    const rec = { readiness: "push", confidence: "high", reasons: [] };
    const out = buildTodayDecision({
      recommendation: rec,
      recovery: { score: 90, source: "oura" },
      trainingLoad: { ratio: 1.0, zone: "optimal" },
      todayProgram: { type: "Upper A" },
      manualBody: { illnessOrInjury: true },
    });
    // Must not still say "push" despite the great biometrics.
    expect(out.call).not.toBe("push");
    expect(out.risk).toBe("High");
    expect(out.avoidList.some((a) => /illness|injury/i.test(a))).toBe(true);
    expect(out.sourceBadges).toContain("Manual check-in");
    expect(out.subtitle).toMatch(/illness|injury/i);
  });

  it("high manual soreness caps a push down to no-hard-pushing", () => {
    const rec = { readiness: "push", confidence: "high", reasons: [] };
    const out = buildTodayDecision({
      recommendation: rec,
      recovery: { score: 85, source: "oura" },
      manualBody: { soreness: 8 },
      todayProgram: { type: "Lower A" },
    });
    expect(out.call).not.toBe("push");
    expect(out.watchList.some((w) => /soreness/i.test(w))).toBe(true);
  });
});

describe("isValidDecisionResponse", () => {
  it("accepts valid responses", () => {
    expect(isValidDecisionResponse("followed")).toBe(true);
    expect(isValidDecisionResponse("modified")).toBe(true);
    expect(isValidDecisionResponse("ignored")).toBe(true);
    expect(isValidDecisionResponse("skipped")).toBe(true);
  });

  it("rejects invalid responses", () => {
    expect(isValidDecisionResponse("accepted")).toBe(false);
    expect(isValidDecisionResponse("")).toBe(false);
    expect(isValidDecisionResponse(null)).toBe(false);
    expect(isValidDecisionResponse(undefined)).toBe(false);
  });
});

describe("buildDecisionResponseEntry", () => {
  it("builds a valid response entry", () => {
    const entry = buildDecisionResponseEntry("maintain", "followed");
    expect(entry.version).toBe(1);
    expect(entry.decisionCall).toBe("maintain");
    expect(entry.response).toBe("followed");
    expect(entry.recordedAt).toBeTruthy();
    expect(typeof entry.recordedAt).toBe("string");
  });

  it("records ISO timestamp", () => {
    const entry = buildDecisionResponseEntry("modify", "modified");
    const parsed = new Date(entry.recordedAt);
    expect(parsed instanceof Date && !Number.isNaN(parsed)).toBe(true);
  });

  it("throws on invalid response", () => {
    expect(() => buildDecisionResponseEntry("maintain", "invalid")).toThrow();
  });
});
