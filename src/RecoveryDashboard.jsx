// src/RecoveryDashboard.jsx
// Recovery Intelligence v2 — Whitepaper system, Oura quality, confidence, and recommendation.

import { useEffect, useState, useCallback, useRef } from "react";
import { summarizeManualRecovery, getManualRecoveryCompleteness } from "./manualRecovery";
import { isDemoMode } from "./demoData";
import { isStravaConnected, loadStravaActivities } from "./strava/dataLoading"; // display context
import { buildRecoveryChangeSummary, buildRecoveryCoachInterpretation, buildRecoveryHeroMeta } from "./recoverySummary";
import { logFunnelEvent } from "./funnel";
import { editionWindow } from "./sundayEdition";
import { SundayEdition } from "./SundayEdition.jsx";
import { buildAggregatedRecoveryContext, buildConfidenceExplanation } from "./recovery/aggregationModel";
import { buildWearableReadinessQA } from "./recovery/wearableReadinessQA";
import {
  getWhoopTokenStatus,
  loadWhoopData,
  getWhoopSyncEvents,
  buildWhoopSummary,
} from "./whoop";
import { RecoveryLoading, RecoveryManual, RecoveryConnected } from "./RecoveryView";
import { loadRecoveryData } from "./recoveryLoad";
import { deriveRecoveryVerdict, resolveSharedCall } from "./sharedCall";
import { scoreForRecoveryDay } from "./recovery/verdictResolver";
import { resolveRecovery, manualRecoveryForDay, computeRecoveryBaseline } from "./recovery";
import { buildDecisionContext, getDailyRecommendation } from "./decisionEngine";
import { buildTodayDecision } from "./todayDecision";
import { buildDailyLoads, computeRollingLoads } from "./loadModel";
import { withAdded } from "./addedExercises";
import { readRecoveryDashboardCache } from "./recoveryDashboardSessionCache";
import { readWearableSnapshot, describeSnapshotAge } from "./wearableSnapshotCache";
import { perfStart, perfMark } from "./perf";
import { useMediaQuery, BROADSHEET_QUERY } from "./ui/useMediaQuery";
import { fetchServerSnapshot } from "./wearables/snapshot";

// Raw metric parsing is deliberately delegated to the canonical Oura helpers
// (getSleepDoc / hrvRmssdWithSource / rhrValue / tempDeviation / latestRecoveryDay)
// so this UI never re-derives payload shapes that could drift from the scoring
// engine. In particular it anchors to the latest *recovery* day, not the newest
// (possibly heartrate-only) synced date, and honors Oura's hrv.items[] arrays.
const formatSyncFreshness = (tokenStatus) => {
  if (!tokenStatus?.lastSynced) return "last sync unknown";
  const synced = new Date(tokenStatus.lastSynced);
  if (Number.isNaN(synced.getTime())) return `${tokenStatus.syncStatus || "sync status unknown"}`;
  const mins = Math.max(0, Math.round((Date.now() - synced.getTime()) / 60000));
  const age = mins < 60 ? `${mins}m ago` : mins < 1440 ? `${Math.round(mins / 60)}h ago` : `${Math.round(mins / 1440)}d ago`;
  return `${age} · ${tokenStatus.syncStatus || "status unknown"}`;
};

export function RecoveryDashboard({ integrationRevision = 0, data, settings = {}, yesterdayKey, appLoaded, userId, todayKey = null, todayName = null, todayPlan = null, programDay = null, onOpenCheckin = null, onOpenIntegrations = null, openEdition = false, onEditionClosed = null , onLoaded = null, todayCall = null}) {
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
  const [signalDay, setSignalDay] = useState(initialCache?.signalDay ?? initialCache?.recovery?.scoredDay);
  const [loadDay, setLoadDay] = useState(initialCache?.loadDay ?? initialCache?.recovery?.scoredDay);
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
      if (isDemoMode()) return;
      if (!await isStravaConnected().catch(() => false)) {
        if (alive) setExternalCardio(null);
        return;
      }
      if (!alive) return;
      const acts = await loadStravaActivities(7).catch(() => []);
      if (!alive) return;
      const runMiles = Math.round(acts.reduce((sum, a) => sum + (a.kind === "run" ? (Number(a.miles) || 0) : 0), 0) * 10) / 10;
      const minutes = Math.round(acts.reduce((sum, a) => sum + (Number(a.minutes) || 0), 0));
      setExternalCardio(acts.length ? { runMiles, minutes, count: acts.length } : null);
    })();
    return () => { alive = false; };
  }, [userId, settings?.stravaConnected, integrationRevision]);
  const [tokenStatus, setTokenStatus] = useState(initialCache?.tokenStatus ?? null);
  // Whoop display cards — loaded independently of the Oura recovery pipeline
  // so they never touch the recovery score, its cache, or its inputs. Display only.
  const [whoopConnected, setWhoopConnected] = useState(initialCache?.whoopConnected ?? false);
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
  const loadRequest = useRef(0);
  const loadController = useRef(null);
  // Hands each finished load to the app, which keeps it for Today's call.
  const onLoadedRef = useRef(onLoaded);
  useEffect(() => { onLoadedRef.current = onLoaded; });
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
    setRecovery(snap.recovery ?? null);
    setSignalDay(snap.signalDay ?? snap.recovery?.scoredDay);
    setLoadDay(snap.loadDay ?? snap.recovery?.scoredDay);
    if ("whoopConnected" in snap) setWhoopConnected(snap.whoopConnected);
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

  const morningBody = data?.[todayKey]?.body;
  const manualBody = getManualRecoveryCompleteness(morningBody || {}).filled ? morningBody : data?.[yesterdayKey]?.body || {};
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
    const request = ++loadRequest.current;
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    // Either the in-memory session cache or the persisted snapshot means we
    // already have last-known data on screen — refresh quietly instead of
    // dropping back to skeletons.
    const hasCachedRecovery = Boolean(readRecoveryDashboardCache(userId) || readWearableSnapshot(userId));
    if (hasCachedRecovery) setRefreshing(true);
    else setLoading(true);
    try {
      perfStart("recovery"); // instrumentation — Settings → About → Diagnostics
      const out = await loadRecoveryData({ data, yesterdayKey, settings, userId, alertHistory, signal: controller.signal });
      if (!out || request !== loadRequest.current) return;
      setConnected(out.connected);
      setTokenStatus(out.tokenStatus);
      if (out.connected || out.whoopConnected) {
        setOuraGrouped(out.ouraGrouped);
        setProvenance(out.provenance);
        if (out.unloggedFlags) setUnloggedFlags(out.unloggedFlags);
        setTrend(out.snapshot?.trend ?? null);
        setEditionRaw(out.editionRaw);
      }
      if (out.snapshot) hydrateFromSnapshot(out.snapshot);
      if (out.savedAt) {
        setSnapshotSavedAt(out.savedAt);
        setFromSavedSnapshot(false);
        // Live data now owns the view — the async server-snapshot hydrate below
        // must not overwrite it if it lands late.
        liveAppliedRef.current = true;
      }
      // The app keeps the latest load, so Today shows the same call.
      onLoadedRef.current?.(out);
    } catch (e) {
      if (!controller.signal.aborted) console.error("Recovery dashboard load error:", e);
    } finally {
      if (request === loadRequest.current) {
        perfMark("recovery", "verdict-ready");
        logFunnelEvent("first_verdict_rendered"); // funnel terminus; once per session, once per user in the table
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [data, yesterdayKey, settings, userId, hydrateFromSnapshot]);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 60000);
    return () => {
      clearInterval(interval);
      loadRequest.current++;
      loadController.current?.abort();
    };
  }, [loadData, integrationRevision]);

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
        if (!alive || !whoopStat || ["error", "unauthenticated", "not_configured"].includes(whoopStat.syncStatus)) return;
        const conn = Boolean(whoopStat.connected);
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
  }, [userId, integrationRevision]);

  if (loading) return <RecoveryLoading />;

  const whoop = { connected: whoopConnected, summary: whoopSummary, syncEvents: whoopSyncEvents };
  const shared = {
    refreshingLabel: refreshing ? refreshingLabel : null,
    demo: isDemoMode(),
    isBroadsheet, onOpenCheckin, onOpenIntegrations,
    subjectiveRecovery, manualSummary, manualCompleteness, whoop,
  };

  const heroMeta = buildRecoveryHeroMeta({ connected, confidence, quality, tokenStatus });
  const changeSummary = buildRecoveryChangeSummary({ hrv, rhr, sleep, temp, sleepDebt, trainingLoad, alerts, quality });

  // One verdict, read the same way Today reads it (sharedCall.js): the two
  // wearables blended when both are connected, the morning check-in as a
  // caution-only limiter, then one top-level instruction. Raw values,
  // sources and confidence stay visible in their own sections below. The
  // check-in is entered on Today; Recovery reads it off today's entry.
  const todayBody = (todayKey && data?.[todayKey]?.body) || {};
  const {
    verdict, checkin, wearableConflicts, blendedRecommendation, blendExplanation, resolvedRecommendation, inputs,
  } = deriveRecoveryVerdict({
    recovery, sleepDebt, alerts, trainingLoad, confidence, recommendation,
    ouraGrouped, whoopGrouped, whoopConnected, manualBody, todayBody, settings, todayKey, signalDay, loadDay,
  });
  // The call on screen is the more cautious of this verdict and Today's, so
  // the two screens always agree.
  const freshScore = scoreForRecoveryDay(recovery, todayKey);
  const manual = manualRecoveryForDay(data, todayKey, yesterdayKey);
  const effectiveRecovery = resolveRecovery({ subjective: manual, ouraScore: freshScore, wearableSource: recovery?.source });
  let engineRead = todayCall;
  // Recovery can open first, or a new sync can finish while Today is closed.
  if (!engineRead || engineRead.wearableScore !== freshScore || engineRead.manualScore !== (manual?.score ?? null)) {
    const dayPlan = programDay ? withAdded(programDay, data?.[todayKey]?.workout) : null;
    const rolling = inputs.trainingLoad?.rolling || computeRollingLoads(buildDailyLoads(data || {}, 28, todayKey));
    const personal = effectiveRecovery?.source === "subjective" ? computeRecoveryBaseline(data || {}, yesterdayKey, 30) : null;
    const daily = getDailyRecommendation(buildDecisionContext({
      todayProgram: dayPlan, entries: data, settings, todayKey, recovery: effectiveRecovery,
      personal, trainingLoad: rolling, previousReadiness: todayCall?.readiness,
    }));
    const decision = buildTodayDecision({ recommendation: daily, recovery: effectiveRecovery, trainingLoad: rolling, todayProgram: dayPlan, manualBody: todayBody, conflicts: wearableConflicts });
    engineRead = { call: decision.engineCall || decision.call, subtitle: decision.subtitle, reasons: decision.reasons };
  }
  const sharedCall = resolveSharedCall({ todayCall: engineRead.call, recoveryVerdict: verdict, score: effectiveRecovery?.score });
  if (!connected && !whoopConnected) {
    return (
      <RecoveryManual
        view={{
          ...shared, sharedCall, subjectiveRecovery: manual,
          interpretation: buildRecoveryCoachInterpretation({ connected: false, subjectiveRecovery: manual, manualCompleteness }),
          // Manual-only reads as a complete, confident setup here, never as broken.
          qa: buildWearableReadinessQA({ ouraConnected: connected, whoopConnected, events: whoopSyncEvents, conflicts: [], now: new Date() }),
        }}
      />
    );
  }

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
          verdict, sharedCall, todayCall: engineRead, recovery, trend, provenance, changeSummary, coachInterp,
          alerts: inputs.alerts || [], conflicts: wearableConflicts,
          recoveryHistory, hrv, rhr, sleep, temp, rawMetrics, sources, baselines, sleepDebt,
          trainingLoad, externalCardio, unloggedFlags,
          // The weekly edition appears on Sunday night, above the call.
          edition: { available: Boolean(editionWindow(new Date()).available && editionRaw), onOpen: () => setShowEdition(true) },
          reconnect: Boolean(tokenStatus?.isExpired),
          firstSync: settings?.ouraConnected === true || whoopConnected,
          connected, manualOn: Boolean(manualSummary || subjectiveRecovery),
          qa: buildWearableReadinessQA({ ouraConnected: connected, whoopConnected, events: whoopSyncEvents, conflicts: wearableConflicts, now: new Date() }),
          blendExplanation, confidenceExplanation, aggregatedContext,
          heroMeta: recovery?.source === "whoop" ? { ...heroMeta, source: "Whoop biometrics", latestDay: recovery.scoredDay } : heroMeta, syncFreshness: formatSyncFreshness(tokenStatus), tokenStatus, quality, confidence,
          blendedRecommendation, resolvedRecommendation, alertHistory,
        }}
      />
    </>
  );
}

export default RecoveryDashboard;
