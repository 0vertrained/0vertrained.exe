import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { lbToKg } from "../../domain/units";
import { expectNoA11yViolations } from "../../test/axe";
import type { ClearSummary } from "./clearModel";
import { ClearSheet, formatVolume, titlesLine } from "./ClearSheet";
import { XP_FILL_TIMING as T } from "./useXpFill";

const SUMMARY: ClearSummary = {
  tier: "REDUCED",
  lines: [
    { key: "checkin", label: "Status check", xp: 10 },
    { key: "training", label: "Training", sublabel: "11 of 11 sets", xp: 120 },
    { key: "record-2", label: "Record", sublabel: "Bench Press", xp: 25 },
  ],
  total: 155,
  level: { before: 17, after: 18, leveledUp: true, into: 160, needed: 1600, fraction: 0.1, previousFraction: 0.85, nextRankLine: "Rank Trial requirements: 2 of 5 met." },
  records: [{ name: "Bench Press", kind: "e1rm", label: "Bench Press est. max", previousText: "216 lb", currentText: "221 lb", line: "Bench Press est. max 221 lb (was 216 lb)." }],
  stats: [{ name: "STR", before: 39, after: 43 }],
  streak: { days: 24, shields: 2, shieldsTotal: 2 },
  titles: ["Rest Keeper"],
  promotion: null,
  summary: { durationMinutes: 48, sets: 11, volumeKg: lbToKg(9840) },
};

const FLAT: ClearSummary = { ...SUMMARY, level: { ...SUMMARY.level, before: 18, leveledUp: false, previousFraction: 0.02 }, records: [], titles: [], summary: { durationMinutes: null, sets: 0, volumeKg: 0 } };

const bar = () => screen.getByRole("progressbar", { name: "Level 18 progress" });
const fillMs = () => (bar().parentElement as HTMLElement).style.getPropertyValue("--ot-fill");
const OWN_DELAYS = new Set<number>([T.start, T.start + T.fill + T.hold, T.start + T.fill + T.hold + T.snap]);

/** Timer ids the sheet itself set (React may schedule its own under fake timers). */
function ownTimers() {
  const set = vi.spyOn(window, "setTimeout");
  const clear = vi.spyOn(window, "clearTimeout");
  const ids = () => set.mock.calls.flatMap((args, i) => (OWN_DELAYS.has(Number(args[1])) ? [set.mock.results[i]?.value as number] : []));
  const cleared = (id: number) => clear.mock.calls.some((args) => args[0] === id);
  return { ids, cleared };
}

describe("ClearSheet", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the total, the reward lines, level, record, stats, streak, title and summary, with Done as the only action", async () => {
    const { container } = render(<ClearSheet summary={SUMMARY} units="imperial" onDone={() => {}} reducedMotion />);
    const dialog = screen.getByRole("dialog", { name: /\[Quest cleared\]/ });
    expect(dialog).toHaveAttribute("aria-labelledby", "cleared-title");
    expect(screen.getByRole("img", { name: "Tier: Reduced" })).toBeInTheDocument();
    expect(screen.getByText("+155 XP")).toHaveClass("ot-display-lg", "ot-brass");
    expect(screen.getByText("Status check")).toBeInTheDocument();
    expect(screen.getByText("11 of 11 sets")).toBeInTheDocument();
    expect(screen.getByText("Bench Press")).toBeInTheDocument();
    expect(screen.getAllByText(/^\+\d+ XP$/).map((e) => e.textContent)).toEqual(["+155 XP", "+10 XP", "+120 XP", "+25 XP"]);
    expect(screen.getByText("Lv 18")).toBeInTheDocument();
    expect(screen.getByText("160 / 1,600 XP")).toBeInTheDocument();
    expect(bar()).toHaveAttribute("aria-valuenow", "10");
    expect(screen.getByText("[Level up]")).toBeInTheDocument();
    expect(screen.getByText("Level 18. Rank Trial requirements: 2 of 5 met.")).toBeInTheDocument();
    expect(screen.getByText("Bench Press est. max")).toBeInTheDocument();
    expect(screen.getByText("221 lb")).toHaveClass("ot-brass");
    expect(screen.getByText("STR")).toBeInTheDocument();
    expect(screen.getByText("24 days")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "2 of 2 shields" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/^\[TITLE\]\s*Rest Keeper unlocked\.$/);
    expect(screen.getByRole("status")).toHaveAttribute("data-tone", "brass");
    expect(screen.getByText("48 min")).toBeInTheDocument();
    expect(screen.getByText("11")).toBeInTheDocument();
    expect(screen.getByText("9,840 lb")).toBeInTheDocument();
    expect(container.querySelectorAll("[data-primary]")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    expect(dialog.textContent).not.toMatch(/!|e1RM/);
    await expectNoA11yViolations(container);
  });

  it("calls onDone from the footer's Done", async () => {
    const onDone = vi.fn();
    render(<ClearSheet summary={FLAT} units="metric" onDone={onDone} reducedMotion />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Done" }));
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("[Level up]")).toBeNull();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("0 kg")).toBeInTheDocument();
  });

  it("with reduced motion renders the final fraction and the level-up line at once, without timers", () => {
    vi.useFakeTimers();
    const timers = ownTimers();
    render(<ClearSheet summary={SUMMARY} units="metric" onDone={() => {}} reducedMotion />);
    expect(bar()).toHaveAttribute("aria-valuenow", "10");
    expect(fillMs()).toBe("");
    expect(screen.getByText("[Level up]").parentElement).not.toHaveClass("ot-rise");
    expect(timers.ids()).toEqual([]);
  });

  it("starts at the previous fraction and fills 200 ms after mount", () => {
    vi.useFakeTimers();
    render(<ClearSheet summary={FLAT} units="metric" onDone={() => {}} reducedMotion={false} />);
    expect(bar()).toHaveAttribute("aria-valuenow", "2");
    act(() => vi.advanceTimersByTime(T.start - 1));
    expect(bar()).toHaveAttribute("aria-valuenow", "2");
    act(() => vi.advanceTimersByTime(1));
    expect(bar()).toHaveAttribute("aria-valuenow", "10");
    expect(fillMs()).toBe("");
    expect(screen.queryByText("[Level up]")).toBeNull();
  });

  it("on a level up fills to 1, holds, snaps to 0 with no transition, then refills as the line rises", () => {
    vi.useFakeTimers();
    const { unmount } = render(<ClearSheet summary={SUMMARY} units="metric" onDone={() => {}} reducedMotion={false} />);
    expect(bar()).toHaveAttribute("aria-valuenow", "85");
    act(() => vi.advanceTimersByTime(T.start));
    expect(bar()).toHaveAttribute("aria-valuenow", "100");
    expect(screen.queryByText("[Level up]")).toBeNull();
    act(() => vi.advanceTimersByTime(T.fill + T.hold));
    expect(bar()).toHaveAttribute("aria-valuenow", "0");
    expect(fillMs()).toBe("0ms");
    expect(screen.getByText("[Level up]").parentElement).toHaveClass("ot-levelup", "ot-rise");
    act(() => vi.advanceTimersByTime(T.snap));
    expect(bar()).toHaveAttribute("aria-valuenow", "10");
    expect(fillMs()).toBe(`${T.refill}ms`);
    unmount();
  });

  it("clears its timers on unmount", () => {
    vi.useFakeTimers();
    const timers = ownTimers();
    const { unmount } = render(<ClearSheet summary={SUMMARY} units="metric" onDone={() => {}} reducedMotion={false} />);
    const ids = timers.ids();
    expect(ids).toHaveLength(3);
    expect(ids.some(timers.cleared)).toBe(false);
    unmount();
    expect(ids.every(timers.cleared)).toBe(true);
  });

  it("formats volume with digit grouping and titles as one sentence", () => {
    expect(formatVolume(lbToKg(9840), "imperial")).toBe("9,840 lb");
    expect(formatVolume(1234.5, "metric")).toBe("1,234.5 kg");
    expect(formatVolume(0, "metric")).toBe("0 kg");
    expect(titlesLine(["Rest Keeper"])).toBe("Rest Keeper unlocked.");
    expect(titlesLine(["Rest Keeper", "Trial Passed"])).toBe("Rest Keeper and Trial Passed unlocked.");
    expect(titlesLine(["A", "B", "C"])).toBe("A, B and C unlocked.");
  });
});
