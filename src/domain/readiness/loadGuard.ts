// Load guard: a cap on the next day when recent training ran away from the
// plan. Six training days in a row, or a week at more than 150% of the
// planned volume, caps today at REDUCED. It can only lower the tier.

import { addDays, type DateKey } from "../dates";
import type { DayMap, DayV2, SetLog } from "../day/schema";
import type { TierCap } from "./tier";

export const LOAD_GUARD = Object.freeze({ maxConsecutiveDays: 6, maxVolumeRatio: 1.5 });

export interface LoadGuardInput {
  days: DayMap;
  todayKey: DateKey;
  plannedWeeklySets: number;
  plannedWeeklyCardioMinutes: number;
}

export interface LoadGuardResult {
  cap: TierCap | null;
  consecutiveTrainingDays: number;
  setsLast7: number;
  cardioMinutesLast7: number;
}

// Coarse "work happened" test: the guard counts volume, it doesn't judge
// whether a set met its tracking mode's rules.
function performed(set: SetLog): boolean {
  if (set.done !== true) return false;
  return (set.reps ?? 0) > 0 || (set.seconds ?? 0) > 0 || (set.distanceM ?? 0) > 0;
}

function setsDone(day: DayV2 | undefined): number {
  if (!day) return 0;
  return Object.values(day.workout.exercises).reduce((n, log) => n + log.sets.filter(performed).length, 0);
}

function cardioMinutes(day: DayV2 | undefined): number {
  if (!day) return 0;
  return day.workout.cardio.reduce((n, c) => n + (c.minutes ?? 0), 0);
}

export function didTrain(day: DayV2 | undefined): boolean {
  if (!day) return false;
  return setsDone(day) > 0 || day.workout.cardio.some((c) => (c.minutes ?? 0) > 0 || (c.km ?? 0) > 0);
}

export function loadGuard({ days, todayKey, plannedWeeklySets, plannedWeeklyCardioMinutes }: LoadGuardInput): LoadGuardResult {
  let consecutive = 0;
  for (let i = 1; i <= 30 && didTrain(days[addDays(todayKey, -i)]); i += 1) consecutive += 1;

  let sets = 0;
  let minutes = 0;
  for (let i = 1; i <= 7; i += 1) {
    const day = days[addDays(todayKey, -i)];
    sets += setsDone(day);
    minutes += cardioMinutes(day);
  }

  let cap: TierCap | null = null;
  if (consecutive >= LOAD_GUARD.maxConsecutiveDays) {
    cap = { tier: "REDUCED", reason: `${consecutive} training days in a row` };
  } else {
    const over = (done: number, planned: number) => planned > 0 && done > planned * LOAD_GUARD.maxVolumeRatio;
    const ratio = Math.max(
      plannedWeeklySets > 0 ? sets / plannedWeeklySets : 0,
      plannedWeeklyCardioMinutes > 0 ? minutes / plannedWeeklyCardioMinutes : 0,
    );
    if (over(sets, plannedWeeklySets) || over(minutes, plannedWeeklyCardioMinutes)) {
      cap = { tier: "REDUCED", reason: `Last 7 days ran ${Math.round(ratio * 100)}% of your plan` };
    }
  }
  return { cap, consecutiveTrainingDays: consecutive, setsLast7: sets, cardioMinutesLast7: minutes };
}
