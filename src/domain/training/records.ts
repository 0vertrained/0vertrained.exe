// Strength over time: the e1RM series and trend per lift, and the record
// candidates a finished day produced. Records are judged here; XP for them
// (and any caps) is the game engine's call.
//
// Ported from src/e1rmTrend.js (buildE1RMSeries, detectStall,
// buildLiftIntelligence) and the PR block of src/boxScore.js @ c955d5a.
// Deliberate changes:
//   - The series window is calendar days ending today. v19 sliced the last N
//     entry keys of the whole log, so on a sparse log a "180-day" window
//     reached back years (and forward past today).
//   - The trend verdict and its delta come from the SAME window (best e1RM of
//     the recent half vs the earlier half). v19 judged the last 4 vs prior 4
//     sessions but showed a 30-calendar-day delta, so "progressing" could sit
//     next to a negative delta.
//   - Pain sets never count toward e1RM or records; technique sets (v19
//     drop/myo/rest-pause/partial, kept under legacy.type) still don't.
//   - Records are substitution-aware (v19 compared a swapped movement against
//     the planned lift's history) and cover bodyweight reps (at the same added
//     load) and holds, not just e1RM. A first performance is a baseline, never
//     a record. Thresholds are options: an e1RM record must beat BOTH the
//     ratio and the kg delta (v19: +0.5 lb).
// Cut: buildLiftIntelligence's top-N ranking (a Stats-screen concern).

import { addDays, type DateKey } from "../dates";
import { TRACKING_MODES, type DayMap, type DayV2, type ExerciseLog, type SetLog, type TrackingMode } from "../day/schema";
import type { ExerciseMeta } from "../exercise";
import { formatWeight, round1, type UnitSystem } from "../units";
import { exerciseHistory, normalizeName, performedMovement, performedName, type Exposure, type MovementRef, type TrackedMovement } from "./history";
import { e1rm } from "./liftMath";
import { fmtNumber, isCompletedSet, isStraightSet, modeOf } from "./sets";

/** Performed, pain-free, straight: the only sets that can prove strength. */
export const isRecordEligible = (set: SetLog, mode: TrackingMode): boolean =>
  isCompletedSet(set, mode) && set.pain !== true && isStraightSet(set);

export interface E1rmPoint {
  dateKey: DateKey;
  e1rmKg: number;
}

export interface WindowOptions {
  todayKey: DateKey;
  /** Calendar days ending on (and including) todayKey. */
  windowDays?: number;
}

/** Best e1RM per calendar day for one loaded movement, oldest first. */
export function e1rmSeries(days: DayMap, target: TrackedMovement, { todayKey, windowDays = 180 }: WindowOptions): E1rmPoint[] {
  const fromKey = addDays(todayKey, -(Math.max(1, Math.floor(windowDays)) - 1));
  const best = new Map<DateKey, number>();
  for (const { dateKey, log } of exerciseHistory(days, target, { fromKey, beforeKey: addDays(todayKey, 1) })) {
    if (modeOf(log, target.trackingMode) !== "loaded_reps") continue;
    for (const set of log.sets) {
      const value = isRecordEligible(set, "loaded_reps") ? (e1rm(set.weightKg, set.reps) ?? 0) : 0;
      if (value > (best.get(dateKey) ?? 0)) best.set(dateKey, value);
    }
  }
  return [...best].map(([dateKey, e1rmKg]) => ({ dateKey, e1rmKg }));
}

export type TrendStatus = "building" | "progressing" | "stalled" | "regressing";

export interface LiftTrend {
  status: TrendStatus;
  series: E1rmPoint[];
  windowDays: number;
  /** Latest point in the window. */
  currentKg: number | null;
  earlierBestKg: number | null;
  recentBestKg: number | null;
  /** recentBest − earlierBest: the number shown next to the verdict. */
  deltaKg: number | null;
  deltaPct: number | null;
}

const PROGRESS_RATIO = 1.01;
const REGRESS_RATIO = 0.98;

/**
 * Trend over one calendar window split in half: best e1RM of the recent half
 * vs the earlier half. Needs `minPoints` sessions and two in each half.
 */
export function liftTrend(days: DayMap, target: TrackedMovement, { todayKey, windowDays = 30, minPoints = 4 }: WindowOptions & { minPoints?: number }): LiftTrend {
  const series = e1rmSeries(days, target, { todayKey, windowDays });
  const split = addDays(todayKey, -(Math.floor(windowDays / 2) - 1));
  const recent = series.filter((p) => p.dateKey >= split).map((p) => p.e1rmKg);
  const earlier = series.filter((p) => p.dateKey < split).map((p) => p.e1rmKg);
  const base = { series, windowDays, currentKg: series.at(-1)?.e1rmKg ?? null };
  if (series.length < minPoints || recent.length < 2 || earlier.length < 2) {
    return { ...base, status: "building", earlierBestKg: null, recentBestKg: null, deltaKg: null, deltaPct: null };
  }
  const earlierBestKg = Math.max(...earlier);
  const recentBestKg = Math.max(...recent);
  const ratio = recentBestKg / earlierBestKg;
  const status = ratio >= PROGRESS_RATIO ? "progressing" : ratio <= REGRESS_RATIO ? "regressing" : "stalled";
  return { ...base, status, earlierBestKg, recentBestKg, deltaKg: recentBestKg - earlierBestKg, deltaPct: round1((ratio - 1) * 100) };
}

/** Best record-eligible e1RM in a loaded log; null when it has none. */
export function bestE1rm(log: ExerciseLog, mode: TrackingMode): number | null {
  if (mode !== "loaded_reps") return null;
  const values = log.sets.filter((s) => isRecordEligible(s, mode)).map((s) => e1rm(s.weightKg, s.reps) ?? 0);
  return values.length ? Math.max(...values) : null;
}

// ─── Records ─────────────────────────────────────────────────────────────────

export type RecordKind = "e1rm" | "reps" | "hold";

export interface RecordThresholds {
  /** e1RM must reach previous × minRatio … */
  minRatio: number;
  /** … AND previous + minKgDelta. */
  minKgDelta: number;
  minRepDelta: number;
  minSecondsDelta: number;
}

export const DEFAULT_RECORD_THRESHOLDS: Readonly<RecordThresholds> = { minRatio: 1.01, minKgDelta: 0.5, minRepDelta: 1, minSecondsDelta: 5 };

export interface RecordCandidate {
  exerciseId: string;
  /** The movement performed. */
  name: string;
  kind: RecordKind;
  /** Best comparable value before the day (kg e1RM, reps or seconds); null when nothing compares. */
  previous: number | null;
  current: number;
  /** For "reps": the added load the reps were compared at. */
  loadKg?: number;
  /** Prior exposures with performed work. */
  priorExposures: number;
  /** The best set was logged beyond the plan. */
  fromExtraWork: boolean;
  /** First-ever performance: sets the baseline, never a record. */
  baseline: boolean;
  isRecord: boolean;
  label: string;
}

export interface DetectRecordsInput {
  dateKey: DateKey;
  day: DayV2;
  /** Days strictly before dateKey (later keys are ignored). */
  history: DayMap;
  /** Prior work already summarised (a RecordLedger); `history` is then ignored. */
  prior?: RecordHistory;
  metaFor: (log: ExerciseLog) => ExerciseMeta;
  units: UnitSystem;
  thresholds?: Partial<RecordThresholds>;
}

// ─── Prior work ──────────────────────────────────────────────────────────────
//
// Judging a day needs three facts about each movement's past, not its sets:
// how often it was performed, the best e1RM/hold, and the best reps at each
// added load. buildProgress folds every day of history, so it keeps those in
// a ledger it advances one day at a time instead of re-reading all prior sets
// for every exercise of every day (two years of history: ~600 ms → ~20 ms).

/** What record detection knows about one movement's past, in one mode. */
export interface PriorWork {
  /** Prior logs with performed work. */
  exposures: number;
  /** Best record-eligible e1RM (kg) or hold (s); null when none. */
  best: number | null;
  /** Best record-eligible reps at this added load (bodyweight moves); null when never done there. */
  bestRepsAt(loadKg: number): number | null;
}

export interface RecordHistory {
  prior(movement: MovementRef, mode: TrackingMode): PriorWork;
}

class PriorAcc implements PriorWork {
  exposures = 0;
  best: number | null = null;
  private readonly repsAtLoad: { loadKg: number; reps: number }[] = [];

  bestRepsAt(loadKg: number): number | null {
    let best: number | null = null;
    for (const r of this.repsAtLoad) if (Math.abs(r.loadKg - loadKg) <= LOAD_TOLERANCE_KG && (best === null || r.reps > best)) best = r.reps;
    return best;
  }

  add(log: ExerciseLog, mode: TrackingMode): void {
    const kind = KIND[mode];
    if (!kind || !log.sets.some((s) => isCompletedSet(s, mode))) return;
    this.exposures += 1;
    for (const set of log.sets) {
      if (!isRecordEligible(set, mode)) continue;
      if (kind === "reps") {
        const reps = set.reps ?? 0;
        const same = this.repsAtLoad.find((r) => Math.abs(r.loadKg - loadOf(set)) <= LOAD_TOLERANCE_KG);
        if (same) same.reps = Math.max(same.reps, reps);
        else this.repsAtLoad.push({ loadKg: loadOf(set), reps });
      } else {
        const value = kind === "e1rm" ? (e1rm(set.weightKg, set.reps) ?? 0) : (set.seconds ?? 0);
        if (this.best === null || value > this.best) this.best = value;
      }
    }
  }

  static merge(parts: readonly PriorAcc[]): PriorWork {
    return {
      exposures: parts.reduce((n, p) => n + p.exposures, 0),
      best: parts.reduce<number | null>((b, p) => (p.best === null ? b : b === null ? p.best : Math.max(b, p.best)), null),
      bestRepsAt: (loadKg) => parts.reduce<number | null>((b, p) => {
        const r = p.bestRepsAt(loadKg);
        return r === null ? b : b === null ? r : Math.max(b, r);
      }, null),
    };
  }
}

/** Prior work from a list of exposures (the single-day path). */
export function summarizePrior(exposures: readonly Exposure[], mode: TrackingMode): PriorWork {
  const acc = new PriorAcc();
  for (const e of exposures) if (modeOf(e.log, mode) === mode) acc.add(e.log, mode);
  return acc;
}

/** Prior work read from the days map on demand, strictly before `beforeKey`. */
export function priorFromDays(days: DayMap, beforeKey: DateKey): RecordHistory {
  return { prior: (movement, mode) => summarizePrior(exerciseHistory(days, movement, { beforeKey }), mode) };
}

/**
 * Prior work accumulated day by day. Matching follows sameMovement: a target
 * with a library id matches logs with that id plus id-less logs of the same
 * name; a target without one matches every log of that name. A log without
 * a tracking mode is history in every mode, as exerciseHistory treats it.
 */
export class RecordLedger implements RecordHistory {
  private readonly buckets = new Map<string, PriorAcc>();

  private bucket(key: string): PriorAcc {
    let acc = this.buckets.get(key);
    if (!acc) {
      acc = new PriorAcc();
      this.buckets.set(key, acc);
    }
    return acc;
  }

  /** Fold one finished day in; call after the day has been judged. */
  add(day: DayV2): void {
    for (const log of Object.values(day.workout.exercises)) {
      const ref = performedMovement(log);
      const name = normalizeName(ref.name);
      for (const mode of log.trackingMode ? [log.trackingMode] : TRACKING_MODES) {
        this.bucket(`${mode}|name:${name}`).add(log, mode);
        this.bucket(ref.libraryId ? `${mode}|id:${ref.libraryId}` : `${mode}|noid:${name}`).add(log, mode);
      }
    }
  }

  prior(movement: MovementRef, mode: TrackingMode): PriorWork {
    const name = normalizeName(movement.name);
    const keys = movement.libraryId ? [`${mode}|id:${movement.libraryId}`, `${mode}|noid:${name}`] : [`${mode}|name:${name}`];
    return PriorAcc.merge(keys.map((k) => this.buckets.get(k)).filter((a): a is PriorAcc => a !== undefined));
  }
}

const KIND: Partial<Record<TrackingMode, RecordKind>> = { loaded_reps: "e1rm", bodyweight_reps: "reps", timed_hold: "hold" };
const EPS = 1e-9;
const LOAD_TOLERANCE_KG = 0.05;
const loadOf = (s: SetLog): number => s.weightKg ?? 0;
/** Ties go to planned work, so extra sets only "own" a record they alone set. */
const beats = (value: number, set: SetLog, best: { value: number; set: SetLog } | null): boolean =>
  !best || value > best.value || (value === best.value && best.set.extra === true && set.extra !== true);

function bestBy(sets: readonly SetLog[], score: (s: SetLog) => number): { value: number; set: SetLog } | null {
  let best: { value: number; set: SetLog } | null = null;
  for (const set of sets) if (beats(score(set), set, best)) best = { value: score(set), set };
  return best;
}

type Compared = Pick<RecordCandidate, "previous" | "current" | "fromExtraWork" | "loadKg">;

function compareValue(today: readonly SetLog[], prior: PriorWork, score: (s: SetLog) => number): Compared {
  const now = bestBy(today, score) as { value: number; set: SetLog };
  return { previous: prior.best, current: now.value, fromExtraWork: now.set.extra === true };
}

/** Bodyweight: the set that improves most on the best reps ever done at its added load. */
function compareReps(today: readonly SetLog[], prior: PriorWork): Compared {
  let best: { value: number; set: SetLog; previous: number } | null = null;
  for (const set of today) {
    const previous = prior.bestRepsAt(loadOf(set));
    if (previous === null) continue;
    if (beats((set.reps ?? 0) - previous, set, best)) best = { value: (set.reps ?? 0) - previous, set, previous };
  }
  if (best) return { previous: best.previous, current: best.set.reps ?? 0, loadKg: loadOf(best.set), fromExtraWork: best.set.extra === true };
  const top = bestBy(today, (s) => loadOf(s) * 1000 + (s.reps ?? 0)) as { value: number; set: SetLog };
  return { previous: null, current: top.set.reps ?? 0, loadKg: loadOf(top.set), fromExtraWork: top.set.extra === true };
}

function improved(kind: RecordKind, previous: number, current: number, t: RecordThresholds): boolean {
  const gain = current - previous;
  if (kind === "e1rm") return current >= previous * t.minRatio - EPS && gain >= t.minKgDelta - EPS;
  return gain >= (kind === "reps" ? t.minRepDelta : t.minSecondsDelta) - EPS;
}

/** "e1RM 259.7 lb (was 234.3 lb)", "+25 lb × 8 (was 6)", "65 s · baseline". */
function labelFor(kind: RecordKind, c: Compared, baseline: boolean, units: UnitSystem): string {
  const value = (v: number): string => (kind === "e1rm" ? formatWeight(v, units) : kind === "hold" ? `${fmtNumber(round1(v))} s` : String(v));
  const load = (c.loadKg ?? 0) > 0 ? `+${formatWeight(c.loadKg, units)}` : "BW";
  const head = kind === "e1rm" ? `e1RM ${value(c.current)}` : kind === "reps" ? `${load} × ${c.current}` : value(c.current);
  if (baseline) return `${head} · baseline`;
  return c.previous === null ? head : `${head} (was ${value(c.previous)})`;
}

/** One candidate per exercise with record-eligible work; `isRecord` says whether it counts. */
export function detectRecords(input: DetectRecordsInput): RecordCandidate[] {
  const thresholds = { ...DEFAULT_RECORD_THRESHOLDS, ...input.thresholds };
  const history = input.prior ?? priorFromDays(input.history, input.dateKey);
  const out: RecordCandidate[] = [];
  for (const [exerciseId, log] of Object.entries(input.day.workout.exercises)) {
    const mode = modeOf(log, input.metaFor(log).trackingMode);
    const kind = KIND[mode];
    const today = log.sets.filter((s) => isRecordEligible(s, mode));
    if (log.skipped || !kind || today.length === 0) continue;
    const prior = history.prior(performedMovement(log), mode);
    const compared = kind === "reps"
      ? compareReps(today, prior)
      : compareValue(today, prior, kind === "e1rm" ? (s) => e1rm(s.weightKg, s.reps) ?? 0 : (s) => s.seconds ?? 0);
    const baseline = prior.exposures === 0;
    const isRecord = !baseline && compared.previous !== null && improved(kind, compared.previous, compared.current, thresholds);
    out.push({ exerciseId, name: performedName(log), kind, ...compared, priorExposures: prior.exposures, baseline, isRecord, label: labelFor(kind, compared, baseline, input.units) });
  }
  return out;
}
