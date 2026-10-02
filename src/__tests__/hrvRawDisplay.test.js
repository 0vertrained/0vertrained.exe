import { describe, expect, it } from "vitest";
import { resolveHrvRawDisplay, formatShortDate } from "../recovery/hrvRawDisplay";

const readiness = (score = 82, hrvBalance = 86) => ({
  data: [{
    day: "2026-07-09",
    score,
    contributors: { hrv_balance: hrvBalance },
  }],
});

const sleep = (day, averageHrv, extra = {}) => ({
  data: [{
    day,
    score: 88,
    total_sleep_duration: 7 * 3600,
    average_hrv: averageHrv,
    lowest_heart_rate: 52,
    ...extra,
  }],
});

describe("resolveHrvRawDisplay", () => {
  it("prefers the scored day's real Oura sleep average HRV in ms", () => {
    const result = resolveHrvRawDisplay({
      "2026-07-09": { readiness: readiness(), sleep: sleep("2026-07-09", 70) },
      "2026-07-08": { sleep: sleep("2026-07-08", 31) },
    });

    expect(result.value).toBe(70);
    expect(result.unit).toBe("ms");
    expect(result.text).toBe("70 ms");
    expect(result.source).toBe("raw sleep average HRV");
    expect(result.isFallback).toBe(false);
    expect(result.isStale).toBe(false);
  });

  it("uses the most recent prior real sleep HRV with a dated stale label when the scored day is readiness-only", () => {
    const result = resolveHrvRawDisplay({
      "2026-07-09": { readiness: readiness(82, 86) },
      "2026-07-08": { sleep: sleep("2026-07-08", 70) },
      "2026-07-07": { sleep: sleep("2026-07-07", 31) },
    });

    expect(result.value).toBe(70);
    expect(result.unit).toBe("ms");
    expect(result.date).toBe("2026-07-08");
    expect(result.scoredDay).toBe("2026-07-09");
    expect(result.text).toBe("70 ms · Jul 8 night (last recorded)");
    expect(result.isFallback).toBe(false);
    expect(result.isStale).toBe(true);
  });

  it("falls back to Oura readiness hrv_balance only when no real sleep HRV exists and never labels it as ms", () => {
    const result = resolveHrvRawDisplay({
      "2026-07-09": { readiness: readiness(82, 86), sleep: { data: [{ day: "2026-07-09", score: 80 }] } },
    });

    expect(result.value).toBe(86);
    expect(result.unit).toBe("balance");
    expect(result.source).toBe("readiness fallback");
    expect(result.text).toBe("86/100 Oura HRV balance");
    expect(result.isFallback).toBe(true);
  });

  it("does not treat missing/null HRV as zero", () => {
    const result = resolveHrvRawDisplay({
      "2026-07-09": { readiness: readiness(82, 86), sleep: { data: [{ day: "2026-07-09", average_hrv: null }] } },
      "2026-07-08": { sleep: sleep("2026-07-08", 70) },
    });

    expect(result.value).toBe(70);
    expect(result.text).toContain("70 ms");
    expect(result.value).not.toBe(0);
  });

  it("returns a clear unavailable display when no HRV source exists", () => {
    const result = resolveHrvRawDisplay({
      "2026-07-09": { readiness: { data: [{ day: "2026-07-09", score: 82, contributors: {} }] } },
    });

    expect(result.value).toBeNull();
    expect(result.text).toBe("not available");
  });

  it("formats Oura day labels without timezone drift", () => {
    expect(formatShortDate("2026-07-08")).toBe("Jul 8");
    expect(formatShortDate("bad-date")).toBe("bad-date");
  });
});
