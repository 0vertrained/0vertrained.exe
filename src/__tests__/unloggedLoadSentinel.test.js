// V16.1 · F7 sentinel contracts (flag-only per design) + relocation guard.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { findUnloggedLoadDays } from "../loadModel";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(resolve(root, p), "utf8");
const day = (i, load) => ({ date: `2026-07-${String(13 - i).padStart(2, "0")}`, load });
const whoopWith = (strains) => Object.fromEntries(
  Object.entries(strains).map(([d, v]) => [d, { cycle: { score: { strain: v } } }])
);

describe("unlogged-load sentinel (F7)", () => {
  it("REPRO: a strain-16 day with nothing logged is flagged, not ignored", () => {
    const daily = [day(0, 0), day(1, 300), day(2, 280), day(3, 0), day(4, 310), day(5, 290), day(6, 305)];
    const whoop = whoopWith({
      "2026-07-13": 16.2, "2026-07-12": 12, "2026-07-11": 11.5,
      "2026-07-10": 4.1, "2026-07-09": 12.8, "2026-07-08": 11.9, "2026-07-07": 12.4,
    });
    const flags = findUnloggedLoadDays(daily, whoop);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ date: "2026-07-13", strain: 16.2 });
    // Personal threshold: median of LOGGED-day strains (12ish), floored at 10.
    expect(flags[0].threshold).toBeGreaterThanOrEqual(10);
    // The rest day at 4.1 strain did NOT flag.
  });

  it("thin history falls back to the absolute-14 bar", () => {
    const daily = [day(0, 0), day(1, 250)];
    expect(findUnloggedLoadDays(daily, whoopWith({ "2026-07-13": 13.5, "2026-07-12": 12 }))).toHaveLength(0);
    expect(findUnloggedLoadDays(daily, whoopWith({ "2026-07-13": 14.5, "2026-07-12": 12 }))).toHaveLength(1);
  });

  it("flag-only shape: dates and strains, never a load value to inject", () => {
    const flags = findUnloggedLoadDays([day(0, 0)], whoopWith({ "2026-07-13": 18 }));
    expect(Object.keys(flags[0]).sort()).toEqual(["date", "source", "strain", "threshold"]);
  });

  it("V16.5 · a synced 5mi Strava run with nothing logged flags when Whoop is silent", () => {
    const flags = findUnloggedLoadDays(
      [day(0, 0), day(1, 300)], null,
      { stravaByDate: { "2026-07-13": [{ distance_m: 8046 }] } }
    );
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ source: "strava", miles: 5 });
  });

  it("V16.5 · one flag per day — Whoop's strain detail wins over Strava", () => {
    const daily = [day(0, 0), day(1, 300), day(2, 280), day(3, 300), day(4, 310), day(5, 290)];
    const whoop = whoopWith({ "2026-07-13": 16, "2026-07-12": 12, "2026-07-11": 12, "2026-07-10": 12, "2026-07-09": 12, "2026-07-08": 12 });
    const flags = findUnloggedLoadDays(daily, whoop, { stravaByDate: { "2026-07-13": [{ distance_m: 8046 }] } });
    expect(flags.filter(f => f.date === "2026-07-13")).toHaveLength(1);
    expect(flags[0].source).toBe("whoop");
  });

  it("no whoop data → no flags, quietly", () => {
    expect(findUnloggedLoadDays([day(0, 0)], null)).toEqual([]);
  });
});

describe("V16.1 relocation", () => {
  it("engine lives in wearables/ with a working shim at the old path", () => {
    expect(read("src/wearables/recoveryEngine.js")).toContain("Multi-Wearable Recovery Engine");
    const shim = read("src/oura/algorithms.js");
    expect(shim).toContain('export * from "../wearables/recoveryEngine"');
    expect(shim.split("\n").length).toBeLessThan(12); // truly a shim, not a copy
  });
});
