// Merging two copies of the same calendar day: the one this device queued
// (ours) and a newer one the server holds (theirs), against the copy both
// started from (base, when known). Nothing logged on either side is dropped:
// exercises, sets and cardio are unioned by id, and where both sides changed
// the same thing the newer completion wins, else ours. Pure; no clock.

import type { CardioLog, CheckIn, DayV2, ExerciseLog, Legacy, QuestSnapshot, SetLog, WorkoutLog } from "../domain/day/schema";

type Identified = { id: string };
type Stamped = { completedAt?: string; legacy?: Legacy };

/** Unmodelled fields from both sides, the winner's on top. */
function mergeLegacy(winner: Legacy | undefined, loser: Legacy | undefined): Legacy | undefined {
  if (!winner && !loser) return undefined;
  return { ...loser, ...winner };
}

function withLegacy<T extends { legacy?: Legacy }>(value: T, legacy: Legacy | undefined): T {
  const out = { ...value };
  if (legacy) out.legacy = legacy;
  else delete out.legacy;
  return out;
}

/** The side that changed the field since base; ours when both did. */
function changed<T>(base: T | undefined, ours: T, theirs: T): T {
  return ours !== base ? ours : theirs;
}

function instant(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : Number.NaN;
}

/** True when `a` is a later instant than `b` (unparseable stamps compare as text). */
function isLater(a: string, b: string): boolean {
  const am = instant(a);
  const bm = instant(b);
  return Number.isFinite(am) && Number.isFinite(bm) ? am > bm : a > b;
}

/** Of two records with the same id, the one completed later; a missing stamp loses; a tie is ours. */
function newer<T extends Stamped>(ours: T, theirs: T): T {
  let winner = ours;
  let loser = theirs;
  if (ours.completedAt === undefined ? theirs.completedAt !== undefined : theirs.completedAt !== undefined && isLater(theirs.completedAt, ours.completedAt)) {
    winner = theirs;
    loser = ours;
  }
  return withLegacy(winner, mergeLegacy(winner.legacy, loser.legacy));
}

/** Ids in base order, then ours' new ones, then theirs' new ones. */
function orderedIds(base: readonly string[], ours: readonly string[], theirs: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of [...base, ...ours, ...theirs]) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

function mergeById<T extends Identified>(base: readonly T[], ours: readonly T[], theirs: readonly T[], resolve: (o: T, t: T) => T): T[] {
  const byId = (list: readonly T[]) => new Map(list.map((item) => [item.id, item]));
  const o = byId(ours);
  const t = byId(theirs);
  const out: T[] = [];
  for (const id of orderedIds(base.map((b) => b.id), ours.map((x) => x.id), theirs.map((x) => x.id))) {
    const mine = o.get(id);
    const yours = t.get(id);
    if (mine && yours) out.push(resolve(mine, yours));
    else if (mine) out.push(mine);
    else if (yours) out.push(yours);
  }
  return out;
}

const mergeSets = (base: readonly SetLog[], ours: readonly SetLog[], theirs: readonly SetLog[]): SetLog[] => mergeById(base, ours, theirs, newer);
const mergeCardio = (base: readonly CardioLog[], ours: readonly CardioLog[], theirs: readonly CardioLog[]): CardioLog[] => mergeById(base, ours, theirs, newer);

function mergeExercise(base: ExerciseLog | undefined, ours: ExerciseLog, theirs: ExerciseLog): ExerciseLog {
  const out: ExerciseLog = {
    name: changed(base?.name, ours.name, theirs.name),
    sets: mergeSets(base?.sets ?? [], ours.sets, theirs.sets),
  };
  const libraryId = changed(base?.libraryId, ours.libraryId, theirs.libraryId);
  if (libraryId !== undefined) out.libraryId = libraryId;
  const performedName = changed(base?.performedName, ours.performedName, theirs.performedName);
  if (performedName !== undefined) out.performedName = performedName;
  const trackingMode = changed(base?.trackingMode, ours.trackingMode, theirs.trackingMode);
  if (trackingMode !== undefined) out.trackingMode = trackingMode;
  const skipped = changed(base?.skipped, ours.skipped, theirs.skipped);
  if (skipped !== undefined) out.skipped = skipped;
  return withLegacy(out, mergeLegacy(ours.legacy, theirs.legacy));
}

function mergeExercises(base: Record<string, ExerciseLog> | undefined, ours: Record<string, ExerciseLog>, theirs: Record<string, ExerciseLog>): Record<string, ExerciseLog> {
  const out: Record<string, ExerciseLog> = {};
  for (const id of orderedIds(Object.keys(base ?? {}), Object.keys(ours), Object.keys(theirs))) {
    const mine = ours[id];
    const yours = theirs[id];
    if (mine && yours) out[id] = mergeExercise(base?.[id], mine, yours);
    else if (mine) out[id] = mine;
    else if (yours) out[id] = yours;
  }
  return out;
}

/** A defined value beats undefined; where both changed to different values, ours. */
function mergeCheckinField<T>(base: T | undefined, ours: T | undefined, theirs: T | undefined): T | undefined {
  if (ours === theirs) return ours;
  if (ours === undefined) return theirs;
  if (theirs === undefined) return ours;
  return ours === base && theirs !== base ? theirs : ours;
}

const CHECKIN_KEYS = ["sleepQuality", "soreness", "stress", "energy", "illness", "note"] as const;

function mergeCheckin(base: CheckIn | undefined, ours: CheckIn, theirs: CheckIn): CheckIn {
  const out: CheckIn = {};
  for (const key of CHECKIN_KEYS) {
    const value = mergeCheckinField(base?.[key], ours[key], theirs[key]);
    if (value !== undefined) (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

function earliest(a: string | undefined, b: string | undefined): string | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return isLater(a, b) ? b : a;
}

function latest(a: string | undefined, b: string | undefined): string | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return isLater(b, a) ? b : a;
}

function mergeWorkout(base: WorkoutLog | undefined, ours: WorkoutLog, theirs: WorkoutLog): WorkoutLog {
  const out: WorkoutLog = {
    exercises: mergeExercises(base?.exercises, ours.exercises, theirs.exercises),
    cardio: mergeCardio(base?.cardio ?? [], ours.cardio, theirs.cardio),
  };
  const startedAt = earliest(ours.startedAt, theirs.startedAt);
  if (startedAt !== undefined) out.startedAt = startedAt;
  const completedAt = latest(ours.completedAt, theirs.completedAt);
  if (completedAt !== undefined) out.completedAt = completedAt;
  const notes = changed(base?.notes, ours.notes, theirs.notes);
  if (notes !== undefined) out.notes = notes;
  return withLegacy(out, mergeLegacy(ours.legacy, theirs.legacy));
}

/**
 * The quest is a frozen snapshot: the earliest issued copy stands, and only
 * its outcomes (claimed, recovery done, trial passed) take the truthy side.
 */
function mergeQuest(ours: QuestSnapshot | undefined, theirs: QuestSnapshot | undefined): QuestSnapshot | undefined {
  if (!ours || !theirs) return ours ?? theirs;
  const oursFirst = !isLater(ours.issuedAt, theirs.issuedAt);
  const kept = oursFirst ? ours : theirs;
  const other = oursFirst ? theirs : ours;
  const out: QuestSnapshot = { ...kept };
  const claimedAt = kept.claimedAt ?? other.claimedAt;
  if (claimedAt !== undefined) out.claimedAt = claimedAt;
  if (kept.recoveryDone || other.recoveryDone) out.recoveryDone = true;
  const trial = kept.trial ?? other.trial;
  if (trial) {
    out.trial = { ...trial };
    if (kept.trial?.passed || other.trial?.passed) out.trial.passed = true;
  }
  return out;
}

/**
 * Three-way merge of one day. `base` is the copy both sides started from
 * (undefined when unknown, which makes it a plain union with ours winning
 * conflicts). The result is a new object; the inputs are not changed.
 */
export function mergeDay(base: DayV2 | undefined, ours: DayV2, theirs: DayV2): DayV2 {
  const day: DayV2 = {
    v: 2,
    checkin: mergeCheckin(base?.checkin, ours.checkin, theirs.checkin),
    workout: mergeWorkout(base?.workout, ours.workout, theirs.workout),
  };
  const quest = mergeQuest(ours.quest, theirs.quest);
  if (quest) day.quest = quest;
  return withLegacy(day, mergeLegacy(ours.legacy, theirs.legacy));
}
