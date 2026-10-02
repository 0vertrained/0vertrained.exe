// Lift math for the logging screen: estimated 1RM, "last time", plate math
// and a default rest.
//
// Ported from src/sessionIntelligence.js @ c955d5a. Deliberate changes:
//   - e1rm clamps reps at 12 (v19 returned null above 12, so a 15-rep set had
//     no estimate at all) and has no RIR adjustment (RIR is not modelled in
//     v2). A single is still its own max. Values stay unrounded kg.
//   - lastPerformance is substitution-aware through history.ts, reads every
//     tracking mode (v19 required a weight, so bodyweight work had no "last
//     time") and has no 60-entry lookback.
//   - plateMath runs only for barbell lifts: v19 assumed a 45 lb bar under
//     anything ≥ 45 lb, dumbbells and machines included. Metric athletes get a
//     20 kg bar and kg plates.
//   - suggestRestSeconds reads the movement pattern instead of name keywords.
// Cut: effectiveE1RM (RIR), buildProgressionHint (progression.ts owns targets)
// and buildWarmupRamp.

import type { DateKey } from "../dates";
import type { DayMap, SetLog, TrackingMode } from "../day/schema";
import { strengthGroupOf, type ExerciseMeta } from "../exercise";
import { toDisplayWeight, weightUnit, type UnitSystem } from "../units";
import { exerciseHistory, type TrackedMovement } from "./history";
import { carryUnit, displayLoad, fmtNumber, isCompletedSet, isPositive, modeOf, parseRepRange, toDisplayCarry } from "./sets";

/** Above this many reps the Epley estimate stops tracking strength. */
export const E1RM_REP_CAP = 12;

/** Estimated 1RM (Epley), in the unit of `weightKg`; null without a load and a rep. */
export function e1rm(weightKg: number | null | undefined, reps: number | null | undefined): number | null {
  if (!isPositive(weightKg) || !isPositive(reps) || reps < 1) return null;
  if (reps === 1) return weightKg;
  return weightKg * (1 + Math.min(reps, E1RM_REP_CAP) / 30);
}

export interface LastPerformance {
  dateKey: DateKey;
  mode: TrackingMode;
  /** Completed sets in logged order (extra and pain sets included: it is what happened). */
  sets: SetLog[];
  /** Heaviest load (added load for bodyweight moves); null when none was used. */
  topWeightKg: number | null;
  reps: number[];
  /** "185×8/8/7", "BW×12/10", "60/45 s", "32 kg · 30/25 m". */
  label: string;
}

const join = (values: (number | null | undefined)[]): string => values.map((v) => (isPositive(v) ? fmtNumber(v) : "—")).join("/");

/** Compact summary of an exposure's completed sets in the athlete's units. */
export function performanceLabel(sets: readonly SetLog[], mode: TrackingMode, units: UnitSystem): string {
  const first = sets[0];
  if (!first) return "";
  const unit = weightUnit(units);
  const top = Math.max(0, ...sets.map((s) => s.weightKg ?? 0));
  const reps = join(sets.map((s) => s.reps));
  switch (mode) {
    case "loaded_reps":
      return `${displayLoad(top, units)}×${reps}`;
    case "bodyweight_reps":
      return `${top > 0 ? `+${displayLoad(top, units)} ${unit}` : "BW"}×${reps}`;
    case "assisted_reps":
      return `${isPositive(first.assistanceKg) ? `${displayLoad(first.assistanceKg, units)} ${unit} assist` : "BW"}×${reps}`;
    case "timed_hold":
      return `${top > 0 ? `+${displayLoad(top, units)} ${unit} · ` : ""}${join(sets.map((s) => s.seconds))} s`;
    case "carry": {
      const byDistance = isPositive(first.distanceM);
      const measures = byDistance ? join(sets.map((s) => (isPositive(s.distanceM) ? toDisplayCarry(s.distanceM, units) : null))) : join(sets.map((s) => s.seconds));
      return `${displayLoad(top, units)} ${unit} · ${measures} ${byDistance ? carryUnit(units) : "s"}`;
    }
  }
}

/**
 * The most recent exposure before `beforeKey` with completed work for the
 * movement actually performed. Null when there is none.
 */
export function lastPerformance(days: DayMap, target: TrackedMovement, beforeKey: DateKey, units: UnitSystem): LastPerformance | null {
  const history = exerciseHistory(days, target, { beforeKey });
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const { dateKey, log } = history[i]!;
    const mode = modeOf(log, target.trackingMode);
    const sets = log.sets.filter((s) => isCompletedSet(s, mode));
    if (sets.length === 0) continue;
    const top = Math.max(0, ...sets.map((s) => s.weightKg ?? 0));
    return {
      dateKey,
      mode,
      sets,
      topWeightKg: top > 0 ? top : null,
      reps: sets.map((s) => s.reps ?? 0),
      label: performanceLabel(sets, mode, units),
    };
  }
  return null;
}

const PLATES = { imperial: [45, 35, 25, 10, 5, 2.5], metric: [25, 20, 15, 10, 5, 2.5, 1.25] } as const;
const BAR = { imperial: 45, metric: 20 } as const;

export interface PlateMath {
  unit: "lb" | "kg";
  bar: number;
  /** Plates for ONE side, heaviest first, in `unit`. */
  perSide: number[];
  /** Load per side that can't be made with standard plates. */
  remainder: number;
  label: string;
}

/** Plates per side for a barbell target. Null for non-barbell lifts or targets below the bar. */
export function plateMath(targetKg: number, units: UnitSystem, isBarbell: boolean): PlateMath | null {
  if (!isBarbell || !Number.isFinite(targetKg)) return null;
  const bar = BAR[units];
  const target = toDisplayWeight(targetKg, units);
  if (target < bar) return null;
  let left = (target - bar) / 2;
  const perSide: number[] = [];
  for (const plate of PLATES[units]) {
    while (left >= plate - 1e-9) {
      perSide.push(plate);
      left -= plate;
    }
  }
  const remainder = Math.max(0, Math.round(left * 100) / 100);
  const unit = weightUnit(units);
  const short = remainder > 0 ? ` (+${remainder} ${unit} short)` : "";
  return { unit, bar, perSide, remainder, label: perSide.length ? `${perSide.join(" + ")} / side${short}` : `empty bar${short}` };
}

/** Default rest: heavy compound work earns the longest rest. */
export function suggestRestSeconds(meta: ExerciseMeta, reps: number | string | null | undefined): number {
  const target = parseRepRange(reps, { min: 10, max: 10 }).min;
  const compound = meta.isBarbell || strengthGroupOf(meta.pattern) !== null;
  if (compound && target <= 6) return 180;
  return compound ? 120 : 90;
}
