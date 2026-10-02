import { describe, expect, it } from "vitest";
import {
  SNAPSHOT_STALE_MS,
  toDisplaySafeSnapshot,
  toEpochMs,
  deriveSnapshotStatus,
  summarizeSnapshotStatus,
  emptySnapshotResult,
} from "../wearables/snapshotSanitize";

describe("snapshotSanitize", () => {
  describe("toDisplaySafeSnapshot", () => {
    it("strips token/secret-bearing keys recursively without mutating input", () => {
      const input = {
        recovery: { score: 88 },
        access_token: "leak",
        nested: { refreshToken: "leak", client_secret: "leak", label: "kept" },
        rows: [{ api_key: "leak", source: "oura" }],
        tokenStatus: { syncStatus: "success" },
      };
      const out = toDisplaySafeSnapshot(input);
      const serialized = JSON.stringify(out);
      expect(serialized).not.toContain("leak");
      expect(out.recovery.score).toBe(88);
      expect(out.nested.label).toBe("kept");
      expect(out.nested.refreshToken).toBeUndefined();
      expect(out.rows[0].api_key).toBeUndefined();
      expect(out.rows[0].source).toBe("oura");
      // tokenStatus (sync metadata) is preserved — only secret VALUES are dropped.
      expect(out.tokenStatus.syncStatus).toBe("success");
      // input untouched
      expect(input.access_token).toBe("leak");
    });

    it("passes non-objects through unchanged", () => {
      expect(toDisplaySafeSnapshot(null)).toBeNull();
      expect(toDisplaySafeSnapshot(42)).toBe(42);
      expect(toDisplaySafeSnapshot("x")).toBe("x");
    });
  });

  describe("toEpochMs", () => {
    it("parses ISO strings and epoch numbers, rejects junk", () => {
      expect(toEpochMs(1000)).toBe(1000);
      expect(toEpochMs("2026-07-09T00:00:00.000Z")).toBe(Date.parse("2026-07-09T00:00:00.000Z"));
      expect(toEpochMs(null)).toBeNull();
      expect(toEpochMs(0)).toBeNull();
      expect(toEpochMs(-5)).toBeNull();
      expect(toEpochMs("not-a-date")).toBeNull();
    });
  });

  describe("deriveSnapshotStatus", () => {
    const now = 10 * SNAPSHOT_STALE_MS;
    it("returns empty when no snapshot", () => {
      expect(deriveSnapshotStatus({ hasSnapshot: false, updatedAt: now, now })).toBe("empty");
    });
    it("returns fresh when recent", () => {
      expect(deriveSnapshotStatus({ hasSnapshot: true, updatedAt: now - 1000, now })).toBe("fresh");
    });
    it("returns stale when older than the window or undatable", () => {
      expect(deriveSnapshotStatus({ hasSnapshot: true, updatedAt: now - SNAPSHOT_STALE_MS - 1, now })).toBe("stale");
      expect(deriveSnapshotStatus({ hasSnapshot: true, updatedAt: null, now })).toBe("stale");
    });
    it("treats clock skew (future timestamp) as fresh", () => {
      expect(deriveSnapshotStatus({ hasSnapshot: true, updatedAt: now + 5000, now })).toBe("fresh");
    });
  });

  describe("summarizeSnapshotStatus", () => {
    it("reports hasSnapshot, status, age, and source", () => {
      const now = 1_000_000_000_000;
      const updatedAt = now - 60_000;
      const s = summarizeSnapshotStatus({ snapshot: { recovery: { score: 70 } }, updatedAt, source: "oura", now });
      expect(s.hasSnapshot).toBe(true);
      expect(s.status).toBe("fresh");
      expect(s.ageMs).toBe(60_000);
      expect(s.source).toBe("oura");
    });
    it("treats an empty object as no snapshot", () => {
      const s = summarizeSnapshotStatus({ snapshot: {}, updatedAt: Date.now() });
      expect(s.hasSnapshot).toBe(false);
      expect(s.status).toBe("empty");
    });
  });

  describe("emptySnapshotResult", () => {
    it("is a stable display-safe empty shape", () => {
      expect(emptySnapshotResult()).toEqual({
        snapshot: null, source: null, updatedAt: null, status: "empty", hasSnapshot: false,
      });
    });
  });
});
