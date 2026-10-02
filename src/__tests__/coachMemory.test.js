import { describe, it, expect } from "vitest";
import {
  DEFAULT_COACH_PREFERENCES,
  COACH_NOTE_MAX,
  normalizeCoachPreferences,
  mergeCoachPreferences,
  summarizeRecentTrend,
  buildCoachMemoryLines,
  buildCoachMemoryContext,
  buildCoachMemoryExport,
} from "../coachMemory";

describe("normalizeCoachPreferences", () => {
  it("snaps unknown enum values back to defaults", () => {
    const p = normalizeCoachPreferences({ tone: "hacker", focus: "moon", intensity: "insane", restBias: "??" });
    expect(p.tone).toBe(DEFAULT_COACH_PREFERENCES.tone);
    expect(p.focus).toBe(DEFAULT_COACH_PREFERENCES.focus);
    expect(p.intensity).toBe(DEFAULT_COACH_PREFERENCES.intensity);
    expect(p.restBias).toBe(DEFAULT_COACH_PREFERENCES.restBias);
  });

  it("keeps valid values and coerces enabled", () => {
    const p = normalizeCoachPreferences({ enabled: "true", tone: "direct", focus: "strength", intensity: "aggressive", restBias: "more-rest" });
    expect(p.enabled).toBe(true);
    expect(p.tone).toBe("direct");
    expect(p.focus).toBe("strength");
  });

  it("caps and de-newlines the note (no smuggled structure)", () => {
    const note = "line one\nline two\t" + "x".repeat(400);
    const p = normalizeCoachPreferences({ note });
    expect(p.note.length).toBeLessThanOrEqual(COACH_NOTE_MAX);
    expect(p.note).not.toContain("\n");
    expect(p.note).not.toContain("\t");
  });

  it("is null-safe", () => {
    expect(normalizeCoachPreferences(null)).toEqual(DEFAULT_COACH_PREFERENCES);
    expect(normalizeCoachPreferences(undefined).enabled).toBe(false);
  });
});

describe("mergeCoachPreferences", () => {
  it("merges a patch and drops unknown keys", () => {
    const merged = mergeCoachPreferences({ tone: "direct" }, { focus: "endurance", hacker: "x" });
    expect(merged.tone).toBe("direct");
    expect(merged.focus).toBe("endurance");
    expect(merged.hacker).toBeUndefined();
  });
});

describe("summarizeRecentTrend", () => {
  const trainingDay = () => ({ workout: { exercises: { Squat: { sets: [{ weight: 200, reps: 5 }] } } }, body: { sleep: 8, energy: 7 }, nutrition: { protein: 200 } });
  const restDay = () => ({ body: { sleep: 6, energy: 5 } });

  it("aggregates counts and averages without touching raw notes", () => {
    const entries = {
      "2026-06-28": trainingDay(),
      "2026-06-29": restDay(),
      "2026-06-30": { ...trainingDay(), workout: { ...trainingDay().workout, notes: "secret private note" } },
    };
    const t = summarizeRecentTrend(entries, null, { windowDays: 14 });
    expect(t.loggedDays).toBe(3);
    expect(t.trainingDays).toBe(2);
    expect(t.proteinDays).toBe(2);
    expect(t.avgSleep).toBeCloseTo((8 + 6 + 8) / 3, 1);
    expect(t.avgEnergy).toBeGreaterThan(0);
    // Ensure no raw note text leaks into the summary object.
    expect(JSON.stringify(t)).not.toContain("secret private note");
  });

  it("selects only the most recent window", () => {
    const entries = {};
    for (let i = 1; i <= 20; i++) entries[`2026-06-${String(i).padStart(2, "0")}`] = trainingDay();
    const t = summarizeRecentTrend(entries, null, { windowDays: 7 });
    expect(t.trainingDays).toBe(7);
  });

  it("is null-safe and reports no data", () => {
    const t = summarizeRecentTrend(null);
    expect(t.hasData).toBe(false);
    expect(t.loggedDays).toBe(0);
  });
});

describe("buildCoachMemoryLines / context", () => {
  const trend = { windowDays: 14, loggedDays: 10, trainingDays: 6, proteinDays: 5, avgSleep: 7.5, avgEnergy: 6.8, hasData: true };

  it("returns nothing when memory is disabled", () => {
    expect(buildCoachMemoryLines({ preferences: { enabled: false }, trend })).toEqual([]);
    expect(buildCoachMemoryContext({ preferences: { enabled: false }, trend })).toBeNull();
  });

  it("builds concise, suggest-only lines when enabled", () => {
    const prefs = { enabled: true, tone: "direct", focus: "strength", intensity: "aggressive", restBias: "more-rest", note: "knee rehab in progress" };
    const lines = buildCoachMemoryLines({ preferences: prefs, trend });
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines.join(" ")).toContain("knee rehab in progress");
    const ctx = buildCoachMemoryContext({ preferences: prefs, trend });
    expect(ctx.toLowerCase()).toContain("suggest-only");
    expect(ctx.length).toBeLessThanOrEqual(240);
  });
});

describe("buildCoachMemoryExport — privacy safe", () => {
  it("contains prefs + aggregates but no raw payload keys", () => {
    const prefs = { enabled: true, tone: "encouraging", focus: "hybrid", intensity: "moderate", restBias: "balanced", note: "prefers morning sessions" };
    const trend = { windowDays: 14, loggedDays: 8, trainingDays: 5, proteinDays: 4, avgSleep: 7, avgEnergy: 6, hasData: true };
    const text = buildCoachMemoryExport({ preferences: prefs, trend });
    expect(text).toContain("prefers morning sessions");
    expect(text).toContain("Training days: 5");
    const lower = text.toLowerCase();
    for (const term of ["payload", "\"workout\"", "\"nutrition\"", "token", "coach chat", "hrv"]) {
      expect(lower).not.toContain(term.toLowerCase());
    }
  });
});
