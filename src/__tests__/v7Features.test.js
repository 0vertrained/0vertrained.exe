import { describe, it, expect, beforeEach } from "vitest";
import { collectCalibrationSamples, buildCalibrationReport } from "../coachCalibration";
import { buildCorrelationPairs, pearson, describeCorrelation, CORRELATION_METRICS } from "../correlationExplorer";
import { normalizeRacePlan, buildRaceCountdown, readRacePlan, writeRacePlan, clearRacePlan, HYROX_STATIONS } from "../raceBlock";

// ─── coachCalibration ─────────────────────────────────────────────────────────
const respDay = (call, response, body) => ({
  intelligence: { todayDecisionResponse: { version: 1, decisionCall: call, response, recordedAt: "x" } },
  body,
});
const checkin = (sleep, energy, soreness) => ({ sleep: String(sleep), energy: String(energy), soreness: String(soreness) });

function calibrationFixture() {
  // 4 responded days, each with a next-day manual check-in
  return {
    "2026-06-20": { ...respDay("push", "followed"), body: checkin(8, 8, 2) },
    "2026-06-21": { body: checkin(8, 8, 2) },
    "2026-06-22": { ...respDay("push", "followed"), body: checkin(8, 8, 3) },
    "2026-06-23": { body: checkin(7.5, 7, 3) },
    "2026-06-24": { ...respDay("maintain", "ignored"), body: checkin(6, 5, 5) },
    "2026-06-25": { body: checkin(5.5, 4, 6) },
    "2026-06-26": { ...respDay("recover", "followed"), body: checkin(8, 7, 3) },
    "2026-06-27": { body: checkin(8.5, 8, 2) },
  };
}

describe("collectCalibrationSamples", () => {
  it("pairs responded days with next-day recovery scores", () => {
    const samples = collectCalibrationSamples(calibrationFixture());
    expect(samples.length).toBe(4);
    expect(samples[0]).toMatchObject({ date: "2026-06-20", call: "push", followed: true });
    expect(Number.isFinite(samples[0].nextScore)).toBe(true);
  });

  it("skips days without a next-day entry", () => {
    const data = { "2026-06-20": respDay("push", "followed") };
    expect(collectCalibrationSamples(data)).toEqual([]);
  });
});

describe("buildCalibrationReport", () => {
  it("reports not-ready below the sample minimum", () => {
    const data = {
      "2026-06-20": { ...respDay("push", "followed"), body: checkin(8, 8, 2) },
      "2026-06-21": { body: checkin(8, 8, 2) },
    };
    const r = buildCalibrationReport(data, { windowDays: 3650 });
    expect(r.ready).toBe(false);
    expect(r.sampleCount).toBe(1);
  });

  it("computes follow rate, averages, and per-call rows when ready", () => {
    const r = buildCalibrationReport(calibrationFixture(), { windowDays: 3650 });
    expect(r.ready).toBe(true);
    expect(r.sampleCount).toBe(4);
    expect(r.followRate).toBe(75);
    expect(r.followedAvg).not.toBeNull();
    expect(r.rows.find(row => row.call === "push").n).toBe(2);
    expect(r.caveat).toContain("association");
  });
});

// ─── correlationExplorer ──────────────────────────────────────────────────────
describe("correlationExplorer", () => {
  const data = {
    "2026-06-20": { body: { sleep: "6", energy: "5" } },
    "2026-06-21": { body: { sleep: "7", energy: "6" } },
    "2026-06-22": { body: { sleep: "8", energy: "8" } },
    "2026-06-23": { body: { sleep: "9", energy: "9" } },
  };

  it("builds same-day pairs and computes a strong positive r", () => {
    const pairs = buildCorrelationPairs(data, "sleep", "energy");
    expect(pairs.length).toBe(4);
    const r = pearson(pairs);
    expect(r).toBeGreaterThan(0.9);
    expect(describeCorrelation(r, pairs.length)).toContain("strong positive");
  });

  it("supports a 1-day lag pairing", () => {
    const pairs = buildCorrelationPairs(data, "sleep", "energy", { lag: 1 });
    expect(pairs.length).toBe(3); // last day has no tomorrow
    expect(pairs[0]).toMatchObject({ x: 6, y: 6 });
  });

  it("returns null r for degenerate inputs", () => {
    expect(pearson([{ x: 1, y: 1 }, { x: 2, y: 2 }])).toBeNull(); // n<3
    expect(pearson([{ x: 5, y: 1 }, { x: 5, y: 2 }, { x: 5, y: 3 }])).toBeNull(); // zero variance
  });

  it("computes lift volume from completed sets only", () => {
    const vol = CORRELATION_METRICS.find(m => m.key === "volume");
    const d = { workout: { exercises: { Bench: { sets: [
      { weight: "185", reps: "8", done: true },
      { weight: "185", reps: "8", done: false },
    ] } } } };
    expect(vol.get(d)).toBe(185 * 8);
  });
});

// ─── raceBlock ────────────────────────────────────────────────────────────────
describe("raceBlock", () => {
  beforeEach(() => clearRacePlan());

  it("normalizes partial plans and round-trips storage", () => {
    writeRacePlan({ name: "Dallas Hyrox", date: "2026-11-14", benchmarks: { sled_push: "2:05" } });
    const plan = readRacePlan();
    expect(plan.name).toBe("Dallas Hyrox");
    expect(plan.benchmarks.sled_push).toBe("2:05");
    expect(Object.keys(plan.benchmarks).length).toBe(HYROX_STATIONS.length);
    expect(normalizeRacePlan({ date: "bad" }).date).toBe("");
  });

  it("computes build / taper / race-day / past phases", () => {
    const plan = { date: "2026-11-14" };
    expect(buildRaceCountdown(plan, "2026-09-01").phase).toBe("build");
    expect(buildRaceCountdown(plan, "2026-11-10").phase).toBe("taper");
    expect(buildRaceCountdown(plan, "2026-11-14").phase).toBe("race_day");
    expect(buildRaceCountdown(plan, "2026-11-20").phase).toBe("past");
    expect(buildRaceCountdown(plan, "2026-11-04").phase).toBe("taper"); // exactly TAPER_DAYS out
  });

  it("returns null without a date", () => {
    expect(buildRaceCountdown({ name: "x" }, "2026-09-01")).toBeNull();
  });
});
