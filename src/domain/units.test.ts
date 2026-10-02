import { describe, expect, it } from "vitest";
import {
  floorTo,
  formatDistance,
  formatDuration,
  formatWeight,
  fromDisplayDistance,
  fromDisplayWeight,
  kgToLb,
  kmToMi,
  lbToKg,
  loadIncrement,
  miToKm,
  mToYd,
  parseDurationMinutes,
  round1,
  roundLoadKg,
  roundTo,
  toDisplayDistance,
  toDisplayWeight,
  ydToM,
} from "./units";

describe("conversions", () => {
  it("round-trips pounds through kilograms to the display value", () => {
    for (const lb of [5, 45, 135, 185, 202.5, 405]) {
      expect(toDisplayWeight(lbToKg(lb), "imperial")).toBe(lb);
    }
    expect(kgToLb(100)).toBeCloseTo(220.462, 3);
  });

  it("round-trips miles and yards", () => {
    expect(toDisplayDistance(miToKm(5.5), "imperial")).toBe(5.5);
    expect(kmToMi(miToKm(3.1))).toBeCloseTo(3.1, 10);
    expect(mToYd(ydToM(40))).toBeCloseTo(40, 10);
  });

  it("converts typed values into canonical units", () => {
    expect(fromDisplayWeight(100, "metric")).toBe(100);
    expect(fromDisplayWeight(220.462262185, "imperial")).toBeCloseTo(100, 6);
    expect(fromDisplayDistance(10, "metric")).toBe(10);
    expect(fromDisplayDistance(1, "imperial")).toBeCloseTo(1.609344, 6);
  });
});

describe("rounding", () => {
  it("removes float noise", () => {
    expect(round1(18.700000000000003)).toBe(18.7);
  });

  it("rounds and floors to a step", () => {
    expect(roundTo(183, 5)).toBe(185);
    expect(roundTo(7, 0)).toBe(7);
    expect(floorTo(184.99999999999, 5)).toBe(185);
    expect(floorTo(189, 5)).toBe(185);
    expect(floorTo(3, -1)).toBe(3);
  });

  it("rounds prescribed loads to loadable plates in the display system", () => {
    expect(loadIncrement("imperial")).toBe(5);
    expect(loadIncrement("metric")).toBe(2.5);
    expect(toDisplayWeight(roundLoadKg(lbToKg(187), "imperial"), "imperial")).toBe(185);
    expect(roundLoadKg(81.4, "metric")).toBe(82.5);
  });
});

describe("formatting", () => {
  it("formats weights and distances with units", () => {
    expect(formatWeight(lbToKg(185), "imperial")).toBe("185 lb");
    expect(formatWeight(82.5, "metric")).toBe("82.5 kg");
    expect(formatWeight(null, "metric")).toBe("—");
    expect(formatDistance(10, "metric")).toBe("10 km");
    expect(formatDistance(miToKm(3.1), "imperial")).toBe("3.1 mi");
    expect(formatDistance(undefined, "imperial")).toBe("—");
  });

  it("formats durations", () => {
    expect(formatDuration(95)).toBe("1:35");
    expect(formatDuration(3725)).toBe("1:02:05");
    expect(formatDuration(-1)).toBe("—");
    expect(formatDuration(null)).toBe("—");
  });

  it("parses typed durations into minutes", () => {
    expect(parseDurationMinutes("45")).toBe(45);
    expect(parseDurationMinutes("45:30")).toBe(45.5);
    expect(parseDurationMinutes("1:05:00")).toBe(65);
    expect(parseDurationMinutes(" 30 ")).toBe(30);
    expect(parseDurationMinutes(12)).toBe(12);
    expect(parseDurationMinutes("")).toBeNull();
    expect(parseDurationMinutes("abc")).toBeNull();
    expect(parseDurationMinutes("10:75")).toBeNull();
    expect(parseDurationMinutes("1:75:00")).toBeNull();
    expect(parseDurationMinutes("1:2:3:4")).toBeNull();
    expect(parseDurationMinutes(-5)).toBeNull();
    expect(parseDurationMinutes(null)).toBeNull();
  });
});
