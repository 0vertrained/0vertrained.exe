import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimerEvent } from "../../domain/training/cardio";
import { clockPhase, clockStorageKey, useCardioClock } from "./useCardioClock";

const DAY = "2026-10-03";
const KEY = clockStorageKey(DAY);

describe("useCardioClock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 3, 7, 0, 0));
  });
  afterEach(() => vi.useRealTimers());

  it("is idle at zero with no events", () => {
    const { result } = renderHook(() => useCardioClock(DAY));
    expect(result.current.phase).toBe("idle");
    expect(result.current.running).toBe(false);
    expect(result.current.elapsedSeconds).toBe(0);
    expect(result.current.events).toEqual([]);
  });

  it("counts up from start, freezes on pause and continues on resume", () => {
    const { result } = renderHook(() => useCardioClock(DAY));
    act(() => result.current.start());
    expect(result.current.running).toBe(true);
    expect(result.current.phase).toBe("running");
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current.elapsedSeconds).toBeCloseTo(3, 1);
    act(() => result.current.pause());
    expect(result.current.running).toBe(false);
    expect(result.current.phase).toBe("paused");
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current.elapsedSeconds).toBeCloseTo(3, 1);
    act(() => result.current.resume());
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.elapsedSeconds).toBeCloseTo(5, 1);
    expect(result.current.events.map((e) => e.type)).toEqual(["start", "pause", "resume"]);
  });

  it("shows the real elapsed time after a late tick or on becoming visible (a background tab)", () => {
    const { result } = renderHook(() => useCardioClock(DAY));
    act(() => result.current.start());
    vi.setSystemTime(Date.now() + 10 * 60_000);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current.elapsedSeconds).toBeCloseTo(600, 1);
    vi.setSystemTime(Date.now() + 5 * 60_000);
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(result.current.elapsedSeconds).toBeCloseTo(900.25, 1);
  });

  it("persists its events in sessionStorage and restores them on a fresh mount", () => {
    const first = renderHook(() => useCardioClock(DAY));
    act(() => first.result.current.start());
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    act(() => first.result.current.pause());
    const stored = JSON.parse(window.sessionStorage.getItem(KEY) ?? "[]") as TimerEvent[];
    expect(stored.map((e) => e.type)).toEqual(["start", "pause"]);
    first.unmount();

    const second = renderHook(() => useCardioClock(DAY));
    expect(second.result.current.phase).toBe("paused");
    expect(second.result.current.elapsedSeconds).toBeCloseTo(4, 1);
    act(() => second.result.current.resume());
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(second.result.current.elapsedSeconds).toBeCloseTo(5, 1);
  });

  it("restores a running clock and keeps counting from the real time", () => {
    window.sessionStorage.setItem(KEY, JSON.stringify([{ type: "start", atMs: Date.now() - 90_000 }]));
    const { result } = renderHook(() => useCardioClock(DAY));
    expect(result.current.running).toBe(true);
    expect(result.current.elapsedSeconds).toBeCloseTo(90, 1);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.elapsedSeconds).toBeCloseTo(91, 1);
  });

  it("opens idle on junk in storage", () => {
    window.sessionStorage.setItem(KEY, "{not json");
    expect(renderHook(() => useCardioClock(DAY)).result.current.phase).toBe("idle");
    window.sessionStorage.setItem(KEY, JSON.stringify([{ type: "start" }, 5, { type: "bogus", atMs: 1 }]));
    const { result } = renderHook(() => useCardioClock(DAY));
    expect(result.current.phase).toBe("idle");
    expect(result.current.events).toEqual([]);
  });

  it("stop ends the session: the time freezes and later actions are ignored", () => {
    const { result } = renderHook(() => useCardioClock(DAY));
    act(() => result.current.start());
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    act(() => result.current.stop());
    expect(result.current.phase).toBe("stopped");
    expect(result.current.running).toBe(false);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(result.current.elapsedSeconds).toBeCloseTo(2, 1);
    act(() => result.current.start());
    act(() => result.current.resume());
    expect(result.current.events.map((e) => e.type)).toEqual(["start", "stop"]);
  });

  it("reset empties the events and their stored copy", () => {
    const { result } = renderHook(() => useCardioClock(DAY));
    act(() => result.current.start());
    expect(window.sessionStorage.getItem(KEY)).not.toBeNull();
    act(() => result.current.reset());
    expect(result.current.phase).toBe("idle");
    expect(result.current.elapsedSeconds).toBe(0);
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it("switches to the other day's events when the date key changes", () => {
    window.sessionStorage.setItem(clockStorageKey("2026-10-04"), JSON.stringify([{ type: "start", atMs: Date.now() - 1000 }, { type: "pause", atMs: Date.now() }]));
    const { result, rerender } = renderHook(({ day }: { day: string }) => useCardioClock(day), { initialProps: { day: DAY } });
    expect(result.current.phase).toBe("idle");
    rerender({ day: "2026-10-04" });
    expect(result.current.phase).toBe("paused");
    expect(result.current.elapsedSeconds).toBeCloseTo(1, 1);
  });

  it("ignores actions that make no sense in the current phase", () => {
    const { result } = renderHook(() => useCardioClock(DAY));
    act(() => result.current.pause());
    act(() => result.current.resume());
    act(() => result.current.stop());
    expect(result.current.events).toEqual([]);
    act(() => result.current.start());
    act(() => result.current.resume());
    act(() => result.current.start());
    act(() => result.current.pause());
    act(() => result.current.pause());
    expect(result.current.events.map((e) => e.type)).toEqual(["start", "pause"]);
  });
});

describe("clockPhase", () => {
  it("mirrors the rules activeSeconds applies", () => {
    expect(clockPhase([])).toBe("idle");
    expect(clockPhase([{ type: "pause", atMs: 1 }])).toBe("idle");
    expect(clockPhase([{ type: "start", atMs: 1 }])).toBe("running");
    expect(clockPhase([{ type: "start", atMs: 1 }, { type: "pause", atMs: 2 }])).toBe("paused");
    expect(clockPhase([{ type: "start", atMs: 1 }, { type: "pause", atMs: 2 }, { type: "pause", atMs: 3 }, { type: "resume", atMs: 4 }])).toBe("running");
    expect(clockPhase([{ type: "start", atMs: 1 }, { type: "stop", atMs: 2 }, { type: "resume", atMs: 3 }])).toBe("stopped");
    expect(clockPhase([{ type: "pause", atMs: 2 }, { type: "start", atMs: 1 }])).toBe("paused");
  });
});
