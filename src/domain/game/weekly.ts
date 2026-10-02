// The Weekly Quest: two objectives over the Monday–Sunday local week,
// derived from the week's day results and the plan in force on its Monday.
// Meeting the training objective makes a "qualifying week", which rank
// requirements count. XP is awarded once the week has closed.

import { addDays, compareKeys, dateRange, type DateKey } from "../dates";
import { XP } from "./config";
import type { DayResult, WeeklyObjective, WeeklyResult } from "./types";

export const CHECKIN_DAYS_TARGET = 5;

export function trainingTarget(plannedTrainingDays: number): number {
  return Math.max(1, plannedTrainingDays - 1);
}

export interface WeekInput {
  weekStart: DateKey;
  /** Planned training days in the week's plan, counting only days on or after the game start. */
  plannedTrainingDays: number;
  results: Record<DateKey, DayResult>;
  todayKey: DateKey;
}

export function scoreWeek({ weekStart, plannedTrainingDays, results, todayKey }: WeekInput): WeeklyResult {
  const days = dateRange(weekStart, addDays(weekStart, 6)).map((k) => results[k]).filter((r): r is DayResult => Boolean(r));
  const cleared = days.filter((r) => r.isTrainingDay && (r.tier === "FULL" || r.tier === "REDUCED") && r.cleared && !r.legacy).length;
  const checkins = days.filter((r) => r.checkinCounted).length;
  const target = trainingTarget(plannedTrainingDays);
  const objectives: WeeklyObjective[] = [
    { key: "training", label: `Clear ${target} training ${target === 1 ? "quest" : "quests"}`, done: cleared, target, met: cleared >= target },
    { key: "checkins", label: `Check in on ${CHECKIN_DAYS_TARGET} days`, done: checkins, target: CHECKIN_DAYS_TARGET, met: checkins >= CHECKIN_DAYS_TARGET },
  ];
  const closed = compareKeys(addDays(weekStart, 7), todayKey) <= 0;
  const met = objectives.filter((o) => o.met).length;
  const xp = closed ? met * XP.weeklyObjective + (met === objectives.length ? XP.weeklyBothBonus : 0) : 0;
  return { weekStart, closed, objectives, qualifying: closed && (objectives[0] as WeeklyObjective).met, xp };
}
