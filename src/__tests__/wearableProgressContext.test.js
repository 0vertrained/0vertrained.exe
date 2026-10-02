// src/__tests__/wearableProgressContext.test.js
// V3.3 Wearable Progress Context — source-aware trend notes that never fabricate
// a trend without enough data and always label the source per metric.

import { describe, it, expect } from "vitest";
import { buildWearableTrendNotes } from "../recovery/wearableProgressContext";

// Build a multi-day grouped Oura map. `series` is an array of {hrv, rhr, sleepSec, readiness, activity}.
function ouraSeries(series) {
  const out = {};
  series.forEach((s, i) => {
    const date = `2026-06-${String(10 + i).padStart(2, "0")}`;
    out[date] = {
      sleep: [{
        total_sleep_duration: s.sleepSec ?? 27000,
        score: 80,
        hrv: { rmssd: s.hrv ?? 55 },
        lowest_heart_rate: s.rhr ?? 50,
        temperature: { deviation: 0.1 },
      }],
      readiness: [{ score: s.readiness ?? 80 }],
      activity: [{ score: s.activity ?? 70 }],
    };
  });
  return out;
}

// Build a multi-day grouped Whoop map. `series` is an array of {strain, hrv, rhr}.
function whoopSeries(series) {
  const out = {};
  series.forEach((s, i) => {
    const date = `2026-06-${String(10 + i).padStart(2, "0")}`;
    out[date] = {
      recovery: { score: { recovery_score: 70, hrv_rmssd_milli: s.hrv ?? 55, resting_heart_rate: s.rhr ?? 52 } },
      cycle: { score: { strain: s.strain ?? 12 } },
    };
  });
  return out;
}

// ── No data / not enough data ─────────────────────────────────────────────────

describe("does not fabricate trends without enough data", () => {
  it("returns a single not-enough-data note when nothing is connected", () => {
    const res = buildWearableTrendNotes({});
    expect(res.available).toBe(false);
    expect(res.hasEnoughData).toBe(false);
    expect(res.notes).toHaveLength(1);
    expect(res.notes[0].note).toMatch(/not enough/i);
  });

  it("marks a single-day metric as insufficient, never a trend", () => {
    const res = buildWearableTrendNotes({ ouraData: ouraSeries([{ hrv: 55 }]) });
    const hrv = res.notes.find((n) => n.metric === "hrv");
    expect(hrv.trend).toBe("insufficient");
    expect(hrv.points).toBe(1);
    expect(hrv.note).toMatch(/not enough data to trend/i);
    expect(res.hasEnoughData).toBe(false);
  });

  it("does not emit NaN for empty data", () => {
    const res = buildWearableTrendNotes({ ouraData: {}, whoopData: {} });
    const serialized = JSON.stringify(res);
    expect(serialized).not.toMatch(/NaN/);
  });
});

// ── Trends compute with ≥2 points ─────────────────────────────────────────────

describe("computes conservative trends with enough data", () => {
  it("detects a rising HRV trend and labels the source", () => {
    const res = buildWearableTrendNotes({
      ouraData: ouraSeries([{ hrv: 45 }, { hrv: 48 }, { hrv: 58 }, { hrv: 62 }]),
    });
    const hrv = res.notes.find((n) => n.metric === "hrv");
    expect(hrv.trend).toBe("rising");
    expect(hrv.source).toBe("oura");
    expect(hrv.sourceLabel).toBe("Oura");
    expect(hrv.note).toMatch(/trending up/i);
    expect(hrv.note).toMatch(/Oura/);
    expect(res.hasEnoughData).toBe(true);
  });

  it("detects a falling RHR trend", () => {
    const res = buildWearableTrendNotes({
      ouraData: ouraSeries([{ rhr: 58 }, { rhr: 56 }, { rhr: 50 }, { rhr: 48 }]),
    });
    const rhr = res.notes.find((n) => n.metric === "rhr");
    expect(rhr.trend).toBe("falling");
    expect(rhr.note).toMatch(/trending down/i);
  });

  it("reports holding steady when values barely move", () => {
    const res = buildWearableTrendNotes({
      ouraData: ouraSeries([{ hrv: 55 }, { hrv: 56 }, { hrv: 55 }, { hrv: 56 }]),
    });
    const hrv = res.notes.find((n) => n.metric === "hrv");
    expect(hrv.trend).toBe("stable");
    expect(hrv.note).toMatch(/holding steady/i);
  });
});

// ── Source labels for HRV / RHR / sleep / strain ──────────────────────────────

describe("source labels for HRV/RHR/sleep/strain", () => {
  it("strain resolves to Whoop and is labeled", () => {
    const res = buildWearableTrendNotes({
      whoopData: whoopSeries([{ strain: 10 }, { strain: 14 }, { strain: 17 }]),
    });
    const strain = res.notes.find((n) => n.metric === "strain");
    expect(strain.source).toBe("whoop");
    expect(strain.sourceLabel).toBe("Whoop");
    expect(strain.note).toMatch(/Whoop/);
  });

  it("prefers Oura for HRV/RHR/sleep when both wearables are present", () => {
    const res = buildWearableTrendNotes({
      ouraData: ouraSeries([{ hrv: 50 }, { hrv: 55 }, { hrv: 60 }]),
      whoopData: whoopSeries([{ hrv: 40 }, { hrv: 42 }, { hrv: 44 }]),
    });
    expect(res.sources.hrv).toBe("oura");
    expect(res.sources.rhr).toBe("oura");
    expect(res.sources.sleep).toBe("oura");
    expect(res.sources.strain).toBe("whoop");
  });

  it("includes a note object for every tracked metric", () => {
    const res = buildWearableTrendNotes({
      ouraData: ouraSeries([{ hrv: 50 }, { hrv: 55 }]),
      whoopData: whoopSeries([{ strain: 12 }, { strain: 13 }]),
    });
    const metrics = res.notes.map((n) => n.metric);
    for (const m of ["hrv", "rhr", "sleep", "strain"]) {
      expect(metrics).toContain(m);
    }
  });
});

// ── Windowing + null safety ───────────────────────────────────────────────────

describe("windowing and null safety", () => {
  it("respects the endDate upper bound", () => {
    const res = buildWearableTrendNotes({
      ouraData: ouraSeries([{ hrv: 45 }, { hrv: 50 }, { hrv: 90 }]),
      endDate: "2026-06-11", // excludes the third (high) day
      days: 30,
    });
    const hrv = res.notes.find((n) => n.metric === "hrv");
    expect(hrv.points).toBe(2);
  });

  it("never throws on undefined inputs", () => {
    expect(() => buildWearableTrendNotes()).not.toThrow();
    expect(() => buildWearableTrendNotes(undefined)).not.toThrow();
    expect(() => buildWearableTrendNotes({ ouraData: null, whoopData: null })).not.toThrow();
  });
});
