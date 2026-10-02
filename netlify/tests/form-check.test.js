import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler, { resolveUpstreamPath, requestTooLarge } from "../functions/form-check.js";

describe("form-check upstream path allowlist", () => {
  it("allows the analyze route", () => {
    expect(resolveUpstreamPath("https://app.test/api/form-check/analyze")).toBe("/analyze");
  });

  it("rejects the bare root", () => {
    expect(resolveUpstreamPath("https://app.test/api/form-check")).toBe(null);
    expect(resolveUpstreamPath("https://app.test/api/form-check/")).toBe(null);
  });

  it("rejects traversal-shaped suffixes", () => {
    // The URL constructor normalizes dot segments, so a raw "../admin" suffix
    // arrives here as a pathname outside the allowlist either way.
    expect(resolveUpstreamPath("https://app.test/api/form-check/../admin")).toBe(null);
    expect(resolveUpstreamPath("https://app.test/api/form-check/%2e%2e/admin")).toBe(null);
  });

  it("rejects unknown routes", () => {
    expect(resolveUpstreamPath("https://app.test/api/form-check/admin")).toBe(null);
    expect(resolveUpstreamPath("https://app.test/api/form-check/analyze/extra")).toBe(null);
  });

  it("rejects garbage urls", () => {
    expect(resolveUpstreamPath("not a url")).toBe(null);
  });
});

describe("form-check size ceiling", () => {
  it("flags bodies over the ceiling and passes bodies under it", () => {
    const big = new Request("https://app.test/api/form-check/analyze", {
      method: "POST",
      headers: { "content-length": String(200 * 1024 * 1024) },
    });
    const small = new Request("https://app.test/api/form-check/analyze", {
      method: "POST",
      headers: { "content-length": String(5 * 1024 * 1024) },
    });
    expect(requestTooLarge(big)).toBe(true);
    expect(requestTooLarge(small)).toBe(false);
  });
});

describe("form-check auth gate", () => {
  const ENV_KEYS = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "FORM_CHECK_API_BASE", "FORM_CHECK_API_KEY"];
  const saved = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    process.env.SUPABASE_URL = "https://supabase.test";
    process.env.SUPABASE_ANON_KEY = "anon-key";
    process.env.FORM_CHECK_API_BASE = "https://engine.test";
    process.env.FORM_CHECK_API_KEY = "engine-key";
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    vi.unstubAllGlobals();
  });

  it("401s without a bearer token and never contacts the upstream", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await handler(new Request("https://app.test/api/form-check/analyze", { method: "POST" }));
    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("401s on an invalid session and never contacts the upstream", async () => {
    const fetchSpy = vi.fn(async (url) => {
      if (String(url).includes("/auth/v1/user")) return new Response("{}", { status: 401 });
      throw new Error("upstream must not be reached");
    });
    vi.stubGlobal("fetch", fetchSpy);
    const res = await handler(new Request("https://app.test/api/form-check/analyze", {
      method: "POST",
      headers: { authorization: "Bearer bad-token" },
    }));
    expect(res.status).toBe(401);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("404s a disallowed path even for a valid session", async () => {
    const fetchSpy = vi.fn(async (url) => {
      if (String(url).includes("/auth/v1/user")) {
        return new Response(JSON.stringify({ id: "user-1" }), { status: 200 });
      }
      throw new Error("upstream must not be reached");
    });
    vi.stubGlobal("fetch", fetchSpy);
    const res = await handler(new Request("https://app.test/api/form-check/admin", {
      method: "POST",
      headers: { authorization: "Bearer good-token" },
    }));
    expect(res.status).toBe(404);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("forwards an authorized analyze request with the engine key attached", async () => {
    const calls = [];
    const fetchSpy = vi.fn(async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).includes("/auth/v1/user")) {
        return new Response(JSON.stringify({ id: "user-1" }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const res = await handler(new Request("https://app.test/api/form-check/analyze", {
      method: "POST",
      headers: { authorization: "Bearer good-token", "content-type": "video/webm" },
      body: "clip-bytes",
    }));
    expect(res.status).toBe(200);
    const upstreamCall = calls.find(c => c.url.startsWith("https://engine.test"));
    expect(upstreamCall.url).toBe("https://engine.test/api/form-check/analyze");
    expect(upstreamCall.init.headers.get("X-FormCheck-Key")).toBe("engine-key");
  });
});
