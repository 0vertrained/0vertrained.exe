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
import { FigureSection, LeadMetric, RuledScale, MetricFigure, MethodNote, MethodLine, RuledRow, StatusStamp, AlertCard, AlertHistory, Sparkline, SkeletonBlock, SkeletonMetricFigure } from "./whitepaper";
import { buildRecoveryChangeSummary, buildRecoveryCoachInterpretation, buildRecoveryHeroMeta } from "./recoverySummary";
import { buildRecoveryVerdict } from "./recovery/verdictResolver";
import { classifyRecoveryState } from "./wearables/recoveryTrend";
import { CHECKIN_ROWS, readCheckin, checkinSeverity, checkinEvidenceLine, divergenceNote, selectedOption } from "./checkinMorning";
import { buildMuscleRecency } from "./muscleVolume";
import { logFunnelEvent } from "./funnel";
import { editionWindow } from "./sundayEdition";
import { SundayEdition } from "./SundayEdition";
import { Stamp, LimiterRule, AdvisoryNote } from "./ui/primitives";
import { resolveRecoveryContext } from "./recovery/wearableSourceResolver";
import { buildConservativeBlendContext, applyWearableConfidenceAdjustment, buildBlendExplanation } from "./recovery/conservativeBlending";
import { buildAggregatedRecoveryContext, buildConfidenceExplanation } from "./recovery/aggregationModel";
import { buildEmptyStateExplanation } from "./recovery/wearableSyncEvents";
import { buildWearableReadinessQA } from "./recovery/wearableReadinessQA";
import {
  getWhoopTokenStatus,
  loadWhoopData,
  getWhoopSyncEvents,
  buildWhoopSummary,
  WhoopRecoveryCard,
  WhoopSleepCard,
  WhoopStrainCard,
  WhoopSourceSummary,
} from "./whoop";
import { useTheme } from "./theme";
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

// Settings → Integrations, in the app. These were href="/settings"
// links: a full page load that came back up on Today. The link stays as the
// fallback when no shell action is passed (the app also reads /settings on
// boot now).
function SettingsLink({ label, onOpen }) {
  const { S } = useTheme();
  if (onOpen) {
    return <button type="button" onClick={onOpen} style={{ ...S.foodBtn, display: "block", textAlign: "center" }}>{label}</button>;
  }
  return <a href="/settings" style={{ ...S.foodBtn, display: "block", textAlign: "center", textDecoration: "none" }}>{label}</a>;
}

// Compact, display-only wearable readiness status. Explains what the
// athlete's wearables (or manual-only setup) are showing and why — it never
// changes the recovery score or re-derives any data. Manual-only is a valid,
// confident state here, so it reads as complete rather than broken.
// When everything is healthy this collapses to a single status line —
// the full explanation renders automatically only when the tone signals a
// problem (warning/caution) or the wearables disagree, and is otherwise one
// tap away. No content removed; only the default prominence changed.
function WearableReadinessQASection({ qa }) {
  const { S, C } = useTheme();
  const [expanded, setExpanded] = useState(false);
  if (!qa) return null;
  const toneColor = (t) =>
    t === "warning" ? C.red : t === "good" ? C.green : t === "caution" ? C.textDim : C.textFaint;
  const rightLabel = qa.manual ? "manual" : qa.mode === "dual" ? "oura + whoop" : qa.mode;
  const needsAttention = qa.tone === "warning" || qa.tone === "caution" || qa.mixedSignal;

  if (!needsAttention && !expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        aria-expanded={false}
        style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "11px 16px", background: C.block, border: "none", borderBottom: `1px solid ${C.line}`, cursor: "pointer", fontFamily: C.fontFamily, textAlign: "left" }}
      >
        <span style={{ fontSize: 11, color: C.textDim, letterSpacing: "0.1em", textTransform: "uppercase" }}>
          Sources · {rightLabel}
        </span>
        <span style={{ fontSize: 11, color: toneColor(qa.tone), letterSpacing: "0.04em", display: "flex", alignItems: "center", gap: 8 }}>
          {qa.title}
          <span style={{ color: C.textFaint }} aria-hidden="true">▾</span>
        </span>
      </button>
    );
  }

  return (
    <FigureSection title="Wearable readiness check" right={<StatusStamp>{rightLabel}</StatusStamp>}>
      <div style={{ fontSize: 12, color: C.text, fontWeight: 600, marginBottom: 4 }}>{qa.title}</div>
      <div style={{ fontSize: 11.5, color: toneColor(qa.tone), lineHeight: 1.6, marginBottom: qa.sources?.length ? 8 : 0 }}>
        {qa.body}
      </div>
      {qa.sources && qa.sources.length > 0 && qa.sources.map((s) => (
        <RuledRow key={s.source} label={s.sourceLabel} value={s.title} emphasis={s.tone === "warning" || s.tone === "caution"} />
      ))}
      {qa.mixedSignal && (
        <div style={{ fontSize: 11, color: C.textFaint, lineHeight: 1.55, marginTop: 8 }}>
          Oura and Whoop are never averaged — the day's read stays conservative.
        </div>
      )}
      {!needsAttention && (
        <button type="button" onClick={() => setExpanded(false)} style={{ ...S.smallBtn, marginTop: 10, fontSize: 10, padding: "4px 10px" }}>
          ▲ collapse
        </button>
      )}
      <MethodNote>Display only — this explains what your wearables are showing and never changes the recovery score.</MethodNote>
    </FigureSection>
  );
}

// Readiness "method" disclosure toggle. Restrained, whitepaper-consistent ghost
// control, but a proper accessible disclosure: real button, descriptive
// aria-label, aria-expanded reflecting the panel state, and a 44px usable
// target. Display-only — toggling it never touches the recovery score.
export function ReadinessMethodToggle({ open, onToggle }) {
  const { S, C } = useTheme();
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={open ? "Hide readiness scoring method" : "Show how readiness is scored"}
      style={{
        ...S.smallBtn,
        float: "right",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        minWidth: 44,
        minHeight: 44,
        padding: "0 12px",
        fontSize: 10,
        marginTop: -6,
      }}
    >
      <span aria-hidden="true" style={{ fontFamily: C.fontFamily, fontSize: 11.5, opacity: 0.65 }}>ⓘ</span>
      {open ? "Hide method" : "Method"}
    </button>
  );
}

export function RecoveryDashboard({ data, settings = {}, yesterdayKey, appLoaded, userId, todayKey = null, todayName = null, updateToday = null, onOpenIntegrations = null }) {
  const { S, C } = useTheme();
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
  const [explanationOpen, setExplanationOpen] = useState(false);
  // Dense transparency sections (component ledger, data quality, training
  // load, alert history, context) collapse behind one disclosure so the default
  // Recovery view leads with daily coaching. Nothing is removed.
  const [techOpen, setTechOpen] = useState(false);
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

  // During loading, show stable skeleton placeholders rather than blank tab
  if (loading) {
    // If app data itself is still loading, show a simpler indicator
    if (!appLoaded) {
      // Stable multi-row shell so Recovery never appears as a single thin row that
      // snaps into the full readiness hierarchy. Mirrors the loaded section order.
      const shellRows = [
        "Loading readiness…",
        "Loading what changed…",
        "Loading coach interpretation…",
        "Loading component ledger…",
      ];
      return (
        <div>
          {shellRows.map((rowLabel, i) => (
            <div key={rowLabel} style={{ padding: "14px 16px", borderBottom: `1px solid ${C.line}`, background: C.block, display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 8, height: 8, borderRadius: 0, background: C.text, animation: "pulse 1.2s infinite", animationDelay: `${i * 0.15}s` }} />
              <span style={{ fontSize: 11, color: C.textDim, letterSpacing: "0.12em", textTransform: "uppercase" }}>{rowLabel}</span>
            </div>
          ))}
        </div>
      );
    }
    
    // App data is loaded but Recovery is still fetching Oura/calculating - show premium placeholders
    return (
      <div>
        <SkeletonBlock />
        <SkeletonBlock />
        <SkeletonBlock />
        {[1, 2, 3, 4].map(i => (
          <FigureSection key={`skeleton-metrics-${i}`} n={i} title="▪ ▪ ▪ ▪">
            <SkeletonMetricFigure />
            <SkeletonMetricFigure />
          </FigureSection>
        ))}
      </div>
    );
  }

  if (!connected) {
    // Manual-only view. Same "Readiness + Explanation" concept as the connected
    // view, but manual check-in is the primary/first-class signal — never framed
    // as degraded. Oura adds biometrics only when connected.
    const manualInterp = buildRecoveryCoachInterpretation({
      connected: false,
      subjectiveRecovery,
      manualCompleteness,
    });
    const loggedInputRows = manualSummary ? manualSummary.split(" · ") : [];
    return (
      <div style={isBroadsheet ? { maxWidth: "var(--ovt-content-width)", margin: "0 auto", width: "100%" } : undefined}>
        {refreshing && (
          <div style={{ padding: "6px 16px", borderBottom: `1px solid ${C.line}`, background: C.block, fontSize: 10, color: C.textFaint, letterSpacing: "0.12em", textTransform: "uppercase" }}>
            {refreshingLabel}
          </div>
        )}
        {isDemoMode() && (
          <FigureSection title="Demo mode" right="synthetic data">
            <div style={{ fontSize: 13, color: C.textDim, lineHeight: 1.6 }}>This view is using synthetic local data. No Supabase or Oura writes are performed.</div>
          </FigureSection>
        )}

        {/* Wearable readiness check — manual-only reads as a complete,
            confident setup here, never as broken. Display only. */}
        <WearableReadinessQASection
          qa={buildWearableReadinessQA({
            ouraConnected: connected,
            whoopConnected,
            events: whoopSyncEvents,
            conflicts: [],
            now: new Date(),
          })}
        />

        {/* 1 · Manual Readiness Hero */}
        <FigureSection title="Manual readiness" right={<StatusStamp>manual · first-class</StatusStamp>}>
          <div style={{ fontFamily: S.fontSerif, fontSize: 22, color: C.text, lineHeight: 1.1, marginBottom: 8 }}>Manual check-in is primary.</div>
          {subjectiveRecovery ? (
            <>
              <LeadMetric
                value={subjectiveRecovery.score}
                unit="/100"
                caption={subjectiveRecovery.read}
                note="manual check-in · Oura adds biometrics when connected"
              />
              <RuledScale value={subjectiveRecovery.score} max={100} />
            </>
          ) : (
            <p style={{ fontSize: 13, color: C.textDim, lineHeight: 1.65 }}>
              Log today's check-in to see a readiness score. Manual recovery is first-class: sleep, sleep quality, soreness, stress, motivation, and illness/injury flags create the baseline.
            </p>
          )}
          <RuledRow label="Source" value="Manual check-in" />
        </FigureSection>

        {/* 2 · What changed / logged inputs */}
        <FigureSection title="Logged inputs" right={loggedInputRows.length ? `${manualCompleteness.filled} logged` : "none yet"}>
          {loggedInputRows.length ? (
            loggedInputRows.map((part, i) => {
              const emphasize = /illness|injury/i.test(part);
              return <RuledRow key={i} label={`input ${i + 1}`} value={part} emphasis={emphasize} />;
            })
          ) : (
            <div style={{ fontSize: 13, color: C.textDim, lineHeight: 1.6 }}>No manual inputs logged yet today. Open your check-in to record sleep, stress, soreness, and motivation.</div>
          )}
        </FigureSection>

        {/* 3 · Coach interpretation / confidence */}
        <FigureSection title="Coach interpretation" right="manual read">
          <div style={{ fontFamily: S.fontSerif, fontSize: 18, color: C.text, lineHeight: 1.25, marginBottom: 8 }}>{manualInterp.cluster}</div>
          <p style={{ fontSize: 13, color: C.textDim, lineHeight: 1.65, marginBottom: manualInterp.guidance ? 8 : 0 }}>{manualInterp.body}</p>
          {manualInterp.guidance && <p style={{ fontSize: 13, color: C.text, lineHeight: 1.6, fontStyle: "italic", margin: 0 }}>{manualInterp.guidance}</p>}
          {manualInterp.confidenceNote && (
            <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${C.line}`, fontSize: 11.5, color: C.textFaint, lineHeight: 1.55 }}>{manualInterp.confidenceNote}</div>
          )}
        </FigureSection>

        {/* 4 · Manual input depth + settings */}
        <FigureSection title="Input depth + settings" right={`${manualCompleteness.filled}/${manualCompleteness.total}`}>
          <RuledRow label="Input depth" value={`${manualCompleteness.filled}/${manualCompleteness.total} recovery fields`} />
          {subjectiveRecovery && <RuledRow label="Manual score" value={`${subjectiveRecovery.score}/100 · ${subjectiveRecovery.read}`} />}
          <div style={{ fontSize: 11.5, color: C.textFaint, lineHeight: 1.55, marginTop: 8 }}>
            HRV/RHR are treated as context until a personal baseline exists. Convenient numbers are not a baseline. Annoying, but correct.
          </div>
          <SettingsLink label="Open Settings" onOpen={onOpenIntegrations} />
        </FigureSection>

        {/* Whoop context also surfaces when Oura is not connected but Whoop is.
            Display only — manual check-in stays the first-class recovery signal. */}
        {whoopConnected && (
          <>
            <WhoopSourceSummary
              ouraConnected={connected}
              whoopConnected={whoopConnected}
              manual={!!(manualSummary || subjectiveRecovery)}
            />
            <FigureSection title="Wearable context · Whoop" right="display only">
              <div style={{ fontSize: 11.5, color: C.textFaint, lineHeight: 1.55, marginBottom: 4 }}>
                Reference context from Whoop. Shown for awareness only — it does not
                change the recovery score or training recommendation. Source: Whoop.
              </div>
              {whoopSummary ? (
                <>
                  <WhoopRecoveryCard recovery={whoopSummary.recovery} date={whoopSummary.date} />
                  <WhoopSleepCard sleep={whoopSummary.sleep} date={whoopSummary.date} />
                  <WhoopStrainCard cycle={whoopSummary.cycle} workouts={whoopSummary.workouts} date={whoopSummary.date} />
                </>
              ) : (() => {
                const exp = buildEmptyStateExplanation({ events: whoopSyncEvents, source: "whoop", connected: whoopConnected });
                const toneColor = exp.tone === "warning" ? C.red : exp.tone === "caution" ? C.textDim : exp.tone === "good" ? C.green : C.textFaint;
                return (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 12, color: C.text, fontWeight: 600, marginBottom: 4 }}>{exp.title}</div>
                    <div style={{ fontSize: 11.5, color: toneColor, lineHeight: 1.6 }}>{exp.body}</div>
                  </div>
                );
              })()}
            </FigureSection>
          </>
        )}
      </div>
    );
  }

  // Display-only summaries. These reshape metrics already computed above
  // into a coaching-first hierarchy; they never re-score or re-derive payloads.
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
  // Morning check-in reads live off today's entry body (the same
  // fields TodayTab writes), so a tap here or a number there stay one truth.
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
  const mixedSignal = wearableConflicts.length > 0;

  // Broadsheet spread. Each figure block below is the
  // The dashboard's blocks as consts, so the two shells can compose the same
  // blocks differently: mobile keeps the single reading order; the broadsheet
  // arranges verdict + interpretation (left) · biometric plates + load + alert
  // history (center) · signals + QA + data trust (right).
  const blkSliceC = (<>
      {/* Slice C — the ONE verdict. Stamp carries the resolved call, the
          headline states the action, and the most severe limiter renders as a
          double-rule clause INSIDE the verdict instead of a competing block
          further down. Everything below is evidence, not a second opinion. */}
      {/* The Sunday Edition masthead line — Sunday 5pm through Monday
          night, above the verdict. One line, no new nav; tap opens the weekly
          broadsheet overlay. */}
      {editionWindow(new Date()).available && editionRaw && (
        <button
          type="button"
          data-testid="sunday-edition-line"
          onClick={() => setShowEdition(true)}
          style={{ width: "100%", textAlign: "left", cursor: "pointer", background: C.panel, border: "none", borderTop: `1px solid ${C.text}`, borderBottom: `1px solid ${C.line}`, padding: "10px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}
        >
          <span style={{ fontFamily: S.fontAnnot, fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color: C.text, fontWeight: 600 }}>
            The Sunday Edition is out
          </span>
          <span style={{ fontFamily: C.monoFamily, fontSize: 11, color: C.textDim }}>read it →</span>
        </button>
      )}
      {showEdition && editionRaw && (
        <SundayEdition data={data} ouraData={editionRaw.oura} whoopData={editionRaw.whoop} settings={settings} onClose={() => setShowEdition(false)} />
      )}

      {verdict && (() => {
        // ── Morning Edition ─────────────────────────────────────────
        // One block, newspaper anatomy: check-in (above the verdict, so you
        // rate how you feel before the number can tell you) → state headline →
        // action → evidence deck → context → explainer. All additions live
        // INSIDE the existing verdict plate; nothing on the page moves.
        const stateTone = trend?.state?.tone || "steady";
        const stateName = trend?.state?.name || null;
        const calibrating = trend?.state?.key === "calibrating";
        const deltaInfo = trend?.delta || null;
        const provisional = updateToday && todayKey && !checkin.complete;
        const evidenceLines = [
          ...(trend?.evidence || []).slice(0, 2),
          ...(checkinEvidenceLine(checkin) ? [checkinEvidenceLine(checkin)] : []),
        ];
        const diverge = divergenceNote(checkin, recovery?.score);
        const recency = todayKey ? buildMuscleRecency(data, todayKey) : null;
        const loaded = (recency || []).filter((m) => m.daysSinceAny !== null && m.daysSinceAny <= 1).slice(0, 3);
        const contextLine = [
          todayName ? `Scheduled: ${todayName}.` : null,
          loaded.length ? `Recently loaded: ${loaded.map((m) => `${m.label} (${m.daysSinceAny === 0 ? "today" : "1d"})`).join(", ")}.` : null,
        ].filter(Boolean).join(" ");
        const stateWeight = stateTone === "act" ? 700 : stateTone === "watch" ? 600 : 500;
        const stateInk = provisional || calibrating ? C.textDim : C.text;
        const tapBtn = (selected) => ({
          fontFamily: C.monoFamily, fontSize: 10.5, letterSpacing: "0.06em",
          padding: "4px 10px", cursor: "pointer", borderRadius: 0,
          border: `1px solid ${selected ? C.text : C.line}`,
          background: selected ? C.text : "transparent",
          color: selected ? C.panel : C.textDim,
        });
        return (
        <section style={{ ...S.block, paddingTop: 18, paddingBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <span style={{ fontFamily: S.fontAnnot, fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: C.textFaint }}>
              Recovery · {new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "2-digit" })}
            </span>
            <Stamp>{verdict.stamp}</Stamp>
          </div>

          {/* Check-in first: four tap rows on the existing 1–10 fields. Never
              required, never blocking — the verdict below resolves either way. */}
          {updateToday && todayKey && (
            <div style={{ marginBottom: 14, borderTop: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}`, padding: "8px 0" }}>
              {CHECKIN_ROWS.map((row) => {
                const sel = selectedOption(row, todayBody?.[row.field]);
                return (
                  <div key={row.field} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "3px 0" }}>
                    <span style={{ fontFamily: C.monoFamily, fontSize: 10.5, letterSpacing: "0.14em", color: C.textFaint, width: 62 }}>{row.label}</span>
                    <div style={{ display: "flex", gap: 6 }}>
                      {row.options.map((opt) => (
                        <button key={opt.value} type="button" style={tapBtn(sel?.value === opt.value)}
                          aria-pressed={sel?.value === opt.value}
                          onClick={() => updateToday(`body.${row.field}`, String(opt.value))}>
                          {opt.text}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* State × trajectory. The score never hides; the arrow only appears
              when the move clears your own noise band — otherwise "steady". */}
          {stateName && (
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
              <span style={{ fontFamily: C.monoFamily, fontSize: 13, fontWeight: stateWeight, letterSpacing: "0.16em", textTransform: "uppercase", color: stateInk }}>
                {stateName}
              </span>
              {!calibrating && Number.isFinite(Number(recovery?.score)) && (
                <span style={{ fontFamily: C.monoFamily, fontSize: 12, color: C.textDim }}>
                  {Math.round(recovery.score)} {deltaInfo?.arrow || "→"} <span style={{ color: C.textFaint }}>{deltaInfo?.label || "steady"}</span>
                </span>
              )}
              {provisional && (
                <span style={{ fontFamily: S.fontAnnot, fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: C.textFaint }}>
                  · before check-in
                </span>
              )}
              {trend?.early && !calibrating && (
                <span style={{ fontFamily: S.fontAnnot, fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: C.textFaint }}>
                  · baseline forming
                </span>
              )}
            </div>
          )}

          <div style={{ fontFamily: S.fontSerif, fontSize: 26, fontWeight: 500, lineHeight: 1.12, letterSpacing: "-0.02em", color: C.text, marginBottom: 8 }}>
            {verdict.headline}
          </div>

          {/* Evidence deck: the trend's plain-language reasons (plus what you
              reported), replacing score-restating copy. Falls back to the
              resolver's deck when the trend layer has nothing to say. */}
          {(evidenceLines.length ? evidenceLines : (verdict.deck ? [verdict.deck] : [])).length > 0 && (
            <div style={{ fontFamily: S.fontSerif, fontStyle: "italic", fontSize: 14, color: C.textDim, lineHeight: 1.45, marginBottom: 8 }}>
              {(evidenceLines.length ? evidenceLines : [verdict.deck]).join(" ")}
            </div>
          )}

          {contextLine && (
            <div style={{ fontFamily: S.fontAnnot, fontSize: 11.5, letterSpacing: "0.02em", color: C.textFaint, marginBottom: verdict.limiter || diverge ? 10 : 0 }}>
              {contextLine}
            </div>
          )}

          {diverge && (
            <div style={{ fontFamily: S.fontSerif, fontStyle: "italic", fontSize: 13, color: C.textDim, lineHeight: 1.5, borderLeft: `2px solid ${C.line}`, paddingLeft: 10, marginBottom: verdict.limiter ? 12 : 0 }}>
              {diverge}
            </div>
          )}

          {verdict.limiter && <LimiterRule label={verdict.limiter.label}>{verdict.limiter.detail}</LimiterRule>}

          {/* One tap to full comprehension. Plain answers to what/why/what-now;
              the only place technical vocabulary is allowed to appear. */}
          {trend?.meaning && (
            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: "pointer", fontFamily: S.fontAnnot, fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: C.textFaint, listStyle: "none" }}>
                What does this mean? +
              </summary>
              <div style={{ marginTop: 8, fontSize: 12.5, color: C.textDim, lineHeight: 1.65 }}>
                <div style={{ marginBottom: 6 }}><span style={{ fontFamily: C.monoFamily, fontSize: 10, letterSpacing: "0.12em", color: C.textFaint }}>WHAT · </span>{trend.meaning.what}</div>
                <div style={{ marginBottom: 6 }}><span style={{ fontFamily: C.monoFamily, fontSize: 10, letterSpacing: "0.12em", color: C.textFaint }}>WHY · </span>{trend.meaning.why}</div>
                <div style={{ marginBottom: 6 }}><span style={{ fontFamily: C.monoFamily, fontSize: 10, letterSpacing: "0.12em", color: C.textFaint }}>NOW · </span>{trend.meaning.action}</div>
                <div style={{ color: C.textFaint }}>"Your normal range" is the week's HRV average measured against your own ~4-week baseline (±half its usual variation) — you versus you, never a population chart. The check-in can lower a call, never raise it; the score itself is always pure physiology.</div>
              </div>
            </details>
          )}
        </section>
        );
      })()}

      {provenance && <AdvisoryNote>{provenance}</AdvisoryNote>}
  </>);
  // The reconnect banner is an action, so it stays up top. The alert
  // list is evidence the verdict already weighed (its most severe limiter is
  // the LimiterRule inside the verdict), so it reads under Technical details.
  const blkReconnect = (<>
      {tokenStatus?.isExpired && (
        <FigureSection title="Connection" right="reconnect">
          <AlertCard
            severity="error"
            title="reconnect-needed"
            markers={["reconnect_needed"]}
            message="Oura needs reconnecting to resume syncing. Data shown may be stale."
            recommendation="Reconnect Oura in Settings to resume syncing."
          />
          <div style={{ marginTop: 10 }}>
            <SettingsLink label="Reconnect Oura" onOpen={onOpenIntegrations} />
          </div>
        </FigureSection>
      )}
  </>);
  const blkSignals = (<>
      {alerts.length > 0 && (
        <FigureSection title="Signals" right={`${alerts.length} alert${alerts.length === 1 ? "" : "s"}`}>
          {alerts.map((alert, i) => (
            <AlertCard
              key={i}
              severity={alert.severity}
              title={alert.type?.replace(/_/g, " ") || alert.severity}
              markers={alert.markers}
              message={alert.message}
              recommendation={alert.recommendation}
            />
          ))}
        </FigureSection>
      )}

  </>);
  const blkMixedsignalday = (<>
      {/* Mixed-signal warning — shown only when Oura and Whoop disagree on
          the same metric beyond threshold. Display-only; the score is unchanged. */}
      {mixedSignal && (
        <FigureSection title="Mixed signal day" right={`${wearableConflicts.length} metric${wearableConflicts.length === 1 ? "" : "s"}`}>
          <AlertCard
            severity={wearableConflicts.some(c => c.severity === "major") ? "warning" : "caution"}
            title="wearables disagree"
            markers={wearableConflicts.map(c => c.metric)}
            message="Oura and Whoop disagree on one or more metrics today. Treat this as a conservative day rather than trusting either source outright."
            recommendation="Lean on manual feel and the more conservative reading until the wearables converge. See Wearable intelligence below for per-metric detail."
          />
        </FigureSection>
      )}

  </>);
  const blkWearablereadinesscheck = (<>
      {/* Wearable readiness check — compact, display-only status of the
          connected wearables (and manual). Never averages sources or re-scores. */}
      <WearableReadinessQASection
        qa={buildWearableReadinessQA({
          ouraConnected: connected,
          whoopConnected,
          events: whoopSyncEvents,
          conflicts: wearableConflicts,
          now: new Date(),
        })}
      />

  </>);
  const blkDatatrust = (<>
      {/* Recovery trust strip — source/freshness/debug context kept above the
          collapsed technical ledger so beta users can audit the daily read fast. */}
      {recovery && (
        <FigureSection title="Data trust" right="source audit">
          <RuledRow label="Primary score" value={`Oura biometrics · ${recovery.score ?? "—"}/100 · ${recovery.scoredDay || heroMeta.latestDay || "latest usable day"}`} />
          <RuledRow label="Sync freshness" value={formatSyncFreshness(tokenStatus)} emphasis={tokenStatus?.syncStatus === "failed" || tokenStatus?.syncStatus === "stale"} />
          <RuledRow label="HRV raw" value={`${rawMetrics.hrv || "not available"} · ${sources.hrv || hrv?.source || "source unknown"}`} emphasis={!rawMetrics.hrv || hrv?.score === 0} />
          {hrv && <RuledRow label="HRV score" value={`${hrv.score}/35 · ${hrv.source || "source unknown"}${hrv.sampleCount != null ? ` · n=${hrv.sampleCount}` : ""}`} emphasis={hrv.score === 0 || hrv.confidence === "insufficient"} />}
          {rhr && <RuledRow label="RHR raw" value={`${rawMetrics.rhr || "not available"} · ${sources.rhr || rhr.source || "source unknown"}`} />}
          <div style={{ fontSize: 11.5, color: C.textFaint, lineHeight: 1.55, marginTop: 8 }}>
            If a component looks off, this is the first place to check: raw wearable value, scoring source, sample depth, and sync freshness. The full ledger remains under Technical details.
          </div>
        </FigureSection>
      )}

  </>);
  const blkCoachinterpretation = (<>
      {/* 1 · Coach interpretation — coaching-first: the plain-language read leads
             the Recovery view, ahead of the numeric readiness hero, so the default
             experience is guidance rather than a ledger. Same rows/data as before;
             only the vertical order changed. */}
      {(recommendation || coachInterp.cluster) && (
        <FigureSection title="Coach interpretation" right={coachInterp.tone === "warning" ? "caution" : coachInterp.tone === "good" ? "clear" : "watch"}>
          <div style={{ fontFamily: S.fontSerif, fontSize: 18, color: C.text, lineHeight: 1.25, marginBottom: 8 }}>{coachInterp.cluster}</div>
          <p style={{ fontSize: 13, color: C.text, lineHeight: 1.65, margin: 0 }}>{coachInterp.guidance}</p>
          {coachInterp.body && <p style={{ fontSize: 12, color: C.textDim, lineHeight: 1.6, marginTop: 8, marginBottom: 0 }}>{coachInterp.body}</p>}
          {coachInterp.confidenceNote && (
            <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${C.line}`, fontSize: 11.5, color: C.textFaint, lineHeight: 1.55 }}>{coachInterp.confidenceNote}</div>
          )}
        </FigureSection>
      )}

  </>);
  const blkReadiness = (<>
      {/* 2 · Readiness Hero — score, source, confidence, latest day, trend, method */}
      {recovery && (
        <FigureSection title="Readiness" right={<StatusStamp>{heroMeta.confidenceLabel}{heroMeta.stale ? " · stale" : ""}</StatusStamp>}>
          <ReadinessMethodToggle open={explanationOpen} onToggle={() => setExplanationOpen(o => !o)} />
          <div style={{ clear: "both" }}>
            {/* Connected-but-empty is a first-sync moment, not a broken
                one. Say what's happening and how long it takes. */}
            {recovery.band === "insufficient_data" && settings?.ouraConnected === true && (
              <div style={{ fontFamily: S.fontSerif, fontStyle: "italic", fontSize: 13, color: C.textDim, lineHeight: 1.5, marginBottom: 10 }}>
                First sync running — your history usually lands in under a minute. Your first verdict follows it; the weekly trend unlocks after seven mornings.
              </div>
            )}
            <LeadMetric
              value={recovery.score ?? "—"}
              unit="/100"
              caption={recovery.band === "insufficient_data" ? "Insufficient data — no wearable signals reported" : (resolvedRecommendation?.label || recovery.band.replace(/_/g, " "))}
              note={`${heroMeta.source} · ${quality?.summary || "quality unknown"}`}
            />
            <RuledScale value={recovery.score ?? "—"} max={100} />
            {recoveryHistory.length >= 2 && (
              <div style={{ marginTop: 14 }}>
                <Sparkline points={recoveryHistory} width={260} height={44} color={C.text} label="7-day trend"
                  overlayPoints={recoveryHistory.length >= 4 ? recoveryHistory.map((p, i, arr) => {
                    const win = arr.slice(Math.max(0, i - 2), i + 1);
                    return { date: p.date, value: win.reduce((a, x) => a + (Number(x.value) || 0), 0) / win.length };
                  }) : null} />
              </div>
            )}
          </div>
          <div style={{ marginTop: 12 }}>
            {resolvedRecommendation?.label && <RuledRow label="Readiness" value={`${resolvedRecommendation.label}${resolvedRecommendation.readiness && resolvedRecommendation.readiness !== "n/a" ? ` · ${resolvedRecommendation.readiness}` : ""}`} />}
            <RuledRow label="Source" value={heroMeta.source} />
            <RuledRow
              label="Confidence"
              value={`${blendedRecommendation?.confidence || confidence?.level || "unknown"} · ${blendedRecommendation?.wearableAdjustment?.reason || confidence?.reason || "pending"}`}
              emphasis={(blendedRecommendation?.confidence || confidence?.level) === "low"}
            />
            <RuledRow label="Latest recovery day" value={heroMeta.latestDay || "n/a"} emphasis={heroMeta.stale} />
          </div>
          {explanationOpen && (
            <MethodNote>
              Recovery is the canonical scoring ledger: HRV contributes up to 35 points, resting heart rate up to 25, sleep up to 25, and body temperature up to 15. The large component figures in the ledger below are contribution points, not raw Oura values. Raw source values, baselines, and source labels live in the component ledger. If detailed sleep data is missing, 0vertrained falls back to Oura readiness contributors and lowers confidence.
            </MethodNote>
          )}
        </FigureSection>
      )}

  </>);
  const blkWhatchangedtoday = (<>
      {/* 3 · What changed today? — Tier 1 only when flags actually surfaced;
             on a stable day the same rows are preserved inside the Technical
             details disclosure below rather than taking hero-level space. */}
      {recovery && changeSummary.hasFlags && (
        <FigureSection title="What changed today" right="flags surfaced">
          {changeSummary.rows.map((row) => (
            <RuledRow key={row.key} label={row.label} value={row.value} emphasis={row.tone === "warning" || row.tone === "caution"} />
          ))}
        </FigureSection>
      )}

  </>);
  const blkTechnicaldetailsdisclosure = (<>
      {/* Technical-details disclosure — the coaching-first sections (hero, what
          changed, interpretation) stay above; the full transparency ledger
          collapses here by default but every row is preserved when expanded. */}
      <button
        type="button"
        onClick={() => setTechOpen(o => !o)}
        aria-expanded={techOpen}
        style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: C.panel, border: "none", borderTop: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}`, cursor: "pointer", fontFamily: C.monoFamily }}
      >
        <span style={{ fontSize: 10.5, color: C.textDim, letterSpacing: "0.14em", textTransform: "uppercase" }}>Technical details</span>
        <span style={{ fontSize: 10, color: C.text, letterSpacing: "0.1em", textTransform: "uppercase" }}>
          {techOpen ? "▲ hide" : "▾ signals · score · interpretation · ledger · load"}
        </span>
      </button>

  </>);
  const blkWearableintelligence = (<>
      {/* Wearable intelligence — supplemental blend/source detail, kept under
          Technical details. */}
      {blendExplanation?.available && (
        <FigureSection title="Wearable intelligence" right={blendExplanation.headline || "supplemental"}>
          <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.6, marginBottom: 8 }}>
            {blendExplanation.disclaimer}
          </div>
          {blendExplanation.sourceLine && <RuledRow label="Source map" value={blendExplanation.sourceLine} />}
          {confidenceExplanation && confidenceExplanation.label && (
            <RuledRow
              label="Aggregated confidence"
              value={confidenceExplanation.label}
              emphasis={confidenceExplanation.tone === "warning"}
            />
          )}
          {confidenceExplanation && confidenceExplanation.reasons.length > 0 && (
            <RuledRow label="Why" value={confidenceExplanation.reasons.join("; ")} />
          )}
          {aggregatedContext?.whoopRecoveryContext && (
            <RuledRow label="Whoop recovery" value={aggregatedContext.whoopRecoveryContext.note} />
          )}
          {aggregatedContext?.whoopStrainContext && aggregatedContext.whoopStrainContext.level !== "normal" && (
            <RuledRow label="Whoop strain" value={aggregatedContext.whoopStrainContext.note} emphasis={aggregatedContext.whoopStrainContext.level === "high"} />
          )}
          {blendExplanation.conservativeCopy && <RuledRow label="Blend note" value={blendExplanation.conservativeCopy} emphasis />}
          {blendExplanation.points.slice(0, 3).map((point, i) => (
            <RuledRow key={`${point}-${i}`} label="Also" value={point} />
          ))}
        </FigureSection>
      )}

  </>);
  const blkWhatchangedtoday2 = (<>
      {/* What changed today — on a stable day the rows live here instead of
          taking Tier-1 space (they render up top only when flags surfaced). */}
      {recovery && !changeSummary.hasFlags && (
        <FigureSection title="What changed today" right="stable">
          {changeSummary.rows.map((row) => (
            <RuledRow key={row.key} label={row.label} value={row.value} emphasis={row.tone === "warning" || row.tone === "caution"} />
          ))}
        </FigureSection>
      )}

  </>);
  const blkWearablesourcesummary = (<>
      {/* Wearable source summary — presence only, no scores; renders only when
          Whoop is connected. */}
      {whoopConnected && (
        <WhoopSourceSummary
          ouraConnected={connected}
          whoopConnected={whoopConnected}
          manual={!!(manualSummary || subjectiveRecovery)}
        />
      )}
  </>);
  const blkComponentledger = (<>
      {/* 4 · Component ledger — raw values, baselines, denominators, sources kept visible */}
      <FigureSection title="Component ledger" right="raw + baseline + score">
        <div style={{ fontSize: 11.5, color: C.textFaint, lineHeight: 1.55, marginBottom: 4 }}>
          Transparent scoring detail: each figure is the contribution out of its cap, alongside the raw value, personal baseline, and data source.
        </div>
        {hrv && <MetricFigure label="HRV balance" score={hrv.score} max={35} raw={rawMetrics.hrv} baseline={baselines?.hrv?.label} source={sources.hrv} note={`z=${hrv.zScore} · CV ${hrv.cv}%`} />}
        {rhr && <MetricFigure label="Resting heart rate" score={rhr.score} max={25} raw={rawMetrics.rhr} baseline={baselines?.rhr?.label} source={sources.rhr} note={`${rhr.delta > 0 ? "+" : ""}${rhr.delta} bpm vs baseline`} />}
        {sleep && <MetricFigure label="Sleep" score={sleep.nightly} max={25} raw={rawMetrics.sleep} baseline={baselines?.sleep?.label} source={sources.sleep} note="nightly contribution" />}
        {temp && <MetricFigure label="Temperature" score={temp.score} max={15} raw={rawMetrics.temp} baseline={baselines?.temp?.label} source={sources.temp} note={temp.consecutiveNights > 0 ? `${temp.consecutiveNights}+ elevated nights` : "baseline"} />}
      </FigureSection>

  </>);
  const blkOuradataquality = (<>
      {/* 5 · Data quality + missing fields / context */}
      {quality && (
        <FigureSection title="Oura data quality" right={`${quality.score}/100`}>
          <RuledRow label="Window" value={`${quality.daysLoaded}/${quality.daysRequested} days · latest sync ${quality.latestDate || "n/a"}`} />
          {quality.latestRecoveryDate && quality.latestRecoveryDate !== quality.latestDate && (
            <RuledRow label="Recovery day" value={`${quality.latestRecoveryDate} · latest usable sleep/readiness`} />
          )}
          {quality.latestRecoveryDate && quality.latestRecoveryDate === quality.latestDate && (
            <RuledRow label="Recovery day" value={`${quality.latestRecoveryDate} · current`} />
          )}
          <RuledRow label="Sleep records" value={`${quality.sleepRecords}/${quality.daysLoaded || quality.daysRequested}`} />
          <RuledRow label="Readiness records" value={`${quality.readinessRecords}/${quality.daysLoaded || quality.daysRequested}`} />
          {/* "HR samples" removed: raw heartrate payloads are no longer
              fetched client-side (their only use was this count). Quality scoring
              never used the figure — see calcOuraDataQuality. */}
          <RuledRow label="SpO₂ days" value={quality.spo2Records} />
          <RuledRow label="Temperature days" value={quality.tempRecords} />
          <RuledRow label="Fallback mode" value={quality.fallbackMode ? "active" : "not active"} emphasis={quality.fallbackMode} />
          {tokenStatus && (
            <RuledRow
              label="Last sync"
              value={tokenStatus.lastSynced
                ? `${new Date(tokenStatus.lastSynced).toLocaleDateString()} ${new Date(tokenStatus.lastSynced).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · ${tokenStatus.syncStatus}`
                : "never synced"}
              emphasis={tokenStatus.syncStatus === "failed" || tokenStatus.syncStatus === "stale"}
            />
          )}
          {tokenStatus?.isExpired && (
            <RuledRow label="Token status" value="reconnect required" emphasis={true} />
          )}
          <div style={{ fontSize: 11.5, color: C.textFaint, lineHeight: 1.55, marginTop: 8 }}>
            Record counts are window completeness — a low count means fewer synced nights or missing fields, not a scoring failure.{quality.fallbackMode ? " Fallback mode is active: missing detailed sleep/readiness fields are filled from Oura readiness contributors, which lowers confidence." : ""}
          </div>
        </FigureSection>
      )}

  </>);
  const blkTrainingLoad = (<>
      {/* 6 · Training load details */}
      {trainingLoad && trainingLoad.rolling.zone !== "insufficient_data" && (
        <FigureSection title="Training Load" right={trainingLoad.zoneInfo.label}>
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 14, alignItems: "end", marginBottom: 12 }}>
            <div><span style={S.leadFigure}>{trainingLoad.rolling.ratio}</span><span style={S.leadUnit}> ACWR</span></div>
            <div style={{ paddingBottom: 8 }}>
              <div style={{ ...S.figureRule, background: C.textDim, marginBottom: 8 }} />
              <div style={{ fontFamily: S.fontSerif, fontStyle: "italic", color: C.textDim, fontSize: 14, lineHeight: 1.35 }}>{trainingLoad.zoneInfo.description}</div>
            </div>
          </div>
          <RuledRow label="Acute load · 7d" value={`${trainingLoad.rolling.acute} au`} />
          <RuledRow label="Chronic load · 28d" value={`${trainingLoad.rolling.chronic} au`} />
          <RuledRow label="Trend" value={trainingLoad.rolling.trend} />
          <RuledRow label="Recommendation" value={trainingLoad.zoneInfo.recommendation} />
          <MethodLine
            testId="method-load"
            method="ACWR = this week's load against your own 28-day norm · load counted in effort-minutes across lifting and cardio"
            detail={
              <>
                Every session earns load from how hard and how long it was — a zone-2 hour counts like an easy hour, a heavy leg day like a heavy leg day (lifting via sRPE, cardio via heart-rate zones, one shared currency). The acute:chronic ratio compares your last 7 days to your last 28: around 1.0 means you're training at your norm; well above ~1.3 means load is spiking faster than your base can absorb — the zone label and recommendation above come straight from that ratio, computed only from your own history.
              </>
            }
          />
          {externalCardio && (
            <RuledRow
              label="External cardio · 7d"
              value={`${externalCardio.runMiles > 0 ? `${externalCardio.runMiles} mi · ` : ""}${externalCardio.minutes} min · STRAVA`}
            />
          )}
              {unloggedFlags.length > 0 && (
        <AdvisoryNote>
          {unloggedFlags.length} unlogged-load day{unloggedFlags.length > 1 ? "s" : ""} in 14d ({unloggedFlags.map(f => `${f.date.slice(5)} · ${f.source === "strava" ? `${f.miles}mi run (Strava)` : `strain ${f.strain}`}`).join(", ")}) — the A:C ratio understates true load. Flag only; nothing is injected.
        </AdvisoryNote>
      )}
      </FigureSection>
      )}

  </>);
  const blkAlerthistory = (<>
      {/* 7 · Alert history — secondary technical detail, kept reachable */}
      {alertHistory && Object.keys(alertHistory).length > 0 && (
        <FigureSection title="Alert history" right={`${Object.keys(alertHistory).length}d`}>
          <AlertHistory history={alertHistory} />
        </FigureSection>
      )}

  </>);
  const blkContext = (<>
      {/* 8 · Manual context + trend */}
      {(sleepDebt || subjectiveRecovery || manualSummary) && (
        <FigureSection title="Context" right="manual + trend">
          {recovery?.scoringBasis && <RuledRow label="Scoring basis" value={recovery.scoringBasis} />}
          {sleepDebt && <RuledRow label="Sleep debt · 7d" value={`${sleepDebt.debtHours}h · ${sleepDebt.band}${Number.isFinite(sleepDebt.baselineHours) ? ` · vs ${sleepDebt.baselineHours}h ${sleepDebt.baselineSource === "wearable-need" ? "baseline need (Whoop)" : sleepDebt.baselineSource === "personal-norm" ? "your norm" : "target"}/night · naps credited` : ""}`} />}
          <RuledRow label="Primary source" value={connected ? "Oura biometrics" : "Manual check-in"} />
          {subjectiveRecovery && <RuledRow label="Manual score" value={`${subjectiveRecovery.score}/100 · ${subjectiveRecovery.read}`} />}
          {manualSummary && <RuledRow label="Manual inputs" value={manualSummary} />}
          <RuledRow label="Input depth" value={`${manualCompleteness.filled}/${manualCompleteness.total} recovery fields`} />
        </FigureSection>
      )}

  </>);
  const blkWearablecontextWhoop = (<>
      {/* 9 · Wearable context · Whoop — display-only cards. Never feeds the
          recovery score; the score above stays Oura biometrics + manual. */}
      {whoopConnected && (
        <FigureSection title="Wearable context · Whoop" right="display only">
          <div style={{ fontSize: 11.5, color: C.textFaint, lineHeight: 1.55, marginBottom: 4 }}>
            Reference context from Whoop. Shown for awareness only — it does not
            change the recovery score or training recommendation. Source: Whoop.
          </div>
          {whoopSummary ? (
            <>
              <WhoopRecoveryCard recovery={whoopSummary.recovery} date={whoopSummary.date} />
              <WhoopSleepCard sleep={whoopSummary.sleep} date={whoopSummary.date} />
              <WhoopStrainCard cycle={whoopSummary.cycle} workouts={whoopSummary.workouts} date={whoopSummary.date} />
            </>
          ) : (() => {
            const exp = buildEmptyStateExplanation({ events: whoopSyncEvents, source: "whoop", connected: whoopConnected });
            const toneColor = exp.tone === "warning" ? C.red : exp.tone === "caution" ? C.textDim : exp.tone === "good" ? C.green : C.textFaint;
            return (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 12, color: C.text, fontWeight: 600, marginBottom: 4 }}>{exp.title}</div>
                <div style={{ fontSize: 11.5, color: toneColor, lineHeight: 1.6 }}>{exp.body}</div>
              </div>
            );
          })()}
        </FigureSection>
      )}
  </>);

  return (
    <div>
      {refreshing && (
        <div style={{ padding: "6px 16px", borderBottom: `1px solid ${C.line}`, background: C.block, fontSize: 10, color: C.textFaint, letterSpacing: "0.12em", textTransform: "uppercase" }}>
          {refreshingLabel}
        </div>
      )}
      {isDemoMode() && (
        <FigureSection title="Demo mode" right="synthetic data">
          <div style={{ fontSize: 13, color: C.textDim, lineHeight: 1.6 }}>This view is using synthetic local data. No Supabase or Oura writes are performed.</div>
        </FigureSection>
      )}

      {isBroadsheet ? (
        <div style={{ display: "grid", gridTemplateColumns: "var(--ovt-rail-m) 1fr var(--ovt-rail-s)", gap: 20, alignItems: "start" }}>
          <section data-section="rec-verdict" style={{ minWidth: 0 }}>{blkReconnect}{blkSliceC}{blkCoachinterpretation}{blkWhatchangedtoday}{blkWhatchangedtoday2}{blkContext}</section>
          <section data-section="rec-plates" style={{ minWidth: 0 }}>{blkReadiness}{blkWearableintelligence}{blkComponentledger}{blkTrainingLoad}{blkAlerthistory}</section>
          <section data-section="rec-audit" style={{ minWidth: 0 }}>{blkSignals}{blkMixedsignalday}{blkWearablereadinesscheck}{blkDatatrust}{blkWearablesourcesummary}{blkOuradataquality}{blkWearablecontextWhoop}</section>
        </div>
      ) : (<>
        {/* One verdict: the check-in and verdict stand alone, with what changed
            and the data-trust strip under them, and every other reading of the
            same numbers waits under Technical details. */}
        {blkReconnect}{blkSliceC}{blkWhatchangedtoday}{blkDatatrust}{blkTechnicaldetailsdisclosure}{techOpen && (<>{blkSignals}{blkMixedsignalday}{blkWearablereadinesscheck}{blkReadiness}{blkCoachinterpretation}{blkWearableintelligence}{blkWhatchangedtoday2}{blkWearablesourcesummary}{blkComponentledger}{blkOuradataquality}{blkTrainingLoad}{blkAlerthistory}{blkContext}{blkWearablecontextWhoop}</>)}
      </>)}
    </div>
  );
}

export default RecoveryDashboard;
