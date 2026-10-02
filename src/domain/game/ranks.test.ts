import { describe, expect, it } from "vitest";
import { RANK_ORDER, RANKS } from "./config";
import { deriveRank, displayedRank, nextRank, rankIndex, rankSpec, rankTitle, requirementsFor, type RankInput } from "./ranks";
import type { Rank, RankSpec } from "./types";

const statsOf = (str: number, end: number, vit: number) => ({ str: { value: str }, end: { value: end }, vit: { value: vit } });

function input(partial: Partial<RankInput> = {}): RankInput {
  return { level: 1, qualifyingWeeks: 0, keptDays: 0, stats: statsOf(1, 1, 25), trialsPassed: [], ...partial };
}

const passed = (...ranks: Rank[]) => ranks.map((rank) => ({ rank }));

/** Everything a Veteran needs. */
const VETERAN = input({ level: 22, qualifyingWeeks: 12, keptDays: 7, stats: statsOf(40, 10, 50), trialsPassed: passed("C", "B") });

describe("rank lookups", () => {
  it("orders ranks and names them", () => {
    expect(RANK_ORDER.map(rankIndex)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(RANK_ORDER.map(rankTitle)).toEqual(["Recruit", "Initiate", "Contender", "Veteran", "Elite", "Paragon"]);
    expect(rankSpec("B")).toBe(RANKS[3]);
  });
});

describe("deriveRank", () => {
  it("starts every athlete at E", () => {
    expect(deriveRank(input())).toBe("E");
    expect(deriveRank(input({ level: 0 }))).toBe("E");
  });

  it("reaches D on level and kept days alone", () => {
    expect(deriveRank(input({ level: 5, keptDays: 7 }))).toBe("D");
    expect(deriveRank(input({ level: 5, keptDays: 6 }))).toBe("E");
    expect(deriveRank(input({ level: 4, keptDays: 7 }))).toBe("E");
  });

  it("needs a passed trial for C and reads the better of STR and END", () => {
    const contender = input({ level: 12, qualifyingWeeks: 4, keptDays: 7, stats: statsOf(25, 1, 1) });
    expect(deriveRank(contender)).toBe("D");
    expect(deriveRank({ ...contender, trialsPassed: passed("C") })).toBe("C");
    expect(deriveRank({ ...contender, stats: statsOf(1, 25, 1), trialsPassed: passed("C") })).toBe("C");
    expect(deriveRank({ ...contender, stats: statsOf(24, 24, 1), trialsPassed: passed("C") })).toBe("D");
    expect(deriveRank({ ...contender, trialsPassed: passed("B") })).toBe("D");
  });

  it("is earned in order: a higher rank's numbers never skip a lower rank's requirement", () => {
    const strong = input({ level: 50, qualifyingWeeks: 60, keptDays: 0, stats: statsOf(100, 100, 100), trialsPassed: passed("C", "B", "A", "S") });
    expect(deriveRank(strong)).toBe("E");
    expect(deriveRank({ ...strong, keptDays: 7 })).toBe("S");
    expect(deriveRank({ ...strong, keptDays: 7, trialsPassed: passed("C", "A", "S") })).toBe("C");
  });

  it("adds VIT from B upward", () => {
    expect(deriveRank(VETERAN)).toBe("B");
    expect(deriveRank({ ...VETERAN, stats: statsOf(40, 10, 49) })).toBe("C");
    expect(deriveRank({ ...VETERAN, level: 35, qualifyingWeeks: 30, stats: statsOf(55, 1, 60), trialsPassed: passed("C", "B", "A") })).toBe("A");
  });
});

describe("displayedRank", () => {
  it("is the higher of the derived rank and the stored one, never a demotion", () => {
    expect(displayedRank("D", { rank: "B" })).toBe("B");
    expect(displayedRank("B", { rank: "D" })).toBe("B");
    expect(displayedRank("C", { rank: "C" })).toBe("C");
    expect(displayedRank("C")).toBe("C");
    expect(displayedRank("C", {})).toBe("C");
  });
});

describe("nextRank", () => {
  it("lists what D asks of a Recruit", () => {
    const next = nextRank("E", input({ level: 3, keptDays: 7 }));
    expect(next.rank).toBe("D");
    expect(next.title).toBe("Initiate");
    expect(next.requirements).toEqual([
      { key: "level", label: "Level 5", target: 5, current: 3, met: false },
      { key: "keptDays", label: "7 kept days", target: 7, current: 7, met: true },
    ]);
    expect(next.trialAvailable).toBe(false);
  });

  it("offers the trial once everything but the trial is met", () => {
    const ready = input({ level: 12, qualifyingWeeks: 4, keptDays: 7, stats: statsOf(10, 25, 1) });
    const next = nextRank("D", ready);
    expect(next.requirements.map((r) => r.label)).toEqual(["Level 12", "4 qualifying weeks", "STR or END 25", "Rank Trial"]);
    expect(next.requirements.map((r) => r.met)).toEqual([true, true, true, false]);
    expect(next.requirements[2]).toMatchObject({ current: 25, target: 25 });
    expect(next.trialAvailable).toBe(true);
    expect(nextRank("D", { ...ready, qualifyingWeeks: 3 }).trialAvailable).toBe(false);
    const done = nextRank("D", { ...ready, trialsPassed: passed("C") });
    expect(done.trialAvailable).toBe(false);
    expect(done.requirements[3]).toEqual({ key: "trial", label: "Rank Trial", target: 1, current: 1, met: true });
  });

  it("lists the full checklist for S and nothing beyond it", () => {
    const next = nextRank("A", VETERAN);
    expect(next.rank).toBe("S");
    expect(next.requirements.map((r) => r.label)).toEqual(["Level 50", "60 qualifying weeks", "STR or END 70", "VIT 70", "Rank Trial"]);
    expect(next.requirements.map((r) => r.current)).toEqual([22, 12, 40, 50, 0]);
    expect(nextRank("S", VETERAN)).toEqual({ rank: null, title: null, requirements: [], trialAvailable: false });
  });
});

describe("requirementsFor", () => {
  it("omits zero targets and uses singular labels", () => {
    expect(requirementsFor(rankSpec("E"), input()).map((r) => r.label)).toEqual(["Level 1"]);
    const custom: RankSpec = { rank: "D", title: "x", minLevel: 0, minQualifyingWeeks: 1, minKeptDays: 1, minStrOrEnd: 0, minVit: 0, trial: false };
    expect(requirementsFor(custom, input()).map((r) => r.label)).toEqual(["1 qualifying week", "1 kept day"]);
  });
});
