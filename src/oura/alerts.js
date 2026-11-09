// src/oura/alerts.js
// Oura Alert System & History
//
// Multi-marker alert detection and localStorage history management.

import {
  getSleepDoc, getReadinessDoc, recoveryDates, latestRecoveryDay, tempDeviation
} from "./normalization";
import {
  calcHRVScore, calcRHRScore, calcSleepSubscore
} from "./algorithms";
import { mean } from "./statistics";

const LEGACY_ALERT_HISTORY_KEY = "0vertrained_alert_history";
const ALERT_HISTORY_KEY_PREFIX = "0vertrained_alert_history";
const MAX_HISTORY_DAYS = 14;

export function getAlertHistoryKey(userId) {
  const id = typeof userId === "string" ? userId.trim() : "";
  return id ? `${ALERT_HISTORY_KEY_PREFIX}_${id}` : null;
}

export function clearAlertHistory(userId) {
  try {
    localStorage.removeItem(LEGACY_ALERT_HISTORY_KEY);
    const scopedKey = getAlertHistoryKey(userId);
    if (scopedKey) localStorage.removeItem(scopedKey);
  } catch {
    // localStorage unavailable — silently skip
  }
}

/**
 * 4.12: Multi-marker alert system (v2 — fixed data paths, reachable branches, real baselines)
 */
export function checkAlerts(ouraData) {
  const alerts = [];
  const markers = [];

  // Anchor to the latest day that actually carries recovery signal, not a
  // heartrate-only newest sync date, so markers reflect real sleep/readiness.
  const todayDate = latestRecoveryDay(ouraData);
  const today = ouraData?.[todayDate];
  if (!today) return { alerts, markers, positiveMarkers: [], readiness: true, checkedAt: new Date().toISOString() };

  const sleep = getSleepDoc(today);
  const readinessData = getReadinessDoc(today);

  // ── Collect markers ──────────────────────────────────────────────────────
  // Use the canonical temp helper so skin-temperature deviation is honored even
  // when the readiness-level deviation is absent.
  const tempDev = tempDeviation(sleep, readinessData);
  if (Number.isFinite(Number(tempDev)) && Number(tempDev) > 0.5) {
    markers.push("temp_elevated");
  }

  const hrv = calcHRVScore(ouraData);
  if (Number.isFinite(Number(hrv?.zScore)) && parseFloat(hrv.zScore) < -1.0) {
    markers.push("hrv_suppressed");
  }

  const rhr = calcRHRScore(ouraData);
  if (Number.isFinite(Number(rhr?.delta)) && parseFloat(rhr.delta) > 5) {
    markers.push("rhr_elevated");
  }

  // Compute real respiratory baseline from the 14-day window.
  // V2 daily_readiness documents carry NO respiratory_rate — the field
  // lives on the SLEEP document as `average_breath` (present on every main
  // sleep in the reporting user's export; the readiness read was always null,
  // so this alert could never fire on real synced data). Sleep's reading is
  // primary; the readiness field stays as a legacy fallback.
  const respToday = Number(sleep?.average_breath ?? readinessData?.respiratory_rate);
  if (Number.isFinite(respToday)) {
    const respRates = [];
    const dates = recoveryDates(ouraData).slice(0, 14);
    for (const date of dates) {
      const daySleep = getSleepDoc(ouraData[date]);
      const dayReadiness = getReadinessDoc(ouraData[date]);
      const v = Number(daySleep?.average_breath ?? dayReadiness?.respiratory_rate);
      if (Number.isFinite(v)) respRates.push(v);
    }
    const avgResp = respRates.length ? mean(respRates) : 16;
    if (respToday > avgResp + 2) {
      markers.push("resp_elevated");
    }
  }

  // Stored V2 sleep docs carry `efficiency` (already 0–100); the old
  // `sleep_efficiency`-only read meant this alert could never fire on real
  // synced data.
  const effRaw = sleep?.efficiency ?? sleep?.sleep_efficiency;
  if (Number.isFinite(Number(effRaw))) {
    const eff = Number(effRaw) > 0 && Number(effRaw) <= 1
      ? Number(effRaw) * 100
      : Number(effRaw);
    if (eff < 80) markers.push("efficiency_low");
  }

  // Sleep-limited recovery: when raw sleep is present but the nightly
  // contribution is weak, flag sleep specifically as the limiter (distinct from
  // a broad multi-system deviation).
  const sleepSub = sleep ? calcSleepSubscore(sleep) : null;
  const sleepNightly = Number(sleepSub?.nightly);
  if (sleep && Number.isFinite(sleepNightly) && sleepNightly < 14) {
    markers.push("sleep_limited");
  }

  // ── Positive markers (strong recovery signals) ───────────────────────────
  const positiveMarkers = [];
  if (Number.isFinite(Number(hrv?.zScore)) && parseFloat(hrv.zScore) >= 0.5) {
    positiveMarkers.push("hrv_strong");
  }
  if (Number.isFinite(Number(rhr?.delta)) && parseFloat(rhr.delta) <= -2) {
    positiveMarkers.push("rhr_low");
  }
  if (Number.isFinite(Number(readinessData?.score)) && readinessData.score >= 85) {
    positiveMarkers.push("readiness_high");
  }
  if (Number.isFinite(Number(tempDev)) && Math.abs(Number(tempDev)) <= 0.3) {
    positiveMarkers.push("temp_normal");
  }
  if (sleep && Number.isFinite(sleepNightly) && sleepNightly >= 20) {
    positiveMarkers.push("sleep_adequate");
  }

  // ── Trigger alerts ───────────────────────────────────────────────────────
  const negativeCount = markers.length;
  const positiveCount = positiveMarkers.length;

  if (negativeCount >= 3) {
    if (markers.includes("temp_elevated") && markers.includes("hrv_suppressed")) {
      alerts.push({
        type: "illness_warning",
        message: "Multiple recovery markers deviating simultaneously. Monitor for illness or significant stress.",
        severity: "warning",
        markers: [...markers],
        recommendation: "Rest recommended. Prioritize sleep, hydration, and nutrition. Skip high-intensity training.",
      });
    } else {
      alerts.push({
        type: "stress_alert",
        message: "Elevated stress markers detected. Recovery capacity may be reduced.",
        severity: "caution",
        markers: [...markers],
        recommendation: "Prioritize recovery. Light training only. Monitor how you feel.",
      });
    }
  } else if (negativeCount >= 1 && negativeCount < 3) {
    // Sleep-limited case: when short/poor sleep is the main deviation, name it
    // explicitly rather than as a generic "marker outside range".
    const sleepIsLimiter = markers.includes("sleep_limited") || markers.includes("efficiency_low");
    const nonSleep = markers.filter(m => m !== "sleep_limited" && m !== "efficiency_low");
    if (sleepIsLimiter && nonSleep.length === 0) {
      alerts.push({
        type: "sleep_limited",
        message: "Sleep is limiting recovery today. HRV, resting heart rate, and temperature look otherwise unremarkable.",
        severity: "caution",
        markers: [...markers],
        recommendation: "Training is likely fine, but keep intensity conservative and prioritize an earlier night. Recovery is capped by sleep, not by systemic stress.",
      });
    } else {
      alerts.push({
        type: "minor_deviation",
        message: `${negativeCount} marker${negativeCount > 1 ? "s" : ""} outside normal range. Watch for trends.`,
        severity: "caution",
        markers: [...markers],
        recommendation: "Normal training is likely fine, but pay attention to subjective readiness.",
      });
    }
  }

  if (positiveCount >= 2 && negativeCount === 0) {
    alerts.push({
      type: "readiness_signal",
      message: "Strong recovery signals detected across multiple markers.",
      severity: "positive",
      markers: [...positiveMarkers],
      recommendation: "Ready for high-intensity training. Good day for PR attempts if warm-ups move well.",
    });
  }

  return {
    alerts,
    markers,
    positiveMarkers,
    readiness: alerts.length === 0 || alerts.every(a => a.severity === "positive"),
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Get alert history from localStorage
 */
export function getAlertHistory(userId) {
  try {
    const key = getAlertHistoryKey(userId);
    if (!key) return {};
    // One-time safety cleanup: old builds used an unscoped localStorage key, which
    // could show derived alert history across accounts on a shared browser.
    localStorage.removeItem(LEGACY_ALERT_HISTORY_KEY);
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const data = JSON.parse(raw);
    // Prune entries older than MAX_HISTORY_DAYS
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - MAX_HISTORY_DAYS);
    const cutoffStr = cutoff.toISOString().split("T")[0];
    const pruned = {};
    for (const [date, entry] of Object.entries(data)) {
      if (date >= cutoffStr) pruned[date] = entry;
    }
    if (Object.keys(pruned).length !== Object.keys(data).length) {
      localStorage.setItem(key, JSON.stringify(pruned));
    }
    return pruned;
  } catch {
    return {};
  }
}

/**
 * Save alert snapshot to localStorage history
 */
export function saveAlertSnapshot(date, alertData, userId) {
  try {
    const key = getAlertHistoryKey(userId);
    if (!key) return;
    localStorage.removeItem(LEGACY_ALERT_HISTORY_KEY);
    const history = getAlertHistory(userId);
    history[date] = {
      severity: alertData.alerts?.length
        ? alertData.alerts.some(a => a.severity === "warning") ? "warning"
        : alertData.alerts.some(a => a.severity === "caution") ? "caution"
        : "positive"
        : "clear",
      markerCount: (alertData.markers || []).length,
      positiveMarkerCount: (alertData.positiveMarkers || []).length,
      alerts: alertData.alerts || [],
      checkedAt: alertData.checkedAt,
    };
    localStorage.setItem(key, JSON.stringify(history));
  } catch {
    // localStorage unavailable — silently skip
  }
}
