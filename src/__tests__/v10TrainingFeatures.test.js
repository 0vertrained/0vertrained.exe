import { describe, it, expect } from "vitest";
import { buildSegments, normalizePlan, totalPlannedSeconds, fmtSeconds, suggestPlanFromNotes, CARDIO_PRESETS } from "../cardioSession";
import { buildWarmupRamp } from "../sessionIntelligence";
import { getSubstitutions } from "../exerciseSubstitutions";
import { buildWeightTrend, SMOOTHING_ALPHA } from "../weightTrend";

// ─── cardioSession ────────────────────────────────────────────────────────────
describe("cardioSession · buildSegments", () => {
  it("builds warmup → work/rest rounds and drops the final rest", () => {
    const segs = buildSegments({ work: 240, rest: 180, rounds: 4, warmup: 300 });
    expect(segs[0]).toMatchObject({ kind: "warmup", seconds: 300 });
    expect(segs.filter(s => s.kind === "work").length).toBe(4);
    expect(segs.filter(s => s.kind === "rest").length).toBe(3); // no rest after round 4
    expect(segs[segs.length - 1].kind).toBe("work");
  });

  it("omits rest segments entirely for EMOM-style zero rest", () => {
    const segs = buildSegments({ work: 60, rest: 0, rounds: 10, warmup: 0 });
    expect(segs.length).toBe(10);
    expect(segs.every(s => s.kind === "work")).toBe(true);
  });

  it("clamps degenerate plans", () => {
    const p = normalizePlan({ work: 1, rest: -50, rounds: 999, warmup: 99999 });
    expect(p.work).toBe(5);
    expect(p.rest).toBe(0);
    expect(p.rounds).toBe(50);
    expect(p.warmup).toBe(1800);
  });

  it("totals and formats time", () => {
    expect(totalPlannedSeconds({ work: 60, rest: 60, rounds: 2, warmup: 0 })).toBe(180);
    expect(fmtSeconds(185)).toBe("3:05");
    expect(fmtSeconds(0)).toBe("0:00");
  });

  it("ships sane presets", () => {
    for (const p of CARDIO_PRESETS) {
      const segs = buildSegments(p);
      expect(segs.length).toBeGreaterThan(0);
    }
  });
});

describe("cardioSession · suggestPlanFromNotes", () => {
  it("parses unambiguous time-based intervals", () => {
    expect(suggestPlanFromNotes("6x3min hard, 2min rest")).toMatchObject({ rounds: 6, work: 180, rest: 120 });
    expect(suggestPlanFromNotes("8 x 90s on / 60s off")).toMatchObject({ rounds: 8, work: 90, rest: 60 });
    expect(suggestPlanFromNotes("4 × 4 min w/ 3min recovery")).toMatchObject({ rounds: 4, work: 240, rest: 180 });
  });

  it("refuses distance-based or ambiguous notes", () => {
    expect(suggestPlanFromNotes("6x800m @ 5K pace")).toBeNull();
    expect(suggestPlanFromNotes("easy zone 2 run")).toBeNull();
    expect(suggestPlanFromNotes(null)).toBeNull();
  });
});

// ─── warm-up ramp ─────────────────────────────────────────────────────────────
describe("buildWarmupRamp", () => {
  it("builds an ascending ramp with plate labels below the working weight", () => {
    const ramp = buildWarmupRamp(225);
    expect(ramp.steps[0]).toMatchObject({ weight: 45, reps: 10 });
    const weights = ramp.steps.map(s => s.weight);
    expect([...weights]).toEqual([...weights].sort((a, b) => a - b));
    expect(Math.max(...weights)).toBeLessThan(225);
    expect(ramp.working.weight).toBe(225);
    expect(ramp.working.label).toContain("45");
  });

  it("dedupes collapsed steps at light working weights", () => {
    const ramp = buildWarmupRamp(115);
    const weights = ramp.steps.map(s => s.weight);
    expect(new Set(weights).size).toBe(weights.length);
  });

  it("returns null below the useful threshold or for junk", () => {
    expect(buildWarmupRamp(90)).toBeNull();
    expect(buildWarmupRamp("abc")).toBeNull();
  });
});

// ─── substitutions ────────────────────────────────────────────────────────────
describe("getSubstitutions", () => {
  it("maps common lifts to the right pattern", () => {
    expect(getSubstitutions("Barbell Back Squat").pattern).toBe("Squat pattern");
    expect(getSubstitutions("Incline Bench Press").pattern).toBe("Horizontal press");
    expect(getSubstitutions("Romanian Deadlift").pattern).toBe("Hip hinge");
    expect(getSubstitutions("Lat Pulldown").pattern).toBe("Vertical pull");
  });

  it("never suggests the exercise as its own substitute", () => {
    const subs = getSubstitutions("Lat Pulldown").subs.map(s => s.name.toLowerCase());
    expect(subs.some(n => n.includes("lat pulldown"))).toBe(false);
  });

  it("returns null for unknown movements", () => {
    expect(getSubstitutions("Zercher Yoke Carry Backwards")).toBeNull();
    expect(getSubstitutions("")).toBeNull();
  });
});

// ─── weight trend ─────────────────────────────────────────────────────────────
describe("buildWeightTrend", () => {
  const day = (w) => ({ body: { weight: String(w) } });

  it("requires a minimum of logged weigh-ins", () => {
    const r = buildWeightTrend({ "2026-06-01": day(185), "2026-06-02": day(184) });
    expect(r.ready).toBe(false);
    expect(r.needed).toBe(5);
  });

  it("smooths noise: trend moves less than raw swings", () => {
    const data = {};
    const weights = [185, 188, 183, 187, 184, 186, 183.5];
    weights.forEach((w, i) => { data[`2026-06-0${i + 1}`] = day(w); });
    const r = buildWeightTrend(data);
    expect(r.ready).toBe(true);
    const rawSpread = Math.max(...weights) - Math.min(...weights);
    const trendVals = r.points.map(p => p.trend);
    const trendSpread = Math.max(...trendVals) - Math.min(...trendVals);
    expect(trendSpread).toBeLessThan(rawSpread / 2);
  });

  it("reports a negative weekly rate on a steady cut, scaled by calendar days", () => {
    const data = {};
    for (let i = 1; i <= 20; i++) {
      const d = String(i).padStart(2, "0");
      data[`2026-06-${d}`] = day(190 - i * 0.15); // ~1 lb/week true loss
    }
    const r = buildWeightTrend(data);
    expect(r.current.weeklyRate).toBeLessThan(0);
    expect(r.current.direction).toBe("losing");
  });

  it("uses the documented alpha", () => {
    expect(SMOOTHING_ALPHA).toBe(0.1);
  });
});
