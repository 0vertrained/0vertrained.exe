// src/__tests__/watchRuns.test.jsx
// With runs turned on in the iPhone app, the week's planned runs go to the
// watch and runs recorded there fill in empty days, with Undo. In a browser,
// or while it's off, nothing happens. Settings' Apple Watch card turns it on
// once iOS allows it, and off again.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { DEFAULT_PROGRAM, getTodayKey } from "../constants";
import { useWatchRuns } from "../watch/useWatchRuns";
import { readHandledRuns, readWatchRunsOn, writeWatchRunsOn } from "../watch/watchRunsState";
import { AppleWatchCard } from "../sections/AppleWatchCard";

function setPath(object, [key, ...rest], value) {
  const base = object || {};
  return { ...base, [key]: rest.length ? setPath(base[key], rest, value) : value };
}

function useApp(showToast) {
  const [data, setData] = useState({});
  const updateEntryAtDate = (dateKey, path, value) => {
    setData((prev) => ({ ...prev, [dateKey]: setPath(prev[dateKey], path.split("."), value) }));
  };
  useWatchRuns({ ready: true, data, program: DEFAULT_PROGRAM, updateEntryAtDate, showToast });
  return data;
}

function installRuns({ runs = [], scheduling = "authorized" } = {}) {
  const plugin = {
    status: vi.fn(async () => ({ supported: true, scheduling, health: true })),
    enable: vi.fn(async () => ({ supported: true, scheduling, health: true })),
    schedule: vi.fn(async () => ({ scheduled: 1, removed: 0, authorized: scheduling === "authorized" })),
    clear: vi.fn(async () => {}),
    recentRuns: vi.fn(async () => ({ runs })),
  };
  window.Capacitor = { isNativePlatform: () => true, Plugins: { OTRuns: plugin } };
  return plugin;
}

beforeEach(() => localStorage.clear());

afterEach(() => {
  cleanup();
  delete window.Capacitor;
  localStorage.clear();
});

describe("useWatchRuns", () => {
  it("does nothing in a browser", async () => {
    writeWatchRunsOn(true);
    const showToast = vi.fn();
    renderHook(() => useApp(showToast));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(showToast).not.toHaveBeenCalled();
  });

  it("does nothing in the app until it's turned on", async () => {
    const plugin = installRuns();
    renderHook(() => useApp(vi.fn()));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(plugin.recentRuns).not.toHaveBeenCalled();
    expect(plugin.schedule).not.toHaveBeenCalled();
  });

  it("sends the week's runs once it's on", async () => {
    const plugin = installRuns();
    renderHook(() => useApp(vi.fn()));
    act(() => writeWatchRunsOn(true));
    await waitFor(() => expect(plugin.schedule).toHaveBeenCalled(), { timeout: 4000 });
    const runs = JSON.parse(plugin.schedule.mock.calls[0][0].runs);
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) expect(run).toMatchObject({ id: expect.any(String), date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), blocks: expect.any(Array) });
  });

  it("fills an empty day from Apple Health and undoes it", async () => {
    const today = getTodayKey();
    installRuns({ runs: [{ id: "hk-1", date: today, meters: 8046.72, seconds: 2430 }] });
    writeWatchRunsOn(true);
    const showToast = vi.fn();
    const { result } = renderHook(() => useApp(showToast));
    await waitFor(() => expect(result.current[today]?.workout?.cardio).toMatchObject({ miles: "5", time: "40:30", pace: "8:06" }));
    expect(showToast).toHaveBeenCalledWith("Today’s run filled in from Apple Health", expect.objectContaining({ action: "Undo" }));
    expect(readHandledRuns()).toEqual(["hk-1"]);
    act(() => showToast.mock.calls[0][1].onAction());
    await waitFor(() => expect(result.current[today].workout.cardio).toMatchObject({ miles: "", time: "", pace: "" }));
  });

  it("doesn't fill the same run twice", async () => {
    const today = getTodayKey();
    const plugin = installRuns({ runs: [{ id: "hk-1", date: today, meters: 8046.72, seconds: 2430 }] });
    localStorage.setItem("ovt-health-runs-handled", JSON.stringify(["hk-1"]));
    writeWatchRunsOn(true);
    const showToast = vi.fn();
    const { result } = renderHook(() => useApp(showToast));
    await waitFor(() => expect(plugin.recentRuns).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(showToast).not.toHaveBeenCalled();
    expect(result.current[today]).toBeUndefined();
  });
});

describe("AppleWatchCard", () => {
  it("turns runs on once iOS allows it", async () => {
    const plugin = installRuns();
    render(<AppleWatchCard />);
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Turn off" })).toBeTruthy());
    expect(plugin.enable).toHaveBeenCalled();
    expect(readWatchRunsOn()).toBe(true);
    expect(screen.getByRole("status").textContent).toMatch(/on their way to the Workout app/);
  });

  it("says why when iOS doesn't allow it", async () => {
    installRuns({ scheduling: "denied" });
    render(<AppleWatchCard />);
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/isn’t allowed to add workouts/));
    expect(readWatchRunsOn()).toBe(false);
  });

  it("turns runs off and takes them off the watch", async () => {
    const plugin = installRuns();
    writeWatchRunsOn(true);
    render(<AppleWatchCard />);
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    await waitFor(() => expect(plugin.clear).toHaveBeenCalled());
    expect(readWatchRunsOn()).toBe(false);
    expect(screen.getByRole("button", { name: "Turn on" })).toBeTruthy();
  });
});
