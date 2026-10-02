// The Rank Trial: one short, safe test on the athlete's most-trained
// movement. Loaded lifts test reps at a share of the 90-day best (never a
// true max, never a hinge), bodyweight athletes test reps then a plank, and
// cardio-only athletes test continuous minutes. Trials are at least a week
// apart, and pain ends one with no penalty.

import { addDays, compareKeys, diffDays, type DateKey } from "../dates";
import type { DayMap, DayV2, ExerciseLog, TrackingMode } from "../day/schema";
import { loadStepKg, strengthGroupOf, type ExerciseMeta, type StrengthGroup } from "../exercise";
import { performedMovement, performedName, sameMovement, type MovementRef } from "../training/history";
import { e1rm } from "../training/liftMath";
import { isRecordEligible } from "../training/records";
import { isCompletedSet, modeOf } from "../training/sets";
import { floorTo, formatDuration, formatWeight, type UnitSystem } from "../units";
import { TRIAL } from "./config";
import type { Rank, TrialSpec } from "./types";

export interface TrialForInput {
  targetRank: Rank;
  days: DayMap;
  todayKey: DateKey;
  metaFor: (log: ExerciseLog) => ExerciseMeta;
  units: UnitSystem;
}

export interface TrialVerdict {
  attempted: boolean;
  passed: boolean;
  reason: string;
}

/** Exposures with pain-free completed work a movement needs before it can be tested. */
export const MIN_EXPOSURES = 3;

/** Loaded trials test these groups only: a heavy hinge under test conditions is the one lift we never ask for. */
const LOADED_GROUPS: readonly StrengthGroup[] = ["squat", "push", "pull"];
const LOAD_TOLERANCE_KG = 0.05;

/** One movement's exposures in the window and the best it produced. */
interface Candidate {
  ref: MovementRef;
  /** The log's key on its latest exposure: the planned slot a trial attaches to. */
  exerciseId: string;
  name: string;
  mode: TrackingMode;
  meta: ExerciseMeta;
  exposures: number;
  /** Best e1RM (loaded) or best reps (bodyweight) from a pain-free completed set. */
  best: number;
}

function bestOf(log: ExerciseLog, mode: TrackingMode): number {
  let best = 0;
  for (const set of log.sets) {
    if (!isRecordEligible(set, mode)) continue;
    const value = mode === "loaded_reps" ? (e1rm(set.weightKg, set.reps) ?? 0) : (set.reps ?? 0);
    if (value > best) best = value;
  }
  return best;
}

function windowDays(input: TrialForInput): [DateKey, DayV2][] {
  const fromKey = addDays(input.todayKey, -(TRIAL.bestWindowDays - 1));
  return Object.keys(input.days)
    .filter((k) => k >= fromKey && k <= input.todayKey)
    .sort(compareKeys)
    .map((k) => [k, input.days[k] as DayV2]);
}

function candidates(input: TrialForInput): Candidate[] {
  const out: Candidate[] = [];
  for (const [, day] of windowDays(input)) {
    for (const [exerciseId, log] of Object.entries(day.workout.exercises)) {
      if (log.skipped) continue;
      const meta = input.metaFor(log);
      const mode = modeOf(log, meta.trackingMode);
      const best = bestOf(log, mode);
      if (best <= 0) continue;
      const name = performedName(log);
      const found = out.find((c) => sameMovement(log, c.ref));
      if (!found) {
        out.push({ ref: performedMovement(log), exerciseId, name, mode, meta, exposures: 1, best });
        continue;
      }
      Object.assign(found, { exerciseId, name, mode, meta, exposures: found.exposures + 1, best: Math.max(found.best, best) });
    }
  }
  return out;
}

/** Most exposures wins; ties go to the higher best. */
const mostTrained = (list: Candidate[]): Candidate | undefined =>
  [...list].sort((a, b) => b.exposures - a.exposures || b.best - a.best)[0];

const isLoadedGroup = (meta: ExerciseMeta): boolean => {
  const group = strengthGroupOf(meta.pattern);
  return group !== null && LOADED_GROUPS.includes(group);
};

const hasCardio = (input: TrialForInput): boolean =>
  windowDays(input).some(([, day]) => day.workout.cardio.some((c) => (c.minutes ?? 0) > 0 || (c.km ?? 0) > 0));

/** The trial to issue for `targetRank` from the last 90 days of training, or null when nothing is testable yet. */
export function trialFor(input: TrialForInput): TrialSpec | null {
  const all = candidates(input);
  const base = { targetRank: input.targetRank, loadKg: null, reps: null, minutes: null };
  const loaded = mostTrained(all.filter((c) => c.mode === "loaded_reps" && c.exposures >= MIN_EXPOSURES && isLoadedGroup(c.meta)));
  if (loaded) {
    const loadKg = floorTo(TRIAL.loadRatio * loaded.best, loadStepKg(loaded.meta, input.units));
    const share = Math.round(TRIAL.loadRatio * 100);
    const spec = `${TRIAL.reps} reps at ${share}% of your best: ${formatWeight(loadKg, input.units)} ${loaded.name}. Stop if anything hurts.`;
    return { ...base, kind: "loaded", exerciseId: loaded.exerciseId, exerciseName: loaded.name, loadKg, reps: TRIAL.reps, spec };
  }
  const bodyweight = mostTrained(all.filter((c) => c.mode === "bodyweight_reps" && c.exposures >= MIN_EXPOSURES));
  if (bodyweight) {
    const reps = Math.ceil(TRIAL.bodyweightRatio * bodyweight.best);
    const spec = `${reps} reps of ${bodyweight.name} in one set, then a plank for as long as you can (up to ${formatDuration(TRIAL.plankCapSeconds)}). Stop if anything hurts.`;
    return { ...base, kind: "bodyweight", exerciseId: bodyweight.exerciseId, exerciseName: bodyweight.name, reps, spec };
  }
  if (hasCardio(input)) {
    const spec = `${TRIAL.cardioMinutes} minutes of continuous cardio, any kind, no pauses. Stop if anything hurts.`;
    return { ...base, kind: "cardio", exerciseId: null, exerciseName: null, minutes: TRIAL.cardioMinutes, spec };
  }
  return null;
}

export function trialAllowedOn(lastTrialDate: DateKey | undefined, dateKey: DateKey): boolean {
  return lastTrialDate === undefined || diffDays(lastTrialDate, dateKey) >= TRIAL.minDaysBetween;
}

const NOT_ATTEMPTED: TrialVerdict = { attempted: false, passed: false, reason: "Not attempted yet." };
const PAIN: TrialVerdict = { attempted: true, passed: false, reason: "Stopped for pain. No penalty." };
const PASSED: TrialVerdict = { attempted: true, passed: true, reason: "Trial passed." };

/** The highlighted trial set, else the first completed set, judged against the prescription. */
function judgeSet(day: DayV2, spec: TrialSpec, mode: TrackingMode): TrialVerdict {
  const log = spec.exerciseId === null ? undefined : day.workout.exercises[spec.exerciseId];
  if (!log) return NOT_ATTEMPTED;
  if (log.skipped === "pain") return PAIN;
  const set = log.sets.find((s) => s.trial === true) ?? log.sets.find((s) => isCompletedSet(s, mode));
  if (!set) return NOT_ATTEMPTED;
  if (set.pain === true) return PAIN;
  if (!isCompletedSet(set, mode)) return NOT_ATTEMPTED;
  const reps = set.reps ?? 0;
  const target = spec.reps ?? 0;
  if (reps < target) return { attempted: true, passed: false, reason: `${reps} of ${target} reps.` };
  if (mode === "loaded_reps" && (set.weightKg ?? 0) < (spec.loadKg ?? 0) - LOAD_TOLERANCE_KG) {
    return { attempted: true, passed: false, reason: "Below the prescribed load." };
  }
  return PASSED;
}

/** One continuous session; the runner already excludes paused time. */
function judgeCardio(day: DayV2, spec: TrialSpec): TrialVerdict {
  const longest = day.workout.cardio.reduce((m, c) => Math.max(m, c.minutes ?? 0), 0);
  if (longest <= 0) return NOT_ATTEMPTED;
  const target = spec.minutes ?? 0;
  return longest >= target ? PASSED : { attempted: true, passed: false, reason: `${longest} of ${target} minutes.` };
}

export function judgeTrial(day: DayV2, spec: TrialSpec): TrialVerdict {
  switch (spec.kind) {
    case "loaded":
      return judgeSet(day, spec, "loaded_reps");
    case "bodyweight":
      return judgeSet(day, spec, "bodyweight_reps");
    case "cardio":
      return judgeCardio(day, spec);
  }
}
