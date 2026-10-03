// @vitest-environment node
// v20 · Contract tests for /api/next/account-recovery. One PBKDF2 hash is
// computed once up front (≈0.3 s) and reused; the function itself always runs
// the full 600k iterations, so each verifying test costs about that much.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pbkdf2Sync } from "node:crypto";
import handler, { config } from "../functions/account-recovery-next.js";

const URL_BASE = "https://next-project.supabase.co";
const SERVICE_KEY = "next-service-role-key";
const ENV_KEYS = ["NEXT_SUPABASE_URL", "NEXT_SUPABASE_ANON_KEY", "NEXT_SUPABASE_SERVICE_ROLE_KEY"];
const saved = {};

const PHRASE = "correct horse battery staple";
const PASSWORD = "n3wPassword!";
const SALT = "ab".repeat(16);
const HASH = pbkdf2Sync(PHRASE, SALT, 600_000, 32, "sha256").toString("hex");
const PROFILE = { id: "user-7", recovery_hash: HASH, recovery_salt: SALT, recovery_kdf: "pbkdf2-sha256-600k" };
const GENERIC = "The username or recovery phrase didn't match.";
const UNAVAILABLE = "Account recovery is unavailable right now.";
const ALLOWED = { allowed: true, retry_after_seconds: 0, attempts: 1 };

// Records every call. `rpc`, `profile` and `admin` override each endpoint's
// response (a function so it can throw).
function mockRest({ rpc, profile, admin } = {}) {
  const calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    const u = String(url);
    const method = (init?.method || "GET").toUpperCase();
    calls.push({ url: u, method, headers: init?.headers || {}, body: init?.body });
    if (u.includes("/rest/v1/rpc/bump_recovery_attempt")) return rpc ? rpc() : new Response(JSON.stringify(ALLOWED), { status: 200 });
    if (u.includes("/rest/v1/profiles")) return profile ? profile() : new Response(JSON.stringify([PROFILE]), { status: 200 });
    if (u.includes("/auth/v1/admin/users/")) return admin ? admin() : new Response("{}", { status: 200 });
    throw new Error(`unexpected call ${method} ${u}`);
  }));
  return calls;
}

const post = (body) =>
  new Request("https://app.test/api/next/account-recovery", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const valid = (over = {}) => post({ username: "rami", recoveryPhrase: PHRASE, newPassword: PASSWORD, ...over });
const touched = (calls, part) => calls.some((c) => c.url.includes(part));

beforeEach(() => {
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.NEXT_SUPABASE_URL = URL_BASE;
  process.env.NEXT_SUPABASE_ANON_KEY = "next-anon-key";
  process.env.NEXT_SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
});
afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  vi.unstubAllGlobals();
});

describe("/api/next/account-recovery · guards and validation", () => {
  it("declares its route", () => {
    expect(config).toEqual({ path: "/api/next/account-recovery" });
  });

  it("405s anything but POST and 500s without env", async () => {
    const calls = mockRest();
    const get = await handler(new Request("https://app.test/api/next/account-recovery", { method: "GET" }));
    expect(get.status).toBe(405);

    delete process.env.NEXT_SUPABASE_SERVICE_ROLE_KEY;
    const res = await handler(valid());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Server not configured" });
    expect(calls).toHaveLength(0);
  });

  it("400s invalid JSON, a bad username, a short phrase and a weak password before any network call", async () => {
    const calls = mockRest();
    expect((await handler(post("{nope"))).status).toBe(400);
    expect(await (await handler(post("{nope"))).json()).toEqual({ error: "Invalid request." });

    for (const username of ["", "Ra mi", "rami!", "x".repeat(65)]) {
      const res = await handler(valid({ username }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: GENERIC });
    }
    const short = await handler(valid({ recoveryPhrase: "  seven7 " }));
    expect(await short.json()).toEqual({ error: GENERIC });

    for (const newPassword of ["short1!", "lettersonlypassword", "p1".repeat(37)]) {
      const res = await handler(valid({ newPassword }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Use an 8–72 character password with at least one number or symbol." });
    }
    expect(calls).toHaveLength(0);
  });
});

describe("/api/next/account-recovery · rate limiting (first, fail closed)", () => {
  it("bumps the username bucket with the v20 parameters, lowercased and trimmed", async () => {
    const calls = mockRest();
    await handler(valid({ username: "  RAMI " }));
    const rpc = calls.find((c) => c.url === `${URL_BASE}/rest/v1/rpc/bump_recovery_attempt`);
    expect(rpc.method).toBe("POST");
    expect(rpc.headers).toMatchObject({ apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` });
    expect(JSON.parse(rpc.body)).toEqual({ p_username: "rami", p_window_ms: 600_000, p_lock_ms: 900_000, p_max_attempts: 5 });
    expect(calls[0]).toBe(rpc);
  }, 15_000);

  it("429s with Retry-After when the bucket is locked, and never consults profiles", async () => {
    const calls = mockRest({ rpc: () => new Response(JSON.stringify({ allowed: false, retry_after_seconds: 540, attempts: 6 }), { status: 200 }) });
    const res = await handler(valid());
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("540");
    expect(await res.json()).toEqual({ error: "Too many attempts. Try again in 9 minutes.", retryAfterSeconds: 540 });
    expect(touched(calls, "/rest/v1/profiles")).toBe(false);
    expect(touched(calls, "/auth/v1/admin")).toBe(false);
  });

  it("503s when the RPC answers non-2xx, throws, or returns no verdict", async () => {
    for (const rpc of [
      () => new Response(JSON.stringify({ message: "function not found" }), { status: 404 }),
      () => { throw new Error("network"); },
      () => new Response(JSON.stringify({}), { status: 200 }),
    ]) {
      vi.unstubAllGlobals();
      const calls = mockRest({ rpc });
      const res = await handler(valid());
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: UNAVAILABLE });
      expect(touched(calls, "/rest/v1/profiles")).toBe(false);
    }
  });
});

describe("/api/next/account-recovery · verification", () => {
  it("looks the profile up by username with the service role", async () => {
    const calls = mockRest();
    await handler(valid());
    const lookup = calls.find((c) => c.url.includes("/rest/v1/profiles"));
    expect(lookup.method).toBe("GET");
    expect(lookup.url).toContain("username=eq.rami");
    expect(lookup.url).toContain("select=id,recovery_hash,recovery_salt,recovery_kdf");
    expect(lookup.headers).toMatchObject({ apikey: SERVICE_KEY });
  }, 15_000);

  it("answers the generic mismatch for a missing profile, and never touches admin", async () => {
    const calls = mockRest({ profile: () => new Response("[]", { status: 200 }) });
    const res = await handler(valid());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: GENERIC });
    expect(touched(calls, "/auth/v1/admin")).toBe(false);
  }, 15_000);

  it("answers the same generic mismatch for a wrong phrase", async () => {
    const calls = mockRest();
    const res = await handler(valid({ recoveryPhrase: "correct horse battery stapler" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: GENERIC });
    expect(touched(calls, "/auth/v1/admin")).toBe(false);
  }, 15_000);

  it("answers the same generic mismatch for a row without a phrase or on the legacy KDF", async () => {
    const legacy = mockRest({ profile: () => new Response(JSON.stringify([{ ...PROFILE, recovery_kdf: "sha256" }]), { status: 200 }) });
    const res = await handler(valid());
    expect(await res.json()).toEqual({ error: GENERIC });
    expect(touched(legacy, "/auth/v1/admin")).toBe(false);

    vi.unstubAllGlobals();
    const empty = mockRest({ profile: () => new Response(JSON.stringify([{ id: "user-7", recovery_hash: null, recovery_salt: null, recovery_kdf: null }]), { status: 200 }) });
    const none = await handler(valid());
    expect(await none.json()).toEqual({ error: GENERIC });
    expect(touched(empty, "/auth/v1/admin")).toBe(false);
  }, 15_000);

  it("503s when the profile lookup itself fails (fail closed, not 'didn't match')", async () => {
    mockRest({ profile: () => new Response("{}", { status: 500 }) });
    const res = await handler(valid());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: UNAVAILABLE });
  });

  it("sets the new password through the admin endpoint on a match", async () => {
    const calls = mockRest();
    const res = await handler(valid());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const admin = calls.find((c) => c.url.includes("/auth/v1/admin/users/"));
    expect(admin.url).toBe(`${URL_BASE}/auth/v1/admin/users/user-7`);
    expect(admin.method).toBe("PUT");
    expect(admin.headers).toMatchObject({ apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` });
    expect(JSON.parse(admin.body)).toEqual({ password: PASSWORD });

    // The phrase and the password reach nothing but the admin update.
    for (const c of calls.filter((c) => c !== admin)) {
      expect(String(c.body ?? "")).not.toContain(PHRASE);
      expect(String(c.body ?? "")).not.toContain(PASSWORD);
      expect(c.url).not.toContain(PHRASE);
    }
    // The attempt counter is deliberately left alone on success.
    expect(calls.filter((c) => c.url.includes("bump_recovery_attempt"))).toHaveLength(1);
  }, 15_000);

  it("502s when the admin update fails", async () => {
    mockRest({ admin: () => new Response(JSON.stringify({ msg: "nope" }), { status: 500 }) });
    const res = await handler(valid());
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Could not update the password. Try again." });

    vi.unstubAllGlobals();
    mockRest({ admin: () => { throw new Error("network"); } });
    expect((await handler(valid())).status).toBe(502);
  }, 15_000);
});
