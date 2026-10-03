import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CardioLog } from "../../domain/day/schema";
import { KM_PER_MI, type UnitSystem } from "../../domain/units";
import { expectNoA11yViolations } from "../../test/axe";
import { CardioRunner, planLine, plannedSegments, segmentName } from "./CardioRunner";
import { useCardioClock } from "./useCardioClock";

interface HarnessProps {
  units?: UnitSystem;
  notes?: string;
  plannedMinutes?: number | null;
  plannedKm?: number | null;
  onSave?: (log: CardioLog) => void;
  onExit?: () => void;
}

function Harness({ units = "metric", notes, plannedMinutes = 25, plannedKm = null, onSave = () => undefined, onExit = () => undefined }: HarnessProps) {
  const clock = useCardioClock("2026-10-03");
  return <CardioRunner kind="Easy Run" plannedMinutes={plannedMinutes} plannedKm={plannedKm} effort="Zone 2" notes={notes} units={units} clock={clock} onSave={onSave} onExit={onExit} />;
}

const primaries = (container: HTMLElement): string[] => [...container.querySelectorAll("[data-primary]")].map((el) => el.textContent ?? "");

/** Fakes only the interval and the clock: real setTimeout keeps RTL's and user-event's own waits alive. */
function fakeClock() {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(new Date(2026, 9, 3, 7, 0, 0));
  return userEvent.setup();
}

describe("CardioRunner", () => {
  afterEach(() => vi.useRealTimers());

  it("runs Start, Pause/Resume, Finish, Save and logs the clock's minutes with the distance in km", async () => {
    const user = fakeClock();
    const onSave = vi.fn();
    const { container } = render(<Harness units="imperial" onSave={onSave} />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Easy Run");
    expect(screen.getByText("25 min zone 2")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Saved" }).querySelector(".ot-sync-dot")).toHaveAttribute("data-sync", "synced");
    const timer = screen.getByRole("timer", { name: "Elapsed" });
    expect(timer).toHaveTextContent("00:00");
    expect(primaries(container)).toEqual(["Start"]);
    expect(screen.queryByRole("button", { name: /^(Pause|Resume)$/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Start" }));
    act(() => {
      vi.advanceTimersByTime(61_000);
    });
    expect(timer).toHaveTextContent("01:01");
    expect(primaries(container)).toEqual(["Finish"]);

    await user.click(screen.getByRole("button", { name: "Pause" }));
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(timer).toHaveTextContent("01:01");
    await user.click(screen.getByRole("button", { name: "Resume" }));
    act(() => {
      vi.advanceTimersByTime(29_000);
    });
    expect(timer).toHaveTextContent("01:30");
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(primaries(container)).toEqual(["Finish"]);

    await user.click(screen.getByRole("button", { name: "Finish" }));
    expect(screen.queryByRole("button", { name: /^(Pause|Resume)$/ })).not.toBeInTheDocument();
    expect(primaries(container)).toEqual(["Save"]);
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(timer).toHaveTextContent("01:30");

    const distance = screen.getByLabelText("Distance (mi)");
    expect(distance).toHaveAttribute("inputmode", "decimal");
    await user.type(distance, "3.1");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const log = onSave.mock.calls[0]?.[0] as CardioLog;
    expect(log).toMatchObject({ kind: "Easy Run", minutes: 1.5, source: "runner" });
    expect(log.km).toBeCloseTo(3.1 * KM_PER_MI, 3);
    expect(log.id).toMatch(/^c[0-9a-z]+$/);
    expect(log.completedAt).toBe(new Date().toISOString());
  });

  it("draws one thin objective bar per segment from the notes' intervals and names the current one", async () => {
    const user = fakeClock();
    render(<Harness notes="4x3min w/ 2min rest" />);
    const bars = screen.getAllByRole("progressbar");
    expect(bars).toHaveLength(8);
    expect(bars[0]).toHaveAccessibleName("Segment 1 of 8: Warm-up");
    expect(bars[1]).toHaveAccessibleName("Segment 2 of 8: Work · round 1 of 4");
    expect(bars[2]).toHaveAccessibleName("Segment 3 of 8: Rest");
    expect(bars[7]).toHaveAccessibleName("Segment 8 of 8: Work · round 4 of 4");
    for (const bar of bars) {
      expect(bar).toHaveClass("ot-bar-thin");
      expect(bar).toHaveAttribute("data-kind", "objective");
    }
    expect(screen.getByText("Warm-up")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Start" }));
    act(() => {
      vi.advanceTimersByTime(150_000);
    });
    expect(bars[0]).toHaveAttribute("aria-valuenow", "50");
    expect(bars[1]).toHaveAttribute("aria-valuenow", "0");
    act(() => {
      vi.advanceTimersByTime(150_000 + 90_000);
    });
    expect(bars[0]).toHaveAttribute("aria-valuenow", "100");
    expect(bars[1]).toHaveAttribute("aria-valuenow", "50");
    expect(screen.getByText("Work · round 1 of 4")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(90_000 + 1000);
    });
    expect(screen.getByText("Rest")).toBeInTheDocument();
  });

  it("names the plan done once the single planned block is over", async () => {
    const user = fakeClock();
    render(<Harness plannedMinutes={1} />);
    expect(screen.getAllByRole("progressbar")).toHaveLength(1);
    expect(screen.getByText("Work")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Start" }));
    act(() => {
      vi.advanceTimersByTime(61_000);
    });
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    expect(screen.getByText("Plan done")).toBeInTheDocument();
  });

  it("is accessible before, during and after the session, with Exit and one primary throughout", async () => {
    const user = userEvent.setup();
    const onExit = vi.fn();
    const onSave = vi.fn();
    const { container } = render(<Harness plannedKm={4.8} onExit={onExit} onSave={onSave} />);
    expect(screen.getByText("4.8 km zone 2")).toBeInTheDocument();
    await expectNoA11yViolations(container);
    await user.click(screen.getByRole("button", { name: "Start" }));
    expect(primaries(container)).toEqual(["Finish"]);
    await expectNoA11yViolations(container);
    await user.click(screen.getByRole("button", { name: "Finish" }));
    expect(screen.getByLabelText("Distance (km)")).toBeInTheDocument();
    expect(primaries(container)).toEqual(["Save"]);
    await expectNoA11yViolations(container);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ kind: "Easy Run", km: null, source: "runner" });
    await user.click(screen.getByRole("button", { name: "Exit" }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("shows no segment bar when nothing is planned", () => {
    render(<Harness plannedMinutes={null} />);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByText(/zone 2|min/)).not.toBeInTheDocument();
    expect(screen.getByRole("timer", { name: "Elapsed" })).toBeInTheDocument();
  });

  it("plans one work block from the minutes when the notes carry no intervals", () => {
    expect(plannedSegments(25, "Conversational pace throughout.")).toEqual({ segments: [{ kind: "work", seconds: 1500, round: 1 }], plan: null });
    expect(plannedSegments(null, undefined).segments).toEqual([]);
    expect(plannedSegments(0, undefined).segments).toEqual([]);
    expect(plannedSegments(10, "6 x 90s on / 60s off").segments.map((s) => s.kind)).toEqual(["warmup", "work", "rest", "work", "rest", "work", "rest", "work", "rest", "work", "rest", "work"]);
    expect(segmentName({ kind: "work", seconds: 60, round: 1 }, 1)).toBe("Work");
    expect(segmentName({ kind: "work", seconds: 60, round: 2 }, 6)).toBe("Work · round 2 of 6");
    expect(segmentName({ kind: "rest", seconds: 60, round: 2 }, 6)).toBe("Rest");
    expect(segmentName({ kind: "warmup", seconds: 300, round: 0 }, 6)).toBe("Warm-up");
  });

  it("writes the plan line with digits, in the athlete's units", () => {
    expect(planLine({ plannedMinutes: 25, plannedKm: null, effort: "Easy", units: "metric" })).toBe("25 min easy");
    expect(planLine({ plannedMinutes: 29, plannedKm: 4.8, effort: "Zone 2", units: "metric" })).toBe("4.8 km zone 2");
    expect(planLine({ plannedMinutes: 29, plannedKm: 4.8, effort: "Zone 2", units: "imperial" })).toBe("3 mi zone 2");
    expect(planLine({ plannedMinutes: 40, plannedKm: null, units: "metric" })).toBe("40 min");
    expect(planLine({ plannedMinutes: null, plannedKm: null, units: "metric" })).toBe("");
  });
});
