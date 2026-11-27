// src/programBuilder.js
// Program Builder V2 — pure plan generator
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

import { DAYS, PROGRAM_PRESETS } from "./constants";
import {
  selectExercises,
  isCompoundPattern,
  exercisePrescription,
  findLibraryExercise,
  EXERCISES,
} from "./programExerciseLibrary";
import { resolveTrackingMode, TRACKING_MODES } from "./workoutLogging";

// Catalogs (exported for UI + validation)
export const PROGRAM_BUILDER_GOALS = [
  { id: "basic_fitness", label: "Basic fitness",  desc: "General health and strength. Simple full-body sessions plus easy cardio." },
  { id: "bodybuilding",  label: "Bodybuilding",   desc: "Hypertrophy focus. Higher volume, muscle-group variety across the week." },
  { id: "strength",      label: "Strength",       desc: "Squat, bench, deadlift and press. Heavier, lower reps, more rest between." },
  { id: "endurance",     label: "Running / endurance", desc: "Miles first. Mostly easy running with a weekly long run and light strength support." },
  { id: "hybrid",        label: "Hybrid",         desc: "Lift and run seriously. Lower-body work spaced away from the hard runs." },
  { id: "cardio_only",   label: "Cardio only", desc: "Time-based aerobic sessions using your preferred activity." },
  { id: "fat_loss",      label: "Fat loss / recomp", desc: "Hold muscle in a deficit. Full-body or upper/lower strength with more cardio." },
];
export const PROGRAM_BUILDER_GOAL_IDS = PROGRAM_BUILDER_GOALS.map((g) => g.id);

export const TRAINING_DAY_OPTIONS = [2, 3, 4, 5, 6];

export const REST_DAY_OPTIONS = [...DAYS];
export { DAYS };

export const EQUIPMENT_OPTIONS = [
  { id: "full_gym",   label: "Full gym",       desc: "Barbells, dumbbells, machines and cables." },
  { id: "dumbbells",  label: "Dumbbells only", desc: "Adjustable or fixed dumbbells, plus bodyweight." },
  { id: "barbell", label: "Barbell and plates", desc: "Straight bar, plates and floor space." },
  { id: "free_weights", label: "Free weights with rack and bench", desc: "Straight bar, rack, bench, plates and dumbbells." },
  { id: "bodyweight", label: "Bodyweight",     desc: "No equipment — home or travel friendly." },
  { id: "calisthenics", label: "Calisthenics bars", desc: "Bodyweight, secure high and low bars, a bench or step, and towels for sliding curls." },
  { id: "machines", label: "Machines and cables", desc: "Selectorized machines, plate-loaded machines and cable stations." },
  { id: "mixed", label: "Choose my equipment", desc: "Combine the equipment you have with floor exercises." },
];
export const EQUIPMENT_COMBINATIONS = EQUIPMENT_OPTIONS.filter(e => !["full_gym", "bodyweight", "mixed"].includes(e.id));
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
export const CARDIO_MODALITIES = [
  { id: "mixed", label: "Mixed cardio" }, { id: "run", label: "Running" }, { id: "walk", label: "Walking" },
  { id: "bike", label: "Cycling" }, { id: "row", label: "Rowing" }, { id: "elliptical", label: "Elliptical" },
];
const GUIDE_FOR_GOAL = {
  bodybuilding: "upperLowerGrowth", strength: "barbellStrength", hybrid: "balancedHybrid",
  basic_fitness: "foundation", fat_loss: "foundation", endurance: "cardioBase", cardio_only: "cardioBase",
};
const RUNNING_GOALS = ["endurance", "hybrid"];
export function goalUsesRunning(goal) {
  return RUNNING_GOALS.includes(goal);
}

// Map an onboarding goal id → a builder goal id.
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

// Recommendations
const GOAL_DEFAULT_DAYS = {
  basic_fitness: 3,
  bodybuilding: 4,
  strength: 3,
  endurance: 4,
  hybrid: 4,
  fat_loss: 4,
  cardio_only: 4,
};
export function recommendTrainingDaysForGoal(goal) {
  return GOAL_DEFAULT_DAYS[goal] || 4;
}

const GOAL_DEFAULT_CARDIO = {
  basic_fitness: "light",
  bodybuilding: "none",
  strength: "none",
  endurance: "high",
  hybrid: "moderate",
  fat_loss: "moderate",
  cardio_only: "moderate",
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

// Input normalization
export function normalizeProgramBuilderInput(input = {}) {
  const goal = PROGRAM_BUILDER_GOAL_IDS.includes(input.goal) ? input.goal : "hybrid";
  const trainingDaysPerWeek = clampTrainingDays(input.trainingDaysPerWeek, goal);
  const equipment = EQUIPMENT_IDS.includes(input.equipment) ? input.equipment : "full_gym";
  const equipmentChoices = Array.isArray(input.equipmentChoices)
    ? EQUIPMENT_COMBINATIONS.filter(option => input.equipmentChoices.includes(option.id)).map(option => option.id)
    : equipment === "mixed" ? EQUIPMENT_COMBINATIONS.map(option => option.id) : [];
  const experience = EXPERIENCE_IDS.includes(input.experience) ? input.experience : "intermediate";
  const sessionLength = SESSION_LENGTH_OPTIONS.includes(Number(input.sessionLength)) ? Number(input.sessionLength) : 60;
  const usesRunning = goalUsesRunning(goal);
  const cardioModality = CARDIO_MODALITIES.some(option => option.id === input.cardioModality) ? input.cardioModality : "mixed";
  const adaptiveTraining = input.adaptiveTraining !== false;

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
    : ((usesRunning || goal === "cardio_only") && experience !== "beginner" && (cardioPreference === "moderate" || cardioPreference === "high"));

  return {
    goal,
    trainingDaysPerWeek,
    restDays,
    longRunDay,
    equipment,
    equipmentChoices,
    experience,
    sessionLength,
    cardioPreference,
    cardioModality,
    adaptiveTraining,
    includeIntervals,
    weekIndex: Number.isFinite(Number(input.weekIndex)) ? Number(input.weekIndex) : 0,
    generatedAt: typeof input.generatedAt === "string" && input.generatedAt ? input.generatedAt : null,
    notes: typeof input.notes === "string" ? input.notes.slice(0, 300) : "",
  };
}

function resolveRestDays(requested, training, goal, longRunDay) {
  const restCount = 7 - training;
  let rest = [...requested];

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

// Role templates
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
    5: ["upper", "lower", "upper", "lower", "upper_accessory"],
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
    2: ["full_body", "long_run"],
    3: ["full_body", "full_body", "long_run"],
    4: ["full_body", "easy_run", "full_body", "long_run"],
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

// Weekly schedule allocation
// Returns a { Weekday: role } map ("rest" for rest days) honoring rest-day
// choices and applying the safety-spacing rules where possible.
export function buildWeeklySchedule(input) {
  const norm = normalizeProgramBuilderInput(input);
  const { goal, restDays, longRunDay, includeIntervals } = norm;

  const trainingDays = DAYS.filter((d) => !restDays.includes(d));
  let roles = goal === "cardio_only" ? trainingDays.map((_, i) =>
    includeIntervals && norm.experience !== "beginner" && trainingDays.length >= 3 && i === 1 ? "quality_run" : "easy_run")
    : templateRoles(goal, trainingDays.length);
  if (!goalUsesRunning(goal) && goal !== "cardio_only") {
    const target = CARDIO_PREFERENCES.find(p => p.id === norm.cardioPreference).sessions;
    let cardioSlots = target - (target > 0 && roles.includes("active_recovery") ? 1 : 0);
    roles = roles.map(role => {
      if (!CARDIO_ROLES.has(role)) return role;
      if (cardioSlots <= 0) return "full_body_light";
      cardioSlots -= 1;
      return role;
    });
  }
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

// Include the boundary when this seven-day schedule repeats.
function scoreSchedule(roleByDay, restDays, includeIntervals) {
  let score = 0;
  for (let i = 0; i < DAYS.length; i++) {
    const a = restDays.includes(DAYS[i]) ? null : roleByDay[DAYS[i]];
    const following = DAYS[(i + 1) % DAYS.length];
    const b = restDays.includes(following) ? null : roleByDay[following];
    if (a === "full_body" && b === "full_body") score += 1;
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

// Ranges and rests mirror the published plans, including an easier starting
// effort for a novice. Fixed time/distance prescriptions keep their own units.
function liftEntry(exercise, ctx, preferred, isMain = false) {
  const entry = exercisePrescription(exercise.name);
  const mode = resolveTrackingMode(entry);
  const compound = isCompoundPattern(exercise.pattern);
  const loaded = mode === TRACKING_MODES.LOADED_REPS;
  const beginner = ctx.experience === "beginner";
  const strengthMain = ctx.goal === "strength" && isMain && loaded && !beginner;
  const timed = mode === TRACKING_MODES.TIMED_HOLD || mode === TRACKING_MODES.CARRY;
  const matched = preferred?.name === exercise.name;
  const reserve = beginner ? 3 : ctx.goal === "bodybuilding" && !compound ? 1 : 2;
  const reps = timed ? entry.reps : strengthMain ? 5 : matched ? preferred.reps : compound ? 12 : 15;
  const repMin = timed ? Math.max(1, Math.round(reps * 2 / 3)) : strengthMain ? 3 :
    matched ? preferred.repMin : compound && loaded ? 6 : compound ? 8 : 10;
  const sets = beginner ? 2 : preferred?.sets || (compound ? 3 : 2);
  const restSeconds = strengthMain ? 180 : matched ? preferred.restSeconds : compound ? 120 : 90;
  const leverage = mode === TRACKING_MODES.BODYWEIGHT_REPS || mode === TRACKING_MODES.TIMED_HOLD;
  return { ...entry, sets, reps, repMin, restSeconds, progressionExposures: 2,
    ...(!timed && { rir: strengthMain ? 2 : reserve }),
    ...(leverage && { progressionMode: "leverage" }),
    ...(matched && { notes: preferred.notes }),
  };
}

function sessionMinutes(lifting) {
  // Five minutes to warm up, one minute per station change, 45 seconds per
  // work set (double for unilateral work), plus prescribed between-set rests.
  return lifting.reduce((minutes, lift) => {
    const seconds = /per (side|leg|arm)|each (side|leg|arm)/i.test(lift.notes) ? 90 : 45;
    return minutes + 1 + (lift.sets * seconds + (lift.sets - 1) * lift.restSeconds) / 60;
  }, 5);
}

function fitToTime(lifting, minutes) {
  const result = lifting.map(lift => ({ ...lift }));
  // Protect initial movements and keep at least two sets per movement when possible.
  while (result.length && sessionMinutes(result) > minutes) {
    const index = result.findLastIndex(lift => lift.sets > 2);
    if (index >= 0) result[index].sets -= 1;
    else result.pop();
  }
  return result;
}

// Role → concrete day
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

function referenceLifts(role, ctx, occurrence) {
  const number = occurrence - 1;
  let id = GUIDE_FOR_GOAL[ctx.goal];
  let days;
  if (ctx.goal !== "bodybuilding" && ["bodyweight", "calisthenics"].includes(ctx.equipment) && role.startsWith("full_body")) {
    id = "bodyweightStrength";
    days = ["Monday", "Wednesday", "Friday"];
  } else if (id === "upperLowerGrowth" && ["upper", "lower"].includes(role)) {
    days = role === "upper" ? ["Monday", "Thursday"] : ["Tuesday", "Friday"];
  } else if (id === "barbellStrength") {
    days = { full_body: ["Monday", "Wednesday", "Friday"], squat: ["Monday"], deadlift: ["Wednesday"], bench: ["Friday"] }[role];
  } else if (role === "full_body" && ["balancedHybrid", "foundation"].includes(id)) {
    days = ["Monday", "Thursday"];
  }
  return days ? PROGRAM_PRESETS[id].program[days[number % days.length]].lifting : null;
}

function buildLiftingDay(role, ctx, occurrence) {
  const spec = LIFT_ROLE_PLANS[role] || LIFT_ROLE_PLANS.full_body;
  const reference = referenceLifts(role, ctx, occurrence);
  // Alternate lower-body priorities. With a short session plus a cardio
  // finisher, the final movement may be trimmed before the athlete sees it.
  const alternateFullBody = role === "full_body" && ctx.goal === "bodybuilding" && occurrence % 2 === 0;
  const patterns = alternateFullBody
    ? [["hinge", 1], ["horizontalPull", 1], ["horizontalPush", 1], ["squat", 1], ...spec.plan.slice(4)] : spec.plan;
  const slots = reference ? reference.map(preferred => ({ pattern: findLibraryExercise(preferred.name)?.pattern, preferred })) :
    patterns.flatMap(([pattern, count]) => Array.from({ length: count }, () => ({ pattern })));
  const lifting = [];
  for (const { pattern, preferred } of slots) {
    const pool = selectExercises(pattern, ctx.equipment, ctx.experience, EXERCISES.length, ctx.seed + lifting.length, ctx.equipmentChoices);
    const available = pool.filter(ex => !lifting.some(lift => lift.name === ex.name));
    const preferredPick = available.find(ex => ex.name === preferred?.name);
    const loadedFocus = ctx.goal === "bodybuilding" || ctx.goal === "strength" || ctx.equipment === "dumbbells";
    const comparable = loadedFocus ? available.find(ex => ex.equipment !== "bodyweight") : null;
    const pick = preferredPick || comparable || available[0];
    if (pick) lifting.push(liftEntry(pick, ctx, preferred, !lifting.length));
  }
  // Sparse equipment can leave an isolation-only session empty. Fill it with
  // feasible movements from distinct patterns while preserving session order.
  if (lifting.length < 3) {
    for (const pattern of ["squat", "horizontalPush", "horizontalPull", "hinge", "core"]) {
      if (lifting.length >= 3) break;
      const [pick] = selectExercises(pattern, ctx.equipment, ctx.experience, 1, 0, ctx.equipmentChoices);
      if (pick && !lifting.some(lift => lift.name === pick.name)) lifting.push(liftEntry(pick, ctx));
    }
  }
  const adjusted = ctx.deload || spec.light ? lifting.map(lift => ({ ...lift, sets: Math.max(1, lift.sets - 1) })) : lifting;
  const letter = occurrence > 1 ? ` ${String.fromCharCode(64 + occurrence)}` : "";
  const restricted = !["full_gym", "free_weights"].includes(ctx.equipment) && !(ctx.equipment === "mixed" && ctx.equipmentChoices.includes("free_weights"));
  const focus = restricted && { bench: "Horizontal press", press: "Overhead press", deadlift: "Hip hinge", squat: "Squat pattern" }[role];
  return { type: `${focus || spec.type}${letter}${ctx.deload ? " · Deload" : ""}`, code: `${spec.code}${letter}`.trim(),
    lifting: fitToTime(adjusted, ctx.sessionLength), cardio: null };
}

const MODALITY_NAMES = { run: "Run", walk: "Walk", bike: "Ride", row: "Row", elliptical: "Elliptical" };

function steadyCardio(modality, minutes, type) {
  return { type, modality, miles: 0, minutes, effort: "Conversational · RPE 3–4/10",
    notes: "Start gently and keep the pace easy enough to speak in sentences.",
    steps: [{ kind: "steady", minutes, intensity: "easy" }] };
}

function buildCardioDay(role, ctx, occurrence) {
  const gym = ["full_gym", "machines"].includes(ctx.equipment) || (ctx.equipment === "mixed" && ctx.equipmentChoices.includes("machines"));
  const rotation = gym ? ["walk", "run", "bike", "elliptical", "row"] : ["walk", "run"];
  const selected = ctx.goal === "cardio_only" && ctx.cardioModality !== "mixed" ? ctx.cardioModality : null;
  const modality = selected || (ctx.goal === "cardio_only" ? rotation[(occurrence - 1) % rotation.length] : "run");
  const quality = (role === "tempo_run" || role === "quality_run") && ctx.includeIntervals && !ctx.deload && ctx.experience !== "beginner";
  if (quality) {
    const rounds = ctx.sessionLength < 45 ? 3 : 4;
    const warmup = rounds === 3 ? 7 : 10;
    const cooldown = 5;
    const minutes = warmup + rounds * 4 + (rounds - 1) * 3 + cooldown;
    return { type: `${MODALITY_NAMES[modality]} intervals`, code: "QUALITY", lifting: [],
      cardio: { type: `${MODALITY_NAMES[modality]} intervals`, modality, minutes, miles: 0, effort: "Hard and repeatable · RPE 7–8/10",
        notes: `Warm up for ${warmup} minutes. Complete ${rounds} × 4 minutes brisk with 3 easy minutes between efforts. Cool down for ${cooldown} minutes.`,
        steps: [{ kind: "warmup", minutes: warmup, intensity: "easy" },
          { kind: "repeat", reps: rounds, work: { minutes: 4, intensity: "interval" }, recovery: { minutes: 3, intensity: "easy" } },
          { kind: "cooldown", minutes: cooldown, intensity: "easy" }] } };
  }
  const easy = { beginner: 20, intermediate: 30, advanced: 40 }[ctx.experience];
  const longRun = role === "long_run";
  const planned = longRun ? easy + 15 : easy;
  const minutes = Math.min(ctx.sessionLength, ctx.deload ? Math.round(planned * .75) : planned);
  const type = longRun ? "Long Run" : role === "recovery" ? "Recovery Walk" : `Easy ${MODALITY_NAMES[modality]}`;
  return { type, code: longRun ? "LONG" : "EASY", lifting: [], cardio: steadyCardio(role === "recovery" ? "walk" : modality, minutes, type) };
}

function buildActiveRecoveryDay(ctx) {
  const picks = selectExercises("core", ctx.equipment, "beginner", 2, 0, ctx.equipmentChoices);
  const lifting = picks.map(pick => ({ ...liftEntry(pick, ctx), sets: 1 }));
  const minutes = Math.min(15, ctx.sessionLength - Math.ceil(sessionMinutes(lifting)));
  return { type: "Active Recovery", code: "ACTIVE", lifting,
    cardio: ctx.cardioPreference === "none" ? null : steadyCardio("walk", minutes, "Recovery Walk") };
}

function restDay() {
  return { type: "Rest", code: "REST", lifting: [], cardio: null };
}

function generateWeek(norm, weekIndex) {
  const schedule = buildWeeklySchedule(norm);
  const adaptive = norm.adaptiveTraining;
  const deload = !adaptive && weekIndex % 4 === 3;
  const roleCount = {};
  let cardioIndex = 0;
  const program = {};
  const cardioDays = DAYS.filter(day => CARDIO_ROLES.has(schedule[day]) || (schedule[day] === "active_recovery" && norm.cardioPreference !== "none")).length;
  const desired = CARDIO_PREFERENCES.find(p => p.id === norm.cardioPreference).sessions;
  let finishers = goalUsesRunning(norm.goal) || norm.goal === "cardio_only" ? 0 : Math.max(0, desired - cardioDays);
  for (const day of DAYS) {
    const role = schedule[day];
    if (role === "rest") { program[day] = restDay(); continue; }
    const ctx = { ...norm, deload, seed: DAYS.indexOf(day) + (adaptive ? 0 : weekIndex % 4 * 5) };
    roleCount[role] = (roleCount[role] || 0) + 1;
    let result;
    if (CARDIO_ROLES.has(role)) result = buildCardioDay(role, ctx, ++cardioIndex);
    else if (role === "active_recovery") result = buildActiveRecoveryDay(ctx);
    else {
      const minutes = finishers > 0 ? (norm.sessionLength <= 30 ? 8 : 12) : 0;
      if (minutes) finishers -= 1;
      result = buildLiftingDay(role, { ...ctx, sessionLength: norm.sessionLength - minutes }, roleCount[role]);
      if (minutes) result.cardio = steadyCardio("walk", minutes, "Easy walking finisher");
      if (!adaptive && weekIndex % 4 === 2 && result.lifting.length) {
        const proposed = result.lifting.map((lift, i) => i === 0 ? { ...lift, sets: lift.sets + 1 } : lift);
        if (sessionMinutes(proposed) + minutes <= norm.sessionLength) result.lifting = proposed;
      }
    }
    if (adaptive && result.lifting.length && role !== "active_recovery") {
      result.adaptivePlan = { version: 1, goal: norm.goal, experience: norm.experience, sessionLength: norm.sessionLength,
        estimatedMinutes: Math.ceil(sessionMinutes(result.lifting) + (result.cardio?.minutes || 0)) };
    }
    program[day] = result;
  }
  return { program, schedule, isDeload: deload };
}

export function buildProgramPlan(input) {
  const norm = normalizeProgramBuilderInput(input);
  const { program, schedule, isDeload } = generateWeek(norm, norm.weekIndex);
  const guideId = ["bodyweight", "calisthenics"].includes(norm.equipment) && norm.goal !== "cardio_only" ? "bodyweightStrength" : GUIDE_FOR_GOAL[norm.goal];
  return { input: norm, program, metadata: {
    generatedBy: "programBuilderV3", ...norm, weekVariant: norm.weekIndex + 1, isDeload, guideId,
  }, rationale: buildRationale(norm, program), warnings: buildWarnings(norm, schedule) };
}

export function buildWeekVariant(baseInput, weekIndex = 0) {
  const plan = buildProgramPlan({ ...baseInput, weekIndex });
  const focus = plan.input.adaptiveTraining ? "Repeat the movement and compare your logged sets at the prescribed effort." :
    ["Establish movements and baseline loads.", "Rotate available accessories.",
      "Add one anchor set where the session budget allows.", "Reduce working sets and keep aerobic sessions easy."][weekIndex % 4];
  return { weekIndex, weekLabel: `Week ${weekIndex + 1}`, isDeload: plan.metadata.isDeload, focus, program: plan.program, metadata: plan.metadata };
}

export function buildMultiWeekProgram(input, weeks = 4) {
  const count = Math.max(1, Math.min(8, Math.round(Number(weeks)) || 4));
  const out = [];
  for (let i = 0; i < count; i++) out.push(buildWeekVariant(input, i));
  return out;
}

// Rationale + warnings
function goalLabel(goal) {
  return PROGRAM_BUILDER_GOALS.find((g) => g.id === goal)?.label || goal;
}

function buildRationale(norm, program) {
  const lines = [];
  const lifts = DAYS.filter(day => program[day].lifting.length > 0);
  const cardio = DAYS.filter(day => program[day].cardio);
  lines.push(`${goalLabel(norm.goal)} across ${norm.trainingDaysPerWeek} days with a ${norm.sessionLength}-minute session budget.`);
  if (lifts.length) {
    const sets = lifts.flatMap(day => program[day].lifting).reduce((sum, lift) => sum + lift.sets, 0);
    lines.push(`${sets} weekly working sets across ${lifts.length} lifting days. Start at the low end of each range with the prescribed reps in reserve.`);
    if (norm.experience === "beginner") lines.push("Two working sets per movement provide a starting dose while you learn the exercises.");
  }
  if (norm.goal === "bodybuilding") lines.push("The four-day upper/lower reference week starts at ten direct sets each for chest, back and quads. Your equipment and session budget determine the starting dose.");
  if (norm.goal === "strength") lines.push("Practice the priority movements early. Take up to three minutes between heavy sets.");
  if (cardio.length) lines.push(`${cardio.reduce((sum, day) => sum + program[day].cardio.minutes, 0)} planned aerobic minutes across ${cardio.length} days.`);
  if (norm.equipment === "bodyweight" && lifts.length) lines.push("Floor raises train the upper back with limited resistance. Select calisthenics bars if you have a secure pulling station.");
  if (norm.longRunDay) lines.push(`Long run on ${norm.longRunDay}.`);
  if (norm.restDays.length) lines.push(`Rest on ${norm.restDays.join(", ")}.`);
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
  return warnings;
}

// Summary for UI
export function summarizeGeneratedPlan(plan) {
  const program = plan?.program || {};
  const days = DAYS.map((day) => {
    const d = program[day] || {};
    const lifting = Array.isArray(d.lifting) ? d.lifting : [];
    const cardio = d.cardio || null;
    const isRest = lifting.length === 0 && !cardio;
    const parts = [];
    if (lifting.length) parts.push(`${lifting.length} lift${lifting.length === 1 ? "" : "s"}`);
    if (cardio) parts.push(`${cardio.type}${cardio.minutes ? ` · ${cardio.minutes} min` : cardio.miles ? ` · ${cardio.miles} mi` : ""}`);
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

// Validation (used by callers before persisting)
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

// Settings patch (non-clobbering)
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
      equipmentChoices: norm.equipmentChoices,
      experience: norm.experience,
      sessionLength: norm.sessionLength,
      cardioPreference: norm.cardioPreference,
      adaptiveTraining: norm.adaptiveTraining,
      cardioModality: norm.cardioModality,
      includeIntervals: norm.includeIntervals,
      varietyMode: "balanced",
      lastGeneratedAt: plan?.metadata?.generatedAt || norm.generatedAt || null,
    },
  };
}
