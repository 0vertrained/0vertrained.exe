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
import { APP_FOREGROUND_EVENT } from "../integrations/appForeground";
import { AppleWatchCard } from "../sections/AppleWatchCard";

function setPath(object, [key, ...rest], value) {
  const base = object || {};
  return { ...base, [key]: rest.length ? setPath(base[key], rest, value) : value };
}

function useApp(showToast, { initial = {}, stageDays, includeWriter = false } = {}) {
  const [data, setData] = useState(initial);
  const updateEntryAtDate = (dateKey, path, value) => {
    setData((prev) => ({ ...prev, [dateKey]: setPath(prev[dateKey], path.split("."), value) }));
  };
  useWatchRuns({ ready: true, data, program: DEFAULT_PROGRAM, updateEntryAtDate, showToast, stageDays });
  return includeWriter ? { data, updateEntryAtDate } : data;
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

  it("imports newly arrived Watch cardio on foreground without asking for access again", async () => {
    const today = getTodayKey();
    const runs = [];
    const plugin = installRuns({ runs });
    writeWatchRunsOn(true);
    const { result } = renderHook(() => useApp(vi.fn()));
    await act(async () => {});
    runs.push({ id: "offline-run", date: today, meters: 8046.72, seconds: 2430 });
    act(() => window.dispatchEvent(new Event(APP_FOREGROUND_EVENT)));
    await waitFor(() => expect(result.current[today]?.workout?.cardio?.miles).toBe("5"));
    expect(plugin.recentRuns).toHaveBeenCalledTimes(2);
    expect(plugin.enable).not.toHaveBeenCalled();
  });

  it("clears the previous athlete's scheduled workouts once when the active athlete has opted out", async () => {
    const plugin = installRuns();
    writeWatchRunsOn(true, "A");
    renderHook(() => useWatchRuns({ owner: "B", ready: true, data: {}, program: DEFAULT_PROGRAM, updateEntryAtDate: vi.fn() }));
    await waitFor(() => expect(plugin.clear).toHaveBeenCalledOnce());
    act(() => window.dispatchEvent(new Event(APP_FOREGROUND_EVENT)));
    await act(async () => {});
    expect(plugin.clear).toHaveBeenCalledOnce();
    expect(plugin.recentRuns).not.toHaveBeenCalled();
    expect(readWatchRunsOn("A")).toBe(true);
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

  it("reads the run's splits and effort once, and Undo takes them too", async () => {
    const today = getTodayKey();
    const plugin = installRuns({ runs: [{ id: "hk-1", date: today, meters: 8046.72, seconds: 2430 }] });
    const steady = Array.from({ length: 243 }, (_, index) => [(index + 1) * 10, ((index + 1) * 10 * 8046.72) / 2430]);
    plugin.runDetail = vi.fn(async () => ({ distance: steady, heartRate: [[60, 150]], pauses: [], effort: { value: 5, estimated: true } }));
    writeWatchRunsOn(true);
    const showToast = vi.fn();
    const { result, rerender } = renderHook(() => useApp(showToast));
    await waitFor(() => expect(result.current[today]?.workout?.cardio?.splits).toHaveLength(5));
    expect(plugin.runDetail).toHaveBeenCalledWith({ id: "hk-1" });
    expect(result.current[today].workout.cardio).toMatchObject({ effortScore: "5", effortEstimated: true });
    expect(result.current[today].workout.cardio.splits[0]).toMatchObject({ n: 1, miles: 1, seconds: 486, hr: 150 });
    expect(JSON.parse(localStorage.getItem("ovt-health-runs-detailed"))).toEqual(["hk-1"]);

    act(() => showToast.mock.calls[0][1].onAction());
    rerender();
    await waitFor(() => expect(result.current[today].workout.cardio).toMatchObject({ miles: "", splits: null, effortScore: "" }));
  });

  it("journals a Health import before marking its ID handled and retries when storage recovers", async () => {
    const today = getTodayKey();
    const plugin = installRuns({ runs: [{ id: "offline", date: today, meters: 1609.344, seconds: 600 }] });
    writeWatchRunsOn(true);
    const stageDays = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
    const { result } = renderHook(() => useApp(vi.fn(), { stageDays }));
    await waitFor(() => expect(stageDays).toHaveBeenCalledTimes(1));
    expect(result.current[today]).toBeUndefined();
    expect(readHandledRuns()).toEqual([]);
    act(() => window.dispatchEvent(new Event(APP_FOREGROUND_EVENT)));
    await waitFor(() => expect(readHandledRuns()).toEqual(["offline"]));
    expect(stageDays.mock.lastCall[0][today].workout.cardio).toMatchObject({ miles: "1", time: "10:00" });
    expect(result.current[today].workout.cardio.miles).toBe("1");
    expect(plugin.recentRuns).toHaveBeenCalledTimes(2);
  });

  it("undo restores the original linked climb, preserves other links and respects later edits", async () => {
    const today = getTodayKey();
    const previous = { source: "strava", id: "previous" };
    const initialBlock = { type: "Indoor climb", time: "11:00", miles: "0.9", pace: "12:13", hr: "130",
      climbRecordingId: "hill", indoor: true, activityRefs: [previous], splits: [{ n: 1, seconds: 660 }], effortScore: "4", effortEstimated: false };
    const initial = { [today]: { workout: { cardioSessions: { pm: initialBlock } } } };
    const plugin = installRuns({ runs: [{ id: "health", recordingId: "hill", sessionId: "climb:hill", activity: "run",
      date: today, meters: 1609.344, seconds: 600, avgHr: 150 }] });
    plugin.runDetail = vi.fn(async () => ({ effort: { value: 7, estimated: true }, segments: [{ seconds: 600, label: "Work" }] }));
    writeWatchRunsOn(true);
    const showToast = vi.fn();
    const { result } = renderHook(() => useApp(showToast, { initial, includeWriter: true }));
    const block = () => result.current.data[today].workout.cardioSessions.pm;
    await waitFor(() => expect(block().segments).toHaveLength(1));
    expect(block()).toMatchObject({ miles: "1", time: "10:00", hr: "150", effortScore: "4", effortEstimated: false });
    const extra = { source: "manual", id: "later" };
    act(() => {
      result.current.updateEntryAtDate(today, "workout.cardioSessions.pm.hr", "144");
      result.current.updateEntryAtDate(today, "workout.cardioSessions.pm.segments", [{ seconds: 301 }]);
      result.current.updateEntryAtDate(today, "workout.cardioSessions.pm.activityRefs", [...block().activityRefs, extra]);
    });
    act(() => showToast.mock.calls[0][1].onAction());
    await waitFor(() => expect(block()).toMatchObject({ ...initialBlock, hr: "144", activityRefs: [previous, extra], segments: [{ seconds: 301 }] }));
  });

  it("reads later workouts when an earlier detail request fails and undoes details received on retry", async () => {
    const first = "2026-11-24", second = "2026-11-25";
    const plugin = installRuns({ runs: [first, second].map((date, i) => ({ id: String(i), date, meters: 1609.344, seconds: 600 })) });
    plugin.runDetail = vi.fn().mockRejectedValueOnce(new Error("unavailable")).mockResolvedValue({ effort: { value: 6 } });
    writeWatchRunsOn(true);
    const toast = vi.fn();
    const { result } = renderHook(() => useApp(toast));
    await waitFor(() => expect(result.current[second]?.workout.cardio.effortScore).toBe("6"));
    expect(result.current[first].workout.cardio.effortScore).toBeUndefined();
    act(() => window.dispatchEvent(new Event(APP_FOREGROUND_EVENT)));
    await waitFor(() => expect(result.current[first].workout.cardio.effortScore).toBe("6"));
    expect(plugin.runDetail.mock.calls.map(([{id}]) => id)).toEqual(["0", "1", "0"]);
    act(() => toast.mock.calls[0][1].onAction());
    await waitFor(() => expect(result.current[first].workout.cardio.effortScore).toBe(""));
    expect(result.current[second].workout.cardio.effortScore).toBe("");
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
