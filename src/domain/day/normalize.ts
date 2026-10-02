// The single read boundary for stored day payloads.
//
// v1 payloads (the v19 app) are read in place: string numbers become numbers,
// pounds/miles/yards become kg/km/metres, the check-in moves to `checkin`,
// and cardio becomes a list. Every v1 field v20 does not model is kept
// verbatim under a `legacy` key at the same level, so a v1 day saved back by
// v20 loses nothing. v2 payloads are coerced defensively (they come from the
// network and from other devices).

import { lbToKg, miToKm, parseDurationMinutes, ydToM } from "../units";
import {
  SKIP_REASONS,
  TRACKING_MODES,
  emptyDay,
  type CardioLog,
  type CheckIn,
  type DayV2,
  type ExerciseLog,
  type Legacy,
  type QuestSnapshot,
  type SetLog,
  type SkipReason,
  type TrackingMode,
  type WorkoutLog,
} from "./schema";

export interface NormalizeOptions {
  /** Maps a v1 exercise display name to a library id, when known. */
  resolveLibraryId?: (name: string) => string | undefined;
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** v1 numbers were strings; blank, non-numeric or negative values are "not entered". */
export function parseAmount(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  if (typeof v !== "string" && typeof v !== "number") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const isTrue = (v: unknown): boolean => v === true || v === "true";

const hasText = (v: unknown): boolean => typeof v === "number" || (typeof v === "string" && v.trim() !== "");

function pick(source: Obj, consumed: readonly string[]): Legacy | undefined {
  const rest: Legacy = {};
  for (const [k, v] of Object.entries(source)) if (!consumed.includes(k)) rest[k] = v;
  return Object.keys(rest).length ? rest : undefined;
}

function withLegacy<T extends object>(value: T, legacy: Legacy | undefined): T {
  return legacy ? { ...value, legacy } : value;
}

const CHECKIN_FIELDS = ["sleepQuality", "soreness", "stress", "energy"] as const;

function checkinScore(v: unknown): number | undefined {
  const n = parseAmount(v);
  return n !== null && n >= 1 && n <= 10 ? n : undefined;
}

// ─── v1 → v2 ─────────────────────────────────────────────────────────────────

const V1_SET_KEYS = ["weight", "reps", "duration", "distance", "assistance", "done", "completedAt", "pain"] as const;

function setFromV1(raw: unknown, index: number): SetLog {
  const s = isObj(raw) ? raw : {};
  const weight = parseAmount(s.weight);
  const assistance = parseAmount(s.assistance);
  const distance = parseAmount(s.distance);
  const set: SetLog = {
    id: `s${index + 1}`,
    weightKg: weight === null ? null : lbToKg(weight),
    reps: parseAmount(s.reps),
    done: isTrue(s.done),
  };
  const seconds = parseAmount(s.duration);
  if (seconds !== null) set.seconds = seconds;
  if (distance !== null) set.distanceM = ydToM(distance);
  if (assistance !== null) set.assistanceKg = lbToKg(assistance);
  if (typeof s.completedAt === "string") set.completedAt = s.completedAt;
  if (isTrue(s.pain)) set.pain = true;
  return withLegacy(set, pick(s, V1_SET_KEYS));
}

const V1_EXERCISE_KEYS = ["sets", "skipped", "performedName"] as const;

function exerciseFromV1(name: string, raw: unknown, options: NormalizeOptions): ExerciseLog {
  const e = isObj(raw) ? raw : {};
  const sets = Array.isArray(e.sets) ? e.sets.map(setFromV1) : [];
  const log: ExerciseLog = { name, sets };
  const libraryId = options.resolveLibraryId?.(name);
  if (libraryId) log.libraryId = libraryId;
  if (typeof e.performedName === "string" && e.performedName.trim() && e.performedName !== name) {
    log.performedName = e.performedName;
  }
  if (SKIP_REASONS.includes(e.skipped as SkipReason)) log.skipped = e.skipped as SkipReason;
  // `skipped` values v20 doesn't know stay readable under legacy.
  const consumed = log.skipped || e.skipped == null ? V1_EXERCISE_KEYS : V1_EXERCISE_KEYS.filter((k) => k !== "skipped");
  return withLegacy(log, pick(e, consumed));
}

function cardioFromV1(id: string, raw: unknown): CardioLog | null {
  const c = isObj(raw) ? raw : {};
  const miles = parseAmount(c.miles);
  const minutes = parseDurationMinutes(c.time);
  const notes = typeof c.notes === "string" && c.notes.trim() ? c.notes : undefined;
  if (miles === null && minutes === null && !notes) return null;
  const log: CardioLog = { id, kind: "cardio", minutes, km: miles === null ? null : miToKm(miles), source: "manual" };
  if (notes) log.notes = notes;
  return withLegacy(log, pick(c, ["miles", "time", "notes"]));
}

function workoutFromV1(raw: unknown, options: NormalizeOptions): WorkoutLog {
  const w = isObj(raw) ? raw : {};
  const exercises: Record<string, ExerciseLog> = {};
  if (isObj(w.exercises)) {
    for (const [name, value] of Object.entries(w.exercises)) exercises[name] = exerciseFromV1(name, value, options);
  }
  const cardio: CardioLog[] = [];
  const single = cardioFromV1("cardio", w.cardio);
  if (single) cardio.push(single);
  if (isObj(w.cardioSessions)) {
    for (const [id, value] of Object.entries(w.cardioSessions)) {
      const log = cardioFromV1(id, value);
      if (log) cardio.push(log);
    }
  }
  const workout: WorkoutLog = { exercises, cardio };
  if (typeof w.notes === "string" && w.notes.trim()) workout.notes = w.notes;
  // The raw v1 cardio blocks stay in legacy only when they carried something
  // v2 doesn't model (pace, extra keys); miles/time/notes moved to `cardio`.
  const legacy = pick(w, ["exercises", "notes", "cardio", "cardioSessions"]) ?? {};
  const cardioExtras = isObj(w.cardio) ? pick(w.cardio, ["miles", "time", "notes"]) : undefined;
  if (cardioExtras) legacy.cardio = cardioExtras;
  return withLegacy(workout, Object.keys(legacy).length ? legacy : undefined);
}

function checkinFromBody(body: Obj): CheckIn {
  const checkin: CheckIn = {};
  for (const field of CHECKIN_FIELDS) {
    const v = checkinScore(body[field]);
    if (v !== undefined) checkin[field] = v;
  }
  if (isTrue(body.illnessOrInjury)) checkin.illness = true;
  return checkin;
}

function dayFromV1(raw: Obj, options: NormalizeOptions): DayV2 {
  const body = isObj(raw.body) ? raw.body : {};
  const day: DayV2 = { v: 2, checkin: checkinFromBody(body), workout: workoutFromV1(raw.workout, options) };
  const legacy: Legacy = pick(raw, ["workout", "body", "v"]) ?? {};
  // Check-in fields move to `checkin` when valid or blank; anything else the
  // athlete typed (e.g. "0", "11") stays readable under legacy.body.
  const consumedBody = ["illnessOrInjury", ...CHECKIN_FIELDS.filter((f) => day.checkin[f] !== undefined || !hasText(body[f]))];
  const bodyRest = pick(body, consumedBody);
  if (bodyRest) legacy.body = bodyRest;
  return withLegacy(day, Object.keys(legacy).length ? legacy : undefined);
}

// ─── v2 coercion ─────────────────────────────────────────────────────────────

const optionalAmount = (v: unknown): number | null | undefined => (v === undefined ? undefined : parseAmount(v));

function coerceSet(raw: unknown, index: number): SetLog {
  const s = isObj(raw) ? raw : {};
  const set: SetLog = {
    ...s,
    id: typeof s.id === "string" && s.id ? s.id : `s${index + 1}`,
    weightKg: parseAmount(s.weightKg),
    reps: parseAmount(s.reps),
    done: s.done === true,
  };
  for (const key of ["seconds", "distanceM", "assistanceKg"] as const) {
    const v = optionalAmount(s[key]);
    if (v === undefined) delete set[key];
    else set[key] = v;
  }
  for (const key of ["pain", "extra", "trial"] as const) {
    if (s[key] === true) set[key] = true;
    else delete set[key];
  }
  if (typeof s.completedAt !== "string") delete set.completedAt;
  return set;
}

function coerceExercise(id: string, raw: unknown): ExerciseLog {
  const e = isObj(raw) ? raw : {};
  const log: ExerciseLog = {
    ...e,
    name: typeof e.name === "string" && e.name ? e.name : id,
    sets: Array.isArray(e.sets) ? e.sets.map(coerceSet) : [],
  };
  if (!TRACKING_MODES.includes(e.trackingMode as TrackingMode)) delete log.trackingMode;
  if (!SKIP_REASONS.includes(e.skipped as SkipReason)) delete log.skipped;
  if (typeof e.libraryId !== "string") delete log.libraryId;
  if (typeof e.performedName !== "string") delete log.performedName;
  return log;
}

function coerceCardio(raw: unknown, index: number): CardioLog {
  const c = isObj(raw) ? raw : {};
  return {
    ...c,
    id: typeof c.id === "string" && c.id ? c.id : `c${index + 1}`,
    kind: typeof c.kind === "string" && c.kind ? c.kind : "cardio",
    minutes: parseAmount(c.minutes),
    km: parseAmount(c.km),
    source: c.source === "runner" ? "runner" : "manual",
  };
}

function coerceCheckin(raw: unknown): CheckIn {
  const c = isObj(raw) ? raw : {};
  const checkin: CheckIn = {};
  for (const field of CHECKIN_FIELDS) {
    const v = checkinScore(c[field]);
    if (v !== undefined) checkin[field] = v;
  }
  if (c.illness === true) checkin.illness = true;
  if (typeof c.note === "string" && c.note.trim()) checkin.note = c.note.slice(0, 280);
  return checkin;
}

const TIERS = ["FULL", "REDUCED", "RECOVER", "REST"];

function coerceQuest(raw: unknown): QuestSnapshot | undefined {
  if (!isObj(raw) || !TIERS.includes(raw.tier as string) || !isObj(raw.planned)) return undefined;
  return raw as unknown as QuestSnapshot;
}

function dayFromV2(raw: Obj): DayV2 {
  const w = isObj(raw.workout) ? raw.workout : {};
  const exercises: Record<string, ExerciseLog> = {};
  if (isObj(w.exercises)) for (const [id, value] of Object.entries(w.exercises)) exercises[id] = coerceExercise(id, value);
  const day: DayV2 = {
    ...raw,
    v: 2,
    checkin: coerceCheckin(raw.checkin),
    workout: { ...w, exercises, cardio: Array.isArray(w.cardio) ? w.cardio.map(coerceCardio) : [] },
  };
  const quest = coerceQuest(raw.quest);
  if (quest) day.quest = quest;
  else delete day.quest;
  if (!isObj(raw.legacy)) delete day.legacy;
  return day;
}

/** Read any stored payload (v1, v2 or junk) as a v2 day. Never throws. */
export function normalizeDay(raw: unknown, options: NormalizeOptions = {}): DayV2 {
  if (!isObj(raw)) return emptyDay();
  return raw.v === 2 ? dayFromV2(raw) : dayFromV1(raw, options);
}

export function isV2Payload(raw: unknown): boolean {
  return isObj(raw) && raw.v === 2;
}

/** Bytes the payload will occupy as JSON (the server rejects oversized days). */
export function payloadBytes(day: unknown): number {
  return new TextEncoder().encode(JSON.stringify(day)).length;
}
