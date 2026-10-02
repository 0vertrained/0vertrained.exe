// The v2 day record: one per athlete per local calendar day, stored as the
// JSONB payload of an `entries` row.
//
// Canonical units: kg, km, metres, seconds/minutes. Numbers are numbers (v1
// stored strings). Exercises are keyed by a stable exercise id instead of a
// display name. Anything v20 does not model is preserved verbatim under
// `legacy` keys, so re-saving a v1 day never destroys what the athlete logged
// with the old app (nutrition, body metrics, notes, RIR, …).

import type { DateKey } from "../dates";

export const DAY_VERSION = 2;

export const TRACKING_MODES = ["loaded_reps", "bodyweight_reps", "assisted_reps", "timed_hold", "carry"] as const;
export type TrackingMode = (typeof TRACKING_MODES)[number];

export const SKIP_REASONS = ["equipment", "time", "fatigue", "pain"] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

/** Unmodelled fields carried through untouched. */
export type Legacy = Record<string, unknown>;

export interface SetLog {
  /** Stable within its exercise; used to merge edits from two devices. */
  id: string;
  /** Working load; for bodyweight moves, load added on top of bodyweight. */
  weightKg: number | null;
  reps: number | null;
  seconds?: number | null;
  distanceM?: number | null;
  assistanceKg?: number | null;
  done: boolean;
  /** ISO timestamp the set was completed. */
  completedAt?: string;
  pain?: boolean;
  /** Logged beyond the planned sets (saved, earns no quest credit). */
  extra?: boolean;
  /** The highlighted Rank Trial set. */
  trial?: boolean;
  legacy?: Legacy;
}

export interface ExerciseLog {
  /** Planned display name at the time it was logged. */
  name: string;
  libraryId?: string;
  /** Set when the athlete swapped to a different movement. */
  performedName?: string;
  trackingMode?: TrackingMode;
  skipped?: SkipReason;
  sets: SetLog[];
  legacy?: Legacy;
}

export interface CardioLog {
  id: string;
  kind: string;
  minutes: number | null;
  km: number | null;
  source: "runner" | "manual";
  completedAt?: string;
  notes?: string;
  legacy?: Legacy;
}

/** The 5-second check-in, on the same 1–10 scales v1 used. */
export interface CheckIn {
  sleepQuality?: number;
  soreness?: number;
  stress?: number;
  energy?: number;
  illness?: boolean;
  note?: string;
}

export interface WorkoutLog {
  startedAt?: string;
  completedAt?: string;
  exercises: Record<string, ExerciseLog>;
  cardio: CardioLog[];
  notes?: string;
  legacy?: Legacy;
}

export type Tier = "FULL" | "REDUCED" | "RECOVER" | "REST";

export interface PlannedExercise {
  id: string;
  name: string;
  libraryId?: string;
  sets: number;
  reps: string;
  trackingMode: TrackingMode;
}

/**
 * The quest as issued for this day, frozen once training starts so later
 * program or rule changes never re-judge a past day.
 */
export interface QuestSnapshot {
  rulesVersion: number;
  tier: Tier;
  reason: string;
  issuedAt: string;
  /** True when the engine (not the athlete) chose the tier. */
  engineIssued: boolean;
  planned: {
    exercises: PlannedExercise[];
    plannedSets: number;
    cardioMinutes: number | null;
    cardioKind?: string;
  };
  recoveryDone?: boolean;
  trial?: { targetRank: string; exerciseId: string; spec: string; passed?: boolean };
  claimedAt?: string;
}

export interface DayV2 {
  v: 2;
  checkin: CheckIn;
  workout: WorkoutLog;
  quest?: QuestSnapshot;
  /** v1 top-level and body fields v20 does not use. */
  legacy?: Legacy;
}

export type DayMap = Record<DateKey, DayV2>;

export function emptyDay(): DayV2 {
  return { v: 2, checkin: {}, workout: { exercises: {}, cardio: [] } };
}
