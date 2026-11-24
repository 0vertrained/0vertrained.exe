import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler from "../functions/google-health-auth.js";

const ENV_KEYS = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "GOOGLE_HEALTH_WEBHOOK_SECRET"];
const saved = {};

function post(headers = {}, body = { notificationId: "n-1", userId: "g-1" }) {
  return new Request("https://app.test/api/google-health/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("google-health webhook", () => {
  let fetchMock;

  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    process.env.SUPABASE_URL = "https://supabase.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
    fetchMock = vi.fn(async () => ({ ok: true, status: 201, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("is off until a webhook secret is configured", async () => {
    delete process.env.GOOGLE_HEALTH_WEBHOOK_SECRET;
    const res = await handler(post({ "x-webhook-token": "anything" }));
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a wrong or missing token", async () => {
    process.env.GOOGLE_HEALTH_WEBHOOK_SECRET = "hook-secret";
    expect((await handler(post({ "x-webhook-token": "hook-secreT" }))).status).toBe(403);
    expect((await handler(post())).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses an oversized body", async () => {
    process.env.GOOGLE_HEALTH_WEBHOOK_SECRET = "hook-secret";
    const res = await handler(post({ "x-webhook-token": "hook-secret", "content-length": "500000" }));
    expect(res.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stores the event when the token matches", async () => {
    process.env.GOOGLE_HEALTH_WEBHOOK_SECRET = "hook-secret";
    const res = await handler(post({ "x-webhook-token": "hook-secret" }));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/rest/v1/provider_webhook_events");
  });
});
