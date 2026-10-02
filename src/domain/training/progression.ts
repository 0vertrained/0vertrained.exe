// Double progression: the next target for one exercise from its own history.
// Suggest-only: it reads completed work, needs repeated evidence before it
// calls a stall, and never writes anything back.
//
// Ported from src/progressionEngine.js @ c955d5a (buildExercisePrescription,
// getExerciseSessions, detectStall, formatPrescription). Deliberate changes:
//   - Bodyweight moves hold or reduce on pain or stall (see progressionRules).
//   - RIR and set-quality gates are gone with the data; pain gating stays and
//     is wider: a pain flag on ANY set (banked or not) or a skip for pain
//     counts. v19 only saw pain on banked sets and ignored pain skips, so the
//     next session could progress straight past them.
//   - Exposures from days issued as REDUCED or RECOVER never count toward the
//     three-exposure stall gate: a scaled day is not evidence of a stall. They
//     are still history (last time, ghosts, the latest exposure).
//   - Targets are kg rounded to loadable steps in the athlete's units
//     (loadStepKg: 5/10 lb or 2.5/5 kg), not "+5" in whatever unit was typed.
//   - Nothing is persisted: v19 stored progressionDecision/nextPrescription
//     on the day and never read them back. `includeToday` previews next time.
//   - History is the movement performed (history.ts) over the last 120
//     calendar days; extra sets are not plan evidence.
// Cut: buildProgressionDecision (write-only) and buildStrengthRetentionAlert.

import { addDays, type DateKey } from "../dates";
import type { DayMap, TrackingMode } from "../day/schema";
import { loadStepKg, type ExerciseMeta } from "../exercise";
import { formatWeight, type UnitSystem } from "../units";
import { exerciseHistory, type Exposure, type MovementRef } from "./history";
import { e1rm, performanceLabel } from "./liftMath";
import { RULES, type RuleResult, type Session } from "./progressionRules";
import { carryUnit, isCompletedSet, isStraightSet, modeOf, parseRepRange, toDisplayCarry } from "./sets";

export type { PrescriptionStatus, Session } from "./progressionRules";
export type Confidence = "low" | "medium" | "high";

export interface ProgressionTarget extends MovementRef {
  id?: string;
  sets: number;
  /** As programmed: "8–10", "5", "30-45 s". */
  reps: string | number;
}

export interface PrescribeInput {
  days: DayMap;
  /** The movement to be performed (the swap, when the athlete substituted). */
  target: ProgressionTarget;
  meta: ExerciseMeta;
  todayKey: DateKey;
  units: UnitSystem;
  /** Count today's log as the latest exposure: "what's the target next time?". */
  includeToday?: boolean;
}

export interface Prescription extends RuleResult {
  mode: TrackingMode;
  confidence: Confidence;
  /** The exposure the target was built from. */
  basis: { dateKey: DateKey; label: string } | null;
}

export const LOOKBACK_DAYS = 120;
export const STALL_EXPOSURES = 3;
/** A gain this large in total reps or best e1RM, between any two of the sampled exposures, is progress. */
const STALL_REP_GAIN = 2;
const STALL_E1RM_GAIN_KG = 1;
const DEFAULT_REPS = { min: 8, max: 12 };
const DEFAULT_HOLD_SECONDS = { min: 30, max: 45 };

function summarize(exposure: Exposure, fallbackMode: TrackingMode): Session {
  const { dateKey, tier, log } = exposure;
  const mode = modeOf(log, fallbackMode);
  const sets = log.sets.filter((s) => !s.extra && isCompletedSet(s, mode));
  const reps = sets.map((s) => s.reps ?? 0);
  const session: Session = {
    dateKey,
    sets,
    pain: log.skipped === "pain" || log.sets.some((s) => s.pain === true),
    weightKg: Math.max(0, ...sets.map((s) => s.weightKg ?? 0)),
    reps,
    totalReps: reps.reduce((sum, r) => sum + r, 0),
    bestE1rm: Math.max(0, ...sets.filter(isStraightSet).map((s) => e1rm(s.weightKg, s.reps) ?? 0)),
  };
  return tier ? { ...session, tier } : session;
}

/**
 * Three full, pain-free exposures (newest first, scaled days skipped) at the
 * same load with no meaningful rep or e1RM gain between any of them. One bad
 * day after progress can never trigger it.
 */
export function isStalled(performed: readonly Session[], targetSets: number): boolean {
  const sample = performed.filter((s) => s.tier !== "REDUCED" && s.tier !== "RECOVER").slice(0, STALL_EXPOSURES);
  if (sample.length < STALL_EXPOSURES) return false;
  if (sample.some((s) => s.sets.length < targetSets || s.pain)) return false;
  const [a, b, c] = sample as [Session, Session, Session];
  const loads = [a.weightKg, b.weightKg, c.weightKg];
  if (Math.max(...loads) - Math.min(...loads) >= 0.01) return false;
  const gains = [
    [a.totalReps - Math.min(b.totalReps, c.totalReps), STALL_REP_GAIN],
    [b.totalReps - c.totalReps, STALL_REP_GAIN],
    [a.bestE1rm - Math.max(b.bestE1rm, c.bestE1rm), STALL_E1RM_GAIN_KG],
    [b.bestE1rm - c.bestE1rm, STALL_E1RM_GAIN_KG],
  ] as const;
  return gains.every(([gain, threshold]) => gain < threshold);
}

const confidenceFor = (exposures: number): Confidence => (exposures >= 4 ? "high" : exposures >= 2 ? "medium" : "low");

/** The next target for one exercise. */
export function prescribe(input: PrescribeInput): Prescription {
  const { days, target, meta, todayKey, units } = input;
  const mode = meta.trackingMode;
  const range = parseRepRange(target.reps, mode === "timed_hold" ? DEFAULT_HOLD_SECONDS : DEFAULT_REPS);
  const targetSets = Math.max(1, Math.floor(target.sets) || 1);
  const beforeKey = input.includeToday ? addDays(todayKey, 1) : todayKey;
  const sessions = exerciseHistory(days, target, { beforeKey, fromKey: addDays(todayKey, -LOOKBACK_DAYS) })
    .map((e) => summarize(e, mode))
    .reverse();
  const lastIndex = sessions.findIndex((s) => s.sets.length > 0);
  const last = sessions[lastIndex] ?? null;
  // Pain counts from the latest performed exposure onward (incl. later pain skips).
  const pain = sessions.slice(0, lastIndex === -1 ? sessions.length : lastIndex + 1).some((s) => s.pain);
  const performed = sessions.filter((s) => s.sets.length > 0);
  const stalled = (mode === "loaded_reps" || mode === "bodyweight_reps") && isStalled(performed, targetSets);
  const result = RULES[mode]({ mode, rawReps: target.reps, range, targetSets, units, stepKg: loadStepKg(meta, units), last, pain, stalled });
  return {
    ...result,
    mode,
    confidence: confidenceFor(performed.length),
    basis: last ? { dateKey: last.dateKey, label: performanceLabel(last.sets, mode, units) } : null,
  };
}

const list = (values: readonly number[]): string => values.join(" / ");

/** "80 lb · 8 / 8 / 8", "+30 lb · 8 / 8 / 8", "35 lb assist · 6 / 6", "30 / 30 s", "70 lb · 40 / 30 yd". */
export function formatPrescription(p: Prescription, units: UnitSystem): string {
  const reps = list(p.reps ?? []);
  const load = p.weightKg == null ? null : formatWeight(p.weightKg, units);
  switch (p.mode) {
    case "timed_hold":
      return `${load ? `+${load} · ` : ""}${list(p.seconds ?? [])} s`;
    case "carry": {
      if (!load) return "No target yet";
      return `${load} · ${p.distanceM ? `${list(p.distanceM.map((m) => toDisplayCarry(m, units)))} ${carryUnit(units)}` : `${list(p.seconds ?? [])} s`}`;
    }
    case "assisted_reps":
      return `${p.assistanceKg ? `${formatWeight(p.assistanceKg, units)} assist` : "BW"} · ${reps}`;
    case "bodyweight_reps":
      return `${load ? `+${load}` : "BW"} · ${reps}`;
    case "loaded_reps":
      return load ? `${load} · ${reps}` : `${p.reps?.length ?? 0} sets · ${reps}`;
  }
}
