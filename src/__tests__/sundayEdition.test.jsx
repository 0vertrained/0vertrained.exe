// src/__tests__/sundayEdition.test.jsx
// @vitest-environment jsdom
// The Sunday Edition. Pins:
//   (1) the publish window — Sunday 17:00 through Monday 23:59 local, covering
//       the Mon–Sun week that ends that Sunday, boundary by boundary;
//   (2) model determinism (two builds of the same inputs are deep-equal) and
//       edition numbering from the first logged week;
//   (3) THE ONE CHANGE priority matrix — each rung beats everything below it,
//       and there is exactly ONE change;
//   (4) exceptions-only volume digest (in-range muscles never itemized);
//   (5) honest degradation — thin weeks carry the caveat, empty sections say
//       so in one line;
//   (6) the overlay's anatomy order and the jargon guard (no z-scores);
//   (7) the dashboard masthead line renders inside the window and opens the
//       overlay, with no new nav items.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup } from "@testing-library/react";
import { buildSundayEdition, editionWindow } from "../sundayEdition";
import { defaultDay } from "../constants";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(resolve(root, p), "utf8");
afterEach(cleanup);

// 2026-07-12 is a Sunday; the edition week is Mon 07-06 → Sun 07-12.
const SUN_5PM = new Date("2026-07-12T17:00:00");

function ouraDay(dayKey, hrv, rhr, sleepH = 7.0) {
  return {
    sleep: { data: [{ day: dayKey, type: "long_sleep", total_sleep_duration: sleepH * 3600, time_in_bed: (sleepH + 0.5) * 3600, efficiency: 90, latency: 600, average_hrv: hrv, lowest_heart_rate: rhr, average_heart_rate: rhr + 6 }] },
    readiness: { data: [{ day: dayKey, score: 78, temperature_deviation: 0.02, contributors: {} }] },
  };
}

// A healthy three-week fixture ending on the edition Sunday.
function healthyFixture() {
  const oura = {}, data = {}, whoop = {};
  const start = new Date("2026-06-22T12:00:00"); // three Mondays back
  for (let i = 0; i < 21; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    oura[key] = ouraDay(key, 70, 58, 7.4);
    whoop[key] = { sleep: { score: { sleep_needed: { baseline_milli: 7.4 * 3.6e6 } } } };
    const day = defaultDay();
    day.nutrition = { ...day.nutrition, calories: "2900", protein: "205" };
    if ([1, 2, 4, 5].includes(d.getDay())) day.workout = { completed: true, exercises: { "Bench Press": { sets: [{ done: true, weight: "185", reps: "8" }, { done: true, weight: "185", reps: "8" }, { done: true, weight: "185", reps: "8" }] } }, cardio: {}, notes: "" };
    data[key] = day;
  }
  return { data, oura, whoop, settings: { goals: { protein: 205, calories: 2900 } } };
}

describe("V17.2 publish window — boundary by boundary", () => {
  const cases = [
    ["Sat 23:59", new Date("2026-07-11T23:59:00"), false],
    ["Sun 16:59", new Date("2026-07-12T16:59:00"), false],
    ["Sun 17:00", new Date("2026-07-12T17:00:00"), true],
    ["Mon 09:00", new Date("2026-07-13T09:00:00"), true],
    ["Mon 23:59", new Date("2026-07-13T23:59:00"), true],
    ["Tue 00:01", new Date("2026-07-14T00:01:00"), false],
  ];
  it.each(cases)("%s → available %s", (_label, now, expected) => {
    expect(editionWindow(now).available).toBe(expected);
  });

  it("the covered week is always the Mon–Sun ending at that Sunday — including from Monday", () => {
    expect(editionWindow(SUN_5PM).weekStartKey).toBe("2026-07-06");
    expect(editionWindow(SUN_5PM).weekEndKey).toBe("2026-07-12");
    const mon = editionWindow(new Date("2026-07-13T09:00:00"));
    expect(mon.weekStartKey).toBe("2026-07-06");
    expect(mon.weekEndKey).toBe("2026-07-12");
    // Sunday BEFORE 17:00 still points at LAST week's edition:
    expect(editionWindow(new Date("2026-07-12T10:00:00")).weekEndKey).toBe("2026-07-05");
  });
});

describe("V17.2 model — determinism, numbering, honesty", () => {
  it("two builds of the same inputs are deep-equal (golden determinism)", () => {
    const f = healthyFixture();
    const a = buildSundayEdition({ ...f, ouraData: f.oura, whoopData: f.whoop, now: SUN_5PM });
    const b = buildSundayEdition({ ...f, ouraData: f.oura, whoopData: f.whoop, now: SUN_5PM });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("edition № counts weeks since the first logged Monday", () => {
    const f = healthyFixture(); // first log Mon 06-22 → editions: 1, 2, 3
    const m = buildSundayEdition({ ...f, ouraData: f.oura, whoopData: f.whoop, now: SUN_5PM });
    expect(m.edition.number).toBe(3);
  });

  it("a healthy full week: no caveat, timeline populated, morning count honest", () => {
    const f = healthyFixture();
    const m = buildSundayEdition({ ...f, ouraData: f.oura, whoopData: f.whoop, now: SUN_5PM });
    expect(m.completeness.caveat).toBe(null);
    expect(m.completeness.wearableMornings).toBe(7);
    expect(m.recoveryWeek.timeline).toHaveLength(7);
    expect(m.recoveryWeek.timeline[0].dayName).toBe("Mon");
    expect(m.recoveryWeek.timeline[6].dayName).toBe("Sun");
  });

  it("a thin week carries the caveat and empty sections say so in one line", () => {
    const m = buildSundayEdition({ data: {}, ouraData: {}, whoopData: {}, settings: {}, now: SUN_5PM });
    expect(m.completeness.caveat).toMatch(/0 of 7 days logged/);
    expect(m.recoveryWeek.summary).toMatch(/No wearable mornings/);
    expect(m.volumeDigest.ready).toBe(false);
    expect(m.fuelWeek.line).toMatch(/No nutrition logged/);
    expect(m.divergenceDiary).toHaveLength(0);
  });

  it("no string anywhere in the model contains a z-score", () => {
    const f = healthyFixture();
    const m = buildSundayEdition({ ...f, ouraData: f.oura, whoopData: f.whoop, now: SUN_5PM });
    expect(JSON.stringify(m)).not.toMatch(/z[- ]?score|z\s*=/i);
  });
});

describe("V17.2 THE ONE CHANGE — strict priority, exactly one", () => {
  it("a healthy week resolves to run-it-back", () => {
    const f = healthyFixture();
    const m = buildSundayEdition({ ...f, ouraData: f.oura, whoopData: f.whoop, now: SUN_5PM });
    expect(m.oneChange.rung).toBe("run_it_back");
    expect(m.oneChange.method).toMatch(/strict order/);
  });

  it("recovery state beats everything: a fatigued week-end wins even with sleep debt and volume exceptions present", () => {
    const f = healthyFixture();
    // Suppress the last week hard: HRV down ~15%, RHR climbing, short sleep.
    const week = ["2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10", "2026-07-11", "2026-07-12"];
    week.forEach((k, i) => { f.oura[k] = ouraDay(k, 58, 58 + i, 5.4); });
    const m = buildSundayEdition({ ...f, ouraData: f.oura, whoopData: f.whoop, now: SUN_5PM });
    expect(m.oneChange.rung).toBe("recovery_state");
    expect(m.oneChange.text).toMatch(/half your planned volume/i);
  });

  it("sleep debt beats volume and protein when recovery holds", () => {
    const f = healthyFixture();
    const week = ["2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10", "2026-07-11", "2026-07-12"];
    week.forEach((k) => { f.oura[k] = ouraDay(k, 70, 58, 4.9); }); // HRV/RHR healthy, sleep short
    f.settings.goals.protein = 300; // protein adherence would also fire
    const m = buildSundayEdition({ ...f, ouraData: f.oura, whoopData: f.whoop, now: SUN_5PM });
    expect(m.oneChange.rung).toBe("sleep_debt");
    expect(m.oneChange.text).toMatch(/45 minutes/);
  });

  it("protein fires only when everything above it is clean", () => {
    const f = healthyFixture();
    f.settings.goals.protein = 300; // averaged 205 → ~68%
    const m = buildSundayEdition({ ...f, ouraData: f.oura, whoopData: f.whoop, now: SUN_5PM });
    expect(m.oneChange.rung).toBe("protein");
    expect(m.oneChange.reason).toMatch(/adherence 68%/);
  });

  it("V19.4 · measures fuel against the targets Fuel shows (settings.goals), not the unwritten macroTargets key", () => {
    const f = healthyFixture();
    const m = buildSundayEdition({ ...f, ouraData: f.oura, whoopData: f.whoop, now: SUN_5PM });
    expect(m.fuelWeek.proteinTarget).toBe(205);
    expect(m.fuelWeek.line).toMatch(/against a 205g target \(100%\)/);
    const legacy = buildSundayEdition({ ...f, settings: { macroTargets: { protein: 205 } }, ouraData: f.oura, whoopData: f.whoop, now: SUN_5PM });
    expect(legacy.fuelWeek.proteinTarget).toBeNull();
  });

  it("there is exactly one change — a single text, never a list", () => {
    const f = healthyFixture();
    const m = buildSundayEdition({ ...f, ouraData: f.oura, whoopData: f.whoop, now: SUN_5PM });
    expect(typeof m.oneChange.text).toBe("string");
    expect(Array.isArray(m.oneChange)).toBe(false);
  });
});

describe("V17.2 volume digest — exceptions only", () => {
  it("untouched muscles never appear as exceptions — a program choice is not a weekly slip", () => {
    const f = healthyFixture(); // bench-only weeks leave many muscles at 0 sets
    const m = buildSundayEdition({ ...f, ouraData: f.oura, whoopData: f.whoop, now: SUN_5PM });
    if (m.volumeDigest.ready) {
      for (const e of m.volumeDigest.exceptions) {
        if (e.status === "below_mev") expect(e.sets).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("in-range muscles are never itemized; the digest collapses them to one line", () => {
    const f = healthyFixture();
    const m = buildSundayEdition({ ...f, ouraData: f.oura, whoopData: f.whoop, now: SUN_5PM });
    if (m.volumeDigest.ready) {
      for (const e of m.volumeDigest.exceptions) {
        expect(["below_mev", "above_mrv"]).toContain(e.status);
      }
      expect(m.volumeDigest.line).toMatch(/in range|inside productive/);
    }
  });
});

describe("V17.2 surface (source guards)", () => {
  it("overlay anatomy order: masthead → recovery → load → volume → fuel → diary → one change → footer", () => {
    const src = read("src/SundayEdition.jsx");
    const order = ["The Sunday Edition", "The week in recovery", "Load ledger", "Volume digest", "Fuel week", "Divergence diary", "one-change", "Next edition Sunday."];
    let last = -1;
    for (const marker of order) {
      const at = src.indexOf(marker);
      expect(at, marker).toBeGreaterThan(last);
      last = at;
    }
  });

  it("MethodLine sits under the edition's figures", () => {
    const src = read("src/SundayEdition.jsx");
    for (const id of ["method-edition-recovery", "method-edition-load", "method-edition-volume"]) {
      expect(src).toContain(id);
    }
  });

  it("the dashboard masthead line gates on the window and stashed data, opens the overlay, adds no nav", () => {
    const src = read("src/RecoveryDashboard.jsx");
    expect(src).toContain("editionWindow(new Date()).available && editionRaw");
    expect(src).toContain('data-testid="sunday-edition-line"');
    expect(src).toContain("setShowEdition(true)");
    // The raw stash is deliberately outside the session cache:
    expect(src).not.toMatch(/editionRaw:\s/);
  });
});
