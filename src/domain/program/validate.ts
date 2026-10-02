// Structural check for a weekly plan before it is saved or issued as quests.
//
// Ported from src/programBuilder.js (validateGeneratedProgram) @ c955d5a.
// Deliberate changes: also checks what v19 let through and later crashed or
// mis-logged on — lift ids unique within a day (they key the day's log),
// whole positive sets, a reps target, a known tracking mode, rest days
// without lifting, training days with something to do — and, on request,
// that every lift is a library movement the athlete's equipment allows.

import { WEEKDAYS } from "../dates";
import { TRACKING_MODES, type TrackingMode } from "../day/schema";
import { EQUIPMENT_ALLOW, getExercise } from "./library";
import type { EquipmentMode } from "./types";

export interface WeekValidation {
  valid: boolean;
  errors: string[];
}

export interface ValidateOptions {
  /** Every lift must name a library movement (generated and preset weeks). */
  requireLibraryIds?: boolean;
  /** Every library movement must be usable with this equipment. */
  equipment?: EquipmentMode;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

function checkLift(lift: unknown, where: string, seen: Set<string>, options: ValidateOptions, errors: string[]): void {
  if (!isObj(lift)) {
    errors.push(`${where}: a lift is not an object.`);
    return;
  }
  const label = nonEmpty(lift.name) ? lift.name : "a lift";
  if (!nonEmpty(lift.name)) errors.push(`${where}: a lift is missing a name.`);
  if (!nonEmpty(lift.id)) errors.push(`${where}: ${label} is missing an id.`);
  else if (seen.has(lift.id)) errors.push(`${where}: duplicate lift id "${lift.id}".`);
  else seen.add(lift.id);
  if (!Number.isInteger(lift.sets) || (lift.sets as number) < 1) errors.push(`${where}: ${label} needs a whole number of sets.`);
  if (!nonEmpty(lift.reps)) errors.push(`${where}: ${label} has no reps target.`);
  if (!TRACKING_MODES.includes(lift.trackingMode as TrackingMode)) errors.push(`${where}: ${label} has no tracking mode.`);
  if (lift.libraryId === undefined) {
    if (options.requireLibraryIds) errors.push(`${where}: ${label} is not a library movement.`);
    return;
  }
  const entry = typeof lift.libraryId === "string" ? getExercise(lift.libraryId) : undefined;
  if (!entry) errors.push(`${where}: ${label} has an unknown library id.`);
  else if (options.equipment && !EQUIPMENT_ALLOW[options.equipment].includes(entry.equipment)) {
    errors.push(`${where}: ${label} needs ${entry.equipment} equipment.`);
  }
}

export function validateWeek(week: unknown, options: ValidateOptions = {}): WeekValidation {
  if (!isObj(week)) return { valid: false, errors: ["Program is missing or not an object."] };
  const errors: string[] = [];
  for (const weekday of WEEKDAYS) {
    const day = week[weekday];
    if (!isObj(day)) {
      errors.push(`${weekday}: missing day.`);
      continue;
    }
    if (!nonEmpty(day.title)) errors.push(`${weekday}: missing title.`);
    if (typeof day.rest !== "boolean") errors.push(`${weekday}: rest must be true or false.`);
    if (!(day.cardio === null || isObj(day.cardio))) errors.push(`${weekday}: cardio must be null or an object.`);
    else if (day.cardio && !nonEmpty(day.cardio.kind)) errors.push(`${weekday}: cardio is missing its kind.`);
    if (!Array.isArray(day.lifting)) {
      errors.push(`${weekday}: lifting must be a list.`);
      continue;
    }
    if (day.rest === true && day.lifting.length > 0) errors.push(`${weekday}: a rest day can't have lifting.`);
    if (day.rest === false && day.lifting.length === 0 && !day.cardio) errors.push(`${weekday}: a training day has nothing planned.`);
    const seen = new Set<string>();
    for (const lift of day.lifting) checkLift(lift, weekday, seen, options, errors);
  }
  return { valid: errors.length === 0, errors };
}
