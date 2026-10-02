// Exercise identity across days: which logged exercises count as history for
// a movement. Every training rule (last time, ghosts, progression, records,
// trends) reads history through this one helper.
//
// Ported from the name matching repeated in src/sessionIntelligence.js
// (getLastPerformance), src/setGhosts.js (lastSessionSets),
// src/progressionEngine.js (getExerciseSessions) and src/boxScore.js @ c955d5a.
// Deliberate changes:
//   - One rule instead of four copies. boxScore matched the PLANNED name, so a
//     substituted movement's sets counted toward the planned lift's records.
//   - Library ids win when both sides have one; names are compared
//     case- and whitespace-insensitively.
//   - A substituted log is history for the movement performed, never the one
//     planned. Its `libraryId` names the planned movement (the reader resolves
//     it from the planned name), so it is ignored for a swapped log.
//   - Calendar bounds (`fromKey`/`beforeKey`) instead of "the last N entry
//     keys", which silently shrank the window on athletes with gaps.

import { compareKeys, type DateKey } from "../dates";
import type { DayMap, ExerciseLog, Tier, TrackingMode } from "../day/schema";

/** A movement to look up: a library id when known, always a display name. */
export interface MovementRef {
  name: string;
  libraryId?: string;
}

/** A movement plus the mode its sets are judged in (when a log doesn't say). */
export interface TrackedMovement extends MovementRef {
  trackingMode?: TrackingMode;
}

/** One logged exposure to a movement. */
export interface Exposure {
  dateKey: DateKey;
  /** The log's key in that day's `workout.exercises`. */
  exerciseId: string;
  log: ExerciseLog;
  /** Tier of the quest the day was issued, when there was one. */
  tier?: Tier;
}

export interface HistoryOptions {
  /** Only days strictly before this key. */
  beforeKey?: DateKey;
  /** Only days on or after this key. */
  fromKey?: DateKey;
}

/** "  Seated   Cable Row " → "seated cable row". */
export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** True when the athlete swapped the planned movement for another one. */
export function isSubstituted(log: ExerciseLog): boolean {
  const swapped = log.performedName === undefined ? "" : normalizeName(log.performedName);
  return swapped !== "" && swapped !== normalizeName(log.name);
}

/** Display name of the movement actually performed. */
export function performedName(log: ExerciseLog): string {
  return isSubstituted(log) ? (log.performedName as string).trim() : log.name;
}

/** The movement a log is history for. */
export function performedMovement(log: ExerciseLog): MovementRef {
  if (isSubstituted(log)) return { name: performedName(log) };
  return log.libraryId ? { name: log.name, libraryId: log.libraryId } : { name: log.name };
}

function sameRef(a: MovementRef, b: MovementRef): boolean {
  if (a.libraryId && b.libraryId) return a.libraryId === b.libraryId;
  return normalizeName(a.name) === normalizeName(b.name);
}

/** Does this log record the target movement? Substitution-aware. */
export function sameMovement(log: ExerciseLog, target: MovementRef): boolean {
  return sameRef(performedMovement(log), target);
}

/**
 * Every logged exposure to `target`, oldest first. A day where the movement
 * was logged twice (e.g. two sessions) yields two exposures, in the order the
 * day lists them. Skipped and empty logs are included; callers decide what
 * counts as performed work.
 */
export function exerciseHistory(days: DayMap, target: MovementRef, options: HistoryOptions = {}): Exposure[] {
  const { beforeKey, fromKey } = options;
  const keys = Object.keys(days)
    .filter((k) => (beforeKey === undefined || k < beforeKey) && (fromKey === undefined || k >= fromKey))
    .sort(compareKeys);
  const out: Exposure[] = [];
  for (const dateKey of keys) {
    const day = days[dateKey];
    const tier = day?.quest?.tier;
    for (const [exerciseId, log] of Object.entries(day?.workout?.exercises ?? {})) {
      if (!sameMovement(log, target)) continue;
      out.push(tier ? { dateKey, exerciseId, log, tier } : { dateKey, exerciseId, log });
    }
  }
  return out;
}
