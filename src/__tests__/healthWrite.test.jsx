// src/__tests__/healthWrite.test.jsx
// With Save to Apple Health on in the iPhone app, the weight you type, each
// day's food totals and lifts finished in the runner go to Health, with the
// session's effort; a lift the watch tracked only gets the rating. A day is
// saved again only when it changed, and weight Health filled in isn't sent
// back.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { planHealthWrites, readSaved, recordWrite, writeHealthWriteOn } from "../health/healthWrite";
import { useHealthWrite } from "../health/useHealthWrite";
import { APP_FOREGROUND_EVENT } from "../integrations/appForeground";
import { AppleHealthCard } from "../sections/AppleHealthCard";

const TODAY = "2026-11-26";
const set = { weight: "185", reps: "8", done: true };
const lifted = {
  body: { weight: "182.4" },
  nutrition: { calories: "2650", protein: "205", carbs: "", fats: "71" },
  workout: {
    rpe: "7",
    exercises: { Bench: { sets: [set, set] } },
    sessionState: { main: { status: "complete", startedAt: "2026-11-26T16:00:00.000Z", completedAt: "2026-11-26T17:05:00.000Z" } },
  },
};

describe("planHealthWrites", () => {
  it("saves the typed weight, the food totals and the finished lift with its effort", () => {
    const writes = planHealthWrites({ data: { [TODAY]: lifted }, todayKey: TODAY });
    expect(writes).toEqual([
      { key: "weight.2026-11-26", signature: "182.4", kind: "weight", date: TODAY, pounds: 182.4 },
      { key: "food.2026-11-26", signature: JSON.stringify({ calories: 2650, protein: 205, carbs: 0, fat: 71 }), kind: "food", date: TODAY, calories: 2650, protein: 205, carbs: 0, fat: 71 },
      { key: "lift.2026-11-26.main", signature: JSON.stringify([Date.parse("2026-11-26T16:00:00.000Z"), Date.parse("2026-11-26T17:05:00.000Z"), 7]), kind: "lift", date: TODAY, id: "2026-11-26-main", start: Date.parse("2026-11-26T16:00:00.000Z"), end: Date.parse("2026-11-26T17:05:00.000Z"), effort: 7 },
    ]);
  });

  it("leaves out what was saved as it is, and weight Health filled in", () => {
    const first = planHealthWrites({ data: { [TODAY]: lifted }, todayKey: TODAY });
    const saved = first.reduce((all, write) => recordWrite(all, write, true), {});
    expect(planHealthWrites({ data: { [TODAY]: lifted }, todayKey: TODAY, saved })).toEqual([]);
    // A new rating saves the lift again.
    const rated = { ...lifted, workout: { ...lifted.workout, rpe: "8" } };
    expect(planHealthWrites({ data: { [TODAY]: rated }, todayKey: TODAY, saved }).map((write) => write.kind)).toEqual(["lift"]);
    const fromHealth = { body: { weight: "181.9" }, health: { weightLb: "181.9" } };
    expect(planHealthWrites({ data: { [TODAY]: fromHealth }, todayKey: TODAY })).toEqual([]);
  });

  it("clears food totals that went back to nothing, once saved", () => {
    const empty = { nutrition: { calories: "", protein: "" } };
    expect(planHealthWrites({ data: { [TODAY]: empty }, todayKey: TODAY })).toEqual([]);
    const writes = planHealthWrites({ data: { [TODAY]: empty }, todayKey: TODAY, saved: { "food.2026-11-26": "{}" } });
    expect(writes[0]).toMatchObject({ kind: "food", calories: 0, protein: 0 });
  });

  it("only rates a lift the watch tracked, trying a few times", () => {
    const watched = { workout: { rpe: "6", exercises: { Bench: { sets: [set] } }, sessionState: lifted.workout.sessionState, watchWorkouts: [{ id: "w1", startedAt: "2026-11-26T16:01:00.000Z", endedAt: "2026-11-26T17:00:00.000Z", seconds: 3540 }] } };
    const writes = planHealthWrites({ data: { [TODAY]: watched }, todayKey: TODAY });
    expect(writes).toEqual([{ key: "rate.2026-11-26.w1", signature: "6", kind: "rate", date: TODAY, start: Date.parse("2026-11-26T16:01:00.000Z"), end: Date.parse("2026-11-26T17:00:00.000Z"), effort: 6 }]);
    let saved = {};
    for (let tries = 0; tries < 3; tries += 1) saved = recordWrite(saved, writes[0], false);
    expect(planHealthWrites({ data: { [TODAY]: watched }, todayKey: TODAY, saved })).toEqual([]);
  });

  it("looks at today and the two days before", () => {
    const data = { "2026-11-23": lifted, "2026-11-24": lifted, "2026-11-26": { body: { weight: "180" } } };
    expect(planHealthWrites({ data, todayKey: TODAY }).map((write) => write.date)).toEqual(["2026-11-26", "2026-11-24", "2026-11-24", "2026-11-24"]);
  });
});

function installWrite() {
  const plugin = {
    enable: vi.fn(async () => ({ available: true, weight: "allowed", food: "denied", workouts: "allowed" })),
    saveWeight: vi.fn(async () => ({ saved: true })),
    saveFood: vi.fn(async () => ({ saved: true })),
    saveLift: vi.fn(async () => ({ saved: true, rated: true })),
    rateWorkout: vi.fn(async () => ({ rated: true })),
  };
  window.Capacitor = { isNativePlatform: () => true, Plugins: { OTHealthWrite: plugin, OTHealth: { enable: vi.fn(async () => ({ available: true })) } } };
  return plugin;
}

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.useRealTimers(); delete window.Capacitor; localStorage.clear(); });

describe("useHealthWrite", () => {
  it("saves once it's on, then only what changed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date(2026, 10, 26, 18, 0) });
    const plugin = installWrite();
    writeHealthWriteOn(true);
    const { rerender } = renderHook(({ data }) => useHealthWrite({ ready: true, data }), { initialProps: { data: { [TODAY]: lifted } } });
    await vi.advanceTimersByTimeAsync(4500);
    await waitFor(() => expect(plugin.saveLift).toHaveBeenCalledTimes(1));
    expect(plugin.saveWeight).toHaveBeenCalledWith({ date: TODAY, pounds: 182.4 });
    expect(plugin.saveFood).toHaveBeenCalledWith({ date: TODAY, calories: 2650, protein: 205, carbs: 0, fat: 71 });
    expect(plugin.saveLift).toHaveBeenCalledWith({ id: "2026-11-26-main", start: Date.parse("2026-11-26T16:00:00.000Z"), end: Date.parse("2026-11-26T17:05:00.000Z"), effort: 7 });
    expect(Object.keys(readSaved())).toHaveLength(3);

    rerender({ data: { [TODAY]: { ...lifted, body: { weight: "182" } } } });
    await vi.advanceTimersByTimeAsync(4500);
    await waitFor(() => expect(plugin.saveWeight).toHaveBeenCalledTimes(2));
    expect(plugin.saveFood).toHaveBeenCalledTimes(1);
    expect(plugin.saveLift).toHaveBeenCalledTimes(1);
  });

  it("retries a failed write on foreground with unchanged data, preserving each athlete’s save", async () => {
    vi.useFakeTimers({ now: new Date(2026, 10, 26, 18) });
    const plugin = installWrite();
    const data = { [TODAY]: { body: { weight: "182.4" } } };
    plugin.saveWeight.mockRejectedValueOnce(new Error("Health store locked"));
    writeHealthWriteOn(true, "A");
    const { rerender } = renderHook(({ owner }) => useHealthWrite({ owner, ready: true, data }), { initialProps: { owner: "A" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(4500); });
    expect(readSaved("A")).toEqual({});
    act(() => window.dispatchEvent(new Event(APP_FOREGROUND_EVENT)));
    await act(async () => { await vi.advanceTimersByTimeAsync(4500); });
    expect(readSaved("A")).toEqual({ ["weight." + TODAY]: "182.4" });
    act(() => window.dispatchEvent(new Event(APP_FOREGROUND_EVENT)));
    await act(async () => { await vi.advanceTimersByTimeAsync(4500); });
    expect(plugin.saveWeight).toHaveBeenCalledTimes(2);
    rerender({ owner: "B" });
    await act(async () => { await vi.advanceTimersByTimeAsync(4500); });
    expect(plugin.saveWeight).toHaveBeenCalledTimes(2);
    expect(readSaved("B")).toEqual({});
    act(() => writeHealthWriteOn(true, "B"));
    await act(async () => { await vi.advanceTimersByTimeAsync(4500); });
    expect(plugin.saveWeight).toHaveBeenLastCalledWith({ date: TODAY, pounds: 182.4, prefix: "ovt.athlete.B" });
    expect(plugin.enable).not.toHaveBeenCalled();
  });

  it("does nothing while it's off", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date(2026, 10, 26, 18, 0) });
    const plugin = installWrite();
    renderHook(() => useHealthWrite({ ready: true, data: { [TODAY]: lifted } }));
    await vi.advanceTimersByTimeAsync(4500);
    expect(plugin.saveWeight).not.toHaveBeenCalled();
  });
});

describe("Save to Apple Health in Settings", () => {
  it("turns on, and says what Health didn't allow", async () => {
    const plugin = installWrite();
    localStorage.setItem("ovt-health-daily-on", "1");
    render(<AppleHealthCard />);
    fireEvent.click(screen.getByRole("switch", { name: "Save to Apple Health" }));
    expect(await screen.findByText("Apple Health didn’t allow saving food. Allow it in the Health app under Sharing, Apps, 0VERTRAINED.")).toBeTruthy();
    expect(plugin.enable).toHaveBeenCalled();
    expect(screen.getByRole("switch", { name: "Save to Apple Health" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("switch", { name: "Save to Apple Health" }));
    expect(screen.getByText("What’s already in Apple Health stays there.")).toBeTruthy();
  });

  it("isn't offered in builds that can't save", () => {
    window.Capacitor = { isNativePlatform: () => true, Plugins: { OTHealth: { enable: vi.fn() } } };
    render(<AppleHealthCard />);
    expect(screen.queryByRole("switch", { name: "Save to Apple Health" })).toBeNull();
  });
});
