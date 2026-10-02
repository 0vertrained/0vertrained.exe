// src/__tests__/uiSmoke.test.jsx
// V8 · UI smoke tests — the first rendered-component tests in the repo. The
// 1000+ existing tests all cover pure logic; these protect the app shell
// itself: the 4-tab nav + FAB, the quick-action sheet, the shared Progress
// subnav/History toggle, and the notifications card's unsupported state.
// Deliberately shallow: they assert structure and callbacks, not styling.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ThemeProvider } from "../theme";
import { BottomNav, QuickActionSheet, QUICK_ACTIONS, TABS_ORDER } from "../AppBottomNav";
import { ProgressSubnav, HistoryModeToggle } from "../ProgressTab";
import { NotificationsCard } from "../NotificationsCard";
import { TodayDecisionCard } from "../sections/IntelligenceSections";

// This repo runs vitest without globals, so RTL's automatic cleanup never
// registers — without this, each render leaks into the next test's queries.
afterEach(cleanup);

const wrap = (ui) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe("BottomNav", () => {
  it("renders exactly the 4 primary tabs plus the quick-log FAB", () => {
    wrap(<BottomNav currentTab="Today" onTabChange={() => {}} onQuickAction={() => {}} />);
    expect(TABS_ORDER).toEqual(["Today", "Recovery", "Fuel", "Progress"]);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.length).toBe(4);
    expect(tabs.map(t => t.textContent)).toEqual(TABS_ORDER);
    expect(screen.getByRole("button", { name: /quick log/i })).toBeTruthy();
  });

  it("marks the active tab and fires onTabChange / onQuickAction", () => {
    const onTab = vi.fn();
    const onQuick = vi.fn();
    wrap(<BottomNav currentTab="Fuel" onTabChange={onTab} onQuickAction={onQuick} />);
    const tabs = screen.getAllByRole("tab");
    const byText = (t) => tabs.find(el => el.textContent === t);
    expect(byText("Fuel").getAttribute("aria-selected")).toBe("true");
    expect(byText("Today").getAttribute("aria-selected")).toBe("false");
    fireEvent.click(byText("Progress"));
    expect(onTab).toHaveBeenCalledWith("Progress");
    fireEvent.click(screen.getByRole("button", { name: /quick log/i }));
    expect(onQuick).toHaveBeenCalledTimes(1);
  });
});

describe("QuickActionSheet", () => {
  it("renders the base actions and reports the tapped key", () => {
    const onAction = vi.fn();
    wrap(<QuickActionSheet open onAction={onAction} onClose={() => {}} />);
    for (const a of QUICK_ACTIONS) {
      expect(screen.getByText(a.label)).toBeTruthy();
    }
    fireEvent.click(screen.getByText("Form check"));
    expect(onAction).toHaveBeenCalledWith("formcheck");
  });

  it("accepts an extended action list (coach-enabled case)", () => {
    const onAction = vi.fn();
    const actions = [...QUICK_ACTIONS, { key: "coach", label: "Ask Coach", sub: "Chat" }];
    wrap(<QuickActionSheet open onAction={onAction} onClose={() => {}} actions={actions} />);
    fireEvent.click(screen.getByText("Ask Coach"));
    expect(onAction).toHaveBeenCalledWith("coach");
  });

  it("has explicit close affordances for beta users", () => {
    const onClose = vi.fn();
    wrap(<QuickActionSheet open onAction={() => {}} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /close quick log/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe("ProgressSubnav + HistoryModeToggle", () => {
  it("shows 4 labels and maps History to both timeline and log", () => {
    const setSubView = vi.fn();
    const { rerender } = wrap(<ProgressSubnav subView="charts" setSubView={setSubView} />);
    for (const label of ["Overview", "Form", "Program", "History"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    fireEvent.click(screen.getByText("History"));
    expect(setSubView).toHaveBeenCalledWith("timeline");
    // History reads active for BOTH internal views
    rerender(<ThemeProvider><ProgressSubnav subView="log" setSubView={setSubView} /></ThemeProvider>);
    const history = screen.getByText("History");
    expect(history.style.fontWeight).toBe("600");
  });

  it("toggles Events/Entries between the two internal views", () => {
    const setSubView = vi.fn();
    wrap(<HistoryModeToggle subView="timeline" setSubView={setSubView} />);
    fireEvent.click(screen.getByText("Entries"));
    expect(setSubView).toHaveBeenCalledWith("log");
  });
});

describe("TodayDecisionCard compact polish", () => {
  const decision = {
    call: "push",
    title: "Push hard today",
    subtitle: "You're ready for a strong effort today.",
    doList: ["Run the planned session"],
    reasons: ["Recovery and load are aligned"],
    sourceBadges: ["check-in", "load"],
    confidence: "High",
    risk: "Low",
  };

  it("keeps source/confidence/risk inside Coach detail on the compact Today surface", () => {
    wrap(<TodayDecisionCard decision={decision} compact />);
    expect(screen.getByText("Push hard today")).toBeTruthy();
    expect(screen.queryByText(/Conf:/i)).toBeNull();
    expect(screen.queryByText(/Risk:/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /coach detail/i }));
    expect(screen.getByText(/Conf: High/i)).toBeTruthy();
    expect(screen.getByText(/Risk: Low/i)).toBeTruthy();
    expect(screen.getByText("check-in")).toBeTruthy();
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
