import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deriveRecoveryHashPbkdf2,
  evaluateRecoveryRateLimit,
  hashRecoveryPhrase,
  verifyRecoveryHash,
  resolveClientIpHash,
} from "../functions/account-recovery.js";
import handler from "../functions/account-recovery.js";

describe("account recovery primitives", () => {
  it("verifies the correct phrase (legacy SHA-256)", () => {
    const salt = "ab".repeat(16);
    const hash = hashRecoveryPhrase("my private phrase", salt);
    expect(verifyRecoveryHash("my private phrase", salt, hash)).toBe(true);
  });

  it("rejects an incorrect phrase (legacy SHA-256)", () => {
    const salt = "cd".repeat(16);
    const hash = hashRecoveryPhrase("right phrase", salt);
    expect(verifyRecoveryHash("wrong phrase", salt, hash)).toBe(false);
  });

  it("PBKDF2 hash round-trips and is 32 bytes of hex", async () => {
    const salt = "ef".repeat(16);
    const hash = await deriveRecoveryHashPbkdf2("pbkdf2 phrase", salt);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    const again = await deriveRecoveryHashPbkdf2("pbkdf2 phrase", salt);
    expect(again).toBe(hash);
  });

  it("PBKDF2 hash differs from the legacy SHA-256 hash for the same input", async () => {
    const salt = "12".repeat(16);
    const legacy = hashRecoveryPhrase("shared phrase", salt);
    const pbkdf2 = await deriveRecoveryHashPbkdf2("shared phrase", salt);
    expect(pbkdf2).not.toBe(legacy);
  });

  it("locks the sixth attempt inside the rolling window", () => {
    const now = Date.parse("2026-07-10T12:00:00.000Z");
    const result = evaluateRecoveryRateLimit({
      attempts: 5,
      window_started_at: "2026-07-10T11:55:00.000Z",
      lock_until: null,
    }, now);
    expect(result.allowed).toBe(false);
    expect(result.next.attempts).toBe(6);
    expect(result.retryAfterSeconds).toBe(15 * 60);
  });
});

describe("V14.1 client IP hashing", () => {
  const mk = (headers) => new Request("https://app.test/api/account-recovery", { method: "POST", headers });

  it("prefers the Netlify connection header and hashes it", () => {
    const h = resolveClientIpHash(mk({ "x-nf-client-connection-ip": "203.0.113.7", "x-forwarded-for": "10.0.0.1" }));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(resolveClientIpHash(mk({ "x-nf-client-connection-ip": "203.0.113.7" })));
    expect(h).not.toContain("203.0.113.7");
  });

  it("falls back to the first x-forwarded-for hop", () => {
    const a = resolveClientIpHash(mk({ "x-forwarded-for": "203.0.113.9, 10.0.0.2, 10.0.0.3" }));
    const b = resolveClientIpHash(mk({ "x-forwarded-for": "203.0.113.9" }));
    expect(a).toBe(b);
  });

  it("returns null when no address is available", () => {
    expect(resolveClientIpHash(mk({}))).toBe(null);
  });
});

describe("V14.1 dual-bucket rate limiting (handler)", () => {
  const ENV_KEYS = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
  const saved = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    vi.unstubAllGlobals();
  });

  const recoveryRequest = (headers = {}) =>
    new Request("https://app.test/api/account-recovery", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ username: "rami", recoveryPhrase: "correct horse battery", newPassword: "n3wPassword!" }),
    });

  it("429s when the IP bucket locks even though the username bucket allowed — and never reaches profiles", async () => {
    const rpcKeys = [];
    const fetchSpy = vi.fn(async (url, init) => {
      const u = String(url);
      if (u.includes("/rpc/ovt_bump_recovery_attempt")) {
        const body = JSON.parse(init.body);
        rpcKeys.push(body.p_key);
        if (body.p_key.startsWith("ip:")) {
          return new Response(JSON.stringify({ allowed: false, retry_after_seconds: 540, attempts: 21 }), { status: 200 });
        }
        return new Response(JSON.stringify({ allowed: true, retry_after_seconds: 0, attempts: 1 }), { status: 200 });
      }
      if (u.includes("/rest/v1/account_recovery_events")) return new Response(null, { status: 201 });
      if (u.includes("/rest/v1/profiles")) throw new Error("profiles must not be consulted after a rate limit");
      return new Response(JSON.stringify([]), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const res = await handler(recoveryRequest({ "x-nf-client-connection-ip": "203.0.113.7" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("540");
    // Both buckets were consulted, prefixed by dimension.
    expect(rpcKeys.some(k => k.startsWith("u:"))).toBe(true);
    expect(rpcKeys.some(k => k.startsWith("ip:"))).toBe(true);
    // Raw IP never appears in any bucket key.
    expect(rpcKeys.join()).not.toContain("203.0.113.7");
  });

  it("falls back to the legacy table when the RPC is not deployed (pre-v32)", async () => {
    const touched = [];
    const fetchSpy = vi.fn(async (url, init) => {
      const u = String(url);
      const method = (init?.method || "GET").toUpperCase();
      if (u.includes("/rpc/ovt_bump_recovery_attempt")) {
        return new Response(JSON.stringify({ message: "function not found" }), { status: 404 });
      }
      if (u.includes("/rest/v1/account_recovery_attempts")) {
        touched.push(method);
        if (method === "GET") return new Response(JSON.stringify([]), { status: 200 });
        return new Response(null, { status: 201 });
      }
      if (u.includes("/rest/v1/profiles")) return new Response(JSON.stringify([]), { status: 200 });
      if (u.includes("/rest/v1/account_recovery_events")) return new Response(null, { status: 201 });
      return new Response(JSON.stringify([]), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const res = await handler(recoveryRequest());
    // Legacy read + upsert both happened, and the flow continued past rate
    // limiting to the (empty-profile) generic mismatch.
    expect(touched).toContain("GET");
    expect(touched).toContain("POST");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/didn't match/);
  }, 15000);
});
