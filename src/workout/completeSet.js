// src/workout/completeSet.js
// Logging one set, the same way wherever it is logged: the session runner
// and the Apple Watch both come through here. The set is marked done, the
// progression decision taken at the exercise's first logged set is kept, and
// once every set is in, next time's prescription is worked out.

import { buildExercisePrescription, buildProgressionDecision } from "../progressionEngine";
import { validateSet } from "../workoutLogging";

export function completeSet({
  exData = {},
  sets = [],
  setIndex,
  set,
  exercise,
  progressionExercise = exercise,
  prescription = null,
  data = {},
  todayKey,
  performedName = exercise?.name,
  completedAt = new Date().toISOString(),
}) {
  const completed = { ...set, done: true, completedAt };
  const nextSets = sets.map((item, index) => index === setIndex ? completed : item);
  const progressionDecision = exData.progressionDecision || buildProgressionDecision(prescription, completed, { acceptedAt: completedAt });
  const exerciseComplete = nextSets.every((item) => item.done && validateSet(item, exercise).valid);
  const generatedNext = exerciseComplete
    ? buildExercisePrescription({ data, exercise: progressionExercise, todayKey, currentSession: { date: todayKey, sets: nextSets, performedName } })
    : undefined;
  return {
    completed,
    nextSets,
    exerciseComplete,
    exData: {
      ...exData,
      sets: nextSets,
      skipped: undefined,
      progressionDecision,
      ...(generatedNext ? { nextPrescription: generatedNext } : {}),
    },
  };
}

export default completeSet;
