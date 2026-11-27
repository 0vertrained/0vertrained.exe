// src/__tests__/watchBridge.test.jsx
// In the iPhone app the bridge writes the watch's sets through the same
// updateEntryAtDate every edit uses, confirms them to the phone's inbox, and
// sends today's plan back with those events marked as seen. In a browser, or
// before the account's data is in, it does nothing.
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { DAYS, getTodayKey } from "../constants";
import { useWatchBridge } from "../watch/useWatchBridge";

const upper = { type: "Upper B", lifting: [{ name: "Bench Press", sets: 3, reps: 8 }], cardio: null };
const program = Object.fromEntries(DAYS.map((day) => [day, upper]));

function setPath(object, [key, ...rest], value) {
  const base = object || {};
  return { ...base, [key]: rest.length ? setPath(base[key], rest, value) : value };
}

function useApp(ready, owner = null, stageDays) {
  const [data, setData] = useState({});
  const updateEntryAtDate = (dateKey, path, value) => {
    setData((prev) => ({ ...prev, [dateKey]: setPath(prev[dateKey], path.split("."), value) }));
  };
  useWatchBridge({ ready, owner, data, program, updateEntryAtDate, stageDays });
  return data;
}

function installWatch(inbox) {
  const watch = {
    pending: vi.fn(async () => ({ events: inbox.splice(0) })),
    ack: vi.fn(async () => {}),
    sendPlan: vi.fn(async () => {}),
    addListener: vi.fn(() => ({ remove: vi.fn(async () => {}) })),
  };
  window.Capacitor = { isNativePlatform: () => true, Plugins: { OTWatch: watch } };
  return watch;
}

const eventFor = (dateKey, id, setIndex) => JSON.stringify({
  v: 1, type: "set", id, date: dateKey, session: "main", exercise: "Bench Press",
  setIndex, values: { weight: 185, reps: 8 }, at: new Date().toISOString(),
});

afterEach(() => {
  delete window.Capacitor;
  localStorage.removeItem("0vt.watch.legacyOwner.v1");
});

describe("useWatchBridge", () => {
  it("does nothing in a browser", async () => {
    const { result } = renderHook(() => useApp(true));
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(result.current).toEqual({});
  });

  it("waits for the account's data before touching the inbox", async () => {
    const watch = installWatch([eventFor(getTodayKey(), "a", 0)]);
    renderHook(() => useApp(false));
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(watch.pending).not.toHaveBeenCalled();
    expect(watch.sendPlan).not.toHaveBeenCalled();
  });

  it("writes the watch's sets, confirms them, and sends the plan with them seen", async () => {
    const today = getTodayKey();
    const watch = installWatch([eventFor(today, "a", 0), eventFor(today, "b", 1)]);
    const { result } = renderHook(() => useApp(true));

    await waitFor(() => expect(watch.ack).toHaveBeenCalledWith({ ids: ["a", "b"] }));
    await waitFor(() => {
      const sets = result.current[today]?.workout?.exercises?.["Bench Press"]?.sets || [];
      expect(sets.map((set) => set.done === true)).toEqual([true, true, false]);
    });
    expect(watch.addListener).toHaveBeenCalledWith("watchEvent", expect.any(Function));

    await waitFor(() => {
      const weeks = watch.sendPlan.mock.calls.map(([options]) => JSON.parse(options.plan));
      const last = weeks[weeks.length - 1];
      expect(last.seen).toEqual(["a", "b"]);
      expect(last.days).toHaveLength(7);
      expect(last.days[0].date).toBe(today);
      expect(last.days[0].sessions[0].exercises[0].sets.map((set) => set.done)).toEqual([true, true, false]);
    }, { timeout: 3000 });
  });

  it("only stages and receipts this athlete's edits across account switches", async () => {
    const today = getTodayKey();
    const raw = (owner, id) => JSON.stringify({ ...JSON.parse(eventFor(today, id, 0)), owner });
    const watch = installWatch([]);
    // A prior native bridge can return the entire unfiltered inbox.
    watch.pending.mockResolvedValue({ events: [raw("A", "first"), raw("B", "second"), eventFor(today, "legacy", 1)] });
    localStorage.setItem("0vt.watch.legacyOwner.v1", "A");
    const stage = vi.fn(() => true);
    const { rerender } = renderHook(({ owner }) => useApp(true, owner, stage), { initialProps: { owner: "B" } });
    await waitFor(() => expect(watch.ack).toHaveBeenCalledWith({ owner: "B", ids: ["second"] }));
    await waitFor(() => expect(watch.sendPlan).toHaveBeenCalled());
    const b = JSON.parse(watch.sendPlan.mock.calls.at(-1)[0].plan);
    expect(b.seen).toEqual(["second"]);
    expect(b.days.every(day => day.owner === "B")).toBe(true);
    rerender({ owner: "A" });
    await waitFor(() => expect(watch.ack).toHaveBeenCalledWith({ owner: "A", ids: ["first", "legacy"] }));
    await waitFor(() => expect(JSON.parse(watch.sendPlan.mock.calls.at(-1)[0].plan).seen).toEqual(["first", "legacy"]));
  });

  it("retries an edit when the durable phone journal refuses it", async () => {
    const today = getTodayKey();
    const watch = installWatch([]);
    watch.pending.mockResolvedValue({ events: [eventFor(today, "delayed", 0)] });
    const stage = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
    const { result } = renderHook(() => useApp(true, null, stage));
    await waitFor(() => expect(stage).toHaveBeenCalledOnce());
    expect(watch.ack).not.toHaveBeenCalled();
    expect(result.current[today]).toBeUndefined();
    watch.addListener.mock.calls[0][1]();
    await waitFor(() => expect(watch.ack).toHaveBeenCalledWith({ ids: ["delayed"] }));
    expect(result.current[today].workout.exercises["Bench Press"].sets[0].watchEventID).toBe("delayed");
  });

  it("drains again when the phone hears from the watch", async () => {
    const today = getTodayKey();
    const inbox = [];
    const watch = installWatch(inbox);
    const { result } = renderHook(() => useApp(true));
    await waitFor(() => expect(watch.addListener).toHaveBeenCalled());
    const onEvent = watch.addListener.mock.calls[0][1];

    inbox.push(eventFor(today, "c", 0));
    onEvent();
    await waitFor(() => expect(result.current[today]?.workout?.exercises?.["Bench Press"]?.sets?.[0]?.done).toBe(true));
    inbox.push(eventFor(today, "d", 1));
    onEvent();
    await waitFor(() => {
      const sets = result.current[today].workout.exercises["Bench Press"].sets;
      expect(sets.map((set) => set.done === true)).toEqual([true, true, false]);
    });
  });
});
