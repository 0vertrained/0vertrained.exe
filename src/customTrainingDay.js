import { adaptCustomProgramDay } from "./customPlanAdaptation";
import { applyRaceBuild } from "./raceBuild";
import { shiftDate } from "./coachWindows";
import { weekdayOf, weekStartOf, WEEK_DAYS } from "./weekMoves";
import { buildExercisePrescription } from "./progressionEngine";

function savedDay(entry, dateKey) {
  const snapshot = entry?.workout?.customPlanSnapshot;
  if (!snapshot || snapshot.dateKey !== dateKey || snapshot.day?.adaptation?.dateKey !== dateKey) return null;
  return snapshot.day;
}

// Resolve after race and weekday moves. Future days show the template until
// their own recovery is known. Logged sessions keep the targets actually used.
export function resolveCustomTrainingDay({ day, data, dateKey, currentDateKey, wearableScore, readiness }) {
  const saved = savedDay(data?.[dateKey], dateKey);
  if (saved) return saved;
  if (day?.adaptivePlan?.version !== 1 || dateKey !== currentDateKey) return day;
  return adaptCustomProgramDay({ day, data, dateKey, wearableScore, readiness,
    safetyFlag: Boolean(data?.[dateKey]?.intelligence?.physiqueOS?.safetyFlag) });
}

export function liveTrainingWeek({ program, data, dateKey, currentDateKey, wearableScore, readiness }) {
  const base = applyRaceBuild(program, dateKey);
  if (!base) return base;
  const monday = weekStartOf(dateKey);
  let result = base;
  WEEK_DAYS.forEach((dayName, index) => {
    const key = shiftDate(monday, index);
    const day = resolveCustomTrainingDay({ day: base[dayName], data, dateKey: key, currentDateKey, wearableScore, readiness });
    if (day === base[dayName]) return;
    if (result === base) result = { ...base };
    result[dayName] = day;
  });
  return result;
}

// Save the targets with the first lift edit or session start, in the same
// daily entry write as the athlete's action. Merely previewing a day is free.
export function snapshotOnTrainingWrite({ entry, program, data, dateKey, currentDateKey, wearableScore, readiness, path }) {
  if (savedDay(entry, dateKey) || dateKey !== currentDateKey ||
      !(path.startsWith("workout.exercises.") || path.startsWith("workout.sessionState."))) return entry;
  const day = applyRaceBuild(program, dateKey)?.[weekdayOf(dateKey)];
  if (day?.adaptivePlan?.version !== 1) return entry;
  const resolved = resolveCustomTrainingDay({ day, data, dateKey, currentDateKey, wearableScore, readiness });
  if (!resolved?.adaptation) return entry;
  return { ...entry, workout: { ...entry.workout, customPlanSnapshot: { dateKey, day: resolved } } };
}

// The target in a snapshot belongs to its performed movement. A substitution
// gets a fresh, editable baseline instead of inheriting another lift's pounds.
export function sessionPrescription({ data, exercise, performedName = exercise.name, dateKey }) {
  const target = exercise.adaptivePrescription;
  if (!target) return buildExercisePrescription({ data, exercise: { ...exercise, name: performedName }, todayKey: dateKey });
  if (target.exerciseName === performedName) return target;
  return { ...target, exerciseName: performedName, kind: "establish", sourceDate: null, targetWeights: undefined,
    targetWeight: null, targetReps: Array(exercise.sets).fill(target.repRange.min),
    rationale: "Choose a starting load for this variation at the prescribed effort." };
}
