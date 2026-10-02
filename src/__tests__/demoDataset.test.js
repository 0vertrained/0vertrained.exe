// @vitest-environment jsdom
// V15.5 · Demo dataset contracts. The recruiter/investor demo is only worth
// shipping if the intelligence systems demonstrably fire on it — these pin
// that, plus determinism (a walkthrough must be reproducible) and coherence
// (Strava derives from the entries' own cardio days).
import { describe, expect, it } from "vitest";
import { buildDemoEntries, buildDemoOura, buildDemoWhoop, buildDemoStrava, buildDemoFormHistory } from "../demo/demoDataset";
import { DEFAULT_PROGRAM } from "../constants";
import { buildDailyLoads, computeRollingLoads } from "../loadModel";
import { buildWhoopSummary } from "../whoop";
import { calcStreak } from "../AppHeader";

const iso = (offset) => {
  const d = new Date(); d.setDate(d.getDate() + offset);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const weekday = (k) => ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][new Date(k + "T12:00:00").getDay()];

describe("demo dataset", () => {
  const entries = buildDemoEntries(140);

  it("is deterministic — two builds are identical", () => {
    expect(JSON.stringify(buildDemoEntries(140))).toBe(JSON.stringify(entries));
  });

  it("every logged lift belongs to that weekday's actual program", () => {
    let workoutDays = 0;
    for (const [key, day] of Object.entries(entries)) {
      const names = Object.keys(day.workout?.exercises || {});
      if (!names.length) continue;
      workoutDays += 1;
      const allowed = new Set((DEFAULT_PROGRAM[weekday(key)]?.lifting || []).map((e) => e.name));
      for (const n of names) expect(allowed.has(n)).toBe(true);
    }
    expect(workoutDays).toBeGreaterThanOrEqual(70);
  });

  it("today is interactive: no workout logged, fuel targets still open", () => {
    const today = entries[iso(0)];
    expect(Object.keys(today.workout?.exercises || {})).toHaveLength(0);
    expect(parseInt(today.nutrition.calories, 10)).toBeLessThan(3400);
    expect(parseInt(today.nutrition.protein, 10)).toBeLessThan(200);
  });

  it("the masthead streak and load model both resolve", () => {
    expect(calcStreak(entries).count).toBeGreaterThanOrEqual(12);
    const rolling = computeRollingLoads(buildDailyLoads(entries, 28, iso(0)));
    expect(rolling.zone).not.toBe("insufficient_data");
    expect(rolling.ratio).toBeGreaterThan(0);
  });

  it("oura covers 35 days with sleep, readiness, activity, and spo2 docs", () => {
    const oura = buildDemoOura(entries, 35);
    expect(Object.keys(oura)).toHaveLength(35);
    const day = oura[iso(0)];
    expect(day.sleep.data[0].heart_rate_variability.average).toBeGreaterThan(0);
    expect(day.readiness.data[0].score).toBeGreaterThan(0);
    expect(day.activity.data[0].steps).toBeGreaterThan(0);
    expect(day.daily_spo2.data[0].spo2_percentage.average).toBeGreaterThanOrEqual(95);
  });

  it("whoop records normalize — the strain plate has a number to show", () => {
    const summary = buildWhoopSummary(buildDemoWhoop(entries, 35));
    expect(Number.isFinite(summary?.cycle?.strain)).toBe(true);
  });

  it("strava activities derive from the entries' own cardio days", () => {
    const acts = buildDemoStrava(entries, 30);
    expect(acts.length).toBeGreaterThanOrEqual(6);
    for (const a of acts) {
      const key = a.start_date.slice(0, 10);
      const miles = parseFloat(entries[key]?.workout?.cardio?.miles || "0");
      expect(Math.abs(a.distance_m - miles * 1609.34)).toBeLessThan(2);
    }
  });

  it("form history: four checks, newest recent enough to badge", () => {
    const h = buildDemoFormHistory();
    expect(h).toHaveLength(4);
    expect(h[0].date.slice(0, 10) >= iso(-3)).toBe(true);
    for (const e of h) expect(e.formScore.score).toBeGreaterThan(0);
  });
});
