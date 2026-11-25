// @vitest-environment jsdom
// The top bar, mounted at both sizes. A static source check once let a React
// crash ship in the desktop bar, so these render it for real.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ThemeProvider } from "../theme";
import { Header, syncState } from "../AppHeader";

function forceMatchMedia(matches) {
  vi.stubGlobal("matchMedia", vi.fn().mockImplementation((query) => ({
    matches, media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })));
}

describe("broadsheet header (mounted)", () => {
  // RTL auto-cleanup only registers when vitest exposes globals; this project
  // doesn't, so without this the first render leaks into the second test.
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("at 1024 px and up the tabs, Log, the palette, sync status and Profile share the bar", () => {
    forceMatchMedia(true); // both DESKTOP_QUERY and BROADSHEET_QUERY match
    const onTab = vi.fn();
    render(
      <ThemeProvider>
        <Header
          title="Today" saving={false} demoMode={false} isOnline={true} pendingSaves={{}}
          currentTab="Today" tabsOrder={["Today", "Train", "Fuel", "Progress"]}
          onTabChange={onTab} onQuickAction={() => {}} onOpenPalette={() => {}} onOpenProfile={() => {}}
        />
      </ThemeProvider>
    );
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const tabs = within(nav).getAllByRole("button");
    expect(tabs.map((t) => t.textContent)).toEqual(["Today", "Train", "Fuel", "Progress"]);
    // The current tab is said, not only shown.
    expect(tabs[0].getAttribute("aria-current")).toBe("page");
    expect(tabs[1].getAttribute("aria-current")).toBeNull();
    fireEvent.click(tabs[2]);
    expect(onTab).toHaveBeenCalledWith("Fuel");
    expect(screen.getByRole("img", { name: "0VERTRAINED" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Log" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Search and commands/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Profile and settings" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Saved");
    // The screen's h1 lives in the page at this size, not in the bar.
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });

  it("on a phone the bar holds the screen's h1, sync status and Profile", () => {
    forceMatchMedia(false);
    render(
      <ThemeProvider>
        <Header title="Today" sub=" · Wed, Nov 25" saving={false} demoMode={false} isOnline={true} pendingSaves={{}} currentTab="Today" onOpenProfile={() => {}} />
      </ThemeProvider>
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Today · Wed, Nov 25");
    expect(screen.getByRole("button", { name: "Profile and settings" })).toBeTruthy();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("one level down the mark gives way to a labelled Back, and a full-screen flow to a labelled Close", () => {
    forceMatchMedia(false);
    const onBack = vi.fn();
    const { rerender } = render(
      <ThemeProvider><Header title="Recovery" back="Today" onBack={onBack} isOnline pendingSaves={{}} onOpenProfile={() => {}} /></ThemeProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(onBack).toHaveBeenCalledTimes(1);
    const onClose = vi.fn();
    rerender(
      <ThemeProvider><Header title="Profile" close="Close" onClose={onClose} isOnline pendingSaves={{}} onOpenProfile={() => {}} /></ThemeProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    // A full-screen flow has no Profile button to wander off through.
    expect(screen.queryByRole("button", { name: "Profile and settings" })).toBeNull();
  });

  it("sync status is Saving, Saved or Offline with the queued count", () => {
    expect(syncState({ isOnline: true, saving: false, pendingCount: 0 }).label).toBe("Saved");
    expect(syncState({ isOnline: true, saving: true, pendingCount: 0 }).label).toBe("Saving");
    expect(syncState({ isOnline: true, saving: false, pendingCount: 2 }).label).toBe("Saving");
    expect(syncState({ isOnline: false, saving: false, pendingCount: 0 }).label).toBe("Offline");
    const queued = syncState({ isOnline: false, saving: false, pendingCount: 3 });
    expect(queued.label).toBe("Offline · 3 queued");
    expect(queued.sr).toContain("3 changes saved on this device");
    expect(syncState({ isOnline: true, demoMode: true, pendingCount: 0 }).label).toBe("Demo");
  });
});
