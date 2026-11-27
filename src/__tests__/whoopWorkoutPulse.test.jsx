import { createRef } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WhoopWorkoutPulse } from "../workout/WhoopWorkoutPulse";
import { DayDetail } from "../ProgressHistory";
import { SessionMode } from "../SessionMode";
import { ThemeProvider } from "../theme";

let observer;
const remove = vi.fn();
vi.mock("../whoop/bluetooth", () => ({
  useWhoopBluetooth: () => ({ owner: "athlete" }),
  subscribeWhoopBluetooth(callbacks) { observer = callbacks; return remove; },
}));

function emit(bpm, timestamp = Date.now()) {
  act(() => observer.onSample({ bpm, timestamp, rrMs: [820] }));
}

describe("WHOOP workout readings", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-22T15:00:00Z"));
    remove.mockClear();
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("shows fresh HR, records by choice and checkpoints only new readings", () => {
    const onSave = vi.fn();
    const ref = createRef();
    const view = render(<WhoopWorkoutPulse onSave={onSave} ref={ref} />);
    expect(screen.queryByRole("region")).toBeNull();
    act(() => observer.onState({ status: "connected", lastSample: { bpm: 90, timestamp: Date.now() } }));
    expect(screen.getByText("90 bpm")).toBeTruthy();
    emit(95);
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Record HR" }));
    emit(250, Date.now() - 10_000);
    expect(onSave).not.toHaveBeenCalled();
    emit(100);
    expect(onSave).toHaveBeenCalledTimes(1);
    const first = Date.now();
    act(() => vi.advanceTimersByTime(1_000));
    emit(120);
    emit(200, first);
    emit(0);
    ref.current.flush();
    expect(onSave.mock.lastCall[0]).toEqual({ count: 2, bpmTotal: 220, peakBpm: 120, lastSampleAt: Date.now() });
    fireEvent.click(screen.getByRole("button", { name: "Stop recording HR" }));
    act(() => vi.advanceTimersByTime(13_000));
    expect(screen.getByText(/Waiting for heart rate/)).toBeTruthy();
    emit(150);
    ref.current.flush();
    expect(onSave).toHaveBeenCalledTimes(2);
    view.unmount();
    expect(remove).toHaveBeenCalledOnce();
  });

  it("resumes a saved workout and can flush new readings after a disconnect", () => {
    const saved = { count: 3, bpmTotal: 300, peakBpm: 120, lastSampleAt: Date.now() - 60_000 };
    const write = vi.fn();
    render(<WhoopWorkoutPulse saved={saved} onSave={write} />);
    act(() => observer.onState({ status: "connected", lastSample: null }));
    fireEvent.click(screen.getByRole("button", { name: "Record HR" }));
    emit(140);
    act(() => vi.advanceTimersByTime(1_000));
    emit(120);
    act(() => observer.onState({ status: "disconnected" }));
    expect(screen.queryByText("120 bpm")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Stop recording HR" }));
    expect(write.mock.lastCall[0]).toMatchObject({ count: 5, bpmTotal: 560, peakBpm: 140 });
  });

  it("flushes the signed-in athlete’s last reading to the correct session on runner exit", () => {
    const write = vi.fn(), close = vi.fn();
    render(<ThemeProvider><SessionMode open onClose={close} onUpdate={write}
      lifting={[{ name: "Bench", sets: 2, reps: 8 }]} workoutData={{}} todayKey="2026-10-22"
      allData={{}} todayName="Thursday" settings={{}} sessionId="evening" sessionLabel="Evening gym" /></ThemeProvider>);
    act(() => observer.onState({ status: "connected", lastSample: null }));
    fireEvent.click(screen.getByRole("button", { name: "Record HR" }));
    emit(120);
    act(() => vi.advanceTimersByTime(1_000));
    emit(150);
    fireEvent.click(screen.getByRole("button", { name: "Exit" }));
    expect(write).toHaveBeenLastCalledWith("workout.whoopHeartRate.evening", {
      label: "Evening gym", count: 2, bpmTotal: 270, peakBpm: 150, lastSampleAt: Date.now(),
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it("lists each saved session’s measured average and peak on the right date", () => {
    const date = "2026-10-22";
    const workout = { whoopHeartRate: {
      am: { label: "Morning lift", count: 2, bpmTotal: 235, peakBpm: 127 },
      pm: { label: "Evening lift", count: 1, bpmTotal: 133, peakBpm: 133 },
    }};
    render(<DayDetail data={{ [date]: { workout } }} dateKey={date} />);
    expect(screen.getByText(/Morning lift · WHOOP · 118 bpm average · 127 bpm peak/)).toBeTruthy();
    expect(screen.getByText(/Evening lift · WHOOP · 133 bpm average · 133 bpm peak/)).toBeTruthy();
    expect(screen.queryByText(/Nothing was logged/)).toBeNull();
  });
});
