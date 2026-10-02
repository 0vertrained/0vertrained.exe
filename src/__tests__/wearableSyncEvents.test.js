// src/__tests__/wearableSyncEvents.test.js
// V3.4 Wearable Sync Events — pure display summarizer tests

import { describe, it, expect } from "vitest";
import {
  summarizeSyncEvent,
  buildSyncTimeline,
  formatSyncCounts,
  buildLatestSyncSummary,
  buildEmptyStateExplanation,
  buildSyncHealthBadge,
} from "../recovery/wearableSyncEvents";

const NOW = "2026-07-02T12:00:00.000Z";

function eventRow(overrides = {}) {
  return {
    id: "evt-1",
    user_id: "u1",
    source: "whoop",
    event_type: "sync",
    status: "success",
    counts: { cycle: 7, sleep: 0, recovery: 0, workout: 1 },
    message: "Synced 8 records over 14 days.",
    days: 14,
    created_at: NOW,
    ...overrides,
  };
}

// ── summarizeSyncEvent ────────────────────────────────────────────────────────

describe("summarizeSyncEvent", () => {
  it("summarizes a full event row", () => {
    const s = summarizeSyncEvent(eventRow());
    expect(s.sourceLabel).toBe("Whoop");
    expect(s.eventLabel).toBe("Sync");
    expect(s.tone).toBe("good");
    expect(s.message).toBe("Synced 8 records over 14 days.");
    expect(s.days).toBe(14);
    expect(s.timestamp).toBe(NOW);
  });

  it("maps status to tone correctly", () => {
    expect(summarizeSyncEvent(eventRow({ status: "partial" })).tone).toBe("caution");
    expect(summarizeSyncEvent(eventRow({ status: "failed" })).tone).toBe("warning");
    expect(summarizeSyncEvent(eventRow({ status: "info" })).tone).toBe("neutral");
  });

  it("maps event types to labels", () => {
    expect(summarizeSyncEvent(eventRow({ event_type: "connect" })).eventLabel).toBe("Connect");
    expect(summarizeSyncEvent(eventRow({ event_type: "token_expired" })).eventLabel).toBe("Token expired");
  });

  it("returns null for null/undefined input", () => {
    expect(summarizeSyncEvent(null)).toBeNull();
    expect(summarizeSyncEvent(undefined)).toBeNull();
  });

  it("handles missing counts gracefully", () => {
    const s = summarizeSyncEvent(eventRow({ counts: null }));
    expect(s.counts).toEqual({});
  });
});

// ── buildSyncTimeline ─────────────────────────────────────────────────────────

describe("buildSyncTimeline", () => {
  it("builds a timeline from rows newest-first", () => {
    const rows = [
      eventRow({ id: "old", created_at: "2026-06-28T12:00:00.000Z" }),
      eventRow({ id: "new", created_at: "2026-07-02T12:00:00.000Z" }),
    ];
    const tl = buildSyncTimeline(rows);
    expect(tl.hasEvents).toBe(true);
    expect(tl.entries[0].id).toBe("new");
    expect(tl.lastEvent.id).toBe("new");
  });

  it("filters by source", () => {
    const rows = [
      eventRow({ id: "w", source: "whoop" }),
      eventRow({ id: "o", source: "oura" }),
    ];
    const tl = buildSyncTimeline(rows, { source: "oura" });
    expect(tl.entries.length).toBe(1);
    expect(tl.entries[0].id).toBe("o");
  });

  it("respects the limit", () => {
    const rows = Array.from({ length: 15 }, (_, i) => eventRow({ id: `e${i}` }));
    const tl = buildSyncTimeline(rows, { limit: 5 });
    expect(tl.entries.length).toBe(5);
  });

  it("returns empty for no rows", () => {
    const tl = buildSyncTimeline([]);
    expect(tl.hasEvents).toBe(false);
    expect(tl.lastEvent).toBeNull();
  });

  it("is null-safe on undefined input", () => {
    expect(() => buildSyncTimeline(undefined)).not.toThrow();
    expect(() => buildSyncTimeline(null)).not.toThrow();
  });
});

// ── formatSyncCounts ──────────────────────────────────────────────────────────

describe("formatSyncCounts", () => {
  it("formats counts into a readable string", () => {
    expect(formatSyncCounts({ cycle: 7, sleep: 0, recovery: 0, workout: 1 }))
      .toBe("7 cycle · 0 sleep · 0 recovery · 1 workout");
  });

  it("returns null for null/undefined counts", () => {
    expect(formatSyncCounts(null)).toBeNull();
    expect(formatSyncCounts(undefined)).toBeNull();
  });

  it("handles partial counts objects", () => {
    expect(formatSyncCounts({ cycle: 3 })).toBe("3 cycle · 0 sleep · 0 recovery · 0 workout");
  });
});

// ── buildLatestSyncSummary ────────────────────────────────────────────────────

describe("buildLatestSyncSummary", () => {
  it("returns hasSynced=false when no events exist", () => {
    const s = buildLatestSyncSummary([], "whoop");
    expect(s.hasSynced).toBe(false);
    expect(s.lastStatus).toBeNull();
  });

  it("summarizes the latest sync event", () => {
    const rows = [eventRow({ status: "partial", counts: { cycle: 5, sleep: 0, recovery: 0, workout: 0 } })];
    const s = buildLatestSyncSummary(rows, "whoop");
    expect(s.hasSynced).toBe(true);
    expect(s.lastStatus).toBe("partial");
    expect(s.partialData).toBe(true);
    expect(s.noScoredRecovery).toBe(true);
  });

  it("detects full recovery data", () => {
    const rows = [eventRow({ status: "success", counts: { cycle: 7, sleep: 6, recovery: 5, workout: 2 } })];
    const s = buildLatestSyncSummary(rows, "whoop");
    expect(s.partialData).toBe(false);
    expect(s.noScoredRecovery).toBe(false);
    expect(s.lastCounts).toBe("7 cycle · 6 sleep · 5 recovery · 2 workout");
  });
});

// ── buildEmptyStateExplanation ────────────────────────────────────────────────

describe("buildEmptyStateExplanation", () => {
  it("explains disconnected state", () => {
    const exp = buildEmptyStateExplanation({ events: [], source: "whoop", connected: false });
    expect(exp.title).toMatch(/not connected/i);
    expect(exp.hasExplanation).toBe(true);
  });

  it("explains connected but not synced", () => {
    const exp = buildEmptyStateExplanation({ events: [], source: "whoop", connected: true });
    expect(exp.title).toMatch(/not synced yet/i);
    expect(exp.tone).toBe("neutral");
  });

  it("explains failed sync", () => {
    const rows = [eventRow({ status: "failed", message: "Token refresh failed." })];
    const exp = buildEmptyStateExplanation({ events: rows, source: "whoop", connected: true });
    expect(exp.title).toMatch(/sync failed/i);
    expect(exp.body).toContain("Token refresh failed.");
    expect(exp.tone).toBe("warning");
  });

  it("explains partial data (cycle only)", () => {
    const rows = [eventRow({ status: "partial", counts: { cycle: 5, sleep: 0, recovery: 0, workout: 0 } })];
    const exp = buildEmptyStateExplanation({ events: rows, source: "whoop", connected: true });
    expect(exp.title).toMatch(/partial data/i);
    expect(exp.body).toMatch(/sleep and recovery may appear/i);
    expect(exp.tone).toBe("caution");
  });

  it("explains no scored recovery", () => {
    const rows = [eventRow({ status: "success", counts: { cycle: 7, sleep: 6, recovery: 0, workout: 2 } })];
    const exp = buildEmptyStateExplanation({ events: rows, source: "whoop", connected: true });
    expect(exp.title).toMatch(/no scored recovery/i);
    expect(exp.tone).toBe("caution");
  });

  it("reports up-to-date when all data present", () => {
    const rows = [eventRow({ status: "success", counts: { cycle: 7, sleep: 6, recovery: 5, workout: 2 } })];
    const exp = buildEmptyStateExplanation({ events: rows, source: "whoop", connected: true });
    expect(exp.title).toMatch(/up to date/i);
    expect(exp.tone).toBe("good");
  });

  it("is null-safe with no arguments", () => {
    expect(() => buildEmptyStateExplanation()).not.toThrow();
  });
});

// ── buildSyncHealthBadge ──────────────────────────────────────────────────────

describe("buildSyncHealthBadge", () => {
  it("returns never synced when no events", () => {
    expect(buildSyncHealthBadge([], "whoop").label).toBe("never synced");
  });

  it("returns sync failed for failed status", () => {
    const rows = [eventRow({ status: "failed" })];
    expect(buildSyncHealthBadge(rows, "whoop").tone).toBe("warning");
  });

  it("returns good tone for full successful sync", () => {
    const rows = [eventRow({ status: "success", counts: { cycle: 7, sleep: 6, recovery: 5, workout: 2 } })];
    expect(buildSyncHealthBadge(rows, "whoop").tone).toBe("good");
  });

  it("returns caution for partial data", () => {
    const rows = [eventRow({ status: "partial", counts: { cycle: 5, sleep: 0, recovery: 0 } })];
    expect(buildSyncHealthBadge(rows, "whoop").tone).toBe("caution");
  });
});