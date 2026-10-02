/**
 * V1.4 tests: pure progress-memory + same-movement comparison helpers.
 *
 * These exercise the derived comparison/summary layer only. They confirm the
 * helpers tolerate old V1.1/V1.2 entries, are date/order-safe, produce sensible
 * deltas, and never surface anything beyond the saved derived data.
 */
import { describe, expect, it } from "vitest";
import {
  normalizeMovementLabel,
  movementFamilyKey,
  getEntriesForMovement,
  getPreviousForMovement,
  compareFormCheckEntries,
  buildFormCheckHistorySummary,
} from "../formCheck/formCheckHistory";

// A full V1.3-shaped derived entry.
function makeEntry({ date, movement = "squat-side-view", score, reps, trend, focus, conf = "high" }) {
  return {
    v: 1,
    date,
    movement,
    repCount: reps ?? null,
    depthAssessment: "at-or-below-parallel",
    confidence: { level: conf, reasons: [] },
    cues: [{ id: "depth", severity: "info", text: "Depth looks solid." }],
    metrics: { minKneeAngleDeg: 82.4 },
    timeline: [],
    formScore: score == null ? null : { score, label: "good", reasons: [] },
    coaching: { nextSetCue: "Sit back into the hips.", watchItems: [], topPriority: "" },
    progressSignals: {
      movement: "squat",
      repCount: reps ?? null,
      primaryFocus: focus ?? null,
      trendKey: trend ?? null,
      comparableMetrics: [],
      scoreComponents: [],
    },
  };
}

// An old V1.1-style entry: no formScore, no coaching, no progressSignals.
function makeOldEntry({ date, movement = "squat-side-view", reps = 2, conf = "moderate" }) {
  return {
    v: 1,
    date,
    movement,
    repCount: reps,
    depthAssessment: "near-parallel",
    confidence: { level: conf, reasons: [] },
    cues: [],
    metrics: {},
    timeline: [],
  };
}

describe("normalizeMovementLabel / movementFamilyKey", () => {
  it("maps known view-keys and bare movements to the same family", () => {
    expect(movementFamilyKey("squat-side-view")).toBe("squat");
    expect(movementFamilyKey("squat")).toBe("squat");
    expect(movementFamilyKey({ movement: "squat-side-view" })).toBe("squat");
    expect(movementFamilyKey({ progressSignals: { movement: "squat" } })).toBe("squat");
    expect(movementFamilyKey("pushup-side-view")).toBe("pushup");
  });

  it("gives friendly labels for known families and echoes unknown ones", () => {
    expect(normalizeMovementLabel("squat-side-view")).toBe("Squat");
    expect(normalizeMovementLabel("benchpress-side-view")).toBe("Bench Press");
    expect(normalizeMovementLabel("power-clean")).toBe("Power Clean");
    expect(normalizeMovementLabel(null)).toBe("Form Check");
    expect(normalizeMovementLabel({})).toBe("Form Check");
  });
});

describe("getEntriesForMovement", () => {
  it("returns only same-family entries, newest first", () => {
    const history = [
      makeEntry({ date: "2026-06-30T10:00:00.000Z", movement: "squat-side-view" }),
      makeEntry({ date: "2026-06-20T10:00:00.000Z", movement: "deadlift-side-view" }),
      makeEntry({ date: "2026-06-25T10:00:00.000Z", movement: "squat-side-view" }),
    ];
    const squats = getEntriesForMovement(history, "squat");
    expect(squats).toHaveLength(2);
    expect(squats[0].date).toBe("2026-06-30T10:00:00.000Z");
    expect(squats[1].date).toBe("2026-06-25T10:00:00.000Z");
  });

  it("is order-safe even when history is not pre-sorted", () => {
    const history = [
      makeEntry({ date: "2026-06-20T10:00:00.000Z" }),
      makeEntry({ date: "2026-06-30T10:00:00.000Z" }),
      makeEntry({ date: "2026-06-25T10:00:00.000Z" }),
    ];
    const squats = getEntriesForMovement(history, "squat");
    expect(squats.map((e) => e.date)).toEqual([
      "2026-06-30T10:00:00.000Z",
      "2026-06-25T10:00:00.000Z",
      "2026-06-20T10:00:00.000Z",
    ]);
  });

  it("returns [] for unknown/missing movement and non-array history", () => {
    expect(getEntriesForMovement([], "squat")).toEqual([]);
    expect(getEntriesForMovement(null, "squat")).toEqual([]);
    expect(getEntriesForMovement([makeEntry({ date: "2026-06-30T10:00:00.000Z" })], null)).toEqual([]);
  });
});

describe("getPreviousForMovement", () => {
  it("finds the newest strictly-older same-movement entry", () => {
    const cur = makeEntry({ date: "2026-06-30T10:00:00.000Z" });
    const mid = makeEntry({ date: "2026-06-25T10:00:00.000Z" });
    const old = makeEntry({ date: "2026-06-20T10:00:00.000Z" });
    const other = makeEntry({ date: "2026-06-28T10:00:00.000Z", movement: "deadlift-side-view" });
    const history = [cur, other, mid, old];
    expect(getPreviousForMovement(history, cur)).toBe(mid);
  });

  it("excludes the same object and same-date entries", () => {
    const cur = makeEntry({ date: "2026-06-30T10:00:00.000Z" });
    const sameDate = makeEntry({ date: "2026-06-30T10:00:00.000Z" });
    const older = makeEntry({ date: "2026-06-20T10:00:00.000Z" });
    const history = [cur, sameDate, older];
    // sameDate is skipped; older is the real previous.
    expect(getPreviousForMovement(history, cur)).toBe(older);
  });

  it("returns null when there is no earlier same-movement entry", () => {
    const cur = makeEntry({ date: "2026-06-30T10:00:00.000Z" });
    const dl = makeEntry({ date: "2026-06-20T10:00:00.000Z", movement: "deadlift-side-view" });
    expect(getPreviousForMovement([cur, dl], cur)).toBeNull();
    expect(getPreviousForMovement([cur], cur)).toBeNull();
    expect(getPreviousForMovement([], cur)).toBeNull();
  });
});

describe("compareFormCheckEntries", () => {
  it("computes score/trend/rep deltas and confidence change", () => {
    const prev = makeEntry({ date: "2026-06-20T10:00:00.000Z", score: 70, reps: 3, trend: 90.0, focus: "kneeDepth", conf: "moderate" });
    const cur = makeEntry({ date: "2026-06-30T10:00:00.000Z", score: 78, reps: 4, trend: 82.4, focus: "kneeDepth", conf: "high" });
    const cmp = compareFormCheckEntries(cur, prev);

    expect(cmp.hasPrevious).toBe(true);
    expect(cmp.movementLabel).toBe("Squat");
    expect(cmp.previousDate).toBe("2026-06-20T10:00:00.000Z");
    expect(cmp.scoreDelta).toBe(8);
    expect(cmp.repDelta).toBe(1);
    expect(cmp.trendDelta).toBeCloseTo(-7.6, 1);
    expect(cmp.confidenceChange).toMatchObject({ from: "moderate", to: "high", direction: "up" });
    expect(cmp.focusChanged).toBe(false);
    expect(cmp.primaryFocus).toBe("kneeDepth");

    // Chips: score (positive), trend (neutral), reps (neutral), conf (positive).
    const byLabel = Object.fromEntries(cmp.chips.map((c) => [c.label, c]));
    expect(byLabel.Score).toMatchObject({ value: "+8", tone: "positive" });
    expect(byLabel.Reps).toMatchObject({ value: "+1", tone: "neutral" });
    expect(byLabel.Trend.value).toBe("-7.6");
    expect(byLabel.Conf).toMatchObject({ tone: "positive" });

    expect(cmp.summary).toMatch(/Squat check \(2026-06-20\)/);
    expect(cmp.summary).toMatch(/form score \+8/);
    expect(cmp.recommendation).toBe("Sit back into the hips.");
  });

  it("flags a changed primary focus and a lower score", () => {
    const prev = makeEntry({ date: "2026-06-20T10:00:00.000Z", score: 80, focus: "kneeDepth" });
    const cur = makeEntry({ date: "2026-06-30T10:00:00.000Z", score: 74, focus: "torsoLean" });
    const cmp = compareFormCheckEntries(cur, prev);
    expect(cmp.scoreDelta).toBe(-6);
    expect(cmp.chips.find((c) => c.label === "Score")).toMatchObject({ value: "-6", tone: "negative" });
    expect(cmp.focusChanged).toBe(true);
  });

  it("tolerates old entries missing V1.3 fields (no score/trend/focus)", () => {
    const prev = makeOldEntry({ date: "2026-06-20T10:00:00.000Z", reps: 2, conf: "moderate" });
    const cur = makeOldEntry({ date: "2026-06-30T10:00:00.000Z", reps: 3, conf: "high" });
    const cmp = compareFormCheckEntries(cur, prev);
    expect(cmp.hasPrevious).toBe(true);
    expect(cmp.scoreDelta).toBeNull();
    expect(cmp.trendDelta).toBeNull();
    expect(cmp.repDelta).toBe(1);
    expect(cmp.confidenceChange.direction).toBe("up");
    // No score/trend chips, but rep + conf chips present.
    expect(cmp.chips.some((c) => c.label === "Score")).toBe(false);
    expect(cmp.chips.some((c) => c.label === "Reps")).toBe(true);
    expect(cmp.primaryFocus).toBeNull();
    expect(cmp.summary).toMatch(/Squat check/);
  });

  it("handles the no-previous case as a first check", () => {
    const cur = makeEntry({ date: "2026-06-30T10:00:00.000Z", score: 78 });
    const cmp = compareFormCheckEntries(cur, null);
    expect(cmp.hasPrevious).toBe(false);
    expect(cmp.chips).toEqual([]);
    expect(cmp.scoreDelta).toBeNull();
    expect(cmp.summary).toMatch(/First saved Squat check/);
  });

  it("emits a neutral summary when nothing measurable changed", () => {
    const prev = makeEntry({ date: "2026-06-20T10:00:00.000Z", score: 78, reps: 3, trend: 82.4, conf: "high" });
    const cur = makeEntry({ date: "2026-06-30T10:00:00.000Z", score: 78, reps: 3, trend: 82.4, conf: "high" });
    const cmp = compareFormCheckEntries(cur, prev);
    expect(cmp.scoreDelta).toBe(0);
    expect(cmp.summary).toMatch(/no measurable change/);
  });
});

describe("buildFormCheckHistorySummary", () => {
  it("aggregates totals, movement coverage, latest, and latest comparison", () => {
    const history = [
      makeEntry({ date: "2026-06-30T10:00:00.000Z", movement: "squat-side-view", score: 78, focus: "kneeDepth", trend: 82.4 }),
      makeEntry({ date: "2026-06-25T10:00:00.000Z", movement: "squat-side-view", score: 70, focus: "kneeDepth", trend: 90.0 }),
      makeEntry({ date: "2026-06-20T10:00:00.000Z", movement: "deadlift-side-view", score: 65 }),
    ];
    const s = buildFormCheckHistorySummary(history);
    expect(s.total).toBe(3);
    expect(s.movementCount).toBe(2);
    expect(s.latest.date).toBe("2026-06-30T10:00:00.000Z");

    // latestComparison compares the newest squat against the prior squat.
    expect(s.latestComparison.hasPrevious).toBe(true);
    expect(s.latestComparison.scoreDelta).toBe(8);

    // movements ordered newest-first, with per-family latest fields.
    expect(s.movements[0]).toMatchObject({ movement: "squat", label: "Squat", count: 2, latestScore: 78, primaryFocus: "kneeDepth" });
    expect(s.movements[1]).toMatchObject({ movement: "deadlift", label: "Deadlift", count: 1 });
  });

  it("handles an empty history", () => {
    const s = buildFormCheckHistorySummary([]);
    expect(s).toMatchObject({ total: 0, movementCount: 0, latest: null, latestComparison: null });
    expect(s.movements).toEqual([]);
  });

  it("mixes old and new entries in one movement family without throwing", () => {
    const history = [
      makeEntry({ date: "2026-06-30T10:00:00.000Z", movement: "squat-side-view", score: 78 }),
      makeOldEntry({ date: "2026-06-20T10:00:00.000Z", movement: "squat-side-view" }),
    ];
    const s = buildFormCheckHistorySummary(history);
    expect(s.movementCount).toBe(1);
    expect(s.movements[0].count).toBe(2);
    expect(s.latestComparison.hasPrevious).toBe(true);
  });
});

describe("privacy: derived-only, no raw media in comparison output", () => {
  it("never surfaces raw media even if the source entry is polluted", () => {
    // Simulate a (wrongly) polluted entry; the comparison layer only reads
    // derived fields, so no raw media can appear in its output.
    const prev = makeEntry({ date: "2026-06-20T10:00:00.000Z", score: 70 });
    const cur = makeEntry({ date: "2026-06-30T10:00:00.000Z", score: 78 });
    cur.objectUrl = "blob:http://localhost/abc";
    cur.frames = [{ pixels: "nope" }];
    cur.progressSignals.videoObjectUrl = "blob:https://x/y";

    const cmp = compareFormCheckEntries(cur, prev);
    const summary = buildFormCheckHistorySummary([cur, prev]);
    const json = JSON.stringify(cmp) + JSON.stringify(summary.latestComparison) + JSON.stringify(summary.movements);
    expect(json).not.toMatch(/blob:|data:|base64|pixels|objectUrl|videoObjectUrl|frames|landmarks/i);
  });
});
