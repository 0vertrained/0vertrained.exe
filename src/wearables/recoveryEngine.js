// src/wearables/recoveryEngine.js
// ─────────────────────────────────────────────────────────────────────────────
// Multi-Wearable Recovery Engine
//
// V16.1 · Relocated from src/oura/algorithms.js (the audit's acknowledged
// naming debt): since V16.0 this module arbitrates across sources — Oura
// primary, Whoop as declared fallback rungs, within-source baselines
// throughout. A compatibility shim remains at the old path so every existing
// import keeps working; new code should import from here.
// ─────────────────────────────────────────────────────────────────────────────

import {
  getSleepDoc, getReadinessDoc, readinessContributor,
  recoveryDates, latestRecoveryDay, mainSleepDurationSeconds,
  hrvRmssd, hrvRmssdWithSource, rhrValue, tempDeviation
} from "../oura/normalization";
import {
  trimmedMean, trimmedStdDev, lnRMSSD, zScore, cv, linearRegression
} from "../oura/statistics";

// Confidence label from the number of usable samples backing a baseline.
// A z-score against a 2-night window is far less trustworthy than a 14-night
// one; expose that instead of silently presenting both as equal.
function sampleConfidence(n) {
  if (n >= 10) return "high";
  if (n >= 5) return "medium";
  if (n >= 2) return "low";
  return "insufficient";
}

// ═══ V16.0 · Multi-wearable arbitration (audit F4) ═══════════════════════
// This module is historically Oura-named but is now the multi-source recovery
// engine. Whoop enters as a declared FALLBACK RUNG per metric — never an
// average, never a mixed pool. Baselines are strictly within-source (devices
// carry systematic offsets; z-scores are computed against the SAME device's
// own history, leave-one-out per F1), and the ladder's top rung wins outright
// when both report. Ladders: HRV oura-rmssd → whoop-rmssd → readiness
// balance · RHR oura-lowest → whoop-rhr · Sleep oura-staging → whoop-perf →
// readiness fallback. Every rung declares itself via `source`.
// ═══ V16.5.1 · Physiological SD floors ═══════════════════════════════════
// The leave-one-out fix (F1) removed an accidental safety net: the old
// contaminated pool inflated SD. A consistent athlete's tight prior pool can
// have near-zero sample SD, making a ROUTINE nightly wobble read as |z| > 2.5
// (real-data report: HRV 8/35 · RHR 3/25 on an ordinary morning). Floors
// reflect normal night-to-night noise — lnRMSSD ≈ 5% CV, RHR ≈ 1.5 bpm — so
// they only engage on unnaturally flat pools; genuine crashes still saturate
// the anchors (the V15.6 repro remains pinned). Floored days say so in detail.
const SD_FLOOR_LN_HRV = 0.05;
const SD_FLOOR_RHR = 1.5;
const flooredSd = (sd, floor) => ({ sd: Math.max(sd, floor), floored: sd < floor && sd > 0 });

const whoopDates = (whoop) => Object.keys(whoop || {}).sort().reverse();
function whoopHrvToday(whoop, day) {
  const v = whoop?.[day]?.recovery?.score?.hrv_rmssd_milli;
  return Number.isFinite(v) && v > 0 ? v : null;
}
function whoopHrvPool(whoop, excludeDay) {
  const out = [];
  for (const d of whoopDates(whoop)) {
    if (d === excludeDay) continue;
    const v = whoopHrvToday(whoop, d);
    if (v) out.push(Math.log(v));
    if (out.length >= 14) break;
  }
  return out;
}
function whoopRhrToday(whoop, day) {
  const v = whoop?.[day]?.recovery?.score?.resting_heart_rate;
  return Number.isFinite(v) && v > 0 ? v : null;
}
function whoopRhrPool(whoop, excludeDay) {
  const out = [];
  for (const d of whoopDates(whoop)) {
    if (d === excludeDay) continue;
    const v = whoopRhrToday(whoop, d);
    if (v) out.push(v);
    if (out.length >= 14) break;
  }
  return out;
}
function whoopSleepPerf(whoop, day) {
  const v = whoop?.[day]?.sleep?.score?.sleep_performance_percentage;
  return Number.isFinite(v) && v >= 0 && v <= 100 ? v : null;
}

function hrvBalanceFallbackScore(ouraData, baseline = 0, sampleCount = 0) {
  const day = latestRecoveryDay(ouraData);
  const hrvBalance = readinessContributor(ouraData?.[day], "hrv_balance");
  if (hrvBalance === null) return null;
  return {
    score: Math.round(Math.max(0, Math.min(35, (hrvBalance / 100) * 35))),
    zScore: 0,
    cv: 0,
    baseline,
    sampleCount,
    confidence: "low",
    source: "readiness fallback",
    detail: `Oura readiness HRV balance fallback: ${hrvBalance}/100`,
  };
}

/**
 * 4.2: HRV Score (0-35) from Oura data
 */
export function calcHRVScore(ouraData, settings = {}, whoopData = null) {
  const hrvSource = settings.hrvSource || "ourAlgorithm";

  // V15.6 · Leave-one-out baseline (audit F1). The old pool INCLUDED the day
  // being scored, so today's value dragged the mean toward itself and inflated
  // the SD — z-scores were systematically shrunk, worst at small n, exactly
  // when a real HRV crash most needs to register. The pool is now the days
  // PRIOR to the scoring day.
  const lnRmssdValues = [];
  const dates = recoveryDates(ouraData).slice(0, 15);
  const scoringDay = dates[0];

  for (const date of dates) {
    if (date === scoringDay) continue;
    const sleep = getSleepDoc(ouraData[date]);
    const rmssd = hrvRmssd(sleep);
    if (rmssd) {
      lnRmssdValues.push(lnRMSSD(rmssd));
    }
  }

  if (lnRmssdValues.length === 0) {
    const fallback = hrvBalanceFallbackScore(ouraData);
    if (fallback) return fallback;
    return {
      score: 0,
      zScore: 0,
      cv: 0,
      baseline: 0,
      sampleCount: 0,
      confidence: "insufficient",
      source: "missing",
      detail: "Insufficient HRV data",
    };
  }

  // Get baseline and SD.
  // V16.7 · Robust center AND spread (trim 0.1, mirroring the RHR baseline's
  // trimmed mean). A single crash night left IN the pool inflated the plain SD
  // and masked the next real dip: on the reporting user's export, the 07-05
  // crash (37 ms in a ~72 ms pool) widened ln-SD 0.15 → 0.24, so a genuine
  // −16% morning nine days later — which BOTH wearables graded low — read as
  // z −0.45 (30/35) here. Trimmed, it reads z −1.09 (21/35), landing between
  // the devices. Ordinary mornings are near-unchanged; the physiological SD
  // floor (V16.5.1) still guards the tight-pool side.
  const baseline = trimmedMean(lnRmssdValues, 0.1);
  const sd = trimmedStdDev(lnRmssdValues, 0.1);

  // If using Oura HRV Balance instead
  // F8 note: the "ouraMapped" path reports zScore 0 by design — Oura's
  // balance is already a normalized 0–100, so a raw z is not meaningful here.
  if (hrvSource === "ouraMapped") {
    const balance = readinessContributor(ouraData?.[latestRecoveryDay(ouraData)], "hrv_balance");
    if (balance !== null) {
      return {
        score: Math.round(Math.max(0, Math.min(35, (balance / 100) * 35))),
        zScore: 0,
        cv: 0,
        baseline,
        sampleCount: lnRmssdValues.length,
        confidence: "low",
        source: "readiness fallback",
        detail: `Oura readiness HRV balance: ${balance}/100`,
      };
    }
  }

  // Calculate today's z-score
  const todayDate = latestRecoveryDay(ouraData);
  const todaySleep = getSleepDoc(ouraData[todayDate]);
  const { value: todayRmssd, source: todaySource } = hrvRmssdWithSource(todaySleep);

  if (!todayRmssd) {
    // V16.0 · Whoop rung: same-day Whoop rmssd (ms — same unit), z-scored
    // against WHOOP's own leave-one-out history. Oura's pool never touches it.
    const wToday = whoopHrvToday(whoopData, todayDate);
    const wPool = whoopHrvPool(whoopData, todayDate);
    if (wToday && wPool.length >= 4) {
      const wBase = trimmedMean(wPool, 0.1);
      const wSd = flooredSd(trimmedStdDev(wPool, 0.1), SD_FLOOR_LN_HRV).sd;
      const wz = zScore(Math.log(wToday), wBase, wSd);
      const anchors = [
        { z: 0.5, pts: 35 }, { z: -0.5, pts: 30 }, { z: -1.0, pts: 22 },
        { z: -2.0, pts: 12 }, { z: -3.0, pts: 5 },
      ];
      let pts;
      if (wz >= anchors[0].z) pts = anchors[0].pts;
      else if (wz <= anchors[anchors.length - 1].z) pts = anchors[anchors.length - 1].pts;
      else {
        for (let i = 0; i < anchors.length - 1; i++) {
          const a = anchors[i], b = anchors[i + 1];
          if (wz <= a.z && wz >= b.z) { pts = Math.round(b.pts + ((wz - b.z) / (a.z - b.z)) * (a.pts - b.pts)); break; }
        }
      }
      return {
        score: pts,
        zScore: wz.toFixed(2),
        cv: 0,
        baseline: wBase,
        sampleCount: wPool.length,
        confidence: wPool.length >= 7 ? "medium" : "low",
        source: "whoop recovery HRV (fallback)",
        detail: `Whoop rmssd z=${wz.toFixed(2)} vs its own ${wPool.length}-day baseline`,
      };
    }
    const fallback = hrvBalanceFallbackScore(ouraData, baseline, lnRmssdValues.length);
    if (fallback) return fallback;
    return {
      score: 0,
      zScore: 0,
      cv: 0,
      baseline,
      sampleCount: lnRmssdValues.length,
      confidence: "low",
      source: "missing",
      detail: "No today data",
    };
  }

  const todayLn = lnRMSSD(todayRmssd);
  const { sd: sdEff, floored: sdFloored } = flooredSd(sd, SD_FLOOR_LN_HRV);
  const z = zScore(todayLn, baseline, sdEff);

  // Continuous z-score → points mapping (replaces hard cliffs that caused
  // single-point jumps: z=-0.49→30, z=-0.50→22). Linear interpolation
  // between anchor points, clamped to [0, 35].
  //   z ≥ +0.5  → 35   (strong)
  //   z =  0.0  → 32.5 (midpoint of 30–35)
  //   z = -0.5  → 30   (at baseline)
  //   z = -1.0  → 22   (mildly suppressed)
  //   z = -2.0  → 12   (moderately suppressed)
  //   z ≤ -2.0  →  5   (significantly suppressed)
  const HRV_Z_ANCHORS = [
    { z: 0.5, pts: 35 },
    { z: -0.5, pts: 30 },
    { z: -1.0, pts: 22 },
    { z: -2.0, pts: 12 },
    { z: -3.0, pts: 5 },
  ];
  let scoreBase;
  if (z >= HRV_Z_ANCHORS[0].z) {
    scoreBase = HRV_Z_ANCHORS[0].pts;
  } else if (z <= HRV_Z_ANCHORS[HRV_Z_ANCHORS.length - 1].z) {
    scoreBase = HRV_Z_ANCHORS[HRV_Z_ANCHORS.length - 1].pts;
  } else {
    // Find the bracket and linearly interpolate.
    for (let i = 0; i < HRV_Z_ANCHORS.length - 1; i++) {
      const hi = HRV_Z_ANCHORS[i];
      const lo = HRV_Z_ANCHORS[i + 1];
      if (z <= hi.z && z >= lo.z) {
        const t = (z - hi.z) / (lo.z - hi.z); // 0 at hi, 1 at lo
        scoreBase = hi.pts + t * (lo.pts - hi.pts);
        break;
      }
    }
  }

  // CV modifier
  const cvValue = cv(lnRmssdValues);
  let cvModifier;
  if (cvValue < 5) cvModifier = 2;
  else if (cvValue <= 8) cvModifier = 0;
  else if (cvValue <= 12) cvModifier = -3;
  else cvModifier = -6;

  const score = Math.max(0, Math.min(35, scoreBase + cvModifier));

  return {
    score: Math.round(score),
    zScore: z.toFixed(2),
    cv: cvValue.toFixed(1),
    baseline: baseline.toFixed(2),
    sampleCount: lnRmssdValues.length,
    confidence: lnRmssdValues.length >= 7 ? "high" : lnRmssdValues.length >= 4 ? "medium" : "low",
    source: todaySource || "raw sleep HRV",
    detail: `z=${z.toFixed(2)}, CV=${cvValue.toFixed(1)}% (n=${lnRmssdValues.length})${sdFloored ? " · sd floored" : ""}`,
  };
}

/**
 * 4.3: RHR Score (0-25) from Oura data
 */
export function calcRHRScore(ouraData, whoopData = null) {
  const rhrValues = [];
  // V15.6 · Leave-one-out baseline (audit F1) — see calcHRVScore. The trimmed
  // mean already discards one extreme, but moderate same-day deviations still
  // contaminated the pool; today is now excluded outright.
  const dates = recoveryDates(ouraData).slice(0, 15);
  const scoringDay = dates[0];

  for (const date of dates) {
    if (date === scoringDay) continue;
    const sleep = getSleepDoc(ouraData[date]);
    const rhr = rhrValue(sleep);
    if (rhr) {
      rhrValues.push(rhr);
    }
  }

  if (rhrValues.length === 0) {
    const day = latestRecoveryDay(ouraData);
    const rhrContributor = readinessContributor(ouraData[day], "resting_heart_rate");
    if (rhrContributor !== null) {
      return {
        score: Math.round(Math.max(0, Math.min(25, (rhrContributor / 100) * 25))),
        delta: 0,
        baseline: 0,
        sampleCount: 0,
        confidence: "low",
        source: "readiness fallback",
        trend: `Oura readiness RHR fallback: ${rhrContributor}/100`,
      };
    }
    return {
      score: 0,
      delta: 0,
      baseline: 0,
      sampleCount: 0,
      confidence: "insufficient",
      source: "missing",
      trend: "Insufficient data",
    };
  }

  // Robust personal baseline: a trimmed mean discards a single anomalous night
  // (illness/alcohol RHR spike) that would otherwise inflate the reference and
  // mask a genuine elevation. Falls back to the plain mean for small samples.
  const baseline = trimmedMean(rhrValues, 0.1);
  const baselineMethod = rhrValues.length >= 5 ? "trimmed mean" : "mean";
  const todayDate = latestRecoveryDay(ouraData);
  const todaySleep = getSleepDoc(ouraData[todayDate]);
  // V16.0 · Whoop rung: same-day Whoop RHR against Whoop's own trimmed pool
  // when Oura has no reading (the old shim scored the day as exactly-baseline).
  const ouraToday = rhrValue(todaySleep);
  if (!ouraToday) {
    const wToday = whoopRhrToday(whoopData, scoringDay);
    const wPool = whoopRhrPool(whoopData, scoringDay);
    if (wToday && wPool.length >= 4) {
      const wBase = trimmedMean(wPool, 0.1);
      const wSd = flooredSd(trimmedStdDev(wPool, 0.1), SD_FLOOR_RHR).sd;
      const wz = wSd > 0 ? (wToday - wBase) / wSd : null;
      const wDelta = wToday - wBase;
      let pts = 25;
      if (wz !== null) {
        if (wz >= 2) pts = 5; else if (wz >= 1.5) pts = 10; else if (wz >= 1) pts = 15; else if (wz >= 0.5) pts = 20;
      } else if (wDelta >= 5) pts = 10; else if (wDelta >= 3) pts = 15;
      return {
        score: pts,
        delta: wDelta.toFixed(1),
        zScore: wz === null ? null : wz.toFixed(2),
        baseline: Math.round(wBase),
        sampleCount: wPool.length,
        confidence: wPool.length >= 7 ? "medium" : "low",
        source: "whoop recovery RHR (fallback)",
        detail: `Whoop RHR ${wToday} vs its own ${Math.round(wBase)} baseline`,
      };
    }
  }
  const todayRHR = ouraToday || baseline;

  const delta = todayRHR - baseline;

  // Z-score normalization: a +3 bpm delta means very different things for
  // RHR 45 (6.7% change) vs RHR 65 (4.6%). The z-score captures "how many
  // of YOUR standard deviations is this off" which is individual-variance-
  // aware. We blend: 60% z-score-based, 40% raw-delta-based. Falls back to
  // pure delta when SD is 0 (no variance in baseline → z undefined).
  // V16.7 · Spread robustness matches the trimmed-mean center — see calcHRVScore.
  const rhrSd = trimmedStdDev(rhrValues, 0.1);
  const { sd: rhrSdEff } = flooredSd(rhrSd, SD_FLOOR_RHR);
  const rhrZ = rhrSdEff > 0 ? (todayRHR - baseline) / rhrSdEff : null;

  // Z-score → points (continuous, same approach as HRV)
  //   z ≤ -1.0 → 25 (well below baseline, strong recovery)
  //   z =  0.0 → 22 (at baseline)
  //   z = +1.0 → 16 (mildly elevated)
  //   z = +2.0 → 10 (elevated)
  //   z ≥ +3.0 →  4 (significantly elevated)
  const RHR_Z_ANCHORS = [
    { z: -1.0, pts: 25 },
    { z: 0.0, pts: 22 },
    { z: 1.0, pts: 16 },
    { z: 2.0, pts: 10 },
    { z: 3.0, pts: 4 },
  ];
  let zScoreBase = null;
  if (rhrZ !== null) {
    if (rhrZ <= RHR_Z_ANCHORS[0].z) {
      zScoreBase = RHR_Z_ANCHORS[0].pts;
    } else if (rhrZ >= RHR_Z_ANCHORS[RHR_Z_ANCHORS.length - 1].z) {
      zScoreBase = RHR_Z_ANCHORS[RHR_Z_ANCHORS.length - 1].pts;
    } else {
      for (let i = 0; i < RHR_Z_ANCHORS.length - 1; i++) {
        const lo = RHR_Z_ANCHORS[i];
        const hi = RHR_Z_ANCHORS[i + 1];
        if (rhrZ >= lo.z && rhrZ <= hi.z) {
          const t = (rhrZ - lo.z) / (hi.z - lo.z);
          zScoreBase = lo.pts + t * (hi.pts - lo.pts);
          break;
        }
      }
    }
  }

  // Raw delta → points (original scoring, kept as the fallback component)
  let deltaBase;
  if (delta <= -2) deltaBase = 25;
  else if (delta <= 0) deltaBase = 22;
  else if (delta <= 3) deltaBase = 18;
  else if (delta <= 6) deltaBase = 12;
  else if (delta <= 10) deltaBase = 6;
  else deltaBase = 2;

  // Blend: when z-score is available, weight 60/40 (z/delta). Without
  // variance (SD=0, e.g. very few samples), use pure delta to preserve
  // existing behavior.
  let scoreBase = rhrZ !== null && zScoreBase !== null
    ? zScoreBase * 0.6 + deltaBase * 0.4
    : deltaBase;

  // 3-day trend modifier.
  // V16.6 · Direction fix: rhrValues is built newest-first, but
  // linearRegression treats index as time. Feeding it newest-first INVERTED
  // the trend — a genuinely rising RHR (bad) read as a falling slope and
  // earned the +1 bonus, and vice versa. Reverse to chronological order so
  // the slope's sign matches physiology.
  const recent3 = rhrValues.slice(0, 3).reverse();
  const slope = linearRegression(recent3);
  let trendMod = 0;
  if (slope < -0.5) trendMod = 1;
  else if (slope > 0.5) trendMod = -2;

  const score = Math.max(0, Math.min(25, scoreBase + trendMod));

  return {
    score: Math.round(score),
    delta: delta.toFixed(1),
    zScore: rhrZ !== null ? rhrZ.toFixed(2) : null,
    baseline: baseline.toFixed(1),
    baselineMethod,
    sampleCount: rhrValues.length,
    confidence: sampleConfidence(rhrValues.length),
    source: rhrValue(todaySleep) !== null && rhrValue(todaySleep) !== undefined ? "raw sleep RHR" : "baseline (no today RHR)",
    trend: slope > 0 ? "rising" : slope < 0 ? "falling" : "stable",
  };
}

/**
 * 4.4: Sleep Quality Subscore (0-25 nightly, 0-25 weekly)
 */
export function calcSleepSubscore(sleepData, ouraData = null, refDate = null) {
  if (!sleepData) {
    return {
      nightly: 0,
      weekly: 0,
      components: {},
    };
  }

  // V16.6 · `durationSecondsOverride` lets a split night (two long_sleep
  // documents on one day) count its FULL summed duration toward the duration
  // component. Staging percentages, efficiency, and latency still read from
  // the primary segment — mixing a summed duration into per-segment ratios
  // would distort them.
  const scoreSleep = (s, durationSecondsOverride = null) => {
    const finite = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, finite(v)));

    const totalSleep = finite(s.total_sleep_duration ?? s.total_sleep_time);
    if (totalSleep <= 0) {
      return { dScore: 0, eScore: 0, deepScore: 0, remScore: 0, latScore: 0, total: 0 };
    }
    const durationSeconds = Number.isFinite(Number(durationSecondsOverride)) && Number(durationSecondsOverride) > 0
      ? Number(durationSecondsOverride)
      : totalSleep;

    const awakeDuration = finite(s.awake_time ?? s.wake_duration);
    const timeInBed = finite(s.time_in_bed, totalSleep + awakeDuration);
    const deepDuration = finite(s.deep_sleep_duration ?? s.deep_duration);
    const remDuration = finite(s.rem_sleep_duration ?? s.rem_duration);
    const latency = finite(s.sleep_latency ?? s.latency);
    const durationHours = durationSeconds / 3600;

    let dScore;
    if (durationHours >= 8.0) dScore = 8;
    else if (durationHours >= 7.0) dScore = 7 + (durationHours - 7.0);
    else if (durationHours >= 6.0) dScore = 4 + (durationHours - 6.0) * 3;
    else if (durationHours >= 5.0) dScore = 1 + (durationHours - 5.0) * 3;
    else dScore = Math.max(0, durationHours * 0.2);

    let efficiency = finite(s.sleep_efficiency, NaN);
    if (!Number.isFinite(efficiency)) {
      efficiency = timeInBed > 0 ? (totalSleep / timeInBed) * 100 : 0;
    }
    // Some APIs return 0.92, others return 92.
    if (efficiency > 0 && efficiency <= 1) efficiency *= 100;

    let eScore;
    if (efficiency >= 90) eScore = 7;
    else if (efficiency >= 85) eScore = 6;
    else if (efficiency >= 80) eScore = 4;
    else if (efficiency >= 75) eScore = 2;
    else eScore = Math.max(0, (efficiency - 50) * 0.08);

    const deepPct = (deepDuration / totalSleep) * 100;
    let deepScore = 0;
    if (deepPct >= 15 && deepPct <= 25) deepScore = 5;
    else if (deepPct >= 10 && deepPct < 15) deepScore = 3;
    else if (deepPct > 25 && deepPct <= 30) deepScore = 3;
    else if (deepPct >= 5 && deepPct < 10) deepScore = 1;

    const remPct = (remDuration / totalSleep) * 100;
    let remScore = 0;
    if (remPct >= 20 && remPct <= 25) remScore = 3;
    else if (remPct >= 15 && remPct < 20) remScore = 2;
    else if (remPct >= 10 && remPct < 15) remScore = 1;

    const latencyMins = latency / 60;
    let latScore = 0;
    if (latencyMins <= 15) latScore = 2;
    else if (latencyMins <= 30) latScore = 1;

    const total = clamp(dScore, 0, 8) + clamp(eScore, 0, 7) + clamp(deepScore, 0, 5) + clamp(remScore, 0, 3) + clamp(latScore, 0, 2);
    return {
      dScore: clamp(dScore, 0, 8),
      eScore: clamp(eScore, 0, 7),
      deepScore: clamp(deepScore, 0, 5),
      remScore: clamp(remScore, 0, 3),
      latScore: clamp(latScore, 0, 2),
      total: clamp(total, 0, 25),
    };
  };

  const nightlyDayKey = refDate || (ouraData ? recoveryDates(ouraData)[0] : null);
  const nightlyDurationSum = ouraData && nightlyDayKey ? mainSleepDurationSeconds(ouraData[nightlyDayKey]) : null;
  const nightly = sleepData ? scoreSleep(sleepData, nightlyDurationSum) : { total: 0 };

  // Weekly: actual 7-day rolling average of nightly sleep subscores when the
  // full data map is provided. Falls back to nightly when no context (preserves
  // backward compatibility for callers that only pass a single sleep doc).
  let weekly = nightly.total;
  if (ouraData) {
    const dates = recoveryDates(ouraData);
    const anchor = refDate || dates[0];
    if (anchor) {
      const anchorIdx = dates.indexOf(anchor);
      const startIdx = anchorIdx >= 0 ? anchorIdx : 0;
      const weekDates = dates.slice(startIdx, startIdx + 7);
      const weekScores = [];
      for (const d of weekDates) {
        const sd = getSleepDoc(ouraData[d]);
        if (sd) {
          const s = scoreSleep(sd, mainSleepDurationSeconds(ouraData[d]));
          if (Number.isFinite(s.total) && s.total > 0) weekScores.push(s.total);
        }
      }
      if (weekScores.length >= 3) {
        weekly = weekScores.reduce((a, b) => a + b, 0) / weekScores.length;
      } else if (weekScores.length > 0) {
        // Blend: weight nightly at 60% when only 1-2 historical nights exist.
        weekly = nightly.total * 0.6 + (weekScores.reduce((a, b) => a + b, 0) / weekScores.length) * 0.4;
      }
    }
  }

  return {
    nightly: Math.round(nightly.total),
    weekly: Math.round(weekly),
    components: nightly,
  };
}

/**
 * 4.5: Temperature Score (0-15)
 */
export function calcTempScore(ouraData) {
  const deviations = [];
  // Restrict to days that carry recovery signal so a heartrate-only newest sync
  // date cannot become the anchor night.
  const dates = recoveryDates(ouraData).slice(0, 7);

  for (const date of dates) {
    const sleep = getSleepDoc(ouraData[date]);
    const readiness = getReadinessDoc(ouraData[date]);
    const dev = tempDeviation(sleep, readiness);
    if (dev !== null && dev !== undefined) {
      deviations.push({
        date,
        dev,
      });
    }
  }

  if (deviations.length === 0) {
    // No temperature data → neutral (not perfect). Returning 15/15 for
    // missing data was a silent inflation of up to 15 pts on the recovery
    // score. Use a neutral mid-score with an explicit flag so callers and
    // the UI can surface "temp unavailable" instead of implying it's great.
    return { score: 8, deviation: 0, consecutiveNights: 0, source: "missing", confidence: "insufficient" };
  }

  const todayDev = Math.abs(deviations[0]?.dev || 0);

  // Scoring
  let score;
  if (todayDev <= 0.3) score = 15;
  else if (todayDev <= 0.6) score = 10;
  else if (todayDev <= 1.0) score = 5;
  else score = 2;

  // Consecutive night penalty
  let consecutive = 0;
  for (const d of deviations) {
    if (d.dev > 0.5) consecutive++;
    else break;
  }

  let penalty = 0;
  if (consecutive >= 3) penalty = -4;
  else if (consecutive === 2) penalty = -2;

  score = Math.max(0, Math.min(15, score + penalty));

  return {
    score: Math.round(score),
    deviation: todayDev.toFixed(2),
    // V16.6 · The newest date that actually carried a temperature reading. When
    // this is older than the scored day, the temp subscore is standing on a
    // prior night — callers can surface that instead of implying "today".
    deviationDate: deviations[0]?.date || null,
    consecutiveNights: consecutive,
    source: "raw/readiness temp",
    confidence: deviations.length >= 5 ? "high" : deviations.length >= 2 ? "medium" : "low",
  };
}

/**
 * 4.6: Total Recovery Score (0-100)
 */
export function calcRecoveryScore(ouraData, settings = {}, whoopData = null) {
  const hrv = calcHRVScore(ouraData, settings, whoopData);
  const rhr = calcRHRScore(ouraData, whoopData);
  const currentDay = latestRecoveryDay(ouraData);
  const currentSleepDoc = getSleepDoc(ouraData[currentDay]);
  let sleep = calcSleepSubscore(currentSleepDoc, ouraData, currentDay);
  sleep.source = currentSleepDoc ? "raw sleep components" : "missing";
  if (!sleep.nightly) {
    const previousNight = readinessContributor(ouraData[currentDay], "previous_night");
    const sleepBalance = readinessContributor(ouraData[currentDay], "sleep_balance");
    // V16.0 · Whoop rung before the readiness fallback: sleep performance %
    // is Whoop's own 0–100 need-relative grade — a direct, honest 0–25 map.
    const wPerf = whoopSleepPerf(whoopData, currentDay);
    if (wPerf !== null) {
      sleep = {
        nightly: Math.round((wPerf / 100) * 25),
        weekly: Math.round((wPerf / 100) * 25),
        components: { whoop: `Whoop sleep performance: ${wPerf}%` },
        source: "whoop sleep performance (fallback)",
      };
    }
    const fallback = sleep.source === "whoop sleep performance (fallback)" ? null : (previousNight ?? sleepBalance);
    if (fallback !== null) {
      sleep = {
        nightly: Math.round(Math.max(0, Math.min(25, (fallback / 100) * 25))),
        weekly: Math.round(Math.max(0, Math.min(25, ((sleepBalance ?? fallback) / 100) * 25))),
        components: { fallback: `Oura readiness sleep fallback: ${fallback}/100` },
        source: "readiness fallback",
      };
    }
  }
  const temp = calcTempScore(ouraData);

  // V15.6 · Renormalized scoring (audit F2). The old sum graded a MISSING
  // signal as its worst case: no HRV that night contributed 0/35 and capped
  // the score at 65 from absence alone. The score is now points over the
  // maxima of signals that actually reported, on the same 0–100 scale, with
  // confidence carrying the uncertainty. Temp's old neutral-8-on-missing is
  // superseded by exclusion. If NOTHING reported, the honest answer is null.
  const counted = {
    hrv: hrv.source !== "missing",
    rhr: rhr.source !== "missing",
    sleep: sleep.source !== "missing",
    temp: temp.source !== "missing",
  };
  const MAXES = { hrv: 35, rhr: 25, sleep: 25, temp: 15 };
  const rawPts = (counted.hrv ? hrv.score : 0) + (counted.rhr ? rhr.score : 0)
    + (counted.sleep ? sleep.nightly : 0) + (counted.temp ? temp.score : 0);
  const availableMax = Object.entries(MAXES).reduce((a, [k, v]) => a + (counted[k] ? v : 0), 0);
  const score = availableMax > 0 ? Math.min(100, Math.max(0, (rawPts / availableMax) * 100)) : null;
  const countedKeys = Object.keys(counted).filter((k) => counted[k]);
  const scoringBasis = availableMax > 0
    ? `${countedKeys.length}/4 signals (${countedKeys.join("+")}) · normalized`
    : "no wearable signals reported";

  const band = score == null ? "insufficient_data"
    : score >= 85 ? "ready_to_push"
    : score >= 70 ? "good_to_train"
    : score >= 55 ? "train_moderate"
    : score >= 40 ? "take_it_easy"
    : score >= 25 ? "consider_rest"
    : "rest_recommended";

  // Transparent, self-reconciling ledger. Uncounted rows stay visible with
  // their maxima so the exclusion is inspectable, not hidden.
  const ledger = [
    { key: "hrv", label: "HRV", points: hrv.score, max: 35, source: hrv.source, counted: counted.hrv },
    { key: "rhr", label: "RHR", points: rhr.score, max: 25, source: rhr.source, counted: counted.rhr },
    { key: "sleep", label: "Sleep", points: sleep.nightly, max: 25, source: sleep.source, counted: counted.sleep },
    { key: "temp", label: "Temp", points: temp.score, max: 15, source: "raw/readiness temp", counted: counted.temp },
  ];
  const ledgerTotal = rawPts;
  return {
    score: score == null ? null : Math.round(score),
    subscores: { hrv: hrv.score, rhr: rhr.score, sleep: sleep.nightly, temp: temp.score },
    band,
    scoredDay: currentDay,
    ledger,
    ledgerTotal,
    availableMax,
    scoringBasis,
    reconciles: availableMax > 0
      ? Math.round(Math.min(100, Math.max(0, (ledgerTotal / availableMax) * 100))) === Math.round(score)
      : true,
    detail: { hrv, rhr, sleep, temp },
  };
}

/**
 * 4.7: Sleep Quality Index (0-100, standalone metric)
 * V16.6 · Tolerates V2 field names: `latency` (the stored payloads never carry
 * `sleep_latency`) and an `efficiency` that is already 0–100.
 */
export function calcSleepQualityIndex(sleepData) {
  if (!sleepData) return { score: 0, components: {} };

  const durationHours = sleepData.total_sleep_duration / 3600;
  let dScore = durationHours >= 8 ? 25 : durationHours >= 7 ? 22 : durationHours >= 6 ? 15 : Math.max(0, durationHours * 4);

  let efficiency = Number(sleepData.efficiency ?? sleepData.sleep_efficiency);
  if (!Number.isFinite(efficiency)) {
    efficiency = (sleepData.total_sleep_duration / (sleepData.time_in_bed || sleepData.total_sleep_duration + sleepData.awake_time)) * 100;
  } else if (efficiency > 0 && efficiency <= 1) {
    efficiency *= 100;
  }
  let effScore = efficiency >= 90 ? 20 : efficiency >= 80 ? 15 : efficiency >= 70 ? 10 : Math.max(0, (efficiency - 50) * 0.2);

  const deepPct = (sleepData.deep_sleep_duration / sleepData.total_sleep_duration) * 100;
  let deepScore = deepPct >= 15 && deepPct <= 25 ? 15 : deepPct >= 10 ? 10 : Math.max(0, deepPct * 1.5);

  const remPct = (sleepData.rem_sleep_duration / sleepData.total_sleep_duration) * 100;
  let remScore = remPct >= 20 && remPct <= 25 ? 10 : remPct >= 15 ? 7 : Math.max(0, remPct * 0.5);

  const latencyMins = (sleepData.sleep_latency ?? sleepData.latency ?? 0) / 60;
  let latScore = latencyMins <= 15 ? 10 : latencyMins <= 30 ? 5 : 0;

  const wasoMins = (sleepData.awake_time || 0) / 60;
  let wasoScore = wasoMins <= 15 ? 10 : wasoMins <= 30 ? 7 : wasoMins <= 45 ? 4 : Math.max(0, 60 - wasoMins) / 60 * 10;

  const timingScore = 10; // Simplified; real implementation uses bedtime variance

  const score = Math.round(dScore + effScore + deepScore + remScore + latScore + wasoScore + timingScore);

  return {
    score: Math.min(100, Math.max(0, score)),
    components: { dScore, effScore, deepScore, remScore, latScore, wasoScore, timingScore },
  };
}

/**
 * 4.8: Training Readiness Recommendation
 *
 * V16.6 · Input semantics clarified. `hrvTrend` is a SLOPE in lnRMSSD
 * units/day and `rhrTrend` a SLOPE in bpm/day — that is what the ±0.02 and
 * ±0.5 thresholds were designed against. The dashboard was passing today's
 * HRV z-score and RHR delta-from-baseline instead, so the "trend" points were
 * really level points: any ordinary z of ±0.5 or delta of ±1 bpm swung a
 * factor built for multi-day drift. Use the slope helpers below.
 */

// Chronological (oldest → newest) per-day slope of ln(HRV) over the most
// recent `windowDays` recovery days, INCLUDING the scoring day — a trend is a
// statement about where the observed values are heading. Returns 0 when fewer
// than 3 usable points exist (no-signal reads as flat, matching the neutral
// branch in calcTrainingReadiness).
export function hrvTrendSlopePerDay(ouraData, windowDays = 5) {
  const dates = recoveryDates(ouraData).slice(0, windowDays).reverse();
  const points = [];
  for (const date of dates) {
    const rmssd = hrvRmssd(getSleepDoc(ouraData[date]));
    if (Number.isFinite(Number(rmssd)) && Number(rmssd) > 0) points.push(lnRMSSD(Number(rmssd)));
  }
  if (points.length < 3) return 0;
  return linearRegression(points);
}

// Chronological per-day slope of RHR (bpm/day) over the most recent
// `windowDays` recovery days, including the scoring day. Same ≥3-point guard.
export function rhrTrendSlopePerDay(ouraData, windowDays = 5) {
  const dates = recoveryDates(ouraData).slice(0, windowDays).reverse();
  const points = [];
  for (const date of dates) {
    const rhr = rhrValue(getSleepDoc(ouraData[date]));
    if (Number.isFinite(Number(rhr)) && Number(rhr) > 0) points.push(Number(rhr));
  }
  if (points.length < 3) return 0;
  return linearRegression(points);
}

export function calcTrainingReadiness(recoveryScore, hrvTrend, rhrTrend, loadData = null, sleepDebt = 0) {
  let points = 0;

  // Recovery score contribution
  if (recoveryScore >= 75) points += 2;
  else if (recoveryScore >= 55) points += 1;
  else if (recoveryScore < 40) points -= 1;

  // HRV trend
  if (hrvTrend > 0.02) points += 1;
  else if (hrvTrend < -0.02) points -= 1;

  // RHR trend
  if (rhrTrend < -0.5) points += 1;
  else if (rhrTrend > 0.5) points -= 1;

  // Load trend (only if sufficient data)
  if (loadData && loadData.length >= 4) {
    const slope = linearRegression(loadData);
    if (slope < -0.10) points += 1;
    else if (slope > 0.15) points -= 1;
  }

  // Sleep debt
  if (sleepDebt > 5) points -= 2;
  else if (sleepDebt > 3) points -= 1;

  // Output recommendation
  let recommendation = "Train";
  if (points >= 3) recommendation = "Push";
  else if (points <= -2) recommendation = "Rest";
  else if (points === -1) recommendation = "Easy";
  else if (points === 0) recommendation = "Maintain";

  return {
    recommendation,
    points,
    factors: { recovery: recoveryScore, hrvTrend, rhrTrend, sleepDebt },
  };
}


/**
 * 4.10: HRV Recommendation (qualitative)
 */
export function getHRVRecommendation(zScore, weeklyCV) {
  let text = "HRV at baseline — train as planned";
  if (zScore >= 1.0) text = "HRV significantly above baseline — excellent recovery, ready for high intensity";
  else if (zScore >= 0.5) text = "HRV above baseline — good recovery, normal training appropriate";
  else if (zScore < -2.0) text = "HRV significantly suppressed — rest day recommended, check for illness/stress";
  else if (zScore < -1.0) text = "HRV moderately suppressed — prioritize recovery, light training only";
  else if (zScore < -0.5) text = "HRV mildly suppressed — consider reducing intensity, monitor how you feel";

  if (weeklyCV > 10) {
    text += " — Note: your HRV has been unstable this week, which may indicate accumulated stress";
  }

  const level = zScore >= 0.5 ? "high" : zScore >= -0.5 ? "normal" : zScore >= -1.0 ? "suppressed" : "critical";

  return { text, level, zScore: parseFloat(zScore).toFixed(2) };
}

/**
 * 4.11: Sleep Debt (7-day rolling, hours)
 *
 * V15.5.1 · Rewritten after a real-data report: the app showed 9h of debt
 * while both Oura and Whoop showed 0. Two flaws in the old formula:
 *   1. A hardcoded 8h baseline. The wearables grade against a PERSONALIZED
 *      need; a healthy 7.2h sleeper accrued ~5.6h/week of phantom debt here —
 *      and calcTrainingReadiness then docked the verdict for it.
 *   2. Deficit-only summation: surpluses never repaid anything, so debt could
 *      only ratchet up within the window.
 * New model, in baseline priority order:
 *   · needHours — the wearable's own need figure when the synced payload
 *     carries one (clamped to a sane 6.5–10h),
 *   · personal norm — the median of the user's recent sleep (≥5 samples,
 *     clamped 7–9h so a chronically deprived stretch can't normalize itself),
 *   · 8h default only when neither exists.
 * Debt is NET: deficits minus HALF of surpluses (recovery sleep repays, but
 * one long night shouldn't erase a rough week), floored at 0. Bands unchanged
 * — with an honest baseline they now fire only on real debt.
 */
const median = (xs) => {
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export function calcSleepDebt(sleepData, opts = {}) {
  if (!sleepData || sleepData.length === 0) {
    return { debtHours: 0, band: "Well-rested", baselineHours: 8, baselineSource: "default" };
  }
  const { needHours = null, baselineSamples = null } = opts;
  let baselineHours = 8;
  let baselineSource = "default";
  if (Number.isFinite(needHours) && needHours > 0) {
    baselineHours = clamp(needHours, 6.5, 10);
    baselineSource = "wearable-need";
  } else {
    const samples = (baselineSamples && baselineSamples.length >= 5 ? baselineSamples
      : sleepData.length >= 5 ? sleepData : null);
    if (samples) {
      // V16.9 · Floor lowered 7 → 6.5. The 7h floor manufactured phantom debt
      // for every sub-7h sleeper (a 6.4h median athlete accrued ~4h/week of
      // invisible deficit) — contradicting both wearables, which learn need
      // from the person. 6.5 matches the wearable-need clamp's lower bound;
      // the ceiling still stops a deprived stretch from normalizing itself.
      baselineHours = clamp(median(samples), 6.5, 9);
      baselineSource = "personal-norm";
    }
  }
  const deficit = sleepData.map(s => Math.max(0, baselineHours - s)).reduce((a, b) => a + b, 0);
  const surplus = sleepData.map(s => Math.max(0, s - baselineHours)).reduce((a, b) => a + b, 0);
  const debt = Math.max(0, deficit - 0.5 * surplus);

  const band = debt <= 2 ? "Well-rested"
    : debt <= 5 ? "Mild sleep debt"
    : debt <= 10 ? "Moderate sleep debt"
    : "Significant sleep debt";

  return {
    debtHours: parseFloat(debt.toFixed(1)),
    band,
    baselineHours: parseFloat(baselineHours.toFixed(1)),
    baselineSource,
  };
}
