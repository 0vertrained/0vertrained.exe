// src/__tests__/wearablePrefetchSnapshot.test.js
// Scheduled wearable-prefetch snapshot materialization.
//
// The netlify function is self-contained but exports its pure derivation +
// secret-stripping helpers for cheap unit tests, and the default handler is
// exercised end-to-end with a URL-routed global.fetch mock (same style as
// src/__tests__/serverSecurity.test.js).

import { afterEach, beforeEach, describe, expect, it, test, vi } from "vitest";
import { decryptSecret } from "../../netlify/functions/_provider-standard.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  deriveOuraDisplaySnapshot,
  stripSecretsDeep,
} from "../../netlify/functions/wearable-prefetch.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const prefetchSrc = readFileSync(
  resolve(__dirname, "..", "..", "netlify/functions/wearable-prefetch.js"),
  "utf8"
);

// ── pure helpers ──────────────────────────────────────────────────────────────

describe("deriveOuraDisplaySnapshot", () => {
  const rows = [
    {
      date: "2026-07-08",
      data_type: "readiness",
      payload: { data: [{ day: "2026-07-08", score: 88, temperature_deviation: -0.2 }] },
    },
    {
      date: "2026-07-08",
      data_type: "sleep",
      payload: { data: [{ day: "2026-07-08", average_hrv: 62, lowest_heart_rate: 48, average_heart_rate: 55, efficiency: 91 }] },
    },
    {
      // Older day — must not be chosen over the newer one above.
      date: "2026-07-01",
      data_type: "readiness",
      payload: { data: [{ day: "2026-07-01", score: 40 }] },
    },
  ];

  it("derives a compact snapshot for the most recent day with data", () => {
    const snap = deriveOuraDisplaySnapshot(rows);
    expect(snap.provider).toBe("oura");
    expect(snap.date).toBe("2026-07-08");
    expect(snap.connected).toBe(true);
    expect(snap.recovery.score).toBe(88);
    expect(snap.recovery.scoredDay).toBe("2026-07-08");
    expect(snap.readiness.score).toBe(88);
    expect(snap.rawMetrics.hrv).toBe("62 ms");
    expect(snap.rawMetrics.rhr).toBe("48 bpm");
    expect(snap.hrv.score).toBe(31);
  });

  it("returns null when there is nothing displayable", () => {
    expect(deriveOuraDisplaySnapshot([])).toBeNull();
    expect(deriveOuraDisplaySnapshot(null)).toBeNull();
    expect(deriveOuraDisplaySnapshot([{ date: "2026-07-08", data_type: "activity", payload: { data: [{}] } }])).toBeNull();
  });

  it("strips token-like fields even if a payload doc smuggles one in", () => {
    const dirty = [{
      date: "2026-07-08",
      data_type: "readiness",
      payload: { data: [{ day: "2026-07-08", score: 88, access_token: "leak", nested: { refresh_token: "leak", jwt: "leak" } }] },
    }];
    const snap = deriveOuraDisplaySnapshot(dirty);
    expect(JSON.stringify(snap)).not.toContain("leak");
    expect(snap.readiness.score).toBe(88);
  });
});

describe("stripSecretsDeep", () => {
  it("removes secret-bearing keys recursively but keeps display values", () => {
    const out = stripSecretsDeep({
      score: 91,
      authorization: "Bearer x",
      service_role_key: "x",
      nested: { client_secret: "x", label: "kept" },
      arr: [{ jwt: "x", provider: "oura" }],
    });
    expect(JSON.stringify(out)).not.toContain("Bearer");
    expect(out.score).toBe(91);
    expect(out.nested.label).toBe("kept");
    expect(out.arr[0].provider).toBe("oura");
  });
});

// ── end-to-end handler ─────────────────────────────────────────────────────────

const ENV = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  OURA_SYNC_SECRET: "sync-secret",
  // Resolve/persist are fail-closed without this key.
  TOKEN_ENCRYPTION_KEY: "prefetch-test-encryption-key",
  // Needed for the server-side Whoop token refresh path in the prefetch.
  WHOOP_CLIENT_ID: "whoop-client-id",
  WHOOP_CLIENT_SECRET: "whoop-client-secret",
};

const FUTURE_ISO = () => new Date(Date.now() + 3600 * 1000).toISOString();
const PAST_ISO = () => new Date(Date.now() - 3600 * 1000).toISOString();

// One dated Whoop record per data_type (enough to date + store). `start` gives
// pickRecordDate a confident calendar date.
const whoopRecord = (type) => ({ id: `${type}-1`, start: "2026-07-08T06:00:00.000Z", score: { x: 1 } });

// A URL-routed fetch mock that records what the handler did. `opts` lets a test
// tweak individual leg behaviour (e.g. force a snapshot upsert failure, an
// expired Whoop token, a cycle-only Whoop window, or a whoop_data store failure).
function installFetchMock(opts = {}) {
  const calls = {
    ouraTokensSelects: [], whoopTokensSelects: [], ouraDataSelects: [],
    snapshotUpserts: [], syncEvents: [], syncPosts: [],
    whoopTokenRefreshes: [], whoopTokenPatches: [], whoopApiFetches: [],
    whoopDataUpserts: [], order: [],
  };
  // Stateful stores so the mock behaves like the real cutover: a persist
  // (connected_accounts POST) becomes readable by later per-user GETs, and a
  // legacy DELETE actually removes the plaintext row.
  const accountStore = new Map(); // `${user_id}:${provider}` → last upserted record
  const legacyWhoop = new Map(
    (opts.whoopTokens ?? [
      { user_id: "user-1", access_token: "at-current", refresh_token: "rt-current", expires_at: FUTURE_ISO(), scope: "read:recovery" },
    ]).map((row) => [row.user_id, row])
  );
  const userIdFrom = (href) => {
    const m = String(href).match(/user_id=eq\.([^&]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init = {}) => {
    const href = String(url);
    const method = (init.method || "GET").toUpperCase();

    if (href.includes("/rest/v1/connected_accounts")) {
      if (method === "GET") {
        const uid = userIdFrom(href);
        if (uid) {
          const rec = accountStore.get(`${uid}:whoop`) || accountStore.get(`${uid}:oura`);
          return new Response(JSON.stringify(rec ? [rec] : []), { status: 200 });
        }
        // Enumeration GET — encrypted store starts empty; users arrive via the
        // legacy union, exercising the migration path end-to-end.
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (method === "POST") {
        const record = init.body ? JSON.parse(init.body) : {};
        accountStore.set(`${record.user_id}:${record.provider}`, record);
        if (record.provider === "whoop") {
          // Decrypt with the test key so assertions speak plaintext while the
          // wire stays ciphertext-only.
          calls.whoopTokenPatches.push({
            access_token: decryptSecret(record.access_token_ciphertext, ENV),
            refresh_token: decryptSecret(record.refresh_token_ciphertext, ENV),
            ciphertext: record.access_token_ciphertext,
          });
          calls.order.push("whoop_token_patch");
        }
        return new Response(null, { status: 201 });
      }
    }
    if (href.includes("/rest/v1/oura_tokens")) {
      if (method === "DELETE") return new Response(null, { status: 204 });
      calls.ouraTokensSelects.push(href);
      return new Response(JSON.stringify(opts.ouraTokens ?? [{ user_id: "user-1" }]), { status: 200 });
    }
    if (href.includes("/rest/v1/whoop_tokens") && method === "GET") {
      calls.whoopTokensSelects.push(href);
      const uid = userIdFrom(href);
      if (uid) {
        const row = legacyWhoop.get(uid);
        return new Response(JSON.stringify(row ? [row] : []), { status: 200 });
      }
      return new Response(JSON.stringify([...legacyWhoop.values()]), { status: 200 });
    }
    if (href.includes("/rest/v1/whoop_tokens") && method === "DELETE") {
      const uid = userIdFrom(href);
      if (uid) legacyWhoop.delete(uid);
      return new Response(null, { status: 204 });
    }
    if (href.includes("/oauth/oauth2/token")) {
      // Whoop token refresh.
      calls.whoopTokenRefreshes.push(href);
      calls.order.push("whoop_token_refresh");
      if (opts.whoopRefreshOk === false) return new Response("bad", { status: 401 });
      return new Response(JSON.stringify({ access_token: "at-rotated", refresh_token: "rt-rotated", expires_in: 3600, scope: "read:recovery" }), { status: 200 });
    }
    if (href.includes("api.prod.whoop.com/developer/v2")) {
      // Whoop collection fetch. Route by path → data_type.
      calls.whoopApiFetches.push(href);
      calls.order.push("whoop_api_fetch");
      const records = opts.whoopRecords ?? {
        recovery: [whoopRecord("recovery")],
        sleep: [whoopRecord("sleep")],
        cycle: [whoopRecord("cycle")],
        workout: [whoopRecord("workout")],
      };
      let type = "recovery";
      if (href.includes("/activity/sleep")) type = "sleep";
      else if (href.includes("/activity/workout")) type = "workout";
      else if (href.includes("/cycle")) type = "cycle";
      else if (href.includes("/recovery")) type = "recovery";
      return new Response(JSON.stringify({ records: records[type] || [] }), { status: 200 });
    }
    if (href.includes("/rest/v1/whoop_data")) {
      calls.whoopDataUpserts.push(init.body ? JSON.parse(init.body) : null);
      calls.order.push("whoop_data_upsert");
      return new Response(null, { status: opts.whoopDataStatus ?? 201 });
    }
    if (href.includes("/api/oura/sync")) {
      calls.syncPosts.push(href);
      const ok = opts.ouraSyncOk ?? true;
      return new Response(JSON.stringify({ ok, counts: { readiness: 1 } }), { status: ok ? 200 : 502 });
    }
    if (href.includes("/rest/v1/oura_data")) {
      calls.ouraDataSelects.push(href);
      const rows = opts.ouraData ?? [
        { date: "2026-07-08", data_type: "readiness", payload: { data: [{ day: "2026-07-08", score: 88 }] } },
        { date: "2026-07-08", data_type: "sleep", payload: { data: [{ day: "2026-07-08", average_hrv: 62, lowest_heart_rate: 48 }] } },
      ];
      return new Response(JSON.stringify(rows), { status: 200 });
    }
    if (href.includes("/rest/v1/wearable_snapshots")) {
      const body = init.body ? JSON.parse(init.body) : null;
      calls.snapshotUpserts.push(body);
      return new Response(null, { status: opts.snapshotUpsertStatus ?? 201 });
    }
    if (href.includes("/rest/v1/wearable_sync_events")) {
      calls.syncEvents.push(init.body ? JSON.parse(init.body) : null);
      return new Response(null, { status: 201 });
    }
    return new Response("not found", { status: 404 });
  });
  return calls;
}

async function runHandler() {
  const { default: prefetch } = await import("../../netlify/functions/wearable-prefetch.js");
  const req = new Request("https://example.test/.netlify/functions/wearable-prefetch", { method: "POST" });
  const res = await prefetch(req);
  return { res, body: await res.json() };
}

describe("wearable-prefetch handler snapshot materialization", () => {
  beforeEach(() => { Object.assign(process.env, ENV); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("upserts a wearable_snapshots row for a user after a successful Oura sync", async () => {
    const calls = installFetchMock();
    const { body } = await runHandler();

    expect(body.oura.success).toBe(1);
    expect(body.oura.snapshots).toBe(1);
    expect(calls.snapshotUpserts.length).toBe(1);
    const upsert = calls.snapshotUpserts[0];
    expect(upsert.user_id).toBe("user-1");
    expect(upsert.source).toBe("oura");
    expect(upsert.snapshot.recovery.score).toBe(88);
    expect(upsert.snapshot.rawMetrics.hrv).toBe("62 ms");
    expect(upsert.snapshot.hrv.score).toBe(31);
    expect(upsert.snapshot.connected).toBe(true);
  });

  it("stores no token-like fields even if oura_data smuggles one in", async () => {
    const calls = installFetchMock({
      ouraData: [{
        date: "2026-07-08",
        data_type: "readiness",
        payload: { data: [{ day: "2026-07-08", score: 88, access_token: "leak", refresh_token: "leak" }] },
      }],
    });
    await runHandler();
    expect(JSON.stringify(calls.snapshotUpserts[0])).not.toContain("leak");
  });

  it("caps the batch at 25 users / select limit 25", async () => {
    const calls = installFetchMock();
    await runHandler();
    expect(calls.ouraTokensSelects[0]).toContain("limit=25");
    expect(calls.whoopTokensSelects[0]).toContain("limit=25");
  });

  it("actually syncs connected Whoop users (real server-side sync, not noted-only)", async () => {
    const calls = installFetchMock({
      whoopTokens: [
        { user_id: "user-1", access_token: "at1", refresh_token: "rt1", expires_at: FUTURE_ISO() },
        { user_id: "user-2", access_token: "at2", refresh_token: "rt2", expires_at: FUTURE_ISO() },
      ],
    });
    const { body } = await runHandler();

    expect(body.whoop.connected).toBe(2);
    expect(body.whoop.attempted).toBe(2);
    expect(body.whoop.success).toBe(2);
    // No stale "noted" bookkeeping remains.
    expect(body.whoop.noted).toBeUndefined();

    // A real Whoop data fetch + whoop_data upsert happened for the users.
    expect(calls.whoopApiFetches.length).toBeGreaterThan(0);
    expect(calls.whoopDataUpserts.length).toBeGreaterThan(0);

    // Events are real sync events (event_type "sync", 14-day window), never "info noted".
    const whoopEvents = calls.syncEvents.filter((e) => e.source === "whoop");
    expect(whoopEvents.length).toBe(2);
    for (const e of whoopEvents) {
      expect(e.event_type).toBe("sync");
      expect(e.status).toBe("success");
      expect(e.days).toBe(14);
      expect(e.message).not.toMatch(/helper extraction pending/i);
    }
    // Whoop never writes a wearable_snapshots row (only Oura materializes snapshots).
    expect(calls.snapshotUpserts.every((s) => s.source !== "whoop")).toBe(true);
  });

  it("refreshes an expired Whoop token and persists the rotated token BEFORE fetching data", async () => {
    const calls = installFetchMock({
      whoopTokens: [{ user_id: "user-1", access_token: "at-old", refresh_token: "rt-old", expires_at: PAST_ISO() }],
    });
    const { body } = await runHandler();

    expect(body.whoop.success).toBe(1);
    // The refresh happened and the rotated token was persisted ENCRYPTED.
    // (V14: an earlier persist is the legacy→encrypted migration of the old
    // row; the FINAL persist must carry the rotation.)
    expect(calls.whoopTokenRefreshes.length).toBe(1);
    const finalPersist = calls.whoopTokenPatches.at(-1);
    expect(finalPersist.access_token).toBe("at-rotated");
    expect(finalPersist.refresh_token).toBe("rt-rotated");
    expect(finalPersist.ciphertext).toMatch(/^v1\./);
    // Ordering: refresh → persist rotated token → only THEN fetch Whoop data.
    const lastPatchIdx = calls.order.lastIndexOf("whoop_token_patch");
    const firstFetchIdx = calls.order.indexOf("whoop_api_fetch");
    expect(lastPatchIdx).toBeGreaterThanOrEqual(0);
    expect(firstFetchIdx).toBeGreaterThan(lastPatchIdx);
  });

  it("marks a Whoop sync partial (not fake success) when only cycle data is available", async () => {
    const calls = installFetchMock({
      whoopTokens: [{ user_id: "user-1", access_token: "at", refresh_token: "rt", expires_at: FUTURE_ISO() }],
      whoopRecords: { recovery: [], sleep: [], cycle: [whoopRecord("cycle")], workout: [] },
    });
    const { body } = await runHandler();

    expect(body.whoop.partial).toBe(1);
    expect(body.whoop.success).toBe(0);
    const e = calls.syncEvents.find((ev) => ev.source === "whoop");
    expect(e.status).toBe("partial");
    expect(e.status).not.toBe("success");
    expect(e.message).toMatch(/only cycle data/i);
  });

  it("logs a failed Whoop sync (never fake success) when whoop_data storage fails", async () => {
    const calls = installFetchMock({
      whoopTokens: [{ user_id: "user-1", access_token: "at", refresh_token: "rt", expires_at: FUTURE_ISO() }],
      whoopDataStatus: 500,
    });
    const { body } = await runHandler();

    expect(body.whoop.failed).toBe(1);
    expect(body.whoop.success).toBe(0);
    const e = calls.syncEvents.find((ev) => ev.source === "whoop");
    expect(e.status).toBe("failed");
    expect(e.status).not.toBe("success");
  });

  it("logs a failed Whoop sync when an expired token cannot be refreshed", async () => {
    const calls = installFetchMock({
      whoopTokens: [{ user_id: "user-1", access_token: "at-old", refresh_token: "rt-old", expires_at: PAST_ISO() }],
      whoopRefreshOk: false,
    });
    const { body } = await runHandler();

    expect(body.whoop.failed).toBe(1);
    expect(body.whoop.success).toBe(0);
    // Refresh failed → no data fetch and no whoop_data upsert attempted.
    expect(calls.whoopApiFetches.length).toBe(0);
    expect(calls.whoopDataUpserts.length).toBe(0);
    const e = calls.syncEvents.find((ev) => ev.source === "whoop");
    expect(e.status).toBe("failed");
    expect(e.message).toMatch(/reconnect needed/i);
  });

  it("never leaks Whoop tokens into scheduled sync-event logs or snapshots", async () => {
    const calls = installFetchMock({
      whoopTokens: [{ user_id: "user-1", access_token: "SECRET-AT", refresh_token: "SECRET-RT", expires_at: PAST_ISO() }],
    });
    await runHandler();
    const serialized = JSON.stringify({ events: calls.syncEvents, snapshots: calls.snapshotUpserts });
    expect(serialized).not.toContain("SECRET-AT");
    expect(serialized).not.toContain("SECRET-RT");
    expect(serialized).not.toContain("at-rotated");
    expect(serialized).not.toContain("rt-rotated");
  });

  it("does not fake provider success when snapshot materialization fails", async () => {
    const calls = installFetchMock({ snapshotUpsertStatus: 500 });
    const { body } = await runHandler();

    // The provider sync itself really succeeded and stays counted as success…
    expect(body.oura.success).toBe(1);
    // …while the snapshot failure is isolated and surfaced separately.
    expect(body.oura.snapshots).toBe(0);
    expect(body.oura.snapshot_failed).toBe(1);
    // The success event still reflects the real sync; a separate info note logs the miss.
    const ouraEvents = calls.syncEvents.filter((e) => e.source === "oura");
    expect(ouraEvents.some((e) => e.status === "success")).toBe(true);
    expect(ouraEvents.some((e) => e.status === "info" && /snapshot/i.test(e.message))).toBe(true);
  });

  it("does not attempt a snapshot when the Oura sync failed", async () => {
    const calls = installFetchMock({ ouraSyncOk: false });
    const { body } = await runHandler();
    expect(body.oura.failed).toBe(1);
    expect(body.oura.snapshots).toBe(0);
    expect(calls.snapshotUpserts.length).toBe(0);
  });
});

// ── static security invariants for the scheduled path ───────────────────────────
describe("wearable-prefetch static security", () => {
  test("scheduled Whoop path never trusts a body/query user_id", () => {
    // The scheduled prefetch is a public endpoint; ownership must come only from
    // the service-role enumeration, never a caller-supplied id.
    expect(prefetchSrc).not.toMatch(/searchParams\.get\(["']user_id["']\)/);
    expect(prefetchSrc).not.toMatch(/body\.user_id/);
    expect(prefetchSrc).not.toMatch(/body\?\.user_id/);
    // Enumeration goes through the encrypted-store union helper, and the
    // prefetch never selects plaintext token columns from any table.
    expect(prefetchSrc).toMatch(/listProviderConnectedUserIds/);
    expect(prefetchSrc).not.toMatch(/whoop_tokens[^\n]*access_token/);
    expect(prefetchSrc).not.toMatch(/supabaseSelect\(/);
  });

  test("removes the engineering-jargon 'helper extraction pending' log message", () => {
    expect(prefetchSrc).not.toMatch(/helper extraction pending/i);
    // The stale noted-only bookkeeping (counter + increment) is gone.
    expect(prefetchSrc).not.toMatch(/\.noted\b/);
    expect(prefetchSrc).not.toMatch(/noted:\s*0/);
  });

  test("logs Whoop tokens via the shared logSyncEvent, never a raw token in a log", () => {
    // No console line or event body echoes access_token / refresh_token values.
    expect(prefetchSrc).not.toMatch(/console\.\w+\([^)]*\baccess_token\b/);
    expect(prefetchSrc).not.toMatch(/message:[^,}]*access_token/);
    expect(prefetchSrc).not.toMatch(/message:[^,}]*refresh_token/);
  });

  test("reuses the shared 14-day Whoop window from whoop-auth.js (no divergent constant)", () => {
    expect(prefetchSrc).toMatch(/SYNC_DAYS as WHOOP_SYNC_DAYS/);
    expect(prefetchSrc).toMatch(/from ["']\.\/whoop-auth\.js["']/);
  });
});
