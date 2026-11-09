// Contract tests for the encrypted-token cutover helpers.
// These pin the properties the whole cutover rests on:
//   1. Encrypted rows win — a decryptable connected_accounts row means the
//      legacy table is never even read.
//   2. Legacy fallback SELF-MIGRATES — read plaintext once, encrypt it into
//      connected_accounts, delete the plaintext row.
//   3. Fail-closed without the key — no token resolution, and critically no
//      legacy read, so we never handle plaintext we can't re-store.
//   4. The status summary works WITHOUT the key (presence only, no secrets).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PROVIDERS,
  encryptSecret,
  tokenEncryptionConfigured,
  persistProviderTokens,
  resolveProviderTokens,
  getProviderConnectionSummary,
  listProviderConnectedUserIds,
} from "../functions/_provider-standard.js";

const URL_BASE = "https://project.supabase.co";
const KEY = "service-role-key";
const USER = "user-1";

function makeEnv(withKey = true) {
  return withKey ? { TOKEN_ENCRYPTION_KEY: "test-encryption-key-material" } : {};
}

// Records every REST call so assertions can check which tables were touched.
function mockRest(handlers) {
  const calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    const u = String(url);
    const method = (init?.method || "GET").toUpperCase();
    calls.push({ url: u, method, body: init?.body });
    for (const h of handlers) {
      if (u.includes(h.match) && (!h.method || h.method === method)) {
        return h.respond(u, init);
      }
    }
    return new Response(JSON.stringify([]), { status: 200 });
  }));
  return calls;
}

describe("token cutover helpers", () => {
  beforeEach(() => { vi.unstubAllGlobals(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("tokenEncryptionConfigured reflects the env", () => {
    expect(tokenEncryptionConfigured(makeEnv(true))).toBe(true);
    expect(tokenEncryptionConfigured(makeEnv(false))).toBe(false);
  });

  it("resolve prefers the encrypted row and never touches the legacy table", async () => {
    const env = makeEnv(true);
    const account = {
      user_id: USER, provider: PROVIDERS.OURA,
      access_token_ciphertext: encryptSecret("access-abc", env),
      refresh_token_ciphertext: encryptSecret("refresh-xyz", env),
      expires_at: "2027-01-01T00:00:00.000Z",
      scopes_granted: ["daily"],
    };
    const calls = mockRest([
      { match: "/rest/v1/connected_accounts", respond: () => new Response(JSON.stringify([account]), { status: 200 }) },
    ]);

    const res = await resolveProviderTokens(URL_BASE, KEY, { userId: USER, provider: PROVIDERS.OURA, env });
    expect(res.ok).toBe(true);
    expect(res.source).toBe("encrypted");
    expect(res.accessToken).toBe("access-abc");
    expect(res.refreshToken).toBe("refresh-xyz");
    expect(calls.some(c => c.url.includes("oura_tokens"))).toBe(false);
  });

  it("legacy fallback migrates: encrypts into connected_accounts and deletes the plaintext row", async () => {
    const env = makeEnv(true);
    const legacyRow = { access_token: "legacy-access", refresh_token: "legacy-refresh", expires_at: "2026-08-01T00:00:00.000Z" };
    const calls = mockRest([
      { match: "/rest/v1/connected_accounts", method: "GET", respond: () => new Response(JSON.stringify([]), { status: 200 }) },
      { match: "/rest/v1/connected_accounts", method: "POST", respond: () => new Response(null, { status: 201 }) },
      { match: "/rest/v1/oura_tokens", method: "GET", respond: () => new Response(JSON.stringify([legacyRow]), { status: 200 }) },
      { match: "/rest/v1/oura_tokens", method: "DELETE", respond: () => new Response(null, { status: 204 }) },
    ]);

    const res = await resolveProviderTokens(URL_BASE, KEY, { userId: USER, provider: PROVIDERS.OURA, env });
    expect(res.ok).toBe(true);
    expect(res.source).toBe("legacy_migrated");
    expect(res.accessToken).toBe("legacy-access");

    const upsert = calls.find(c => c.url.includes("connected_accounts") && c.method === "POST");
    expect(upsert).toBeTruthy();
    const record = JSON.parse(upsert.body);
    // The stored record is ciphertext, never the plaintext token.
    expect(record.access_token_ciphertext).toMatch(/^v1\./);
    expect(JSON.stringify(record)).not.toContain("legacy-access");
    expect(calls.some(c => c.url.includes("oura_tokens") && c.method === "DELETE")).toBe(true);
  });

  it("refuses to resolve without the encryption key — and does not read the legacy table", async () => {
    const calls = mockRest([]);
    const res = await resolveProviderTokens(URL_BASE, KEY, { userId: USER, provider: PROVIDERS.WHOOP, env: makeEnv(false) });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("encryption_not_configured");
    expect(calls.length).toBe(0);
  });

  it("returns not_connected when neither row exists", async () => {
    mockRest([]);
    const res = await resolveProviderTokens(URL_BASE, KEY, { userId: USER, provider: PROVIDERS.WHOOP, env: makeEnv(true) });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("not_connected");
  });

  it("persistProviderTokens writes ciphertext and clears the legacy row", async () => {
    const env = makeEnv(true);
    const calls = mockRest([
      { match: "/rest/v1/connected_accounts", method: "POST", respond: () => new Response(null, { status: 201 }) },
      { match: "/rest/v1/whoop_tokens", method: "DELETE", respond: () => new Response(null, { status: 204 }) },
    ]);
    const res = await persistProviderTokens(URL_BASE, KEY, {
      userId: USER, provider: PROVIDERS.WHOOP,
      accessToken: "tok-a", refreshToken: "tok-r", expiresAt: "2026-08-01T00:00:00.000Z", scopes: ["read:recovery"], env,
    });
    expect(res.ok).toBe(true);
    expect(calls.some(c => c.url.includes("whoop_tokens") && c.method === "DELETE")).toBe(true);
  });

  it("persistProviderTokens fails closed without the key — nothing is written anywhere", async () => {
    const calls = mockRest([]);
    const res = await persistProviderTokens(URL_BASE, KEY, {
      userId: USER, provider: PROVIDERS.WHOOP, accessToken: "tok", refreshToken: "tok", env: makeEnv(false),
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("encryption_not_configured");
    expect(calls.length).toBe(0);
  });

  it("connection summary reports presence without decrypting, even with no key", async () => {
    mockRest([
      { match: "/rest/v1/connected_accounts", respond: () => new Response(JSON.stringify([]), { status: 200 }) },
      { match: "/rest/v1/whoop_tokens", respond: () => new Response(JSON.stringify([{ refresh_token: "r", expires_at: "2026-08-01T00:00:00.000Z" }]), { status: 200 }) },
    ]);
    const summary = await getProviderConnectionSummary(URL_BASE, KEY, USER, PROVIDERS.WHOOP, makeEnv(false));
    expect(summary.connected).toBe(true);
    expect(summary.source).toBe("legacy");
    expect(summary.hasRefreshToken).toBe(true);
    expect(summary.tokenEncryptionConfigured).toBe(false);
  });

  it("enumeration unions encrypted and legacy rows, deduped and capped", async () => {
    mockRest([
      { match: "/rest/v1/connected_accounts", respond: () => new Response(JSON.stringify([{ user_id: "a" }, { user_id: "b" }]), { status: 200 }) },
      { match: "/rest/v1/oura_tokens", respond: () => new Response(JSON.stringify([{ user_id: "b" }, { user_id: "c" }]), { status: 200 }) },
    ]);
    const ids = await listProviderConnectedUserIds(URL_BASE, KEY, PROVIDERS.OURA, 25);
    expect(ids).toEqual(["a", "b", "c"]);
  });

  it("enumeration tolerates a dropped legacy table (post-v31)", async () => {
    mockRest([
      { match: "/rest/v1/connected_accounts", respond: () => new Response(JSON.stringify([{ user_id: "a" }]), { status: 200 }) },
      { match: "/rest/v1/oura_tokens", respond: () => new Response(JSON.stringify({ message: "relation does not exist" }), { status: 404 }) },
    ]);
    const ids = await listProviderConnectedUserIds(URL_BASE, KEY, PROVIDERS.OURA, 25);
    expect(ids).toEqual(["a"]);
  });
});
