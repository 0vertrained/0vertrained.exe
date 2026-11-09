import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
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

// Coming back from a wearable's OAuth screen lands on Integrations
// with the result, and confirming the connection no longer closes Settings.
describe("V19.4 Integrations landing", () => {
  const renderLanding = (props = {}) => {
    const onSave = vi.fn();
    const onPatch = vi.fn();
    render(
      <ThemeProvider>
        <SettingsScreen
          settings={{ ...DEFAULT_SETTINGS, ouraConnected: false, whoopConnected: false }}
          onSave={onSave}
          onPatch={onPatch}
          onClose={vi.fn()}
          busy={false}
          onThemeChange={vi.fn()}
          currentTheme="system"
          initialSection="integrations"
          {...props}
        />
      </ThemeProvider>
    );
    return { onSave, onPatch };
  };

  it("opens straight on Integrations with the status line", async () => {
    renderLanding({ notice: { tone: "ok", text: "Oura connected. Connecting also syncs your last 14 days; the result is below." } });
    const notice = screen.getByTestId("integrations-notice");
    expect(notice.textContent).toMatch(/^Oura connected\./);
    expect(notice.getAttribute("role")).toBe("status");
    expect(await screen.findByText((content) => content.includes("Oura Connected"))).toBeTruthy();
  });

  it("persists the confirmed connection through the quiet patch, not the closing Save", async () => {
    const { onSave, onPatch } = renderLanding();
    await waitFor(() => expect(onPatch).toHaveBeenCalledWith({ ouraConnected: true }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("falls back to Save when no patch handler is passed", async () => {
    const { onSave } = renderLanding({ onPatch: null });
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ ouraConnected: true })));
  });

  it("ignores a section it doesn't know and opens on Macros", () => {
    renderLanding({ initialSection: "nope", notice: { tone: "ok", text: "Oura connected." } });
    expect(screen.getByText("Daily Calories (kcal)")).toBeTruthy(); // the Macros section's content, not just its tab
    expect(screen.queryByText(/Fig\. 5 · Data sources/)).toBeNull();
    expect(screen.queryByTestId("integrations-notice")).toBeNull();
    expect(screen.getByRole("button", { name: "Macros" }).getAttribute("aria-current")).toBe("true");
  });
});
