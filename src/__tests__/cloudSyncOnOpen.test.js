import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syncCloudOnOpen } from "../integrations/cloudSync";
import { createWearableDataReads } from "../integrations/wearableDataReads";
import { disconnectOura, isOuraConnected, syncOuraNow } from "../oura/auth";
import { supabase } from "../supabaseClient";
import { syncStravaNow } from "../strava/auth";

vi.mock("../supabaseClient", () => ({ supabase: { auth: { getSession: vi.fn() } } }));
vi.mock("../demoData", () => ({ isDemoMode: () => false, DEMO_OURA_DATA: {}, getDemoWhoopData: () => ({}) }));

const now = Date.parse("2026-10-05T20:00:00Z");
const minute = 60_000;
let sequence = 0;
let owner;

function signIn(id) {
  owner = id;
  supabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id }, access_token: id + "-token" } } });
}

const json = (body, status = 200) => ({ ok: status < 300, status, json: async () => body });
function connection(overrides = {}) {
  return json({ connected: true, lastSynced: null, ...overrides });
}

function mockRoutes(routes) {
  const fetch = vi.fn((path, options) => {
    const [url] = path.split("?");
    const handler = routes[url];
    if (handler) return typeof handler === "function" ? handler(path, options) : handler;
    if (url.endsWith("/status")) return json({ connected: false });
    throw new Error("Unexpected request " + path);
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

beforeEach(() => {
  signIn("athlete-" + ++sequence);
  vi.spyOn(Date, "now").mockReturnValue(now);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("foreground cloud refresh", () => {
  it("imports a stale connection despite missing local flags, reuses recent server imports, and skips unlinked providers", async () => {
    const fetch = mockRoutes({
      "/api/oura/status": connection({ lastSynced: new Date(now - minute).toISOString() }),
      "/api/strava/status": connection({ isExpired: true, lastSynced: new Date(now - 6 * 86400000).toISOString() }),
      "/api/strava/sync": json({ ok: true, synced: 3 }),
    });
    expect(await syncCloudOnOpen({ owner })).toEqual({ oura: "fresh", whoop: "disconnected", strava: "synced" });
    expect(fetch.mock.calls.map(([path]) => path)).toEqual([
      "/api/oura/status", "/api/whoop/status", "/api/strava/status", "/api/strava/sync?days=8",
    ]);
    expect(fetch.mock.calls.every(([, options]) => options.headers.authorization === "Bearer " + owner + "-token")).toBe(true);
    expect(await syncCloudOnOpen({ owner })).toEqual({});
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("coalesces status checks and syncs across dashboards, manual imports and repeated foreground signals", async () => {
    const status = deferred();
    const sync = deferred();
    const fetch = mockRoutes({ "/api/oura/status": () => status.promise, "/api/oura/sync": () => sync.promise });
    const results = [isOuraConnected(), syncCloudOnOpen({ owner }), syncCloudOnOpen({ owner })];
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    results.push(syncOuraNow(30));
    status.resolve(connection());
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
    expect(fetch.mock.calls.at(-1)[0]).toBe("/api/oura/sync?days=30");
    sync.resolve(json({ ok: true, stored: 2 }));
    expect(await Promise.all(results)).toEqual([true, expect.objectContaining({ oura: "synced" }),
      expect.objectContaining({ oura: "synced" }), { ok: true, stored: 2 }]);
  });

  it("preserves the 90-day manual Strava backfill", async () => {
    const fetch = mockRoutes({ "/api/strava/sync": json({ ok: true }) });
    expect(await syncStravaNow(90)).toEqual({ ok: true });
    expect(fetch.mock.calls[0][0]).toBe("/api/strava/sync?days=90");
  });

  it("retries incomplete work even when a partial write advances the server timestamp", async () => {
    let calls = 0;
    const fetch = mockRoutes({
      "/api/oura/status": () => connection({ lastSynced: calls ? new Date(now).toISOString() : null }),
      "/api/oura/sync": () => json(++calls === 1 ? { ok: false, stored: 2 } : { ok: true, stored: 4 }),
      "/api/whoop/status": connection({ syncStatus: "refresh_failed" }),
      "/api/strava/status": connection(),
      "/api/strava/sync": json({}, 429),
    });
    expect(await syncCloudOnOpen({ owner })).toEqual({ oura: "partial", whoop: "needs_attention", strava: "retry" });
    vi.mocked(Date.now).mockReturnValue(now + 2 * minute);
    expect(await syncCloudOnOpen({ owner })).toEqual({ oura: "synced" });
    expect(fetch.mock.calls.filter(([path]) => path.includes("/strava/sync"))).toHaveLength(1);
  });

  it("requires the active owner and suppresses a pending sync after logout", async () => {
    const status = deferred();
    const fetch = mockRoutes({ "/api/oura/status": () => status.promise });
    expect(await syncCloudOnOpen({ owner: "someone-else" })).toEqual({});
    expect(fetch).not.toHaveBeenCalled();
    const controller = new AbortController();
    const running = syncCloudOnOpen({ owner, signal: controller.signal });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    controller.abort();
    signIn("replacement-athlete");
    status.resolve(connection());
    expect(await running).toEqual({});
    expect(fetch.mock.calls.find(([path]) => path.includes("/sync"))).toBeUndefined();
    expect(await isOuraConnected()).toBe(true);
    expect(fetch.mock.calls.at(-1)[1].headers.authorization).toBe("Bearer replacement-athlete-token");
  });

  it("serializes a disconnect behind an active import and drops any success cooldown", async () => {
    const pendingSync = deferred();
    let connected = true;
    const fetch = mockRoutes({
      "/api/oura/status": () => json({ connected }),
      "/api/oura/sync": () => pendingSync.promise,
      "/api/oura/disconnect": () => { connected = false; return json({ ok: true }); },
    });
    const started = syncCloudOnOpen({ owner });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
    const disconnect = disconnectOura();
    await Promise.resolve();
    expect(fetch.mock.calls.some(([path]) => path.endsWith("/disconnect"))).toBe(false);
    pendingSync.resolve(json({ ok: true }));
    expect(await disconnect).toEqual({ ok: true });
    expect(await started).not.toHaveProperty("oura");
    expect(await isOuraConnected()).toBe(false);
    expect(await syncCloudOnOpen({ owner })).toEqual({ oura: "disconnected" });
    expect(fetch.mock.calls.filter(([path]) => path.includes("/sync"))).toHaveLength(1);
  });
});

it("detaches old row reads after sync and isolates simultaneous athlete data queries", async () => {
  const gates = [];
  const query = vi.fn((days, id) => {
    const gate = deferred();
    gates.push({ id, gate });
    return gate.promise;
  });
  const reads = createWearableDataReads(query, () => ({}));
  const old = reads.load();
  await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(1));
  reads.invalidate(owner);
  const fresh = reads.load();
  await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(2));
  gates[0].gate.resolve("old");
  expect(await old).toBe("old");
  const sharesFresh = reads.load();
  await Promise.resolve();
  signIn("other-athlete");
  const other = reads.load();
  await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(3));
  expect(gates[1].id).not.toEqual(gates[2].id);
  gates[1].gate.resolve("updated");
  gates[2].gate.resolve("other");
  expect(await Promise.all([fresh, sharesFresh, other])).toEqual(["updated", "updated", "other"]);
});
