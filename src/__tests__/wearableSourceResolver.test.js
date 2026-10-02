// src/__tests__/wearableSourceResolver.test.js
// V3.1 Wearable Source Resolver — per-metric source arbitration, conflict
// detection, and confidence handling when Oura + Whoop are both connected.

import { describe, it, expect } from "vitest";
import {
  resolveMetric,
  resolveRecoveryContext,
  detectConflicts,
  buildSourceMap,
  resolveConflictAction,
} from "../recovery/wearableSourceResolver";
import { buildWearableSourceNote } from "../recoverySummary";

const DATE = "2026-07-01";

// ── Fixture builders ──────────────────────────────────────────────────────────

// Raw Oura grouped-map day (matches loadOuraData shape + oura/normalization).
function ouraDay(overrides = {}) {
  const {
    sleepDuration = 27000, // seconds → 450 min (7.5h)
    sleepScore = 82,
    hrv = 60,
    rhr = 50,
    tempDeviation = 0.1,
    readinessScore = 80,
    respiratoryRate = 14.5,
    activityScore = 70,
    spo2 = 97,
  } = overrides;
  return {
    [DATE]: {
      sleep: [{
        total_sleep_duration: sleepDuration,
        score: sleepScore,
        hrv: { rmssd: hrv },
        lowest_heart_rate: rhr,
        temperature: { deviation: tempDeviation },
        respiratory_rate: respiratoryRate,
      }],
      readiness: [{ score: readinessScore, respiratory_rate: respiratoryRate }],
      activity: [{ score: activityScore }],
      spo2: [{ average: spo2 }],
    },
  };
}

// Raw Whoop grouped-map day (matches loadWhoopData shape + whoop/normalization).
function whoopDay(overrides = {}) {
  const {
    recoveryScore = 72,
    hrvMilli = 55,
    rhr = 52,
    spo2 = 96,
    skinTemp = 33.2,
    inBedMin = 480,
    awakeMin = 30,
    performancePct = 85,
    respiratoryRate = 16,
    strain = 12.5,
    workoutStrain = 8,
  } = overrides;
  return {
    [DATE]: {
      recovery: {
        score: {
          recovery_score: recoveryScore,
          hrv_rmssd_milli: hrvMilli,
          resting_heart_rate: rhr,
          spo2_percentage: spo2,
          skin_temp_celsius: skinTemp,
        },
      },
      sleep: {
        score: {
          stage_summary: {
            total_in_bed_time_milli: inBedMin * 60000,
            total_awake_time_milli: awakeMin * 60000,
          },
          sleep_performance_percentage: performancePct,
          respiratory_rate: respiratoryRate,
        },
      },
      cycle: { score: { strain } },
      workout: [{ id: 1, sport_id: 1, score: { strain: workoutStrain } }],
    },
  };
}

const manualBody = { sleep: 7, sleepQuality: 8, energy: 6, soreness: 3, stress: 4, motivation: 7, restingHeartRate: 54, hrv: 48 };

// ── resolveMetric ─────────────────────────────────────────────────────────────

describe("resolveMetric — primary source selection", () => {
  const data = { ouraData: ouraDay(), whoopData: whoopDay(), manualData: manualBody, date: DATE };

  it("HRV resolves to Oura (primary)", () => {
    const r = resolveMetric("hrv", data);
    expect(r.source).toBe("oura");
    expect(r.value).toBe(60);
    expect(r.fallbackUsed).toBe(false);
    expect(r.confidence).toBe("high");
  });

  it("RHR resolves to Oura (primary)", () => {
    expect(resolveMetric("rhr", data).source).toBe("oura");
  });

  it("Temperature resolves to Oura and has no Whoop fallback", () => {
    const r = resolveMetric("temp", data);
    expect(r.source).toBe("oura");
    const noOura = resolveMetric("temp", { whoopData: whoopDay(), date: DATE });
    expect(noOura.source).toBeNull();
    expect(noOura.value).toBeNull();
  });

  it("Recovery resolves to Oura readiness (primary)", () => {
    const r = resolveMetric("recovery", data);
    expect(r.source).toBe("oura");
    expect(r.value).toBe(80);
  });

  it("Strain uses Whoop (primary) when available", () => {
    const r = resolveMetric("strain", data);
    expect(r.source).toBe("whoop");
    expect(r.value).toBe(12.5);
  });

  it("Strain falls back to Oura activity when Whoop is missing", () => {
    const r = resolveMetric("strain", { ouraData: ouraDay(), date: DATE });
    expect(r.source).toBe("oura");
    expect(r.value).toBe(70);
    expect(r.fallbackUsed).toBe(true);
  });

  it("Respiratory rate prefers Whoop over Oura", () => {
    const r = resolveMetric("respiratoryRate", data);
    expect(r.source).toBe("whoop");
    expect(r.value).toBe(16);
  });

  it("SpO₂ prefers Whoop over Oura", () => {
    const r = resolveMetric("spo2", data);
    expect(r.source).toBe("whoop");
    expect(r.value).toBe(96);
  });

  it("Subjective resolves to Manual", () => {
    const r = resolveMetric("subjective", data);
    expect(r.source).toBe("manual");
    expect(r.value).toMatchObject({ energy: 6, motivation: 7 });
  });

  it("Workouts are app-log authoritative with Whoop as supplementary suggestions", () => {
    const r = resolveMetric("workouts", data);
    expect(r.source).toBe("app_log");
    expect(r.autoComplete).toBe(false);
    expect(Array.isArray(r.suggestions)).toBe(true);
    expect(r.suggestions.length).toBe(1);
  });
});

describe("resolveMetric — fallback + missing", () => {
  it("HRV falls back to Whoop when Oura is missing (confidence downgrades)", () => {
    const r = resolveMetric("hrv", { whoopData: whoopDay(), date: DATE });
    expect(r.source).toBe("whoop");
    expect(r.value).toBe(55);
    expect(r.fallbackUsed).toBe(true);
    expect(r.confidence).toBe("medium");
  });

  it("Sleep falls back through Whoop then Manual", () => {
    const whoopOnly = resolveMetric("sleep", { whoopData: whoopDay(), date: DATE });
    expect(whoopOnly.source).toBe("whoop");
    const manualOnly = resolveMetric("sleep", { manualData: manualBody, date: DATE });
    expect(manualOnly.source).toBe("manual");
    expect(manualOnly.value).toBe(420); // 7h → 420 min
  });

  it("returns null resolution when no source has data", () => {
    const r = resolveMetric("hrv", { ouraData: {}, whoopData: {}, date: DATE });
    expect(r.value).toBeNull();
    expect(r.source).toBeNull();
    expect(r.confidence).toBeNull();
  });

  it("returns empty resolution for an unknown metric", () => {
    const r = resolveMetric("bogus", { ouraData: ouraDay(), date: DATE });
    expect(r.source).toBeNull();
  });
});

// ── resolveRecoveryContext ────────────────────────────────────────────────────

describe("resolveRecoveryContext", () => {
  it("assembles a full unified context", () => {
    const ctx = resolveRecoveryContext({ ouraData: ouraDay(), whoopData: whoopDay(), manualData: manualBody, date: DATE });
    for (const key of ["sleep", "hrv", "rhr", "temp", "recovery", "strain", "workouts", "respiratoryRate", "spo2", "subjective", "sources", "conflicts"]) {
      expect(ctx).toHaveProperty(key);
    }
    expect(ctx.sources.hrv).toBe("oura");
    expect(ctx.sources.strain).toBe("whoop");
    expect(ctx.sources.subjective).toBe("manual");
  });

  it("handles missing Oura (Whoop + manual only)", () => {
    const ctx = resolveRecoveryContext({ whoopData: whoopDay(), manualData: manualBody, date: DATE });
    expect(ctx.hrv.source).toBe("whoop");
    expect(ctx.temp.source).toBeNull(); // no Whoop temp
    expect(ctx.conflicts).toEqual([]);
  });

  it("handles missing Whoop (Oura + manual only)", () => {
    const ctx = resolveRecoveryContext({ ouraData: ouraDay(), manualData: manualBody, date: DATE });
    expect(ctx.hrv.source).toBe("oura");
    expect(ctx.strain.source).toBe("oura"); // falls back to activity
    expect(ctx.conflicts).toEqual([]);
  });

  it("handles both wearables missing (manual only)", () => {
    const ctx = resolveRecoveryContext({ manualData: manualBody });
    expect(ctx.subjective.source).toBe("manual");
    expect(ctx.hrv.source).toBeNull();
    expect(ctx.recovery.source).toBeNull();
  });

  it("resolves the latest date automatically when none is given", () => {
    const ctx = resolveRecoveryContext({ ouraData: ouraDay(), whoopData: whoopDay(), manualData: manualBody });
    expect(ctx.date).toBe(DATE);
  });

  it("integrates real-shaped Oura + Whoop fixtures cleanly", () => {
    const ctx = resolveRecoveryContext({ ouraData: ouraDay(), whoopData: whoopDay(), manualData: manualBody, date: DATE });
    expect(ctx.recovery.value).toBe(80);
    expect(ctx.strain.value).toBe(12.5);
    expect(ctx.spo2.value).toBe(96);
    expect(ctx.respiratoryRate.value).toBe(16);
  });
});

// ── detectConflicts ───────────────────────────────────────────────────────────

describe("detectConflicts", () => {
  it("returns empty when the two wearables agree", () => {
    const ctx = detectConflicts({
      ouraData: ouraDay({ readinessScore: 72, hrv: 55, rhr: 52 }),
      whoopData: whoopDay({ recoveryScore: 72, hrvMilli: 55, rhr: 52, inBedMin: 480, awakeMin: 30 }),
      date: DATE,
    });
    expect(ctx).toEqual([]);
  });

  it("detects a recovery-score conflict (≥15 pts)", () => {
    const c = detectConflicts({ ouraData: ouraDay({ readinessScore: 85 }), whoopData: whoopDay({ recoveryScore: 60 }), date: DATE });
    const rec = c.find((x) => x.metric === "recovery");
    expect(rec).toBeTruthy();
    expect(rec.ouraValue).toBe(85);
    expect(rec.whoopValue).toBe(60);
  });

  it("detects an HRV conflict (≥15%)", () => {
    const c = detectConflicts({ ouraData: ouraDay({ hrv: 60 }), whoopData: whoopDay({ hrvMilli: 45 }), date: DATE });
    expect(c.some((x) => x.metric === "hrv")).toBe(true);
  });

  it("detects an RHR conflict (≥5 bpm)", () => {
    const c = detectConflicts({ ouraData: ouraDay({ rhr: 48 }), whoopData: whoopDay({ rhr: 56 }), date: DATE });
    expect(c.some((x) => x.metric === "rhr")).toBe(true);
  });

  it("detects a sleep-duration conflict (≥60 min)", () => {
    // Oura 450 min asleep vs Whoop ~330 min asleep (390 in bed − 60 awake)
    const c = detectConflicts({ ouraData: ouraDay(), whoopData: whoopDay({ inBedMin: 390, awakeMin: 60 }), date: DATE });
    expect(c.some((x) => x.metric === "sleep")).toBe(true);
  });

  it("does NOT flag a conflict when only one source has data", () => {
    expect(detectConflicts({ ouraData: ouraDay(), date: DATE })).toEqual([]);
    expect(detectConflicts({ whoopData: whoopDay(), date: DATE })).toEqual([]);
  });

  it("marks a large disagreement as major", () => {
    const c = detectConflicts({ ouraData: ouraDay({ readinessScore: 90 }), whoopData: whoopDay({ recoveryScore: 45 }), date: DATE });
    const rec = c.find((x) => x.metric === "recovery");
    expect(rec.severity).toBe("major");
  });
});

// ── buildSourceMap ────────────────────────────────────────────────────────────

describe("buildSourceMap", () => {
  it("returns the correct per-metric source labels", () => {
    const ctx = resolveRecoveryContext({ ouraData: ouraDay(), whoopData: whoopDay(), manualData: manualBody, date: DATE });
    const map = buildSourceMap(ctx);
    expect(map).toMatchObject({
      hrv: "oura",
      rhr: "oura",
      temp: "oura",
      strain: "whoop",
      respiratoryRate: "whoop",
      spo2: "whoop",
      subjective: "manual",
      workouts: "app_log",
    });
  });

  it("is defensive against a null context", () => {
    expect(buildSourceMap(null)).toEqual({});
  });
});

// ── resolveConflictAction ─────────────────────────────────────────────────────

describe("resolveConflictAction", () => {
  it("returns use_primary when there are no conflicts", () => {
    expect(resolveConflictAction([]).action).toBe("use_primary");
    expect(resolveConflictAction(null).action).toBe("use_primary");
  });

  it("returns flag for a minor conflict", () => {
    expect(resolveConflictAction([{ metric: "rhr", severity: "minor" }]).action).toBe("flag");
  });

  it("returns conservative when any conflict is major", () => {
    const action = resolveConflictAction([{ metric: "rhr", severity: "minor" }, { metric: "recovery", severity: "major" }]);
    expect(action.action).toBe("conservative");
    expect(action.message).toMatch(/mixed signal/i);
  });
});

// ── Confidence + manual-first-class behavior ──────────────────────────────────

describe("confidence + manual invariants", () => {
  it("downgrades confidence when a fallback source is used", () => {
    const r = resolveMetric("hrv", { whoopData: whoopDay(), date: DATE });
    expect(r.confidence).toBe("medium");
  });

  it("downgrades confidence on a conflicting metric", () => {
    const ctx = resolveRecoveryContext({ ouraData: ouraDay({ readinessScore: 90 }), whoopData: whoopDay({ recoveryScore: 45 }), date: DATE });
    expect(ctx.recovery.confidence).toBe("medium"); // high → medium after conflict
    expect(ctx.recovery.conflict).toBe(true);
  });

  it("never overrides manual subjective, even with both wearables present", () => {
    const ctx = resolveRecoveryContext({ ouraData: ouraDay(), whoopData: whoopDay(), manualData: manualBody, date: DATE });
    expect(ctx.subjective.source).toBe("manual");
    expect(ctx.subjective.confidence).toBe("high");
    expect(ctx.subjective.fallbackUsed).toBe(false);
  });
});

// ── Null-safety across the whole surface ──────────────────────────────────────

describe("null/undefined safety", () => {
  it("no function throws on empty/undefined inputs", () => {
    expect(() => resolveMetric("hrv", {})).not.toThrow();
    expect(() => resolveMetric(undefined, undefined)).not.toThrow();
    expect(() => resolveRecoveryContext({})).not.toThrow();
    expect(() => resolveRecoveryContext(undefined)).not.toThrow();
    expect(() => detectConflicts({})).not.toThrow();
    expect(() => detectConflicts(undefined)).not.toThrow();
    expect(() => buildSourceMap(undefined)).not.toThrow();
    expect(() => resolveConflictAction(undefined)).not.toThrow();
  });

  it("resolveRecoveryContext with no inputs yields an all-null source map", () => {
    const ctx = resolveRecoveryContext();
    expect(ctx.sources.hrv).toBeNull();
    expect(ctx.conflicts).toEqual([]);
  });
});

// ── buildWearableSourceNote (recoverySummary integration) ─────────────────────

describe("buildWearableSourceNote", () => {
  it("summarizes which source won each metric", () => {
    const ctx = resolveRecoveryContext({ ouraData: ouraDay(), whoopData: whoopDay(), manualData: manualBody, date: DATE });
    const note = buildWearableSourceNote(ctx);
    expect(note).toMatch(/Oura \(/);
    expect(note).toMatch(/Whoop \(/);
    expect(note).toContain("feel");
  });

  it("returns null when no wearable is connected", () => {
    const ctx = resolveRecoveryContext({ manualData: manualBody });
    expect(buildWearableSourceNote(ctx)).toBeNull();
    expect(buildWearableSourceNote(null)).toBeNull();
  });
});
