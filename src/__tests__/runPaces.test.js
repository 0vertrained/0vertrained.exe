import { describe, expect, it } from "vitest";
import {
  buildPaceZones,
  formatDuration,
  formatPace,
  normalizeBenchmark,
  paceAtFraction,
  paceTarget,
  parseDuration,
  predictRaceSeconds,
  racePaceSecPerMile,
  vdotFromRace,
} from "../runPaces";

// Pace engine. Reference values are Daniels' published VDOT tables,
// which were generated from the same Daniels & Gilbert equations.

describe("vdotFromRace", () => {
  it("matches the published tables", () => {
    expect(vdotFromRace("5k", 19 * 60 + 57)).toBeCloseTo(50, 0);   // table: 50
    expect(vdotFromRace("10k", 41 * 60 + 21)).toBeCloseTo(50, 0);  // table: 50
    expect(vdotFromRace("5k", 24 * 60 + 8)).toBeCloseTo(40, 0);    // table: 40
    expect(vdotFromRace(5000, 30 * 60)).toBeCloseTo(30.8, 1);      // metres work too
  });

  it("rejects inputs that are not a plausible race", () => {
    expect(vdotFromRace("5k", 0)).toBeNull();
    expect(vdotFromRace("5k", NaN)).toBeNull();
    expect(vdotFromRace("5k", 5 * 60)).toBeNull();        // 5-minute 5K → above the sanity band
    expect(vdotFromRace("5k", 3 * 3600)).toBeNull();      // 3-hour 5K → below it
    expect(vdotFromRace("ultra", 1500)).toBeNull();       // unknown distance id
  });
});

describe("predictRaceSeconds", () => {
  it("round-trips the tables", () => {
    expect(Math.abs(predictRaceSeconds(50, "10k") - (41 * 60 + 21))).toBeLessThanOrEqual(3);
    expect(Math.abs(predictRaceSeconds(40, "5k") - (24 * 60 + 8))).toBeLessThanOrEqual(3);
    expect(Math.abs(predictRaceSeconds(50, "half") - (91 * 60 + 35))).toBeLessThanOrEqual(10);
  });

  it("is the inverse of vdotFromRace", () => {
    const secs = predictRaceSeconds(37.3, "10k");
    expect(vdotFromRace("10k", secs)).toBeCloseTo(37.3, 1);
  });
});

describe("training paces", () => {
  it("threshold at VDOT 50 is the table's 6:51/mi", () => {
    expect(Math.abs(paceAtFraction(50, 0.88) - (6 * 60 + 51))).toBeLessThanOrEqual(2);
  });

  it("orders easy > threshold > interval and 10K pace > 5K pace (sec/mi)", () => {
    const z = buildPaceZones({ distance: "5k", seconds: 27 * 60 });
    expect(z.easy.slow).toBeGreaterThan(z.easy.fast);
    expect(z.easy.fast).toBeGreaterThan(z.threshold);
    expect(z.threshold).toBeGreaterThan(z.interval);
    expect(z.race["10k"]).toBeGreaterThan(z.race["5k"]);
    expect(z.race["half"]).toBeGreaterThan(z.race["10k"]);
  });

  it("puts 10K pace 15–25 s/mi slower than 5K pace for a ~27:00 5K", () => {
    const z = buildPaceZones({ distance: "5k", seconds: 27 * 60 });
    const gap = z.race["10k"] - z.race["5k"];
    expect(gap).toBeGreaterThanOrEqual(15);
    expect(gap).toBeLessThanOrEqual(25);
  });

  it("returns null zones without a usable benchmark", () => {
    expect(buildPaceZones(null)).toBeNull();
    expect(buildPaceZones({ distance: "5k", seconds: "" })).toBeNull();
    expect(buildPaceZones({ distance: "5k", seconds: 120 })).toBeNull();
  });

  it("racePaceSecPerMile matches predicted time over distance", () => {
    const secs = predictRaceSeconds(45, "10k");
    expect(racePaceSecPerMile(45, "10k")).toBe(Math.round(secs / (10000 / 1609.344)));
  });
});

describe("paceTarget", () => {
  const zones = buildPaceZones({ distance: "5k", seconds: 19 * 60 + 57 });
  it("labels each intensity", () => {
    expect(paceTarget(zones, "easy").label).toMatch(/^\d:\d{2}–\d:\d{2}\/mi$/);
    expect(paceTarget(zones, "threshold").label).toBe(`${formatPace(zones.threshold)}/mi`);
    expect(paceTarget(zones, "race:10k").secPerMile).toBe(zones.race["10k"]);
  });
  it("is null without zones or for unknown intensities", () => {
    expect(paceTarget(null, "easy")).toBeNull();
    expect(paceTarget(zones, "tempo")).toBeNull();
    expect(paceTarget(zones, "race:ultra")).toBeNull();
  });
});

describe("parse / format", () => {
  it("parses mm:ss and h:mm:ss", () => {
    expect(parseDuration("24:30")).toBe(1470);
    expect(parseDuration(" 1:02:10 ")).toBe(3730);
  });
  it("rejects ambiguous text", () => {
    for (const bad of ["", "24", "24:75", "1:75:00", "abc", "24:3a", "0:00", null]) {
      expect(parseDuration(bad)).toBeNull();
    }
  });
  it("formats durations and paces", () => {
    expect(formatDuration(1470)).toBe("24:30");
    expect(formatDuration(3730)).toBe("1:02:10");
    expect(formatPace(494)).toBe("8:14");
    expect(formatPace(0)).toBe("");
  });
  it("normalizes benchmarks", () => {
    expect(normalizeBenchmark({ distance: "5k", seconds: "1620", date: "2026-11-26" })).toEqual({ distance: "5k", seconds: 1620, date: "2026-11-26" });
    expect(normalizeBenchmark({ distance: "5k", seconds: 1620, date: "Thanksgiving" })).toEqual({ distance: "5k", seconds: 1620, date: null });
    expect(normalizeBenchmark({ distance: "marathon-ish", seconds: 1620 })).toBeNull();
  });
});
