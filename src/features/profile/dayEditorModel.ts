// The day editor's pure half: the draft a sheet edits, catalogue matches for
// the exercise field, how a picked or typed movement becomes a planned lift,
// the duplicate rule, and validation of the day inside its week.
import { WEEKDAYS, type Weekday } from "../../domain/dates";
import type { TrackingMode } from "../../domain/day/schema";
import { guessMeta } from "../../domain/exercise";
import { ALIASES, normalizeName } from "../../domain/program/aliases";
import { LIBRARY, resolveExercise, type LibraryExercise } from "../../domain/program/library";
import { restDay, type PlannedLift, type ProgramDay, type ProgramWeek } from "../../domain/program/types";
import { validateWeek } from "../../domain/program/validate";

export const MAX_LIFTS = 12;
export const MIN_SETS = 1;
export const MAX_SETS = 10;
export const REPS_MAX_LENGTH = 8;
export const TITLE_MAX_LENGTH = 40;
/** Typed characters before the matches list appears. */
export const MIN_QUERY = 2;
export const MAX_MATCHES = 6;

export const DUPLICATE_ERROR = "Already in this day. Pick another movement.";
export const FULL_DAY_HINT = `A day holds up to ${MAX_LIFTS} exercises.`;

export interface DayDraft {
  rest: boolean;
  title: string;
  lifts: PlannedLift[];
}

export function draftFrom(day: ProgramDay): DayDraft {
  return { rest: day.rest, title: day.title, lifts: day.lifting.map((l) => ({ ...l })) };
}

/** The day the draft describes. Cardio is never edited here and stays as it was. */
export function dayFromDraft(draft: DayDraft, original: ProgramDay): ProgramDay {
  if (draft.rest) {
    const day = restDay(original.rest ? original.title : "Rest");
    return original.cardio ? { ...day, cardio: original.cardio } : day;
  }
  const day: ProgramDay = { title: draft.title.trim() || (original.rest ? "Training" : original.title), rest: false, lifting: draft.lifts, cardio: original.cardio };
  return original.code && !original.rest ? { ...day, code: original.code } : day;
}

const ALIAS_KEYS_BY_ID = new Map<string, string[]>();
for (const [key, id] of Object.entries(ALIASES)) ALIAS_KEYS_BY_ID.set(id, [...(ALIAS_KEYS_BY_ID.get(id) ?? []), key]);

/** 0 name starts with it, 1 name contains it, 2/3 the same on an alias, -1 no match. */
function matchScore(e: LibraryExercise, q: string): number {
  const name = normalizeName(e.name);
  if (name.startsWith(q)) return 0;
  if (name.includes(q)) return 1;
  const aliases = ALIAS_KEYS_BY_ID.get(e.id) ?? [];
  if (aliases.some((a) => a.startsWith(q))) return 2;
  if (aliases.some((a) => a.includes(q))) return 3;
  return -1;
}

/** Up to MAX_MATCHES catalogue movements for what was typed, minus those already in the day. */
export function matches(query: string, lifts: PlannedLift[]): LibraryExercise[] {
  if (query.trim().length < MIN_QUERY) return [];
  const q = normalizeName(query);
  if (!q) return [];
  const taken = new Set(lifts.map((l) => l.libraryId).filter((id): id is string => id !== undefined));
  return LIBRARY.filter((e) => !taken.has(e.id))
    .map((e) => ({ e, score: matchScore(e, q) }))
    .filter((m) => m.score >= 0)
    .sort((a, b) => a.score - b.score || a.e.name.localeCompare(b.e.name))
    .slice(0, MAX_MATCHES)
    .map((m) => m.e);
}

/** The lift already in the day that is the same movement, by library id or by name. */
export function duplicateOf(lifts: PlannedLift[], name: string, libraryId?: string): PlannedLift | undefined {
  const key = normalizeName(name);
  return lifts.find((l) => (libraryId !== undefined && l.libraryId === libraryId) || normalizeName(l.name) === key);
}

const slug = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "lift";

function uniqueId(base: string, lifts: PlannedLift[]): string {
  const taken = new Set(lifts.map((l) => l.id));
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
  return id;
}

export function liftFromLibrary(e: LibraryExercise, lifts: PlannedLift[]): PlannedLift {
  const lift: PlannedLift = { id: uniqueId(e.id, lifts), name: e.name, libraryId: e.id, sets: e.defaultSets, reps: e.defaultReps, trackingMode: e.trackingMode };
  return e.notes ? { ...lift, notes: e.notes } : lift;
}

/** Sets × target for a movement the catalogue does not know, by how it is tracked. */
const CUSTOM_TARGET: Readonly<Record<TrackingMode, { sets: number; reps: string }>> = {
  loaded_reps: { sets: 3, reps: "8" },
  bodyweight_reps: { sets: 3, reps: "10" },
  assisted_reps: { sets: 3, reps: "8" },
  timed_hold: { sets: 3, reps: "30" },
  carry: { sets: 2, reps: "40" },
};

export function liftFromName(name: string, lifts: PlannedLift[]): PlannedLift {
  const trimmed = name.trim();
  const { trackingMode } = guessMeta(trimmed);
  const target = CUSTOM_TARGET[trackingMode];
  return { id: uniqueId(slug(trimmed), lifts), name: trimmed, sets: target.sets, reps: target.reps, trackingMode };
}

/** The catalogue movement an exact name or alias names, else a custom lift. */
export function liftFor(name: string, lifts: PlannedLift[]): PlannedLift {
  const e = resolveExercise(name);
  return e ? liftFromLibrary(e, lifts) : liftFromName(name, lifts);
}

const REST_WEEK = Object.fromEntries(WEEKDAYS.map((d) => [d, restDay()])) as ProgramWeek;

/** Validation errors for the week with this day in place (the day alone when no week is given). */
export function dayErrors(day: ProgramDay, weekday: Weekday, week?: ProgramWeek): string[] {
  return validateWeek({ ...(week ?? REST_WEEK), [weekday]: day }).errors;
}
