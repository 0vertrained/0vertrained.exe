// A scripted athlete for progress tests: N weeks on a program, full sessions
// with progressive loads, daily check-ins, rest objectives done, and named
// events (illness, a missed day, a reduced day) on given dates.
import { addDays, dateRange, type DateKey } from "../domain/dates";
import type { CheckIn, DayMap, DayV2, ExerciseLog } from "../domain/day/schema";
import { issueDailyQuest } from "../domain/game/quest";
import type { GameSettings } from "../domain/game/types";
import { plannedCardioMinutes, plannedDay, plannedSetsForDay, trainingDaysPerWeek, revisionAt } from "../domain/program/revisions";
import type { ProgramPayloadV2 } from "../domain/program/types";
import { CHECKIN_FINE, CHECKIN_ILL, CHECKIN_ROUGH, day, doneSets } from "./gameFixtures";

export interface ScenarioOptions {
  program: ProgramPayloadV2;
  startedOn: DateKey;
  todayKey: DateKey;
  /** Starting load per exercise id (kg); bodyweight moves use reps instead. */
  startKg?: Record<string, number>;
  /** Load added per completed week (loaded moves). */
  weeklyStepKg?: number;
  /** Reps added per completed week (bodyweight moves). */
  weeklyStepReps?: number;
  illnessOn?: DateKey[];
  missedOn?: DateKey[];
  reducedOn?: DateKey[];
  /** Skip the check-in on these days. */
  noCheckinOn?: DateKey[];
  /** Leave today unlogged (quest issued, nothing done). */
  todayUntouched?: boolean;
  restRecoveryDone?: boolean;
}

export interface Scenario {
  days: DayMap;
  settings: GameSettings;
  program: ProgramPayloadV2;
  todayKey: DateKey;
}

const DEFAULT_KG = 60;

export function scenario(o: ScenarioOptions): Scenario {
  const days: DayMap = {};
  const has = (list: DateKey[] | undefined, k: DateKey) => (list ?? []).includes(k);
  for (const key of dateRange(o.startedOn, o.todayKey)) {
    if (has(o.missedOn, key)) continue;
    const planned = plannedDay(o.program, key);
    const week = revisionAt(o.program, key).week;
    const weekIndex = Math.floor((Date.parse(key) - Date.parse(o.startedOn)) / 604_800_000);
    const checkin: CheckIn | undefined = has(o.noCheckinOn, key) ? undefined : has(o.illnessOn, key) ? CHECKIN_ILL : has(o.reducedOn, key) ? CHECKIN_ROUGH : CHECKIN_FINE;
    const quest = issueDailyQuest({
      dateKey: key, programDay: planned, plannedWeeklySets: 0, plannedWeeklyCardioMinutes: 0, checkin, days,
      issuedAt: `${key}T06:00:00.000Z`,
    });
    void trainingDaysPerWeek(week);
    const untouched = o.todayUntouched && key === o.todayKey;
    const exercises: [string, ExerciseLog][] = [];
    const cardio: { minutes: number }[] = [];
    if (!untouched && (quest.tier === "FULL" || quest.tier === "REDUCED")) {
      for (const e of quest.planned.exercises) {
        const bodyweight = e.trackingMode === "bodyweight_reps";
        const base = o.startKg?.[e.id] ?? DEFAULT_KG;
        const kg = bodyweight ? null : base + weekIndex * (o.weeklyStepKg ?? 2.5);
        const reps = bodyweight ? 8 + weekIndex * (o.weeklyStepReps ?? 1) : 5;
        exercises.push([e.id, { name: e.name, ...(e.libraryId ? { libraryId: e.libraryId } : {}), trackingMode: e.trackingMode, sets: doneSets(e.sets, { weightKg: kg, reps, completedAt: `${key}T17:00:00.000Z` }) }]);
      }
      const minutes = quest.planned.cardioMinutes ?? plannedCardioMinutes(planned.cardio);
      if (quest.planned.cardioMinutes) cardio.push({ minutes });
    }
    const recoveryDone = !untouched && (o.restRecoveryDone ?? true) && (quest.tier === "REST" || quest.tier === "RECOVER");
    const d: DayV2 = day({ exercises, ...(checkin ? { checkin } : {}), cardio, quest: { ...quest, ...(recoveryDone ? { recoveryDone: true } : {}) } });
    days[key] = d;
    void plannedSetsForDay(planned);
  }
  return { days, settings: { startedOn: o.startedOn, bodyweightKg: 80 }, program: o.program, todayKey: o.todayKey };
}

/** Monday-aligned N-week run ending the Sunday before `todayKey`'s week … or simply N×7 days ending today. */
export function weeksBefore(todayKey: DateKey, weeks: number): DateKey {
  return addDays(todayKey, -(weeks * 7 - 1));
}
