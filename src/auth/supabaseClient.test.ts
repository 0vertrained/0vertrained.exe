import { afterEach, describe, expect, it } from "vitest";
import { MemoryStorage } from "../test/memoryStorage";
import { createFakeAuthClient } from "./fakeAuthClient";
import { AUTH_STORAGE_KEY, getAuthClient, hasStoredSession, setAuthClientForTests } from "./supabaseClient";

afterEach(() => setAuthClientForTests(null));

describe("hasStoredSession", () => {
  it("is true only when the auth key is present", () => {
    const storage = new MemoryStorage();
    expect(hasStoredSession(storage)).toBe(false);
    storage.setItem(AUTH_STORAGE_KEY, "{}");
    expect(hasStoredSession(storage)).toBe(true);
  });

  it("reads window.localStorage by default", () => {
    expect(hasStoredSession()).toBe(false);
    window.localStorage.setItem(AUTH_STORAGE_KEY, "{}");
    expect(hasStoredSession()).toBe(true);
  });

  it("is false when storage is missing or throws", () => {
    expect(hasStoredSession(null)).toBe(false);
    const broken = { getItem: () => { throw new Error("blocked"); } };
    expect(hasStoredSession(broken)).toBe(false);
  });
});

describe("getAuthClient", () => {
  it("returns the injected test client without loading supabase-js", async () => {
    const fake = createFakeAuthClient();
    setAuthClientForTests(fake);
    await expect(getAuthClient()).resolves.toBe(fake);
  });

  it("rejects when no backend is configured", async () => {
    await expect(getAuthClient()).rejects.toThrow("No backend is configured.");
  });
});
