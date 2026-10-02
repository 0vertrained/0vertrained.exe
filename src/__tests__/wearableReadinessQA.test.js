import { describe, it, expect } from "vitest";
import {
  STALE_HOURS,
  buildSourceReadiness,
  buildWearableReadinessQA,
} from "../recovery/wearableReadinessQA";

const NOW = new Date("2026-07-02T12:00:00.000Z");
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3600 * 1000).toISOString();

const ev = (source, status, extra = {}) => ({
  source,
  event_type: "sync",
  status,
  created_at: hoursAgo(1),
  counts: { cycle: 1, sleep: 1, recovery: 1, workout: 0 },
  ...extra,
});

describe("buildSourceReadiness", () => {
  it("reports not-connected as an optional, non-broken state", () => {
    const r = buildSourceReadiness({ source: "oura", connected: false, events: [], now: NOW });
    expect(r.status).toBe("not-connected");
    expect(r.tone).toBe("neutral");
    expect(r.body.toLowerCase()).toContain("manual recovery works");
  });

  it("explains no-sync-yet with the after-sleep delay", () => {
    const r = buildSourceReadiness({ source: "whoop", connected: true, events: [], now: NOW });
    expect(r.status).toBe("awaiting-first-sync");
    expect(r.body.toLowerCase()).toContain("next full sleep");
  });

  it("surfaces a failed sync as a warning", () => {
    const r = buildSourceReadiness({ source: "oura", connected: true, events: [ev("oura", "failed", { message: "token expired" })], now: NOW });
    expect(r.status).toBe("sync-failed");
    expect(r.tone).toBe("warning");
    expect(r.body.toLowerCase()).toContain("token expired");
  });

  it("flags partial / no-scored-recovery as caution", () => {
    const partial = buildSourceReadiness({ source: "whoop", connected: true, events: [ev("whoop", "partial", { counts: { cycle: 1, sleep: 0, recovery: 0 } })], now: NOW });
    expect(partial.tone).toBe("caution");
    const noRec = buildSourceReadiness({ source: "whoop", connected: true, events: [ev("whoop", "success", { counts: { cycle: 3, sleep: 2, recovery: 0 } })], now: NOW });
    expect(noRec.status).toBe("awaiting-first-sleep");
  });

  it("marks a successful-but-old sync as stale", () => {
    const r = buildSourceReadiness({
      source: "oura",
      connected: true,
      events: [ev("oura", "success", { created_at: hoursAgo(STALE_HOURS + 5) })],
      now: NOW,
    });
    expect(r.status).toBe("stale");
    expect(r.stale).toBe(true);
  });

  it("marks a fresh successful sync as ok", () => {
    const r = buildSourceReadiness({ source: "oura", connected: true, events: [ev("oura", "success")], now: NOW });
    expect(r.status).toBe("ok");
    expect(r.tone).toBe("good");
  });
});

describe("buildWearableReadinessQA", () => {
  it("returns a confident manual message when nothing is connected", () => {
    const qa = buildWearableReadinessQA({ ouraConnected: false, whoopConnected: false, now: NOW });
    expect(qa.mode).toBe("manual");
    expect(qa.manual).toBe(true);
    expect(qa.tone).toBe("neutral");
    expect(qa.body.toLowerCase()).toContain("complete setup");
  });

  it("surfaces the worst single-source problem first", () => {
    const qa = buildWearableReadinessQA({
      ouraConnected: true,
      whoopConnected: true,
      events: [ev("oura", "success"), ev("whoop", "failed", { message: "auth" })],
      now: NOW,
    });
    expect(qa.status).toBe("sync-failed");
    expect(qa.tone).toBe("warning");
    expect(qa.sources).toHaveLength(2);
  });

  it("gives a conservative mixed-signal reminder when both agree to disagree", () => {
    const qa = buildWearableReadinessQA({
      ouraConnected: true,
      whoopConnected: true,
      events: [ev("oura", "success"), ev("whoop", "success")],
      conflicts: [{ metric: "hrv" }, { metric: "recovery" }],
      now: NOW,
    });
    expect(qa.status).toBe("mixed");
    expect(qa.mixedSignal).toBe(true);
    expect(qa.body.toLowerCase()).toContain("never averaged");
  });

  it("reports agreement when both are healthy and not conflicting", () => {
    const qa = buildWearableReadinessQA({
      ouraConnected: true,
      whoopConnected: true,
      events: [ev("oura", "success"), ev("whoop", "success")],
      conflicts: [],
      now: NOW,
    });
    expect(qa.tone).toBe("good");
    expect(qa.mixedSignal).toBe(false);
  });

  it("handles a single healthy wearable", () => {
    const qa = buildWearableReadinessQA({ ouraConnected: true, whoopConnected: false, events: [ev("oura", "success")], now: NOW });
    expect(qa.mode).toBe("oura");
    expect(qa.status).toBe("ok");
  });

  it("is null-safe with no arguments", () => {
    const qa = buildWearableReadinessQA();
    expect(qa.mode).toBe("manual");
    expect(typeof qa.title).toBe("string");
  });
});
