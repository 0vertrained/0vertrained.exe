// src/oura/statistics.js
// ─────────────────────────────────────────────────────────────────────────────
// Oura Statistics & Math Utilities
//
// Basic statistical calculations used by algorithms: mean, std dev, z-score, etc.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate mean
 */
export function mean(values) {
  if (!values || values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Calculate sample standard deviation (Bessel's correction, N-1).
 * More appropriate than the population form for the small rolling baselines
 * (e.g. 7–14 day HRV windows) these z-scores are computed against.
 */
export function stdDev(values) {
  if (!values || values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((sum, v) => sum + Math.pow(v - m, 2), 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Median of a numeric array. Returns 0 for empty input.
 * More robust than the mean against a single anomalous night (e.g. one
 * poor-sleep RHR spike) when establishing a personal baseline.
 */
export function median(values) {
  if (!values || values.length === 0) return 0;
  const sorted = values.slice().filter(v => Number.isFinite(Number(v))).map(Number).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Trimmed mean — drops the lowest and highest `trim` fraction of values, then
 * averages the rest. Falls back to the plain mean when there are too few
 * samples to trim meaningfully. Used for RHR baselines so an outlier night does
 * not distort the reference point while keeping the estimate smooth.
 */
export function trimmedMean(values, trim = 0.1) {
  const nums = (values || []).filter(v => Number.isFinite(Number(v))).map(Number).sort((a, b) => a - b);
  if (nums.length === 0) return 0;
  if (nums.length < 5) return mean(nums);
  const k = Math.floor(nums.length * trim);
  const kept = k > 0 ? nums.slice(k, nums.length - k) : nums;
  return mean(kept.length ? kept : nums);
}

/**
 * Trimmed sample standard deviation — the spread companion to trimmedMean:
 * drops the same extreme fraction before computing the sample SD.
 *
 * V16.7 · Why this exists: a single crash night in the baseline pool inflates
 * the plain SD and MASKS the next real dip. On the reporting user's export,
 * the 2026-07-05 HRV crash (37 ms in a ~72 ms pool) widened the ln-SD from
 * ~0.15 to ~0.23 — nine days later a genuine −16% HRV morning (both wearables
 * graded it low) read as only z −0.45. The V16.5.1 physiological floors remain
 * the guardrail on the other side: trimming can only tighten SD down to the
 * floor, never below it. Falls back to the plain sample SD below 5 samples,
 * mirroring trimmedMean.
 */
export function trimmedStdDev(values, trim = 0.1) {
  const nums = (values || []).filter(v => Number.isFinite(Number(v))).map(Number).sort((a, b) => a - b);
  if (nums.length < 2) return 0;
  if (nums.length < 5) return stdDev(nums);
  const k = Math.floor(nums.length * trim);
  const kept = k > 0 ? nums.slice(k, nums.length - k) : nums;
  return stdDev(kept.length >= 2 ? kept : nums);
}

/**
 * Natural log of RMSSD from raw values (in ms)
 */
export function lnRMSSD(rmssdValue) {
  if (!rmssdValue || rmssdValue <= 0) return 0;
  return Math.log(rmssdValue);
}

/**
 * Z-score calculation
 */
export function zScore(value, baseline, sd) {
  if (sd === 0) return 0;
  return (value - baseline) / sd;
}

/**
 * Coefficient of Variation (%)
 */
export function cv(values) {
  if (!values || values.length === 0) return 0;
  const m = mean(values);
  if (m === 0) return 0;
  return (stdDev(values) / m) * 100;
}

/**
 * Linear regression slope (days)
 * Returns the slope in units/day
 */
export function linearRegression(points) {
  if (!points || points.length < 2) return 0;
  
  const n = points.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;

  for (let i = 0; i < n; i++) {
    const x = i;
    const y = points[i];
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
  }

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  return slope;
}

/**
 * Rolling window helper
 */
export function rollingWindow(data, windowSize) {
  const windows = [];
  for (let i = 0; i <= data.length - windowSize; i++) {
    windows.push(data.slice(i, i + windowSize));
  }
  return windows;
}
