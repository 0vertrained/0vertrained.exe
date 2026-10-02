// Set logging rules shared by every surface that logs or judges a set:
// initialization, validation per tracking mode, completion and resume.
//
// Ported from src/workoutLogging.js @ c955d5a. Deliberate changes:
//   - Typed v2 sets (numbers in kg/m/s, not strings in lb/yd). Messages are
//     unit-free.
//   - The tracking mode is passed in (from ExerciseMeta or the log) instead of
//     being re-guessed from the name by a second, narrower regex.
//   - reconcileSets keeps sets logged beyond the plan (v19 truncated them,
//     silently deleting work after a program edit) and flags them `extra`.
//     Extra sets never count toward completion.
//   - Negative values never validate (v19 accepted "-5" as an added load).
//   - Bodyweight sets describe as "BW × 8" / "+25 lb × 8"; RIR is gone.
//   - Planned exercises are found by id in the v2 `workout.exercises` map.
// Cut: defaultSetForExercise (one blank shape fits all modes in v2) and
// defaultWeightIncrement (replaced by loadStepKg in exercise.ts).

import type { ExerciseLog, PlannedExercise, SetLog, TrackingMode, WorkoutLog } from "../day/schema";
import { guessTrackingMode } from "../exercise";
import { mToYd, round1, toDisplayWeight, weightUnit, ydToM, type UnitSystem } from "../units";
import { performedName } from "./history";

export interface SetValidation {
  valid: boolean;
  /** Why the set can't be banked yet; empty when valid. */
  message: string;
}

export interface RepRange {
  min: number;
  max: number;
}

const OK: SetValidation = { valid: true, message: "" };
const fail = (message: string): SetValidation => ({ valid: false, message });
const REPS_MISSING = "Enter completed reps before banking this set.";

/** A finite number above zero. */
export const isPositive = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v) && v > 0;

export function blankSet(id: string): SetLog {
  return { id, weightKg: null, reps: null, done: false };
}

/**
 * The set list for an exercise planned at `plannedCount` sets. Existing sets
 * keep their index; missing slots become blank sets `s1…sN` (the next free id
 * when one is taken). Sets beyond the plan are kept and flagged `extra`.
 */
export function reconcileSets(plannedCount: number, existing: readonly SetLog[]): SetLog[] {
  const planned = Math.max(0, Math.floor(plannedCount) || 0);
  const used = new Set(existing.map((s) => s.id));
  const freshId = (index: number): string => {
    let n = index + 1;
    while (used.has(`s${n}`)) n += 1;
    used.add(`s${n}`);
    return `s${n}`;
  };
  return Array.from({ length: Math.max(planned, existing.length) }, (_, i) => {
    const set = existing[i];
    if (!set) return blankSet(freshId(i));
    return i >= planned && !set.extra ? { ...set, extra: true } : set;
  });
}

/** Can this set be banked for the given tracking mode? */
export function validateSet(set: SetLog, mode: TrackingMode): SetValidation {
  const values = [set.weightKg, set.reps, set.seconds, set.distanceM, set.assistanceKg];
  if (values.some((v) => typeof v === "number" && v < 0)) return fail("Values can't be negative.");
  switch (mode) {
    case "timed_hold":
      return isPositive(set.seconds) ? OK : fail("Enter the hold time before banking this set.");
    case "carry":
      if (!isPositive(set.weightKg)) return fail("Enter the carried load before banking this set.");
      return isPositive(set.distanceM) || isPositive(set.seconds) ? OK : fail("Enter the carry distance or time.");
    case "bodyweight_reps": // weight is optional: it is load added to bodyweight
    case "assisted_reps": // assistance is optional: none means bodyweight
      return isPositive(set.reps) ? OK : fail(REPS_MISSING);
    case "loaded_reps":
      if (!isPositive(set.weightKg)) return fail("Enter the working weight before banking this set.");
      return isPositive(set.reps) ? OK : fail(REPS_MISSING);
  }
}

/** Performed work: banked AND valid for its mode. Pain sets are performed work too. */
export function isCompletedSet(set: SetLog, mode: TrackingMode): boolean {
  return set.done === true && validateSet(set, mode).valid;
}

/** v19 technique sets (drop, myo, rest-pause, partial) survive under legacy.type. */
export function isStraightSet(set: SetLog): boolean {
  const type = set.legacy?.type;
  return type === undefined || type === null || type === "" || type === "straight";
}

/** The mode a log was tracked in: its own, else the caller's, else a name guess. */
export function modeOf(log: ExerciseLog | undefined, fallback?: TrackingMode): TrackingMode {
  return log?.trackingMode ?? fallback ?? guessTrackingMode(log ? performedName(log) : "");
}

/** Completed sets within the plan. Extra sets never count. */
export function completedPlannedSets(log: ExerciseLog | undefined, plannedCount: number, fallbackMode?: TrackingMode): number {
  if (!log) return 0;
  const mode = modeOf(log, fallbackMode);
  return log.sets.slice(0, Math.max(0, plannedCount)).filter((s) => !s.extra && isCompletedSet(s, mode)).length;
}

/** Done with this exercise: every planned set completed, or skipped (with a reason). */
export function isExerciseHandled(log: ExerciseLog | undefined, plannedCount: number, fallbackMode?: TrackingMode): boolean {
  if (log?.skipped) return true;
  return plannedCount > 0 && completedPlannedSets(log, plannedCount, fallbackMode) >= plannedCount;
}

/** Where to resume within an exercise: the first incomplete set, else the last. */
export function firstIncompleteSetIndex(sets: readonly SetLog[], mode: TrackingMode): number {
  const index = sets.findIndex((s) => !isCompletedSet(s, mode));
  return index === -1 ? Math.max(0, sets.length - 1) : index;
}

const handled = (p: PlannedExercise, workout: WorkoutLog): boolean =>
  isExerciseHandled(workout.exercises[p.id], p.sets, p.trackingMode);

/** Where to resume a session: the first unhandled exercise, else the last. */
export function firstIncompleteExerciseIndex(planned: readonly PlannedExercise[], workout: WorkoutLog): number {
  const index = planned.findIndex((p) => !handled(p, workout));
  return index === -1 ? Math.max(0, planned.length - 1) : index;
}

/** The next unhandled exercise after `currentIndex`, or -1. */
export function nextIncompleteExerciseIndex(planned: readonly PlannedExercise[], workout: WorkoutLog, currentIndex = -1): number {
  for (let i = Math.max(0, currentIndex + 1); i < planned.length; i += 1) {
    if (!handled(planned[i] as PlannedExercise, workout)) return i;
  }
  return -1;
}

export function isSessionHandled(planned: readonly PlannedExercise[], workout: WorkoutLog): boolean {
  return planned.length > 0 && planned.every((p) => handled(p, workout));
}

/** A prescription string ("6–8", "8", "30-45 s") as a range; `fallback` when it has no number. */
export function parseRepRange(value: string | number | null | undefined, fallback: RepRange): RepRange {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? { min: value, max: value } : { ...fallback };
  const nums = (String(value ?? "").match(/\d+(?:\.\d+)?/g) ?? []).map(Number).filter((n) => n > 0);
  const [a, b] = nums;
  if (a === undefined) return { ...fallback };
  if (b === undefined) return { min: a, max: a };
  return { min: Math.min(a, b), max: Math.max(a, b) };
}

/** 185 → "185", 82.5 → "82.5". */
export const fmtNumber = (v: number): string => (Number.isInteger(v) ? String(v) : v.toFixed(1));
const show = (v: number | null | undefined): string => (isPositive(v) ? fmtNumber(round1(v)) : "—");

/** A load in the athlete's units, without the unit ("185"). */
export const displayLoad = (kg: number, units: UnitSystem): string => fmtNumber(toDisplayWeight(kg, units));

/** Carries are measured in yards (imperial) or metres (metric). */
export const carryUnit = (units: UnitSystem): "yd" | "m" => (units === "imperial" ? "yd" : "m");
export const toDisplayCarry = (m: number, units: UnitSystem): number => round1(units === "imperial" ? mToYd(m) : m);
export const fromDisplayCarry = (value: number, units: UnitSystem): number => (units === "imperial" ? ydToM(value) : value);

export function displayCarryDistance(m: number, units: UnitSystem): string {
  return `${fmtNumber(toDisplayCarry(m, units))} ${carryUnit(units)}`;
}

/** One-line label for a set: "185 × 6", "60 s", "+25 lb × 8", "40 lb assist × 8". */
export function describeSet(set: Pick<SetLog, "weightKg" | "reps" | "seconds" | "distanceM" | "assistanceKg">, mode: TrackingMode, units: UnitSystem): string {
  const unit = weightUnit(units);
  const reps = show(set.reps);
  switch (mode) {
    case "timed_hold":
      return `${show(set.seconds)} s${isPositive(set.weightKg) ? ` · +${displayLoad(set.weightKg, units)} ${unit}` : ""}`;
    case "carry": {
      const load = isPositive(set.weightKg) ? `${displayLoad(set.weightKg, units)} ${unit}` : "—";
      const measure = isPositive(set.distanceM) ? displayCarryDistance(set.distanceM, units) : `${show(set.seconds)} s`;
      return `${load} · ${measure}`;
    }
    case "assisted_reps":
      return `${isPositive(set.assistanceKg) ? `${displayLoad(set.assistanceKg, units)} ${unit} assist` : "BW"} × ${reps}`;
    case "bodyweight_reps":
      return `${isPositive(set.weightKg) ? `+${displayLoad(set.weightKg, units)} ${unit}` : "BW"} × ${reps}`;
    case "loaded_reps":
      return `${isPositive(set.weightKg) ? displayLoad(set.weightKg, units) : "—"} × ${reps}`;
  }
}
