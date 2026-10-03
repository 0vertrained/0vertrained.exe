// The landing page's "how do you feel today?" playground runs the real tier
// table: four taps in, the tier and its one-sentence reason out. No clock,
// no storage; the same input always gives the same verdict.
import type { CheckIn } from "../../domain/day/schema";
import { CHECKIN_ROWS, type CheckinField } from "../../domain/readiness/checkin";
import { decideTier, type TierDecision } from "../../domain/readiness/tier";

export type PlaygroundAnswers = Partial<Record<CheckinField, number>>;

/** The middle option of every row: a day that reads FULL. */
export const PLAYGROUND_DEFAULTS: Required<PlaygroundAnswers> = Object.fromEntries(
  CHECKIN_ROWS.map((row) => [row.field, row.options[1]?.value ?? 5]),
) as Required<PlaygroundAnswers>;

export function playgroundDecision(answers: PlaygroundAnswers, illness = false): TierDecision {
  const checkin: CheckIn = { ...answers, ...(illness ? { illness: true } : {}) };
  return decideTier({ isRestDay: false, checkin });
}

/** One plain sentence for the playground's result line. */
export function playgroundSentence(decision: TierDecision): string {
  switch (decision.tier) {
    case "FULL":
      return "Full quest. The whole plan, full XP.";
    case "REDUCED":
      return `${decision.reason}: one set less per lift. Same XP.`;
    case "RECOVER":
      return decision.illness ? "Ill or injured: rest today. Streak protected." : `${decision.reason}: a short walk and mobility. Full XP.`;
    default:
      return "Rest day. Recovery done pays in full.";
  }
}
