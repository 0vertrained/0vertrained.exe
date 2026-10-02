// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchServerSnapshot,
  fetchServerSnapshotStatus,
  postServerSnapshot,
} from "../wearables/snapshot";

// In the test env Supabase has no config → the mock client returns a null
// session, so getAccessToken() resolves to null. That lets us exercise the
// unauthenticated + demo paths without any real network.
describe("wearables/snapshot client", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns the empty display-safe shape when unauthenticated (no token)", async () => {
    const result = await fetchServerSnapshot();
    expect(result).toEqual({
      snapshot: null, source: null, updatedAt: null, status: "empty", hasSnapshot: false,
    });
  });

  it("returns an empty status when unauthenticated", async () => {
    const status = await fetchServerSnapshotStatus();
    expect(status).toEqual({ hasSnapshot: false, status: "empty", updatedAt: null, source: null });
  });

  it("skips the server POST when there is no token, without throwing", async () => {
    const res = await postServerSnapshot({ recovery: { score: 80 } }, { source: "oura" });
    expect(res).toEqual({ skipped: true });
  });

  it("skips the POST for a non-object snapshot", async () => {
    expect(await postServerSnapshot(null)).toEqual({ skipped: true });
  });

  it("demo mode returns synthetic empty/safe shapes and never hits the network", async () => {
    vi.stubEnv("VITE_DEMO_MODE", "true");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(await fetchServerSnapshot()).toEqual({
      snapshot: null, source: null, updatedAt: null, status: "empty", hasSnapshot: false,
    });
    expect(await fetchServerSnapshotStatus()).toEqual({
      hasSnapshot: false, status: "empty", updatedAt: null, source: null,
    });
    expect(await postServerSnapshot({ recovery: { score: 90 } })).toEqual({ ok: true, demo: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
