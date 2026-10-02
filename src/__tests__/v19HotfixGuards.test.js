// v19.2.1 · Guards for hotfixes that live in large legacy modules.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("Google Health webhook", () => {
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.GOOGLE_HEALTH_WEBHOOK_SECRET; });

  const post = (token) => new Request(`https://app.example/api/google-health/webhook${token ? `?token=${token}` : ""}`, {
    method: "POST",
    body: JSON.stringify({ userId: "u", eventType: "x" }),
    headers: { "content-type": "application/json" },
  });

  it("fails closed when no secret is configured", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { default: handler } = await import("../../netlify/functions/google-health-auth.js");
    const res = await handler(post());
    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("accepts the configured secret and rejects any other token", async () => {
    process.env.GOOGLE_HEALTH_WEBHOOK_SECRET = "s3cret";
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 201, json: async () => ({}) })));
    const { default: handler } = await import("../../netlify/functions/google-health-auth.js");
    expect((await handler(post("wrong"))).status).toBe(403);
    expect((await handler(post("s3cret"))).status).toBe(200);
  });
});

describe("App boot load effect", () => {
  const app = readFileSync(resolve(process.cwd(), "src/App.jsx"), "utf8");

  it("reads the theme through a ref so its own theme change can't cancel revalidation", () => {
    expect(app).toContain("}, [user, authReady, demoMode, onThemeChange]);");
    expect(app).not.toContain("}, [user, authReady, demoMode, themeId, onThemeChange]);");
    expect(app).toContain("themeIdRef.current = themeId");
  });
});
