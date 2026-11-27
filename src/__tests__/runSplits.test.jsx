// src/__tests__/runSplits.test.jsx
// A run from the watch is cut into mile splits from Apple Health's distance
// and heart rate, pauses left out of each split's time; its effort comes
// with it and counts in the day's load; and the splits show on Today and in
// History behind one button.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { runSplits, splitPace } from "../watch/runSplits";
import { detailWrites, planRunDetails } from "../watch/healthRuns";
import { computeSessionLoad } from "../loadModel";
import { RunSplits } from "../sections/RunSplits";
import { METERS_PER_MILE } from "../runPaces";

afterEach(cleanup);

// A steady run: `paceSeconds` a mile, a reading every 10 seconds.
function steady(miles, paceSeconds) {
  const metersPerSecond = METERS_PER_MILE / paceSeconds;
  const end = Math.round(miles * paceSeconds);
  const distance = [];
  for (let at = 10; at <= end; at += 10) distance.push([at, at * metersPerSecond]);
  if (distance[distance.length - 1][0] !== end) distance.push([end, miles * METERS_PER_MILE]);
  return distance;
}

describe("runSplits", () => {
  it("cuts a run into miles and a last part mile", () => {
    const splits = runSplits({ distance: steady(3.5, 480), heartRate: [[100, 140], [300, 150], [700, 160], [1500, 170]] });
    expect(splits.map((split) => [split.n, split.miles, split.seconds])).toEqual([[1, 1, 480], [2, 1, 480], [3, 1, 480], [4, 0.5, 240]]);
    expect(splits.map((split) => split.hr)).toEqual([145, 160, null, 170]);
    expect(splitPace(splits[3])).toBe(480);
  });

  it("leaves pauses out of a split's time", () => {
    // Two minutes stopped at a light in the second mile.
    const moving = steady(2, 480);
    const distance = moving.map(([at, meters]) => [at > 600 ? at + 120 : at, meters]);
    distance.splice(distance.findIndex(([at]) => at > 600), 0, [700, distance.find(([at]) => at >= 600)[1]]);
    const splits = runSplits({ distance, pauses: [[600, 720]] });
    expect(splits.map((split) => split.seconds)).toEqual([480, 480]);
  });

  it("needs readings to say anything", () => {
    expect(runSplits({ distance: [] })).toEqual([]);
    expect(runSplits(null)).toEqual([]);
    // A short last bit isn't a split.
    expect(runSplits({ distance: steady(1.05, 480) }).map((split) => split.miles)).toEqual([1]);
  });
});

describe("reading a run's detail", () => {
  const runs = [
    { id: "a", date: "2026-11-24", meters: 5 * METERS_PER_MILE, seconds: 2400 },
    { id: "b", date: "2026-11-25", meters: 3 * METERS_PER_MILE, seconds: 1500 },
    { id: "c", date: "2026-11-25", meters: 1 * METERS_PER_MILE, seconds: 600 },
    { id: "d", date: "2026-11-26", meters: 4 * METERS_PER_MILE, seconds: 2000 },
  ];

  it("picks each day's longest run where the logged run is it, once", () => {
    const data = {
      "2026-11-24": { workout: { cardio: { miles: "5" } } },
      "2026-11-25": { workout: { cardio: { miles: "4.02" } } },
      "2026-11-26": { workout: { cardio: { miles: "6" } } },
    };
    expect(planRunDetails({ runs, data })).toEqual([{ dateKey: "2026-11-24", id: "a" }, { dateKey: "2026-11-25", id: "b" }]);
    expect(planRunDetails({ runs, data, detailed: ["a"] })).toEqual([{ dateKey: "2026-11-25", id: "b" }]);
    // A day just filled counts even before its miles land.
    expect(planRunDetails({ runs, data: {}, filled: ["2026-11-26"] })).toEqual([{ dateKey: "2026-11-26", id: "d" }]);
    // Splits already there are kept.
    expect(planRunDetails({ runs, data: { "2026-11-24": { workout: { cardio: { miles: "5", splits: [{ n: 1 }] } } } } })).toEqual([]);
  });

  it("writes the splits and the effort", () => {
    const writes = detailWrites({ distance: steady(2, 500), effort: { value: 6.4, estimated: true } });
    expect(writes.map((write) => write.path)).toEqual(["workout.cardio.splits", "workout.cardio.effortScore", "workout.cardio.effortEstimated"]);
    expect(writes[1].value).toBe("6");
    expect(writes[2].value).toBe(true);
    expect(detailWrites({})).toEqual([]);
  });
});

describe("a run's effort in the day's load", () => {
  it("counts the run at its own effort, and everything else as before", () => {
    const run = { miles: "4", pace: "8:00" };
    const before = computeSessionLoad({ workout: { exercises: {}, cardio: run } });
    expect(before.rpeEstimated).toBe(true);
    const scored = computeSessionLoad({ workout: { exercises: {}, cardio: { ...run, effortScore: "8" } } });
    expect(scored.load).toBe(Math.round(8 * 32));
    expect(scored.rpe).toBe(8);
    expect(scored.rpeEstimated).toBe(false);
    // A rated session still sets the lifting's load.
    const set = { weight: "200", reps: "5", done: true };
    const mixed = computeSessionLoad({ workout: { rpe: "6", exercises: { Squat: { sets: [set, set] } }, cardio: { ...run, effortScore: "3" } } });
    expect(mixed.load).toBe(Math.round(6 * 6 + 3 * 32));
  });
});

describe("RunSplits", () => {
  const cardio = { splits: [{ n: 1, miles: 1, seconds: 480, hr: 145 }, { n: 2, miles: 0.25, seconds: 150, hr: null }] };

  function openSplits() {
    fireEvent.click(screen.getByRole("button", { name: "Show 2 splits" }));
    return within(screen.getByRole("region", { name: "Split replay" }));
  }

  it("shows the effort, and the splits behind a button", () => {
    render(<RunSplits cardio={{ effortScore: "7", effortEstimated: true, splits: [{ n: 1, miles: 1, seconds: 492, hr: 151 }, { n: 2, miles: 0.5, seconds: 240, hr: null }] }} />);
    expect(screen.getByText("Effort 7, hard: Apple’s estimate.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show 2 splits" }));
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1).map((row) => row.textContent);
    expect(rows).toEqual(["18:12/mi151\u00a0bpm", "0.5\u00a0mi8:00/mi—"]);
  });

  it("says nothing without splits or effort", () => {
    const { container } = render(<RunSplits cardio={{ miles: "3" }} />);
    expect(container.textContent).toBe("");
  });

  it("uses split distance for the step widths and reads the selected split's own averages", () => {
    render(<RunSplits cardio={cardio} />);
    const replay = openSplits();
    const slider = replay.getByRole("slider");
    const plot = slider.parentElement;
    expect(plot.querySelector("rect").getAttribute("width")).toBe("80");
    expect(replay.getByText("8:00/mi")).toBeTruthy();
    expect(replay.getByText("145 bpm")).toBeTruthy();
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(slider.value).toBe("1");
    expect(plot.querySelector("rect").getAttribute("width")).toBe("20");
    expect(replay.getByText("10:00/mi")).toBeTruthy();
    expect(replay.getByText("—")).toBeTruthy();
    fireEvent.change(slider, { target: { value: "0.5" } });
    expect(replay.getByText("8:00/mi")).toBeTruthy();
    fireEvent.keyDown(slider, { key: "End" });
    expect(replay.getByRole("button", { name: "Replay" })).toBeTruthy();
    fireEvent.keyDown(slider, { key: "Home" });
    expect(slider.value).toBe("0");
  });

  it("plays on demand, stops when hidden, and cancels the frame when collapsed", () => {
    let callback;
    const frame = vi.spyOn(window, "requestAnimationFrame").mockImplementation((run) => { callback = run; return 7; });
    const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const clock = vi.spyOn(performance, "now").mockReturnValue(200);
    let hidden;
    try {
      render(<RunSplits cardio={cardio} />);
      const replay = openSplits();
      expect(frame).not.toHaveBeenCalled();
      fireEvent.click(replay.getByRole("button", { name: "Play" }));
      act(() => callback(2700));
      // Half the original moving time is 315 seconds into a 480 s/mile split.
      expect(Number(replay.getByRole("slider").value)).toBeCloseTo(315 / 480);
      hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
      fireEvent(document, new Event("visibilitychange"));
      expect(replay.getByRole("button", { name: "Play" })).toBeTruthy();
      hidden.mockReturnValue(false);
      fireEvent.click(replay.getByRole("button", { name: "Play" }));
      fireEvent.click(screen.getByRole("button", { name: "Hide splits" }));
      expect(cancel).toHaveBeenLastCalledWith(7);
    } finally {
      hidden?.mockRestore();
      clock.mockRestore();
      cancel.mockRestore();
      frame.mockRestore();
    }
  });

  it("lets the athlete step through splits with reduced motion", () => {
    render(<div data-motion="still"><RunSplits cardio={cardio} /></div>);
    const replay = openSplits();
    fireEvent.click(replay.getByRole("button", { name: "Next split" }));
    expect(replay.getByText("Split 2 of 2")).toBeTruthy();
    fireEvent.click(replay.getByRole("button", { name: "Finish" }));
    fireEvent.click(replay.getByRole("button", { name: "Start over" }));
    expect(replay.getByText("Split 1 of 2")).toBeTruthy();
  });
});
