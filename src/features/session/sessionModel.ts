// The session runner's view and its writes, as pure functions over the day.
// The quest snapshot is the plan (frozen when the session starts); the
// day's workout is what was done. Every tap in the runner becomes one of
// the mutations below applied through updateDay, so two devices editing the
// same day merge by exercise and set id.
import type { DateKey } from "../../domain/dates";
import type { DayMap, DayV2, ExerciseLog, PlannedExercise, QuestSnapshot, SetLog, SkipReason, TrackingMode } from "../../domain/day/schema";
import type { ExerciseMeta } from "../../domain/exercise";
import { judgeTrial } from "../../domain/game/trials";
import type { TrialSpec } from "../../domain/game/types";
import { getExercise, resolveExercise } from "../../domain/program/library";
import type { ProgramDay } from "../../domain/program/types";
import { ghostForSet, targetGhost, type Ghost, type SetValues } from "../../domain/training/ghosts";
import { lastPerformance, suggestRestSeconds, type LastPerformance } from "../../domain/training/liftMath";
import { formatPrescription, prescribe, type Prescription } from "../../domain/training/progression";
import { blankSet, completedPlannedSets, isCompletedSet, isExerciseHandled, modeOf, reconcileSets } from "../../domain/training/sets";
import type { UnitSystem } from "../../domain/units";

export type DotState = "done" | "current" | "planned" | "extra" | "trial" | "pain";

export interface SessionDot {
  state: DotState;
  done?: boolean;
}

export interface SessionExercise {
  id: string;
  /** The planned name. */
  name: string;
  /** The movement performed (the swap when substituted). */
  performedName: string;
  libraryId?: string;
  swapped: boolean;
  mode: TrackingMode;
  plannedSets: number;
  reps: string;
  /** Planned slots first, then extra sets. */
  sets: SetLog[];
  done: number;
  handled: boolean;
  skipped?: SkipReason;
  pain: boolean;
  cue?: string;
  isTrial: boolean;
  dots: SessionDot[];
  /** Index of the set the sticky button completes next; -1 when every set is banked. */
  currentSetIndex: number;
  restSeconds: number;
}

export interface SessionTarget {
  prescription: Prescription | null;
  last: LastPerformance | null;
  /** "Target 80 kg · 8 / 8 / 8 · Last 77.5 kg · 8 / 8 / 8" */
  line: string;
  ghost: Ghost | null;
}

export interface SessionView {
  title: string;
  exercises: SessionExercise[];
  currentIndex: number;
  current: SessionExercise | null;
  target: SessionTarget | null;
  /** Values the steppers open with for the current set. */
  initial: SetValues;
  primary: { key: "set" | "extra" | "next" | "finish"; label: string };
  handledCount: number;
  allHandled: boolean;
  started: boolean;
}

export interface SessionInput {
  day: DayV2 | undefined;
  quest: QuestSnapshot;
  planned: ProgramDay | null;
  days: DayMap;
  todayKey: DateKey;
  units: UnitSystem;
  metaFor: (log: ExerciseLog) => ExerciseMeta;
  /** The exercise on screen; defaults to the first unhandled one. */
  currentIndex?: number | null;
  /** The Rank Trial attached to this day, when its exercise is in the plan. */
  trial?: TrialSpec | null;
  restSeconds?: number;
}

/** The highlighted trial set: the first planned set of the trial exercise. */
export const TRIAL_SET_INDEX = 0;

function logFor(day: DayV2 | undefined, e: PlannedExercise): ExerciseLog {
  return day?.workout.exercises[e.id] ?? { name: e.name, ...(e.libraryId ? { libraryId: e.libraryId } : {}), trackingMode: e.trackingMode, sets: [] };
}

function exerciseView(e: PlannedExercise, day: DayV2 | undefined, planned: ProgramDay | null, trial: TrialSpec | null | undefined, metaFor: SessionInput["metaFor"], restSeconds: number | undefined): SessionExercise {
  const log = logFor(day, e);
  const mode = modeOf(log, e.trackingMode);
  const sets = reconcileSets(e.sets, log.sets);
  const done = completedPlannedSets(log, e.sets, e.trackingMode);
  const handled = isExerciseHandled(log, e.sets, e.trackingMode);
  const swapped = log.performedName !== undefined && log.performedName.trim() !== "" && log.performedName.trim().toLowerCase() !== e.name.trim().toLowerCase();
  const performedName = swapped ? (log.performedName as string).trim() : e.name;
  const isTrial = trial?.exerciseId === e.id && !swapped;
  const firstOpen = sets.findIndex((s) => !isCompletedSet(s, mode));
  const currentSetIndex = log.skipped && log.skipped !== "pain" ? -1 : firstOpen;
  const dots: SessionDot[] = sets.map((s, i) => {
    if (s.pain) return { state: "pain", done: s.done };
    if (s.extra) return { state: "extra", done: s.done };
    if (isTrial && i === TRIAL_SET_INDEX) return { state: "trial", done: isCompletedSet(s, mode) };
    if (isCompletedSet(s, mode)) return { state: "done", done: true };
    return { state: i === currentSetIndex ? "current" : "planned" };
  });
  const cue = planned?.lifting.find((l) => l.id === e.id)?.notes;
  const meta = metaFor(log);
  return {
    id: e.id, name: e.name, performedName, ...(log.libraryId ? { libraryId: log.libraryId } : {}), swapped, mode, plannedSets: e.sets, reps: e.reps, sets, done, handled,
    ...(log.skipped ? { skipped: log.skipped } : {}), pain: log.skipped === "pain" || log.sets.some((s) => s.pain === true), ...(cue ? { cue } : {}), isTrial, dots, currentSetIndex,
    restSeconds: restSeconds ?? suggestRestSeconds(meta, e.reps),
  };
}

function targetFor(ex: SessionExercise, input: SessionInput): SessionTarget {
  const log = logFor(input.day, { id: ex.id, name: ex.name, sets: ex.plannedSets, reps: ex.reps, trackingMode: ex.mode, ...(ex.libraryId ? { libraryId: ex.libraryId } : {}) });
  const meta = input.metaFor(log);
  const movement = ex.swapped ? { name: ex.performedName } : { name: ex.name, ...(ex.libraryId ? { libraryId: ex.libraryId } : {}) };
  const prescription = prescribe({ days: input.days, target: { ...movement, id: ex.id, sets: ex.plannedSets, reps: ex.reps }, meta: { ...meta, trackingMode: ex.mode }, todayKey: input.todayKey, units: input.units });
  const last = lastPerformance(input.days, { ...movement, trackingMode: ex.mode }, input.todayKey, input.units);
  const index = Math.max(0, ex.currentSetIndex);
  const ghost = ghostForSet(ex.sets, index, last ? { dateKey: last.dateKey, sets: last.sets } : null, ex.mode, input.units) ?? targetGhost(prescription, index, input.units);
  const parts: string[] = [];
  if (prescription.status !== "baseline") parts.push(`Target ${formatPrescription(prescription, input.units)}`);
  if (last) parts.push(`Last ${last.label}`);
  return { prescription, last, line: parts.length ? parts.join(" · ") : "First time. Set your own load.", ghost };
}

function initialValues(ex: SessionExercise, target: SessionTarget | null, trial: TrialSpec | null | undefined): SetValues {
  const index = ex.currentSetIndex;
  const existing = index >= 0 ? ex.sets[index] : undefined;
  if (existing && (existing.weightKg != null || existing.reps != null || existing.seconds != null)) {
    return { weightKg: existing.weightKg, reps: existing.reps, seconds: existing.seconds ?? null, distanceM: existing.distanceM ?? null, assistanceKg: existing.assistanceKg ?? null };
  }
  if (ex.isTrial && index === TRIAL_SET_INDEX && trial) {
    return { weightKg: trial.loadKg, reps: trial.reps, seconds: null, distanceM: null, assistanceKg: null };
  }
  if (target?.ghost) return { ...target.ghost.values };
  return { weightKg: null, reps: null, seconds: null, distanceM: null, assistanceKg: null };
}

export function sessionView(input: SessionInput): SessionView {
  const { quest, day } = input;
  const exercises = quest.planned.exercises.map((e) => exerciseView(e, day, input.planned, input.trial, input.metaFor, input.restSeconds));
  const firstUnhandled = exercises.findIndex((e) => !e.handled);
  const requested = input.currentIndex ?? null;
  const currentIndex = requested !== null && requested >= 0 && requested < exercises.length ? requested : firstUnhandled === -1 ? Math.max(0, exercises.length - 1) : firstUnhandled;
  const current = exercises[currentIndex] ?? null;
  const target = current ? targetFor(current, input) : null;
  const handledCount = exercises.filter((e) => e.handled).length;
  const allHandled = exercises.length > 0 && handledCount === exercises.length;
  let primary: SessionView["primary"];
  if (current && current.currentSetIndex >= 0) {
    const set = current.sets[current.currentSetIndex];
    primary = set?.extra ? { key: "extra", label: "Log extra set" } : { key: "set", label: `Complete set ${current.currentSetIndex + 1} of ${current.plannedSets}` };
  } else if (exercises.some((e, i) => i !== currentIndex && !e.handled)) {
    primary = { key: "next", label: "Next exercise" };
  } else {
    primary = { key: "finish", label: "Finish session" };
  }
  return {
    title: input.planned?.title ?? quest.reason,
    exercises, currentIndex, current, target,
    initial: current ? initialValues(current, target, input.trial) : { weightKg: null, reps: null, seconds: null, distanceM: null, assistanceKg: null },
    primary, handledCount, allHandled, started: day?.workout.startedAt !== undefined,
  };
}

/** The next unhandled exercise after `index`, wrapping to the start; -1 when none. */
export function nextExerciseIndex(view: SessionView, index: number): number {
  const n = view.exercises.length;
  for (let step = 1; step <= n; step += 1) {
    const i = (index + step) % n;
    if (!view.exercises[i]?.handled) return i;
  }
  return -1;
}

// ─── Writes ──────────────────────────────────────────────────────────────────

function withLog(day: DayV2, e: PlannedExercise, update: (log: ExerciseLog) => ExerciseLog): DayV2 {
  const log = update(logFor(day, e));
  return { ...day, workout: { ...day.workout, exercises: { ...day.workout.exercises, [e.id]: log } } };
}

/** Freezes the quest on the day and stamps the start, once. */
export function startSession(day: DayV2, quest: QuestSnapshot, nowIso: string): DayV2 {
  return { ...day, quest: day.quest ?? quest, workout: { ...day.workout, startedAt: day.workout.startedAt ?? nowIso } };
}

export function finishSession(day: DayV2, nowIso: string): DayV2 {
  return { ...day, workout: { ...day.workout, completedAt: nowIso } };
}

/**
 * Banks set `index` (planned or extra) with the values entered. In edit mode
 * (a past day) a set that was already banked keeps its original timestamp,
 * so an edit never moves it outside the late-logging window.
 */
export function logSet(day: DayV2, e: PlannedExercise, index: number, values: SetValues, nowIso: string, options: { trial?: boolean; keepCompletedAt?: boolean } = {}): DayV2 {
  return withLog(day, e, (log) => {
    const sets = reconcileSets(e.sets, log.sets);
    while (sets.length <= index) sets.push({ ...blankSet(`s${sets.length + 1}`), extra: true });
    const existing = sets[index] as SetLog;
    const next: SetLog = {
      ...existing,
      weightKg: values.weightKg ?? null,
      reps: values.reps ?? null,
      done: true,
      completedAt: options.keepCompletedAt && existing.completedAt ? existing.completedAt : nowIso,
    };
    if (values.seconds != null) next.seconds = values.seconds;
    else delete next.seconds;
    if (values.distanceM != null) next.distanceM = values.distanceM;
    if (values.assistanceKg != null) next.assistanceKg = values.assistanceKg;
    if (options.trial) next.trial = true;
    sets[index] = next;
    return { ...log, sets };
  });
}

/** Un-banks a set so it can be re-entered; values stay as hints. */
export function unlogSet(day: DayV2, e: PlannedExercise, index: number): DayV2 {
  return withLog(day, e, (log) => {
    const sets = reconcileSets(e.sets, log.sets);
    const existing = sets[index];
    if (!existing) return log;
    const { completedAt: _at, ...rest } = existing;
    sets[index] = { ...rest, done: false };
    return { ...log, sets };
  });
}

export function addExtraSet(day: DayV2, e: PlannedExercise): DayV2 {
  return withLog(day, e, (log) => {
    const sets = reconcileSets(e.sets, log.sets);
    return { ...log, sets: [...sets, { ...blankSet(`s${sets.length + 1}`), extra: true }] };
  });
}

/**
 * Pain on a banked set marks that set; pain on the set in hand ends the
 * exercise for pain (the banked sets stay, the rest are not attempted).
 */
export function flagPain(day: DayV2, e: PlannedExercise, index: number): DayV2 {
  return withLog(day, e, (log) => {
    const sets = reconcileSets(e.sets, log.sets);
    const set = sets[index];
    if (set && set.done) {
      sets[index] = { ...set, pain: true };
      return { ...log, sets };
    }
    return { ...log, sets, skipped: "pain" };
  });
}

export function skipExercise(day: DayV2, e: PlannedExercise, reason: SkipReason): DayV2 {
  return withLog(day, e, (log) => ({ ...log, skipped: reason }));
}

export function unskipExercise(day: DayV2, e: PlannedExercise): DayV2 {
  return withLog(day, e, (log) => {
    const { skipped: _skipped, ...rest } = log;
    return rest;
  });
}

/** Swaps the movement performed; the planned slot keeps its name and sets. */
export function swapExercise(day: DayV2, e: PlannedExercise, performedName: string): DayV2 {
  const trimmed = performedName.trim();
  const library = resolveExercise(trimmed) ?? getExercise(trimmed);
  return withLog(day, e, (log) => {
    if (!trimmed || trimmed.toLowerCase() === e.name.trim().toLowerCase()) {
      const { performedName: _p, ...rest } = log;
      return { ...rest, trackingMode: e.trackingMode };
    }
    return { ...log, performedName: library?.name ?? trimmed, trackingMode: library?.trackingMode ?? log.trackingMode ?? e.trackingMode };
  });
}

/** Judges the day's Rank Trial after a set and records the verdict on the quest. */
export function judgeTrialOnDay(day: DayV2, spec: TrialSpec): DayV2 {
  if (!day.quest?.trial) return day;
  const verdict = judgeTrial(day, spec);
  if (!verdict.attempted) return day;
  return { ...day, quest: { ...day.quest, trial: { ...day.quest.trial, passed: verdict.passed } } };
}
