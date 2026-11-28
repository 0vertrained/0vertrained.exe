// src/__tests__/moveDay.test.jsx
// Train → Move a day: pick a day, then the day it swaps with. Logged days
// stay put and the past can't trade with the past.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MoveDaySheet } from "../MoveDay";

afterEach(cleanup);

const week = [
  { dayName: "Monday", dateKey: "2026-11-23", label: "Mon 23", title: "Upper A", detail: "0 of 8 exercises", when: "past", started: false, done: false },
  { dayName: "Tuesday", dateKey: "2026-11-24", label: "Tue 24", title: "Lower A", detail: "Lifting · done", when: "past", started: true, done: true },
  { dayName: "Wednesday", dateKey: "2026-11-25", label: "Wed 25", title: "Rest day", detail: "No training planned", when: "past", started: false, done: false },
  { dayName: "Thursday", dateKey: "2026-11-26", label: "Thu 26", title: "Cardio A", detail: "Intervals", when: "today", started: false, done: false },
  { dayName: "Friday", dateKey: "2026-11-27", label: "Fri 27", title: "Upper B", detail: "8 exercises", when: "ahead", started: false, done: false },
];

const row = (name) => screen.getByRole("button", { name: new RegExp(`^${name}`) });

describe("MoveDaySheet", () => {
  it("swaps the first day picked with the second", () => {
    const onSwap = vi.fn();
    const onClose = vi.fn();
    render(<MoveDaySheet open week={week} onSwap={onSwap} onClose={onClose} />);
    fireEvent.click(row("Fri 27"));
    expect(screen.getByRole("dialog", { name: "Swap Friday with" })).toBeTruthy();
    fireEvent.click(row("Thu 26"));
    expect(onSwap).toHaveBeenCalledWith("Friday", "Thursday");
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps logged days put, and lets a missed day trade only with today or ahead", () => {
    const onSwap = vi.fn();
    render(<MoveDaySheet open week={week} onSwap={onSwap} onClose={vi.fn()} />);
    expect(within(row("Tue 24")).getByText("Training already logged")).toBeTruthy();
    fireEvent.click(row("Tue 24"));
    expect(screen.getByRole("dialog", { name: "Move a day this week" })).toBeTruthy();
    fireEvent.click(row("Mon 23"));
    expect(within(row("Wed 25")).getByText("Pick today or a day ahead")).toBeTruthy();
    fireEvent.click(row("Wed 25"));
    expect(onSwap).not.toHaveBeenCalled();
    fireEvent.click(row("Thu 26"));
    expect(onSwap).toHaveBeenCalledWith("Monday", "Thursday");
  });

  it("offers to put the week back when something has moved", () => {
    const onReset = vi.fn();
    render(<MoveDaySheet open week={week} onSwap={vi.fn()} onReset={onReset} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Put this week back as planned" }));
    expect(onReset).toHaveBeenCalled();
  });

  it("keeps an aligned race and its taper out of the swap choices", () => {
    const onSwap = vi.fn();
    const protectedWeek = week.map(day => ({ ...day, moveLock: day.dayName === "Thursday" ? "Race taper" : null }));
    render(<MoveDaySheet open week={protectedWeek} onSwap={onSwap} onClose={vi.fn()} />);
    expect(row("Thu 26").getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(row("Fri 27"));
    fireEvent.click(row("Thu 26"));
    expect(within(row("Thu 26")).getByText("Race taper")).toBeTruthy();
    expect(onSwap).not.toHaveBeenCalled();
  });
});
