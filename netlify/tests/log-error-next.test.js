// @vitest-environment node
// v20 · Contract tests for /api/next/log-error. fetch is stubbed per test and
// every outbound call is recorded so assertions can check which Supabase
// endpoints were touched, with what, and in what shape.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler, { config } from "../functions/log-error-next.js";
import { ipHash } from "../functions/_next-env.js";

const URL_BASE = "https://next-project.supabase.co";
const SERVICE_KEY = "next-service-role-key";
const ANON_KEY = "next-anon-key";
const ENV_KEYS = ["NEXT_SUPABASE_URL", "NEXT_SUPABASE_ANON_KEY", "NEXT_SUPABASE_SERVICE_ROLE_KEY", "LOG_ERROR_DAILY_CAP", "ERROR_REPORTING_ENABLED"];
const saved = {};

const countResponse = (total) => new Response(null, { status: 206, headers: { "content-range": `0-0/${total}` } });

// Records every call. `counts` maps a filter substring to the HEAD total it
// should report; unmatched counts report 0. `insert` overrides the POST.
function mockRest({ counts = {}, insert, user } = {}) {
  const calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    const u = String(url);
    const method = (init?.method || "GET").toUpperCase();
    calls.push({ url: u, method, headers: init?.headers || {}, body: init?.body });
    if (u.includes("/auth/v1/user")) {
      return user === "reject" ? new Response("{}", { status: 401 }) : new Response(JSON.stringify({ id: user || "user-1" }), { status: 200 });
    }
    if (u.includes("/rest/v1/client_errors") && method === "HEAD") {
      const match = Object.keys(counts).find((k) => u.includes(k));
      const total = match === undefined ? 0 : counts[match];
      if (total === "throw") throw new Error("count exploded");
      if (total === "500") return new Response("{}", { status: 500 });
      return countResponse(total);
    }
    if (u.includes("/rest/v1/client_errors") && method === "POST") {
      return insert ? insert() : new Response(null, { status: 201 });
    }
    return new Response(JSON.stringify([]), { status: 200 });
  }));
  return calls;
}

const post = (body, headers = {}) =>
  new Request("https://app.test/api/next/log-error", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const report = { message: "boom", stack: "Error: boom\n at x", component_stack: "", url: "https://app.test/next", version: "20.0.0", ref: "boundary" };
const insertRow = (calls) => JSON.parse(calls.find((c) => c.method === "POST" && c.url.includes("/rest/v1/client_errors")).body);
const headCalls = (calls) => calls.filter((c) => c.method === "HEAD");

beforeEach(() => {
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.NEXT_SUPABASE_URL = URL_BASE;
  process.env.NEXT_SUPABASE_ANON_KEY = ANON_KEY;
  process.env.NEXT_SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
});
afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  vi.unstubAllGlobals();
});

describe("/api/next/log-error · guards", () => {
  it("declares its route", () => {
    expect(config).toEqual({ path: "/api/next/log-error" });
  });

  it("405s anything but POST", async () => {
    const calls = mockRest();
    const res = await handler(new Request("https://app.test/api/next/log-error", { method: "GET" }));
    expect(res.status).toBe(405);
    expect(calls).toHaveLength(0);
  });

  it("kill switch drops the report before touching env or the database", async () => {
    process.env.ERROR_REPORTING_ENABLED = "false";
    delete process.env.NEXT_SUPABASE_URL;
    const calls = mockRest();
    const res = await handler(post(report));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, dropped: true });
    expect(calls).toHaveLength(0);
  });

  it("500s when the NEXT_SUPABASE_* env is incomplete", async () => {
    delete process.env.NEXT_SUPABASE_SERVICE_ROLE_KEY;
    mockRest();
    const res = await handler(post(report));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Server not configured" });
  });

  it("drops an oversized body (declared or actual) with 200, never 413", async () => {
    const calls = mockRest();
    const declared = await handler(post(report, { "content-length": "16385" }));
    expect(declared.status).toBe(200);
    expect(await declared.json()).toEqual({ ok: true, dropped: true, reason: "too-large" });

    const actual = await handler(post({ ...report, stack: "x".repeat(17_000) }));
    expect(actual.status).toBe(200);
    expect(await actual.json()).toEqual({ ok: true, dropped: true, reason: "too-large" });
    expect(calls).toHaveLength(0);
  });

  it("400s invalid JSON and a missing message", async () => {
    mockRest();
    const bad = await handler(post("{not json"));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "Invalid JSON" });

    const missing = await handler(post({ stack: "no message" }));
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "Missing message" });

    const blank = await handler(post({ message: "   " }));
    expect(blank.status).toBe(400);
  });
});

describe("/api/next/log-error · anonymous path", () => {
  it("stores a salted, daily-rotating ip_hash and no user_id, without calling GoTrue", async () => {
    const calls = mockRest();
    const res = await handler(post(report, { "x-nf-client-connection-ip": "203.0.113.7", "x-forwarded-for": "10.0.0.1", "user-agent": "UA/1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const row = insertRow(calls);
    const today = new Date().toISOString().slice(0, 10);
    expect(row.user_id).toBe(null);
    expect(row.ip_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.ip_hash).toBe(ipHash("203.0.113.7", today, SERVICE_KEY));
    expect(row.ip_hash).not.toBe(ipHash("203.0.113.7", "2000-01-01", SERVICE_KEY));
    expect(JSON.stringify(row)).not.toContain("203.0.113.7");
    expect(row).toMatchObject({ message: "boom", stack: report.stack, url: report.url, version: "20.0.0", ref: "boundary", user_agent: "UA/1" });
    expect(calls.some((c) => c.url.includes("/auth/v1/user"))).toBe(false);

    // Two caps, two counts: this address today, and all anonymous rows today.
    const heads = headCalls(calls);
    expect(heads).toHaveLength(2);
    expect(heads.some((c) => c.url.includes(`ip_hash=eq.${row.ip_hash}`))).toBe(true);
    expect(heads.some((c) => c.url.includes("user_id=is.null"))).toBe(true);
    expect(heads.every((c) => c.headers.Prefer === "count=exact" && c.headers.apikey === SERVICE_KEY)).toBe(true);
  });

  it("falls back to the first x-forwarded-for hop, and to a shared bucket with no address", async () => {
    const calls = mockRest();
    await handler(post(report, { "x-forwarded-for": "203.0.113.9, 10.0.0.2" }));
    await handler(post(report));
    const today = new Date().toISOString().slice(0, 10);
    const rows = calls.filter((c) => c.method === "POST").map((c) => JSON.parse(c.body));
    expect(rows[0].ip_hash).toBe(ipHash("203.0.113.9", today, SERVICE_KEY));
    expect(rows[1].ip_hash).toBe(ipHash("unknown", today, SERVICE_KEY));
  });

  it("caps one address at 20 per UTC day", async () => {
    const calls = mockRest({ counts: { "ip_hash=eq.": 20 } });
    const res = await handler(post(report, { "x-nf-client-connection-ip": "203.0.113.7" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, capped: true });
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("caps all anonymous reports at 2,000 per UTC day", async () => {
    const calls = mockRest({ counts: { "user_id=is.null": 2000 } });
    const res = await handler(post(report, { "x-nf-client-connection-ip": "203.0.113.7" }));
    expect(await res.json()).toEqual({ ok: true, capped: true });
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("treats a Bearer token GoTrue rejects as anonymous rather than 401", async () => {
    const calls = mockRest({ user: "reject" });
    const res = await handler(post(report, { authorization: "Bearer stale", "x-nf-client-connection-ip": "203.0.113.7" }));
    expect(res.status).toBe(200);
    const row = insertRow(calls);
    expect(row.user_id).toBe(null);
    expect(row.ip_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("/api/next/log-error · signed-in path", () => {
  it("verifies the token with the anon key and stores user_id with no ip_hash", async () => {
    const calls = mockRest({ user: "user-42" });
    const res = await handler(post(report, { authorization: "Bearer jwt-abc", "x-nf-client-connection-ip": "203.0.113.7" }));
    expect(res.status).toBe(200);

    const auth = calls.find((c) => c.url === `${URL_BASE}/auth/v1/user`);
    expect(auth.headers).toMatchObject({ apikey: ANON_KEY, Authorization: "Bearer jwt-abc" });
    const row = insertRow(calls);
    expect(row.user_id).toBe("user-42");
    expect(row.ip_hash).toBe(null);

    const heads = headCalls(calls);
    expect(heads).toHaveLength(1);
    expect(heads[0].url).toContain("user_id=eq.user-42");
    expect(heads[0].url).toContain("created_at=gte.");
  });

  it("caps a user at LOG_ERROR_DAILY_CAP per rolling 24 h", async () => {
    process.env.LOG_ERROR_DAILY_CAP = "3";
    const calls = mockRest({ counts: { "user_id=eq.": 3 } });
    const res = await handler(post(report, { authorization: "Bearer jwt" }));
    expect(await res.json()).toEqual({ ok: true, capped: true });
    expect(calls.some((c) => c.method === "POST")).toBe(false);

    vi.unstubAllGlobals();
    const under = mockRest({ counts: { "user_id=eq.": 2 } });
    const ok = await handler(post(report, { authorization: "Bearer jwt" }));
    expect(await ok.json()).toEqual({ ok: true });
    expect(under.some((c) => c.method === "POST")).toBe(true);
  });

  it("clamps every stored field server-side", async () => {
    const calls = mockRest();
    await handler(post({ message: "m".repeat(600), stack: "s".repeat(5000), component_stack: "c".repeat(3000), url: "u".repeat(400), version: "v".repeat(30), ref: "r".repeat(50) }, { authorization: "Bearer jwt", "user-agent": "a".repeat(400) }));
    const row = insertRow(calls);
    expect(row.message).toHaveLength(500);
    expect(row.stack).toHaveLength(4000);
    expect(row.component_stack).toHaveLength(2000);
    expect(row.url).toHaveLength(300);
    expect(row.version).toHaveLength(20);
    expect(row.ref).toHaveLength(40);
    expect(row.user_agent).toHaveLength(300);
  });
});

describe("/api/next/log-error · failure modes", () => {
  it("fails open when a count request throws or answers non-2xx", async () => {
    const thrown = mockRest({ counts: { "ip_hash=eq.": "throw", "user_id=is.null": "500" } });
    const res = await handler(post(report, { "x-nf-client-connection-ip": "203.0.113.7" }));
    expect(await res.json()).toEqual({ ok: true });
    expect(thrown.some((c) => c.method === "POST")).toBe(true);
  });

  it("502s when the insert fails", async () => {
    mockRest({ insert: () => new Response("{}", { status: 500 }) });
    const res = await handler(post(report));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Failed to store error" });

    vi.unstubAllGlobals();
    mockRest({ insert: () => { throw new Error("network"); } });
    const net = await handler(post(report));
    expect(net.status).toBe(502);
  });
});
