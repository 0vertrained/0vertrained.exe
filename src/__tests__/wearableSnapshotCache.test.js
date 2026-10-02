// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SNAPSHOT_VERSION,
  clearWearableSnapshot,
  describeSnapshotAge,
  getSnapshotKey,
  readWearableSnapshot,
  sanitizeSnapshot,
  writeWearableSnapshot,
} from "../wearableSnapshotCache";

describe("wearableSnapshotCache", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("uses a user-scoped key and never falls back to a shared cache", () => {
    expect(getSnapshotKey("user-a")).toBe("ovt-wearable-snapshot-user-a");
    expect(getSnapshotKey("")).toBeNull();
    expect(getSnapshotKey(null)).toBeNull();
  });

  it("writes and reads a display-safe snapshot for only that user", () => {
    writeWearableSnapshot("user-a", { recovery: { score: 88 }, rawMetrics: { hrv: "70 ms" } }, 1_000);
    writeWearableSnapshot("user-b", { recovery: { score: 41 }, rawMetrics: { hrv: "31 ms" } }, 2_000);

    expect(readWearableSnapshot("user-a").recovery.score).toBe(88);
    expect(readWearableSnapshot("user-a").rawMetrics.hrv).toBe("70 ms");
    expect(readWearableSnapshot("user-b").recovery.score).toBe(41);
    expect(readWearableSnapshot("user-a").savedAt).toBe(1_000);
  });

  it("strips secret-bearing fields recursively before storage and readback", () => {
    writeWearableSnapshot("user-a", {
      tokenStatus: { syncStatus: "success", lastSynced: "2026-07-09T00:00:00Z" },
      access_token: "leak",
      nested: {
        refreshToken: "leak",
        client_secret: "leak",
        safe: "kept",
      },
      rows: [{ api_key: "leak", source: "oura" }],
    }, 1_000);

    const raw = localStorage.getItem(getSnapshotKey("user-a"));
    expect(raw).not.toContain("leak");
    const cached = readWearableSnapshot("user-a");
    expect(cached.tokenStatus.syncStatus).toBe("success");
    expect(cached.nested.safe).toBe("kept");
    expect(cached.nested.refreshToken).toBeUndefined();
    expect(cached.rows[0].api_key).toBeUndefined();
  });

  it("returns null for malformed JSON, version mismatch, or missing user id", () => {
    localStorage.setItem(getSnapshotKey("bad-json"), "{");
    localStorage.setItem(getSnapshotKey("old"), JSON.stringify({ version: "0", recovery: { score: 90 } }));

    expect(readWearableSnapshot("bad-json")).toBeNull();
    expect(readWearableSnapshot("old")).toBeNull();
    expect(readWearableSnapshot("")).toBeNull();
  });

  it("clears only the targeted user's snapshot", () => {
    writeWearableSnapshot("user-a", { recovery: { score: 88 } });
    writeWearableSnapshot("user-b", { recovery: { score: 41 } });

    clearWearableSnapshot("user-a");

    expect(readWearableSnapshot("user-a")).toBeNull();
    expect(readWearableSnapshot("user-b").recovery.score).toBe(41);
  });

  it("tolerates localStorage failures without throwing", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(readWearableSnapshot("user-a")).toBeNull();
    vi.restoreAllMocks();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    expect(() => writeWearableSnapshot("user-a", { recovery: { score: 90 } })).not.toThrow();
  });

  it("describes snapshot age compactly", () => {
    expect(describeSnapshotAge(1_000, 1_500)).toBe("just now");
    expect(describeSnapshotAge(1_000, 6 * 60_000 + 1_000)).toBe("6m ago");
    expect(describeSnapshotAge(1_000, 3 * 60 * 60_000 + 1_000)).toBe("3h ago");
    expect(describeSnapshotAge(1_000, 2 * 24 * 60 * 60_000 + 1_000)).toBe("2d ago");
    expect(describeSnapshotAge(null)).toBe("");
  });

  it("exports the current schema version for invalidation tests", () => {
    expect(SNAPSHOT_VERSION).toBe("1");
  });

  it("sanitizeSnapshot can be used defensively on legacy records", () => {
    expect(sanitizeSnapshot({ password: "x", safe: { bearer: "y", label: "ok" } })).toEqual({ safe: { label: "ok" } });
  });
});
