import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearRecoveryDashboardCache,
  getRecoveryCacheKey,
  readRecoveryDashboardCache,
  writeRecoveryDashboardCache,
} from "../recoveryDashboardSessionCache";

describe("recoveryDashboardSessionCache", () => {
  beforeEach(() => {
    clearRecoveryDashboardCache();
    vi.useRealTimers();
  });

  it("does not create a shared fallback key when user id is unavailable", () => {
    expect(getRecoveryCacheKey(null)).toBeNull();
    expect(getRecoveryCacheKey(undefined)).toBeNull();
    expect(getRecoveryCacheKey("")).toBeNull();
    expect(getRecoveryCacheKey("user-a")).toBe("recovery-user-a");
  });

  it("writes and reads a user-scoped recovery dashboard snapshot", () => {
    const snapshot = {
      connected: true,
      loading: false,
      recovery: { score: 82, band: "good" },
      rawMetrics: { hrv: "42 ms" },
    };

    writeRecoveryDashboardCache("user-a", snapshot);

    const cached = readRecoveryDashboardCache("user-a");
    expect(cached.recovery).toEqual(snapshot.recovery);
    expect(cached.rawMetrics).toEqual(snapshot.rawMetrics);
    expect(cached.cachedAt).toEqual(expect.any(Number));
  });

  it("isolates snapshots per user", () => {
    writeRecoveryDashboardCache("user-a", { recovery: { score: 80 } });
    writeRecoveryDashboardCache("user-b", { recovery: { score: 55 } });

    expect(readRecoveryDashboardCache("user-a").recovery.score).toBe(80);
    expect(readRecoveryDashboardCache("user-b").recovery.score).toBe(55);
  });

  it("clears one user's cache without clearing another user's cache", () => {
    writeRecoveryDashboardCache("user-a", { recovery: { score: 80 } });
    writeRecoveryDashboardCache("user-b", { recovery: { score: 55 } });

    clearRecoveryDashboardCache("user-a");

    expect(readRecoveryDashboardCache("user-a")).toBeNull();
    expect(readRecoveryDashboardCache("user-b").recovery.score).toBe(55);
  });

  it("ignores empty snapshots", () => {
    writeRecoveryDashboardCache("user-a", null);
    expect(readRecoveryDashboardCache("user-a")).toBeNull();
  });

  it("ignores writes when user id is unavailable", () => {
    writeRecoveryDashboardCache(undefined, { recovery: { score: 80 } });
    writeRecoveryDashboardCache(null, { recovery: { score: 70 } });
    expect(readRecoveryDashboardCache(undefined)).toBeNull();
    expect(readRecoveryDashboardCache(null)).toBeNull();
  });
});
