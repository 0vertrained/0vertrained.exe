// The session summary (the Box Score): what one day's training amounted to,
// told honestly from the logged data.
//
// Headline, in strict priority: records → a lift moving up → a tonnage jump
// vs the last same-weekday session → first session on record → "Session
// banked." Honesty rules: no comparison without a basis (no prior session →
// no delta, "the baseline is set"); a first performance is a baseline, never
// a record; a day with nothing banked says so.
//
// Ported from src/boxScore.js (+ src/SessionComplete.jsx semantics) @ c955d5a.
// Deliberate changes:
//   - Records come from detectRecords (substitution-aware, pain-free, with
//     thresholds); v19 judged PRs by planned name at +0.5 lb.
//   - Tonnage counts banked, valid, non-extra loaded sets in kg (v19 counted
//     any `done` set, valid or not, and rounded to whole pounds).
//   - Sets done are counted against the day's quest; extra and unplanned work
//     is reported separately, never as quest progress.
//   - Duration is first → last set completion, and a day with nothing banked
//     no longer reads "Session banked.".
// Cut: sets banked per muscle (v20 has no weekly volume landmarks).

import { weekdayIndex, type DateKey } from "../dates";
import type { DayV2, ExerciseLog, SkipReason, TrackingMode } from "../day/schema";
import { exerciseHistory, performedMovement, performedName } from "./history";
import { bestE1rm, detectRecords, DEFAULT_RECORD_THRESHOLDS, type DetectRecordsInput, type RecordCandidate } from "./records";
import { completedPlannedSets, isCompletedSet, modeOf } from "./sets";

export interface SessionSummaryInput extends DetectRecordsInput {
  /** The program day's name for the copy ("Push"); "session" when absent. */
  dayName?: string;
}

export interface StrengthArrow {
  exerciseId: string;
  name: string;
  /** Today's best e1RM. */
  e1rmKg: number;
  /** vs the latest prior exposure, beyond ± minKgDelta. */
  dir: "up" | "down" | "flat";
}

export interface SessionSummary {
  /** Completed planned sets (all non-extra performed sets when the day had no quest). */
  setsDone: number;
  /** Performed sets beyond the plan: extra sets and unplanned exercises. */
  extraSetsDone: number;
  plannedSets: number | null;
  tonnageKg: number;
  tonnageCompare: { priorDateKey: DateKey; priorTonnageKg: number; deltaPct: number } | null;
  /** First → last banked set; null with fewer than two timestamps. */
  durationMinutes: number | null;
  records: RecordCandidate[];
  arrows: StrengthArrow[];
  skips: { exerciseId: string; name: string; reason: SkipReason }[];
  headline: string;
  /** How the comparisons were made, shown under the score. */
  method: string;
}

type MetaFor = DetectRecordsInput["metaFor"];

/** Each log with the mode its sets are judged in (the plan's, else the catalog's). */
function logsWithMode(day: DayV2, metaFor: MetaFor): [string, ExerciseLog, TrackingMode][] {
  const plannedMode = new Map((day.quest?.planned.exercises ?? []).map((p) => [p.id, p.trackingMode]));
  return Object.entries(day.workout.exercises).map(([id, log]) => [id, log, modeOf(log, plannedMode.get(id) ?? metaFor(log).trackingMode)]);
}

/** kg moved: weight × reps over banked, valid, non-extra loaded sets. */
export function tonnageKg(day: DayV2, metaFor: MetaFor): number {
  let total = 0;
  for (const [, log, mode] of logsWithMode(day, metaFor)) {
    if (mode !== "loaded_reps") continue;
    for (const s of log.sets) if (!s.extra && isCompletedSet(s, mode)) total += (s.weightKg ?? 0) * (s.reps ?? 0);
  }
  return total;
}

function durationMinutes(day: DayV2): number | null {
  const times = Object.values(day.workout.exercises)
    .flatMap((log) => log.sets)
    .filter((s) => s.done && s.completedAt)
    .map((s) => Date.parse(s.completedAt as string))
    .filter(Number.isFinite);
  return times.length < 2 ? null : Math.round((Math.max(...times) - Math.min(...times)) / 60_000);
}

export function summarizeSession(input: SessionSummaryInput): SessionSummary {
  const { dateKey, day, history, metaFor, dayName } = input;
  const minKgDelta = input.thresholds?.minKgDelta ?? DEFAULT_RECORD_THRESHOLDS.minKgDelta;
  const logs = logsWithMode(day, metaFor);
  const planned = day.quest?.planned;

  const performed = logs.reduce((n, [, log, mode]) => n + log.sets.filter((s) => isCompletedSet(s, mode)).length, 0);
  const setsDone = planned
    ? planned.exercises.reduce((n, p) => n + completedPlannedSets(day.workout.exercises[p.id], p.sets, p.trackingMode), 0)
    : logs.reduce((n, [, log, mode]) => n + log.sets.filter((s) => !s.extra && isCompletedSet(s, mode)).length, 0);

  // Comparison basis: the latest prior same-weekday day with any tonnage.
  const tonnage = tonnageKg(day, metaFor);
  const priorDateKey = Object.keys(history)
    .filter((k) => k < dateKey && weekdayIndex(k) === weekdayIndex(dateKey) && tonnageKg(history[k] as DayV2, metaFor) > 0)
    .sort()
    .at(-1);
  const priorTonnageKg = priorDateKey ? tonnageKg(history[priorDateKey] as DayV2, metaFor) : 0;
  const tonnageCompare = priorDateKey ? { priorDateKey, priorTonnageKg, deltaPct: Math.round(((tonnage - priorTonnageKg) / priorTonnageKg) * 100) } : null;

  const records = detectRecords(input);
  const arrows: StrengthArrow[] = [];
  for (const [exerciseId, log, mode] of logs) {
    const now = bestE1rm(log, mode);
    if (now === null) continue;
    const prior = exerciseHistory(history, performedMovement(log), { beforeKey: dateKey })
      .map((e) => bestE1rm(e.log, modeOf(e.log, mode)))
      .filter((v): v is number => v !== null);
    const prev = prior.at(-1);
    if (prev === undefined) continue;
    const dir = now > prev + minKgDelta ? "up" : now < prev - minKgDelta ? "down" : "flat";
    arrows.push({ exerciseId, name: performedName(log), e1rmKg: now, dir });
  }

  const skips = logs.filter(([, log]) => log.skipped).map(([exerciseId, log]) => ({ exerciseId, name: performedName(log), reason: log.skipped as SkipReason }));
  const won = records.filter((r) => r.isRecord);
  const up = arrows.find((a) => a.dir === "up");
  const label = dayName ?? "session";
  let headline: string;
  if (performed === 0) headline = "Nothing banked yet.";
  else if (won.length === 1) headline = `Record: ${(won[0] as RecordCandidate).name}.`;
  else if (won.length > 1) headline = `${won.length} records today.`;
  else if (up) headline = `Strength moving — ${up.name} ↗.`;
  else if (tonnageCompare && tonnageCompare.deltaPct >= 10) headline = `Biggest ${label} in a while — up ${tonnageCompare.deltaPct}%.`;
  else if (!tonnageCompare && tonnage > 0) headline = `First ${label} on record — the baseline is set.`;
  else headline = "Session banked.";

  const method = "e1RM from straight, pain-free sets";
  return {
    setsDone,
    extraSetsDone: Math.max(0, performed - setsDone),
    plannedSets: planned ? planned.plannedSets : null,
    tonnageKg: tonnage,
    tonnageCompare,
    durationMinutes: durationMinutes(day),
    records,
    arrows,
    skips,
    headline,
    method: tonnageCompare ? `vs your last ${dayName ?? "same-weekday"} session · ${method}` : method,
  };
}
