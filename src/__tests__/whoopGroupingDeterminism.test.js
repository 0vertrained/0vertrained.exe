// src/__tests__/whoopGroupingDeterminism.test.js
// ─────────────────────────────────────────────────────────────────────────────
// V16.6 · Deterministic Whoop day-grouping. The old last-write-wins grouping
// left `day.sleep` to unspecified within-date Postgres row order: on the
// reporting user's export, 2026-07-11 (nap + main sleep sharing a date key)
// resolved to the NAP (performance 12%) in one order and the main sleep (83%)
// in the other. That coin-flip fed the sleep fallback rung, the source
// resolver's conflict detector (false "major" 473-min sleep disagreement →
// "Mixed signal day"), and the Whoop display cards. Grouping must now be a
// pure function of the row SET, not the row ORDER.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { groupWhoopRows } from "../whoop/dataLoading";

const MAIN_SLEEP = {
  id: "main-1", nap: false, score_state: "SCORED",
  start: "2026-07-11T04:30:00.000Z", end: "2026-07-11T11:20:00.000Z",
  created_at: "2026-07-11T11:40:00.000Z", updated_at: "2026-07-11T11:40:00.000Z",
  score: {
    sleep_performance_percentage: 83,
    stage_summary: { total_in_bed_time_milli: 24_600_000, total_awake_time_milli: 1_400_000 },
  },
};
const NAP = {
  id: "nap-1", nap: true, score_state: "SCORED",
  start: "2026-07-11T19:05:00.000Z", end: "2026-07-11T20:10:00.000Z",
  created_at: "2026-07-11T20:20:00.000Z", updated_at: "2026-07-11T20:20:00.000Z",
  score: {
    sleep_performance_percentage: 12,
    stage_summary: { total_in_bed_time_milli: 3_900_000, total_awake_time_milli: 300_000 },
  },
};

const row = (data_type, payload, date = "2026-07-11") => ({ date, data_type, external_id: payload.id, payload });

describe("V16.6 Whoop grouping determinism", () => {
  it("main sleep wins over the nap regardless of row order", () => {
    const forward = groupWhoopRows([row("sleep", NAP), row("sleep", MAIN_SLEEP)]);
    const reversed = groupWhoopRows([row("sleep", MAIN_SLEEP), row("sleep", NAP)]);
    expect(forward["2026-07-11"].sleep.id).toBe("main-1");
    expect(reversed["2026-07-11"].sleep.id).toBe("main-1");
    expect(forward["2026-07-11"].sleep.score.sleep_performance_percentage).toBe(83);
  });

  it("retains every sleep record in sleepAll, main first", () => {
    const g = groupWhoopRows([row("sleep", NAP), row("sleep", MAIN_SLEEP)]);
    const all = g["2026-07-11"].sleepAll;
    expect(all).toHaveLength(2);
    expect(all[0].id).toBe("main-1");
    expect(all[1].id).toBe("nap-1");
  });

  it("a SCORED record beats a PENDING_SCORE re-sync for single-per-day types", () => {
    const scored = { id: 1639965429, score_state: "SCORED", updated_at: "2026-07-11T06:00:00.000Z", score: { recovery_score: 63 } };
    const pending = { id: 1639965430, score_state: "PENDING_SCORE", updated_at: "2026-07-11T09:00:00.000Z" };
    const forward = groupWhoopRows([row("recovery", scored), row("recovery", pending)]);
    const reversed = groupWhoopRows([row("recovery", pending), row("recovery", scored)]);
    expect(forward["2026-07-11"].recovery.score.recovery_score).toBe(63);
    expect(reversed["2026-07-11"].recovery.score.recovery_score).toBe(63);
  });

  it("between two SCORED sleeps of the same nap status, the longer in-bed record wins; latest update breaks exact ties", () => {
    const shortMain = { ...MAIN_SLEEP, id: "main-short", score: { ...MAIN_SLEEP.score, stage_summary: { total_in_bed_time_milli: 20_000_000 } } };
    const g = groupWhoopRows([row("sleep", shortMain), row("sleep", MAIN_SLEEP)]);
    expect(g["2026-07-11"].sleep.id).toBe("main-1");
    const older = { ...MAIN_SLEEP, id: "main-old", updated_at: "2026-07-11T05:00:00.000Z" };
    const g2 = groupWhoopRows([row("sleep", older), row("sleep", MAIN_SLEEP)]);
    expect(g2["2026-07-11"].sleep.id).toBe("main-1");
  });

  it("workouts still accumulate into an array", () => {
    const w1 = { id: "w1", score: { strain: 7.3 } };
    const w2 = { id: "w2", score: { strain: 4.1 } };
    const g = groupWhoopRows([row("workout", w1), row("workout", w2)]);
    expect(g["2026-07-11"].workout).toHaveLength(2);
  });

  it("skips malformed rows without dating or typing", () => {
    const g = groupWhoopRows([null, { date: "", data_type: "sleep", payload: MAIN_SLEEP }, row("sleep", MAIN_SLEEP)]);
    expect(Object.keys(g)).toEqual(["2026-07-11"]);
  });
});
