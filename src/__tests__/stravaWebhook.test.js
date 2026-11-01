// src/__tests__/stravaWebhook.test.js
// V13.3 · Strava webhook contract: subscription-challenge echo, and the API
// Agreement's deauthorization requirement — an athlete revoking access from
// Strava's side must purge their tokens and imported data. Also covers the
// targeted delete path so a removed Strava activity leaves the ledger.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

process.env.SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
process.env.STRAVA_WEBHOOK_VERIFY_TOKEN = "verify-me";
process.env.STRAVA_CLIENT_ID = "cid";
process.env.STRAVA_CLIENT_SECRET = "csecret";
process.env.STRAVA_REDIRECT_URI = "https://app.example/api/strava/callback";
process.env.TOKEN_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";

const handlerPromise = import("../../netlify/functions/strava-auth.js").then((m) => m.default);

const calls = [];
function mockFetch(routes) {
  return vi.fn(async (input, init = {}) => {
    const url = String(input);
    const method = (init.method || "GET").toUpperCase();
    calls.push({ url, method, body: init.body || null });
    for (const route of routes) {
      if (route.match(url, method)) return route.respond();
    }
    return { ok: true, status: 200, json: async () => ({}) };
  });
}

const jsonResponse = (data) => ({ ok: true, status: 200, json: async () => data });

beforeEach(() => { calls.length = 0; });
afterEach(() => { vi.unstubAllGlobals(); });

describe("Strava webhook", () => {
  it("echoes hub.challenge on a valid subscription GET", async () => {
    const handler = await handlerPromise;
    vi.stubGlobal("fetch", mockFetch([]));
    const res = await handler(new Request("https://app.example/api/strava/webhook?hub.verify_token=verify-me&hub.challenge=abc123", { method: "GET" }));
    const body = await res.json();
    expect(body["hub.challenge"]).toBe("abc123");
  });

  it("rejects a bad verify token", async () => {
    const handler = await handlerPromise;
    vi.stubGlobal("fetch", mockFetch([]));
    const res = await handler(new Request("https://app.example/api/strava/webhook?hub.verify_token=wrong&hub.challenge=abc123", { method: "GET" }));
    expect(res.status).toBe(403);
  });

  it("deauthorization purges the athlete's Strava data end to end", async () => {
    const handler = await handlerPromise;
    vi.stubGlobal("fetch", mockFetch([
      {
        match: (url, method) => method === "GET" && url.includes("/rest/v1/connected_accounts") && url.includes("provider_user_id=eq.777"),
        respond: () => jsonResponse([{ user_id: "user-1" }]),
      },
      {
        match: (url, method) => method === "GET" && url.includes("/rest/v1/activities") && url.includes("select=id"),
        respond: () => jsonResponse([]),
      },
    ]));
    const res = await handler(new Request("https://app.example/api/strava/webhook", {
      method: "POST",
      body: JSON.stringify({ object_type: "athlete", aspect_type: "update", owner_id: 777, object_id: 777, updates: { authorized: "false" } }),
      headers: { "content-type": "application/json" },
    }));
    expect((await res.json()).ok).toBe(true);
    const del = (table) => calls.filter((c) => c.method === "DELETE" && c.url.includes(`/rest/v1/${table}`) && c.url.includes("user_id=eq.user-1"));
    expect(del("connected_accounts").length).toBe(1);
    expect(del("activities").length).toBe(1);
    expect(del("provider_raw_payloads").length).toBe(1);
    const purgeLog = calls.find((c) => c.method === "POST" && c.url.includes("wearable_sync_events") && String(c.body).includes("deauthorized_purged"));
    expect(purgeLog).toBeTruthy();
  });

  it("an activity delete event drops that one normalized row", async () => {
    const handler = await handlerPromise;
    vi.stubGlobal("fetch", mockFetch([
      {
        match: (url, method) => method === "GET" && url.includes("/rest/v1/connected_accounts") && url.includes("provider_user_id=eq.777"),
        respond: () => jsonResponse([{ user_id: "user-1" }]),
      },
    ]));
    const res = await handler(new Request("https://app.example/api/strava/webhook", {
      method: "POST",
      body: JSON.stringify({ object_type: "activity", aspect_type: "delete", owner_id: 777, object_id: 42 }),
      headers: { "content-type": "application/json" },
    }));
    expect((await res.json()).ok).toBe(true);
    const rowDelete = calls.find((c) =>
      c.method === "DELETE" &&
      c.url.includes("/rest/v1/activities") &&
      c.url.includes("provider_activity_id=eq.42") &&
      c.url.includes("user_id=eq.user-1")
    );
    expect(rowDelete).toBeTruthy();
    // No purge on a plain activity event.
    expect(calls.some((c) => c.method === "DELETE" && c.url.includes("connected_accounts"))).toBe(false);
  });
});
