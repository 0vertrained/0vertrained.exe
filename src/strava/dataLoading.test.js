import { describe, expect, it } from "vitest";
import { selectStravaLedgerSuggestion } from "./dataLoading";

const activity = (startTime) => ({ startTime, date: startTime.slice(0, 10), miles: 5.1, minutes: 41.5, kind: "run" });

describe("selectStravaLedgerSuggestion", () => {
  it("routes a morning-after suggestion to yesterday's ledger", () => {
    const now = Date.parse("2026-07-10T08:00:00-05:00");
    const yesterday = activity("2026-07-09T19:00:00-05:00");
    const result = selectStravaLedgerSuggestion({
      stravaByDate: { "2026-07-09": [yesterday] },
      entries: {},
      displayedDate: "2026-07-10",
      todayKey: "2026-07-10",
      now,
    });
    expect(result?.dateKey).toBe("2026-07-09");
    expect(result?.dayLabel).toBe("Yesterday");
  });

  it("does not suggest a day that already has manual cardio", () => {
    const now = Date.parse("2026-07-10T08:00:00-05:00");
    const yesterday = activity("2026-07-09T19:00:00-05:00");
    const result = selectStravaLedgerSuggestion({
      stravaByDate: { "2026-07-09": [yesterday] },
      entries: { "2026-07-09": { workout: { cardio: { miles: "5" } } } },
      displayedDate: "2026-07-10",
      todayKey: "2026-07-10",
      now,
    });
    expect(result).toBeNull();
  });
});
