// src/workoutLogging.js
// Set Flow — shared workout logging rules.
// Today quick edit and Session Mode use the same initialization, validation,
// completion, and resume semantics so the two surfaces cannot drift.

const num = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const strictNum = (value) => {
  if (value == null || String(value).trim() === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const TRACKING_MODES = Object.freeze({
  LOADED_REPS: "loaded_reps",
  BODYWEIGHT_REPS: "bodyweight_reps",
  ASSISTED_REPS: "assisted_reps",
  TIMED_HOLD: "timed_hold",
  CARRY: "carry",
});

const BODYWEIGHT_PATTERN = /(push[- ]?up|pull[- ]?up|chin[- ]?up|dip|hanging leg raise|glute[- ]?ham raise)/i;
const TIMED_PATTERN = /(plank|hold|wall sit|dead hang)/i;
const CARRY_PATTERN = /(carry|farmer walk|suitcase walk)/i;
const ASSISTED_PATTERN = /assisted/i;

export function resolveTrackingMode(exercise = {}) {
  if (exercise.trackingMode) return exercise.trackingMode;
  const name = String(exercise.name || "");
  if (TIMED_PATTERN.test(name)) return TRACKING_MODES.TIMED_HOLD;
  if (CARRY_PATTERN.test(name)) return TRACKING_MODES.CARRY;
  if (ASSISTED_PATTERN.test(name)) return TRACKING_MODES.ASSISTED_REPS;
  if (BODYWEIGHT_PATTERN.test(name)) return TRACKING_MODES.BODYWEIGHT_REPS;
  return TRACKING_MODES.LOADED_REPS;
}

export function defaultSetForExercise(exercise = {}) {
  const mode = resolveTrackingMode(exercise);
  // A prescription is guidance, not performed work. Keep logging fields blank
  // so a target such as "6–8" can never validate as six completed reps.
  if (mode === TRACKING_MODES.TIMED_HOLD) {
    return { weight: "", reps: "", duration: "", rir: "", done: false };
  }
  if (mode === TRACKING_MODES.CARRY) {
    return { weight: "", reps: "", distance: "", duration: "", rir: "", done: false };
  }
  if (mode === TRACKING_MODES.ASSISTED_REPS) {
    return { weight: "", assistance: "", reps: "", rir: "", done: false };
  }
  return { weight: "", reps: "", rir: "", done: false };
}

export function reconcileExerciseSets(exercise = {}, existingSets = []) {
  const targetCount = Math.max(0, Number.parseInt(exercise.sets, 10) || 0);
  return Array.from({ length: targetCount }, (_, index) => ({
    ...defaultSetForExercise(exercise),
    ...(existingSets[index] || {}),
  }));
}

export function validateSet(set = {}, exercise = {}) {
  const mode = resolveTrackingMode(exercise);
  const reps = strictNum(set.reps);
  const weight = strictNum(set.weight);
  const assistance = strictNum(set.assistance ?? set.weight);
  const duration = strictNum(set.duration);
  const distance = strictNum(set.distance);

  if (mode === TRACKING_MODES.TIMED_HOLD) {
    return duration > 0
      ? { valid: true, message: "" }
      : { valid: false, message: "Enter the hold duration before banking this set." };
  }
  if (mode === TRACKING_MODES.CARRY) {
    if (weight <= 0) return { valid: false, message: "Enter the carried load before banking this set." };
    return distance > 0 || duration > 0
      ? { valid: true, message: "" }
      : { valid: false, message: "Enter the carry distance or duration." };
  }
  if (mode === TRACKING_MODES.ASSISTED_REPS) {
    if (reps <= 0) return { valid: false, message: "Enter completed reps before banking this set." };
    return assistance >= 0
      ? { valid: true, message: "" }
      : { valid: false, message: "Assistance cannot be negative." };
  }
  if (mode === TRACKING_MODES.BODYWEIGHT_REPS) {
    return reps > 0
      ? { valid: true, message: "" }
      : { valid: false, message: "Enter completed reps before banking this set." };
  }
  if (weight <= 0) return { valid: false, message: "Enter the working weight before banking this set." };
  if (reps <= 0) return { valid: false, message: "Enter completed reps before banking this set." };
  return { valid: true, message: "" };
}

export function isCompletedSet(set = {}, exercise = {}) {
  return set.done === true && validateSet(set, exercise).valid;
}

export function completedSetCount(exercise = {}, exerciseData = {}) {
  const sets = reconcileExerciseSets(exercise, exerciseData.sets || []);
  return sets.filter((set) => isCompletedSet(set, exercise)).length;
}

export function isExerciseHandled(exercise = {}, exerciseData = {}) {
  if (exerciseData?.skipped) return true;
  const sets = reconcileExerciseSets(exercise, exerciseData?.sets || []);
  return sets.length > 0 && sets.every((set) => isCompletedSet(set, exercise));
}

export function isSessionHandled(lifting = [], workoutData = {}) {
  return lifting.length > 0 && lifting.every((exercise) =>
    isExerciseHandled(exercise, workoutData?.exercises?.[exercise.name] || {})
  );
}

export function firstIncompleteSetIndex(sets = [], exercise = {}) {
  const index = sets.findIndex((set) => !isCompletedSet(set, exercise));
  return index === -1 ? Math.max(0, sets.length - 1) : index;
}

export function firstIncompleteExerciseIndex(lifting = [], workoutData = {}) {
  const index = lifting.findIndex((exercise) =>
    !isExerciseHandled(exercise, workoutData?.exercises?.[exercise.name] || {})
  );
  return index === -1 ? Math.max(0, lifting.length - 1) : index;
}

export function nextIncompleteExerciseIndex(lifting = [], workoutData = {}, currentIndex = -1) {
  for (let index = currentIndex + 1; index < lifting.length; index += 1) {
    const exercise = lifting[index];
    if (!isExerciseHandled(exercise, workoutData?.exercises?.[exercise.name] || {})) return index;
  }
  return -1;
}

export function displaySet(set = {}, exercise = {}) {
  const mode = resolveTrackingMode(exercise);
  const rir = String(set.rir ?? "").trim() !== "" ? ` @${set.rir}` : "";
  if (mode === TRACKING_MODES.TIMED_HOLD) {
    return `${num(set.duration) || "—"} sec${num(set.weight) ? ` · ${num(set.weight)} lb` : ""}${rir}`;
  }
  if (mode === TRACKING_MODES.CARRY) {
    const measure = num(set.distance) ? `${num(set.distance)} yd` : `${num(set.duration) || "—"} sec`;
    return `${num(set.weight) || "—"} lb · ${measure}${rir}`;
  }
  if (mode === TRACKING_MODES.ASSISTED_REPS) {
    return `${num(set.assistance ?? set.weight) || 0} lb assist · ${num(set.reps) || "—"} reps${rir}`;
  }
  if (mode === TRACKING_MODES.BODYWEIGHT_REPS) {
    return `${num(set.reps) || "—"} reps${num(set.weight) ? ` · +${num(set.weight)} lb` : ""}${rir}`;
  }
  return `${num(set.weight) || "—"} × ${num(set.reps) || "—"}${rir}`;
}

export function defaultWeightIncrement(exercise = {}) {
  if (Number.isFinite(Number(exercise.weightIncrement))) return Number(exercise.weightIncrement);
  const name = String(exercise.name || "");
  if (/(lateral raise|curl|pressdown|extension|fly|pec deck|cable)/i.test(name)) return 5;
  if (/(leg press|hack squat|hip thrust|deadlift|calf)/i.test(name)) return 10;
  return 5;
}

export default {
  TRACKING_MODES,
  resolveTrackingMode,
  defaultSetForExercise,
  reconcileExerciseSets,
  validateSet,
  isCompletedSet,
  completedSetCount,
  isExerciseHandled,
  isSessionHandled,
  firstIncompleteSetIndex,
  firstIncompleteExerciseIndex,
  nextIncompleteExerciseIndex,
  displaySet,
  defaultWeightIncrement,
};
