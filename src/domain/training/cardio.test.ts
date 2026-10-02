import { describe, expect, it } from "vitest";
import { miToKm } from "../units";
import {
  activeSeconds,
  buildSegments,
  CARDIO_PRESETS,
  formatPace,
  normalizePlan,
  paceSecondsPerKm,
  plannedMinutes,
  runnerLog,
  segmentAt,
  suggestPlanFromNotes,
  totalPlannedSeconds,
  type TimerEvent,
} from "./cardio";

describe("buildSegments", () => {
  it("builds warmup → work/rest rounds and drops the final rest", () => {
    const segs = buildSegments({ work: 240, rest: 180, rounds: 4, warmup: 300 });
    expect(segs[0]).toEqual({ kind: "warmup", seconds: 300, round: 0 });
    expect(segs.filter((s) => s.kind === "work")).toHaveLength(4);
    expect(segs.filter((s) => s.kind === "rest")).toHaveLength(3);
    expect(segs.at(-1)!.kind).toBe("work");
  });

  it("omits rest segments entirely for EMOM-style zero rest", () => {
    const segs = buildSegments({ work: 60, rest: 0, rounds: 10, warmup: 0 });
    expect(segs).toHaveLength(10);
    expect(segs.every((s) => s.kind === "work")).toBe(true);
  });

  it("clamps degenerate plans and fills defaults", () => {
    expect(normalizePlan({ work: 1, rest: -50, rounds: 999, warmup: 99999 })).toEqual({ work: 5, rest: 0, rounds: 50, warmup: 1800 });
    expect(normalizePlan({})).toEqual({ work: 60, rest: 60, rounds: 6, warmup: 0 });
    expect(normalizePlan({ work: Number.NaN, rounds: 2.6 })).toMatchObject({ work: 5, rounds: 3 });
  });

  it("totals planned time in seconds and minutes", () => {
    expect(totalPlannedSeconds({ work: 60, rest: 60, rounds: 2, warmup: 0 })).toBe(180);
    expect(plannedMinutes({ work: 60, rest: 60, rounds: 2, warmup: 0 })).toBe(3);
    expect(plannedMinutes({ work: 30, rest: 30, rounds: 10, warmup: 300 })).toBe(14.5);
  });

  it("ships sane presets", () => {
    for (const preset of CARDIO_PRESETS) {
      expect(buildSegments(preset).length).toBeGreaterThan(0);
      expect(normalizePlan(preset)).toEqual({ work: preset.work, rest: preset.rest, rounds: preset.rounds, warmup: preset.warmup });
    }
  });
});

describe("suggestPlanFromNotes", () => {
  it("parses unambiguous time-based intervals", () => {
    expect(suggestPlanFromNotes("6x3min hard, 2min rest")).toMatchObject({ rounds: 6, work: 180, rest: 120 });
    expect(suggestPlanFromNotes("8 x 90s on / 60s off")).toMatchObject({ rounds: 8, work: 90, rest: 60 });
    expect(suggestPlanFromNotes("4 × 4 min w/ 3min recovery")).toMatchObject({ rounds: 4, work: 240, rest: 180 });
    expect(suggestPlanFromNotes("10 x 30 sec, rest 45 sec")).toMatchObject({ rounds: 10, work: 30, rest: 45 });
  });

  it("defaults the rest to the work time, capped at 3 min", () => {
    expect(suggestPlanFromNotes("5x1min")).toMatchObject({ rest: 60, warmup: 300 });
    expect(suggestPlanFromNotes("3x10min tempo")).toMatchObject({ rest: 180 });
  });

  it("refuses distance-based, ambiguous or out-of-range notes", () => {
    expect(suggestPlanFromNotes("6x800m @ 5K pace")).toBeNull();
    expect(suggestPlanFromNotes("5 km easy")).toBeNull();
    expect(suggestPlanFromNotes("easy zone 2 run")).toBeNull();
    expect(suggestPlanFromNotes("0x3min")).toBeNull();
    expect(suggestPlanFromNotes("4x5s")).toBeNull();
    expect(suggestPlanFromNotes("")).toBeNull();
    expect(suggestPlanFromNotes(null)).toBeNull();
  });
});

describe("activeSeconds", () => {
  const at = (type: TimerEvent["type"], seconds: number): TimerEvent => ({ type, atMs: 1_000_000 + seconds * 1000 });

  it("excludes paused time (v19 logged wall-clock time, pauses included)", () => {
    const events = [at("start", 0), at("pause", 600), at("resume", 900), at("stop", 1500)];
    expect(activeSeconds(events)).toBe(1200);
  });

  it("counts a running session up to now, and a paused one up to the pause", () => {
    expect(activeSeconds([at("start", 0)], 1_000_000 + 90_000)).toBe(90);
    expect(activeSeconds([at("start", 0), at("pause", 30)], 1_000_000 + 90_000)).toBe(30);
    expect(activeSeconds([at("start", 0)])).toBe(0);
  });

  it("ignores events that make no sense", () => {
    const events = [at("pause", 5), at("resume", 6), at("start", 10), at("start", 20), at("resume", 30), at("pause", 40), at("pause", 50), at("stop", 60), at("resume", 70), at("stop", 80)];
    expect(activeSeconds(events)).toBe(30);
    expect(activeSeconds([])).toBe(0);
  });

  it("sorts events and never counts backwards", () => {
    expect(activeSeconds([at("stop", 100), at("start", 40)])).toBe(60);
    expect(activeSeconds([at("start", 50)], 1_000_000)).toBe(0);
  });
});

describe("segmentAt", () => {
  const segs = buildSegments({ work: 60, rest: 30, rounds: 2, warmup: 120 }); // 120 | 60 | 30 | 60

  it("maps active time to the current segment and its remaining time", () => {
    expect(segmentAt(segs, 0)).toMatchObject({ index: 0, remaining: 120, segment: { kind: "warmup" } });
    expect(segmentAt(segs, 150)).toMatchObject({ index: 1, remaining: 30, segment: { kind: "work", round: 1 } });
    expect(segmentAt(segs, 200)).toMatchObject({ index: 2, remaining: 10, segment: { kind: "rest" } });
    expect(segmentAt(segs, 269.5)).toMatchObject({ index: 3, remaining: 0.5 });
  });

  it("is null once the plan is done", () => {
    expect(segmentAt(segs, 270)).toBeNull();
    expect(segmentAt([], 0)).toBeNull();
  });
});

describe("pace", () => {
  it("is seconds per km, null without distance or time", () => {
    expect(paceSecondsPerKm(25, 5)).toBe(300);
    expect(paceSecondsPerKm(27.5, miToKm(3.1))).toBeCloseTo(330.73, 2);
    expect(paceSecondsPerKm(25, 0)).toBeNull();
    expect(paceSecondsPerKm(null, 5)).toBeNull();
    expect(paceSecondsPerKm(25, Number.NaN)).toBeNull();
  });

  it("formats per km or per mile", () => {
    expect(formatPace(300, "metric")).toBe("5:00 /km");
    expect(formatPace(paceSecondsPerKm(27.5, miToKm(3.1)), "imperial")).toBe("8:52 /mi");
    expect(formatPace(null, "metric")).toBe("—");
  });
});

describe("runnerLog", () => {
  it("logs active minutes (not wall-clock) from the runner", () => {
    const log = runnerLog({ id: "c1", kind: "intervals", events: [{ type: "start", atMs: 0 }, { type: "pause", atMs: 60_000 }, { type: "resume", atMs: 600_000 }, { type: "stop", atMs: 630_000 }], km: 0.4, completedAt: "2026-07-20T18:00:00Z" });
    expect(log).toEqual({ id: "c1", kind: "intervals", minutes: 1.5, km: 0.4, source: "runner", completedAt: "2026-07-20T18:00:00Z" });
    expect(runnerLog({ id: "c2", kind: "run", events: [{ type: "start", atMs: 0 }], nowMs: 61_400 })).toEqual({ id: "c2", kind: "run", minutes: 61 / 60, km: null, source: "runner" });
  });
});
