// src/__tests__/ouraActivityLoadFill.test.js
// ─────────────────────────────────────────────────────────────────────────────
// V16.6 · Oura activity load fill was dead code — two independent breaks:
// normalizeActivity required the legacy { activity: [...] } wrapper (stored
// payloads are { data: [...] }) and returned snake_case fields while
// ouraLoadForDay read camelCase. Against the reporting user's 14-day export,
// zero days ever filled from Oura. Pinned with the real V2 payload shape.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { normalizeActivity } from "../oura/normalization";
import { buildWearableLoadRows } from "../wearableWorkoutLoad";

// Real V2 daily_activity shape (values from the export's 2026-07-14 row).
const V2_ACTIVITY_PAYLOAD = {
  data: [{
    id: "e4fd8555", day: "2026-07-14", score: 80,
    active_calories: 490, total_calories: 2880,
    steps: 6601, equivalent_walking_distance: 7995,
  }],
};

describe("V16.6 Oura activity load fill", () => {
  it("normalizes the stored V2 shape (data wrapper + V2 field names)", () => {
    const a = normalizeActivity(V2_ACTIVITY_PAYLOAD);
    expect(a).not.toBe(null);
    expect(a.date).toBe("2026-07-14");
    expect(a.activeCalories).toBe(490);
    expect(a.meters).toBe(7995);
    expect(a.score).toBe(80);
    // Load-canonical `calories` is ACTIVE calories — total includes BMR and
    // would manufacture ~2,300 kcal of "training load" out of existing.
    expect(a.calories).toBe(490);
  });

  it("still accepts the legacy { activity: [...] } wrapper", () => {
    const a = normalizeActivity({ activity: [{ day: "2026-07-14", active_calories: 300, walking_distance: 4000 }] });
    expect(a.activeCalories).toBe(300);
    expect(a.meters).toBe(4000);
  });

  it("fills a missing manual-load day from real Oura activity", () => {
    const ouraData = { "2026-07-14": { activity: V2_ACTIVITY_PAYLOAD } };
    const rows = buildWearableLoadRows({
      entries: {},
      ouraData,
      whoopData: {},
      stravaByDate: {},
      maxDays: 3,
      asOf: new Date("2026-07-14T12:00:00"),
    });
    const filled = rows.find((r) => r.date === "2026-07-14");
    expect(filled.source).toBe("oura");
    // max(4.97 mi × 45, 490 × 0.8) = max(223, 392) = 392
    expect(filled.load).toBe(392);
    expect(filled.hasWorkout).toBe(true);
  });

  it("returns null for genuinely empty activity payloads", () => {
    expect(normalizeActivity(null)).toBe(null);
    expect(normalizeActivity({ data: [] })).toBe(null);
  });
});
