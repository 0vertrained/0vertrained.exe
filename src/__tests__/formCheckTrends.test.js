// V1.6 — Trend Coach / Progress Memory V2 tests (pure helpers).
//
// Cover: insufficient data, improving, stable, declining, and mixed old/new
// entries. All inputs are already-derived history records.
import { describe, expect, it } from "vitest";
import {
  buildMovementTrend,
  buildAllMovementTrends,
  findRecurringFocus,
  findBestRecentCheck,
  buildNextCheckRecommendation,
} from "../formCheck/formCheckHistory";

// V1.3+ shaped entry.
function entry({ date, movement = "squat-side-view", score, focus, conf = "high" }) {
  return {
    v: 1,
    date,
    movement,
    repCount: 3,
    confidence: { level: conf, reasons: [] },
    formScore: score == null ? null : { score, label: "good", reasons: [] },
    progressSignals: { movement: "squat", primaryFocus: focus ?? null, trendKey: score ?? null, comparableMetrics: [], scoreComponents: [] },
  };
}

// Old V1.1 entry: no formScore, no progressSignals.
function oldEntry({ date, movement = "squat-side-view" }) {
  return { v: 1, date, movement, repCount: 2, confidence: { level: "moderate", reasons: [] } };
}

describe("buildMovementTrend", () => {
  it("reports insufficient-data with a single check", () => {
    const tr = buildMovementTrend([entry({ date: "2026-06-01", score: 70 })], "squat");
    expect(tr.count).toBe(1);
    expect(tr.scoreTrend).toBe("insufficient-data");
    expect(tr.scoreDeltaFromOldest).toBeNull();
    expect(tr.confidenceNote).toMatch(/one saved check/i);
  });

  it("detects an improving trend (oldest→newest)", () => {
    const history = [
      entry({ date: "2026-06-10", score: 88 }),
      entry({ date: "2026-06-05", score: 78 }),
      entry({ date: "2026-06-01", score: 70 }),
    ];
    const tr = buildMovementTrend(history, "squat");
    expect(tr.scoreTrend).toBe("improving");
    expect(tr.scoreDeltaFromOldest).toBe(18);
    expect(tr.bestRecentScore).toBe(88);
  });

  it("detects a declining trend", () => {
    const history = [
      entry({ date: "2026-06-10", score: 62 }),
      entry({ date: "2026-06-01", score: 80 }),
    ];
    const tr = buildMovementTrend(history, "squat");
    expect(tr.scoreTrend).toBe("declining");
    expect(tr.scoreDeltaFromOldest).toBe(-18);
  });

  it("detects a stable trend within the threshold", () => {
    const history = [
      entry({ date: "2026-06-10", score: 81 }),
      entry({ date: "2026-06-01", score: 80 }),
    ];
    const tr = buildMovementTrend(history, "squat");
    expect(tr.scoreTrend).toBe("stable");
    expect(tr.scoreDeltaFromOldest).toBe(1);
  });

  it("tolerates mixed old (unscored) and new entries", () => {
    const history = [
      entry({ date: "2026-06-10", score: 85 }),
      oldEntry({ date: "2026-06-05" }),
      entry({ date: "2026-06-01", score: 75 }),
    ];
    const tr = buildMovementTrend(history, "squat");
    expect(tr.count).toBe(3);
    // Only two entries have scores → still trendable.
    expect(tr.scoreTrend).toBe("improving");
    expect(tr.scoreDeltaFromOldest).toBe(10);
  });

  it("falls back gracefully when too few entries have scores", () => {
    const history = [entry({ date: "2026-06-10", score: 85 }), oldEntry({ date: "2026-06-01" })];
    const tr = buildMovementTrend(history, "squat");
    expect(tr.count).toBe(2);
    expect(tr.scoreTrend).toBe("insufficient-data");
    expect(tr.confidenceNote).toMatch(/too few/i);
  });

  it("respects the limit option", () => {
    const history = Array.from({ length: 8 }, (_, i) =>
      entry({ date: `2026-06-0${i + 1}`, score: 70 + i }),
    );
    const tr = buildMovementTrend(history, "squat", { limit: 3 });
    expect(tr.count).toBe(3);
  });
});

describe("findRecurringFocus", () => {
  it("returns the most common focus with a human label", () => {
    const entries = [
      entry({ date: "2026-06-03", focus: "kneeDepth" }),
      entry({ date: "2026-06-02", focus: "kneeDepth" }),
      entry({ date: "2026-06-01", focus: "torsoDrift" }),
    ];
    const r = findRecurringFocus(entries);
    expect(r.focus).toBe("kneeDepth");
    expect(r.count).toBe(2);
    expect(r.label).toBe("knee depth");
  });
  it("returns null when no focus present", () => {
    expect(findRecurringFocus([oldEntry({ date: "2026-06-01" })])).toBeNull();
  });
});

describe("findBestRecentCheck", () => {
  it("returns the highest-scoring entry", () => {
    const entries = [entry({ date: "2026-06-02", score: 70 }), entry({ date: "2026-06-01", score: 91 })];
    expect(findBestRecentCheck(entries).score).toBe(91);
  });
  it("returns null when nothing is scored", () => {
    expect(findBestRecentCheck([oldEntry({ date: "2026-06-01" })])).toBeNull();
  });
});

describe("buildNextCheckRecommendation", () => {
  it("nudges to keep the same angle when a focus recurs", () => {
    const entries = [
      entry({ date: "2026-06-02", focus: "kneeDepth" }),
      entry({ date: "2026-06-01", focus: "kneeDepth" }),
    ];
    expect(buildNextCheckRecommendation(entries)).toMatch(/same camera angle/i);
  });
  it("handles an empty history", () => {
    expect(buildNextCheckRecommendation([])).toMatch(/save a form check/i);
  });
});

describe("buildAllMovementTrends", () => {
  it("groups by movement family and sorts by latest date", () => {
    const history = [
      entry({ date: "2026-06-10", movement: "benchpress-side-view", score: 80 }),
      entry({ date: "2026-06-09", movement: "benchpress-side-view", score: 76 }),
      entry({ date: "2026-06-05", movement: "squat-side-view", score: 70 }),
    ];
    const trends = buildAllMovementTrends(history);
    expect(trends.length).toBe(2);
    expect(trends[0].movement).toBe("benchpress"); // most recent family first
    expect(trends[0].count).toBe(2);
  });
  it("returns [] for empty history", () => {
    expect(buildAllMovementTrends([])).toEqual([]);
  });
});
