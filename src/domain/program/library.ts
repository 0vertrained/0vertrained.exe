// Lookups over the exercise catalog: id/name/alias resolution, the metadata
// training rules consume, and the generator's seeded selection.
//
// Ported from src/programExerciseLibrary.js (EQUIPMENT_ALLOW, selectExercises)
// @ c955d5a. Deliberate changes:
//   - resolveExercise/metaFor are new: v19 matched names with regexes in each
//     consumer.
//   - selectExercises never returns the same exercise twice (v19 wrapped
//     around a short pool, so "2 triceps" on a bodyweight plan gave Bench
//     Dip twice), skips specialty lifts and takes an exclusion set so a day
//     never repeats a movement across slots.

import { guessMeta, type Difficulty, type Equipment, type ExerciseMeta, type MovementPattern } from "../exercise";
import { ALIASES, normalizeName } from "./aliases";
import { LIBRARY, type LibraryExercise } from "./catalog";
import type { EquipmentMode } from "./types";

export { LIBRARY, type LibraryExercise } from "./catalog";
export { CARDIO_SESSIONS, buildCardio, cardioIntensity, kmFromMiles, type CardioKey } from "./cardio";

/** Compound patterns anchor a session; the rest is accessory work. */
export const COMPOUND_PATTERNS: readonly MovementPattern[] = [
  "squat", "hinge", "singleLeg", "horizontalPush", "verticalPush", "horizontalPull", "verticalPull",
];

export const isCompoundPattern = (pattern: MovementPattern): boolean => COMPOUND_PATTERNS.includes(pattern);

/** Exercise equipment each equipment mode can use. */
export const EQUIPMENT_ALLOW: Readonly<Record<EquipmentMode, readonly Equipment[]>> = {
  full_gym: ["barbell", "dumbbell", "machine", "cable", "bodyweight", "kettlebell", "band"],
  dumbbells: ["dumbbell", "bodyweight"],
  bodyweight: ["bodyweight"],
};

export const DIFFICULTY_RANK: Readonly<Record<Difficulty, number>> = { beginner: 1, intermediate: 2, advanced: 3 };

const BY_ID = new Map(LIBRARY.map((e) => [e.id, e]));
const BY_NAME = new Map(LIBRARY.map((e) => [normalizeName(e.name), e]));

export function getExercise(id: string): LibraryExercise | undefined {
  return BY_ID.get(id);
}

/** An id, a catalog name or a known alias; case-, punctuation- and plural-insensitive. */
export function resolveExercise(nameOrId: string): LibraryExercise | undefined {
  const byId = BY_ID.get(nameOrId.trim());
  if (byId) return byId;
  const key = normalizeName(nameOrId);
  if (!key) return undefined;
  const alias = ALIASES[key];
  return BY_NAME.get(key) ?? (alias === undefined ? undefined : BY_ID.get(alias));
}

/** Catalog metadata when the movement is known, else a best guess from the name. */
export function metaFor(nameOrId: string): ExerciseMeta {
  const e = resolveExercise(nameOrId);
  if (!e) return guessMeta(nameOrId);
  const meta: ExerciseMeta = { trackingMode: e.trackingMode, isBarbell: e.isBarbell, pattern: e.pattern, equipment: e.equipment };
  if (e.bwFactor !== undefined) meta.bwFactor = e.bwFactor;
  if (e.largeIncrement) meta.largeIncrement = true;
  return meta;
}

export interface SelectOptions {
  equipment?: EquipmentMode;
  level?: Difficulty;
  count?: number;
  /** Rotates the starting point so variants pull different (stable) movements. */
  seed?: number;
  /** Ids already used (e.g. earlier in the same day). */
  exclude?: ReadonlySet<string>;
}

/**
 * Up to `count` distinct exercises for a pattern, filtered to the equipment
 * mode and biased to the experience level (harder movements only when the
 * level-appropriate pool is too small). Seed 0 returns the pattern's anchor:
 * the first eligible entry in catalog order.
 */
export function selectExercises(pattern: MovementPattern, options: SelectOptions = {}): LibraryExercise[] {
  const { equipment = "full_gym", level = "intermediate", count = 1, seed = 0, exclude } = options;
  const allowed = EQUIPMENT_ALLOW[equipment];
  const pool = LIBRARY.filter(
    (e) => e.pattern === pattern && !e.specialty && allowed.includes(e.equipment) && !exclude?.has(e.id),
  );
  const atLevel = pool.filter((e) => DIFFICULTY_RANK[e.difficulty] <= DIFFICULTY_RANK[level]);
  const source = atLevel.length >= count ? atLevel : pool;
  const len = source.length;
  if (len === 0 || count < 1) return [];
  const s = Number.isFinite(seed) ? Math.trunc(seed) : 0;
  const start = ((s % len) + len) % len;
  return Array.from({ length: Math.min(count, len) }, (_, i) => source[(start + i) % len] as LibraryExercise);
}
