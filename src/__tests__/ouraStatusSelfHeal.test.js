// V12.1 hardening — /api/oura/status self-healing. Updated for V14: tokens
// live encrypted in connected_accounts; the legacy oura_tokens table is only
// a one-shot migration fallback.
//
// The status endpoint must silently refresh an expired / near-expired Oura
// access token instead of surfacing a "reconnect" prompt for a normal token
// lifetime. These tests drive the real Netlify handler with a mocked fetch and
// assert the network side-effects (Oura refresh + encrypted connected_accounts
// persist) and two invariants: tokens are never returned to the client, and
// plaintext is NEVER written to oura_tokens.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import handler from "../../netlify/functions/oura-auth.js";
import { encryptSecret } from "../../netlify/functions/_provider-standard.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");
const fnSrc = readFileSync(resolve(repoRoot, "netlify/functions/oura-auth.js"), "utf8");

const OURA_TOKEN_URL = "https://api.ouraring.com/oauth/token";
const SUPA = "https://supabase.test";
const USER_ID = "user-abc";
const ENC_ENV = { TOKEN_ENCRYPTION_KEY: "status-test-encryption-key" };

function res(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

// Build an encrypted connected_accounts row the way the real persist path does.
function encryptedAccountRow({ refreshToken = "stored-refresh", accessToken = "stored-access", expiresAt }) {
  return {
    user_id: USER_ID,
    provider: "oura",
    access_token_ciphertext: encryptSecret(accessToken, ENC_ENV),
    refresh_token_ciphertext: encryptSecret(refreshToken, ENC_ENV),
    expires_at: expiresAt,
    scopes_granted: ["personal", "daily", "heartrate", "spo2"],
  };
}

// Fetch mock over the routes handleStatus touches. `opts.accountRow` controls
// the stored encrypted row; `opts.refreshOk` toggles the Oura refresh result.
function installFetch({ accountRow, refreshOk = true, lastSynced = null }) {
  const calls = [];
  const impl = async (url, options = {}) => {
    const method = (options.method || "GET").toUpperCase();
    calls.push({ url: String(url), method, body: options.body });

    if (String(url).includes("/auth/v1/user")) {
      return res({ id: USER_ID });
    }
    if (String(url).startsWith(OURA_TOKEN_URL)) {
      if (!refreshOk) return res("invalid_grant", { ok: false, status: 400 });
      return res({
        access_token: "new-access-token",
        refresh_token: "rotated-refresh-token",
        expires_in: 3600,
      });
    }
    if (String(url).includes("/rest/v1/connected_accounts")) {
      if (method === "GET") return res(accountRow ? [accountRow] : []);
      return res(null, { status: 201 }); // encrypted persist upsert
    }
    if (String(url).includes("/rest/v1/oura_tokens")) {
      if (method === "GET") return res([]); // legacy drained — nothing to fall back to
      return res(null, { status: 204 }); // legacy cleanup DELETE
    }
    if (String(url).includes("/rest/v1/oura_data")) {
      return res(lastSynced ? [{ synced_at: lastSynced }] : []);
    }
    if (String(url).includes("/rest/v1/wearable_sync_events")) {
      return res(null, { status: 204 }); // event log
    }
    throw new Error(`unexpected fetch: ${method} ${url}`);
  };
  const mock = vi.fn(impl);
  vi.stubGlobal("fetch", mock);
  return calls;
}

function statusRequest() {
  return new Request("https://app.test/api/oura/status", {
    method: "GET",
    headers: { authorization: "Bearer supa-jwt", accept: "application/json" },
  });
}

const persistCalls = (calls) =>
  calls.filter((c) => c.url.includes("/rest/v1/connected_accounts") && c.method === "POST");
const legacyWriteCalls = (calls) =>
  calls.filter((c) => c.url.includes("/rest/v1/oura_tokens") && (c.method === "PATCH" || c.method === "POST"));
const refreshCalls = (calls) =>
  calls.filter((c) => c.url.startsWith(OURA_TOKEN_URL) && c.method === "POST");

describe("V12.1 /api/oura/status self-healing (V14 encrypted store)", () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = SUPA;
    process.env.SUPABASE_ANON_KEY = "anon-key";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
    process.env.OURA_CLIENT_ID = "client-id";
    process.env.OURA_CLIENT_SECRET = "client-secret";
    process.env.TOKEN_ENCRYPTION_KEY = ENC_ENV.TOKEN_ENCRYPTION_KEY;
  });
  afterEach(() => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test("expired token → refresh called → encrypted persist → connected, not expired, no tokens leaked", async () => {
    const expiredAt = new Date(Date.now() - 60_000).toISOString();
    const calls = installFetch({
      accountRow: encryptedAccountRow({ expiresAt: expiredAt }),
      refreshOk: true,
    });

    const response = await handler(statusRequest());
    expect(response.status).toBe(200);
    const body = await response.json();

    // Refresh endpoint was hit and the rotated token was persisted ENCRYPTED.
    expect(refreshCalls(calls)).toHaveLength(1);
    expect(persistCalls(calls)).toHaveLength(1);
    const persisted = JSON.parse(persistCalls(calls)[0].body);
    expect(persisted.access_token_ciphertext).toMatch(/^v1\./);
    expect(JSON.stringify(persisted)).not.toContain("new-access-token");
    expect(JSON.stringify(persisted)).not.toContain("rotated-refresh-token");

    // Plaintext is never written to the legacy table.
    expect(legacyWriteCalls(calls)).toHaveLength(0);

    // Self-healed: connected + not expired, with a fresh future expiry.
    expect(body.connected).toBe(true);
    expect(body.isExpired).toBe(false);
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());

    // Never leak tokens to the client.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/access_token/i);
    expect(serialized).not.toMatch(/refresh_token/i);
    expect(serialized).not.toContain("new-access-token");
    expect(serialized).not.toContain("rotated-refresh-token");
  });

  test("refresh failure → connected true, isExpired true, syncStatus refresh_failed (not disconnected)", async () => {
    const expiredAt = new Date(Date.now() - 60_000).toISOString();
    const calls = installFetch({
      accountRow: encryptedAccountRow({ expiresAt: expiredAt }),
      refreshOk: false,
    });

    const response = await handler(statusRequest());
    const body = await response.json();

    expect(refreshCalls(calls)).toHaveLength(1);
    // A failed refresh persists nothing.
    expect(persistCalls(calls)).toHaveLength(0);
    expect(legacyWriteCalls(calls)).toHaveLength(0);

    expect(body.connected).toBe(true); // do not lie that it is disconnected
    expect(body.isExpired).toBe(true);
    expect(body.syncStatus).toBe("refresh_failed");
  });

  test("unexpired token → no refresh, no persist, reported healthy", async () => {
    const futureAt = new Date(Date.now() + 45 * 60_000).toISOString();
    const calls = installFetch({
      accountRow: encryptedAccountRow({ expiresAt: futureAt }),
      refreshOk: true,
      lastSynced: new Date(Date.now() - 3_600_000).toISOString(),
    });

    const response = await handler(statusRequest());
    const body = await response.json();

    expect(refreshCalls(calls)).toHaveLength(0);
    expect(persistCalls(calls)).toHaveLength(0);
    expect(body.connected).toBe(true);
    expect(body.isExpired).toBe(false);
    expect(body.expiresAt).toBe(futureAt);
  });

  test("near-expiry (< 5 min) token proactively refreshes before it expires", async () => {
    const soonAt = new Date(Date.now() + 60_000).toISOString(); // 1 min left
    const calls = installFetch({
      accountRow: encryptedAccountRow({ expiresAt: soonAt }),
      refreshOk: true,
    });

    const response = await handler(statusRequest());
    const body = await response.json();

    expect(refreshCalls(calls)).toHaveLength(1);
    expect(persistCalls(calls)).toHaveLength(1);
    expect(body.isExpired).toBe(false);
  });

  test("static: status derives the user from the Bearer token, never a query/body user_id", () => {
    const statusFn = fnSrc.slice(
      fnSrc.indexOf("async function handleStatus"),
      fnSrc.indexOf("async function handleDisconnect")
    );
    expect(statusFn).toMatch(/resolveUserIdFromBearer\(req\)/);
    expect(statusFn).not.toMatch(/searchParams\.get\(["']user_id["']\)/);
    expect(statusFn).not.toMatch(/body\.user_id/);
    // Status reads presence via the summary helper — no plaintext token
    // selects appear anywhere in the status handler.
    expect(statusFn).toMatch(/getProviderConnectionSummary/);
    expect(statusFn).not.toMatch(/select=refresh_token/);
  });
});
