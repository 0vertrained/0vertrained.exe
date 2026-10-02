import { describe, expect, it } from "vitest";
import {
  addDays,
  compareKeys,
  dateKeyOfInstant,
  dateRange,
  diffDays,
  endOfDayMs,
  isDateKey,
  weekStart,
  weekdayIndex,
  weekdayName,
} from "./dates";

describe("date keys", () => {
  it("validates real calendar dates only", () => {
    expect(isDateKey("2026-10-02")).toBe(true);
    expect(isDateKey("2024-02-29")).toBe(true);
    expect(isDateKey("2026-02-29")).toBe(false);
    expect(isDateKey("2026-13-01")).toBe(false);
    expect(isDateKey("2026-1-01")).toBe(false);
    expect(isDateKey(20261002)).toBe(false);
  });

  it("adds days across month, year and DST boundaries", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09"); // US DST start
    expect(addDays("2026-11-01", -1)).toBe("2026-10-31"); // US DST end
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("diffs whole days in both directions", () => {
    expect(diffDays("2026-10-01", "2026-10-08")).toBe(7);
    expect(diffDays("2026-10-08", "2026-10-01")).toBe(-7);
    expect(diffDays("2026-03-01", "2026-04-01")).toBe(31);
  });

  it("uses Monday-first weeks", () => {
    expect(weekdayName("2026-10-05")).toBe("Monday");
    expect(weekdayName("2026-10-04")).toBe("Sunday");
    expect(weekdayIndex("2026-10-04")).toBe(6);
    expect(weekStart("2026-10-04")).toBe("2026-09-28");
    expect(weekStart("2026-10-05")).toBe("2026-10-05");
  });

  it("builds inclusive ranges", () => {
    expect(dateRange("2026-10-01", "2026-10-03")).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(dateRange("2026-10-03", "2026-10-01")).toEqual([]);
  });

  it("compares keys", () => {
    expect(compareKeys("2026-10-01", "2026-10-02")).toBe(-1);
    expect(compareKeys("2026-10-02", "2026-10-01")).toBe(1);
    expect(compareKeys("2026-10-02", "2026-10-02")).toBe(0);
  });

  it("maps an instant to the local calendar day for an offset", () => {
    expect(dateKeyOfInstant("2026-10-02T03:00:00Z", -300)).toBe("2026-10-01");
    expect(dateKeyOfInstant("2026-10-02T03:00:00Z", 0)).toBe("2026-10-02");
    expect(dateKeyOfInstant("not a date")).toBeNull();
  });

  it("gives the end of a local day as an instant", () => {
    expect(new Date(endOfDayMs("2026-10-02", 0)).toISOString()).toBe("2026-10-03T00:00:00.000Z");
    expect(new Date(endOfDayMs("2026-10-02", -300)).toISOString()).toBe("2026-10-03T05:00:00.000Z");
  });

  it("rejects invalid keys in arithmetic", () => {
    expect(() => addDays("2026-02-30", 1)).toThrow(RangeError);
  });
});
