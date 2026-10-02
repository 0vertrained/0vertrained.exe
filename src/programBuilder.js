// src/programBuilder.js
// ─── Program Builder V2 (V2.3) — pure plan generator ────────────────────────
//
// Turns a small set of user constraints (goal, days/week, rest days, equipment,
// experience, cardio preference) into the existing weekly program shape that
// Today Coach, Nutrition, Adaptive Training and Recovery already consume:
//
//   program[Weekday] = { type, code, lifting: [ {name,sets,reps,notes} ], cardio }
//   cardio = null | { type, miles, effort, notes }
//
// Everything here is deterministic and side-effect free (no clocks, no random,
// no network) so it is fully unit-testable. Timestamps are passed IN by callers
// (`generatedAt`) rather than read from the environment.
//
// This module GENERATES and PREVIEWS plans. It never persists. Applying a plan
// is an explicit user action wired in App.jsx / the builder panel / onboarding.

import { DAYS } from "./constants";
import {
  selectExercises,
  buildCardio,
  isCompoundPattern,
} from "./programExerciseLibrary";

// ─── Catalogs (exported for UI + validation) ────────────────────────────────
export const PROGRAM_BUILDER_GOALS = [
  { id: "basic_fitness", label: "Basic fitness",  desc: "General health and strength. Simple full-body sessions plus easy cardio." },
  { id: "bodybuilding",  label: "Bodybuilding",   desc: "Hypertrophy focus. Higher volume, muscle-group variety across the week." },
  { id: "strength",      label: "Strength",       desc: "Squat, bench, deadlift and press. Heavier, lower reps, more rest between." },
  { id: "endurance",     label: "Running / endurance", desc: "Miles first. Mostly easy running with a weekly long run and light strength support." },
  { id: "hybrid",        label: "Hybrid",         desc: "Lift and run seriously. Lower-body work spaced away from the hard runs." },
  { id: "fat_loss",      label: "Fat loss / recomp", desc: "Hold muscle in a deficit. Full-body or upper/lower strength with more cardio." },
];
export const PROGRAM_BUILDER_GOAL_IDS = PROGRAM_BUILDER_GOALS.map((g) => g.id);

export const TRAINING_DAY_OPTIONS = [2, 3, 4, 5, 6];

export const REST_DAY_OPTIONS = [...DAYS];
export { DAYS };

export const EQUIPMENT_OPTIONS = [
  { id: "full_gym",   label: "Full gym",       desc: "Barbells, dumbbells, machines and cables." },
  { id: "dumbbells",  label: "Dumbbells only", desc: "Adjustable or fixed dumbbells, plus bodyweight." },
  { id: "bodyweight", label: "Bodyweight",     desc: "No equipment — home or travel friendly." },
  { id: "mixed",      label: "Mixed / unsure", desc: "A bit of everything, or not sure yet." },
];
export const EQUIPMENT_IDS = EQUIPMENT_OPTIONS.map((e) => e.id);

export const EXPERIENCE_LEVELS = [
  { id: "beginner",     label: "Beginner",     desc: "New to structured training. Simpler movements, lower volume." },
  { id: "intermediate", label: "Intermediate", desc: "Comfortable with the main lifts and a weekly routine." },
  { id: "advanced",     label: "Advanced",     desc: "Experienced. More specific movements and higher volume." },
];
export const EXPERIENCE_IDS = EXPERIENCE_LEVELS.map((e) => e.id);

export const SESSION_LENGTH_OPTIONS = [30, 45, 60, 75];

export const CARDIO_PREFERENCES = [
  { id: "none",     label: "None / minimal", sessions: 0, desc: "Skip programmed cardio (a light walk is always fine)." },
  { id: "light",    label: "1–2 easy",       sessions: 2, desc: "A couple of easy aerobic sessions per week." },
  { id: "moderate", label: "3 sessions",     sessions: 3, desc: "Three runs/rides a week, mostly easy." },
  { id: "high",     label: "4+ sessions",    sessions: 4, desc: "High cardio frequency, endurance-leaning." },
];
export const CARDIO_PREFERENCE_IDS = CARDIO_PREFERENCES.map((c) => c.id);

// Goals that inherently involve running/cardio scheduling.
const RUNNING_GOALS = ["endurance", "hybrid"];
export function goalUsesRunning(goal) {
  return RUNNING_GOALS.includes(goal);
}

// Map a V2.2 onboarding goal id → a builder goal id.
const ONBOARDING_GOAL_MAP = {
  hybrid: "hybrid",
  muscle: "bodybuilding",
  strength: "strength",
  fat_loss: "fat_loss",
  endurance: "endurance",
};
export function mapOnboardingGoalToBuilderGoal(goal) {
  return ONBOARDING_GOAL_MAP[goal] || "hybrid";
}

// ─── Recommendations ────────────────────────────────────────────────────────
const GOAL_DEFAULT_DAYS = {
  basic_fitness: 3,
  bodybuilding: 5,
  strength: 4,
  endurance: 4,
  hybrid: 5,
  fat_loss: 4,
};
export function recommendTrainingDaysForGoal(goal) {
  return GOAL_DEFAULT_DAYS[goal] || 4;
}

const GOAL_DEFAULT_CARDIO = {
  basic_fitness: "light",
  bodybuilding: "light",
  strength: "none",
  endurance: "high",
  hybrid: "moderate",
  fat_loss: "moderate",
};
export function recommendCardioPreference(goal) {
  return GOAL_DEFAULT_CARDIO[goal] || "light";
}

// Preference order for auto-filling rest days (weekend + mid-week first).
const REST_FILL_ORDER = ["Sunday", "Wednesday", "Saturday", "Thursday", "Monday", "Friday", "Tuesday"];

export function recommendRestDays({ trainingDaysPerWeek, goal, longRunDay } = {}) {
  const training = clampTrainingDays(trainingDaysPerWeek, goal);
  const restCount = 7 - training;
  const out = [];
  for (const day of REST_FILL_ORDER) {
    if (out.length >= restCount) break;
    if (goalUsesRunning(goal) && day === (longRunDay || "Saturday")) continue; // keep the long-run day free to train
    out.push(day);
  }
  return sortDays(out);
}

function clampTrainingDays(value, goal) {
  const n = Math.round(Number(value));
  if (TRAINING_DAY_OPTIONS.includes(n)) return n;
  if (Number.isFinite(n)) return Math.min(6, Math.max(2, n));
  return recommendTrainingDaysForGoal(goal);
}

function sortDays(days) {
  return [...new Set(days)].filter((d) => DAYS.includes(d)).sort((a, b) => DAYS.indexOf(a) - DAYS.indexOf(b));
}

// ─── Input normalization ────────────────────────────────────────────────────
export function normalizeProgramBuilderInput(input = {}) {
  const goal = PROGRAM_BUILDER_GOAL_IDS.includes(input.goal) ? input.goal : "hybrid";
  const trainingDaysPerWeek = clampTrainingDays(input.trainingDaysPerWeek, goal);
  const equipment = EQUIPMENT_IDS.includes(input.equipment) ? input.equipment : "full_gym";
  const experience = EXPERIENCE_IDS.includes(input.experience) ? input.experience : "intermediate";
  const sessionLength = SESSION_LENGTH_OPTIONS.includes(Number(input.sessionLength)) ? Number(input.sessionLength) : 60;
  const usesRunning = goalUsesRunning(goal);

  const cardioPreference = CARDIO_PREFERENCE_IDS.includes(input.cardioPreference)
    ? input.cardioPreference
    : recommendCardioPreference(goal);

  // Long-run day: only meaningful when running is in play. Default Saturday,
  // fall back to Sunday if Saturday is a hard rest day.
  const requestedRest = sortDays(Array.isArray(input.restDays) ? input.restDays : []);
  let longRunDay = null;
  if (usesRunning) {
    const requested = DAYS.includes(input.longRunDay) ? input.longRunDay : "Saturday";
    longRunDay = requested;
  }

  // Resolve rest days to exactly (7 - training), honoring user choices first.
  const restDays = resolveRestDays(requestedRest, trainingDaysPerWeek, goal, longRunDay);

  // If running and the chosen long-run day ended up a rest day, nudge it to a
  // training day (validation/warnings surface this to the user).
  if (usesRunning && longRunDay && restDays.includes(longRunDay)) {
    const trainingDays = DAYS.filter((d) => !restDays.includes(d));
    longRunDay = pickLongRunFallback(trainingDays);
  }

  // Intervals only for goals/experience where a quality day is sensible.
  const includeIntervals = typeof input.includeIntervals === "boolean"
    ? input.includeIntervals
    : (usesRunning && experience !== "beginner" && (cardioPreference === "moderate" || cardioPreference === "high"));

  return {
    goal,
    trainingDaysPerWeek,
    restDays,
    longRunDay,
    equipment,
    experience,
    sessionLength,
    cardioPreference,
    includeIntervals,
    weekIndex: Number.isFinite(Number(input.weekIndex)) ? Number(input.weekIndex) : 0,
    generatedAt: typeof input.generatedAt === "string" && input.generatedAt ? input.generatedAt : null,
    notes: typeof input.notes === "string" ? input.notes.slice(0, 300) : "",
  };
}

function resolveRestDays(requested, training, goal, longRunDay) {
  const restCount = 7 - training;
  let rest = requested.filter((d) => !(goalUsesRunning(goal) && d === longRunDay));

  if (rest.length > restCount) {
    // Too many hard rest days for the training volume — keep the most-preferred.
    const ranked = [...rest].sort((a, b) => REST_FILL_ORDER.indexOf(a) - REST_FILL_ORDER.indexOf(b));
    rest = ranked.slice(0, restCount);
  } else if (rest.length < restCount) {
    for (const day of REST_FILL_ORDER) {
      if (rest.length >= restCount) break;
      if (rest.includes(day)) continue;
      if (goalUsesRunning(goal) && day === longRunDay) continue;
      rest.push(day);
    }
    // Last resort (e.g. long-run day was the only slot left): allow any day.
    for (const day of REST_FILL_ORDER) {
      if (rest.length >= restCount) break;
      if (!rest.includes(day)) rest.push(day);
    }
  }
  return sortDays(rest);
}

function pickLongRunFallback(trainingDays) {
  // Prefer the weekend-most training day for the long run.
  const weekendPref = ["Sunday", "Saturday", "Friday", "Monday", "Thursday", "Wednesday", "Tuesday"];
  for (const d of weekendPref) if (trainingDays.includes(d)) return d;
  return trainingDays[trainingDays.length - 1] || "Saturday";
}

// ─── Role templates ─────────────────────────────────────────────────────────
// A "role" is an abstract day type; buildDayFromRole turns it into a concrete
// lifting/cardio day. Templates return an ordered list of exactly `training`
// roles for the given goal.
const GOAL_TEMPLATES = {
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
  fat_loss: {
    2: ["full_body", "full_body"],
    3: ["full_body", "full_body", "full_body"],
    4: ["upper", "lower", "easy_run", "easy_run"],
    5: ["full_body", "upper", "lower", "easy_run", "easy_run"],
    6: ["upper", "lower", "easy_run", "upper", "lower", "recovery"],
  },
};

function templateRoles(goal, training) {
  const byCount = GOAL_TEMPLATES[goal] || GOAL_TEMPLATES.hybrid;
  return (byCount[training] || byCount[Math.min(6, Math.max(2, training))] || []).slice();
}

// Roles that carry cardio (rather than lifting).
const CARDIO_ROLES = new Set(["easy_run", "long_run", "tempo_run", "quality_run", "recovery"]);
// Lifting roles that load the lower body heavily — spaced away from hard runs.
const HEAVY_LOWER_ROLES = new Set(["lower", "legs", "squat", "deadlift", "full_body"]);

function roleIsHeavyLower(role) {
  return HEAVY_LOWER_ROLES.has(role);
}
function roleIntensity(role, includeIntervals) {
  if (role === "long_run") return "hard";
  if (role === "tempo_run") return "hard";
  if (role === "quality_run") return includeIntervals ? "hard" : "moderate";
  if (role === "easy_run") return "easy";
  if (role === "recovery" || role === "active_recovery") return "recovery";
  if (role === "squat" || role === "deadlift") return "hard";
  if (roleIsHeavyLower(role)) return "moderate";
  return "moderate";
}

// ─── Weekly schedule allocation ─────────────────────────────────────────────
// Returns a { Weekday: role } map ("rest" for rest days) honoring rest-day
// choices and applying the safety-spacing rules where possible.
export function buildWeeklySchedule(input) {
  const norm = normalizeProgramBuilderInput(input);
  const { goal, restDays, longRunDay, includeIntervals } = norm;

  const trainingDays = DAYS.filter((d) => !restDays.includes(d));
  let roles = templateRoles(goal, trainingDays.length);
  // Guard: if a template is short/long, pad or trim to the actual training-day count.
  while (roles.length < trainingDays.length) roles.push(goalUsesRunning(goal) ? "easy_run" : "full_body");
  if (roles.length > trainingDays.length) roles = roles.slice(0, trainingDays.length);

  const roleByDay = {};
  const hasLongRun = roles.includes("long_run");

  if (hasLongRun) {
    const lrDay = trainingDays.includes(longRunDay) ? longRunDay : pickLongRunFallback(trainingDays);
    roleByDay[lrDay] = "long_run";
    const remainingRoles = roles.filter((r) => r !== "long_run");
    const remainingDays = trainingDays.filter((d) => d !== lrDay);
    remainingDays.forEach((d, i) => { roleByDay[d] = remainingRoles[i] ?? (goalUsesRunning(goal) ? "easy_run" : "full_body"); });
  } else {
    trainingDays.forEach((d, i) => { roleByDay[d] = roles[i]; });
  }

  // Improve day-to-day ordering to respect the safety rules. The long-run day
  // stays locked so it lands on the athlete's chosen day.
  const lockedDay = hasLongRun ? Object.keys(roleByDay).find((d) => roleByDay[d] === "long_run") : null;
  const improved = improveScheduleSafety(roleByDay, restDays, lockedDay, includeIntervals);

  const schedule = {};
  for (const day of DAYS) schedule[day] = restDays.includes(day) ? "rest" : improved[day];
  return schedule;
}

// Count adjacency violations across the calendar week (no weekend wrap).
function scoreSchedule(roleByDay, restDays, includeIntervals) {
  let score = 0;
  for (let i = 0; i < DAYS.length - 1; i++) {
    const a = restDays.includes(DAYS[i]) ? null : roleByDay[DAYS[i]];
    const b = restDays.includes(DAYS[i + 1]) ? null : roleByDay[DAYS[i + 1]];
    if (!a || !b) continue;
    if (roleIsHeavyLower(a) && b === "long_run") score += 4;       // heavy legs before long run
    if (roleIsHeavyLower(a) && (b === "quality_run" || b === "tempo_run")) score += 3; // intervals after heavy lower
    if (roleIntensity(a, includeIntervals) === "hard" && roleIntensity(b, includeIntervals) === "hard") score += 2; // back-to-back max effort
  }
  return score;
}

function improveScheduleSafety(roleByDay, restDays, lockedDay, includeIntervals) {
  const map = { ...roleByDay };
  const movable = Object.keys(map).filter((d) => d !== lockedDay);
  let best = scoreSchedule(map, restDays, includeIntervals);
  if (best === 0) return map;

  // Greedy pairwise swaps of movable training days until no swap improves.
  let improved = true;
  let guard = 0;
  while (improved && guard < 40) {
    improved = false;
    guard += 1;
    for (let i = 0; i < movable.length; i++) {
      for (let j = i + 1; j < movable.length; j++) {
        const di = movable[i], dj = movable[j];
        const trial = { ...map, [di]: map[dj], [dj]: map[di] };
        const s = scoreSchedule(trial, restDays, includeIntervals);
        if (s < best) {
          map[di] = trial[di];
          map[dj] = trial[dj];
          best = s;
          improved = true;
        }
      }
    }
  }
  return map;
}

// ─── Set/rep schemes ────────────────────────────────────────────────────────
const GOAL_SCHEME = {
  strength:      { compound: { sets: 4, reps: 5 }, accessory: { sets: 3, reps: 10 }, main: { sets: 5, reps: 3 } },
  bodybuilding:  { compound: { sets: 4, reps: 8 }, accessory: { sets: 3, reps: 12 }, main: { sets: 4, reps: 8 } },
  basic_fitness: { compound: { sets: 3, reps: 8 }, accessory: { sets: 2, reps: 12 }, main: { sets: 3, reps: 8 } },
  fat_loss:      { compound: { sets: 3, reps: 10 }, accessory: { sets: 3, reps: 12 }, main: { sets: 3, reps: 10 } },
  hybrid:        { compound: { sets: 4, reps: 6 }, accessory: { sets: 3, reps: 12 }, main: { sets: 4, reps: 6 } },
  endurance:     { compound: { sets: 3, reps: 8 }, accessory: { sets: 2, reps: 12 }, main: { sets: 3, reps: 8 } },
};

const EXPERIENCE_ADJUST = {
  beginner:     { sets: -1, count: -1 },
  intermediate: { sets: 0,  count: 0 },
  advanced:     { sets: 1,  count: 1 },
};

const SESSION_BASE_COUNT = { 30: 4, 45: 5, 60: 6, 75: 7 };

function exerciseCountForSession(sessionLength, experience) {
  const base = SESSION_BASE_COUNT[sessionLength] || 6;
  const adj = EXPERIENCE_ADJUST[experience]?.count || 0;
  return Math.max(3, base + adj);
}

// Build one { name, sets, reps, notes } lifting entry.
function liftEntry(exercise, { goal, experience, isMain }) {
  const scheme = GOAL_SCHEME[goal] || GOAL_SCHEME.hybrid;
  const band = isMain ? scheme.main : (isCompoundPattern(exercise.pattern) ? scheme.compound : scheme.accessory);
  const setsAdj = EXPERIENCE_ADJUST[experience]?.sets || 0;
  const sets = Math.max(2, band.sets + (isCompoundPattern(exercise.pattern) ? setsAdj : Math.min(0, setsAdj)));
  return {
    name: exercise.name,
    sets,
    reps: band.reps,
    notes: exercise.notes,
  };
}

// ─── Role → concrete day ────────────────────────────────────────────────────
// Each pattern-plan entry is [pattern, count]. `main` marks the anchor lift.
const LIFT_ROLE_PLANS = {
  full_body:      { type: "Full Body", code: "FULL BODY", plan: [["squat", 1], ["horizontalPush", 1], ["horizontalPull", 1], ["hinge", 1], ["verticalPush", 1], ["core", 1], ["calves", 1]] },
  full_body_light:{ type: "Full Body (Light)", code: "FULL LIGHT", plan: [["squat", 1], ["horizontalPush", 1], ["horizontalPull", 1], ["core", 1]], light: true },
  upper:          { type: "Upper Body", code: "UPPER", plan: [["horizontalPush", 1], ["horizontalPull", 1], ["verticalPush", 1], ["verticalPull", 1], ["lateralDelts", 1], ["biceps", 1], ["triceps", 1]] },
  lower:          { type: "Lower Body", code: "LOWER", plan: [["squat", 1], ["hinge", 1], ["singleLeg", 1], ["quadIso", 1], ["hamstringIso", 1], ["calves", 1]] },
  push:           { type: "Push", code: "PUSH", plan: [["horizontalPush", 1], ["verticalPush", 1], ["chestIsolation", 1], ["lateralDelts", 1], ["triceps", 2]] },
  pull:           { type: "Pull", code: "PULL", plan: [["verticalPull", 1], ["horizontalPull", 1], ["backIsolation", 1], ["rearDelts", 1], ["biceps", 2]] },
  legs:           { type: "Legs", code: "LEGS", plan: [["squat", 1], ["hinge", 1], ["singleLeg", 1], ["quadIso", 1], ["hamstringIso", 1], ["calves", 1]] },
  chest:          { type: "Chest", code: "CHEST", plan: [["horizontalPush", 2], ["chestIsolation", 2], ["triceps", 2]] },
  back:           { type: "Back", code: "BACK", plan: [["verticalPull", 1], ["horizontalPull", 2], ["backIsolation", 1], ["biceps", 2]] },
  shoulders:      { type: "Shoulders", code: "SHOULDERS", plan: [["verticalPush", 2], ["lateralDelts", 2], ["rearDelts", 1], ["core", 1]] },
  arms:           { type: "Arms", code: "ARMS", plan: [["biceps", 2], ["triceps", 2], ["biceps", 1], ["triceps", 1]] },
  squat:          { type: "Squat Focus", code: "SQUAT", main: "squat", plan: [["squat", 1], ["hinge", 1], ["singleLeg", 1], ["quadIso", 1], ["core", 1]] },
  bench:          { type: "Bench Focus", code: "BENCH", main: "horizontalPush", plan: [["horizontalPush", 1], ["verticalPush", 1], ["horizontalPull", 1], ["triceps", 1], ["lateralDelts", 1]] },
  deadlift:       { type: "Deadlift Focus", code: "DEADLIFT", main: "hinge", plan: [["hinge", 1], ["squat", 1], ["horizontalPull", 1], ["backIsolation", 1], ["core", 1]] },
  press:          { type: "Overhead Press Focus", code: "PRESS", main: "verticalPush", plan: [["verticalPush", 1], ["horizontalPush", 1], ["verticalPull", 1], ["biceps", 1], ["triceps", 1]] },
  upper_accessory:{ type: "Upper Accessory", code: "UPPER ACC", plan: [["horizontalPush", 1], ["horizontalPull", 1], ["lateralDelts", 1], ["biceps", 1], ["triceps", 1]] },
};

// Small core block attached to interval/recovery cardio days for variety.
function coreBlock(ctx) {
  const picks = selectExercises("core", ctx.equipment, ctx.experience, 2, ctx.seed);
  return picks.map((e) => liftEntry(e, { goal: ctx.goal, experience: ctx.experience, isMain: false }));
}

function buildLiftingDay(role, ctx, occurrence) {
  const spec = LIFT_ROLE_PLANS[role] || LIFT_ROLE_PLANS.full_body;
  const maxCount = exerciseCountForSession(ctx.sessionLength, ctx.experience) - (spec.light ? 1 : 0);
  const seed = ctx.seed;
  const lifting = [];
  let filled = 0;
  let mainDone = false;

  for (const [pattern, count] of spec.plan) {
    if (filled >= maxCount) break;
    const take = Math.min(count, maxCount - filled);
    const picks = selectExercises(pattern, ctx.equipment, ctx.experience, take, seed + filled);
    picks.forEach((exr) => {
      if (filled >= maxCount) return;
      const isMain = spec.main === pattern && !mainDone;
      if (isMain) mainDone = true;
      lifting.push(liftEntry(exr, { goal: ctx.goal, experience: ctx.experience, isMain }));
      filled += 1;
    });
  }

  // Deload week: trim the top set off each movement.
  const adjusted = ctx.deload
    ? lifting.map((l) => ({ ...l, sets: Math.max(1, l.sets - 1) }))
    : lifting;

  const letter = occurrence > 1 ? ` ${String.fromCharCode(64 + occurrence)}` : "";
  return {
    type: `${spec.type}${letter}${ctx.deload ? " · Deload" : ""}`,
    code: `${spec.code}${letter}`.trim(),
    lifting: adjusted,
    cardio: null,
  };
}

// Miles scaling by experience for run days.
const RUN_MILES = {
  beginner:     { easy: 3, long: 5, tempo: 3, quality: 3 },
  intermediate: { easy: 4, long: 8, tempo: 5, quality: 5 },
  advanced:     { easy: 5, long: 11, tempo: 6, quality: 6 },
};

function buildCardioDay(role, ctx) {
  const miles = RUN_MILES[ctx.experience] || RUN_MILES.intermediate;
  const volMul = ctx.deload ? 0.7 : (ctx.volumeBump ? 1.1 : 1);
  const round = (m) => Math.round(m * volMul * 10) / 10;
  const deloadNote = ctx.deload ? " Deload week — keep it easy and short." : "";

  if (role === "long_run") {
    return { type: "Long Run", code: "LONG", lifting: [], cardio: buildCardio("long_run", { miles: round(miles.long), notes: (ctx.variantNote || CardioNoteFor("long_run", ctx.weekIndex)) + deloadNote }) };
  }
  if (role === "tempo_run") {
    return { type: "Tempo Run", code: "TEMPO", lifting: [], cardio: buildCardio("tempo_run", { miles: round(miles.tempo), notes: CardioNoteFor("tempo_run", ctx.weekIndex) + deloadNote }) };
  }
  if (role === "quality_run") {
    // Alternate hard quality: intervals when the athlete opted in, else hills/tempo.
    if (ctx.includeIntervals && !ctx.deload) {
      const key = ctx.weekIndex % 2 === 0 ? "intervals" : "hill_repeats";
      return { type: CARDIO_LABEL[key], code: "QUALITY", lifting: [], cardio: buildCardio(key, { miles: round(miles.quality) }) };
    }
    return { type: "Tempo Run", code: "QUALITY", lifting: [], cardio: buildCardio("tempo_run", { miles: round(miles.tempo), notes: CardioNoteFor("tempo_run", ctx.weekIndex) + deloadNote }) };
  }
  if (role === "recovery") {
    return { type: "Recovery + Core", code: "RECOVERY", lifting: coreBlock(ctx), cardio: buildCardio("recovery_walk", { miles: round(2) }) };
  }
  // easy_run: rotate easy variants for variety across weeks.
  const easyKey = ["easy_run", "zone2_run", "incline_walk"][ctx.weekIndex % 3];
  return { type: CARDIO_LABEL[easyKey], code: "EASY", lifting: [], cardio: buildCardio(easyKey, { miles: round(miles.easy), notes: CardioNoteFor(easyKey, ctx.weekIndex) }) };
}

const CARDIO_LABEL = {
  easy_run: "Easy Run", zone2_run: "Zone 2 Run", incline_walk: "Incline Walk",
  intervals: "Intervals + Core", hill_repeats: "Hill Repeats", tempo_run: "Tempo Run",
};

function CardioNoteFor(key, weekIndex) {
  const variants = {
    easy_run: ["Relaxed aerobic miles — nothing forced.", "Keep it conversational; add strides if you feel good.", "Pure easy volume. Slow is the point."],
    zone2_run: ["Steady Zone 2 — controlled and sustainable.", "Aerobic base work; hold the pace even on hills.", "Long-ish steady effort at true Zone 2."],
    incline_walk: ["Brisk incline walk — low impact aerobic work.", "Steady incline, easy on the joints.", "Recovery-friendly aerobic session."],
    long_run: ["Weekly mileage anchor — easy and conversational.", "Long, steady, aerobic. Fuel before and hydrate.", "Build the aerobic engine; negative-split the last mile if fresh."],
    tempo_run: ["Comfortably hard sustained effort in the middle.", "Threshold work — controlled discomfort, not a race.", "Steady tempo; hold form as it gets hard."],
  };
  const list = variants[key];
  if (!list) return buildCardio(key).notes;
  return list[weekIndex % list.length];
}

function buildActiveRecoveryDay(ctx) {
  return {
    type: "Active Recovery",
    code: "ACTIVE",
    lifting: coreBlock(ctx),
    cardio: buildCardio("recovery_walk", { miles: 2, notes: "Optional easy movement or mobility. Genuinely light — this is recovery, not a session." }),
  };
}

function restDay() {
  return { type: "Rest", code: "REST", lifting: [], cardio: null };
}

// ─── Build the weekly program ───────────────────────────────────────────────
export function buildProgramPlan(input) {
  const norm = normalizeProgramBuilderInput(input);
  const schedule = buildWeeklySchedule(norm);
  const weekIndex = norm.weekIndex;
  const deload = false; // single-week plan is always a base week; deload comes via buildWeekVariant
  const seedBase = 3 + weekIndex * 5;

  const program = {};
  const roleOccurrence = {};
  for (const day of DAYS) {
    const role = schedule[day];
    if (role === "rest") { program[day] = restDay(); continue; }
    const ctx = {
      goal: norm.goal,
      equipment: norm.equipment,
      experience: norm.experience,
      sessionLength: norm.sessionLength,
      includeIntervals: norm.includeIntervals,
      weekIndex,
      deload,
      volumeBump: false,
      seed: seedBase + DAYS.indexOf(day),
    };
    if (role === "active_recovery") { program[day] = buildActiveRecoveryDay(ctx); continue; }
    if (CARDIO_ROLES.has(role)) { program[day] = buildCardioDay(role, ctx); continue; }
    roleOccurrence[role] = (roleOccurrence[role] || 0) + 1;
    program[day] = buildLiftingDay(role, ctx, roleOccurrence[role]);
  }

  const rationale = buildRationale(norm, schedule);
  const warnings = buildWarnings(norm, schedule);

  return {
    input: norm,
    program,
    metadata: {
      generatedBy: "programBuilderV2",
      goal: norm.goal,
      trainingDaysPerWeek: norm.trainingDaysPerWeek,
      restDays: norm.restDays,
      longRunDay: norm.longRunDay,
      equipment: norm.equipment,
      experience: norm.experience,
      sessionLength: norm.sessionLength,
      cardioPreference: norm.cardioPreference,
      includeIntervals: norm.includeIntervals,
      weekVariant: weekIndex + 1,
      isDeload: false,
      generatedAt: norm.generatedAt,
    },
    rationale,
    warnings,
  };
}

// ─── Week-to-week variation ─────────────────────────────────────────────────
// Week 1 base · Week 2 varied accessories/cardio · Week 3 slightly harder ·
// Week 4 deload. Applies via seed offset + volume flags; does NOT auto-persist.
export function buildWeekVariant(baseInput, weekIndex = 0) {
  const norm = normalizeProgramBuilderInput(baseInput);
  const deload = weekIndex === 3;
  const volumeBump = weekIndex === 2;
  const schedule = buildWeeklySchedule(norm);
  const seedBase = 3 + weekIndex * 5;

  const program = {};
  const roleOccurrence = {};
  for (const day of DAYS) {
    const role = schedule[day];
    if (role === "rest") { program[day] = restDay(); continue; }
    const ctx = {
      goal: norm.goal,
      equipment: norm.equipment,
      experience: norm.experience,
      sessionLength: norm.sessionLength,
      includeIntervals: norm.includeIntervals,
      weekIndex,
      deload,
      volumeBump,
      seed: seedBase + DAYS.indexOf(day),
    };
    if (role === "active_recovery") { program[day] = buildActiveRecoveryDay(ctx); continue; }
    if (CARDIO_ROLES.has(role)) { program[day] = buildCardioDay(role, ctx); continue; }
    roleOccurrence[role] = (roleOccurrence[role] || 0) + 1;
    let day3 = buildLiftingDay(role, ctx, roleOccurrence[role]);
    if (volumeBump && !deload) {
      // Slightly more challenge where safe: +1 set on the anchor compound only.
      const lifting = day3.lifting.slice();
      if (lifting[0]) lifting[0] = { ...lifting[0], sets: lifting[0].sets + 1 };
      day3 = { ...day3, lifting };
    }
    program[day] = day3;
  }

  const focusNote = ["Base week — establish movements and baseline loads.",
    "Variation week — accessories and cardio rotate to spread stimulus.",
    "Progression week — a touch more volume/intensity where it's safe.",
    "Deload week — reduced sets and easy cardio to absorb the work."][weekIndex] || "";

  return {
    weekIndex,
    weekLabel: `Week ${weekIndex + 1}`,
    isDeload: deload,
    focus: focusNote,
    program,
    metadata: {
      generatedBy: "programBuilderV2",
      goal: norm.goal,
      weekVariant: weekIndex + 1,
      isDeload: deload,
      generatedAt: norm.generatedAt,
    },
  };
}

export function buildMultiWeekProgram(input, weeks = 4) {
  const count = Math.max(1, Math.min(8, Math.round(Number(weeks)) || 4));
  const out = [];
  for (let i = 0; i < count; i++) out.push(buildWeekVariant(input, i));
  return out;
}

// ─── Rationale + warnings ───────────────────────────────────────────────────
function goalLabel(goal) {
  return PROGRAM_BUILDER_GOALS.find((g) => g.id === goal)?.label || goal;
}

function buildRationale(norm, schedule) {
  const lines = [];
  const liftingDays = DAYS.filter((d) => schedule[d] !== "rest" && !CARDIO_ROLES.has(schedule[d]) && schedule[d] !== "active_recovery").length;
  const cardioDays = DAYS.filter((d) => CARDIO_ROLES.has(schedule[d])).length;

  lines.push(`${goalLabel(norm.goal)} focus across ${norm.trainingDaysPerWeek} training days, ${norm.experience} volume.`);
  if (liftingDays) lines.push(`${liftingDays} lifting session${liftingDays === 1 ? "" : "s"} using your ${EQUIPMENT_OPTIONS.find((e) => e.id === norm.equipment)?.label.toLowerCase() || norm.equipment} setup, ~${norm.sessionLength} min each.`);
  if (cardioDays) lines.push(`${cardioDays} cardio session${cardioDays === 1 ? "" : "s"} scheduled around your lifting.`);
  if (norm.restDays.length) lines.push(`Rest kept on ${norm.restDays.join(", ")}.`);
  if (norm.longRunDay) lines.push(`Long run placed on ${norm.longRunDay}, with heavy lower-body work spaced away from it.`);
  if (norm.trainingDaysPerWeek >= 6) lines.push("Six days: at least one session is kept low-intensity or active recovery.");
  if (norm.experience === "beginner") lines.push("Beginner: fewer sets and simpler movements to build the pattern first.");
  return lines;
}

function buildWarnings(norm, schedule) {
  const warnings = [];
  // Long-run relocation.
  if (goalUsesRunning(norm.goal) && DAYS.includes(norm.longRunDay) && schedule[norm.longRunDay] !== "long_run") {
    warnings.push(`Long run moved to a nearby training day — ${norm.longRunDay} wasn't available as a run day.`);
  }
  // Residual adjacency risk.
  const roleByDay = {};
  for (const d of DAYS) roleByDay[d] = schedule[d];
  const score = scoreSchedule(roleByDay, norm.restDays, norm.includeIntervals);
  if (score > 0) warnings.push("With your chosen days, a hard session sits close to another — reorder rest days for more spacing if you can.");
  warnings.push("Generated programming is general guidance, not medical or injury advice. Adjust anything that doesn't feel right.");
  return warnings;
}

// ─── Summary for UI ─────────────────────────────────────────────────────────
export function summarizeGeneratedPlan(plan) {
  const program = plan?.program || {};
  const days = DAYS.map((day) => {
    const d = program[day] || {};
    const lifting = Array.isArray(d.lifting) ? d.lifting : [];
    const cardio = d.cardio || null;
    const isRest = lifting.length === 0 && !cardio;
    const parts = [];
    if (lifting.length) parts.push(`${lifting.length} lift${lifting.length === 1 ? "" : "s"}`);
    if (cardio) parts.push(`${cardio.type}${cardio.miles ? ` ${cardio.miles}mi` : ""}`);
    return {
      day,
      type: d.type || (isRest ? "Rest" : ""),
      label: parts.join(" + ") || "Rest",
      isRest,
      hasLifting: lifting.length > 0,
      hasCardio: !!cardio,
    };
  });

  const trainingDays = days.filter((d) => !d.isRest).length;
  const liftingDays = days.filter((d) => d.hasLifting).length;
  const cardioDays = days.filter((d) => d.hasCardio).length;
  const totalWeeklySets = DAYS.reduce((sum, day) => {
    const lifting = Array.isArray(program[day]?.lifting) ? program[day].lifting : [];
    return sum + lifting.reduce((s, l) => s + (Number(l.sets) || 0), 0);
  }, 0);

  return {
    goal: plan?.metadata?.goal || null,
    trainingDays,
    liftingDays,
    cardioDays,
    restDays: 7 - trainingDays,
    totalWeeklySets,
    longRunDay: plan?.metadata?.longRunDay || null,
    headline: `${trainingDays} training days · ${liftingDays} lifting · ${cardioDays} cardio`,
    days,
  };
}

// ─── Validation (used by callers before persisting) ─────────────────────────
export function validateGeneratedProgram(program) {
  const errors = [];
  if (!program || typeof program !== "object") {
    return { valid: false, errors: ["Program is missing or not an object."] };
  }
  for (const day of DAYS) {
    const d = program[day];
    if (!d || typeof d !== "object") { errors.push(`${day}: missing day object.`); continue; }
    if (typeof d.type !== "string" || !d.type) errors.push(`${day}: missing type.`);
    if (typeof d.code !== "string" || !d.code) errors.push(`${day}: missing code.`);
    if (!Array.isArray(d.lifting)) errors.push(`${day}: lifting must be an array.`);
    if (!(d.cardio === null || (d.cardio && typeof d.cardio === "object"))) errors.push(`${day}: cardio must be null or an object.`);
    const isRest = Array.isArray(d.lifting) && d.lifting.length === 0 && !d.cardio;
    if (isRest && d.cardio !== null) errors.push(`${day}: rest day must have null cardio.`);
    for (const l of (Array.isArray(d.lifting) ? d.lifting : [])) {
      if (typeof l.name !== "string" || !l.name) errors.push(`${day}: a lift is missing a name.`);
      if (!Number.isFinite(Number(l.sets))) errors.push(`${day}: ${l.name || "a lift"} has non-numeric sets.`);
    }
  }
  // Must contain all seven weekdays and nothing else required.
  const missing = DAYS.filter((d) => !(d in program));
  if (missing.length) errors.push(`Missing days: ${missing.join(", ")}.`);
  return { valid: errors.length === 0, errors };
}

// ─── Settings patch (non-clobbering) ────────────────────────────────────────
// Returns ONLY { programBuilder: {...} } so callers can shallow-merge it into
// settings without touching goals/theme/supplements/oura/etc.
export function buildProgramBuilderSettingsPatch(input, plan = null) {
  const norm = normalizeProgramBuilderInput(input);
  return {
    programBuilder: {
      goal: norm.goal,
      trainingDaysPerWeek: norm.trainingDaysPerWeek,
      restDays: norm.restDays,
      longRunDay: norm.longRunDay,
      equipment: norm.equipment,
      experience: norm.experience,
      sessionLength: norm.sessionLength,
      cardioPreference: norm.cardioPreference,
      includeIntervals: norm.includeIntervals,
      varietyMode: "balanced",
      lastGeneratedAt: plan?.metadata?.generatedAt || norm.generatedAt || null,
    },
  };
}
