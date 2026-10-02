import { describe, expect, it } from "vitest";
import { countSupplements, summarizeCheckin } from "../checkin";

const supps = ["Creatine", "Omega-3", "Vitamin D", "Magnesium", "Whey"];

describe("countSupplements", () => {
  it("counts only taken supplements from the user's list", () => {
    expect(countSupplements({ Creatine: true, Whey: true, Unknown: true }, supps)).toBe(2);
  });

  it("handles missing supplements object", () => {
    expect(countSupplements(undefined, supps)).toBe(0);
  });
});

describe("summarizeCheckin", () => {
  it("builds a full compact summary", () => {
    const parts = summarizeCheckin({
      body: { weight: "184.5", sleep: "6.6", energy: "6", soreness: "2" },
      workout: { notes: "felt strong" },
      supplements: { Creatine: true, Whey: true },
      supplementNames: supps,
    });
    expect(parts).toEqual(["184.5 lb", "6.6h sleep", "E6/S2", "2/5 supps", "note"]);
  });

  it("omits empty body fields and reports no note", () => {
    const parts = summarizeCheckin({
      body: {},
      workout: {},
      supplements: {},
      supplementNames: supps,
    });
    expect(parts).toEqual(["0/5 supps", "no note"]);
  });

  it("shows partial energy/soreness with a dash", () => {
    const parts = summarizeCheckin({
      body: { energy: "7" },
      supplementNames: supps,
    });
    expect(parts).toContain("E7/S–");
  });

  it("is safe with no arguments", () => {
    expect(() => summarizeCheckin()).not.toThrow();
  });
});
