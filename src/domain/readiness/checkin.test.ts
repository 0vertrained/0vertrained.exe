import { describe, expect, it } from "vitest";
import { normalizeDay } from "../day/normalize";
import { CHECKIN_ROWS, describeFlags, isCheckinCounted, readCheckin, selectedOption } from "./checkin";

const row = (field: string) => CHECKIN_ROWS.find((r) => r.field === field)!;

describe("readCheckin", () => {
  it("flags only the rough side of each row", () => {
    const c = readCheckin({ sleepQuality: 3, soreness: 8, stress: 8, energy: 3 });
    expect(c.complete).toBe(true);
    expect(c.flags).toEqual(["slept_poorly", "very_sore", "high_stress", "low_energy"]);
    expect(readCheckin({ sleepQuality: 9, soreness: 2, stress: 2, energy: 9 }).flags).toEqual([]);
  });

  it("uses v1's 1–10 thresholds so typed values read the same as taps", () => {
    expect(readCheckin({ sleepQuality: 4 }).flags).toEqual(["slept_poorly"]);
    expect(readCheckin({ sleepQuality: 5 }).flags).toEqual([]);
    expect(readCheckin({ soreness: 7 }).flags).toEqual(["very_sore"]);
    expect(readCheckin({ soreness: 6 }).flags).toEqual([]);
  });

  it("counts partial answers honestly", () => {
    const c = readCheckin({ energy: 6 });
    expect(c.answered).toBe(1);
    expect(c.complete).toBe(false);
    expect(c.values).toEqual({ energy: 6 });
  });

  it("reads an empty or missing check-in as unanswered, never as zero", () => {
    expect(readCheckin(undefined)).toMatchObject({ answered: 0, flags: [] });
    // v1 stored cleared inputs as "" — they must not read as "slept poorly".
    const fromV1 = normalizeDay({ body: { sleepQuality: "", soreness: "", stress: "", energy: "" } });
    expect(readCheckin(fromV1.checkin)).toMatchObject({ answered: 0, flags: [] });
  });

  it("adds illness as its own flag", () => {
    expect(readCheckin({ illness: true }).flags).toEqual(["illness"]);
  });

  it("counts a check-in once three rows are answered", () => {
    expect(isCheckinCounted({ sleepQuality: 6, soreness: 2 })).toBe(false);
    expect(isCheckinCounted({ sleepQuality: 6, soreness: 2, stress: 5 })).toBe(true);
    expect(isCheckinCounted(undefined)).toBe(false);
  });
});

describe("selectedOption", () => {
  it("snaps typed numbers to the nearest tap", () => {
    expect(selectedOption(row("sleepQuality"), 7)?.text).toBe("fine");
    expect(selectedOption(row("sleepQuality"), 8)?.text).toBe("well");
    expect(selectedOption(row("soreness"), 8)?.text).toBe("very");
    expect(selectedOption(row("energy"), undefined)).toBeNull();
    expect(selectedOption(row("energy"), Number.NaN)).toBeNull();
  });
});

describe("describeFlags", () => {
  it("joins flags in reading order with a capital first letter", () => {
    expect(describeFlags(["slept_poorly", "very_sore"])).toBe("Slept poorly + very sore");
    expect(describeFlags(["high_stress", "low_energy"])).toBe("High stress + low energy");
    expect(describeFlags(["illness"])).toBe("Ill or injured");
    expect(describeFlags([])).toBe("");
  });
});
