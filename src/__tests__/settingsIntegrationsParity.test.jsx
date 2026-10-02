import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ThemeProvider } from "../theme";
import { DEFAULT_SETTINGS } from "../data";
import { SettingsScreen } from "../SettingsScreen";

vi.mock("../oura", () => ({
  getOuraAuthUrl: vi.fn(async () => "/api/oura/auth"),
  disconnectOura: vi.fn(async () => ({ ok: true })),
  getOuraSyncEvents: vi.fn(async () => ({ events: [] })),
  getOuraTokenStatus: vi.fn(async () => ({ connected: true, isExpired: false, lastSynced: null })),
  getOuraSyncCounts: vi.fn(async () => ({ sleep: 1, readiness: 1, activity: 1, heartrate: 1, spo2: 1, latestDate: "2026-07-09" })),
  syncOuraNow: vi.fn(async (days) => ({ ok: true, synced: 5, stored: 5, days, counts: {} })),
}));

vi.mock("../whoop", () => ({
  getWhoopAuthUrl: vi.fn(async () => "/api/whoop/auth"),
  getWhoopTokenStatus: vi.fn(async () => ({ connected: false })),
  syncWhoopNow: vi.fn(async (days) => ({ ok: true, synced: 1, days, counts: {} })),
  disconnectWhoop: vi.fn(async () => ({ ok: true })),
  getWhoopSyncCounts: vi.fn(async () => ({})),
  getWhoopSyncEvents: vi.fn(async () => ({ events: [] })),
}));

afterEach(cleanup);

const renderSettings = (settings = {}) => render(
  <ThemeProvider>
    <SettingsScreen
      settings={{ ...DEFAULT_SETTINGS, ...settings }}
      onSave={vi.fn()}
      onClose={vi.fn()}
      busy={false}
      onThemeChange={vi.fn()}
      currentTheme="system"
    />
  </ThemeProvider>
);

describe("Settings integrations parity", () => {
  it("shows Oura sync controls when the server says Oura is connected, even before local settings flag catches up", async () => {
    renderSettings({ ouraConnected: false, whoopConnected: false });

    fireEvent.click(screen.getByText("Integrations"));

    expect(await screen.findByText((content) => content.includes("Oura Connected"))).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sync now" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sync last 30 days" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "+ Connect Oura Ring" })).toBeNull();
  });
});
