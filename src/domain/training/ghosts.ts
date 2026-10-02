// Ghosts: the one-tap fill for the set being worked on, and the rest-screen
// glance at what's next.
//
// The intuition contract (each pinned by test):
//   - ONE ghost, on the first empty set; fill it and it moves on.
//   - Explicit tap only: a ghost is never written into a set by itself.
//   - Fill priority: your previous set today ("from set 2") > last time, same
//     set slot > last time, final set (when today plans more sets).
//   - Every ghost says where it came from, so it can be audited.
//   - The day's target is a separate ghost ("today's target").
//
// Ported from src/setGhosts.js (+ GhostChip.jsx semantics) @ c955d5a.
// Deliberate changes:
//   - Every tracking mode gets ghosts. v19 required a weight, so bodyweight
//     moves never got one, and the chip was hidden for holds and carries.
//   - Ghosts carry typed kg/s/m values and a display text in the athlete's
//     units; a ghost from a pain set says so (`pain: true`).
//   - Dates are formatted from the key ("Jul 13"), not the host locale.
//   - lastSessionSets merged into liftMath.lastPerformance, which now keeps
//     the per-set values; target ghosts are new.

import { isDateKey, type DateKey } from "../dates";
import type { SetLog, TrackingMode } from "../day/schema";
import type { UnitSystem } from "../units";
import type { Prescription } from "./progression";
import { describeSet, isPositive } from "./sets";

/** The values a ghost writes into a set when tapped. */
export type SetValues = Pick<SetLog, "weightKg" | "reps" | "seconds" | "distanceM" | "assistanceKg">;

export type GhostSource = "carry" | "last" | "target";

export interface Ghost {
  source: GhostSource;
  values: SetValues;
  /** Where it came from: "from set 2", "last time · Jul 13", "today's target". */
  label: string;
  /** What it fills, in the athlete's units: "185 × 8". */
  text: string;
  /** The set it was copied from was flagged pain. */
  pain?: boolean;
}

/** Last time's completed sets for the movement (see liftMath.lastPerformance). */
export interface LastSets {
  dateKey: DateKey;
  sets: readonly SetLog[];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-07-13" → "Jul 13"; anything that isn't a date key is returned as is. */
export function shortDate(key: DateKey): string {
  if (!isDateKey(key)) return key;
  const [, month, day] = key.split("-").map(Number) as [number, number, number];
  return `${MONTHS[month - 1]} ${day}`;
}

/** The field that makes a set "started" in each mode. */
function primary(set: SetValues, mode: TrackingMode): number | null | undefined {
  switch (mode) {
    case "loaded_reps":
    case "carry":
      return set.weightKg;
    case "bodyweight_reps":
    case "assisted_reps":
      return set.reps;
    case "timed_hold":
      return set.seconds;
  }
}

/** Only the fields the mode logs, so a fill never leaves stray values. */
export function valuesFor(set: SetValues, mode: TrackingMode): SetValues {
  switch (mode) {
    case "loaded_reps":
    case "bodyweight_reps":
      return { weightKg: set.weightKg, reps: set.reps };
    case "assisted_reps":
      return { weightKg: null, reps: set.reps, assistanceKg: set.assistanceKg ?? null };
    case "timed_hold":
      return { weightKg: set.weightKg, reps: null, seconds: set.seconds ?? null };
    case "carry":
      return { weightKg: set.weightKg, reps: null, distanceM: set.distanceM ?? null, seconds: set.seconds ?? null };
  }
}

export const isEmptySet = (set: SetValues | undefined, mode: TrackingMode): boolean => !set || !isPositive(primary(set, mode));

/** Where the single ghost goes: the first empty set, or -1 when every set is started. */
export function firstEmptyIndex(sets: readonly SetValues[], mode: TrackingMode): number {
  return sets.findIndex((s) => isEmptySet(s, mode));
}

function ghost(source: GhostSource, from: SetValues & { pain?: boolean }, label: string, mode: TrackingMode, units: UnitSystem): Ghost {
  const values = valuesFor(from, mode);
  const g: Ghost = { source, values, label, text: describeSet(values, mode, units) };
  return from.pain ? { ...g, pain: true } : g;
}

/** The ghost for set `index`: carry from today, else last time; null when there is nothing to offer. */
export function ghostForSet(sets: readonly SetLog[], index: number, last: LastSets | null, mode: TrackingMode, units: UnitSystem): Ghost | null {
  for (let i = Math.min(index, sets.length) - 1; i >= 0; i -= 1) {
    const set = sets[i] as SetLog;
    if (!isEmptySet(set, mode)) return ghost("carry", set, `from set ${i + 1}`, mode, units);
  }
  const slot = last?.sets[index] ?? last?.sets[last.sets.length - 1];
  return last && slot ? ghost("last", slot, `last time · ${shortDate(last.dateKey)}`, mode, units) : null;
}

const pick = (values: readonly number[] | null | undefined, index: number): number | null =>
  values && values.length ? (values[Math.min(index, values.length - 1)] ?? null) : null;

/** The day's target for set `index`, as a tap-to-fill ghost. Null for a baseline (nothing to suggest yet). */
export function targetGhost(p: Prescription, index: number, units: UnitSystem): Ghost | null {
  if (p.status === "baseline") return null;
  const values: SetValues = {
    weightKg: p.weightKg,
    reps: pick(p.reps, index),
    seconds: pick(p.seconds, index),
    distanceM: pick(p.distanceM, index),
    assistanceKg: p.assistanceKg ?? null,
  };
  return ghost("target", values, "today's target", p.mode, units);
}

export interface NextGlance {
  line: string;
  /** Last time's value for the next set, when known. */
  ghost: string | null;
  exercise: string;
}

/** The rest-screen glance after banking set `completedIndex`. */
export function buildNextGlance(args: {
  sets: readonly SetLog[];
  completedIndex: number;
  exerciseName: string;
  last: LastSets | null;
  mode: TrackingMode;
  units: UnitSystem;
  nextExerciseName?: string | null;
}): NextGlance {
  const { sets, completedIndex, exerciseName, last, mode, units, nextExerciseName } = args;
  const nextIndex = sets.findIndex((s, i) => i > completedIndex && !s.done && !s.extra);
  if (nextIndex !== -1) {
    const slot = last?.sets[nextIndex] ?? last?.sets[last.sets.length - 1];
    const total = sets.filter((s) => !s.extra).length;
    return { line: `Next · set ${nextIndex + 1} of ${total}`, ghost: slot ? `last time ${describeSet(slot, mode, units)}` : null, exercise: exerciseName };
  }
  if (nextExerciseName) return { line: `Next · ${nextExerciseName}`, ghost: null, exercise: nextExerciseName };
  return { line: "Last set banked", ghost: null, exercise: exerciseName };
}
