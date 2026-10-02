// Builders for game-engine tests: programs, logged days and check-ins in
// the v2 shapes, so a test reads as the scenario it describes.
import type { DateKey } from "../domain/dates";
import { WEEKDAYS, type Weekday } from "../domain/dates";
import { emptyDay, type CheckIn, type DayV2, type ExerciseLog, type QuestSnapshot, type SetLog, type TrackingMode } from "../domain/day/schema";
import { guessMeta } from "../domain/exercise";
import type { ExerciseMeta } from "../domain/exercise";
import { restDay, type PlannedCardio, type PlannedLift, type ProgramDay, type ProgramPayloadV2, type ProgramWeek } from "../domain/program/types";

export interface LiftSpec {
  id: string;
  name?: string;
  sets?: number;
  reps?: string;
  mode?: TrackingMode;
  libraryId?: string;
}

export function lift(spec: LiftSpec): PlannedLift {
  const name = spec.name ?? spec.id;
  return {
    id: spec.id,
    name,
    ...(spec.libraryId ? { libraryId: spec.libraryId } : {}),
    sets: spec.sets ?? 3,
    reps: spec.reps ?? "8",
    trackingMode: spec.mode ?? guessMeta(name).trackingMode,
  };
}

export function trainingDay(title: string, lifts: LiftSpec[], cardio: PlannedCardio | null = null): ProgramDay {
  return { title, rest: false, lifting: lifts.map(lift), cardio };
}

export const REST: ProgramDay = restDay();

/** A week from a partial map; unspecified days rest. */
export function week(days: Partial<Record<Weekday, ProgramDay>>): ProgramWeek {
  const out = {} as ProgramWeek;
  for (const d of WEEKDAYS) out[d] = days[d] ?? REST;
  return out;
}

export function program(w: ProgramWeek, effectiveFrom: DateKey = "1970-01-01"): ProgramPayloadV2 {
  return { v: 2, revisions: [{ effectiveFrom, source: "custom", week: w }] };
}

/** Three training days: Mon / Wed / Fri, 4 lifts × 3 sets each. */
export function threeDayProgram(): ProgramPayloadV2 {
  const lifts = [{ id: "squat", name: "Back Squat" }, { id: "bench", name: "Barbell Bench Press" }, { id: "row", name: "Barbell Row" }, { id: "pushup", name: "Push-Ups" }];
  const day = (t: string) => trainingDay(t, lifts);
  return program(week({ Monday: day("Full A"), Wednesday: day("Full B"), Friday: day("Full C") }));
}

export interface SetSpec {
  weightKg?: number | null;
  reps?: number | null;
  seconds?: number;
  done?: boolean;
  completedAt?: string;
  pain?: boolean;
  extra?: boolean;
  trial?: boolean;
}

export function set(index: number, spec: SetSpec = {}): SetLog {
  const s: SetLog = { id: `s${index + 1}`, weightKg: spec.weightKg === undefined ? 60 : spec.weightKg, reps: spec.reps === undefined ? 8 : spec.reps, done: spec.done ?? true };
  if (spec.seconds !== undefined) s.seconds = spec.seconds;
  if (spec.completedAt) s.completedAt = spec.completedAt;
  if (spec.pain) s.pain = true;
  if (spec.extra) s.extra = true;
  if (spec.trial) s.trial = true;
  return s;
}

/** n completed sets at the same load/reps (plus optional overrides per set). */
export function doneSets(n: number, spec: SetSpec = {}): SetLog[] {
  return Array.from({ length: n }, (_, i) => set(i, spec));
}

export interface LogSpec {
  name?: string;
  sets: SetLog[];
  skipped?: ExerciseLog["skipped"];
  performedName?: string;
  mode?: TrackingMode;
  libraryId?: string;
}

export function logged(id: string, spec: LogSpec): [string, ExerciseLog] {
  const log: ExerciseLog = { name: spec.name ?? id, sets: spec.sets };
  if (spec.skipped) log.skipped = spec.skipped;
  if (spec.performedName) log.performedName = spec.performedName;
  if (spec.mode) log.trackingMode = spec.mode;
  if (spec.libraryId) log.libraryId = spec.libraryId;
  return [id, log];
}

export interface DaySpec {
  exercises?: [string, ExerciseLog][];
  checkin?: CheckIn;
  quest?: QuestSnapshot;
  cardio?: { minutes: number | null; km?: number | null; kind?: string }[];
  recoveryDone?: boolean;
  claimedAt?: string;
}

export function day(spec: DaySpec = {}): DayV2 {
  const d = emptyDay();
  for (const [id, log] of spec.exercises ?? []) d.workout.exercises[id] = log;
  if (spec.checkin) d.checkin = spec.checkin;
  for (const [i, c] of (spec.cardio ?? []).entries()) d.workout.cardio.push({ id: `c${i + 1}`, kind: c.kind ?? "run", minutes: c.minutes, km: c.km ?? null, source: "manual" });
  if (spec.quest) d.quest = spec.quest;
  if (spec.recoveryDone !== undefined || spec.claimedAt) {
    d.quest = { ...(d.quest ?? synthetic("FULL")), ...(spec.recoveryDone !== undefined ? { recoveryDone: spec.recoveryDone } : {}), ...(spec.claimedAt ? { claimedAt: spec.claimedAt } : {}) };
  }
  return d;
}

/** A frozen quest snapshot with the planned work of the fixture's lifts. */
export function snapshot(tier: QuestSnapshot["tier"], lifts: LiftSpec[], extra: Partial<QuestSnapshot> = {}): QuestSnapshot {
  const exercises = lifts.map(lift).map(({ id, name, libraryId, sets, reps, trackingMode }) => ({ id, name, ...(libraryId ? { libraryId } : {}), sets, reps, trackingMode }));
  return {
    rulesVersion: 1,
    tier,
    reason: `${tier} quest`,
    issuedAt: "2026-10-05T06:00:00.000Z",
    engineIssued: true,
    planned: { exercises, plannedSets: exercises.reduce((n, e) => n + e.sets, 0), cardioMinutes: null },
    ...extra,
  };
}

function synthetic(tier: QuestSnapshot["tier"]): QuestSnapshot {
  return snapshot(tier, []);
}

export const CHECKIN_FINE: CheckIn = { sleepQuality: 6, soreness: 5, stress: 5, energy: 6 };
export const CHECKIN_GREAT: CheckIn = { sleepQuality: 9, soreness: 2, stress: 2, energy: 9 };
export const CHECKIN_ROUGH: CheckIn = { sleepQuality: 3, soreness: 8, stress: 5, energy: 6 };
export const CHECKIN_ALL_BAD: CheckIn = { sleepQuality: 3, soreness: 8, stress: 8, energy: 3 };
export const CHECKIN_ILL: CheckIn = { ...CHECKIN_FINE, illness: true };

export const metaFor = (log: ExerciseLog): ExerciseMeta => guessMeta(log.performedName ?? log.name);
