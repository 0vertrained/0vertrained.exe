import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import webpush from "web-push";
import subscribe from "../functions/push-subscribe.js";
import reminders from "../functions/push-reminders.js";
import courier from "../functions/edition-courier.js";
import { trustedPushEndpoint } from "../functions/_push-endpoint.js";

vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification: vi.fn() } }));
const unrecognized = "https://unrelated.example.test/device";
const allowed = "https://web.push.apple.com/device";

beforeEach(() => {
  vi.clearAllMocks();
  for (const name of ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"]) {
    vi.stubEnv(name, name === "SUPABASE_URL" ? "https://db.example.test" : "unit-test");
  }
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("push delivery destinations", () => {
  it("recognizes browser services and requires a standard secure endpoint", () => {
    for (const host of ["web.push.apple.com", "fcm.googleapis.com", "updates.push.services.mozilla.com", "wns2-bl2p.notify.windows.com"]) {
      const url = "https://" + host + "/subscription";
      expect(trustedPushEndpoint(url)).toBe(url);
    }
    for (const url of [unrecognized, allowed.replace("https:", "http:"), allowed.replace("/device", ":8443/device"), "invalid"]) {
      expect(trustedPushEndpoint(url)).toBeNull();
    }
  });

  it("checks registrations before storage and lets the owner remove an obsolete endpoint", async () => {
    const fetcher = vi.fn(async (url, opts) => {
      if (new URL(url).pathname === "/auth/v1/user") return Response.json({ id: "owner" });
      expect(opts.method).toBe("DELETE");
      expect(new URL(url).searchParams.get("user_id")).toBe("eq.owner");
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", fetcher);
    const request = action => new Request("https://app.example.test/api/push-subscribe", {
      method: "POST", headers: { authorization: "Bearer test" },
      body: JSON.stringify({ action, subscription: { endpoint: unrecognized, keys: { p256dh: "fixture", auth: "fixture" } } }),
    });
    expect((await subscribe(request("subscribe"))).status).toBe(400);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await subscribe(request("unsubscribe"))).status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("reminders deliver only to recognized destinations from saved registrations", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-27T19:30:00Z"));
    vi.stubGlobal("fetch", async () => Response.json([unrecognized, allowed].map(endpoint => ({
      endpoint, p256dh: "fixture", auth: "fixture", tz_offset_minutes: 0,
    }))));
    const result = await (await reminders()).json();
    expect(result).toMatchObject({ sent: 1, failed: 1 });
    expect(webpush.sendNotification).toHaveBeenCalledTimes(1);
    expect(webpush.sendNotification.mock.calls[0][0].endpoint).toBe(allowed);
  });

  it("skips saved unknown destinations before courier health lookups or send claims", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-27T07:00:00Z"));
    const fetcher = vi.fn(async () => Response.json([{ user_id: "owner", endpoint: unrecognized, tz_offset_minutes: 0 }]));
    vi.stubGlobal("fetch", fetcher);
    const result = await (await courier()).json();
    expect(result.users).toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });
});
