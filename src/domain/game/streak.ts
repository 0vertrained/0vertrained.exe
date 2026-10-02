// The streak: consecutive kept days. A rest day keeps itself, a protected
// day (illness, pause) is skipped, an open day (window still running) is
// not judged yet, and a missed day spends a shield before it resets
// anything. Shields are earned one per seven kept days in a row, two at
// most. Nothing else is ever lost.

import type { DateKey } from "../dates";
import { STREAK } from "./config";
import type { DayResult, StreakState } from "./types";

export const emptyStreak = (): StreakState => ({ current: 0, best: 0, shields: 0, shieldUsedOn: [] });

/** Fold day results, oldest first. */
export function foldStreak(results: readonly DayResult[]): StreakState {
  let current = 0;
  let best = 0;
  let shields = 0;
  let run = 0;
  const shieldUsedOn: DateKey[] = [];
  for (const day of results) {
    switch (day.status) {
      case "kept":
        current += 1;
        run += 1;
        if (run % STREAK.shieldEveryKeptDays === 0 && shields < STREAK.maxShields) shields += 1;
        if (current > best) best = current;
        break;
      case "missed":
        if (shields > 0) {
          shields -= 1;
          shieldUsedOn.push(day.dateKey);
        } else {
          current = 0;
          run = 0;
        }
        break;
      default:
        // protected, neutral and open days neither grow nor break the streak
        break;
    }
  }
  return { current, best, shields, shieldUsedOn };
}

/** "Streak reset. Best: 23 days. Today is day 1." — never shaming. */
export function streakNotice(before: StreakState, after: StreakState): string | null {
  if (after.shieldUsedOn.length > before.shieldUsedOn.length) {
    return `[SHIELD] Streak protected. ${after.shields} left.`;
  }
  if (before.current > 0 && after.current === 0) {
    return `Streak reset. Best: ${after.best} days. Today is day 1.`;
  }
  return null;
}
