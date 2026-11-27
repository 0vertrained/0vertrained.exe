// src/recoveryLoad.js
// Recovery's data pipeline as one async function: load the wearables, score
// the night, and work out everything the Recovery screen and its verdict read.
// The Recovery screen runs it when it opens and every minute after; the app
// runs it once at start, so Today can show the same call before Recovery is
// ever opened. Either way it refreshes the caches the screen hydrates from.
import {
  loadOuraData,
  calcRecoveryScore,
  calcTrainingReadiness,
  hrvTrendSlopePerDay,
  rhrTrendSlopePerDay,
  calcSleepDebt,
  checkAlerts,
  calcOuraDataQuality,
  calcMetricBaselines,
  calcRecoveryConfidence,
  getTrainingRecommendation,
  calcRecoveryInsights,
  describeMetricSources,
  getAlertHistory,
  saveAlertSnapshot,
  getOuraTokenStatus,
  getSleepDoc,
  mainSleepDurationSeconds,
  napSleepDurationSeconds,
  getReadinessDoc,
  latestRecoveryDay,
  recoveryDates,
  rhrValue,
  tempDeviation,
} from "./oura";
import { getWhoopTokenStatus, loadWhoopData } from "./whoop";
import { calcRecoveryScore as calcSubjectiveScore } from "./recovery";
import { loadStravaActivities, groupStravaByDate } from "./strava/dataLoading";
import { buildDailyLoads, computeRollingLoads, getLoadZoneInfo, findUnloggedLoadDays } from "./loadModel";
import { buildWearableLoadRows } from "./wearableWorkoutLoad";
import { buildSignalProvenance } from "./wearables/signalProvenance";
import { classifyRecoveryState } from "./wearables/recoveryTrend";
import { writeRecoveryDashboardCache } from "./recoveryDashboardSessionCache";
import { writeWearableSnapshot } from "./wearableSnapshotCache";
import { getTodayKey } from "./constants";
import { perfMark } from "./perf";
import { postServerSnapshot } from "./wearables/snapshot";
import { resolveHrvRawDisplay } from "./recovery/hrvRawDisplay";

const formatNum = (v, digits = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(digits) : null;
};

const durationHours = (sleep) => {
  const secs = Number(sleep?.total_sleep_duration ?? sleep?.total_sleep_time);
  return Number.isFinite(secs) && secs > 0 ? secs / 3600 : null;
};

const getRawRecoveryMetrics = (ouraData, sleepDebt) => {
  const key = latestRecoveryDay(ouraData);
  const day = ouraData?.[key] || {};
  const sleep = getSleepDoc(day);
  const readiness = getReadinessDoc(day);
  const contributors = readiness?.contributors || {};

  // HRV raw is resolved with explicit provenance (today's sleep HRV → most
  // recent dated night → readiness-balance fallback) so the trust strip never
  // shows a stale or fallback number as today's HRV unlabeled. See hrvRawDisplay.
  const hrvDisplay = resolveHrvRawDisplay(ouraData);
  const rhrRaw = rhrValue(sleep);
  const sleepScoreRaw = sleep?.score ?? readiness?.score ?? contributors.previous_night ?? contributors.sleep_balance;
  const sleepHrs = durationHours(sleep);
  const tempRaw = tempDeviation(sleep, readiness);
  const debtHrs = Number(sleepDebt?.debtHours);

  const sleepParts = [];
  if (sleepHrs !== null) sleepParts.push(`${formatNum(sleepHrs, 1)}h slept`);
  if (Number.isFinite(debtHrs)) sleepParts.push(`${formatNum(debtHrs, 1)}h debt`);
  if (Number.isFinite(Number(sleepScoreRaw))) {
    const sleepLabel = Number.isFinite(Number(sleep?.score))
      ? "Oura sleep score"
      : sleepHrs !== null
        ? "component context"
        : "readiness fallback";
    sleepParts.push(`${formatNum(sleepScoreRaw, 0)}/100 ${sleepLabel}`);
  }

  return {
    hrv: hrvDisplay.text,
    hrvMeta: { isFallback: hrvDisplay.isFallback, isStale: hrvDisplay.isStale, source: hrvDisplay.source, date: hrvDisplay.date },
    rhr: Number.isFinite(Number(rhrRaw))
      ? `${formatNum(rhrRaw, 0)} bpm`
      : Number.isFinite(Number(contributors.resting_heart_rate))
        ? `${formatNum(contributors.resting_heart_rate, 0)}/100 Oura RHR contributor`
        : "not available",
    sleep: sleepParts.length ? sleepParts.join(" · ") : "not available",
    temp: Number.isFinite(Number(tempRaw))
      ? `${formatNum(tempRaw, 2)}°C deviation`
      : Number.isFinite(Number(contributors.body_temperature))
        ? `${formatNum(contributors.body_temperature, 0)}/100 Oura body temp contributor`
        : "not available",
  };
};

/**
 * Load and score recovery for one account.
 * @returns {Promise<object>} { connected, tokenStatus, whoopConnected,
 *   whoopGrouped, ouraGrouped, provenance, unloggedFlags, editionRaw,
 *   snapshot, savedAt }. `snapshot` has the shape the caches keep (and that
 *   Recovery hydrates from); `savedAt` is set once the caches were written.
 */
export async function loadRecoveryData({ data, yesterdayKey, settings, userId, alertHistory = {} } = {}) {
  const out = {
    startedAt: Date.now(),
    connected: false,
    tokenStatus: null,
    whoopConnected: false,
    whoopGrouped: null,
    ouraGrouped: null,
    provenance: null,
    unloggedFlags: null,
    editionRaw: null,
    snapshot: null,
    savedAt: null,
  };
  let nextSnapshot;
    // One status call, fired in parallel with the data query (the query
    // needs no status — a disconnected user simply gets an empty result, at
    // the cost of one cheap indexed select). Sequential depth here: 2 → 1.
    // Whoop joins the batch as the arbitration layer's fallback
    // source. loadWhoopData is single-flighted, so this call collapses with
    // the context-panel effect's — zero additional network.
    const [tokenStat, ouraData, whoopData, stravaActs, whoopStat] = await Promise.all([
      getOuraTokenStatus(),
      loadOuraData(35), // 35d window feeds the trend baseline; scoring pools still slice(0,15)
      loadWhoopData(28).catch(() => null),
      loadStravaActivities(28).catch(() => []), // same load window as Today
      getWhoopTokenStatus().catch(() => null), // whether to blend the two wearables
    ]);
    const stravaGrouped = groupStravaByDate(stravaActs || []);
    perfMark("recovery", "oura-ready");
    const isConn = Boolean(tokenStat?.connected);
    out.connected = isConn;
    out.tokenStatus = isConn ? tokenStat : null;
    out.whoopConnected = Boolean(whoopStat?.connected);
    const oura = isConn ? ouraData || {} : {};
    const whoopForScore = out.whoopConnected ? whoopData || {} : null;
    out.whoopGrouped = whoopForScore;
    nextSnapshot = { connected: isConn, whoopConnected: out.whoopConnected };

    if (isConn || out.whoopConnected) {
      out.ouraGrouped = isConn ? oura : null;
      const rec = calcRecoveryScore(out.ouraGrouped, settings, out.whoopGrouped);
      out.provenance = buildSignalProvenance(rec, oura, whoopForScore, rec.scoredDay);
      const { hrv: hrvMetrics, rhr: rhrMetrics, temp: tempMetrics } = rec.detail;
      const q = calcOuraDataQuality(oura, 14);
      const b = calcMetricBaselines(oura);
      const conf = calcRecoveryConfidence(q, rec);
      const src = describeMetricSources(oura);
      const sleepMetric = rec.detail.sleep;

      // Sleep debt over the most recent recovery days, newest first.
      // Reconciled with what the wearables themselves report. Two
      // input corrections (the reporting user saw 9h+ of debt while both
      // devices said "minimal"):
      //   1. NEED is Whoop's learned personal baseline (sleep_needed
      //      .baseline_milli, median across the window — it sat at 7.6h ±0
      //      on the reference export) — never the FULL tonight-specific
      //      figure, which bundles Whoop's own debt-repayment loop and
      //      strain add-ons and swings 4.5h→9.8h day to day. Using any one
      //      day's full need as the bar for all seven nights amplified
      //      every hour of need error into ~7h of debt error: the old
      //      latest-date walk-back was a lottery (7.8h → 4.4h debt; 9.7h →
      //      16.3h debt on identical sleep).
      //   2. Naps CREDIT the slept side (main + nap hours per day). Both
      //      wearables count them toward need; a 1.4h nap on the reference
      //      export repaid nothing here. HRV/RHR baselines keep to main
      //      sleep — that rule is about signal comparability, not duration
      //      accounting.
      const sleptByDay = recoveryDates(oura)
        .map(date => {
          const main = (mainSleepDurationSeconds(oura[date]) ?? 0) / 3600;
          return main > 0 ? main + napSleepDurationSeconds(oura[date]) / 3600 : 0;
        })
        .filter(Boolean);
      const whoopBaselineNeedHours = (() => {
        try {
          const baselines = Object.keys(whoopForScore || {})
            .map((d) => Number(whoopForScore?.[d]?.sleep?.score?.sleep_needed?.baseline_milli))
            .filter((ms) => Number.isFinite(ms) && ms > 0)
            .sort((a, b) => a - b);
          if (!baselines.length) return null;
          return baselines[Math.floor(baselines.length / 2)] / 3.6e6;
        } catch { return null; }
      })();
      const sd = calcSleepDebt(sleptByDay.slice(0, 7), { needHours: whoopBaselineNeedHours, baselineSamples: sleptByDay });
      const raw = getRawRecoveryMetrics(oura, sd);

      // Compute training load from workout data (used by the recommendation
      // overlay so a green score can't green-light a load spike).
      let loadModel = null;
      if ([data, oura, whoopForScore, stravaGrouped].some(source => Object.keys(source || {}).length >= 7)) {
        const dailyLoads = buildWearableLoadRows({ entries: data || {}, ouraData: oura, whoopData: whoopForScore, stravaByDate: stravaGrouped });
        const rolling = computeRollingLoads(dailyLoads);
        loadModel = { dailyLoads, rolling, zoneInfo: getLoadZoneInfo(rolling.zone) };
        out.unloggedFlags = findUnloggedLoadDays(buildDailyLoads(data || {}, 28), whoopForScore, { window: 14, stravaByDate: stravaGrouped });
      }

      // Rec.score can now be null (no signals reported) — the honest
      // state. Legacy readiness + recommendation skip rather than grade it.
      // CalcTrainingReadiness takes TRENDS (slopes/day) — it was fed
      // today's HRV z-score and RHR delta, so its ±0.02 / ±0.5 "trend" bands
      // fired on ordinary single-day noise. Real chronological slopes now.
      const tr = rec.score == null ? null : calcTrainingReadiness(rec.score, hrvTrendSlopePerDay(oura), rhrTrendSlopePerDay(oura), null, sd.debtHours || 0);
      const wearableDebt = rec.scoredDay === latestRecoveryDay(out.ouraGrouped) ? sd : null;
      const reco = rec.score == null ? null : getTrainingRecommendation({ recovery: rec, readiness: tr, quality: q, loadZone: loadModel?.rolling?.zone, sleepDebt: wearableDebt });
      const insightRows = calcRecoveryInsights({ recovery: rec, hrv: hrvMetrics, rhr: rhrMetrics, sleep: sleepMetric, temp: tempMetrics, quality: q, baselines: b, recommendation: reco });

      const alertResult = checkAlerts(oura);
      const todayDate = latestRecoveryDay(oura);
      if (todayDate) saveAlertSnapshot(todayDate, alertResult, userId);

      // Compute 7-day recovery history for sparkline (recovery days only, so a
      // heartrate-only sync date does not plot a misleading low point).
      // Each point is now scored AS OF that morning: the engine gets
      // every day up to and including the point's date (and the matching
      // Whoop window), so leave-one-out baselines exist and the method
      // matches the headline score. The old single-day recompute had no
      // prior pool — HRV/RHR silently fell to readiness-contributor
      // fallbacks and the plotted values disagreed with what the app
      // actually said on those mornings.
      const histDates = [...new Set([...recoveryDates(out.ouraGrouped), ...Object.keys(out.whoopGrouped || {})])].sort().reverse();
      const histPoints = [];
      for (const date of histDates) {
        const ouraUpTo = {};
        for (const [d, v] of Object.entries(out.ouraGrouped || {})) { if (d <= date) ouraUpTo[d] = v; }
        const whoopUpTo = {};
        for (const [d, v] of Object.entries(out.whoopGrouped || {})) { if (d <= date) whoopUpTo[d] = v; }
        const dayRec = calcRecoveryScore(ouraUpTo, settings, whoopUpTo);
        if (dayRec.scoredDay === date && dayRec.score !== null) histPoints.push({ date, value: dayRec.score });
        if (histPoints.length === 7) break;
      }
      histPoints.reverse();

      // Morning Edition — the multi-day state over the daily score.
      // Pure classification: rolling-week HRV against the personal normal
      // range, RHR drift, load zone, sleep debt. Computed here (not render)
      // so the session cache restores it instantly on revisit.
      const trendState = classifyRecoveryState({
        ouraData: oura,
        whoopData: whoopForScore,
        sleepDebt: sd,
        loadZone: loadModel?.rolling?.zone || null,
        recoveryHistory: histPoints,
        scoreToday: rec.score,
      });
      out.editionRaw = { oura, whoop: whoopForScore }; // feeds the Sunday Edition

      nextSnapshot = {
        connected: isConn,
        whoopConnected: out.whoopConnected,
        signalDay: todayDate || null,
        loadDay: getTodayKey(),
        tokenStatus: tokenStat,
        rawMetrics: raw,
        recovery: rec,
        hrv: hrvMetrics,
        rhr: rhrMetrics,
        sleep: sleepMetric,
        temp: tempMetrics,
        sleepDebt: sd,
        readiness: tr,
        alerts: alertResult.alerts,
        alertData: alertResult,
        alertHistory: todayDate ? getAlertHistory(userId) : alertHistory,
        recoveryHistory: histPoints,
        trend: trendState,
        trainingLoad: loadModel,
        quality: q,
        baselines: b,
        confidence: conf,
        recommendation: reco,
        insights: insightRows,
        sources: src,
      };
    }

    if (data && yesterdayKey) {
      const subj = calcSubjectiveScore(data[yesterdayKey], data, yesterdayKey);
      nextSnapshot = { ...(nextSnapshot || {}), subjectiveRecovery: subj };
    }
    if (nextSnapshot) {
      writeRecoveryDashboardCache(userId, nextSnapshot);
      // Persist a display-safe copy so the next cold open hydrates instantly.
      // writeWearableSnapshot strips any secret-bearing fields defensively.
      const savedAt = Date.now();
      writeWearableSnapshot(userId, nextSnapshot, savedAt);
      out.savedAt = savedAt;
      // Best-effort DB-first snapshot so the next cold open on ANY device can
      // hydrate before a live provider refresh. Ownership is server-derived
      // from the Supabase Bearer token; token-like fields are stripped both
      // client- and server-side. Fire-and-forget: never blocks the render.
      const snapSource = nextSnapshot.recovery?.source || (nextSnapshot.subjectiveRecovery ? "manual" : null);
      postServerSnapshot(nextSnapshot, { source: snapSource }).catch(() => {});
    }
  out.snapshot = nextSnapshot || null;
  return out;
}
