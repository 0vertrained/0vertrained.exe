// The one answer to "how hard today?". Every input can only make the day
// more cautious; nothing raises it. This replaces v19's six overlapping
// narrators (readiness band, Today call, day modes, recovery verdict,
// adaptive adjustment, block guidance) and their four vocabularies.
//
// Truth table over the four check-in taps (3⁴ = 81 combinations):
//   all four rough answers               → RECOVER   (1 combination)
//   two independent rough signals         → REDUCED   (12 combinations)
//   anything else                         → FULL      (68 combinations)
// where "slept poorly" and "very sore" are one signal each, and
// "high stress" + "low energy" together are one (life-load pairing).
// Illness → RECOVER. A scheduled rest day → REST. Load caps apply last.
//
// v19 derived the tier from an hours-of-sleep recovery score that the tap
// check-in doesn't collect, which sent 38% of tap combinations to RECOVER.

import type { CheckIn, Tier } from "../day/schema";
import { describeFlags, readCheckin, type CheckinFlag } from "./checkin";

/** Higher = harder day. REST is a scheduled day off, the most restful. */
export const TIER_RANK: Record<Tier, number> = { FULL: 3, REDUCED: 2, RECOVER: 1, REST: 0 };

export function moreCautious(a: Tier, b: Tier): Tier {
  return TIER_RANK[a] <= TIER_RANK[b] ? a : b;
}

export interface TierCap {
  tier: Tier;
  reason: string;
}

export interface TierInput {
  isRestDay: boolean;
  checkin?: CheckIn;
  caps?: readonly (TierCap | null | undefined)[];
}

export interface TierDecision {
  tier: Tier;
  /** Plain explanation of what lowered the day; empty for an untouched FULL. */
  reason: string;
  /** Rough check-in answers that drove the tier. */
  drivers: CheckinFlag[];
  illness: boolean;
  /** True when a load cap, not the check-in, set the final tier. */
  capped: boolean;
}

/** Caution units: slept poorly, very sore, and the stress+energy pair count 1 each. */
export function roughSignals(flags: readonly CheckinFlag[]): CheckinFlag[][] {
  const has = (f: CheckinFlag) => flags.includes(f);
  const signals: CheckinFlag[][] = [];
  if (has("slept_poorly")) signals.push(["slept_poorly"]);
  if (has("very_sore")) signals.push(["very_sore"]);
  if (has("high_stress") && has("low_energy")) signals.push(["high_stress", "low_energy"]);
  return signals;
}

function fromCheckin(checkin: CheckIn | undefined): Omit<TierDecision, "capped"> {
  const { flags } = readCheckin(checkin);
  if (flags.includes("illness")) {
    return { tier: "RECOVER", reason: "Ill or injured", drivers: ["illness"], illness: true };
  }
  const rough = flags.filter((f) => f !== "illness");
  if (rough.length === 4) {
    return { tier: "RECOVER", reason: describeFlags(rough), drivers: rough, illness: false };
  }
  const signals = roughSignals(rough);
  if (signals.length >= 2) {
    const drivers = signals.flat();
    return { tier: "REDUCED", reason: describeFlags(drivers), drivers, illness: false };
  }
  return { tier: "FULL", reason: "", drivers: [], illness: false };
}

export function decideTier({ isRestDay, checkin, caps = [] }: TierInput): TierDecision {
  if (isRestDay) {
    const illness = checkin?.illness === true;
    return { tier: "REST", reason: "Rest day", drivers: illness ? ["illness"] : [], illness, capped: false };
  }
  let decision: TierDecision = { ...fromCheckin(checkin), capped: false };
  for (const cap of caps) {
    if (cap && TIER_RANK[cap.tier] < TIER_RANK[decision.tier]) {
      decision = { ...decision, tier: cap.tier, reason: cap.reason, capped: true };
    }
  }
  return decision;
}
