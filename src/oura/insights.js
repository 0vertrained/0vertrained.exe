// src/oura/insights.js
// Oura Recovery Insights & Recommendations
//
// Data quality assessment, metric baselines, confidence scoring, and
// human-friendly training recommendations.

import {
  getSleepDoc, getReadinessDoc,
  recoveryDates, latestRecoveryDay,
  hrvRmssd, hrvRmssdWithSource, rhrValue, tempDeviation, firstDoc
} from "./normalization";
import { mean } from "./statistics";

function finiteNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Calculate Oura data quality score (0-100)
 */
export function calcOuraDataQuality(ouraData = {}, days = 14) {
  const dates = Object.keys(ouraData || {}).sort().reverse().slice(0, days);
  let sleepRecords = 0;
  let readinessRecords = 0;
  let heartrateSamples = 0;
  let spo2Records = 0;
  let tempRecords = 0;
  let hrvRawRecords = 0;
  let rhrRawRecords = 0;
  let fallbackSignals = 0;

  for (const date of dates) {
    const day = ouraData[date] || {};
    const sleep = getSleepDoc(day);
    const readiness = getReadinessDoc(day);
    if (sleep) sleepRecords++;
    if (readiness) readinessRecords++;
    if (finiteNum(hrvRmssd(sleep)) !== null) hrvRawRecords++;
    if (finiteNum(rhrValue(sleep)) !== null) rhrRawRecords++;
    if (finiteNum(tempDeviation(sleep, readiness)) !== null) tempRecords++;
    const contributors = readiness?.contributors || {};
    if ([contributors.hrv_balance, contributors.resting_heart_rate, contributors.previous_night, contributors.sleep_balance, contributors.body_temperature].some(v => finiteNum(v) !== null)) fallbackSignals++;
    // Always 0 now: loadOuraData no longer fetches raw heartrate
    // payloads (their only consumer was this display count; the quality score
    // below never used it). Field kept for return-shape stability.
    heartrateSamples += Array.isArray(day?.heartrate?.data) ? day.heartrate.data.length : 0;
    if (firstDoc(day?.daily_spo2) || firstDoc(day?.spo2)) spo2Records++;
  }

  const latestDate = dates[0] || null;
  // Newest synced calendar date can be heartrate-only; the latest *usable*
  // recovery day (has sleep/readiness) is what scoring actually anchors to.
  const latestRecoveryDate = recoveryDates(ouraData)[0] || null;
  const recoveryDayIsStale = Boolean(latestDate && latestRecoveryDate && latestDate !== latestRecoveryDate);
  const fallbackMode = (sleepRecords === 0 || hrvRawRecords === 0 || rhrRawRecords === 0) && fallbackSignals > 0;
  const usableSignals = [sleepRecords, readinessRecords, hrvRawRecords || fallbackSignals, rhrRawRecords || fallbackSignals, tempRecords || fallbackSignals].filter(Boolean).length;
  const score = Math.round(Math.min(100, (usableSignals / 5) * 70 + Math.min(30, (dates.length / days) * 30)));
  const confidence = score >= 80 ? "high" : score >= 50 ? "medium" : "low";

  return {
    daysRequested: days,
    daysLoaded: dates.length,
    latestDate,
    latestSyncDate: latestDate,
    latestRecoveryDate,
    recoveryDayIsStale,
    sleepRecords,
    readinessRecords,
    heartrateSamples,
    spo2Records,
    tempRecords,
    hrvRawRecords,
    rhrRawRecords,
    fallbackSignals,
    fallbackMode,
    score,
    confidence,
    summary: fallbackMode ? "fallback contributors active" : confidence === "high" ? "complete biometric window" : "partial biometric window",
  };
}

/**
 * Calculate metric baselines from 14-day history
 */
export function calcMetricBaselines(ouraData = {}) {
  // Only days with recovery signal; skips heartrate-only sync dates.
  const dates = recoveryDates(ouraData).slice(0, 14);
  const hrvValues = [];
  const rhrValues = [];
  const sleepScores = [];
  const tempValues = [];

  for (const date of dates) {
    const day = ouraData[date];
    const sleep = getSleepDoc(day);
    const readiness = getReadinessDoc(day);
    const hrv = finiteNum(hrvRmssd(sleep));
    const rhr = finiteNum(rhrValue(sleep));
    const sleepScore = finiteNum(sleep?.score ?? readiness?.contributors?.previous_night ?? readiness?.score);
    const temp = finiteNum(tempDeviation(sleep, readiness));
    if (hrv !== null) hrvValues.push(hrv);
    if (rhr !== null) rhrValues.push(rhr);
    if (sleepScore !== null) sleepScores.push(sleepScore);
    if (temp !== null) tempValues.push(temp);
  }

  const latest = dates[0] ? ouraData[dates[0]] : null;
  const latestSleep = getSleepDoc(latest);
  const latestReadiness = getReadinessDoc(latest);
  const latestVals = {
    hrv: finiteNum(hrvRmssd(latestSleep)),
    rhr: finiteNum(rhrValue(latestSleep)),
    sleep: finiteNum(latestSleep?.score ?? latestReadiness?.contributors?.previous_night ?? latestReadiness?.score),
    temp: finiteNum(tempDeviation(latestSleep, latestReadiness)),
  };

  const fmtDelta = (value, baseline, unit, invert = false) => {
    if (value === null || !baseline) return "baseline unavailable";
    const delta = value - baseline;
    const direction = Math.abs(delta) < 0.1 ? "at baseline" : delta > 0 ? (invert ? "above baseline" : "above baseline") : (invert ? "below baseline" : "below baseline");
    const sign = delta > 0 ? "+" : "";
    return `${baseline.toFixed(unit === "°C" ? 2 : 0)}${unit} avg · ${sign}${delta.toFixed(unit === "°C" ? 2 : 1)}${unit} ${direction}`;
  };

  const hrvAvg = hrvValues.length ? mean(hrvValues) : 0;
  const rhrAvg = rhrValues.length ? mean(rhrValues) : 0;
  const sleepAvg = sleepScores.length ? mean(sleepScores) : 0;
  const tempAvg = tempValues.length ? mean(tempValues) : 0;

  return {
    hrv: { value: latestVals.hrv, baseline: hrvAvg, label: fmtDelta(latestVals.hrv, hrvAvg, " ms") },
    rhr: { value: latestVals.rhr, baseline: rhrAvg, label: fmtDelta(latestVals.rhr, rhrAvg, " bpm", true) },
    sleep: { value: latestVals.sleep, baseline: sleepAvg, label: fmtDelta(latestVals.sleep, sleepAvg, "/100") },
    temp: { value: latestVals.temp, baseline: tempAvg, label: fmtDelta(latestVals.temp, tempAvg, "°C") },
    counts: { hrv: hrvValues.length, rhr: rhrValues.length, sleep: sleepScores.length, temp: tempValues.length },
  };
}

/**
 * Calculate confidence in recovery metrics
 */
export function calcRecoveryConfidence(quality, recovery) {
  const base = quality?.score || 0;
  const hasAllSubscores = recovery?.detail && ["hrv", "rhr", "sleep", "temp"].every(k => Number.isFinite(Number(recovery.detail[k]?.score ?? recovery.detail[k]?.nightly)));

  // Penalize thin baselines: a z-score built from 2 nights is far less reliable
  // than one from 14, even if every subscore is present.
  const hrvSamples = Number(recovery?.detail?.hrv?.sampleCount ?? 0);
  const rhrSamples = Number(recovery?.detail?.rhr?.sampleCount ?? 0);
  const minSamples = Math.min(hrvSamples, rhrSamples);
  let samplePenalty = 0;
  if (minSamples < 3) samplePenalty = -15;
  else if (minSamples < 7) samplePenalty = -5;

  const adjusted = Math.max(0, Math.min(100, base + (hasAllSubscores ? 5 : -10) + samplePenalty));
  const level = adjusted >= 80 ? "high" : adjusted >= 50 ? "medium" : "low";
  const reason = quality?.fallbackMode
    ? "some values use Oura readiness-contributor fallback"
    : minSamples < 7
      ? `short baseline (${minSamples} night${minSamples === 1 ? "" : "s"} of raw HRV/RHR)`
      : quality?.recoveryDayIsStale
        ? "newest sync is heartrate-only; scoring an earlier full recovery day"
        : level === "high"
          ? "raw Oura signals available across the window"
          : "partial Oura window or missing raw signals";
  return { score: Math.round(adjusted), level, reason, minSamples };
}

/**
 * Get training recommendation based on recovery state
 */
export function getTrainingRecommendation({ recovery, readiness, quality, loadZone, sleepDebt }) {
  const score = Number(recovery?.score || 0);
  const lowConfidence = quality?.confidence === "low";
  let label;
  let prescription;
  if (score >= 85 && !lowConfidence) {
    label = "Push";
    prescription = "High-intensity work is reasonable. PR attempts are allowed if warm-ups move well.";
  } else if (score >= 70) {
    label = "Normal Load";
    prescription = "Proceed with planned strength/cardio. Avoid adding extra volume just because the score is good.";
  } else if (score >= 55) {
    label = "Moderate Load";
    prescription = "Reduce top-end intensity or volume by roughly 10–20%. Favor technical work and zone 2.";
  } else if (score >= 40) {
    label = "Pull Back";
    prescription = "Skip maximal sets. Use easy cardio, mobility, or a short deload session.";
  } else {
    label = "Rest / Recovery";
    prescription = "Prioritize sleep, hydration, food, and stress reduction. Train only if there is a specific low-risk reason.";
  }

  // Conservative overlays: training load and sleep debt can only make the
  // recommendation MORE cautious, never override recovery upward. This keeps a
  // green recovery score from green-lighting a spike in acute load.
  const modifiers = [];
  const debt = Number(sleepDebt?.debtHours ?? sleepDebt ?? 0);
  if ((loadZone === "high_risk" || loadZone === "overreaching") && label === "Push") {
    label = "Normal Load";
    modifiers.push(`training load is ${loadZone.replace(/_/g, " ")} — holding back from a push day`);
  }
  if (loadZone === "high_risk") {
    modifiers.push("acute load is well above your chronic baseline; favor a deload regardless of the score");
  }
  if (debt >= 5 && (label === "Push" || label === "Normal Load")) {
    label = "Moderate Load";
    modifiers.push(`sleep debt is ~${debt.toFixed(1)}h — recovery is sleep-limited, so cap intensity`);
  } else if (debt >= 3) {
    modifiers.push(`carrying ~${debt.toFixed(1)}h of sleep debt; protect sleep tonight`);
  }
  if (modifiers.length) {
    prescription += ` Note: ${modifiers.join("; ")}.`;
  }
  if (lowConfidence) {
    prescription += " Confidence is low, so treat this as a cautious estimate, not a command.";
  }
  return { label, prescription, readiness: readiness?.recommendation || "n/a", modifiers };
}

/**
 * Generate actionable recovery insights
 */
export function calcRecoveryInsights({ recovery, hrv, rhr, sleep, temp, quality, baselines, recommendation }) {
  const rows = [];
  if (quality?.fallbackMode) rows.push("Fallback mode is active because one or more raw Oura sleep signals are missing.");
  if (Number(hrv?.score) >= 28) rows.push("HRV contribution is strong relative to the recovery model.");
  if (Number(rhr?.delta) > 3) rows.push("Resting heart rate is elevated versus baseline; watch stress, heat, illness, or under-recovery.");
  if (Number(sleep?.nightly) < 17) rows.push("Sleep contribution is limiting today's recovery score.");
  if (Number(temp?.consecutiveNights) >= 2) rows.push("Temperature has been elevated for multiple nights; avoid forcing intensity.");
  if (recommendation?.label) rows.push(`Training recommendation: ${recommendation.label}.`);
  if (Array.isArray(recommendation?.modifiers) && recommendation.modifiers.length) {
    rows.push(`Why moderated: ${recommendation.modifiers.join("; ")}.`);
  }
  if (!rows.length) rows.push("No major negative cluster detected. Keep normal training constraints in place.");
  return rows.slice(0, 5);
}

/**
 * Describe which data sources are being used for each metric
 */
export function describeMetricSources(ouraData = {}) {
  // Anchor to the latest usable recovery day, not the newest (possibly
  // heartrate-only) synced date.
  const date = latestRecoveryDay(ouraData);
  const day = ouraData?.[date] || {};
  const sleep = getSleepDoc(day);
  const readiness = getReadinessDoc(day);
  const c = readiness?.contributors || {};
  const hrvSrc = hrvRmssdWithSource(sleep);
  return {
    hrv: hrvSrc.source ? hrvSrc.source : finiteNum(c.hrv_balance) !== null ? "readiness fallback" : "missing",
    rhr: finiteNum(rhrValue(sleep)) !== null ? "raw sleep RHR" : finiteNum(c.resting_heart_rate) !== null ? "readiness fallback" : "missing",
    sleep: finiteNum(sleep?.score) !== null ? "raw sleep score"
      : finiteNum(sleep?.total_sleep_duration ?? sleep?.total_sleep_time) !== null ? "raw sleep components"
      : finiteNum(c.previous_night ?? c.sleep_balance) !== null ? "readiness fallback" : "missing",
    temp: finiteNum(tempDeviation(sleep, readiness)) !== null ? "raw temperature deviation" : finiteNum(c.body_temperature) !== null ? "readiness fallback" : "missing",
  };
}
