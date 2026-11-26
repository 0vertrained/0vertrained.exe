// src/__tests__/widgetCards.test.jsx
// The iPhone widget gets today and the next six days as cards, read the way
// Today reads each day, with today's progress; the app sends them only when
// they change, and a browser sends nothing.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { DAYS, getTodayKey } from "../constants";
import { dayCard, weekCards } from "../widgets/widgetCards";
import { useWidgetCards } from "../widgets/useWidgetCards";
import { swapDays } from "../weekMoves";

const day = (type, lifting = [], cardio = null) => ({ type, lifting, cardio });
const program = {
  ...Object.fromEntries(DAYS.map((name) => [name, day("Rest")])),
  Thursday: day("Upper B", [{ name: "Row", sets: 3, reps: 10 }, { name: "Curl", sets: 3, reps: 12 }], { type: "Easy Run", minutes: 30 }),
  Friday: day("Long", [], { type: "Long Run", miles: 8 }),
};
const THU = "2026-11-26";

describe("dayCard", () => {
  it("names the day, what's in it and how far today has got", () => {
    expect(dayCard(program, THU)).toEqual({ date: THU, title: "Upper B", detail: "2 exercises · Easy Run, 30 min", kind: "both" });
    const logged = { workout: { exercises: { Row: { sets: [1, 2, 3].map(() => ({ weight: "135", reps: "10", done: true })) } } } };
    expect(dayCard(program, THU, logged).detail).toBe("1 of 2 exercises done · Easy Run, 30 min");
    expect(dayCard(program, "2026-11-27")).toEqual({ date: "2026-11-27", title: "Long", detail: "Long Run, 8 mi", kind: "run" });
    expect(dayCard(program, "2026-11-28")).toEqual({ date: "2026-11-28", title: "Rest day", detail: "", kind: "rest" });
  });

  it("follows a day moved this week", () => {
    expect(dayCard(swapDays(program, THU, "Thursday", "Friday"), THU).title).toBe("Long");
  });
});

describe("weekCards", () => {
  it("is today and the next six days", () => {
    expect(weekCards({ program, todayKey: THU }).map((card) => card.date)).toEqual([
      "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29", "2026-11-30", "2026-12-01", "2026-12-02",
    ]);
  });
});

afterEach(() => {
  cleanup();
  delete window.Capacitor;
});

describe("useWidgetCards", () => {
  it("sends the cards once, and again only when they change", async () => {
    const update = vi.fn(async () => ({ shared: true, changed: true }));
    window.Capacitor = { isNativePlatform: () => true, Plugins: { OTWidget: { update } } };
    const { rerender } = renderHook(({ data }) => useWidgetCards({ ready: true, data, program }), { initialProps: { data: {} } });
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1), { timeout: 2000 });
    const cards = JSON.parse(update.mock.calls[0][0].cards);
    expect(cards).toHaveLength(7);
    expect(cards[0].date).toBe(getTodayKey());
    rerender({ data: {} });
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("does nothing in a browser", async () => {
    const { result } = renderHook(() => useWidgetCards({ ready: true, data: {}, program }));
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(result.current).toBeUndefined();
  });
});
