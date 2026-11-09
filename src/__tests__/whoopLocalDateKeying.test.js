// src/__tests__/whoopLocalDateKeying.test.js
// Local-date keying + cross-date dedupe. The old UTC-prefix keying
// mis-dated every record whose timestamp crosses UTC midnight before local
// midnight: on the reporting user's export (an evening lifter at UTC−5),
// 9 of 20 workouts — every session after 7 p.m. — were filed under the NEXT
// day. That shifted day-load/ACWR attribution by one and compounded with the
// strain-summing bug: the "17.9 strain-sum vs 4.1 actual day-strain" day was
// two evening workouts leaking in from the previous local day. Cycles have a
// wake-day convention of their own, and recovery records (no window, no
// offset) must date via their cycle. The client dedupes by external_id across
// dates so one re-sync after this fix self-heals the historical rows.
import { describe, it, expect } from "vitest";
import { toLocalDateKey, pickRecordDate, pickCycleDate } from "../../netlify/functions/whoop-auth.js";
import { groupWhoopRows } from "../whoop/dataLoading";

describe("V16.7 Whoop local-date keying", () => {
  it("keys an evening workout to its LOCAL day (the export's 8:33 p.m. lift)", () => {
    const workout = {
      id: "4d952c59", sport_name: "weightlifting",
      start: "2026-07-15T01:33:00.200Z", end: "2026-07-15T01:46:59.409Z",
      timezone_offset: "-05:00", score_state: "SCORED", score: {},
    };
    // 01:33Z on the 15th is 20:33 CDT on the 14th.
    expect(pickRecordDate(workout)).toBe("2026-07-14");
  });

  it("morning records are unchanged; missing/malformed offsets fall back to UTC", () => {
    expect(pickRecordDate({ start: "2026-07-13T14:08:00.000Z", timezone_offset: "-05:00" })).toBe("2026-07-13");
    expect(pickRecordDate({ start: "2026-07-15T01:33:00.000Z" })).toBe("2026-07-15");
    expect(pickRecordDate({ start: "2026-07-15T01:33:00.000Z", timezone_offset: "garbage" })).toBe("2026-07-15");
    expect(toLocalDateKey("2026-07-15T01:33:00.000Z", "+09:00")).toBe("2026-07-15");
  });

  it("main sleep keys on LOCAL wake date (late-evening wake no longer skips a day)", () => {
    const lateWake = { nap: false, end: "2026-07-15T01:10:00.000Z", timezone_offset: "-05:00" };
    expect(pickRecordDate(lateWake)).toBe("2026-07-14"); // woke 8:10 p.m. CDT on the 14th
  });

  it("cycles key to the WAKE day: evening bedtime → next local day, past-midnight bedtime → same day", () => {
    // Export shape: bed 23:15 CDT July 13 → the cycle is July 14's day.
    expect(pickCycleDate({ start: "2026-07-14T04:15:01.712Z", end: null, timezone_offset: "-05:00" })).toBe("2026-07-14");
    // Bed 00:44 CDT July 4 → still July 4's day.
    expect(pickCycleDate({ start: "2026-07-04T05:44:00.000Z", end: "2026-07-05T04:43:00.000Z", timezone_offset: "-05:00" })).toBe("2026-07-04");
    // The rule must hold for eastern offsets where the old UTC keying inverted:
    // bed 23:00 JST July 13 (= 14:00Z on the 13th) → wake day July 14.
    expect(pickCycleDate({ start: "2026-07-13T14:00:00.000Z", end: null, timezone_offset: "+09:00" })).toBe("2026-07-14");
  });

  it("client dedupe: the same external_id at two dates keeps only the freshest copy", () => {
    const stale = { id: "w-evening", start: "2026-07-15T01:33:00.200Z", updated_at: "2026-07-15T02:00:00.000Z", score: { strain: 7.3 } };
    const fresh = { ...stale, updated_at: "2026-07-15T06:00:00.000Z" };
    const rows = [
      { date: "2026-07-15", data_type: "workout", external_id: "w-evening", payload: stale },  // pre-fix UTC date
      { date: "2026-07-14", data_type: "workout", external_id: "w-evening", payload: fresh },  // corrected re-sync
    ];
    for (const ordered of [rows, [...rows].reverse()]) {
      const g = groupWhoopRows(ordered);
      expect(g["2026-07-15"]).toBeUndefined();
      expect(g["2026-07-14"].workout).toHaveLength(1);
      expect(g["2026-07-14"].workout[0].updated_at).toBe("2026-07-15T06:00:00.000Z");
    }
  });

  it("dedupe never merges records that merely lack an external_id", () => {
    const rows = [
      { date: "2026-07-14", data_type: "cycle", external_id: "", payload: { id: 1, score: {} } },
      { date: "2026-07-13", data_type: "cycle", external_id: "", payload: { id: 2, score: {} } },
    ];
    const g = groupWhoopRows(rows);
    expect(g["2026-07-14"].cycle.id).toBe(1);
    expect(g["2026-07-13"].cycle.id).toBe(2);
  });
});
