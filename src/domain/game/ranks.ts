// Ranks E → S: earned in order from the level, qualifying weeks, kept days,
// the stats and a passed Rank Trial, and never lost. The displayed rank is
// the higher of what today's numbers derive and the stored high-water mark.

import { RANK_ORDER, RANKS } from "./config";
import type { GameHigh, NextRank, Rank, RankSpec, Requirement } from "./types";

/** The stat values a rank reads; a full Stats satisfies it. */
export interface RankStats {
  str: { value: number };
  end: { value: number };
  vit: { value: number };
}

export interface RankInput {
  level: number;
  qualifyingWeeks: number;
  keptDays: number;
  stats: RankStats;
  trialsPassed: readonly { rank: Rank }[];
}

export function rankIndex(rank: Rank): number {
  return RANK_ORDER.indexOf(rank);
}

export function rankSpec(rank: Rank): RankSpec {
  return RANKS.find((s) => s.rank === rank) as RankSpec;
}

export function rankTitle(rank: Rank): string {
  return rankSpec(rank).title;
}

const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;

const row = (key: Requirement["key"], label: string, target: number, current: number): Requirement =>
  ({ key, label, target, current, met: current >= target });

/** The checklist for `spec`. Requirements with a zero target are left out. */
export function requirementsFor(spec: RankSpec, input: RankInput): Requirement[] {
  const rows: Requirement[] = [];
  const kept = spec.minKeptDays ?? 0;
  if (spec.minLevel > 0) rows.push(row("level", `Level ${spec.minLevel}`, spec.minLevel, input.level));
  if (spec.minQualifyingWeeks > 0) rows.push(row("weeks", plural(spec.minQualifyingWeeks, "qualifying week"), spec.minQualifyingWeeks, input.qualifyingWeeks));
  if (kept > 0) rows.push(row("keptDays", plural(kept, "kept day"), kept, input.keptDays));
  if (spec.minStrOrEnd > 0) rows.push(row("strOrEnd", `STR or END ${spec.minStrOrEnd}`, spec.minStrOrEnd, Math.max(input.stats.str.value, input.stats.end.value)));
  if (spec.minVit > 0) rows.push(row("vit", `VIT ${spec.minVit}`, spec.minVit, input.stats.vit.value));
  if (spec.trial) rows.push(row("trial", "Rank Trial", 1, input.trialsPassed.some((t) => t.rank === spec.rank) ? 1 : 0));
  return rows;
}

const meets = (spec: RankSpec, input: RankInput): boolean => requirementsFor(spec, input).every((r) => r.met);

/** The highest rank whose requirements, and every lower rank's, are met. E is the floor. */
export function deriveRank(input: RankInput): Rank {
  let rank: Rank = "E";
  for (const next of RANK_ORDER.slice(1)) {
    if (!meets(rankSpec(next), input)) break;
    rank = next;
  }
  return rank;
}

/** The higher of the derived rank and the stored one: a rank is never taken away. */
export function displayedRank(derived: Rank, high?: Partial<GameHigh>): Rank {
  const held = high?.rank;
  return held !== undefined && rankIndex(held) > rankIndex(derived) ? held : derived;
}

/** The checklist for the rank after `current`; empty at S. */
export function nextRank(current: Rank, input: RankInput): NextRank {
  const next = RANK_ORDER[rankIndex(current) + 1];
  if (next === undefined) return { rank: null, title: null, requirements: [], trialAvailable: false };
  const spec = rankSpec(next);
  const requirements = requirementsFor(spec, input);
  const trial = requirements.find((r) => r.key === "trial");
  const trialAvailable = trial !== undefined && !trial.met && requirements.every((r) => r.key === "trial" || r.met);
  return { rank: next, title: spec.title, requirements, trialAvailable };
}
