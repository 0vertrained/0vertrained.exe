import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  clearAlertHistory,
  getAlertHistory,
  getAlertHistoryKey,
  saveAlertSnapshot,
} from "../oura/alerts";

const root = process.cwd();

describe("Oura user isolation hardening", () => {
  beforeEach(() => {
    localStorage.clear();
    // Alert history prunes entries older than 14 days from "now", so pin the
    // clock near the fixture dates (these tests failed once the real date
    // moved past 2026-07-23).
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-10T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stores alert history under a user-scoped key and never reads another user's history", () => {
    const alertData = {
      alerts: [{ severity: "caution", markers: ["hrv_suppressed"], message: "derived alert" }],
      markers: ["hrv_suppressed"],
      positiveMarkers: [],
      checkedAt: "2026-07-09T00:00:00.000Z",
    };

    saveAlertSnapshot("2026-07-09", alertData, "user-a");

    expect(localStorage.getItem(getAlertHistoryKey("user-a"))).toContain("hrv_suppressed");
    expect(getAlertHistory("user-a")["2026-07-09"].markerCount).toBe(1);
    expect(getAlertHistory("user-b")).toEqual({});
  });

  it("removes legacy unscoped alert history so shared-browser users cannot inherit old derived alerts", () => {
    localStorage.setItem("0vertrained_alert_history", JSON.stringify({
      "2026-07-08": { severity: "warning", markerCount: 3 },
    }));

    saveAlertSnapshot("2026-07-09", { alerts: [], markers: [], positiveMarkers: [] }, "user-b");

    expect(localStorage.getItem("0vertrained_alert_history")).toBeNull();
    expect(getAlertHistory("user-b")["2026-07-09"].severity).toBe("clear");
  });

  it("clearAlertHistory clears both scoped and legacy alert history", () => {
    localStorage.setItem("0vertrained_alert_history", "{}");
    localStorage.setItem(getAlertHistoryKey("user-a"), "{}");

    clearAlertHistory("user-a");

    expect(localStorage.getItem("0vertrained_alert_history")).toBeNull();
    expect(localStorage.getItem(getAlertHistoryKey("user-a"))).toBeNull();
  });

  it("keeps Oura data browser access read-only while server-side service_role keeps write authority", () => {
    const migration = fs.readFileSync(path.join(root, "supabase/migration_patch_oura_data_read_only.sql"), "utf8").toLowerCase();
    expect(migration).toMatch(/revoke\s+insert,\s*update,\s*delete\s+on\s+public\.oura_data\s+from\s+authenticated/);
    expect(migration).toMatch(/grant\s+select\s+on\s+public\.oura_data\s+to\s+authenticated/);
    expect(migration).toMatch(/grant\s+all\s+on\s+public\.oura_data\s+to\s+service_role/);
  });

  it("pins Oura browser-facing API calls to server-derived user ownership", () => {
    const authClient = fs.readFileSync(path.join(root, "src/oura/auth.js"), "utf8");
    const dataLoading = fs.readFileSync(path.join(root, "src/oura/dataLoading.js"), "utf8");
    const ouraFunction = fs.readFileSync(path.join(root, "netlify/functions/oura-auth.js"), "utf8");

    expect(authClient).toContain("/api/oura/auth");
    expect(authClient).toContain("authorization");
    expect(authClient).not.toMatch(/user_id=.*session|userId=/);
    expect(dataLoading).toContain('.eq("user_id", userId)');
    expect(ouraFunction).toMatch(/resolveUserIdFromBearer/);
    expect(ouraFunction).toMatch(/handleUserSync[\s\S]*resolveUserIdFromBearer/);
    expect(ouraFunction).toMatch(/handleCounts[\s\S]*resolveUserIdFromBearer/);
    expect(ouraFunction).toMatch(/handleStatus[\s\S]*resolveUserIdFromBearer/);
    expect(ouraFunction).toMatch(/handleDisconnect[\s\S]*resolveUserIdFromBearer/);
  });
});
