import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  readCache,
  writeCache,
  clearCache,
  invalidateCache,
  getCacheStatus,
} from "../appDataCache";

describe("appDataCache — read/write/clear", () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("returns null when no cache exists for a userId", () => {
    const result = readCache("user-123");
    expect(result).toBe(null);
  });

  it("returns null when localStorage is unavailable", () => {
    // Mock localStorage.getItem to throw
    const originalGetItem = localStorage.getItem;
    localStorage.getItem = () => {
      throw new Error("localStorage disabled");
    };
    const result = readCache("user-123");
    expect(result).toBe(null);
    localStorage.getItem = originalGetItem;
  });

  it("writes and reads cache with entries, program, settings, myUsername", () => {
    const userId = "user-123";
    const cacheData = {
      entries: { "2024-01-01": { workout: { completed: true } } },
      program: { Monday: [{ name: "Squat", sets: 3 }] },
      settings: { goals: { calories: 3600 } },
      myUsername: "athlete",
    };

    writeCache(userId, cacheData);
    const result = readCache(userId);

    expect(result).not.toBe(null);
    expect(result.entries).toEqual(cacheData.entries);
    expect(result.program).toEqual(cacheData.program);
    expect(result.settings).toEqual(cacheData.settings);
    expect(result.myUsername).toEqual(cacheData.myUsername);
  });

  it("preserves timestamp and version in cached data", () => {
    const userId = "user-123";
    const cacheData = {
      entries: { "2024-01-01": {} },
      program: {},
      settings: {},
      myUsername: "athlete",
    };

    const beforeWrite = Date.now();
    writeCache(userId, cacheData);
    const result = readCache(userId);
    const afterWrite = Date.now();

    expect(result.timestamp).toBeDefined();
    expect(result.timestamp).toBeGreaterThanOrEqual(beforeWrite);
    expect(result.timestamp).toBeLessThanOrEqual(afterWrite);
    expect(result.version).toBeDefined();
  });

  it("returns null if cache version doesn't match current version", () => {
    const userId = "user-123";
    const cacheData = {
      entries: {},
      program: {},
      settings: {},
      myUsername: "athlete",
    };

    writeCache(userId, cacheData);

    // Corrupt the cache by changing version
    const stored = localStorage.getItem(`ovt-cache-${userId}`);
    const parsed = JSON.parse(stored);
    parsed.version = "999";
    localStorage.setItem(`ovt-cache-${userId}`, JSON.stringify(parsed));

    const result = readCache(userId);
    expect(result).toBe(null);
  });

  it("returns null if cached JSON is malformed", () => {
    const userId = "user-123";
    localStorage.setItem(`ovt-cache-${userId}`, "{invalid json");

    const result = readCache(userId);
    expect(result).toBe(null);
  });

  it("clears cache for a specific userId", () => {
    const userId = "user-123";
    const cacheData = {
      entries: {},
      program: {},
      settings: {},
      myUsername: "athlete",
    };

    writeCache(userId, cacheData);
    expect(readCache(userId)).not.toBe(null);

    clearCache(userId);
    expect(readCache(userId)).toBe(null);
  });

  it("does not clear cache for other userIds when clearing one", () => {
    const userId1 = "user-123";
    const userId2 = "user-456";
    const cacheData = {
      entries: {},
      program: {},
      settings: {},
      myUsername: "athlete",
    };

    writeCache(userId1, cacheData);
    writeCache(userId2, cacheData);

    clearCache(userId1);

    expect(readCache(userId1)).toBe(null);
    expect(readCache(userId2)).not.toBe(null);
  });

  it("tolerates localStorage write failure gracefully", () => {
    const userId = "user-123";
    const cacheData = {
      entries: {},
      program: {},
      settings: {},
      myUsername: "athlete",
    };

    // Mock localStorage.setItem to throw
    const originalSetItem = localStorage.setItem;
    localStorage.setItem = () => {
      throw new Error("QuotaExceededError");
    };

    // Should not throw, just silently fail
    expect(() => {
      writeCache(userId, cacheData);
    }).not.toThrow();

    localStorage.setItem = originalSetItem;
  });
});

describe("appDataCache — invalidateCache", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("invalidates the cache for a userId", () => {
    const userId = "user-123";
    const cacheData = {
      entries: { "2024-01-01": {} },
      program: {},
      settings: {},
      myUsername: "athlete",
    };

    writeCache(userId, cacheData);
    expect(readCache(userId)).not.toBe(null);

    invalidateCache(userId);
    expect(readCache(userId)).toBe(null);
  });

  it("invalidateCache works even if no cache exists", () => {
    expect(() => {
      invalidateCache("user-nonexistent");
    }).not.toThrow();
  });
});

describe("appDataCache — getCacheStatus", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("returns cached status when cache exists and is fresh", () => {
    const userId = "user-123";
    const cacheData = {
      entries: { "2024-01-01": {} },
      program: {},
      settings: {},
      myUsername: "athlete",
    };

    writeCache(userId, cacheData);
    const status = getCacheStatus(userId);

    expect(status.cached).toBe(true);
    expect(status.timestamp).toBeDefined();
    expect(status.stale).toBe(false);
  });

  it("returns not-cached status when no cache exists", () => {
    const status = getCacheStatus("user-nonexistent");

    expect(status.cached).toBe(false);
    expect(status.timestamp).toBeUndefined();
  });

  it("marks cache as stale after 5 minutes", () => {
    const userId = "user-123";
    const cacheData = {
      entries: {},
      program: {},
      settings: {},
      myUsername: "athlete",
    };

    writeCache(userId, cacheData);

    // Manually set timestamp to 6 minutes ago
    const stored = localStorage.getItem(`ovt-cache-${userId}`);
    const parsed = JSON.parse(stored);
    parsed.timestamp = Date.now() - 6 * 60 * 1000;
    localStorage.setItem(`ovt-cache-${userId}`, JSON.stringify(parsed));

    const status = getCacheStatus(userId);
    expect(status.cached).toBe(true);
    expect(status.stale).toBe(true);
  });

  it("marks cache as fresh within 5 minutes", () => {
    const userId = "user-123";
    const cacheData = {
      entries: {},
      program: {},
      settings: {},
      myUsername: "athlete",
    };

    writeCache(userId, cacheData);

    // Manually set timestamp to 2 minutes ago
    const stored = localStorage.getItem(`ovt-cache-${userId}`);
    const parsed = JSON.parse(stored);
    parsed.timestamp = Date.now() - 2 * 60 * 1000;
    localStorage.setItem(`ovt-cache-${userId}`, JSON.stringify(parsed));

    const status = getCacheStatus(userId);
    expect(status.cached).toBe(true);
    expect(status.stale).toBe(false);
  });
});
