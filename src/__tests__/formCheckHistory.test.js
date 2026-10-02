import { describe, expect, it, beforeEach } from "vitest";
import {
  FORM_CHECK_HISTORY_KEY,
  FORM_CHECK_HISTORY_VERSION,
  MAX_HISTORY_ENTRIES,
  buildSummaryEntry,
  loadHistory,
  saveSummary,
  clearHistory,
} from "../formCheck/formCheckHistory";

// Minimal in-memory storage that mimics the Web Storage API surface we use.
function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

// A realistic analyzeLocalVideo-shaped object, deliberately seeded with raw
// media fields that MUST NOT survive into the persisted summary.
function makeAnalysis() {
  return {
    status: "analyzed",
    movement: "squat-side-view",
    // Raw / sensitive data that the privacy model forbids persisting:
    file: { name: "squat.mov" },
    objectUrl: "blob:http://localhost/abc",
    frames: [{ landmarks: [{ x: 0.5, y: 0.5 }] }],
    metadata: { durationSec: 6.2, width: 1080, height: 1920 },
    metrics: { minKneeAngleDeg: 82.4, torsoForwardLeanDeg: 41.1 },
    result: {
      movement: "squat",
      assessable: true,
      depthAssessment: "at-or-below-parallel",
      cues: [{ id: "depth", severity: "info", text: "Depth looks solid." }],
      summary: "Looks good.",
      confidence: { level: "high", reasons: [] },
      disclaimer: "Educational estimate only.",
    },
    segmentation: {
      repCount: 2,
      timelineSummary: "2 reps detected",
      confident: true,
      reps: [
        {
          index: 1,
          startMs: 0,
          bottomMs: 600,
          endMs: 1200,
          depthAssessment: "at-or-below-parallel",
          minKneeAngleDeg: 82.4,
          tempoSec: 1.2,
          flags: [],
        },
        {
          index: 2,
          startMs: 1500,
          bottomMs: 2100,
          endMs: 2700,
          depthAssessment: "near-parallel",
          minKneeAngleDeg: 108.7,
          tempoSec: 1.2,
          flags: [],
        },
      ],
    },
  };
}

const DATE = "2026-06-30T12:00:00.000Z";

// Recursively collect every key name present in an object graph.
function allKeys(obj, acc = new Set()) {
  if (Array.isArray(obj)) {
    obj.forEach((v) => allKeys(v, acc));
  } else if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      acc.add(k);
      allKeys(v, acc);
    }
  }
  return acc;
}

describe("buildSummaryEntry", () => {
  it("keeps only derived summary fields", () => {
    const entry = buildSummaryEntry(makeAnalysis(), DATE);
    expect(entry.v).toBe(FORM_CHECK_HISTORY_VERSION);
    expect(entry.date).toBe(DATE);
    expect(entry.movement).toBe("squat-side-view");
    expect(entry.repCount).toBe(2);
    expect(entry.depthAssessment).toBe("at-or-below-parallel");
    expect(entry.confidence.level).toBe("high");
    expect(entry.cues).toEqual([{ id: "depth", severity: "info", text: "Depth looks solid." }]);
    expect(entry.metrics.minKneeAngleDeg).toBeCloseTo(82.4, 1);
    expect(entry.timeline).toHaveLength(2);
    expect(entry.timeline[0]).toMatchObject({ index: 1, depthAssessment: "at-or-below-parallel" });
  });

  it("NEVER persists raw video / media / landmark data", () => {
    const entry = buildSummaryEntry(makeAnalysis(), DATE);
    const keys = allKeys(entry);
    for (const forbidden of [
      "file",
      "objectUrl",
      "objectURL",
      "frames",
      "landmarks",
      "base64",
      "dataUrl",
      "image",
      "images",
      "blob",
      "video",
      "src",
    ]) {
      expect(keys.has(forbidden)).toBe(false);
    }
    // Defense in depth: the serialized form must not contain a blob/data URL.
    const json = JSON.stringify(entry);
    expect(json).not.toMatch(/blob:|data:|base64/i);
  });

  it("degrades gracefully when segmentation is missing", () => {
    const analysis = makeAnalysis();
    delete analysis.segmentation;
    const entry = buildSummaryEntry(analysis, DATE);
    expect(entry.repCount).toBe(null);
    expect(entry.timeline).toEqual([]);
  });
});

// A deadlift-shaped analysis with movement-specific metrics + a hip-angle
// timeline. Seeded with raw media fields that MUST NOT survive.
function makeDeadliftAnalysis() {
  return {
    status: "analyzed",
    movement: "deadlift-side-view",
    file: { name: "deadlift.mov" },
    frames: [{ landmarks: [{ x: 0.5, y: 0.5 }] }],
    metadata: { durationSec: 7.1, width: 1080, height: 1920 },
    metrics: { minHipAngleDeg: 101.3, maxHipAngleDeg: 171.8, hipRangeDeg: 70.5, torsoLeanAtBottomDeg: 56.2 },
    result: {
      movement: "deadlift",
      assessable: true,
      hingeAssessment: "clear-hinge",
      depthAssessment: "clear-hinge",
      cues: [{ id: "lockout", severity: "info", text: "Lockout appears tall." }],
      summary: "Looks reasonable.",
      confidence: { level: "high", reasons: [] },
      disclaimer: "Educational estimate only.",
    },
    segmentation: {
      repCount: 1,
      timelineSummary: "1 rep detected",
      confident: true,
      reps: [
        {
          index: 1,
          startMs: 0,
          bottomMs: 800,
          endMs: 1600,
          assessment: "clear-hinge",
          minAngleDeg: 101.3,
          minHipAngleDeg: 101.3,
          tempoSec: 1.6,
          flags: [],
        },
      ],
    },
  };
}

describe("buildSummaryEntry — additional movements", () => {
  it("stores a deadlift movement label and derived metrics, no raw media", () => {
    const entry = buildSummaryEntry(makeDeadliftAnalysis(), DATE);
    expect(entry.movement).toBe("deadlift-side-view");
    expect(entry.repCount).toBe(1);
    expect(entry.metrics.minHipAngleDeg).toBeCloseTo(101.3, 1);
    expect(entry.timeline).toHaveLength(1);
    // Generic assessment label preserved for the timeline chip.
    const t = entry.timeline[0];
    expect(t.assessment || t.depthAssessment).toBe("clear-hinge");

    const keys = allKeys(entry);
    for (const forbidden of ["file", "frames", "landmarks", "blob", "video", "src", "base64"]) {
      expect(keys.has(forbidden)).toBe(false);
    }
    expect(JSON.stringify(entry)).not.toMatch(/blob:|data:|base64/i);
  });
});

describe("history persistence", () => {
  let storage;
  beforeEach(() => {
    storage = makeStorage();
  });

  it("starts empty", () => {
    expect(loadHistory(storage)).toEqual([]);
  });

  it("saves under a versioned key and round-trips", () => {
    const entry = buildSummaryEntry(makeAnalysis(), DATE);
    saveSummary(entry, storage);
    expect(storage._map.has(FORM_CHECK_HISTORY_KEY)).toBe(true);
    const loaded = loadHistory(storage);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].date).toBe(DATE);
  });

  it("prepends newest first", () => {
    saveSummary(buildSummaryEntry(makeAnalysis(), "2026-06-29T10:00:00.000Z"), storage);
    saveSummary(buildSummaryEntry(makeAnalysis(), "2026-06-30T10:00:00.000Z"), storage);
    const loaded = loadHistory(storage);
    expect(loaded[0].date).toBe("2026-06-30T10:00:00.000Z");
    expect(loaded[1].date).toBe("2026-06-29T10:00:00.000Z");
  });

  it("caps the history length", () => {
    for (let i = 0; i < MAX_HISTORY_ENTRIES + 10; i += 1) {
      const date = `2026-06-30T12:00:${String(i % 60).padStart(2, "0")}.${String(i).padStart(3, "0")}Z`;
      saveSummary(buildSummaryEntry(makeAnalysis(), date), storage);
    }
    expect(loadHistory(storage).length).toBe(MAX_HISTORY_ENTRIES);
  });

  it("clears history", () => {
    saveSummary(buildSummaryEntry(makeAnalysis(), DATE), storage);
    clearHistory(storage);
    expect(loadHistory(storage)).toEqual([]);
  });

  it("tolerates corrupt stored JSON", () => {
    storage.setItem(FORM_CHECK_HISTORY_KEY, "{not json");
    expect(loadHistory(storage)).toEqual([]);
  });

  it("ignores a stored payload from a different version", () => {
    storage.setItem(
      FORM_CHECK_HISTORY_KEY,
      JSON.stringify({ v: FORM_CHECK_HISTORY_VERSION + 1, entries: [{ date: DATE }] }),
    );
    expect(loadHistory(storage)).toEqual([]);
  });
});
