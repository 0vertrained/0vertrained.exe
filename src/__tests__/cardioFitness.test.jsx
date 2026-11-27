// src/__tests__/cardioFitness.test.jsx
// Progress → Running shows Apple Watch's cardio fitness (VO2 max) once runs
// from the watch are on in the iPhone app: the latest estimate, how it moved
// over about three months, and the year as a line.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { cardioFitnessTrend } from "../runProgress";
import { APP_FOREGROUND_EVENT } from "../integrations/appForeground";
import { CardioFitness } from "../sections/CardioFitness";
import { writeWatchRunsOn } from "../watch/watchRunsState";

const POINTS = [
  { date: "2026-06-01", value: 49.1 },
  { date: "2026-09-02", value: 50.2 },
  { date: "2026-10-15", value: 51 },
  { date: "2026-11-20", value: 51.6 },
];

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); delete window.Capacitor; localStorage.clear(); });

describe("cardioFitnessTrend", () => {
  it("compares the latest with the first estimate in the 90 days before it", () => {
    expect(cardioFitnessTrend(POINTS)).toMatchObject({ latest: { date: "2026-11-20", value: 51.6 }, change: 1.4, since: "2026-09-02" });
    expect(cardioFitnessTrend([{ date: "2026-11-20", value: 51.6 }])).toMatchObject({ change: null, since: null });
    expect(cardioFitnessTrend([])).toBeNull();
  });
});

describe("CardioFitness", () => {
  it("shows the estimate and its trend in the app with runs on", async () => {
    const plugin = { cardioFitness: vi.fn(async () => ({ points: POINTS })) };
    window.Capacitor = { isNativePlatform: () => true, Plugins: { OTRuns: plugin } };
    writeWatchRunsOn(true);
    render(<CardioFitness />);
    expect(await screen.findByRole("heading", { name: "Cardio fitness" })).toBeTruthy();
    expect(plugin.cardioFitness).toHaveBeenCalledWith({ days: 365 });
    expect(screen.getByText("VO2 max from your Apple Watch, Nov 20, up 1.4 since Sep 2.")).toBeTruthy();
    expect(screen.getByRole("img", { name: /^Line chart of cardio fitness over 4 estimates/ })).toBeTruthy();
  });

  it("refreshes an enabled athlete’s estimate on foreground and hides it when access changes", async () => {
    const plugin = { cardioFitness: vi.fn().mockResolvedValueOnce({ points: [] }).mockResolvedValue({ points: POINTS }) };
    window.Capacitor = { isNativePlatform: () => true, Plugins: { OTRuns: plugin } };
    writeWatchRunsOn(true, "A");
    const { rerender } = render(<CardioFitness owner="A" />);
    await act(async () => {});
    expect(screen.queryByRole("heading")).toBeNull();
    act(() => window.dispatchEvent(new Event(APP_FOREGROUND_EVENT)));
    expect(await screen.findByRole("heading", { name: "Cardio fitness" })).toBeTruthy();
    rerender(<CardioFitness owner="B" />);
    act(() => window.dispatchEvent(new Event(APP_FOREGROUND_EVENT)));
    expect(screen.queryByRole("heading")).toBeNull();
    expect(plugin.cardioFitness).toHaveBeenCalledTimes(2);
  });

  it("stays out of the way with runs off, or in a browser", async () => {
    const plugin = { cardioFitness: vi.fn(async () => ({ points: POINTS })) };
    window.Capacitor = { isNativePlatform: () => true, Plugins: { OTRuns: plugin } };
    const { container } = render(<CardioFitness />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(plugin.cardioFitness).not.toHaveBeenCalled();
    expect(container.textContent).toBe("");
  });
});
