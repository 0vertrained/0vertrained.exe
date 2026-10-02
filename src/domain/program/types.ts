// The v2 program record: a dated list of weekly plans (revisions) stored as
// the JSONB payload of the athlete's `program` row.
//
// v1 stored one undated week, so editing the program silently re-judged every
// past day against the new plan. v2 keeps each saved week with the day it
// took effect; a past day is always judged by the plan that was live then.
// Exercises carry a library id and an explicit tracking mode; distances are
// canonical km.

import type { DateKey, Weekday } from "../dates";
import type { Legacy, PlannedExercise } from "../day/schema";
import type { Difficulty } from "../exercise";

export const PROGRAM_VERSION = 2;

/** Older revisions are collapsed beyond this many (one a week for a year). */
export const MAX_REVISIONS = 52;

/**
 * One planned exercise. `reps` is the target as text ("6", "8-10"); for a
 * timed hold it is target seconds ("45"), for a carry target metres ("40").
 */
export interface PlannedLift extends PlannedExercise {
  notes?: string;
}

export interface PlannedCardio {
  /** Display type, e.g. "Long Run", "Incline Walk". */
  kind: string;
  minutes?: number;
  km?: number;
  effort?: string;
  notes?: string;
}

export interface ProgramDay {
  title: string;
  code?: string;
  /** A scheduled day off. A rest day may still carry an optional light walk. */
  rest: boolean;
  lifting: PlannedLift[];
  cardio: PlannedCardio | null;
}

export type ProgramWeek = Record<Weekday, ProgramDay>;

export const BUILDER_GOALS = ["strength", "bodybuilding", "endurance", "basic_fitness", "hybrid"] as const;
export type BuilderGoal = (typeof BUILDER_GOALS)[number];

export const TRAINING_DAY_OPTIONS = [2, 3, 4, 5, 6] as const;
export type DaysPerWeek = (typeof TRAINING_DAY_OPTIONS)[number];

/** What the athlete has to train with. */
export const EQUIPMENT_MODES = ["full_gym", "dumbbells", "bodyweight"] as const;
export type EquipmentMode = (typeof EQUIPMENT_MODES)[number];

export const EXPERIENCE_LEVELS = ["beginner", "intermediate", "advanced"] as const satisfies readonly Difficulty[];

export interface BuilderInput {
  goal: BuilderGoal;
  daysPerWeek: DaysPerWeek;
  equipment: EquipmentMode;
  experience: Difficulty;
  /** Rotates accessory and cardio-note choices; same seed, same week. */
  seed?: number;
}

export interface ProgramRevision {
  effectiveFrom: DateKey;
  /** 'preset:<id>' | 'generator' | 'custom' | 'imported' */
  source: string;
  /** The generator settings, so the athlete can regenerate from them. */
  builderInput?: BuilderInput;
  week: ProgramWeek;
}

export interface ProgramPayloadV2 {
  v: 2;
  /** Sorted by effectiveFrom, never empty, at most MAX_REVISIONS. */
  revisions: ProgramRevision[];
  /** The v1 week this payload was imported from, kept verbatim. */
  legacy?: Legacy;
}

export function restDay(title = "Rest"): ProgramDay {
  return { title, code: "REST", rest: true, lifting: [], cardio: null };
}
