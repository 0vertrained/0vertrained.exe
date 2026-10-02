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
import type { DayMap, DayV2, ExerciseLog, SetLog, TrackingMode } from "../day/schema";
import type { ExerciseMeta } from "../exercise";
import { formatWeight, round1, type UnitSystem } from "../units";
import { exerciseHistory, performedMovement, performedName, type TrackedMovement } from "./history";
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
  metaFor: (log: ExerciseLog) => ExerciseMeta;
  units: UnitSystem;
  thresholds?: Partial<RecordThresholds>;
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

function compareValue(today: readonly SetLog[], prior: readonly SetLog[], score: (s: SetLog) => number): Compared {
  const now = bestBy(today, score) as { value: number; set: SetLog };
  return { previous: bestBy(prior, score)?.value ?? null, current: now.value, fromExtraWork: now.set.extra === true };
}

/** Bodyweight: the set that improves most on the best reps ever done at its added load. */
function compareReps(today: readonly SetLog[], prior: readonly SetLog[]): Compared {
  let best: { value: number; set: SetLog; previous: number } | null = null;
  for (const set of today) {
    const same = prior.filter((p) => Math.abs(loadOf(p) - loadOf(set)) <= LOAD_TOLERANCE_KG).map((p) => p.reps ?? 0);
    if (!same.length) continue;
    const previous = Math.max(...same);
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
  const out: RecordCandidate[] = [];
  for (const [exerciseId, log] of Object.entries(input.day.workout.exercises)) {
    const mode = modeOf(log, input.metaFor(log).trackingMode);
    const kind = KIND[mode];
    const today = log.sets.filter((s) => isRecordEligible(s, mode));
    if (log.skipped || !kind || today.length === 0) continue;
    const prior = exerciseHistory(input.history, performedMovement(log), { beforeKey: input.dateKey }).filter((e) => modeOf(e.log, mode) === mode);
    const priorExposures = prior.filter((e) => e.log.sets.some((s) => isCompletedSet(s, mode))).length;
    const priorSets = prior.flatMap((e) => e.log.sets.filter((s) => isRecordEligible(s, mode)));
    const compared = kind === "reps"
      ? compareReps(today, priorSets)
      : compareValue(today, priorSets, kind === "e1rm" ? (s) => e1rm(s.weightKg, s.reps) ?? 0 : (s) => s.seconds ?? 0);
    const baseline = priorExposures === 0;
    const isRecord = !baseline && compared.previous !== null && improved(kind, compared.previous, compared.current, thresholds);
    out.push({ exerciseId, name: performedName(log), kind, ...compared, priorExposures, baseline, isRecord, label: labelFor(kind, compared, baseline, input.units) });
  }
  return out;
}
