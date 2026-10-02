// The per-tracking-mode double-progression rules behind progression.ts.
// Each rule reads the latest exposure (already reduced to a Session) and the
// pain / stall gates, and returns the next target. Loads are kg, rounded to
// what can be loaded in the athlete's units.
//
// Ported from the mode branches of buildExercisePrescription in
// src/progressionEngine.js @ c955d5a. Deliberate changes:
//   - Bodyweight moves have their own rule. v19 sent them down the loaded
//     path, where a pain or stall "reduce" computed max(step, 0 − step) and
//     prescribed +5 lb of added load. Now pain/stall reduce the added load or,
//     unloaded, back the reps off to the floor; the top of the range holds and
//     points to a harder variation instead of inventing load.
//   - Holds progress 5 s at a time (v19 added 1 s) and hold or reduce on pain
//     (v19 kept adding time, with only a caution).
//   - Carries read distance or time from the set and progress load once every
//     carry reaches the top (v19 compared the empty reps field, so a carry
//     could never earn more load).
//   - No RIR or set-quality gate (the data is not modelled in v2).
//   - Reductions round DOWN and never exceed the last load; increases round
//     to the nearest loadable weight.

import type { SetLog, Tier, TrackingMode } from "../day/schema";
import { floorTo, formatWeight, fromDisplayWeight, loadIncrement, roundTo, toDisplayWeight, type UnitSystem } from "../units";
import { fromDisplayCarry, isPositive, parseRepRange, toDisplayCarry, type RepRange } from "./sets";

export type PrescriptionStatus = "baseline" | "progress" | "hold" | "reduce";

/** One exposure reduced to what the rules read. */
export interface Session {
  dateKey: string;
  tier?: Tier;
  /** Completed planned sets (extra sets excluded), in logged order. */
  sets: SetLog[];
  /** Any set flagged pain (banked or not), or the exercise was skipped for pain. */
  pain: boolean;
  /** Heaviest load used (added load for bodyweight moves); 0 when none. */
  weightKg: number;
  reps: number[];
  totalReps: number;
  /** Best straight-set e1RM; 0 when none. */
  bestE1rm: number;
}

export interface RuleContext {
  mode: TrackingMode;
  /** The prescription as written ("8–10", "30-45 s", "40"). */
  rawReps: string | number;
  /** rawReps parsed with the mode's default range. */
  range: RepRange;
  targetSets: number;
  units: UnitSystem;
  stepKg: number;
  last: Session | null;
  pain: boolean;
  stalled: boolean;
}

export interface RuleResult {
  status: PrescriptionStatus;
  /** Working load; added load for bodyweight moves and holds. Null: none / athlete's choice. */
  weightKg: number | null;
  assistanceKg?: number | null;
  reps: number[] | null;
  seconds?: number[];
  distanceM?: number[];
  reason: string;
  caution?: string;
}

const EPS = 1e-6;
/** Seconds added to one hold per progression. */
export const HOLD_STEP_S = 5;
/** Yards / metres / seconds added to one carry per progression. */
export const CARRY_STEP = 5;

const PAIN_REASON = "Pain was flagged last time. Back off and use only pain-free, controlled work.";
const PAIN_CAUTION = "Stop the movement if pain persists or worsens; use a substitution instead.";
const FIRST_AFTER_PAIN = "Pain was flagged last time. Start light and stop if it returns.";

const fill = (n: number, value: number): number[] => Array.from({ length: n }, () => value);
const orNull = (kg: number): number | null => (kg > EPS ? kg : null);

/** Every one of the first `n` values reached `threshold` (and there were `n`). */
const hitAll = (values: readonly number[], n: number, threshold: number): boolean =>
  values.length >= n && values.slice(0, n).every((v) => v >= threshold);

/** Last values clamped to the range, with `step` added to the first one below the top. */
function nextTargets(values: readonly number[], range: RepRange, n: number, step: number): number[] {
  let added = false;
  return Array.from({ length: n }, (_, i) => {
    const v = Math.max(range.min, Math.min(range.max, values[i] || range.min));
    if (added || v >= range.max) return v;
    added = true;
    return Math.min(range.max, v + step);
  });
}

/** Back off to the floor of the range, never above what was done. */
const backOff = (values: readonly number[], range: RepRange, n: number): number[] =>
  Array.from({ length: n }, (_, i) => Math.min(values[i] ?? range.min, range.min));

const lowered = (next: readonly number[], prev: readonly number[]): boolean => next.some((v, i) => v < (prev[i] ?? Infinity));

function stepUp(kg: number, ctx: RuleContext): number {
  const display = roundTo(toDisplayWeight(kg + ctx.stepKg, ctx.units), loadIncrement(ctx.units));
  return fromDisplayWeight(display, ctx.units);
}

function stepDown(kg: number, ctx: RuleContext, floorKg: number): number {
  const display = floorTo(toDisplayWeight(kg - ctx.stepKg, ctx.units), loadIncrement(ctx.units));
  return Math.min(kg, Math.max(floorKg, fromDisplayWeight(display, ctx.units)));
}

const reduceOrHold = (next: number, prev: number): PrescriptionStatus => (next < prev - EPS ? "reduce" : "hold");

function baseline(ctx: RuleContext, values: Partial<RuleResult>, what: string): RuleResult {
  return {
    status: "baseline",
    weightKg: null,
    reps: null,
    reason: `Establish a clean baseline ${what} before the targets change.`,
    ...(ctx.pain ? { caution: FIRST_AFTER_PAIN } : {}),
    ...values,
  };
}

function loadedRule(ctx: RuleContext): RuleResult {
  const { last, range, targetSets: n, units } = ctx;
  if (!last) return baseline(ctx, { reps: fill(n, range.min) }, `inside ${range.min}–${range.max} reps`);
  const load = last.weightKg;
  if (ctx.pain || ctx.stalled) {
    const weightKg = stepDown(load, ctx, ctx.stepKg);
    const reason = ctx.pain
      ? PAIN_REASON
      : `Three exposures at ${formatWeight(load, units)} produced no meaningful rep or strength gain. Take one step back and rebuild.`;
    return { status: reduceOrHold(weightKg, load), weightKg, reps: fill(n, range.min), reason, ...(ctx.pain ? { caution: PAIN_CAUTION } : {}) };
  }
  if (hitAll(last.reps, n, range.max)) {
    return { status: "progress", weightKg: stepUp(load, ctx), reps: fill(n, range.min), reason: `All ${n} sets reached ${range.max} reps. Add the smallest load step.` };
  }
  const reps = nextTargets(last.reps, range, n, 1);
  return hitAll(last.reps, n, range.min)
    ? { status: "progress", weightKg: load, reps, reason: "Keep the load and add one rep." }
    : { status: "hold", weightKg: load, reps, reason: `Repeat ${formatWeight(load, units)} until every set reaches at least ${range.min} reps.` };
}

function bodyweightRule(ctx: RuleContext): RuleResult {
  const { last, range, targetSets: n } = ctx;
  if (!last) return baseline(ctx, { reps: fill(n, range.min) }, `inside ${range.min}–${range.max} reps`);
  const load = last.weightKg;
  if (ctx.pain || ctx.stalled) {
    const reason = ctx.pain ? PAIN_REASON : "Three exposures without a rep gain. Drop back to the floor of the range and rebuild.";
    const caution = ctx.pain ? { caution: PAIN_CAUTION } : {};
    if (load > EPS) {
      const weightKg = stepDown(load, ctx, 0);
      return { status: reduceOrHold(weightKg, load), weightKg: orNull(weightKg), reps: fill(n, range.min), reason, ...caution };
    }
    const reps = backOff(last.reps, range, n);
    return { status: lowered(reps, last.reps) ? "reduce" : "hold", weightKg: null, reps, reason, ...caution };
  }
  if (hitAll(last.reps, n, range.max)) {
    if (load > EPS) {
      return { status: "progress", weightKg: stepUp(load, ctx), reps: fill(n, range.min), reason: `All ${n} sets reached ${range.max} reps. Add the smallest load step.` };
    }
    return { status: "hold", weightKg: null, reps: fill(n, range.max), reason: "Every set reached the top of the range. Move to a harder variation (or add load) to keep progressing." };
  }
  const reps = nextTargets(last.reps, range, n, 1);
  const status = hitAll(last.reps, n, range.min) ? "progress" : "hold";
  return { status, weightKg: orNull(load), reps, reason: status === "progress" ? "Add one rep." : `Repeat until every set reaches at least ${range.min} reps.` };
}

function timedRule(ctx: RuleContext): RuleResult {
  const { last, range, targetSets: n } = ctx;
  if (!last) return baseline(ctx, { seconds: fill(n, range.min) }, `at ${range.min} s holds`);
  const secs = last.sets.map((s) => s.seconds ?? 0);
  const weightKg = orNull(last.weightKg);
  if (ctx.pain) {
    const seconds = backOff(secs, range, n);
    return { status: lowered(seconds, secs) ? "reduce" : "hold", weightKg, reps: null, seconds, reason: PAIN_REASON, caution: PAIN_CAUTION };
  }
  if (hitAll(secs, n, range.max)) {
    return { status: "hold", weightKg, reps: null, seconds: fill(n, range.max), reason: "Every hold reached the top of the range. Add load or move to a harder variation." };
  }
  const status = hitAll(secs, n, range.min) ? "progress" : "hold";
  return { status, weightKg, reps: null, seconds: nextTargets(secs, range, n, HOLD_STEP_S), reason: `Add ${HOLD_STEP_S} s to one hold while keeping position clean.` };
}

function assistedRule(ctx: RuleContext): RuleResult {
  const { last, range, targetSets: n, units } = ctx;
  if (!last) return baseline(ctx, { assistanceKg: null, reps: fill(n, range.min) }, `inside ${range.min}–${range.max} reps`);
  const assist = last.sets[0]?.assistanceKg ?? 0;
  if (ctx.pain) {
    return { status: "reduce", weightKg: null, assistanceKg: stepUp(assist, ctx), reps: fill(n, range.min), reason: PAIN_REASON, caution: PAIN_CAUTION };
  }
  if (hitAll(last.reps, n, range.max)) {
    if (assist > EPS) {
      const next = stepDown(assist, ctx, 0);
      return { status: "progress", weightKg: null, assistanceKg: orNull(next), reps: fill(n, range.min), reason: `All sets reached ${range.max} reps. Remove one step of assistance.` };
    }
    return { status: "hold", weightKg: null, assistanceKg: null, reps: fill(n, range.max), reason: "Every set reached the top with no assistance. Move to the unassisted movement." };
  }
  const status = hitAll(last.reps, n, range.min) ? "progress" : "hold";
  const reason = `Keep ${isPositive(assist) ? `${formatWeight(assist, units)} of assistance` : "the setup"} and add one rep.`;
  return { status, weightKg: null, assistanceKg: orNull(assist), reps: nextTargets(last.reps, range, n, 1), reason };
}

function carryRule(ctx: RuleContext): RuleResult {
  const { last, targetSets: n, units } = ctx;
  if (!last) return baseline(ctx, {}, "load and distance");
  const byDistance = isPositive(last.sets[0]?.distanceM);
  const measures = last.sets.map((s) => (byDistance ? toDisplayCarry(s.distanceM ?? 0, units) : (s.seconds ?? 0)));
  const range = parseRepRange(ctx.rawReps, { min: Math.min(...measures), max: Math.max(...measures) });
  const out = (values: number[]): Partial<RuleResult> =>
    byDistance ? { distanceM: values.map((v) => fromDisplayCarry(v, units)) } : { seconds: values };
  const load = last.weightKg;
  if (ctx.pain) {
    const weightKg = stepDown(load, ctx, ctx.stepKg);
    const held = Array.from({ length: n }, (_, i) => measures[i] ?? range.min);
    return { status: reduceOrHold(weightKg, load), weightKg, reps: null, ...out(held), reason: PAIN_REASON, caution: PAIN_CAUTION };
  }
  if (hitAll(measures, n, range.max)) {
    return { status: "progress", weightKg: stepUp(load, ctx), reps: null, ...out(fill(n, range.min)), reason: "Every carry reached the target. Add the smallest load step." };
  }
  const status = hitAll(measures, n, range.min) ? "progress" : "hold";
  return { status, weightKg: load, reps: null, ...out(nextTargets(measures, range, n, CARRY_STEP)), reason: "Hold the load and go a little further on one carry." };
}

export const RULES: Record<TrackingMode, (ctx: RuleContext) => RuleResult> = {
  loaded_reps: loadedRule,
  bodyweight_reps: bodyweightRule,
  timed_hold: timedRule,
  assisted_reps: assistedRule,
  carry: carryRule,
};
