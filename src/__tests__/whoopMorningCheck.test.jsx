import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WhoopMorningCheck } from "../whoop/WhoopMorningCheck";
import { MEASURE_MS, SETTLE_MS, measureMorningCheck, morningBaseline, readMorningChecks, saveMorningCheck } from "../whoop/morningCheck";

const startedAt = new Date(2026, 9, 22, 7, 0).valueOf();
const start = startedAt + SETTLE_MS;
const day = "2026-10-22";
const subscriptions = new Set();
let bridge;
vi.mock("../whoop/bluetooth", () => ({
  useWhoopBluetooth: () => bridge,
  getWhoopBluetooth: () => bridge,
  subscribeWhoopBluetooth: callbacks => {
    subscriptions.add(callbacks);
    return () => subscriptions.delete(callbacks);
  },
}));

const emit = (name, payload) => act(() => { for (const callbacks of subscriptions) callbacks[name]?.(payload); });
const packet = (timestamp, rrMs) => ({ timestamp, rrMs, bpm: 60 });
const trace = () => Array.from({ length: 60 }, (_, i) => packet(start + (i + 1) * 2_000, [980, 1020]));
const example = measureMorningCheck(trace(), startedAt);

beforeEach(() => {
  localStorage.clear();
  bridge = { owner: "athlete-A" };
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("seated morning RR measurements", () => {
  it("computes beat-to-beat RMSSD and pulse across notification boundaries in the timed window", () => {
    const packets = trace();
    const result = measureMorningCheck([
      packet(start - 200, [300, 1400]), ...packets.slice(0, 4), packets[3], packets[2],
      ...packets.slice(4), packet(start + MEASURE_MS + 1, [1800]),
    ], startedAt);
    expect(result).toEqual({ day, timestamp: start + MEASURE_MS, coverage: 100, cleanBeats: 120, rmssd: 40, pulse: 60 });
  });

  it("omits both successive differences around an isolated artifact", () => {
    const packets = trace();
    packets[31] = packet(packets[31].timestamp, [1800, 1020]);
    expect(measureMorningCheck(packets, startedAt)).toMatchObject({ rmssd: 40, pulse: 60, cleanBeats: 119 });
  });

  it("does not calculate differences across a data gap", () => {
    const early = trace().slice(0, 27);
    const later = Array.from({ length: 32 }, (_, i) => packet(start + 62_000 + (i + 1) * 1_800, [880, 920]));
    expect(measureMorningCheck([...early, ...later], startedAt)).toMatchObject({ rmssd: 40, cleanBeats: 118, coverage: 93 });
  });

  it("rejects missing intervals, truncated records, noisy beats and implausibly clustered traffic", () => {
    expect(measureMorningCheck([packet(start + 1_000, [])], startedAt).error).toMatch(/No beat intervals/);
    const packets = trace();
    expect(measureMorningCheck(packets.slice(0, 30), startedAt)).toHaveProperty("error");
    expect(measureMorningCheck(packets.map((sample, i) => ({ ...sample, rrMs: i % 3 ? sample.rrMs : [50, 900] })), startedAt)).toHaveProperty("error");
    expect(measureMorningCheck(packets.map(sample => ({ ...sample, rrMs: [1000, 1000] })), startedAt)).toHaveProperty("error");
    expect(measureMorningCheck(packets.map((sample, i) => ({ ...sample, timestamp: start + 20_000 + i })), startedAt)).toHaveProperty("error");
  });

  it("stores one latest result per local date and compares only previous mornings inside the window", () => {
    expect(saveMorningCheck(null, example)).toBeNull();
    saveMorningCheck("athlete-A", example);
    saveMorningCheck("athlete-A", { ...example, timestamp: example.timestamp - 1, rmssd: 7 });
    expect(readMorningChecks("athlete-B")).toEqual([]);
    expect(readMorningChecks("athlete-A")).toEqual([example]);
    const prior = ["09-22", "10-03", "10-05", "10-09", "10-10", "10-16", "10-19", "10-21", "10-23"];
    const records = prior.map((suffix, i) => ({ ...example, day: `2026-${suffix}`, rmssd: i + 30, pulse: i + 50 }));
    expect(morningBaseline([example, ...records], day)).toEqual({ count: 7, rmssd: 34, pulse: 54 });
    expect(morningBaseline([example], day)).toEqual({ count: 0 });
  });
});

function begin() {
  vi.useFakeTimers();
  vi.setSystemTime(startedAt);
  const view = render(<WhoopMorningCheck />);
  emit("onState", { status: "idle", savedDevice: { id: "strap" } });
  expect(screen.getByRole("button", { name: /start 3-minute/i }).disabled).toBe(true);
  emit("onState", { status: "connected" });
  fireEvent.click(screen.getByRole("button", { name: /start 3-minute/i }));
  return view;
}

function replayCheck({ beats = true } = {}) {
  act(() => vi.advanceTimersByTime(SETTLE_MS));
  for (let i = 0; i < 60; i++) {
    act(() => vi.advanceTimersByTime(2_000));
    if (beats) emit("onSample", packet(Date.now(), [980, 1020]));
  }
}

describe("WHOOP morning check screen", () => {
  it("stays out of Recovery when an athlete has never paired a strap", () => {
    render(<WhoopMorningCheck />);
    emit("onState", { status: "idle" });
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("collects after settling, saves a quality result and restores it on return", () => {
    const view = begin();
    expect(screen.getByText("Settling in")).toBeTruthy();
    emit("onSample", packet(startedAt, [300, 1200]));
    replayCheck();
    expect(screen.getByRole("status").textContent).toMatch(/saved on this iPhone/);
    expect(readMorningChecks(bridge.owner)[0]).toMatchObject({ day, rmssd: 40, pulse: 60 });
    view.unmount();
    expect(subscriptions.size).toBe(0);
    render(<WhoopMorningCheck />);
    expect(screen.getByText(/HRV 40 ms · Seated pulse 60 bpm/)).toBeTruthy();
  });

  it("keeps an unsaved result retryable after local storage fills up", () => {
    begin();
    const setter = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); });
    replayCheck();
    expect(screen.getByRole("status").textContent).toMatch(/couldn’t save/);
    expect(screen.getByText(/Unsaved reading/)).toBeTruthy();
    setter.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: /retry saving/i }));
    expect(readMorningChecks(bridge.owner)).toHaveLength(1);
    expect(screen.queryByText(/Unsaved reading/)).toBeNull();
  });

  it("rejects a BPM-only session and leaves prior checks intact", () => {
    saveMorningCheck(bridge.owner, example);
    begin();
    replayCheck({ beats: false });
    expect(screen.getByRole("status").textContent).toMatch(/No beat intervals/);
    expect(readMorningChecks(bridge.owner)).toEqual([example]);
  });

  it("abandons a disconnected check, removes listeners and hides records on account change", () => {
    saveMorningCheck(bridge.owner, example);
    const view = begin();
    emit("onState", { status: "disconnected" });
    act(() => vi.advanceTimersByTime(MEASURE_MS + SETTLE_MS));
    expect(screen.getByRole("status").textContent).toMatch(/strap disconnected/);
    bridge = { owner: "athlete-B" };
    view.rerender(<WhoopMorningCheck />);
    expect(screen.queryByText(/HRV 40 ms/)).toBeNull();
    expect(readMorningChecks("athlete-B")).toEqual([]);
    bridge = null;
    view.rerender(<WhoopMorningCheck />);
    expect(subscriptions.size).toBe(0);
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("cancels on demand or when the app is hidden", () => {
    begin();
    fireEvent.click(screen.getByRole("button", { name: /cancel check/i }));
    expect(screen.getByRole("status").textContent).toMatch(/cancelled/);
    fireEvent.click(screen.getByRole("button", { name: /start 3-minute/i }));
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    fireEvent(document, new Event("visibilitychange"));
    expect(screen.getByRole("status").textContent).toMatch(/interrupted/);
    expect(readMorningChecks(bridge.owner)).toEqual([]);
  });
});
