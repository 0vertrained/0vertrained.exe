// src/RecoveryDashboard.jsx
// Recovery Intelligence v2 — Whitepaper system, Oura quality, confidence, and recommendation.

import { useEffect, useState, useCallback, useRef } from "react";
import {
  loadOuraData,
  calcRecoveryScore,
  calcHRVScore,
  calcRHRScore,
  calcTempScore,
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
import { calcRecoveryScore as calcSubjectiveScore } from "./recovery";
import { summarizeManualRecovery, getManualRecoveryCompleteness } from "./manualRecovery";
import { isDemoMode } from "./demoData";
import { loadStravaActivities, groupStravaByDate } from "./strava/dataLoading"; // display context · sentinel rung
import { buildDailyLoads, computeRollingLoads, getLoadZoneInfo, findUnloggedLoadDays } from "./loadModel";
import { buildSignalProvenance } from "./wearables/signalProvenance";
import { buildRecoveryChangeSummary, buildRecoveryCoachInterpretation, buildRecoveryHeroMeta } from "./recoverySummary";
import { buildRecoveryVerdict } from "./recovery/verdictResolver";
import { classifyRecoveryState } from "./wearables/recoveryTrend";
import { readCheckin, checkinSeverity } from "./checkinMorning";
import { logFunnelEvent } from "./funnel";
import { editionWindow } from "./sundayEdition";
import { SundayEdition } from "./SundayEdition";
import { resolveRecoveryContext } from "./recovery/wearableSourceResolver";
import { buildConservativeBlendContext, applyWearableConfidenceAdjustment, buildBlendExplanation } from "./recovery/conservativeBlending";
import { buildAggregatedRecoveryContext, buildConfidenceExplanation } from "./recovery/aggregationModel";
import { buildWearableReadinessQA } from "./recovery/wearableReadinessQA";
import {
  getWhoopTokenStatus,
  loadWhoopData,
  getWhoopSyncEvents,
  buildWhoopSummary,
} from "./whoop";
import { RecoveryLoading, RecoveryManual, RecoveryConnected } from "./RecoveryView";
import { readRecoveryDashboardCache, writeRecoveryDashboardCache } from "./recoveryDashboardSessionCache";
import { readWearableSnapshot, writeWearableSnapshot, describeSnapshotAge } from "./wearableSnapshotCache";
import { perfStart, perfMark } from "./perf";
import { useMediaQuery, BROADSHEET_QUERY } from "./ui/useMediaQuery";
import { fetchServerSnapshot, postServerSnapshot } from "./wearables/snapshot";
import { resolveHrvRawDisplay } from "./recovery/hrvRawDisplay";

// Raw metric parsing is deliberately delegated to the canonical Oura helpers
// (getSleepDoc / hrvRmssdWithSource / rhrValue / tempDeviation / latestRecoveryDay)
// so this UI never re-derives payload shapes that could drift from the scoring
// engine. In particular it anchors to the latest *recovery* day, not the newest
// (possibly heartrate-only) synced date, and honors Oura's hrv.items[] arrays.
const formatNum = (v, digits = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(digits) : null;
};

const durationHours = (sleep) => {
  const secs = Number(sleep?.total_sleep_duration ?? sleep?.total_sleep_time);
  return Number.isFinite(secs) && secs > 0 ? secs / 3600 : null;
};

const formatSyncFreshness = (tokenStatus) => {
  if (!tokenStatus?.lastSynced) return "last sync unknown";
  const synced = new Date(tokenStatus.lastSynced);
  if (Number.isNaN(synced.getTime())) return `${tokenStatus.syncStatus || "sync status unknown"}`;
  const mins = Math.max(0, Math.round((Date.now() - synced.getTime()) / 60000));
  const age = mins < 60 ? `${mins}m ago` : mins < 1440 ? `${Math.round(mins / 60)}h ago` : `${Math.round(mins / 1440)}d ago`;
  return `${age} · ${tokenStatus.syncStatus || "status unknown"}`;
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

export function RecoveryDashboard({ data, settings = {}, yesterdayKey, appLoaded, userId, todayKey = null, todayName = null, todayPlan = null, onOpenCheckin = null, onOpenIntegrations = null, openEdition = false, onEditionClosed = null }) {
  // Hydrate synchronously from the fastest available last-known snapshot:
  //   1) the in-memory session cache (survives tab switches this session), else
  //   2) the persisted, user-scoped, secret-free wearable snapshot (survives a
  //      reload / cold app open) so Recovery renders last-known data instantly
  //      and then refreshes quietly from the provider/API below.
  const sessionCache = readRecoveryDashboardCache(userId);
  const persistedSnapshot = sessionCache ? null : readWearableSnapshot(userId);
  const initialCache = sessionCache || persistedSnapshot;
  const [connected, setConnected] = useState(initialCache?.connected ?? false);
  const [loading, setLoading] = useState(!initialCache);
  const [refreshing, setRefreshing] = useState(Boolean(initialCache));
  // Freshness copy: when the current view came from the persisted snapshot we
  // say so subtly ("Using saved wearable snapshot · refreshing") and surface how
  // old it is, until a live fetch rewrites it.
  const [fromSavedSnapshot, setFromSavedSnapshot] = useState(Boolean(persistedSnapshot));
  const [snapshotSavedAt, setSnapshotSavedAt] = useState(persistedSnapshot?.savedAt ?? null);
  const [recovery, setRecovery] = useState(initialCache?.recovery ?? null);
  const [subjectiveRecovery, setSubjectiveRecovery] = useState(initialCache?.subjectiveRecovery ?? null);
  const [hrv, setHrv] = useState(initialCache?.hrv ?? null);
  const [rhr, setRhr] = useState(initialCache?.rhr ?? null);
  const [sleep, setSleep] = useState(initialCache?.sleep ?? null);
  const [temp, setTemp] = useState(initialCache?.temp ?? null);
  const [, setReadiness] = useState(initialCache?.readiness ?? null);
  const [sleepDebt, setSleepDebt] = useState(initialCache?.sleepDebt ?? null);
  const [alerts, setAlerts] = useState(initialCache?.alerts ?? []);
  const [rawMetrics, setRawMetrics] = useState(initialCache?.rawMetrics ?? {});
  const [quality, setQuality] = useState(initialCache?.quality ?? null);
  const [baselines, setBaselines] = useState(initialCache?.baselines ?? null);
  const [confidence, setConfidence] = useState(initialCache?.confidence ?? null);
  const [recommendation, setRecommendation] = useState(initialCache?.recommendation ?? null);
  const [insights, setInsights] = useState(initialCache?.insights ?? []);
  const [sources, setSources] = useState(initialCache?.sources ?? {});
  const isBroadsheet = useMediaQuery(BROADSHEET_QUERY); // broadsheet spread
  const [, setAlertData] = useState(initialCache?.alertData ?? null);
  const [alertHistory, setAlertHistory] = useState(initialCache?.alertHistory ?? {});
  const [recoveryHistory, setRecoveryHistory] = useState(initialCache?.recoveryHistory ?? []);
  const [trend, setTrend] = useState(initialCache?.trend ?? null); // Morning Edition state machine
  // Sunday Edition: raw grouped week data stashed by the compute
  // effect (deliberately NOT in the session cache — the effect revalidates on
  // every visit, and the masthead line simply waits for it), plus the overlay
  // toggle.
  const [editionRaw, setEditionRaw] = useState(null);
  const [showEdition, setShowEdition] = useState(false);
  const [trainingLoad, setTrainingLoad] = useState(initialCache?.trainingLoad ?? null);
  const [unloggedFlags, setUnloggedFlags] = useState([]); // F7 sentinel
  const [provenance, setProvenance] = useState(null); // signal story at the verdict
  // External cardio (Strava) — strain-side display context only. Never
  // a recovery input and never part of this dashboard's load math; it tells
  // the athlete how much outside cardio sits behind the week they're reading.
  const [externalCardio, setExternalCardio] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      if (isDemoMode() || settings?.stravaConnected !== true) return;
      const acts = await loadStravaActivities(7).catch(() => []);
      if (!alive) return;
      const runMiles = Math.round(acts.reduce((sum, a) => sum + (a.kind === "run" ? (Number(a.miles) || 0) : 0), 0) * 10) / 10;
      const minutes = Math.round(acts.reduce((sum, a) => sum + (Number(a.minutes) || 0), 0));
      setExternalCardio(acts.length ? { runMiles, minutes, count: acts.length } : null);
    })();
    return () => { alive = false; };
  }, [settings?.stravaConnected]);
  const [tokenStatus, setTokenStatus] = useState(initialCache?.tokenStatus ?? null);
  // Whoop display cards — loaded independently of the Oura recovery pipeline
  // so they never touch the recovery score, its cache, or its inputs. Display only.
  const [whoopConnected, setWhoopConnected] = useState(false);
  const [whoopSummary, setWhoopSummary] = useState(null);
  // Raw grouped maps kept only for the pure source resolver (per-metric
  // source arbitration + conflict detection). Deliberately NOT written into the
  // recovery session cache and NEVER fed into the recovery score.
  const [ouraGrouped, setOuraGrouped] = useState(null);
  const [whoopGrouped, setWhoopGrouped] = useState(null);
  // Sync events for honest empty-state explanations on the Recovery tab.
  const [whoopSyncEvents, setWhoopSyncEvents] = useState([]);
  // DB-first hydrate bookkeeping. `liveAppliedRef` flips true once a live load
  // has written real data so the (async) server-snapshot hydrate never clobbers
  // fresher live data if it happens to land second. `serverHydrateAttempted`
  // keeps the server fetch to a single attempt per mount.
  const liveAppliedRef = useRef(false);
  const serverHydrateAttempted = useRef(false);
  const hadSessionCache = Boolean(sessionCache);

  // Apply a display-safe snapshot (session/localStorage/server — all share the
  // shape written by loadData) onto the dashboard state. Setters are stable so
  // this callback never changes identity.
  const hydrateFromSnapshot = useCallback((snap) => {
    if (!snap || typeof snap !== "object") return;
    if ("connected" in snap) setConnected(snap.connected ?? false);
    if ("tokenStatus" in snap) setTokenStatus(snap.tokenStatus ?? null);
    if ("rawMetrics" in snap) setRawMetrics(snap.rawMetrics ?? {});
    if ("recovery" in snap) setRecovery(snap.recovery ?? null);
    if ("hrv" in snap) setHrv(snap.hrv ?? null);
    if ("rhr" in snap) setRhr(snap.rhr ?? null);
    if ("sleep" in snap) setSleep(snap.sleep ?? null);
    if ("temp" in snap) setTemp(snap.temp ?? null);
    if ("sleepDebt" in snap) setSleepDebt(snap.sleepDebt ?? null);
    if ("readiness" in snap) setReadiness(snap.readiness ?? null);
    if ("alerts" in snap) setAlerts(snap.alerts ?? []);
    if ("alertData" in snap) setAlertData(snap.alertData ?? null);
    if ("alertHistory" in snap) setAlertHistory(snap.alertHistory ?? {});
    if ("recoveryHistory" in snap) setRecoveryHistory(snap.recoveryHistory ?? []);
    if ("trainingLoad" in snap) setTrainingLoad(snap.trainingLoad ?? null);
    if ("quality" in snap) setQuality(snap.quality ?? null);
    if ("baselines" in snap) setBaselines(snap.baselines ?? null);
    if ("confidence" in snap) setConfidence(snap.confidence ?? null);
    if ("recommendation" in snap) setRecommendation(snap.recommendation ?? null);
    if ("insights" in snap) setInsights(snap.insights ?? []);
    if ("sources" in snap) setSources(snap.sources ?? {});
    if ("subjectiveRecovery" in snap) setSubjectiveRecovery(snap.subjectiveRecovery ?? null);
  }, []);

  const manualBody = data?.[yesterdayKey]?.body || {};
  const manualSummary = summarizeManualRecovery(manualBody);
  const manualCompleteness = getManualRecoveryCompleteness(manualBody);

  // Subtle freshness copy for the background-refresh strip. When the view was
  // hydrated from the persisted snapshot we say so and show its age; once a live
  // fetch has rewritten the cache we fall back to the plain "refreshing" note.
  const snapshotAge = describeSnapshotAge(snapshotSavedAt);
  const refreshingLabel = fromSavedSnapshot
    ? `Using saved wearable snapshot · refreshing${snapshotAge ? ` · updated ${snapshotAge}` : ""}`
    : connected
      ? "Refreshing Oura data in background…"
      : "Refreshing recovery data in background…";

  const loadData = useCallback(async () => {
    // Either the in-memory session cache or the persisted snapshot means we
    // already have last-known data on screen — refresh quietly instead of
    // dropping back to skeletons.
    const hasCachedRecovery = Boolean(readRecoveryDashboardCache(userId) || readWearableSnapshot(userId));
    if (hasCachedRecovery) setRefreshing(true);
    else setLoading(true);
    let nextSnapshot;
    try {
      perfStart("recovery"); // instrumentation — Settings → About → Diagnostics
      // One status call, fired in parallel with the data query (the query
      // needs no status — a disconnected user simply gets an empty result, at
      // the cost of one cheap indexed select). Sequential depth here: 2 → 1.
      // Whoop joins the batch as the arbitration layer's fallback
      // source. loadWhoopData is single-flighted, so this call collapses with
      // the context-panel effect's — zero additional network.
      const [tokenStat, oura, whoopForScore, stravaActs] = await Promise.all([
        getOuraTokenStatus(),
        loadOuraData(35), // 35d window feeds the trend baseline; scoring pools still slice(0,15)
        loadWhoopData(14).catch(() => null),
        loadStravaActivities(14).catch(() => []), // sentinel evidence rung
      ]);
      const stravaGrouped = groupStravaByDate(stravaActs || []);
      perfMark("recovery", "oura-ready");
      const isConn = Boolean(tokenStat?.connected);
      setConnected(isConn);
      setTokenStatus(isConn ? tokenStat : null);
      nextSnapshot = { connected: isConn };

      if (isConn) {
        setOuraGrouped(oura);
        const rec = calcRecoveryScore(oura, settings, whoopForScore);
        setProvenance(buildSignalProvenance(rec, oura, whoopForScore, rec.scoredDay));
        const hrvMetrics = calcHRVScore(oura, settings);
        const rhrMetrics = calcRHRScore(oura);
        const tempMetrics = calcTempScore(oura);
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
        if (data && Object.keys(data).length >= 7) {
          const dailyLoads = buildDailyLoads(data, 28);
          const rolling = computeRollingLoads(dailyLoads);
          loadModel = { dailyLoads, rolling, zoneInfo: getLoadZoneInfo(rolling.zone) };
          setUnloggedFlags(findUnloggedLoadDays(dailyLoads, whoopForScore, { window: 14, stravaByDate: stravaGrouped }));
        }

        // Rec.score can now be null (no signals reported) — the honest
        // state. Legacy readiness + recommendation skip rather than grade it.
        // CalcTrainingReadiness takes TRENDS (slopes/day) — it was fed
        // today's HRV z-score and RHR delta, so its ±0.02 / ±0.5 "trend" bands
        // fired on ordinary single-day noise. Real chronological slopes now.
        const tr = rec.score == null ? null : calcTrainingReadiness(rec.score, hrvTrendSlopePerDay(oura), rhrTrendSlopePerDay(oura), null, sd.debtHours || 0);
        const reco = rec.score == null ? null : getTrainingRecommendation({ recovery: rec, readiness: tr, quality: q, loadZone: loadModel?.rolling?.zone, sleepDebt: sd });
        const insightRows = calcRecoveryInsights({ recovery: rec, hrv: hrvMetrics, rhr: rhrMetrics, sleep: sleepMetric, temp: tempMetrics, quality: q, baselines: b, recommendation: reco });

        setRawMetrics(raw);
        setRecovery(rec);
        setHrv(hrvMetrics);
        setRhr(rhrMetrics);
        setSleep(sleepMetric);
        setTemp(tempMetrics);
        setSleepDebt(sd);
        setReadiness(tr);
        const alertResult = checkAlerts(oura);
        setAlerts(alertResult.alerts);
        setAlertData(alertResult);
        const todayDate = latestRecoveryDay(oura);
        if (todayDate) {
          saveAlertSnapshot(todayDate, alertResult, userId);
          setAlertHistory(getAlertHistory(userId));
        }

        // Compute 7-day recovery history for sparkline (recovery days only, so a
        // heartrate-only sync date does not plot a misleading low point).
        // Each point is now scored AS OF that morning: the engine gets
        // every day up to and including the point's date (and the matching
        // Whoop window), so leave-one-out baselines exist and the method
        // matches the headline score. The old single-day recompute had no
        // prior pool — HRV/RHR silently fell to readiness-contributor
        // fallbacks and the plotted values disagreed with what the app
        // actually said on those mornings.
        const histDates = recoveryDates(oura).slice(0, 7);
        const histPoints = histDates.map(date => {
          const ouraUpTo = {};
          for (const [d, v] of Object.entries(oura)) { if (d <= date) ouraUpTo[d] = v; }
          const whoopUpTo = {};
          for (const [d, v] of Object.entries(whoopForScore || {})) { if (d <= date) whoopUpTo[d] = v; }
          const dayRec = calcRecoveryScore(ouraUpTo, settings, whoopUpTo);
          return { date, value: dayRec?.score || 0 };
        }).reverse();
        setRecoveryHistory(histPoints);

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
        setTrend(trendState);
        setEditionRaw({ oura, whoop: whoopForScore }); // feeds the Sunday Edition

        setTrainingLoad(loadModel);
        setQuality(q);
        setBaselines(b);
        setConfidence(conf);
        setRecommendation(reco);
        setInsights(insightRows);
        setSources(src);
        nextSnapshot = {
          connected: true,
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
        const subj = calcSubjectiveScore(data[yesterdayKey], data);
        setSubjectiveRecovery(subj);
        nextSnapshot = { ...(nextSnapshot || {}), subjectiveRecovery: subj };
      }
      if (nextSnapshot) {
        writeRecoveryDashboardCache(userId, nextSnapshot);
        // Persist a display-safe copy so the next cold open hydrates instantly.
        // writeWearableSnapshot strips any secret-bearing fields defensively.
        const savedAt = Date.now();
        writeWearableSnapshot(userId, nextSnapshot, savedAt);
        setSnapshotSavedAt(savedAt);
        setFromSavedSnapshot(false);
        // Live data now owns the view — the async server-snapshot hydrate below
        // must not overwrite it if it lands late.
        liveAppliedRef.current = true;
        // Best-effort DB-first snapshot so the next cold open on ANY device can
        // hydrate before a live provider refresh. Ownership is server-derived
        // from the Supabase Bearer token; token-like fields are stripped both
        // client- and server-side. Fire-and-forget: never blocks the render.
        const snapSource = isConn ? "oura" : (nextSnapshot.subjectiveRecovery ? "manual" : null);
        postServerSnapshot(nextSnapshot, { source: snapSource }).catch(() => {});
      }
    } catch (e) {
      console.error("Recovery dashboard load error:", e);
    } finally {
      perfMark("recovery", "verdict-ready");
      logFunnelEvent("first_verdict_rendered"); // funnel terminus; once per session, once per user in the table
      setLoading(false);
      setRefreshing(false);
    }
  }, [data, yesterdayKey, settings, userId]);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 60000);
    return () => clearInterval(interval);
  }, [loadData]);

  // DB-first hydrate (third tier). When there was no in-memory session cache we
  // may be starting cold or from the localStorage snapshot; fetch the server's
  // display-safe snapshot once and, if it arrives before live data lands, render
  // it and label it subtly ("Using saved wearable snapshot") until loadData's
  // live fetch rewrites the view. Never overwrites live data (liveAppliedRef).
  useEffect(() => {
    if (hadSessionCache) return; // session cache already the freshest local tier
    if (serverHydrateAttempted.current) return;
    serverHydrateAttempted.current = true;
    let alive = true;
    (async () => {
      const result = await fetchServerSnapshot();
      if (!alive || liveAppliedRef.current) return;
      if (!result?.hasSnapshot || !result.snapshot) return;
      hydrateFromSnapshot(result.snapshot);
      const ts = result.updatedAt ? Date.parse(result.updatedAt) : NaN;
      setSnapshotSavedAt(Number.isFinite(ts) ? ts : null);
      setFromSavedSnapshot(true);
      setLoading(false);
      setRefreshing(true);
    })();
    return () => { alive = false; };
  }, [userId, hadSessionCache, hydrateFromSnapshot]);

  // Load Whoop presence + a display-only summary of the latest day. This
  // is intentionally separate from loadData so Whoop can never influence the
  // recovery score, its confidence, or its cache. Cards render only when Whoop is
  // connected; the summary is null until data lands.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // One parallel batch instead of a status pre-check gating the
        // data fetch. isWhoopConnected duplicated getWhoopTokenStatus's answer;
        // for a disconnected user the extra queries return empty and are
        // ignored — cheaper than serializing every connected user's load.
        const [whoopStat, grouped, eventsRes] = await Promise.all([
          getWhoopTokenStatus().catch(() => null),
          loadWhoopData(14).catch(() => ({})),
          getWhoopSyncEvents(20).catch(() => ({ events: [] })),
        ]);
        if (!alive) return;
        const conn = Boolean(whoopStat?.connected);
        setWhoopConnected(conn);
        perfMark("recovery", "whoop-ready");
        if (conn) {
          setWhoopSummary(buildWhoopSummary(grouped));
          setWhoopGrouped(grouped);
          setWhoopSyncEvents(eventsRes?.events || []);
        } else {
          setWhoopSummary(null);
          setWhoopGrouped(null);
          setWhoopSyncEvents([]);
        }
      } catch (e) {
        console.error("Whoop display load error:", e);
      }
    })();
    return () => { alive = false; };
  }, [userId]);

  if (loading) return <RecoveryLoading />;

  const whoop = { connected: whoopConnected, summary: whoopSummary, syncEvents: whoopSyncEvents };
  const shared = {
    refreshingLabel: refreshing ? refreshingLabel : null,
    demo: isDemoMode(),
    isBroadsheet, onOpenCheckin, onOpenIntegrations,
    subjectiveRecovery, manualSummary, manualCompleteness, whoop,
  };

  if (!connected) {
    return (
      <RecoveryManual
        view={{
          ...shared,
          interpretation: buildRecoveryCoachInterpretation({ connected: false, subjectiveRecovery, manualCompleteness }),
          // Manual-only reads as a complete, confident setup here, never as broken.
          qa: buildWearableReadinessQA({ ouraConnected: connected, whoopConnected, events: whoopSyncEvents, conflicts: [], now: new Date() }),
        }}
      />
    );
  }

  const heroMeta = buildRecoveryHeroMeta({ connected, confidence, quality, tokenStatus });
  const changeSummary = buildRecoveryChangeSummary({ hrv, rhr, sleep, temp, sleepDebt, trainingLoad, alerts, quality });

  // When both wearables are connected, resolve per-metric sources and
  // surface conflicts + a source disclosure. This is display-only: the recovery
  // score above is unchanged, Whoop cards stay display-only, and sources are
  // never averaged. Falls back to null (no extra UI) when Whoop is absent.
  const resolvedContext = (whoopConnected && ouraGrouped)
    ? resolveRecoveryContext({ ouraData: ouraGrouped, whoopData: whoopGrouped, manualData: manualBody, settings })
    : null;
  const wearableConflicts = resolvedContext?.conflicts || [];
  const blendContext = resolvedContext
    ? buildConservativeBlendContext({ resolvedContext, recovery, trainingLoad, recommendation })
    : null;
  const blendedRecommendation = blendContext?.applicable
    ? applyWearableConfidenceAdjustment({ recommendation, resolvedContext, blendContext })
    : recommendation;
  const blendExplanation = buildBlendExplanation(blendContext);

  // Slice C — resolve readiness + limiters into EXACTLY ONE top-level
  // instruction before anything reaches the screen. The resolver runs on the
  // post-blend recommendation, and every downstream echo (coach interpretation
  // guidance, readiness-hero caption, readiness row) reads the RESOLVED
  // recommendation, so no surface can contradict the verdict. Raw values,
  // sources, and confidence labels are untouched below.
  // The check-in is entered on Today; Recovery reads it off today's entry
  // body and shows it above the verdict.
  const todayBody = (todayKey && data?.[todayKey]?.body) || {};
  const checkin = readCheckin(todayBody);
  const checkinCaution = { severity: checkinSeverity(checkin), flags: checkin.flags };

  const verdict = recovery
    ? buildRecoveryVerdict({ recommendation: blendedRecommendation, recovery, sleepDebt, alerts, trainingLoad, confidence, checkin: checkinCaution })
    : null;
  const resolvedRecommendation = verdict ? verdict.recommendation : blendedRecommendation;
  const coachInterp = buildRecoveryCoachInterpretation({
    recovery, recommendation: resolvedRecommendation, insights, sleepDebt, trainingLoad, alerts,
    confidence, quality, connected, subjectiveRecovery, manualCompleteness,
  });
  // Full aggregated context (enrichment layer). Adds aggregated
  // confidence, Whoop recovery delta, and strain context to the display.
  const aggregatedContext = (whoopConnected && ouraGrouped)
    ? buildAggregatedRecoveryContext({
        ouraData: ouraGrouped, whoopData: whoopGrouped, manualData: manualBody,
        recovery, trainingLoad, settings, recommendation,
      })
    : null;
  const confidenceExplanation = aggregatedContext ? buildConfidenceExplanation(aggregatedContext) : null;

  // Broadsheet spread. Each figure block below is the
  // The dashboard's blocks as consts, so the two shells can compose the same
  // blocks differently: mobile keeps the single reading order; the broadsheet
  // arranges verdict + interpretation (left) · biometric plates + load + alert
  // history (center) · signals + QA + data trust (right).

  return (
    <>
      {/* Asked for from Today or Progress, the edition opens as soon as its week is loaded. */}
      {(showEdition || openEdition) && editionRaw && (
        <SundayEdition data={data} ouraData={editionRaw.oura} whoopData={editionRaw.whoop} settings={settings} onClose={() => { setShowEdition(false); onEditionClosed?.(); }} />
      )}
      <RecoveryConnected
        view={{
          ...shared,
          data, todayKey, todayName, todayPlan, todayBody, checkin,
          verdict, recovery, trend, provenance, changeSummary, coachInterp,
          alerts, conflicts: wearableConflicts,
          recoveryHistory, hrv, rhr, sleep, temp, rawMetrics, sources, baselines, sleepDebt,
          trainingLoad, externalCardio, unloggedFlags,
          // The weekly edition appears on Sunday night, above the call.
          edition: { available: Boolean(editionWindow(new Date()).available && editionRaw), onOpen: () => setShowEdition(true) },
          reconnect: Boolean(tokenStatus?.isExpired),
          firstSync: settings?.ouraConnected === true,
          connected, manualOn: Boolean(manualSummary || subjectiveRecovery),
          qa: buildWearableReadinessQA({ ouraConnected: connected, whoopConnected, events: whoopSyncEvents, conflicts: wearableConflicts, now: new Date() }),
          blendExplanation, confidenceExplanation, aggregatedContext,
          heroMeta, syncFreshness: formatSyncFreshness(tokenStatus), tokenStatus, quality, confidence,
          blendedRecommendation, resolvedRecommendation, alertHistory,
        }}
      />
    </>
  );
}

export default RecoveryDashboard;
