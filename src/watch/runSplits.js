// src/watch/runSplits.js
// A run cut into mile splits from what Apple Health recorded during it
// (ios/App/App/RunsPlugin.swift runDetail): distance so far over time,
// heart rate over time, and the stretches it was paused. Each split's time
// leaves out the pauses, as the Workout app's does, and the last part mile
// is a split of its own when it's long enough to say something.

import { METERS_PER_MILE } from "../runPaces";

// Shorter than this, a last part mile is left out.
const MIN_PART_MILE = 0.1;

const finitePairs = (list) => (Array.isArray(list) ? list : [])
  .filter((pair) => Array.isArray(pair) && Number.isFinite(Number(pair[0])) && Number.isFinite(Number(pair[1])))
  .map(([at, value]) => [Number(at), Number(value)])
  .sort((a, b) => a[0] - b[0]);

/**
 * detail: { distance: [[seconds, meters so far]], heartRate: [[seconds,
 * bpm]], pauses: [[from, to]] }. Returns [{ n, miles, seconds, hr }]: n
 * counts from 1, miles is 1 except for a last part mile, seconds is moving
 * time, hr the average heart rate (null without readings).
 */
export function runSplits(detail, metersPerSplit = METERS_PER_MILE) {
  const distance = finitePairs(detail?.distance);
  if (distance.length < 2) return [];
  const heartRate = finitePairs(detail?.heartRate);
  const pauses = finitePairs(detail?.pauses).filter(([from, to]) => to > from);

  // Seconds moving from the start until `at`.
  const moving = (at) => at - pauses.reduce((paused, [from, to]) => paused + Math.max(0, Math.min(at, to) - from), 0);
  // When the run passed `meters`, between the two readings either side.
  const passed = (meters) => {
    let before = [0, 0];
    for (const point of distance) {
      if (point[1] >= meters) {
        const [t0, d0] = before;
        const [t1, d1] = point;
        return d1 === d0 ? t1 : t0 + ((meters - d0) / (d1 - d0)) * (t1 - t0);
      }
      before = point;
    }
    return null;
  };
  const averageHr = (from, to) => {
    const readings = heartRate.filter(([at]) => at >= from && at < to).map(([, bpm]) => bpm);
    return readings.length ? Math.round(readings.reduce((sum, bpm) => sum + bpm, 0) / readings.length) : null;
  };

  const total = distance[distance.length - 1][1];
  const end = distance[distance.length - 1][0];
  const splits = [];
  let from = 0;
  for (let n = 1; n * metersPerSplit <= total; n += 1) {
    const at = passed(n * metersPerSplit);
    if (at == null) break;
    splits.push({ n, miles: 1, seconds: Math.round(moving(at) - moving(from)), hr: averageHr(from, at) });
    from = at;
  }
  const rest = (total - splits.length * metersPerSplit) / metersPerSplit;
  if (rest >= MIN_PART_MILE && end > from) {
    splits.push({ n: splits.length + 1, miles: Math.round(rest * 100) / 100, seconds: Math.round(moving(end) - moving(from)), hr: averageHr(from, end + 1) });
  }
  return splits.filter((split) => split.seconds > 0);
}

/** Seconds per mile of a split, for its pace. */
export function splitPace(split) {
  return split?.miles > 0 ? split.seconds / split.miles : 0;
}
