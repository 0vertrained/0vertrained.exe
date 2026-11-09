// src/__tests__/pushResync.test.js
// Devices that turned notifications on while /api/push-subscribe was
// unrouted hold a subscription the server never stored. resyncPushSubscription
// sends it again, once per page load, only with permission granted, and
// without any preference fields (stored preferences are left alone).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../supabaseClient", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "jwt" } } }) } },
}));

const SUB = { endpoint: "https://push.example/abc", keys: { p256dh: "p", auth: "a" } };
let calls;

async function freshPush({ permission = "granted", subscription = SUB } = {}) {
  vi.resetModules();
  vi.stubEnv("VITE_VAPID_PUBLIC_KEY", "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U");
  vi.stubGlobal("Notification", { permission });
  window.PushManager = function PushManager() {};
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { getRegistration: async () => ({ pushManager: { getSubscription: async () => (subscription ? { toJSON: () => subscription } : null) } }) },
  });
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => ({ ok: true }) }; }));
  return import("../push");
}

beforeEach(() => { calls = []; });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); delete window.PushManager; });

describe("push re-registration", () => {
  it("sends the existing subscription again, once per page load", async () => {
    const { resyncPushSubscription } = await freshPush();
    expect(await resyncPushSubscription()).toBe(true);
    expect(await resyncPushSubscription()).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/push-subscribe");
    expect(calls[0].init.headers.authorization).toBe("Bearer jwt");
    const body = JSON.parse(calls[0].init.body);
    expect(body).toMatchObject({ action: "subscribe", subscription: SUB });
    expect(typeof body.tz_offset_minutes).toBe("number");
    // Preferences already stored server-side are left alone.
    for (const key of ["reminders_enabled", "edition_enabled", "transitions_enabled"]) expect(body).not.toHaveProperty(key);
  });

  it("does nothing without permission or without a subscription", async () => {
    let push = await freshPush({ permission: "default" });
    expect(await push.resyncPushSubscription()).toBe(false);
    expect(calls).toHaveLength(0);
    push = await freshPush({ subscription: null });
    expect(await push.resyncPushSubscription()).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
