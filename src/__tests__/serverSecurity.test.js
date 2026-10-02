import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

describe("serverless security guards", () => {
  test("coach rejects oversized bodies before env/auth work", async () => {
    const { default: coach } = await import("../../netlify/functions/coach.js");
    const req = new Request("https://example.test/api/coach", {
      method: "POST",
      headers: { "content-length": "128001" },
      body: "{}",
    });

    const res = await coach(req);
    expect(res.status).toBe(413);
    await expect(res.json()).resolves.toMatchObject({ error: "Request body too large" });
  });

  test("oura auth derives callback redirect from the live deployment origin when env redirect is stale", async () => {
    process.env.OURA_CLIENT_ID = "client-id";
    process.env.OURA_CLIENT_SECRET = "client-secret";
    process.env.OURA_REDIRECT_URI = "https://stale-preview.netlify.app/api/oura/callback";
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon-key";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("/auth/v1/user")) {
        return new Response(JSON.stringify({ id: "user-1" }), { status: 200 });
      }
      // V13.6 · state is now persisted to provider_oauth_state before redirect.
      if (String(url).includes("/rest/v1/provider_oauth_state")) {
        return new Response(null, { status: 201 });
      }
      return new Response("not found", { status: 404 });
    });

    const { default: ouraAuth } = await import("../../netlify/functions/oura-auth.js");
    const req = new Request("https://0vertrained.netlify.app/api/oura/auth", {
      method: "GET",
      headers: { accept: "application/json", authorization: "Bearer user-jwt" },
    });

    const res = await ouraAuth(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    const authorizeUrl = new URL(body.url);
    expect(authorizeUrl.origin + authorizeUrl.pathname).toBe("https://cloud.ouraring.com/oauth/authorize");
    expect(authorizeUrl.searchParams.get("redirect_uri")).toBe(`https://${"0vertrained"}.netlify.app/api/oura/callback`);
    expect(authorizeUrl.searchParams.get("response_type")).toBe("code");
    expect(authorizeUrl.searchParams.get("scope")).toBe("personal daily heartrate spo2");
  });

  test("oura auth derives callback redirect when custom-domain env uses the wrong callback path", async () => {
    process.env.OURA_CLIENT_ID = "client-id";
    process.env.OURA_CLIENT_SECRET = "client-secret";
    process.env.OURA_REDIRECT_URI = `https://${"0vertrained"}.com/callback`;
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon-key";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("/auth/v1/user")) {
        return new Response(JSON.stringify({ id: "user-1" }), { status: 200 });
      }
      if (String(url).includes("/rest/v1/provider_oauth_state")) {
        return new Response(null, { status: 201 });
      }
      return new Response("not found", { status: 404 });
    });

    const { default: ouraAuth } = await import("../../netlify/functions/oura-auth.js");
    const req = new Request("https://0vertrained.com/api/oura/auth", {
      method: "GET",
      headers: { accept: "application/json", authorization: "Bearer user-jwt" },
    });

    const res = await ouraAuth(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    const authorizeUrl = new URL(body.url);
    expect(authorizeUrl.searchParams.get("redirect_uri")).toBe(`https://${"0vertrained"}.com/api/oura/callback`);
  });

  test("oura auth no longer accepts unauthenticated userId query params", async () => {
    process.env.OURA_CLIENT_ID = "client-id";
    process.env.OURA_CLIENT_SECRET = "client-secret";
    process.env.OURA_REDIRECT_URI = "https://example.test/api/oura/callback";
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon-key";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

    const { default: ouraAuth } = await import("../../netlify/functions/oura-auth.js");
    const req = new Request("https://example.test/api/oura/auth?userId=victim", {
      method: "GET",
      headers: { accept: "application/json" },
    });

    const res = await ouraAuth(req);
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ error: "Not authenticated" });
  });

  test("oura sync rejects oversized bodies before parsing JSON", async () => {
    const { default: ouraSync } = await import("../../netlify/functions/oura-sync.js");
    const req = new Request("https://example.test/api/oura/sync", {
      method: "POST",
      headers: { "content-length": "256001" },
      body: "{}",
    });

    const res = await ouraSync(req);
    expect(res.status).toBe(413);
    await expect(res.json()).resolves.toMatchObject({ error: "Request body too large" });
  });

  test("oura sync stores each data_type in its own batch and reports failures without leaking tokens", async () => {
    process.env.OURA_SYNC_SECRET = "sync-secret";
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    process.env.TOKEN_ENCRYPTION_KEY = "server-security-test-key";

    const ouraDataPosts = [];
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, opts = {}) => {
      const href = String(url);
      const method = (opts.method || "GET").toUpperCase();
      // V14 · Encrypted store empty → resolve falls back to the legacy row and
      // migrates it (connected_accounts POST + oura_tokens DELETE below).
      if (href.includes("/rest/v1/connected_accounts")) {
        if (method === "GET") return new Response(JSON.stringify([]), { status: 200 });
        return new Response(null, { status: 201 });
      }
      // Legacy token row: not expired so no refresh path.
      if (href.includes("/rest/v1/oura_tokens")) {
        if (method === "DELETE") return new Response(null, { status: 204 });
        return new Response(
          JSON.stringify([{ access_token: "at", refresh_token: "rt", expires_at: "2999-01-01T00:00:00.000Z" }]),
          { status: 200 }
        );
      }
      // Oura API: return one doc per non-heartrate type, heartrate as raw payload.
      if (href.includes("api.ouraring.com")) {
        if (href.includes("/heartrate")) {
          return new Response(JSON.stringify({ data: [{ bpm: 60 }] }), { status: 200 });
        }
        return new Response(JSON.stringify({ data: [{ day: "2026-06-30", score: 80 }] }), { status: 200 });
      }
      // Supabase storage POST: fail only the heartrate batch to prove isolation.
      if (href.includes("/rest/v1/oura_data")) {
        const rows = JSON.parse(opts.body);
        ouraDataPosts.push(rows);
        if (rows.some((row) => row.data_type === "heartrate")) {
          return new Response("permission denied for column access_token", { status: 500 });
        }
        return new Response(null, { status: 201 });
      }
      return new Response("not found", { status: 404 });
    });

    const { default: ouraSync } = await import("../../netlify/functions/oura-sync.js");
    const req = new Request("https://example.test/api/oura/sync", {
      method: "POST",
      headers: { authorization: "Bearer sync-secret", "content-type": "application/json" },
      body: JSON.stringify({ user_id: "user-1" }),
    });

    const res = await ouraSync(req);
    expect(res.status).toBe(200);
    const body = await res.json();

    // Each data_type posted separately (no single all-or-nothing POST).
    expect(ouraDataPosts.length).toBeGreaterThan(1);
    for (const rows of ouraDataPosts) {
      const types = new Set(rows.map((r) => r.data_type));
      expect(types.size).toBe(1);
    }

    // Only heartrate failed; other types still succeeded and are not reported.
    expect(body.ok).toBe(false);
    expect(body.failed_types).toEqual(["heartrate"]);
    expect(body.stored).toBeGreaterThan(0);

    // Failure logged with status + data_type, and the service role key never leaks.
    const logged = errSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toContain("data_type=heartrate");
    expect(logged).toContain("status=500");
    expect(logged).not.toContain("service-role-key");
  });

  test("oura status verifies bearer token and never returns stored OAuth tokens", async () => {
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon-key";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    process.env.TOKEN_ENCRYPTION_KEY = "server-security-test-key";

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const href = String(url);
      if (href.includes("/auth/v1/user")) {
        return new Response(JSON.stringify({ id: "user-1" }), { status: 200 });
      }
      if (href.includes("/rest/v1/connected_accounts")) {
        // V14 · Status reads presence from the encrypted store. Ciphertexts may
        // travel server-side; the assertions below prove nothing token-shaped
        // ever reaches the browser response.
        return new Response(JSON.stringify([{
          user_id: "user-1",
          provider: "oura",
          refresh_token_ciphertext: "v1.iv.tag.ct",
          access_token_ciphertext: "v1.iv.tag.ct",
          expires_at: "2999-01-01T00:00:00.000Z",
        }]), { status: 200 });
      }
      if (href.includes("/rest/v1/oura_tokens")) {
        // Legacy fallback path must never select the access token either.
        expect(href).not.toContain("access_token");
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (href.includes("/rest/v1/oura_data")) {
        return new Response(JSON.stringify([{ synced_at: new Date().toISOString() }]), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    });

    const { default: ouraAuth } = await import("../../netlify/functions/oura-auth.js");
    const req = new Request("https://example.test/api/oura/status", {
      method: "GET",
      headers: { authorization: "Bearer user-jwt" },
    });

    const res = await ouraAuth(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ connected: true, isExpired: false });
    expect(body.access_token).toBeUndefined();
    expect(body.refresh_token).toBeUndefined();
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("ciphertext");
    expect(serialized).not.toContain("v1.iv.tag.ct");
    expect(fetchSpy).toHaveBeenCalled();
  });

  test("oura callback consumes the state row exactly once (replay of the same state fails)", async () => {
    // V13.6 · Proves the DB-backed one-time state: the callback reads the row,
    // then DELETEs it. A replayed callback with the same state finds no row and
    // is rejected. This is the property the old HMAC-signed state lacked.
    process.env.OURA_CLIENT_ID = "client-id";
    process.env.OURA_CLIENT_SECRET = "client-secret";
    process.env.OURA_REDIRECT_URI = "https://example.test/api/oura/callback";
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon-key";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    process.env.TOKEN_ENCRYPTION_KEY = "replay-test-encryption-key";

    // Minimal in-memory provider_oauth_state store keyed by the state value.
    const store = new Map([["state-xyz", { user_id: "user-1", expires_at: new Date(Date.now() + 60000).toISOString() }]]);
    let tokenExchangeCalls = 0;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const u = String(url);
      if (u.includes("/rest/v1/provider_oauth_state")) {
        const method = (init?.method || "GET").toUpperCase();
        const match = u.match(/state=eq\.([^&]+)/);
        const stateVal = match ? decodeURIComponent(match[1]) : null;
        if (method === "GET") {
          const row = stateVal && store.has(stateVal) ? [store.get(stateVal)] : [];
          return new Response(JSON.stringify(row), { status: 200 });
        }
        if (method === "DELETE") {
          if (stateVal) store.delete(stateVal);
          return new Response(null, { status: 204 });
        }
      }
      if (u.includes("api.ouraring.com/oauth/token")) {
        tokenExchangeCalls += 1;
        return new Response(JSON.stringify({ access_token: "a", refresh_token: "r", expires_in: 3600 }), { status: 200 });
      }
      // Any post-token writes (profiles/connected_accounts) succeed quietly.
      return new Response(JSON.stringify([{}]), { status: 200 });
    });

    const { default: ouraAuth } = await import("../../netlify/functions/oura-auth.js");
    const makeCallback = () => ouraAuth(new Request("https://example.test/api/oura/callback?code=abc&state=state-xyz", { method: "GET" }));

    const first = await makeCallback();
    // First use consumes the row (redirect back to settings, not a 400).
    expect(first.status).toBeLessThan(400);
    // The first callback did reach token exchange; the replay must not.
    expect(tokenExchangeCalls).toBe(1);

    const second = await makeCallback();
    // Replay: row already deleted → invalid state, rejected before token exchange.
    expect(second.status).toBe(400);
    await expect(second.json()).resolves.toMatchObject({ error: "Invalid or expired state" });
    expect(tokenExchangeCalls).toBe(1);
  });
});
