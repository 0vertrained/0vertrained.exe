// The generator's rules: which day types a goal trains, how they are spread
// over the week, and how much each session holds.
//
// Ported from src/programBuilder.js @ c955d5a (GOAL_TEMPLATES, GOAL_SCHEME,
// LIFT_ROLE_PLANS, recommendRestDays, buildWeeklySchedule and its safety
// swaps). Deliberate changes:
//   - Four inputs instead of eight. Rest days follow v19's fill order, the
//     long run sits on Saturday (never a rest day for running goals),
//     sessions are 45 min and intervals are on for non-beginner runners
//     (v19's defaults from recommendCardioPreference).
//   - fat_loss is gone (it duplicated basic fitness with more cardio) and
//     'mixed' equipment folds into full_gym.
//   - The pad/trim fallbacks for short templates are gone: every template
//     has exactly one role per training day (asserted in tests).

import { WEEKDAYS, type Weekday } from "../dates";
import type { MovementPattern } from "../exercise";
import { kmFromMiles } from "./cardio";
import {
  BUILDER_GOALS, EQUIPMENT_MODES, EXPERIENCE_LEVELS, TRAINING_DAY_OPTIONS,
  type BuilderGoal, type BuilderInput, type DaysPerWeek,
} from "./types";

export type LiftRole =
  | "full_body" | "full_body_light" | "upper" | "lower" | "push" | "pull" | "legs"
  | "chest" | "back" | "shoulders" | "arms" | "squat" | "bench" | "deadlift" | "press" | "upper_accessory";
export type CardioRole = "easy_run" | "long_run" | "tempo_run" | "quality_run";
export type Role = LiftRole | CardioRole | "active_recovery";
export type Schedule = Record<Weekday, Role | "rest">;

export const GOAL_TEMPLATES: Readonly<Record<BuilderGoal, Readonly<Record<DaysPerWeek, readonly Role[]>>>> = {
  basic_fitness: {
    2: ["full_body", "full_body"],
    3: ["full_body", "full_body", "full_body"],
    4: ["full_body", "easy_run", "full_body", "full_body"],
    5: ["full_body", "easy_run", "full_body", "full_body", "active_recovery"],
    6: ["full_body", "easy_run", "full_body", "full_body", "easy_run", "active_recovery"],
  },
  bodybuilding: {
    2: ["full_body", "full_body"],
    3: ["full_body", "full_body", "full_body"],
    4: ["upper", "lower", "upper", "lower"],
    5: ["chest", "back", "legs", "shoulders", "arms"],
    6: ["push", "pull", "legs", "push", "pull", "legs"],
  },
  strength: {
    2: ["full_body", "full_body"],
    3: ["full_body", "full_body", "full_body"],
    4: ["squat", "bench", "deadlift", "press"],
    5: ["squat", "bench", "deadlift", "press", "upper_accessory"],
    6: ["squat", "bench", "deadlift", "press", "upper_accessory", "active_recovery"],
  },
  endurance: {
    2: ["easy_run", "long_run"],
    3: ["easy_run", "full_body", "long_run"],
    4: ["easy_run", "full_body", "tempo_run", "long_run"],
    5: ["easy_run", "full_body", "quality_run", "easy_run", "long_run"],
    6: ["easy_run", "full_body", "quality_run", "easy_run", "full_body_light", "long_run"],
  },
  hybrid: {
    2: ["upper", "long_run"],
    3: ["upper", "lower", "long_run"],
    4: ["upper", "easy_run", "lower", "long_run"],
    5: ["upper", "easy_run", "lower", "pull", "long_run"],
    6: ["upper", "easy_run", "lower", "quality_run", "pull", "long_run"],
  },
};

export interface RolePlan {
  title: string;
  code: string;
  /** [pattern, how many] in session order. */
  plan: readonly (readonly [MovementPattern, number])[];
  /** The anchor lift's pattern: programmed heavier, always the pattern's staple. */
  main?: MovementPattern;
  light?: boolean;
}

export const LIFT_ROLE_PLANS: Readonly<Record<LiftRole, RolePlan>> = {
  full_body: { title: "Full Body", code: "FULL BODY", plan: [["squat", 1], ["horizontalPush", 1], ["horizontalPull", 1], ["hinge", 1], ["verticalPush", 1], ["core", 1], ["calves", 1]] },
  full_body_light: { title: "Full Body (Light)", code: "FULL LIGHT", plan: [["squat", 1], ["horizontalPush", 1], ["horizontalPull", 1], ["core", 1]], light: true },
  upper: { title: "Upper Body", code: "UPPER", plan: [["horizontalPush", 1], ["horizontalPull", 1], ["verticalPush", 1], ["verticalPull", 1], ["lateralDelts", 1], ["biceps", 1], ["triceps", 1]] },
  lower: { title: "Lower Body", code: "LOWER", plan: [["squat", 1], ["hinge", 1], ["singleLeg", 1], ["quadIso", 1], ["hamstringIso", 1], ["calves", 1]] },
  push: { title: "Push", code: "PUSH", plan: [["horizontalPush", 1], ["verticalPush", 1], ["chestIsolation", 1], ["lateralDelts", 1], ["triceps", 2]] },
  pull: { title: "Pull", code: "PULL", plan: [["verticalPull", 1], ["horizontalPull", 1], ["backIsolation", 1], ["rearDelts", 1], ["biceps", 2]] },
  legs: { title: "Legs", code: "LEGS", plan: [["squat", 1], ["hinge", 1], ["singleLeg", 1], ["quadIso", 1], ["hamstringIso", 1], ["calves", 1]] },
  chest: { title: "Chest", code: "CHEST", plan: [["horizontalPush", 2], ["chestIsolation", 2], ["triceps", 2]] },
  back: { title: "Back", code: "BACK", plan: [["verticalPull", 1], ["horizontalPull", 2], ["backIsolation", 1], ["biceps", 2]] },
  shoulders: { title: "Shoulders", code: "SHOULDERS", plan: [["verticalPush", 2], ["lateralDelts", 2], ["rearDelts", 1], ["core", 1]] },
  arms: { title: "Arms", code: "ARMS", plan: [["biceps", 2], ["triceps", 2], ["biceps", 1], ["triceps", 1]] },
  squat: { title: "Squat Focus", code: "SQUAT", main: "squat", plan: [["squat", 1], ["hinge", 1], ["singleLeg", 1], ["quadIso", 1], ["core", 1]] },
  bench: { title: "Bench Focus", code: "BENCH", main: "horizontalPush", plan: [["horizontalPush", 1], ["verticalPush", 1], ["horizontalPull", 1], ["triceps", 1], ["lateralDelts", 1]] },
  deadlift: { title: "Deadlift Focus", code: "DEADLIFT", main: "hinge", plan: [["hinge", 1], ["squat", 1], ["horizontalPull", 1], ["backIsolation", 1], ["core", 1]] },
  press: { title: "Overhead Press Focus", code: "PRESS", main: "verticalPush", plan: [["verticalPush", 1], ["horizontalPush", 1], ["verticalPull", 1], ["biceps", 1], ["triceps", 1]] },
  upper_accessory: { title: "Upper Accessory", code: "UPPER ACC", plan: [["horizontalPush", 1], ["horizontalPull", 1], ["lateralDelts", 1], ["biceps", 1], ["triceps", 1]] },
};

export interface SetsReps {
  sets: number;
  reps: number;
}

export const GOAL_SCHEME: Readonly<Record<BuilderGoal, { compound: SetsReps; accessory: SetsReps; main: SetsReps }>> = {
  strength: { compound: { sets: 4, reps: 5 }, accessory: { sets: 3, reps: 10 }, main: { sets: 5, reps: 3 } },
  bodybuilding: { compound: { sets: 4, reps: 8 }, accessory: { sets: 3, reps: 12 }, main: { sets: 4, reps: 8 } },
  basic_fitness: { compound: { sets: 3, reps: 8 }, accessory: { sets: 2, reps: 12 }, main: { sets: 3, reps: 8 } },
  hybrid: { compound: { sets: 4, reps: 6 }, accessory: { sets: 3, reps: 12 }, main: { sets: 4, reps: 6 } },
  endurance: { compound: { sets: 3, reps: 8 }, accessory: { sets: 2, reps: 12 }, main: { sets: 3, reps: 8 } },
};

/** Set and exercise-count adjustments by experience. */
export const EXPERIENCE_ADJUST = {
  beginner: { sets: -1, count: -1 },
  intermediate: { sets: 0, count: 0 },
  advanced: { sets: 1, count: 1 },
} as const;

/** v19's count for a 45-minute session (its 30/45/60/75 table gave 4/5/6/7). */
export const SESSION_EXERCISES = 5;

/** Run distances, v19's miles in km. Quality sessions run the tempo distance. */
export const RUN_KM = {
  beginner: { easy: kmFromMiles(3), long: kmFromMiles(5), tempo: kmFromMiles(3) },
  intermediate: { easy: kmFromMiles(4), long: kmFromMiles(8), tempo: kmFromMiles(5) },
  advanced: { easy: kmFromMiles(5), long: kmFromMiles(11), tempo: kmFromMiles(6) },
} as const;

export const CARDIO_ROLES: ReadonlySet<Role> = new Set<Role>(["easy_run", "long_run", "tempo_run", "quality_run"]);
const HEAVY_LOWER: ReadonlySet<Role> = new Set<Role>(["lower", "legs", "squat", "deadlift", "full_body"]);

export const goalUsesRunning = (goal: BuilderGoal): boolean => goal === "endurance" || goal === "hybrid";

/** v19's cardio default per goal; only "moderate"/"high" turn intervals on. */
export function recommendCardioPreference(goal: BuilderGoal): "none" | "light" | "moderate" | "high" {
  return ({ basic_fitness: "light", bodybuilding: "light", strength: "none", endurance: "high", hybrid: "moderate" } as const)[goal];
}

export const LONG_RUN_DAY: Weekday = "Saturday";

// Rest-day fill order: weekend and mid-week first.
const REST_FILL_ORDER: readonly Weekday[] = ["Sunday", "Wednesday", "Saturday", "Thursday", "Monday", "Friday", "Tuesday"];

export function recommendRestDays(daysPerWeek: DaysPerWeek, goal: BuilderGoal): Weekday[] {
  const candidates = REST_FILL_ORDER.filter((d) => !(goalUsesRunning(goal) && d === LONG_RUN_DAY));
  const rest = candidates.slice(0, 7 - daysPerWeek);
  return WEEKDAYS.filter((d) => rest.includes(d));
}

export function roleIntensity(role: Role, includeIntervals: boolean): "hard" | "moderate" | "easy" | "recovery" {
  if (role === "long_run" || role === "tempo_run" || role === "squat" || role === "deadlift") return "hard";
  if (role === "quality_run") return includeIntervals ? "hard" : "moderate";
  if (role === "easy_run") return "easy";
  if (role === "active_recovery") return "recovery";
  return "moderate";
}

/** Adjacency violations across the calendar week (no weekend wrap). */
export function scoreSchedule(schedule: Partial<Schedule>, includeIntervals: boolean): number {
  let score = 0;
  for (let i = 0; i < WEEKDAYS.length - 1; i += 1) {
    const a = schedule[WEEKDAYS[i] as Weekday];
    const b = schedule[WEEKDAYS[i + 1] as Weekday];
    if (!a || !b || a === "rest" || b === "rest") continue;
    if (HEAVY_LOWER.has(a) && b === "long_run") score += 4;
    if (HEAVY_LOWER.has(a) && (b === "quality_run" || b === "tempo_run")) score += 3;
    if (roleIntensity(a, includeIntervals) === "hard" && roleIntensity(b, includeIntervals) === "hard") score += 2;
  }
  return score;
}

/** Greedy pairwise swaps of training days (the long run stays put) until no swap helps. */
function improveSafety(schedule: Schedule, includeIntervals: boolean): Schedule {
  const map = { ...schedule };
  const movable = WEEKDAYS.filter((d) => map[d] !== "rest" && map[d] !== "long_run");
  let best = scoreSchedule(map, includeIntervals);
  for (let improved = true, guard = 0; improved && best > 0 && guard < 40; guard += 1) {
    improved = false;
    for (let i = 0; i < movable.length; i += 1) {
      for (let j = i + 1; j < movable.length; j += 1) {
        const di = movable[i] as Weekday;
        const dj = movable[j] as Weekday;
        const trial = { ...map, [di]: map[dj], [dj]: map[di] };
        const s = scoreSchedule(trial, includeIntervals);
        if (s < best) {
          Object.assign(map, trial);
          best = s;
          improved = true;
        }
      }
    }
  }
  return map;
}

export const includesIntervals = (input: BuilderInput): boolean => {
  const pref = recommendCardioPreference(input.goal);
  return goalUsesRunning(input.goal) && input.experience !== "beginner" && (pref === "moderate" || pref === "high");
};

/** Weekday → role ("rest" on rest days). */
export function buildSchedule(input: BuilderInput): Schedule {
  const rest = recommendRestDays(input.daysPerWeek, input.goal);
  const trainingDays = WEEKDAYS.filter((d) => !rest.includes(d));
  const roles = [...GOAL_TEMPLATES[input.goal][input.daysPerWeek]];
  const schedule = Object.fromEntries(WEEKDAYS.map((d) => [d, "rest"])) as Schedule;
  if (roles.includes("long_run")) {
    schedule[LONG_RUN_DAY] = "long_run";
    roles.splice(roles.indexOf("long_run"), 1);
  }
  for (const day of trainingDays.filter((d) => schedule[d] === "rest")) schedule[day] = roles.shift() as Role;
  return improveSafety(schedule, includesIntervals(input));
}

type Obj = Record<string, unknown>;

/** A stored or typed builder input, checked field by field; null when unusable. */
export function coerceBuilderInput(raw: unknown): BuilderInput | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Obj;
  const ok =
    BUILDER_GOALS.includes(r.goal as BuilderGoal) &&
    TRAINING_DAY_OPTIONS.includes(r.daysPerWeek as DaysPerWeek) &&
    EQUIPMENT_MODES.includes(r.equipment as BuilderInput["equipment"]) &&
    EXPERIENCE_LEVELS.includes(r.experience as BuilderInput["experience"]);
  if (!ok) return null;
  const input = { goal: r.goal, daysPerWeek: r.daysPerWeek, equipment: r.equipment, experience: r.experience } as BuilderInput;
  if (typeof r.seed === "number" && Number.isFinite(r.seed)) input.seed = r.seed;
  return input;
}
