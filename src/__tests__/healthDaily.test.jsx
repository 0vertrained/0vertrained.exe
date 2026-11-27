// src/__tests__/healthDaily.test.jsx
// With Apple Health turned on in the iPhone app, the day's steps and weight
// fill in, and sleep, resting heart rate and HRV too when there's no Oura or
// Whoop. Empty fields are filled and kept current; typed numbers stay.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { planHealthDailyFills } from "../health/healthDaily";
import { useHealthDaily } from "../health/useHealthDaily";
import { readHealthDailyOn, writeHealthDailyOn } from "../health/healthDailyState";
import { APP_FOREGROUND_EVENT } from "../integrations/appForeground";
import { AppleHealthCard } from "../sections/AppleHealthCard";

const DAY = "2026-11-26";
const health = { date: DAY, steps: 8123.4, weightLb: 190.24, sleepHours: 7.36, restingHr: 52.4, hrv: 61.2 };

describe("planHealthDailyFills", () => {
  it("fills every empty field without a ring or strap, remembering what it wrote", () => {
    const writes = planHealthDailyFills({ days: [health], data: {} });
    expect(writes).toEqual([
      { dateKey: DAY, path: "activity.steps", value: "8123" },
      { dateKey: DAY, path: "health.steps", value: "8123" },
      { dateKey: DAY, path: "body.weight", value: "190.2" },
      { dateKey: DAY, path: "health.weightLb", value: "190.2" },
      { dateKey: DAY, path: "body.sleep", value: "7.4" },
      { dateKey: DAY, path: "health.sleepHours", value: "7.4" },
      { dateKey: DAY, path: "body.restingHeartRate", value: "52" },
      { dateKey: DAY, path: "health.restingHr", value: "52" },
      { dateKey: DAY, path: "body.hrv", value: "61" },
      { dateKey: DAY, path: "health.hrv", value: "61" },
    ]);
  });

  it("leaves sleep, resting heart rate and HRV to Oura or Whoop", () => {
    const paths = planHealthDailyFills({ days: [health], data: {}, wearables: true }).map((write) => write.path);
    expect(paths).toEqual(["activity.steps", "health.steps", "body.weight", "health.weightLb"]);
  });

  it("keeps its own numbers current, and never touches a typed one", () => {
    const data = { [DAY]: { activity: { steps: "5000" }, body: { weight: "191" }, health: { steps: "5000" } } };
    const writes = planHealthDailyFills({ days: [{ date: DAY, steps: 8123, weightLb: 190.2 }], data, wearables: true });
    expect(writes).toEqual([
      { dateKey: DAY, path: "activity.steps", value: "8123" },
      { dateKey: DAY, path: "health.steps", value: "8123" },
    ]);
    const settled = { [DAY]: { activity: { steps: "8123" }, health: { steps: "8123" } } };
    expect(planHealthDailyFills({ days: [{ date: DAY, steps: 8123 }], data: settled })).toEqual([]);
  });

  it("skips days and numbers it can't use", () => {
    expect(planHealthDailyFills({ days: [{ date: "today", steps: 10 }, { date: DAY, steps: 0, weightLb: null }], data: {} })).toEqual([]);
  });
});

function setPath(object, [key, ...rest], value) {
  const base = object || {};
  return { ...base, [key]: rest.length ? setPath(base[key], rest, value) : value };
}

function useApp(wearables = false) {
  const [data, setData] = useState({});
  const updateEntryAtDate = (dateKey, path, value) => {
    setData((prev) => ({ ...prev, [dateKey]: setPath(prev[dateKey], path.split("."), value) }));
  };
  useHealthDaily({ ready: true, data, wearables, updateEntryAtDate });
  return data;
}

function installHealth(days = [health]) {
  const plugin = { status: vi.fn(async () => ({ available: true })), enable: vi.fn(async () => ({ available: true })), daily: vi.fn(async () => ({ days })) };
  window.Capacitor = { isNativePlatform: () => true, Plugins: { OTHealth: plugin } };
  return plugin;
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  delete window.Capacitor;
  localStorage.clear();
});

describe("useHealthDaily", () => {
  it("does nothing until it's turned on, then fills the log from Health", async () => {
    const plugin = installHealth();
    const { result, rerender } = renderHook(() => useApp());
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(plugin.daily).not.toHaveBeenCalled();
    writeHealthDailyOn(true);
    rerender();
    await waitFor(() => expect(result.current[DAY]?.activity?.steps).toBe("8123"));
    expect(plugin.daily).toHaveBeenCalledWith({ days: 3 });
    expect(result.current[DAY].body).toMatchObject({ weight: "190.2", sleep: "7.4", restingHeartRate: "52", hrv: "61" });
  });

  it("refreshes on native foreground and discards an in-flight read after switching athletes", async () => {
    const plugin = installHealth([]);
    const write = vi.fn();
    let complete;
    localStorage.setItem("ovt-health-daily-on", "1");
    localStorage.setItem("0vt.watch.legacyOwner.v1", "A");
    const { rerender } = renderHook(({ owner, ready }) =>
      useHealthDaily({ owner, ready, data: {}, updateEntryAtDate: write }), { initialProps: { owner: "A", ready: false } });
    expect(plugin.daily).not.toHaveBeenCalled();
    rerender({ owner: "A", ready: true });
    await act(async () => {});
    expect(plugin.daily).toHaveBeenCalledTimes(1);
    plugin.daily.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    act(() => window.dispatchEvent(new Event(APP_FOREGROUND_EVENT)));
    act(() => window.dispatchEvent(new Event(APP_FOREGROUND_EVENT)));
    expect(plugin.daily).toHaveBeenCalledTimes(2);
    rerender({ owner: "B", ready: true });
    act(() => window.dispatchEvent(new Event(APP_FOREGROUND_EVENT)));
    await act(async () => complete({ days: [health] }));
    expect(plugin.daily).toHaveBeenCalledTimes(2);
    expect(write).not.toHaveBeenCalled();
    act(() => writeHealthDailyOn(true, "B"));
    await waitFor(() => expect(plugin.daily).toHaveBeenCalledTimes(3));
    act(() => writeHealthDailyOn(false, "B"));
    act(() => window.dispatchEvent(new Event(APP_FOREGROUND_EVENT)));
    expect(plugin.daily).toHaveBeenCalledTimes(3);
    expect(readHealthDailyOn("A")).toBe(true);
    expect(plugin.enable).not.toHaveBeenCalled();
  });

  it("does nothing in a browser", async () => {
    writeHealthDailyOn(true);
    const { result } = renderHook(() => useApp());
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(result.current).toEqual({});
  });
});

describe("AppleHealthCard", () => {
  it("turns on after asking iOS, and off again", async () => {
    const plugin = installHealth();
    render(<AppleHealthCard wearables />);
    expect(screen.getByText(/Sleep, resting heart rate and HRV keep coming from Oura or Whoop/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    await waitFor(() => expect(readHealthDailyOn()).toBe(true));
    expect(plugin.enable).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    expect(readHealthDailyOn()).toBe(false);
    expect(screen.getByRole("status").textContent).toMatch(/stay in your log/);
  });
});
