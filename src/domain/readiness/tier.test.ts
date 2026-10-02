import { describe, expect, it } from "vitest";
import type { CheckIn, Tier } from "../day/schema";
import { CHECKIN_ROWS } from "./checkin";
import { decideTier, moreCautious, roughSignals, TIER_RANK } from "./tier";

/** Every combination of the four tap rows (3⁴ = 81). */
function allTapCombinations(): CheckIn[] {
  const combos: CheckIn[] = [{}];
  for (const row of CHECKIN_ROWS) {
    const next: CheckIn[] = [];
    for (const partial of combos) for (const opt of row.options) next.push({ ...partial, [row.field]: opt.value });
    combos.splice(0, combos.length, ...next);
  }
  return combos;
}

const tierOf = (checkin: CheckIn) => decideTier({ isRestDay: false, checkin }).tier;

describe("tier truth table", () => {
  it("sends 68 of the 81 tap combinations to FULL, 12 to REDUCED and 1 to RECOVER", () => {
    const combos = allTapCombinations();
    expect(combos).toHaveLength(81);
    const counts: Record<string, number> = {};
    for (const c of combos) counts[tierOf(c)] = (counts[tierOf(c)] ?? 0) + 1;
    expect(counts).toEqual({ FULL: 68, REDUCED: 12, RECOVER: 1 });
  });

  it("keeps the honest middle check-in at FULL", () => {
    expect(tierOf({ sleepQuality: 6, soreness: 5, stress: 5, energy: 6 })).toBe("FULL");
  });

  it("one rough answer alone never lowers the day", () => {
    expect(tierOf({ sleepQuality: 3, soreness: 2, stress: 2, energy: 9 })).toBe("FULL");
    expect(tierOf({ sleepQuality: 9, soreness: 8, stress: 2, energy: 9 })).toBe("FULL");
    expect(tierOf({ sleepQuality: 9, soreness: 2, stress: 8, energy: 9 })).toBe("FULL");
  });

  it("two independent rough signals reduce it", () => {
    const d = decideTier({ isRestDay: false, checkin: { sleepQuality: 3, soreness: 8, stress: 2, energy: 9 } });
    expect(d).toMatchObject({ tier: "REDUCED", reason: "Slept poorly + very sore", drivers: ["slept_poorly", "very_sore"] });
  });

  it("treats high stress + low energy as one paired signal", () => {
    expect(tierOf({ sleepQuality: 9, soreness: 2, stress: 8, energy: 3 })).toBe("FULL");
    const d = decideTier({ isRestDay: false, checkin: { sleepQuality: 3, stress: 8, energy: 3 } });
    expect(d.tier).toBe("REDUCED");
    expect(d.reason).toBe("Slept poorly + high stress + low energy");
  });

  it("all four rough answers make it a recovery day", () => {
    const d = decideTier({ isRestDay: false, checkin: { sleepQuality: 3, soreness: 8, stress: 8, energy: 3 } });
    expect(d.tier).toBe("RECOVER");
    expect(d.reason).toBe("Slept poorly + very sore + high stress + low energy");
  });

  it("a great check-in never raises anything (caution-only)", () => {
    const great = { sleepQuality: 9, soreness: 2, stress: 2, energy: 9 };
    expect(decideTier({ isRestDay: false, checkin: great, caps: [{ tier: "REDUCED", reason: "x" }] }).tier).toBe("REDUCED");
  });

  it("no check-in means a FULL day with no reason line", () => {
    expect(decideTier({ isRestDay: false })).toEqual({ tier: "FULL", reason: "", drivers: [], illness: false, capped: false });
  });
});

describe("illness and rest", () => {
  it("illness makes any training day a recovery day, whatever the taps say", () => {
    const d = decideTier({ isRestDay: false, checkin: { sleepQuality: 9, soreness: 2, stress: 2, energy: 9, illness: true } });
    expect(d).toMatchObject({ tier: "RECOVER", reason: "Ill or injured", illness: true });
  });

  it("a scheduled rest day is REST regardless of the check-in", () => {
    expect(decideTier({ isRestDay: true, checkin: { sleepQuality: 9 } })).toMatchObject({ tier: "REST", illness: false });
    expect(decideTier({ isRestDay: true, checkin: { illness: true } })).toMatchObject({ tier: "REST", illness: true, drivers: ["illness"] });
  });
});

describe("caps", () => {
  it("can only lower the tier and name the reason", () => {
    const d = decideTier({ isRestDay: false, checkin: {}, caps: [null, { tier: "REDUCED", reason: "6 training days in a row" }] });
    expect(d).toMatchObject({ tier: "REDUCED", reason: "6 training days in a row", capped: true });
    const already = decideTier({ isRestDay: false, checkin: { sleepQuality: 3, soreness: 8, stress: 8, energy: 3 }, caps: [{ tier: "REDUCED", reason: "x" }] });
    expect(already).toMatchObject({ tier: "RECOVER", capped: false });
    const up = decideTier({ isRestDay: false, checkin: { sleepQuality: 3, soreness: 8 }, caps: [{ tier: "FULL", reason: "x" }] });
    expect(up.tier).toBe("REDUCED");
  });
});

describe("helpers", () => {
  it("orders tiers from hardest to most restful", () => {
    const tiers: Tier[] = ["FULL", "REDUCED", "RECOVER", "REST"];
    expect([...tiers].sort((a, b) => TIER_RANK[b] - TIER_RANK[a])).toEqual(tiers);
    expect(moreCautious("FULL", "REDUCED")).toBe("REDUCED");
    expect(moreCautious("RECOVER", "REDUCED")).toBe("RECOVER");
    expect(moreCautious("FULL", "FULL")).toBe("FULL");
  });

  it("counts stress + energy as a single signal only when both are rough", () => {
    expect(roughSignals(["high_stress"])).toEqual([]);
    expect(roughSignals(["high_stress", "low_energy", "very_sore"])).toEqual([["very_sore"], ["high_stress", "low_energy"]]);
  });
});
