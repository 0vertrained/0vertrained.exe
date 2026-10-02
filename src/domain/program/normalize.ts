// The single read boundary for stored program payloads.
//
// A v1 payload (the v19 app) is one undated week keyed by weekday. It is read
// as ONE revision effective from 1970-01-01 (so every past day is judged by
// it), source "imported", with the raw week kept verbatim under `legacy`.
// v2 payloads come from the network and other devices and are coerced
// defensively. Junk returns null; this never throws.
//
// Ported from src/programSessions.js (getProgramSessions,
// flattenProgramForLegacy) @ c955d5a. Deliberate changes:
//   - AM/PM `sessions[]` days are flattened into one day: lifting in order,
//     the first cardio block, the day's own title (else the session titles
//     joined). v20 has one session per day.
//   - `__raceBuild`, `pairNext` and session metadata are dropped (still in
//     `legacy`); miles become km; carry targets (v19: yards) become metres.
//   - Lift ids are the slug of the name, suffixed -2, -3 for duplicates in a
//     day; libraryId and trackingMode come from the catalog.

import { WEEKDAYS, compareKeys, isDateKey, type DateKey, type Weekday } from "../dates";
import { parseAmount } from "../day/normalize";
import { TRACKING_MODES, type TrackingMode } from "../day/schema";
import { miToKm, ydToM } from "../units";
import { coerceBuilderInput } from "./builderRules";
import { metaFor, resolveExercise } from "./library";
import type { PlannedCardio, PlannedLift, ProgramDay, ProgramPayloadV2, ProgramRevision, ProgramWeek } from "./types";

export interface ProgramNormalizeOptions {
  /** For v2 revisions without a valid effectiveFrom (default 1970-01-01). */
  fallbackEffectiveFrom?: DateKey;
}

export const IMPORTED_EFFECTIVE_FROM: DateKey = "1970-01-01";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

const slug = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "lift";

function uniqueId(base: string, seen: Set<string>): string {
  let id = base;
  for (let n = 2; seen.has(id); n += 1) id = `${base}-${n}`;
  seen.add(id);
  return id;
}

// ─── Shared day coercion ─────────────────────────────────────────────────────

interface LiftShape {
  v1: boolean;
  seen: Set<string>;
}

/** "8-10" stays text; numbers become text; blanks and zeros are no target. */
function repsTarget(raw: unknown): string {
  const n = parseAmount(raw);
  if (n !== null) return n > 0 ? String(n) : "";
  return typeof raw === "string" ? raw.trim() : "";
}

function coerceLift(raw: unknown, shape: LiftShape): PlannedLift | null {
  if (!isObj(raw)) return null;
  const name = text(raw.name);
  if (!name) return null;
  const stated = !shape.v1 && TRACKING_MODES.includes(raw.trackingMode as TrackingMode) ? (raw.trackingMode as TrackingMode) : undefined;
  const trackingMode = stated ?? metaFor(name).trackingMode;
  let reps = repsTarget(raw.reps);
  const yards = parseAmount(raw.reps);
  if (shape.v1 && trackingMode === "carry" && yards) reps = String(Math.round(ydToM(yards))); // v19 carries were yards
  const lift: PlannedLift = {
    id: uniqueId(shape.v1 ? slug(name) : (text(raw.id) ?? slug(name)), shape.seen),
    name,
    sets: Math.round(parseAmount(raw.sets) ?? 0),
    reps,
    trackingMode,
  };
  const libraryId = shape.v1 ? resolveExercise(name)?.id : text(raw.libraryId);
  if (libraryId) lift.libraryId = libraryId;
  const notes = text(raw.notes);
  if (notes) lift.notes = notes;
  return lift;
}

function coerceCardio(raw: unknown, v1: boolean): PlannedCardio | null {
  if (!isObj(raw)) return null;
  const cardio: PlannedCardio = { kind: text(v1 ? raw.type : raw.kind) ?? "Cardio" };
  const distance = parseAmount(v1 ? raw.miles : raw.km);
  if (distance) cardio.km = v1 ? miToKm(distance) : distance;
  const minutes = parseAmount(raw.minutes);
  if (minutes) cardio.minutes = minutes;
  for (const key of ["effort", "notes"] as const) {
    const value = text(raw[key]);
    if (value) cardio[key] = value;
  }
  return cardio;
}

function finishDay(title: string | undefined, code: string | undefined, lifting: PlannedLift[], cardio: PlannedCardio | null, rest?: boolean): ProgramDay {
  // Nothing planned is rest; lifting never is; cardio alone is rest only when
  // flagged (v2) or titled so (v1 "Rest + optional walk").
  const day: ProgramDay = {
    title: title ?? (lifting.length === 0 && !cardio ? "Rest" : "Training"),
    rest: lifting.length === 0 && (!cardio || (rest ?? /\brest\b/i.test(title ?? ""))),
    lifting,
    cardio,
  };
  return code ? { ...day, code } : day;
}

// ─── v1 → v2 ─────────────────────────────────────────────────────────────────

function dayFromV1(raw: unknown): ProgramDay {
  const d = isObj(raw) ? raw : {};
  const sessions = Array.isArray(d.sessions) ? d.sessions.filter(isObj) : [];
  const parts = sessions.length > 0 ? sessions : [d];
  const shape: LiftShape = { v1: true, seen: new Set() };
  const lifting = parts.flatMap((p) => (Array.isArray(p.lifting) ? p.lifting : []).map((l) => coerceLift(l, shape)).filter((l): l is PlannedLift => l !== null));
  const cardio = parts.map((p) => coerceCardio(p.cardio, true)).find((c) => c !== null) ?? null;
  const joined = sessions.map((s) => text(s.title) ?? text(s.type)).filter(Boolean).join(" + ");
  return finishDay(text(d.type) ?? (joined || undefined), text(d.code), lifting, cardio);
}

const looksLikeWeek = (raw: Obj): boolean => WEEKDAYS.some((d) => isObj(raw[d]));

function weekFrom(raw: Obj, toDay: (raw: unknown) => ProgramDay): ProgramWeek {
  return Object.fromEntries(WEEKDAYS.map((d: Weekday) => [d, toDay(raw[d])])) as ProgramWeek;
}

/** A v19 weekly program as a v20 week; null when it isn't one. */
export function weekFromV1(raw: unknown): ProgramWeek | null {
  return isObj(raw) && looksLikeWeek(raw) ? weekFrom(raw, dayFromV1) : null;
}

// ─── v2 coercion ─────────────────────────────────────────────────────────────

function dayFromV2(raw: unknown): ProgramDay {
  const d = isObj(raw) ? raw : {};
  const shape: LiftShape = { v1: false, seen: new Set() };
  const lifting = (Array.isArray(d.lifting) ? d.lifting : []).map((l) => coerceLift(l, shape)).filter((l): l is PlannedLift => l !== null);
  return finishDay(text(d.title), text(d.code), lifting, coerceCardio(d.cardio, false), typeof d.rest === "boolean" ? d.rest : undefined);
}

function coerceRevision(raw: unknown, fallback: DateKey): ProgramRevision | null {
  if (!isObj(raw) || !isObj(raw.week) || !looksLikeWeek(raw.week)) return null;
  const revision: ProgramRevision = {
    effectiveFrom: isDateKey(raw.effectiveFrom) ? raw.effectiveFrom : fallback,
    source: text(raw.source) ?? "custom",
    week: weekFrom(raw.week, dayFromV2),
  };
  const builderInput = coerceBuilderInput(raw.builderInput);
  return builderInput ? { ...revision, builderInput } : revision;
}

/** Read any stored program payload (v1, v2 or junk) as v2, or null. Never throws. */
export function normalizeProgramPayload(raw: unknown, opts: ProgramNormalizeOptions = {}): ProgramPayloadV2 | null {
  if (!isObj(raw)) return null;
  if (raw.v === 2) {
    const fallback = isDateKey(opts.fallbackEffectiveFrom) ? opts.fallbackEffectiveFrom : IMPORTED_EFFECTIVE_FROM;
    const byDate = new Map<DateKey, ProgramRevision>();
    for (const r of Array.isArray(raw.revisions) ? raw.revisions : []) {
      const revision = coerceRevision(r, fallback);
      if (revision) byDate.set(revision.effectiveFrom, revision); // a later duplicate wins
    }
    if (byDate.size === 0) return null;
    const revisions = [...byDate.values()].sort((a, b) => compareKeys(a.effectiveFrom, b.effectiveFrom));
    return isObj(raw.legacy) ? { v: 2, revisions, legacy: raw.legacy } : { v: 2, revisions };
  }
  const week = weekFromV1(raw);
  if (!week) return null;
  return { v: 2, revisions: [{ effectiveFrom: IMPORTED_EFFECTIVE_FROM, source: "imported", week }], legacy: raw };
}
