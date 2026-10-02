// The program generator: four answers (goal, days, equipment, experience)
// in, one valid week on library movements out. Pure and seeded: the same
// input always produces the same week.
//
// Ported from src/programBuilder.js (buildProgramPlan, buildLiftingDay,
// buildCardioDay, liftEntry, coreBlock) @ c955d5a. Deliberate changes:
//   - Returns the week only; the rationale/warning strings, settings patch
//     and the 4-week preview (only week 1 was ever saved) are not ported.
//   - The anchor lift of a focus day is the pattern's staple (Back Squat,
//     Conventional Deadlift…), not whatever the seed rotated to — v19 could
//     program "Deadlift Focus" around a 5×3 Glute Bridge.
//   - Timed holds and carries keep their own target (Plank 45 s); v19 gave
//     them the goal's rep count, i.e. 10-second planks.
//   - A day never repeats a movement (v19 could list Bench Dip twice).
//   - The interval day is titled "Intervals"; v19 said "Intervals + Core"
//     but planned no core work.
//   - The result is validated and the generator throws rather than return
//     a week that fails validation.

import { WEEKDAYS, type Weekday } from "../dates";
import { kmFromMiles } from "./cardio";
import { buildCardio, isCompoundPattern, selectExercises, type CardioKey, type LibraryExercise } from "./library";
import {
  CARDIO_ROLES, EXPERIENCE_ADJUST, GOAL_SCHEME, LIFT_ROLE_PLANS, RUN_KM, SESSION_EXERCISES,
  buildSchedule, coerceBuilderInput, includesIntervals,
  type CardioRole, type LiftRole,
} from "./builderRules";
import { restDay, type BuilderInput, type PlannedLift, type ProgramDay, type ProgramWeek } from "./types";
import { validateWeek } from "./validate";

interface Context {
  input: BuilderInput;
  /** Selection seed for this day. */
  seed: number;
  /** Which note/cardio variant this seed picks. */
  variant: number;
  includeIntervals: boolean;
}

const pick = <T>(list: readonly T[], variant: number): T => list[((variant % list.length) + list.length) % list.length] as T;

function liftEntry(e: LibraryExercise, { goal, experience }: BuilderInput, isMain: boolean): PlannedLift {
  const scheme = GOAL_SCHEME[goal];
  const compound = isCompoundPattern(e.pattern);
  const band = isMain ? scheme.main : compound ? scheme.compound : scheme.accessory;
  const adj = EXPERIENCE_ADJUST[experience].sets;
  const sets = Math.max(2, band.sets + (compound ? adj : Math.min(0, adj)));
  const ownTarget = e.trackingMode === "timed_hold" || e.trackingMode === "carry";
  const reps = ownTarget ? e.defaultReps : String(band.reps);
  return { id: e.id, name: e.name, libraryId: e.id, sets, reps, trackingMode: e.trackingMode, notes: e.notes };
}

function coreBlock(ctx: Context): PlannedLift[] {
  const { equipment, experience } = ctx.input;
  return selectExercises("core", { equipment, level: experience, count: 2, seed: ctx.seed }).map((e) => liftEntry(e, ctx.input, false));
}

function liftingDay(role: LiftRole, ctx: Context, occurrence: number): ProgramDay {
  const spec = LIFT_ROLE_PLANS[role];
  const { equipment, experience } = ctx.input;
  const maxCount = Math.max(3, SESSION_EXERCISES + EXPERIENCE_ADJUST[experience].count) - (spec.light ? 1 : 0);
  const lifting: PlannedLift[] = [];
  const used = new Set<string>();
  let mainDone = false;
  for (const [pattern, count] of spec.plan) {
    const room = maxCount - lifting.length;
    if (room <= 0) break;
    const isMain = spec.main === pattern && !mainDone;
    const seed = isMain ? 0 : ctx.seed + lifting.length;
    const picks = selectExercises(pattern, { equipment, level: experience, count: Math.min(count, room), seed, exclude: used });
    picks.forEach((e, i) => {
      lifting.push(liftEntry(e, ctx.input, isMain && i === 0));
      used.add(e.id);
    });
    if (isMain && picks.length > 0) mainDone = true;
  }
  const letter = occurrence > 1 ? ` ${String.fromCharCode(64 + occurrence)}` : "";
  return { title: `${spec.title}${letter}`, code: `${spec.code}${letter}`, rest: false, lifting, cardio: null };
}

const NOTE_VARIANTS: Partial<Record<CardioKey, readonly string[]>> = {
  easy_run: ["Relaxed aerobic running — nothing forced.", "Keep it conversational; add strides if you feel good.", "Pure easy volume. Slow is the point."],
  zone2_run: ["Steady Zone 2 — controlled and sustainable.", "Aerobic base work; hold the effort even on hills.", "Long-ish steady effort at true Zone 2."],
  incline_walk: ["Brisk incline walk — low impact aerobic work.", "Steady incline, easy on the joints.", "Recovery-friendly aerobic session."],
  long_run: ["Weekly distance anchor — easy and conversational.", "Long, steady, aerobic. Fuel before and hydrate.", "Build the aerobic engine; negative-split the last stretch if fresh."],
  tempo_run: ["Comfortably hard sustained effort in the middle.", "Threshold work — controlled discomfort, not a race.", "Steady tempo; hold form as it gets hard."],
};

const noteFor = (key: CardioKey, variant: number): string | undefined => {
  const list = NOTE_VARIANTS[key];
  return list ? pick(list, variant) : undefined;
};

function cardioDay(role: CardioRole, ctx: Context): ProgramDay {
  const km = RUN_KM[ctx.input.experience];
  const day = (title: string, code: string, key: CardioKey, distance: number): ProgramDay => {
    const notes = noteFor(key, ctx.variant);
    return { title, code, rest: false, lifting: [], cardio: buildCardio(key, notes ? { km: distance, notes } : { km: distance }) };
  };
  if (role === "long_run") return day("Long Run", "LONG", "long_run", km.long);
  if (role === "tempo_run") return day("Tempo Run", "TEMPO", "tempo_run", km.tempo);
  if (role === "quality_run") {
    if (!ctx.includeIntervals) return day("Tempo Run", "QUALITY", "tempo_run", km.tempo);
    const key = pick(["intervals", "hill_repeats"] as const, ctx.variant);
    return day(key === "intervals" ? "Intervals" : "Hill Repeats", "QUALITY", key, km.tempo);
  }
  const key = pick(["easy_run", "zone2_run", "incline_walk"] as const, ctx.variant);
  return day(buildCardio(key).kind, "EASY", key, km.easy);
}

function activeRecoveryDay(ctx: Context): ProgramDay {
  return {
    title: "Active Recovery",
    code: "ACTIVE",
    rest: false,
    lifting: coreBlock(ctx),
    cardio: buildCardio("recovery_walk", { km: kmFromMiles(2), notes: "Optional easy movement or mobility. Genuinely light — this is recovery, not a session." }),
  };
}

/** Throws when a week breaks the generator's guarantees. */
export function assertGeneratedWeek(week: ProgramWeek, input: BuilderInput): ProgramWeek {
  const { valid, errors } = validateWeek(week, { requireLibraryIds: true, equipment: input.equipment });
  const training = WEEKDAYS.filter((d) => !week[d].rest).length;
  if (training !== input.daysPerWeek) errors.push(`Expected ${input.daysPerWeek} training days, got ${training}.`);
  if (!valid || errors.length > 0) throw new Error(`Generated program failed validation: ${errors.join(" ")}`);
  return week;
}

export function buildProgram(raw: BuilderInput): ProgramWeek {
  const input = coerceBuilderInput(raw);
  if (!input) throw new RangeError("Invalid program builder input.");
  const variant = Number.isFinite(input.seed) ? Math.trunc(input.seed as number) : 0;
  const includeIntervals = includesIntervals(input);
  const schedule = buildSchedule(input);
  const occurrences: Partial<Record<LiftRole, number>> = {};
  const week = {} as ProgramWeek;
  WEEKDAYS.forEach((weekday: Weekday, index) => {
    const role = schedule[weekday];
    const ctx: Context = { input, seed: 3 + variant * 5 + index, variant, includeIntervals };
    if (role === "rest") week[weekday] = restDay();
    else if (role === "active_recovery") week[weekday] = activeRecoveryDay(ctx);
    else if (CARDIO_ROLES.has(role)) week[weekday] = cardioDay(role as CardioRole, ctx);
    else {
      const lift = role as LiftRole;
      occurrences[lift] = (occurrences[lift] ?? 0) + 1;
      week[weekday] = liftingDay(lift, ctx, occurrences[lift]);
    }
  });
  return assertGeneratedWeek(week, input);
}
