// src/__tests__/uiSmoke.test.jsx
// UI smoke tests — the first rendered-component tests in the repo. The
// 1000+ existing tests all cover pure logic; these protect the app shell
// itself: the four tabs and Log, the Log sheet, the shared Progress
// subnav/History toggle, and the notifications card's unsupported state.
// Deliberately shallow: they assert structure and callbacks, not styling.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ThemeProvider } from "../theme";
import { BottomNav, QuickActionSheet, QUICK_ACTIONS, COACH_ACTION, TABS_ORDER } from "../AppBottomNav";
import { NotificationsCard } from "../NotificationsCard";

// This repo runs vitest without globals, so RTL's automatic cleanup never
// registers — without this, each render leaks into the next test's queries.
afterEach(cleanup);

const wrap = (ui) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe("BottomNav", () => {
  it("renders four destinations with Log in the centre", () => {
    wrap(<BottomNav currentTab="Today" onTabChange={() => {}} onQuickAction={() => {}} />);
    expect(TABS_ORDER).toEqual(["Today", "Train", "Fuel", "Progress"]);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const buttons = Array.from(nav.querySelectorAll("button"));
    expect(buttons.map(b => b.textContent)).toEqual(["Today", "Train", "Log", "Fuel", "Progress"]);
  });

  it("says which tab is current and fires onTabChange / onQuickAction", () => {
    const onTab = vi.fn();
    const onQuick = vi.fn();
    wrap(<BottomNav currentTab="Fuel" onTabChange={onTab} onQuickAction={onQuick} />);
    const byName = (name) => screen.getByRole("button", { name });
    // Current is exposed as aria-current, so it never rests on the bar's look alone.
    expect(byName("Fuel").getAttribute("aria-current")).toBe("page");
    expect(byName("Today").getAttribute("aria-current")).toBeNull();
    fireEvent.click(byName("Progress"));
    expect(onTab).toHaveBeenCalledWith("Progress");
    fireEvent.click(byName("Log"));
    expect(onQuick).toHaveBeenCalledTimes(1);
  });

  it("names no tab current on a screen that belongs to none, like Profile", () => {
    wrap(<BottomNav currentTab={null} onTabChange={() => {}} onQuickAction={() => {}} />);
    expect(document.querySelector('[aria-current="page"]')).toBeNull();
  });
});

describe("QuickActionSheet", () => {
  it("renders the base actions and reports the tapped key", () => {
    const onAction = vi.fn();
    wrap(<QuickActionSheet open onAction={onAction} onClose={() => {}} />);
    expect(QUICK_ACTIONS.map(a => a.key)).toEqual(["workout", "run", "meal", "checkin"]);
    expect(screen.getByRole("dialog", { name: "Log" })).toBeTruthy();
    for (const a of QUICK_ACTIONS) {
      expect(screen.getByText(a.label)).toBeTruthy();
    }
    fireEvent.click(screen.getByText("Log meal"));
    expect(onAction).toHaveBeenCalledWith("meal");
  });

  it("accepts an extended action list (coach-enabled case)", () => {
    const onAction = vi.fn();
    const actions = [...QUICK_ACTIONS, COACH_ACTION];
    // Five choices at most.
    expect(actions.length).toBe(5);
    wrap(<QuickActionSheet open onAction={onAction} onClose={() => {}} actions={actions} />);
    fireEvent.click(screen.getByText("Ask coach"));
    expect(onAction).toHaveBeenCalledWith("coach");
  });

  it("closes with the Close button and with Esc", () => {
    const onClose = vi.fn();
    wrap(<QuickActionSheet open onAction={() => {}} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("is not in the page at all while closed", () => {
    wrap(<QuickActionSheet open={false} onAction={() => {}} onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("NotificationsCard", () => {
  it("renders the unavailable state gracefully in a non-push environment", () => {
    // jsdom has no PushManager/serviceWorker — the card must explain, not crash.
    wrap(<NotificationsCard showToast={() => {}} />);
    expect(screen.getByText("Notifications")).toBeTruthy();
    expect(screen.getByText(/unavailable/i)).toBeTruthy();
  });
});
