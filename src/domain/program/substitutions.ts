// "Rack's taken" swaps: same-pattern movements the athlete can do with the
// equipment at hand, most similar first.
//
// Ported from src/exerciseSubstitutions.js (PATTERNS, getSubstitutions) and
// the per-exercise `alternatives` in src/programExerciseLibrary.js @ c955d5a.
// Deliberate changes:
//   - Swaps are library movements (so a swapped log gets an id and a
//     tracking mode), not free-text names like "Hack squat / pendulum".
//   - Pattern-true only: the curated lists keep their order but drop
//     cross-pattern picks (Bulgarian split squat for a squat, straight-arm
//     pulldown for a pull-up). After the curated picks come the rest of the
//     pattern: same equipment, then same tracking mode, then closest
//     difficulty.
//   - The reason ranking (regex traits over the note text) and
//     substitutionReason are gone.
//   - Keyword matching remains only for names the catalog doesn't know. It
//     checks lunges before squats, leg extensions on their own and triceps
//     before overhead presses (v19 sent split squats to squats, "Leg
//     Extension" to triceps and "Overhead Triceps Extension" to presses).

import type { Equipment, MovementPattern } from "../exercise";
import { DIFFICULTY_RANK, EQUIPMENT_ALLOW, LIBRARY, resolveExercise, type LibraryExercise } from "./library";
import type { EquipmentMode } from "./types";

const CURATED: Readonly<Record<string, readonly string[]>> = {
  "back-squat": ["front-squat", "hack-squat", "pendulum-squat", "leg-press", "goblet-squat"],
  "front-squat": ["back-squat", "hack-squat", "goblet-squat"],
  "goblet-squat": ["bodyweight-squat", "leg-press"],
  "leg-press": ["hack-squat", "pendulum-squat", "goblet-squat"],
  "hack-squat": ["pendulum-squat", "leg-press", "front-squat"],
  "pendulum-squat": ["hack-squat", "leg-press"],
  "bodyweight-squat": ["goblet-squat"],
  "conventional-deadlift": ["trap-bar-deadlift", "romanian-deadlift", "db-romanian-deadlift", "barbell-hip-thrust", "back-extension"],
  "trap-bar-deadlift": ["conventional-deadlift", "romanian-deadlift"],
  "romanian-deadlift": ["db-romanian-deadlift", "conventional-deadlift", "back-extension", "barbell-hip-thrust"],
  "db-romanian-deadlift": ["romanian-deadlift", "glute-bridge"],
  "barbell-hip-thrust": ["glute-bridge", "db-romanian-deadlift"],
  "glute-bridge": ["barbell-hip-thrust", "db-romanian-deadlift"],
  "bulgarian-split-squat": ["walking-lunge", "reverse-lunge", "step-up"],
  "walking-lunge": ["reverse-lunge", "step-up", "bulgarian-split-squat"],
  "step-up": ["walking-lunge", "reverse-lunge"],
  "reverse-lunge": ["walking-lunge", "step-up"],
  "barbell-bench-press": ["dumbbell-bench-press", "machine-chest-press", "weighted-push-up", "dip"],
  "dumbbell-bench-press": ["barbell-bench-press", "machine-chest-press", "incline-db-press", "push-up"],
  "incline-db-press": ["incline-machine-press", "incline-smith-press", "dumbbell-bench-press", "barbell-bench-press"],
  "push-up": ["weighted-push-up", "incline-push-up", "dumbbell-bench-press"],
  "weighted-push-up": ["push-up", "dip", "dumbbell-bench-press"],
  "overhead-press": ["seated-db-press", "machine-shoulder-press", "pike-push-up"],
  "seated-db-press": ["overhead-press", "machine-shoulder-press", "pike-push-up"],
  "barbell-row": ["chest-supported-row", "cable-row", "one-arm-db-row", "t-bar-row"],
  "chest-supported-row": ["cable-row", "one-arm-db-row"],
  "one-arm-db-row": ["chest-supported-row", "cable-row"],
  "cable-row": ["chest-supported-row", "one-arm-db-row"],
  "inverted-row": ["one-arm-db-row", "cable-row"],
  "pull-up": ["lat-pulldown", "assisted-pull-up", "chin-up"],
  "lat-pulldown": ["pull-up", "assisted-pull-up"],
  "assisted-pull-up": ["lat-pulldown", "pull-up"],
  "cable-fly": ["pec-deck", "db-fly"],
  "pec-deck": ["cable-fly", "db-fly"],
  "db-fly": ["cable-fly", "pec-deck"],
  "lateral-raise": ["cable-lateral-raise", "machine-lateral-raise"],
  "cable-lateral-raise": ["lateral-raise", "machine-lateral-raise"],
  "rear-delt-fly": ["reverse-pec-deck"],
  "reverse-pec-deck": ["rear-delt-fly"],
  "ez-bar-curl": ["barbell-curl", "dumbbell-curl", "cable-curl"],
  "incline-db-curl": ["dumbbell-curl", "hammer-curl", "ez-bar-curl"],
  "hammer-curl": ["dumbbell-curl", "cable-curl", "incline-db-curl"],
  "cable-curl": ["dumbbell-curl", "ez-bar-curl", "hammer-curl"],
  "triceps-pushdown": ["overhead-triceps-extension", "skull-crusher"],
  "skull-crusher": ["triceps-pushdown", "overhead-triceps-extension"],
  "overhead-triceps-extension": ["skull-crusher", "triceps-pushdown"],
  "bench-dip": ["triceps-pushdown"],
  "sissy-squat": ["leg-extension"],
  "lying-leg-curl": ["seated-leg-curl"],
  "seated-leg-curl": ["lying-leg-curl"],
  "single-leg-glute-bridge": ["lying-leg-curl"],
  "standing-calf-raise": ["seated-calf-raise", "db-calf-raise"],
  "seated-calf-raise": ["standing-calf-raise", "db-calf-raise"],
  "db-calf-raise": ["standing-calf-raise", "seated-calf-raise"],
  "bodyweight-calf-raise": ["standing-calf-raise", "db-calf-raise"],
  "plank": ["dead-bug", "hanging-leg-raise"],
  "dead-bug": ["plank", "pallof-press"],
  "pallof-press": ["dead-bug", "plank"],
  "cable-crunch": ["hanging-leg-raise", "plank"],
  "hanging-leg-raise": ["cable-crunch", "dead-bug"],
};

// For names the catalog doesn't know. Order matters: first match wins.
const KEYWORDS: readonly (readonly [MovementPattern, readonly string[]])[] = [
  ["singleLeg", ["lunge", "split squat", "step-up", "step up"]],
  ["quadIso", ["leg extension"]],
  ["squat", ["squat", "leg press", "goblet"]],
  ["hinge", ["deadlift", "rdl", "romanian", "hinge", "good morning", "hip thrust"]],
  ["horizontalPush", ["bench", "chest press", "push-up", "pushup", "dip"]],
  ["triceps", ["pushdown", "push-down", "skull", "tricep", "close-grip", "close grip"]],
  ["verticalPush", ["overhead", "ohp", "shoulder press", "military", "push press", "arnold"]],
  ["verticalPull", ["pull-up", "pullup", "chin-up", "chinup", "pulldown"]],
  ["horizontalPull", ["row", "t-bar"]],
  ["biceps", ["curl"]],
  ["lateralDelts", ["lateral raise", "lateral", "side raise"]],
  ["calves", ["calf"]],
];

/** The movement pattern a free-text name most likely belongs to. */
export function guessPattern(name: string): MovementPattern | undefined {
  const n = name.toLowerCase();
  return KEYWORDS.find(([, words]) => words.some((w) => n.includes(w)))?.[0];
}

export interface SubstituteOptions {
  /** An equipment mode, or the exact equipment available. Default: anything. */
  equipment?: EquipmentMode | readonly Equipment[];
  /** Default 4, like v19. */
  limit?: number;
}

/** Same-pattern swaps for a movement, most similar first; [] when the pattern is unknown. */
export function substitutesFor(nameOrId: string, options: SubstituteOptions = {}): LibraryExercise[] {
  const source = resolveExercise(nameOrId);
  const pattern = source?.pattern ?? guessPattern(nameOrId);
  if (!pattern) return [];
  const { equipment = "full_gym", limit = 4 } = options;
  const allowed = typeof equipment === "string" ? EQUIPMENT_ALLOW[equipment] : equipment;
  const curated = (source && CURATED[source.id]) ?? [];
  const rank = (e: LibraryExercise): number[] => {
    if (!source) return []; // unknown name: catalog order
    const c = curated.indexOf(e.id);
    return [
      c === -1 ? Infinity : c,
      e.equipment === source.equipment ? 0 : 1,
      e.trackingMode === source.trackingMode ? 0 : 1,
      Math.abs(DIFFICULTY_RANK[e.difficulty] - DIFFICULTY_RANK[source.difficulty]),
    ];
  };
  const compare = (a: number[], b: number[]): number => {
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return (a[i] as number) < (b[i] as number) ? -1 : 1;
    return 0;
  };
  return LIBRARY.filter((e) => e.pattern === pattern && e.id !== source?.id && !e.specialty && allowed.includes(e.equipment))
    .map((e) => ({ e, key: rank(e) }))
    .sort((a, b) => compare(a.key, b.key))
    .slice(0, Math.max(0, limit))
    .map(({ e }) => e);
}
