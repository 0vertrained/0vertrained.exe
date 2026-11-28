import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consumeProviderOAuthState } from "../functions/_provider-standard.js";

afterEach(() => vi.unstubAllGlobals());

describe.each([
  ["oura", "provider_oauth_state"],
  ["strava", "provider_oauth_state"],
  ["whoop", "whoop_oauth_state"],
])("%s callback state", (provider, table) => {
  const claim = () => consumeProviderOAuthState("https://db.example.test", "test-key", { provider, state: "single-use" });
  const row = { user_id: "athlete", expires_at: "2099-01-01T00:00:00.000Z" };
  let request;
  beforeEach(() => {
    let pending = row;
    request = vi.fn(async (url, options) => {
      const { pathname, searchParams } = new URL(url);
      expect(pathname).toBe("/rest/v1/" + table);
      expect(options.method).toBe("DELETE");
      if (!searchParams.has("state")) return new Response(null, { status: 204 });
      expect(options.headers.Prefer).toBe("return=representation");
      expect(searchParams.get("provider")).toBe(provider === "whoop" ? null : "eq." + provider);
      expect(searchParams.get("expires_at")).toMatch(/^gt\./);
      const claimed = pending;
      pending = null;
      return Response.json(claimed ? [claimed] : []);
    });
    vi.stubGlobal("fetch", request);
  });

  it("grants a saved authorization exactly once on overlapping callback deliveries", async () => {
    const results = await Promise.all([claim(), claim()]);
    expect(results.sort()).toEqual(["athlete", null]);
  });

  it("requires a successful claim and a future expiry before resolving the owner", async () => {
    request.mockResolvedValueOnce(Response.json([row], { status: 503 }));
    expect(await claim()).toBeNull();
    request.mockResolvedValueOnce(Response.json([{ ...row, expires_at: "2001-01-01T00:00:00Z" }]));
    expect(await claim()).toBeNull();
    request.mockRejectedValueOnce(new Error("Offline"));
    expect(await claim()).toBeNull();
  });
});
