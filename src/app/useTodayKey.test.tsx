import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localDateKey, useTodayKey } from "./useTodayKey";

describe("useTodayKey", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("formats the local calendar day", () => {
    expect(localDateKey(new Date(2026, 9, 2, 23, 59))).toBe("2026-10-02");
    expect(localDateKey(new Date(2026, 0, 5, 0, 0))).toBe("2026-01-05");
  });

  it("rolls over at local midnight and on focus", () => {
    vi.setSystemTime(new Date(2026, 9, 2, 23, 59, 30));
    const { result } = renderHook(() => useTodayKey());
    expect(result.current).toBe("2026-10-02");
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current).toBe("2026-10-03");
    vi.setSystemTime(new Date(2026, 9, 4, 8, 0));
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(result.current).toBe("2026-10-04");
  });
});
