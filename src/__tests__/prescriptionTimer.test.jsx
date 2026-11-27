import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CardioSession } from "../CardioSession.jsx";
import { buildSegments, suggestPlanForCardio, totalPlannedSeconds } from "../cardioSession";
import { MIXED_PLANS } from "../plans/mixed";
import { editCardio } from "../ProgramScreen";
import { ThemeProvider } from "../theme";

const base = MIXED_PLANS.cardioBase.program;

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("prescribed cardio sessions", () => {
  it("uses every scheduled minute and recovers only between hard efforts", () => {
    for (const preset of Object.values(MIXED_PLANS)) {
      for (const { cardio } of Object.values(preset.program)) {
        if (cardio) expect(totalPlannedSeconds(suggestPlanForCardio(cardio))).toBe(cardio.minutes * 60);
      }
    }
    const segments = buildSegments(suggestPlanForCardio(base.Wednesday.cardio));
    expect(segments.map(({ kind, seconds }) => [kind, seconds])).toEqual([
      ["warmup", 600], ["work", 240], ["rest", 180], ["work", 240], ["rest", 180],
      ["work", 240], ["rest", 180], ["work", 240], ["cooldown", 300],
    ]);
  });

  it("uses an edited time target even if older interval text or steps remain", () => {
    const cardio = { ...base.Wednesday.cardio, notes: "4×4min with 3 min rest", minutes: "75.5" };
    const expected = [{ kind: "steady", seconds: 4530, round: 0 }];
    expect(buildSegments(suggestPlanForCardio(cardio))).toEqual(expected);
    expect(buildSegments(suggestPlanForCardio({ ...cardio, steps: undefined }))).toEqual(expected);
    // Distance-based and legacy race intervals keep the existing timer behavior.
    expect(suggestPlanForCardio({ ...base.Wednesday.cardio, miles: 5 })).toEqual({
      work: 240, rest: 180, rounds: 4, warmup: 600,
    });
    expect(suggestPlanForCardio({ notes: "6x3min, 1min rest" })).toMatchObject({ rounds: 6, work: 180, rest: 60 });
  });

  it("keeps the time target when the editor renames a workout or the athlete types their own", () => {
    const renamed = editCardio(base.Wednesday.cardio, "type", "My lunch break");
    expect(suggestPlanForCardio(renamed)).toEqual({ kind: "steady", seconds: 2400 });
    const custom = { type: "Lunch hour", minutes: "25", notes: "Previously used 4×4min" };
    expect(suggestPlanForCardio(custom)).toEqual({ kind: "steady", seconds: 1500 });
    render(<ThemeProvider><CardioSession open cardio={renamed} onClose={() => {}} /></ThemeProvider>);
    expect(screen.getByText("Total 40:00")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Duration" })).toBeTruthy();
  });

  it("opens a steady session with its editable duration and logs its elapsed time", () => {
    vi.useFakeTimers();
    const onLogTime = vi.fn();
    render(<ThemeProvider><CardioSession open cardio={base.Sunday.cardio} onLogTime={onLogTime} onClose={() => {}} /></ThemeProvider>);
    expect(screen.getByText("Total 50:00")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Rounds" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Less duration" }));
    expect(screen.getByText("Total 49:00")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(screen.getByRole("timer").textContent).toBe("49:00");
    expect(screen.getByRole("status").textContent).toBe("Steady.");
    act(() => vi.advanceTimersByTime(120_000));
    fireEvent.click(screen.getByRole("button", { name: "End" }));
    fireEvent.click(screen.getByRole("button", { name: "Log 2:00 to today" }));
    expect(onLogTime).toHaveBeenCalledWith("2:00");
  });

  it("keeps the planned interval and cool-down deadlines when the clock advances", () => {
    vi.useFakeTimers();
    const cardio = MIXED_PLANS.balancedHybrid.program.Saturday.cardio;
    render(<ThemeProvider><CardioSession open cardio={cardio} onClose={() => {}} /></ThemeProvider>);
    expect(screen.getByText("Total 33:00")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Cool-down" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    act(() => vi.advanceTimersByTime(28 * 60_000));
    expect(screen.getByRole("status").textContent).toBe("Cool-down.");
    expect(screen.getByRole("timer").textContent).toBe("5:00");
    expect(screen.getByRole("img", { name: "3 of 3 work rounds done" })).toBeTruthy();
    act(() => vi.advanceTimersByTime(7 * 60_000));
    expect(screen.getByRole("button", { name: "Log 33:00 to today" })).toBeTruthy();
  });
});
