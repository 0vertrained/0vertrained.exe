// src/weightTrend.js
// Bodyweight trend smoothing. Daily scale readings are noise (water,
// glycogen, sodium, gut content swing ±2-4 lb); the signal is the trend. This
// applies the classic exponentially-smoothed moving average (Hacker's Diet
// convention, alpha = 0.1 per logged day): trend += alpha × (weight − trend).
// Pure display math over body.weight entries — nothing here feeds the engine.

export const SMOOTHING_ALPHA = 0.1;
const MIN_POINTS = 5;

export function buildWeightTrend(data, { windowDays = 90, alpha = SMOOTHING_ALPHA } = {}) {
  if (!data) return null;
  const points = Object.keys(data)
    .sort()
    .map(date => ({ date, weight: parseFloat(data[date]?.body?.weight) }))
    .filter(p => Number.isFinite(p.weight) && p.weight > 0)
    .slice(-windowDays);

  if (points.length < MIN_POINTS) {
    return { ready: false, count: points.length, needed: MIN_POINTS, points: [] };
  }

  let trend = points[0].weight;
  const out = points.map((p, i) => {
    if (i > 0) trend = trend + alpha * (p.weight - trend);
    return { ...p, trend: Math.round(trend * 10) / 10 };
  });

  // Weekly rate from the trend line itself over (up to) the last 14 logged
  // days, scaled by actual calendar days between those two points — logged
  // days aren't always consecutive, and pretending they are inflates rates.
  const last = out[out.length - 1];
  const refIdx = Math.max(0, out.length - 14);
  const ref = out[refIdx];
  const calendarDays = Math.max(
    1,
    Math.round((new Date(last.date + "T12:00:00") - new Date(ref.date + "T12:00:00")) / 86400000)
  );
  const weeklyRate = Math.round(((last.trend - ref.trend) / calendarDays) * 7 * 10) / 10;

  return {
    ready: true,
    points: out,
    current: {
      weight: last.weight,
      trend: last.trend,
      weeklyRate,
      direction: weeklyRate > 0.15 ? "gaining" : weeklyRate < -0.15 ? "losing" : "holding",
    },
    count: out.length,
  };
}
