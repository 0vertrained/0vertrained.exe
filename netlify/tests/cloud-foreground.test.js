import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import oura from "../functions/oura-auth.js";
import whoop from "../functions/whoop-auth.js";
import strava from "../functions/strava-auth.js";
import { encryptSecret, resolveProviderTokens } from "../functions/_provider-standard.js";

const base = "https://example.supabase.test";
const owner = "athlete";
const lastSync = new Date().toISOString();
const expires = new Date(Date.now() + 3_600_000).toISOString();
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  for (const [key, value] of Object.entries({
    SUPABASE_URL: base, SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service",
    STRAVA_CLIENT_ID: "id", STRAVA_CLIENT_SECRET: "secret", STRAVA_REDIRECT_URI: "https://example.test",
    TOKEN_ENCRYPTION_KEY: "test-encryption-key", OURA_CLIENT_ID: "id", OURA_CLIENT_SECRET: "secret",
    WHOOP_CLIENT_ID: "id", WHOOP_CLIENT_SECRET: "secret",
  })) vi.stubEnv(key, value);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function account(overrides = {}) {
  return { user_id: owner, status: "connected", expires_at: expires, last_sync_at: lastSync,
    access_token_ciphertext: encryptSecret("access"), refresh_token_ciphertext: encryptSecret("refresh"), ...overrides };
}

function api(provider, path) {
  return new Request(`https://app.test/api/${provider}/${path}`, {
    method: path === "status" ? "GET" : "POST",
    headers: { authorization: "Bearer athlete-jwt" },
  });
}

function mockProvider(row, respond) {
  const fetch = vi.fn(async (input, options = {}) => {
    const url = String(input);
    const method = options.method || "GET";
    if (url.endsWith("/auth/v1/user")) return json({ id: owner });
    if (url.includes("/rest/v1/connected_accounts") && method === "GET") return json([row]);
    return respond(url, method, options.body) || json([]);
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("server truth used by foreground imports", () => {
  it("renews a routinely expired Strava credential even with fresh activities, without exposing tokens or changing the import date", async () => {
    let written;
    mockProvider(account({ expires_at: new Date(0).toISOString() }), (url, method, body) => {
      if (url.endsWith("/oauth/token")) return json({ access_token: "rotated-access", refresh_token: "rotated-refresh", expires_at: Math.floor(Date.parse(expires) / 1000) });
      if (method === "PATCH") { written = JSON.parse(body); return json([]); }
    });
    const status = await (await strava(api("strava", "status"))).json();
    expect(status).toMatchObject({ connected: true, isExpired: false, syncStatus: "synced", lastSynced: lastSync });
    expect(written.access_token_ciphertext).toMatch(/^v1\./);
    expect(written).not.toHaveProperty("last_sync_at");
    expect(JSON.stringify([written, status])).not.toContain("rotated-");
  });

  it.each([[400, "refresh_failed", true], [503, "refresh_pending", false]])(
    "distinguishes a rejected refresh grant from a transient Strava outage (%s)", async (code, syncStatus, isExpired) => {
      mockProvider(account({ expires_at: new Date(0).toISOString() }), url => url.endsWith("/oauth/token") && json({}, code));
      expect(await (await strava(api("strava", "status"))).json()).toMatchObject({ connected: true, syncStatus, isExpired });
    });

  it.each([["oura", oura], ["whoop", whoop], ["strava", strava]])(
    "distinguishes a temporary account store outage from a disconnected %s account", async (name, handler) => {
      vi.stubGlobal("fetch", async url => String(url).endsWith("/auth/v1/user") ? json({ id: owner }) : json({}, 503));
      expect((await handler(api(name, "status"))).status).toBe(502);
    });

  it.each([["oura", oura], ["whoop", whoop]])(
    "keeps a connected %s account eligible for retry after a temporary token endpoint failure", async (name, handler) => {
      mockProvider(account({ expires_at: new Date(0).toISOString() }), url => url.includes("/token") && json({}, 503));
      expect(await (await handler(api(name, "status"))).json()).toMatchObject({ connected: true, isExpired: false, syncStatus: "refresh_pending" });
    });

  it("does not import an explicitly revoked WHOOP account, even if older tokens still exist", async () => {
    const fetch = mockProvider(account({ status: "revoked" }), () => json([]));
    expect(await (await whoop(api("whoop", "status"))).json()).toMatchObject({ connected: false });
    expect(await resolveProviderTokens(base, "service", { userId: owner, provider: "whoop" })).toEqual({ ok: false, reason: "not_connected" });
    expect(fetch.mock.calls.some(([url]) => url.includes("whoop_tokens"))).toBe(false);
  });

  it("reports failure when Oura rejects every data read", async () => {
    mockProvider(account(), url => url.includes("api.ouraring.com") && json({}, 429));
    const summary = await (await oura(api("oura", "sync?days=3"))).json();
    expect(summary).toMatchObject({ ok: false, stored: 0 });
    expect(summary.failures).toHaveLength(5);
    expect(summary.failures.every(entry => entry.status === 429)).toBe(true);
  });

  it("does not advance Strava's last import when the activity insert fails", async () => {
    const fetch = mockProvider(account(), (url, method) => {
      if (url.includes("/athlete/activities")) return json([{ id: 1, start_date: lastSync }]);
      if (url.includes("/rest/v1/activities") && method === "POST") return json({}, 503);
    });
    expect((await strava(api("strava", "sync?days=3"))).status).toBe(502);
    expect(fetch.mock.calls.some(([, opts]) => opts.method === "PATCH")).toBe(false);
  });

  it.each([["oura", oura], ["whoop", whoop], ["strava", strava]])(
    "reports an unsuccessful %s disconnect if encrypted credentials could not be removed", async (provider, handler) => {
      mockProvider(account(), (url, method) => url.includes("/rest/v1/connected_accounts") && method === "DELETE" && json({}, 503));
      expect((await handler(api(provider, "disconnect"))).status).toBe(502);
    });
});
