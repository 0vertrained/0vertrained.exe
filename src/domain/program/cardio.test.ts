import { describe, expect, it } from "vitest";
import { toDisplayDistance } from "../units";
import { CARDIO_SESSIONS, buildCardio, cardioIntensity, kmFromMiles, type CardioKey } from "./cardio";

describe("cardio catalog", () => {
  it("includes all the session types the generator uses", () => {
    const kinds = Object.values(CARDIO_SESSIONS).map((s) => s.kind);
    for (const kind of ["Easy Run", "Zone 2 Run", "Long Run", "Tempo Run", "Intervals", "Hill Repeats", "Recovery Walk", "Bike Zone 2", "Row Erg Intervals", "Incline Walk"]) {
      expect(kinds).toContain(kind);
    }
  });

  it("plans a distance or a duration for every session, never neither", () => {
    for (const s of Object.values(CARDIO_SESSIONS) as { km?: number; minutes?: number }[]) {
      expect((s.km ?? 0) > 0 || (s.minutes ?? 0) > 0).toBe(true);
    }
  });

  it("keeps notes free of miles and kilometres (they're shown in either unit)", () => {
    for (const s of Object.values(CARDIO_SESSIONS)) expect(s.notes).not.toMatch(/\d\s*(mi|km)\b|\bmiles?\b/);
  });
});

describe("kmFromMiles", () => {
  it.each([1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 11])("%s mi still shows as %s mi in imperial", (miles) => {
    expect(toDisplayDistance(kmFromMiles(miles), "imperial")).toBe(miles);
  });

  it("rounds to 0.1 km", () => {
    expect(kmFromMiles(8)).toBe(12.9);
    expect(kmFromMiles(4)).toBe(6.4);
  });
});

describe("buildCardio", () => {
  it("returns the plan shape, with overrides", () => {
    expect(buildCardio("long_run", { km: 15 })).toEqual({ kind: "Long Run", km: 15, effort: "Zone 2", notes: CARDIO_SESSIONS.long_run.notes });
    expect(buildCardio("bike_zone2")).toEqual({ kind: "Bike Zone 2", minutes: 40, effort: "Zone 2", notes: CARDIO_SESSIONS.bike_zone2.notes });
    expect(buildCardio("easy_run", { notes: "Shakeout" }).notes).toBe("Shakeout");
  });

  it("buckets intensity for the spacing rules", () => {
    const keys = Object.keys(CARDIO_SESSIONS) as CardioKey[];
    expect(keys.filter((k) => cardioIntensity(k) === "hard")).toEqual(["tempo_run", "intervals", "hill_repeats", "row_intervals"]);
    expect(cardioIntensity("easy_run")).toBe("easy");
    expect(cardioIntensity("recovery_walk")).toBe("recovery");
  });
});
