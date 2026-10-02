// Which plan applies on a given day, and how a new plan is recorded.
//
// New in v20: v19 overwrote its single week, so a program edit re-judged
// every past day. A revision applies from its effectiveFrom day until the
// next one; days before the first revision use the first (the earliest plan
// is the best guess for history older than any record of it).

import { compareKeys, isDateKey, weekdayName, WEEKDAYS, type DateKey } from "../dates";
import { MAX_REVISIONS, type BuilderInput, type PlannedCardio, type ProgramDay, type ProgramPayloadV2, type ProgramRevision, type ProgramWeek } from "./types";

/** The revision live on `dateKey`. Throws on a payload with no revisions. */
export function revisionAt(payload: ProgramPayloadV2, dateKey: DateKey): ProgramRevision {
  let live: ProgramRevision | undefined;
  let earliest: ProgramRevision | undefined;
  for (const r of payload.revisions) {
    if (!earliest || compareKeys(r.effectiveFrom, earliest.effectiveFrom) < 0) earliest = r;
    const started = compareKeys(r.effectiveFrom, dateKey) <= 0;
    if (started && (!live || compareKeys(r.effectiveFrom, live.effectiveFrom) > 0)) live = r;
  }
  const revision = live ?? earliest;
  if (!revision) throw new RangeError("Program payload has no revisions.");
  return revision;
}

export function plannedDay(payload: ProgramPayloadV2, dateKey: DateKey): ProgramDay {
  return revisionAt(payload, dateKey).week[weekdayName(dateKey)];
}

export interface AppendOptions {
  effectiveFrom: DateKey;
  source: string;
  builderInput?: BuilderInput;
}

/**
 * Record `week` as the plan from `effectiveFrom` on. A revision on the same
 * day is replaced (several edits in one day are one change). Beyond
 * MAX_REVISIONS the oldest are dropped and the earliest kept revision takes
 * over their start date, so days that old are still judged by some plan.
 */
export function appendRevision(payload: ProgramPayloadV2 | null, week: ProgramWeek, options: AppendOptions): ProgramPayloadV2 {
  if (!isDateKey(options.effectiveFrom)) throw new RangeError(`Invalid effectiveFrom: ${String(options.effectiveFrom)}`);
  const revision: ProgramRevision = { effectiveFrom: options.effectiveFrom, source: options.source, week };
  if (options.builderInput) revision.builderInput = options.builderInput;
  const revisions = [...(payload?.revisions ?? []).filter((r) => r.effectiveFrom !== options.effectiveFrom), revision]
    .sort((a, b) => compareKeys(a.effectiveFrom, b.effectiveFrom));
  const overflow = revisions.length - MAX_REVISIONS;
  if (overflow > 0) {
    const oldest = (revisions[0] as ProgramRevision).effectiveFrom;
    revisions.splice(0, overflow);
    revisions[0] = { ...(revisions[0] as ProgramRevision), effectiveFrom: oldest };
  }
  return payload?.legacy ? { v: 2, revisions, legacy: payload.legacy } : { v: 2, revisions };
}

export function trainingDaysPerWeek(week: ProgramWeek): number {
  return WEEKDAYS.filter((d) => !week[d].rest).length;
}

export function plannedSetsForDay(day: ProgramDay): number {
  return day.lifting.reduce((sum, lift) => sum + (Number.isFinite(lift.sets) && lift.sets > 0 ? lift.sets : 0), 0);
}

// Rough paces for turning a planned distance into time when no duration
// was planned (v19 planned miles only): walks ~12 min/km, bikes and rowers
// ~3 min/km, everything else is a run at ~6 min/km.
function minutesPerKm(kind: string): number {
  if (/walk|hike|ruck/i.test(kind)) return 12;
  if (/bike|cycl|ride|spin|row|erg|elliptical/i.test(kind)) return 3;
  return 6;
}

/** Planned cardio time: the stated minutes, else an estimate from the distance. */
export function plannedCardioMinutes(cardio: PlannedCardio | null): number {
  if (!cardio) return 0;
  if (cardio.minutes && cardio.minutes > 0) return cardio.minutes;
  return cardio.km && cardio.km > 0 ? Math.round(cardio.km * minutesPerKm(cardio.kind)) : 0;
}
