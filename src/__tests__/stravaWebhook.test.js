// src/__tests__/stravaWebhook.test.js
// Strava webhook contract: subscription-challenge echo, and the API
// Agreement's deauthorization requirement — an athlete revoking access from
// Strava's side must purge their tokens and imported data. Strava doesn't sign
// its events, so a purge or an activity delete waits for Strava itself to
// confirm it, and an optional secret callback path refuses everything else.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { encryptSecret } from "../../netlify/functions/_provider-standard.js";

process.env.SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
process.env.STRAVA_WEBHOOK_VERIFY_TOKEN = "verify-me";
process.env.STRAVA_CLIENT_ID = "cid";
process.env.STRAVA_CLIENT_SECRET = "csecret";
process.env.STRAVA_REDIRECT_URI = "https://app.example/api/strava/callback";
process.env.TOKEN_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";

const moduleP = import("../../netlify/functions/strava-auth.js");
const handlerPromise = moduleP.then((m) => m.default);

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

const jsonResponse = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });

const storedAccount = () => ({
  id: "acct-1",
  user_id: "user-1",
  provider: "strava",
  provider_user_id: "777",
  access_token_ciphertext: encryptSecret("access-777"),
  refresh_token_ciphertext: encryptSecret("refresh-777"),
  scopes_granted: [],
  expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  status: "connected",
});

// The athlete with Strava id 777 is user-1 here.
const knownAthlete = [
  {
    match: (url, method) => method === "GET" && url.includes("/rest/v1/connected_accounts") && url.includes("provider_user_id=eq.777"),
    respond: () => jsonResponse([{ user_id: "user-1" }]),
  },
  {
    match: (url, method) => method === "GET" && url.includes("/rest/v1/connected_accounts") && url.includes("user_id=eq.user-1"),
    respond: () => jsonResponse([storedAccount()]),
  },
];

const stravaAthlete = (status) => ({
  match: (url, method) => method === "GET" && url === "https://www.strava.com/api/v3/athlete",
  respond: () => jsonResponse({}, status),
});

const stravaActivity = (status) => ({
  match: (url, method) => method === "GET" && url === "https://www.strava.com/api/v3/activities/42",
  respond: () => jsonResponse({ id: 42 }, status),
});

const storedActivity = (rows) => ({
  match: (url, method) => method === "GET" && url.includes("/rest/v1/activities") && url.includes("provider_activity_id=eq.42"),
  respond: () => jsonResponse(rows),
});

const deauthEvent = { object_type: "athlete", aspect_type: "update", owner_id: 777, object_id: 777, subscription_id: 9, updates: { authorized: "false" } };
const deleteEvent = { object_type: "activity", aspect_type: "delete", owner_id: 777, object_id: 42, subscription_id: 9 };

function post(body, path = "/api/strava/webhook", headers = {}) {
  return new Request(`https://app.example${path}`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
  });
}

const deletes = (table) => calls.filter((c) => c.method === "DELETE" && c.url.includes(`/rest/v1/${table}`));
const logged = (eventType) => calls.find((c) => c.method === "POST" && c.url.includes("wearable_sync_events") && String(c.body).includes(eventType));

const ENV_KEYS = ["STRAVA_WEBHOOK_SECRET", "STRAVA_SUBSCRIPTION_ID"];
const savedEnv = {};

beforeEach(() => {
  calls.length = 0;
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe("Strava webhook subscription check", () => {
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
});

describe("Strava deauthorization", () => {
  it("purges the athlete's Strava data once Strava refuses the token", async () => {
    const handler = await handlerPromise;
    vi.stubGlobal("fetch", mockFetch([
      ...knownAthlete,
      stravaAthlete(401),
      {
        match: (url, method) => method === "GET" && url.includes("/rest/v1/activities") && url.includes("select=id"),
        respond: () => jsonResponse([]),
      },
    ]));
    const res = await handler(post(deauthEvent));
    expect((await res.json()).ok).toBe(true);
    const forUser = (table) => deletes(table).filter((c) => c.url.includes("user_id=eq.user-1"));
    expect(forUser("connected_accounts").length).toBe(1);
    expect(forUser("activities").length).toBe(1);
    expect(forUser("provider_raw_payloads").length).toBe(1);
    expect(logged("deauthorized_purged")).toBeTruthy();
  });

  it("deletes nothing when Strava still accepts the token", async () => {
    const handler = await handlerPromise;
    vi.stubGlobal("fetch", mockFetch([...knownAthlete, stravaAthlete(200)]));
    const res = await handler(post(deauthEvent));
    expect(res.status).toBe(200);
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    expect(logged("deauthorize_ignored")).toBeTruthy();
  });

  it("deletes nothing and asks Strava to retry when Strava can't confirm", async () => {
    const handler = await handlerPromise;
    vi.stubGlobal("fetch", mockFetch([...knownAthlete, stravaAthlete(503)]));
    const res = await handler(post(deauthEvent));
    expect(res.status).toBe(503);
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    expect(logged("deauthorize_unconfirmed")).toBeTruthy();
  });
});

describe("Strava activity events", () => {
  it("drops the stored row once Strava answers 404 for the activity", async () => {
    const handler = await handlerPromise;
    vi.stubGlobal("fetch", mockFetch([...knownAthlete, storedActivity([{ id: "row-42" }]), stravaActivity(404)]));
    const res = await handler(post(deleteEvent));
    expect((await res.json()).ok).toBe(true);
    const rowDelete = deletes("activities").find((c) => c.url.includes("provider_activity_id=eq.42") && c.url.includes("user_id=eq.user-1"));
    expect(rowDelete).toBeTruthy();
    // No purge on a plain activity event.
    expect(deletes("connected_accounts").length).toBe(0);
  });

  it("keeps the row when Strava still has the activity", async () => {
    const handler = await handlerPromise;
    vi.stubGlobal("fetch", mockFetch([...knownAthlete, storedActivity([{ id: "row-42" }]), stravaActivity(200)]));
    await handler(post(deleteEvent));
    expect(deletes("activities").length).toBe(0);
  });

  it("doesn't ask Strava about an activity that was never stored", async () => {
    const handler = await handlerPromise;
    vi.stubGlobal("fetch", mockFetch([...knownAthlete, storedActivity([])]));
    await handler(post(deleteEvent));
    expect(calls.some((c) => c.url.startsWith("https://www.strava.com/"))).toBe(false);
    expect(deletes("activities").length).toBe(0);
  });
});

describe("Strava webhook input", () => {
  it("keeps nothing for an athlete nobody here connected", async () => {
    const handler = await handlerPromise;
    vi.stubGlobal("fetch", mockFetch([
      {
        match: (url, method) => method === "GET" && url.includes("/rest/v1/connected_accounts"),
        respond: () => jsonResponse([]),
      },
    ]));
    const res = await handler(post({ ...deleteEvent, owner_id: 555 }));
    expect(res.status).toBe(200);
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("stores only the event fields it uses", async () => {
    const handler = await handlerPromise;
    vi.stubGlobal("fetch", mockFetch([...knownAthlete, storedActivity([])]));
    await handler(post({ ...deleteEvent, junk: "x".repeat(500), updates: { title: "Run", note: "y".repeat(500) } }));
    const stored = calls.find((c) => c.method === "POST" && c.url.includes("/rest/v1/provider_webhook_events"));
    const payload = JSON.parse(stored.body).payload;
    expect(payload.junk).toBeUndefined();
    expect(payload.updates).toEqual({ title: "Run" });
    expect(payload.owner_id).toBe("777");
  });

  it("refuses a body that isn't a Strava event, before any lookup", async () => {
    const handler = await handlerPromise;
    vi.stubGlobal("fetch", mockFetch([]));
    for (const body of ["not json", { ...deleteEvent, owner_id: "777 OR 1=1" }, { ...deleteEvent, object_type: "route" }, { ...deleteEvent, object_id: -4 }]) {
      const res = await handler(post(body));
      expect(res.status).toBe(400);
    }
    expect(calls.length).toBe(0);
  });

  it("refuses an oversized body without reading it", async () => {
    const handler = await handlerPromise;
    vi.stubGlobal("fetch", mockFetch([]));
    const res = await handler(post(deleteEvent, "/api/strava/webhook", { "content-length": "100000" }));
    expect(res.status).toBe(413);
    expect(calls.length).toBe(0);
  });

  it("refuses another subscription's events when the subscription id is set", async () => {
    process.env.STRAVA_SUBSCRIPTION_ID = "12";
    const handler = await handlerPromise;
    vi.stubGlobal("fetch", mockFetch([]));
    const res = await handler(post(deleteEvent));
    expect(res.status).toBe(403);
    expect(calls.length).toBe(0);
  });
});

describe("Strava webhook secret path", () => {
  it("answers 404 off the secret path and works on it", async () => {
    process.env.STRAVA_WEBHOOK_SECRET = "a-long-random-path-secret";
    const handler = await handlerPromise;
    vi.stubGlobal("fetch", mockFetch([...knownAthlete, storedActivity([])]));

    expect((await handler(post(deleteEvent))).status).toBe(404);
    expect((await handler(post(deleteEvent, "/api/strava/webhook/wrong-secret"))).status).toBe(404);
    expect(calls.length).toBe(0);

    const res = await handler(post(deleteEvent, "/api/strava/webhook/a-long-random-path-secret"));
    expect(res.status).toBe(200);
    expect(calls.some((c) => c.url.includes("provider_user_id=eq.777"))).toBe(true);
  });

  it("answers Strava's subscription check on the secret path", async () => {
    process.env.STRAVA_WEBHOOK_SECRET = "a-long-random-path-secret";
    const handler = await handlerPromise;
    vi.stubGlobal("fetch", mockFetch([]));
    const res = await handler(new Request("https://app.example/api/strava/webhook/a-long-random-path-secret?hub.verify_token=verify-me&hub.challenge=xyz", { method: "GET" }));
    expect((await res.json())["hub.challenge"]).toBe("xyz");
  });
});

describe("parseStravaEvent", () => {
  it("keeps Strava's ids as strings and drops unknown update keys", async () => {
    const { parseStravaEvent } = await moduleP;
    expect(parseStravaEvent({ ...deauthEvent, updates: { authorized: "false", extra: 1 } })).toMatchObject({
      objectType: "athlete",
      aspectType: "update",
      ownerId: "777",
      objectId: "777",
      subscriptionId: "9",
      updates: { authorized: "false" },
    });
    expect(parseStravaEvent(null)).toBe(null);
    expect(parseStravaEvent([deleteEvent])).toBe(null);
  });
});
