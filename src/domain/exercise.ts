// Exercise metadata shared by the program library (which owns the catalog)
// and the training rules (which consume it). Training code receives an
// ExerciseMeta from its caller rather than looking names up itself, so it
// stays independent of the catalog.

import type { TrackingMode } from "./day/schema";
import type { UnitSystem } from "./units";

export const MOVEMENT_PATTERNS = [
  "squat", "hinge", "singleLeg",
  "horizontalPush", "verticalPush",
  "horizontalPull", "verticalPull",
  "chestIsolation", "backIsolation",
  "lateralDelts", "rearDelts",
  "biceps", "triceps",
  "quadIso", "hamstringIso",
  "calves", "core",
] as const;
export type MovementPattern = (typeof MOVEMENT_PATTERNS)[number];

export const EQUIPMENT = ["barbell", "dumbbell", "machine", "cable", "bodyweight", "kettlebell", "band"] as const;
export type Equipment = (typeof EQUIPMENT)[number];

export type Difficulty = "beginner" | "intermediate" | "advanced";

/** The four strength groups the STR stat is measured over. */
export type StrengthGroup = "squat" | "hinge" | "push" | "pull";

const STRENGTH_GROUP: Partial<Record<MovementPattern, StrengthGroup>> = {
  squat: "squat",
  singleLeg: "squat",
  hinge: "hinge",
  horizontalPush: "push",
  verticalPush: "push",
  horizontalPull: "pull",
  verticalPull: "pull",
};

export function strengthGroupOf(pattern: MovementPattern | undefined): StrengthGroup | null {
  return (pattern && STRENGTH_GROUP[pattern]) || null;
}

export interface ExerciseMeta {
  trackingMode: TrackingMode;
  /** Plate math and the barbell warm-up only make sense on a bar. */
  isBarbell: boolean;
  /** Share of bodyweight moved by a bodyweight movement (push-up ≈ 0.64). */
  bwFactor?: number;
  /** Heavy lower-body lifts progress in bigger jumps. */
  largeIncrement?: boolean;
  pattern?: MovementPattern;
  equipment?: Equipment;
}

/** Load step for progression targets, in kg, for the athlete's display units. */
export function loadStepKg(meta: Pick<ExerciseMeta, "largeIncrement">, units: UnitSystem): number {
  // 5 lb / 10 lb in imperial, 2.5 kg / 5 kg in metric — kept exact in kg.
  if (units === "imperial") return (meta.largeIncrement ? 10 : 5) / 2.20462262185;
  return meta.largeIncrement ? 5 : 2.5;
}

// Fallback for names the catalog doesn't know (custom exercises, old logs).
// Wider than v19's regex: sit-ups, crunches, bodyweight squats, glute
// bridges and dead bugs are bodyweight moves, not 0-lb loaded lifts.
const TIMED = /\b(plank|hold|wall sit|dead hang|l-sit|hollow body)\b/i;
const CARRY = /\b(carry|farmer'?s? walk|suitcase walk|yoke)\b/i;
const ASSISTED = /\bassisted\b/i;
const WEIGHTED = /\b(weighted|loaded|barbell|dumbbell|db|kettlebell|kb|cable|machine)\b/i;
const BODYWEIGHT = /(push[- ]?ups?|pull[- ]?ups?|chin[- ]?ups?|\bdips?\b|leg raises?|knee raises?|glute[- ]?ham raises?|sit[- ]?ups?|crunch(es)?|dead ?bugs?|bird ?dogs?|burpees?|mountain climbers?|glute bridges?|bodyweight|air squats?|pistol squats?|inverted rows?|lunges?|step[- ]?ups?|v[- ]?ups?|flutter kicks?|bear crawls?|jumping jacks?|box jumps?|nordic)/i;

export function guessTrackingMode(name: string): TrackingMode {
  if (TIMED.test(name)) return "timed_hold";
  if (CARRY.test(name)) return "carry";
  if (ASSISTED.test(name)) return "assisted_reps";
  if (BODYWEIGHT.test(name) && !WEIGHTED.test(name)) return "bodyweight_reps";
  return "loaded_reps";
}

const BARBELL = /\b(barbell|back squat|front squat|deadlift|bench press|overhead press|ohp|pendlay|power clean|hip thrust|good morning|ez[- ]?bar)\b/i;
const NOT_BARBELL = /\b(db|dumbbell|kettlebell|kb|cable|machine|smith|trap bar|hex bar|romanian deadlift \(db\))\b/i;
const LARGE = /\b(deadlift|leg press|hack squat|hip thrust|calf|back squat|front squat|squat)\b/i;

/** Best-effort metadata for an exercise the catalog doesn't know. */
export function guessMeta(name: string): ExerciseMeta {
  const trackingMode = guessTrackingMode(name);
  return {
    trackingMode,
    isBarbell: trackingMode === "loaded_reps" && BARBELL.test(name) && !NOT_BARBELL.test(name),
    largeIncrement: trackingMode === "loaded_reps" && LARGE.test(name) && !/\b(db|dumbbell|goblet|split|bulgarian)\b/i.test(name),
  };
}
