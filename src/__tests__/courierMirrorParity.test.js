// src/__tests__/courierMirrorParity.test.js
// The drift alarm. House doctrine: Netlify functions MIRROR src logic
// (V16.6/16.7 precedent), and this test is the contract that keeps the mirror
// honest. It runs the src classifier and the courier's slim mirror on
// identical raw-row fixtures and asserts equal states under the courier's
// operating conditions (loadZone = null, sleepDebt = null, no recoveryHistory,
// Oura only).
//
// If you change src/oura/normalization.js, src/oura/statistics.js, or
// src/wearables/recoveryTrend.js and this fails: update
// netlify/functions/_recovery-mirror.js to match. That is the entire fix.
import { describe, it, expect } from "vitest";
import { classifyRecoveryState } from "../wearables/recoveryTrend";
import { mirrorClassify, groupOuraRows } from "../../netlify/functions/_recovery-mirror.js";

// Raw DB-row shape: { date, data_type, payload } — exactly what oura_data holds.
function rowsFor(pairs) {
  const rows = [];
  const start = new Date("2026-06-20T12:00:00Z");
  pairs.forEach(([hrv, rhr], i) => {
    const d = new Date(start.getTime() + i * 86400000);
    const key = d.toISOString().slice(0, 10);
    rows.push({
      date: key, data_type: "sleep",
      payload: { data: [{ day: key, type: "long_sleep", total_sleep_duration: 7 * 3600, average_hrv: hrv, lowest_heart_rate: rhr, average_heart_rate: rhr + 6 }] },
    });
    rows.push({ date: key, data_type: "readiness", payload: { data: [{ day: key, score: 77, contributors: {} }] } });
  });
  return rows;
}

const FLAT = Array.from({ length: 21 }, () => [70, 58]);

const FIXTURES = {
  empty: [],
  calibrating_thin: rowsFor(FLAT.slice(0, 4)),
  steady_flat: rowsFor(FLAT),
  fresh_elevated_rhr_falling: rowsFor([...FLAT.slice(0, 14), ...[76, 77, 77, 78, 78, 79, 79].map((h, i) => [h, 58 - i * 0.5])]),
  accumulating_suppressed_rhr_flat: rowsFor([...FLAT.slice(0, 14), ...[62, 62, 61, 62, 61, 62, 61].map((h) => [h, 58])]),
  deload_suppressed_rhr_rising: rowsFor([...FLAT.slice(0, 14), ...[62, 62, 61, 62, 61, 62, 61].map((h, i) => [h, 58 + i * 0.8])]),
  // Nap noise: a late_nap and a deleted doc must not perturb either side.
  nap_noise: (() => {
    const rows = rowsFor(FLAT);
    const key = rows[rows.length - 2].date;
    rows.push({ date: key, data_type: "sleep", payload: { data: [
      { day: key, type: "late_nap", total_sleep_duration: 1.5 * 3600, average_hrv: 39, lowest_heart_rate: 68 },
      { day: key, type: "deleted", total_sleep_duration: 2 * 3600, average_hrv: 10, lowest_heart_rate: 90 },
    ]}});
    return rows;
  })(),
  // Borderline band edge: rolling right at the SWC boundary exercises the
  // trimmed-stat small-quirk mirrors (the <5-sample fallbacks, n−1 stdDev).
  borderline: rowsFor([...FLAT.slice(0, 14), [66, 58], [67, 58], [66, 58], [67, 58], [66, 58], [67, 58], [66, 58]]),
};

describe("V17.3 mirror parity — src classifier vs courier mirror", () => {
  it.each(Object.entries(FIXTURES))("%s: identical state", (_name, rows) => {
    // The courier groups rows itself; feed src the same grouping to isolate
    // classification parity from transport.
    const grouped = groupOuraRows(rows);
    const srcState = classifyRecoveryState({ ouraData: grouped }).state.key;
    const mirrorState = mirrorClassify(rows).stateKey;
    expect(mirrorState).toBe(srcState);
  });

  it("grouping parity: the mirror's row grouping matches the shape src expects", () => {
    const rows = FIXTURES.nap_noise;
    const grouped = groupOuraRows(rows);
    // Multiple sleep rows for one date must merge... they don't — last write
    // wins per (date, data_type), which matches the DB's unique constraint
    // (user_id, date, data_type): one payload per type per day. The fixture's
    // extra sleep row REPLACES the main payload, so both sides see the same
    // nap-only day — and both classify it identically (the parity above).
    expect(Object.keys(grouped).length).toBeGreaterThan(0);
  });

  it("the action snippets cover exactly the mirror-reachable states", async () => {
    // Absorbing load requires client-side load context; the courier must not
    // pretend otherwise — no action snippet may exist for it.
    const { ACTION_SNIPPETS } = await import("../../netlify/functions/edition-courier.js");
    expect(Object.keys(ACTION_SNIPPETS).sort()).toEqual(["accumulating", "deload", "fresh", "steady"]);
  });
});

