// One real reading per ~5 seconds, plus the last actual reading in each
// uninterrupted stretch. Millisecond offsets keep per-workout records small.
import { performedExerciseName } from "../workoutLogging";

const STEP_MS = 5_000;
export const PULSE_GAP_MS = 12_000;
const MINUTE_MS = 60_000;

export function extendPulse(summary, sample, startedAt, newSegment) {
  const old = summary?.trace;
  const trace = old || { startedAt, segments: [], sets: [] };
  const segments = [...trace.segments];
  const offset = sample.timestamp - trace.startedAt;
  const previous = segments.at(-1);
  if (!previous?.length || newSegment || sample.timestamp - summary.lastSampleAt >= PULSE_GAP_MS) {
    segments.push([[offset, sample.bpm]]);
  } else {
    const points = [...previous];
    // Preserve the first point. Replace the provisional tail until it is at
    // least one step from the preceding point, then begin the next interval.
    if (points.length > 1 && points.at(-1)[0] - points.at(-2)[0] < STEP_MS) points.pop();
    points.push([offset, sample.bpm]);
    segments[segments.length - 1] = points;
  }
  const second = Math.floor(offset / 1000);
  const previousSecond = old?.segments?.length ? Math.floor((summary.lastSampleAt - trace.startedAt) / 1000) : -1;
  const observedSeconds = (trace.observedSeconds || 0) + (second !== previousSecond ? 1 : 0);
  return {
    count: (summary?.count || 0) + 1,
    bpmTotal: (summary?.bpmTotal || 0) + sample.bpm,
    peakBpm: Math.max(summary?.peakBpm || 0, sample.bpm),
    lastSampleAt: sample.timestamp,
    trace: { ...trace, endedAt: sample.timestamp, observedSeconds, segments },
  };
}

export function pulseCoverage(trace) {
  const elapsed = trace.endedAt - trace.startedAt;
  if (!(elapsed > 0)) return null;
  return Math.min(100, Math.round(100 * trace.observedSeconds / (Math.floor(elapsed / 1000) + 1)));
}

// Only describe a one-minute change when the runner stayed in rest for the
// full minute and one uninterrupted stretch contains both observed endpoints.
function changeDuringRest(segments, at, duration) {
  if (duration < MINUTE_MS) return null;
  const end = at + MINUTE_MS;
  const segment = segments.find(points => points[0]?.[0] <= at + STEP_MS && points.at(-1)?.[0] >= end - STEP_MS);
  if (!segment) return null;
  const nearest = target => {
    let best = null;
    for (const point of segment) {
      if (point[0] > Math.min(target + STEP_MS, at + duration)) break;
      if (Math.abs(point[0] - target) <= STEP_MS && (!best || Math.abs(point[0] - target) < Math.abs(best[0] - target))) best = point;
    }
    return best;
  };
  const first = nearest(at);
  const last = nearest(end);
  return first && last ? first[1] - last[1] : null;
}

export function pulseSets(summary, exercises) {
  const trace = summary?.trace;
  if (!trace?.segments?.length) return [];
  return (trace.sets || []).flatMap(marker => {
    const exercise = exercises?.[marker.name];
    const set = exercise?.sets?.[marker.index];
    // Reopening, replacing or deleting a set invalidates its old marker.
    if (!set?.done || Date.parse(set.completedAt) !== trace.startedAt + marker.offset) return [];
    return [{
      ...marker, set, name: performedExerciseName(marker.name, exercise),
      change: changeDuringRest(trace.segments, marker.offset, marker.restMs || 0),
    }];
  });
}

function comparable(a, b) {
  if (a.name !== b.name || a.index !== b.index || a.mode !== b.mode) return false;
  for (const key of ["reps", "duration", "distance"]) {
    if (Number(a.set[key] || 0) !== Number(b.set[key] || 0)) return false;
  }
  const load = marker => Number(marker.mode === "assisted_reps"
    ? marker.set.assistance ?? marker.set.weight ?? 0 : marker.set.weight || 0);
  const weight = load(a);
  return Math.abs(weight - load(b)) <= weight * 0.05;
}

export function previousPulseSet(data, dateKey, startedAt, selected) {
  if (!selected || selected.change == null) return null;
  for (const date of Object.keys(data || {}).filter(date => date <= dateKey).sort().reverse()) {
    const workout = data[date]?.workout;
    const sessions = Object.values(workout?.whoopHeartRate || {})
      .filter(item => item?.trace?.endedAt <= startedAt)
      .sort((a, b) => b.trace.endedAt - a.trace.endedAt);
    for (const session of sessions) {
      const match = pulseSets(session, workout.exercises).find(set => set.change != null && comparable(selected, set));
      if (match) return { date, ...match };
    }
  }
  return null;
}
