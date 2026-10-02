// Display summaries of a weekly plan: a one-line label per day and the
// week's totals (training/rest days, working sets, cardio time and distance).
//
// Ported from src/programSummary.js (summarizeProgramDay) and src/moreHub.js
// (summarizeProgramForHub) @ c955d5a, merged. Deliberate changes:
//   - Distances are formatted in the athlete's units ("2.4 km", "1.5 mi");
//     v19 always printed "1.5mi".
//   - Rest comes from the day's `rest` flag, and a rest day's optional walk
//     is not planned training: it counts toward neither cardio days nor the
//     weekly totals (the load guard compares logged work to these totals).
//   - Adds working sets, cardio minutes (estimated from distance when only
//     distance was planned) and km per week.

import { WEEKDAYS, type Weekday } from "../dates";
import { formatDistance, round1, type UnitSystem } from "../units";
import { plannedCardioMinutes, plannedSetsForDay } from "./revisions";
import type { ProgramDay, ProgramWeek } from "./types";

export interface DaySummary {
  label: string;
  rest: boolean;
  liftCount: number;
  sets: number;
  cardioLabel: string | null;
}

export interface WeekSummary {
  trainingDays: number;
  restDays: number;
  /** Lifting and cardio days overlap: an intervals + core day is both. */
  liftingDays: number;
  cardioDays: number;
  plannedSets: number;
  cardioMinutes: number;
  cardioKm: number;
  hasProgram: boolean;
  line: string;
  days: (DaySummary & { weekday: Weekday })[];
}

const NO_PROGRAM = "No program yet — generate one to get started";
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

export function summarizeDay(day: ProgramDay | null | undefined, units: UnitSystem = "metric"): DaySummary {
  if (!day) return { label: "Rest / mobility", rest: true, liftCount: 0, sets: 0, cardioLabel: null };
  const liftCount = day.lifting.length;
  const cardio = day.cardio;
  const title = day.title.trim();
  let cardioLabel: string | null = null;
  let titleNamesCardio = true;
  if (cardio) {
    const parts = [cardio.kind.trim()];
    if (cardio.km && cardio.km > 0) parts.push(formatDistance(cardio.km, units));
    if (cardio.minutes && cardio.minutes > 0) parts.push(`${cardio.minutes} min`);
    if (cardio.effort?.trim()) parts.push(cardio.effort.trim());
    cardioLabel = parts.filter(Boolean).join(" · ") || "Cardio";
    titleNamesCardio = title.toLowerCase().includes(cardio.kind.trim().toLowerCase());
  }
  let label: string;
  if (title && cardioLabel && !titleNamesCardio) label = `${title} + ${cardioLabel}`;
  else if (title) label = title;
  else if (cardioLabel && liftCount > 0) label = `${plural(liftCount, "lift")} + ${cardioLabel}`;
  else if (cardioLabel) label = cardioLabel;
  else if (liftCount > 0) label = plural(liftCount, "lift");
  else label = "Rest / mobility";
  return { label, rest: day.rest, liftCount, sets: plannedSetsForDay(day), cardioLabel };
}

export function summarizeWeek(week: ProgramWeek | null | undefined, units: UnitSystem = "metric"): WeekSummary {
  const summary: WeekSummary = {
    trainingDays: 0, restDays: 0, liftingDays: 0, cardioDays: 0,
    plannedSets: 0, cardioMinutes: 0, cardioKm: 0, hasProgram: false, line: NO_PROGRAM, days: [],
  };
  for (const weekday of WEEKDAYS) {
    const day = week?.[weekday];
    summary.days.push({ weekday, ...summarizeDay(day, units) });
    if (!day || day.rest) {
      summary.restDays += 1;
      continue;
    }
    summary.trainingDays += 1;
    if (day.lifting.length > 0) summary.liftingDays += 1;
    if (day.cardio) summary.cardioDays += 1;
    summary.plannedSets += plannedSetsForDay(day);
    summary.cardioMinutes += plannedCardioMinutes(day.cardio);
    summary.cardioKm += day.cardio?.km ?? 0;
  }
  summary.cardioKm = round1(summary.cardioKm);
  summary.hasProgram = summary.trainingDays > 0;
  if (summary.hasProgram) summary.line = `${summary.liftingDays} lifting · ${summary.cardioDays} cardio · ${summary.restDays} rest`;
  return summary;
}
