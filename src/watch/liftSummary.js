// src/watch/liftSummary.js
// What the Apple Watch measured while you lifted: how long, your average
// heart rate and the calories it counted. The watch sends these when its
// workout ends (ios/App/WatchApp/SessionStore.swift); the phone keeps one
// record per workout on the day (workout.watchWorkouts), and these read it.

const positive = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};

// Workouts kept per day. Two-a-days end two workouts; more is a mistake.
export const WATCH_WORKOUTS_PER_DAY = 4;

/**
 * The record kept for a watch workout's finish event, or null when the event
 * says nothing about the workout (an older watch build sends no duration).
 */
export function watchWorkoutRecord(event) {
  const seconds = Math.round(positive(event?.durationSeconds));
  if (!seconds || typeof event?.id !== "string" || !event.id) return null;
  const avgHr = Math.round(positive(event.averageHeartRate));
  const kcal = Math.round(positive(event.activeEnergy));
  return {
    id: event.id,
    startedAt: typeof event.startedAt === "string" ? event.startedAt : null,
    endedAt: typeof event.at === "string" ? event.at : null,
    seconds,
    avgHr: avgHr || null,
    kcal: kcal || null,
  };
}

/**
 * The day's watch workouts added up: { seconds, avgHr, kcal, count }, with
 * heart rate averaged by how long each workout lasted. Null without any.
 */
export function watchLiftSummary(day) {
  const workouts = (Array.isArray(day?.workout?.watchWorkouts) ? day.workout.watchWorkouts : [])
    .filter((workout) => positive(workout?.seconds));
  if (!workouts.length) return null;
  let seconds = 0;
  let beats = 0;
  let timedSeconds = 0;
  let kcal = 0;
  for (const workout of workouts) {
    const length = positive(workout.seconds);
    seconds += length;
    if (positive(workout.avgHr)) {
      beats += positive(workout.avgHr) * length;
      timedSeconds += length;
    }
    kcal += positive(workout.kcal);
  }
  return {
    seconds: Math.round(seconds),
    avgHr: timedSeconds ? Math.round(beats / timedSeconds) : null,
    kcal: kcal ? Math.round(kcal) : null,
    count: workouts.length,
  };
}

function duration(seconds) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes}\u00a0min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}\u00a0h ${rest}\u00a0min` : `${hours}\u00a0h`;
}

/** "52 min · 128 bpm average · 410 kcal", or "" without a summary. */
export function watchLiftLine(summary) {
  if (!summary) return "";
  return [
    duration(summary.seconds),
    summary.avgHr ? `${summary.avgHr}\u00a0bpm average` : "",
    summary.kcal ? `${summary.kcal.toLocaleString("en-US")}\u00a0kcal` : "",
  ].filter(Boolean).join(" · ");
}
