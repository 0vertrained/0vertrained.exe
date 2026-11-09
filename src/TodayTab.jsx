// src/TodayTab.jsx
// Extracted verbatim from App.jsx (no behavior change): the
// Today tab plus its private pieces — Today command center, TodayPlanCard,
// FirstWeekCard, PrimaryNextAction, CheckinCard, CardioNotes, ExerciseLogger,
// and the epley1RM helper (exported; ProgressTab uses it too).
import { useState, useEffect, useRef, memo, lazy, Suspense } from "react";
import { useMediaQuery, BROADSHEET_QUERY } from "./ui/useMediaQuery";
import { buildWhoopSummary } from "./whoop";
import { perfStart, perfMark } from "./perf";
import { useTheme } from "./theme";
import { copyToClipboard } from "./clipboard";
import { DEFAULT_PROGRAM, defaultDay, getTodayKey } from "./constants";
import { calcRecoveryScore, resolveRecovery, computeRecoveryBaseline } from "./recovery";
import { isWhoopConnected, loadWhoopData } from "./whoop";
import { isStravaConnected, loadStravaActivities, groupStravaByDate, selectStravaLedgerSuggestion } from "./strava/dataLoading";
import { StravaCardioRow } from "./sections/StravaCardioRow";
import { isDemoMode } from "./demoData";
import { DEFAULT_SETTINGS } from "./data";
import { isOuraConnected, loadOuraData, normalizeActivity } from "./oura";
import { buildDailyLoads, computeRollingLoads, findUnloggedLoadDays, getLoadZoneInfo } from "./loadModel";
import { buildDecisionContext, getDailyRecommendation } from "./decisionEngine";
import { suggestWorkoutAdjustments } from "./adaptiveTraining";
import { computeStillNeeded } from "./fuelNeeds";
import { summarizeCheckin } from "./checkin";
import { summarizeManualRecovery } from "./manualRecovery";
import { buildTodayDecision, buildDecisionResponseEntry } from "./todayDecision";
import { getDecisionFeedbackBrief } from "./decisionFeedback";
import { SessionComplete } from "./SessionComplete";
import { LoadingShell, NavRow, DisclosureBlock, AdvisoryNote } from "./ui/primitives";
import { getSkeletonPlan } from "./uiStability";
import { buildTodayPlan, buildNextAction } from "./todaySummary";
import { CascadeSet } from "./CascadeSet";
import { GhostChip } from "./GhostChip";
import { lastSessionSets, firstEmptyIndex, ghostForSet } from "./setGhosts";
import { buildBoxScore } from "./boxScore";
import { buildAggregatedRecoveryContext } from "./recovery/aggregationModel";
import { flattenProgramLifting, getProgramSessions, usesProgramSessions } from "./programSessions";
import { buildWearableLoadRows } from "./wearableWorkoutLoad";
import { TRACKING_MODES, completedSetCount, isCompletedSet, isExerciseHandled, reconcileExerciseSets, resolveTrackingMode, validateSet } from "./workoutLogging";
import { isFirstWeekUser, countLoggedDays, buildFirstWeekChecklist, summarizeChecklist, buildFirstWeekCoachCopy, buildBetaFeedbackText, resolveDataMode } from "./firstWeekJourney";
import { PhysiqueOSPanel } from "./PhysiqueOSPanel";
import { RaceWeekLine } from "./RaceWeekLine";

// SessionMode is lazy — it only loads when a session actually starts,
// keeping it out of the initial bundle.
const SessionMode = lazy(() => import("./SessionMode").then(m => ({ default: m.SessionMode })));
const CardioSession = lazy(() => import("./CardioSession").then(m => ({ default: m.CardioSession })));

function RestDayLogCard({ recovery }) {
  const { C, S } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const components = Object.values(recovery?.components || {});
  return (
    <div style={S.block}>
      <div style={S.blockHead}>
        <span style={S.blockTitle}>Rest Day</span>
        <span style={S.blockStat}>Recovery focus</span>
      </div>
      <div style={{ fontSize:13, color:C.textDim, marginBottom: components.length ? 10 : 0 }}>No training scheduled. Focus on recovery.</div>
      {components.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            aria-expanded={expanded}
            style={{ background:"none", border:"none", color:C.textDim, fontFamily:C.fontFamily, fontSize:11, letterSpacing:"0.1em", textTransform:"uppercase", cursor:"pointer", padding:0 }}
          >
            {expanded ? "▾ Hide recovery factors" : "▸ Show recovery factors"}
          </button>
          {expanded && (
            <div style={{ fontSize:11.5, color:C.textDim, marginTop:8 }}>
              {components.map(comp => (
                <div key={comp.label} style={{ display:"flex", justifyContent:"space-between", padding:"3px 0", borderBottom:`1px solid ${C.line}` }}>
                  <span style={{ letterSpacing:"0.05em" }}>{comp.label} <span style={{ color:C.textFaint }}>· {comp.value}</span></span>
                  <span style={{ color: comp.score/comp.max >= 0.7 ? C.green : comp.score/comp.max >= 0.4 ? C.textDim : C.red }}>{comp.score}/{comp.max}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// copyToClipboard moved to src/clipboard.js — MoreTab was calling it
// without an import, so it now lives in a shared module both files import.

// First-week baseline banner
// Additive, tab-specific guidance for new beta users while their baseline is
// forming. It sits ABOVE the real tab content and never hides functional
// controls — sparse-data copy that reads "baseline is being established" instead
// of a blank or judgmental screen. Renders nothing outside the first week.

function FirstWeekCard({ settings, entries, program, ouraConnected, setTab, showToast }) {
  const { C, S } = useTheme();
  const mono = C.fontFamily;
  const [expanded, setExpanded] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [note, setNote] = useState("");
  const [fallbackText, setFallbackText] = useState(null);

  const checklist = buildFirstWeekChecklist({ settings, entries, program, ouraConnected });
  const summary = summarizeChecklist(checklist);
  const loggedDays = countLoggedDays(entries);
  const coach = buildFirstWeekCoachCopy({
    loggedDays,
    setupGoal: settings?.setup?.goal,
    dataMode: resolveDataMode(settings, ouraConnected),
  });

  const goTo = (item) => { if (item?.targetTab && setTab) setTab(item.targetTab); };

  const statusGlyph = (status) =>
    status === "done" ? "✓" : status === "next" ? "→" : "·";
  const statusColor = (status) =>
    status === "done" ? C.text : status === "next" ? C.text : C.textFaint;

  const copyFeedback = async () => {
    const text = buildBetaFeedbackText({
      tab: "Today",
      settings,
      loggedDays,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
      note,
    });
    const ok = await copyToClipboard(text);
    if (ok) {
      setFallbackText(null);
      showToast?.("Beta note copied");
    } else {
      setFallbackText(text);
      showToast?.("Select all + copy");
    }
  };

  return (
    <section style={{ ...S.block, background: C.block }}>
      <div style={S.blockHead}>
        <span style={S.blockTitle}>{"> "}Baseline week</span>
        <span style={S.blockStat}>{summary.label}</span>
      </div>

      {/* One-line explanation */}
      <div style={{ fontSize: 13, color: C.textDim, lineHeight: 1.5 }}>
        {summary.complete
          ? "Setup checklist complete — keep logging to firm up your baseline."
          : "Establishing your baseline — aim for 3–7 logged days."}
      </div>

      {/* Next step + CTA */}
      {summary.next && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 12, paddingTop: 10, borderTop: `1px solid ${C.line}` }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: C.textFaint }}>Next step</div>
            <div style={{ fontSize: 13.5, color: C.text, marginTop: 3, lineHeight: 1.35 }}>{summary.next.label}</div>
          </div>
          <button type="button" onClick={() => goTo(summary.next)}
            style={{ ...S.smallBtn, borderColor: C.text, color: C.text, whiteSpace: "nowrap", flexShrink: 0 }}>
            {summary.next.cta} →
          </button>
        </div>
      )}

      {/* Expand / collapse full checklist */}
      <button type="button" onClick={() => setExpanded((v) => !v)}
        style={{ background: "none", border: "none", color: C.textDim, fontFamily: mono, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer", padding: "10px 0 0", display: "flex", alignItems: "center", gap: 6 }}>
        <span>{expanded ? "▾" : "▸"}</span>
        <span>{expanded ? "Hide checklist" : `Show all steps (${summary.done}/${summary.total})`}</span>
      </button>

      {expanded && (
        <div style={{ marginTop: 8 }}>
          {checklist.map((item) => (
            <div key={item.id} style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, padding: "8px 0", borderTop: `1px solid ${C.line}` }}>
              <div style={{ display: "flex", gap: 8, minWidth: 0 }}>
                <span style={{ fontFamily: mono, fontSize: 13.5, color: statusColor(item.status), flexShrink: 0, width: 12, textAlign: "center" }}>{statusGlyph(item.status)}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: item.status === "done" ? C.textDim : C.text, lineHeight: 1.35, textDecoration: item.status === "done" ? "line-through" : "none" }}>{item.label}</div>
                  <div style={{ fontSize: 11, color: C.textFaint, lineHeight: 1.45, marginTop: 2 }}>{item.detail}</div>
                </div>
              </div>
              {item.status !== "done" && (
                <button type="button" onClick={() => goTo(item)}
                  style={{ background: "none", border: `1px solid ${C.line}`, color: C.textDim, fontFamily: mono, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer", padding: "4px 8px", whiteSpace: "nowrap", flexShrink: 0 }}>
                  {item.cta}
                </button>
              )}
            </div>
          ))}

          {/* First-week coach note — conservative, baseline-building language */}
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.line}` }}>
            <div style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: C.textFaint }}>{coach.headline}</div>
            <div style={{ fontSize: 11.5, color: C.textDim, lineHeight: 1.5, marginTop: 4 }}>{coach.body}</div>
          </div>
        </div>
      )}

      {/* Beta feedback note */}
      <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${C.line}` }}>
        {!feedbackOpen ? (
          <button type="button" onClick={() => setFeedbackOpen(true)}
            style={{ background: "none", border: "none", color: C.textDim, fontFamily: mono, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer", padding: 0 }}>
            ＋ Beta feedback note
          </button>
        ) : (
          <div>
            <div style={{ fontSize: 11, color: C.textFaint, lineHeight: 1.5, marginBottom: 6 }}>
              // Copies a plain-text note (app version, tab, logged days, setup goal/mode, browser). No personal logs or account details are included.
            </div>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
              placeholder="What worked, what was confusing, what you'd change…"
              style={{ ...S.notesInput, marginTop: 0, fontSize: 13.5 }} />
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button type="button" onClick={copyFeedback} style={{ ...S.smallBtn, borderColor: C.text, color: C.text }}>Copy beta feedback note</button>
              <button type="button" onClick={() => { setFeedbackOpen(false); setFallbackText(null); }} style={S.smallBtn}>Close</button>
            </div>
            {fallbackText && (
              <textarea readOnly value={fallbackText} onFocus={(e) => e.target.select()} rows={6}
                style={{ ...S.notesInput, marginTop: 8, fontSize: 11.5, fontFamily: mono }} />
            )}
          </div>
        )}
      </div>
    </section>
  );
}

// Primary next action
// The one emphasized row under the coach hero. It answers "what do I do next and
// how do I log it?" — Start / Continue / Finish depending on session state (see
// buildNextAction). The filled button is the single primary CTA on Today; every
// other control (accept/keep, feedback) stays an outline/secondary weight so the
// hierarchy reads at a glance. onGo scrolls to the relevant inputs — it never
// writes data or changes the recommendation.
export function TodayTab({  todayName, todayData, updateToday, updateEntryAtDate, showToast, onExport, loaded, program, settings, allData, logDate, setLogDate, ouraRecovery, setTab, saving = false, isOnline = true, savePending = false }) {
  // Broadsheet: below 1440px every wrapper is display:contents and
  // this component lays out as before.
  const isBroadsheet = useMediaQuery(BROADSHEET_QUERY);
  const { C, S } = useTheme();
  const prevReadinessRef = useRef(null); // remembers last band so readiness doesn't flicker (hysteresis)
  const mono = C.fontFamily;
  const activeProgram = program || DEFAULT_PROGRAM;
  const p   = activeProgram[todayName] || DEFAULT_PROGRAM[todayName];
  const programSessions = getProgramSessions(p);
  const sessionAwareProgram = usesProgramSessions(p);
  const plannedLifting = flattenProgramLifting(p);
  const hasPlannedCardio = programSessions.some((s) => !!s.cardio);
  const wo  = todayData.workout;
  const nut = todayData.nutrition;
  const bod = todayData.body;
  const realToday = getTodayKey();
  const todayKey  = logDate || realToday;
  const isLoggingPast = logDate && logDate !== realToday;
  // Load grouped Oura + Whoop data for the aggregation model. Only
  // fetches when both wearables are connected; otherwise the aggregated
  // context is null and the decision engine runs its existing Oura-only path.
  const [ouraGrouped, setOuraGrouped] = useState(null);
  const [whoopGrouped, setWhoopGrouped] = useState(null);
  const [stravaByDate, setStravaByDate] = useState(null); // normalized Strava activities, grouped by local day
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!loaded || isDemoMode()) return;
      try {
        perfStart("today"); // instrumentation — Settings → About → Diagnostics
        // These three probes are memoized (60s) + single-flighted, so they now
        // share answers with App boot and the Recovery tab instead of firing
        // three more /status function invocations of their own.
        const [ouraOn, whoopOn, stravaOn] = await Promise.all([
          isOuraConnected().catch(() => false),
          isWhoopConnected().catch(() => false),
          isStravaConnected().catch(() => false),
        ]);
        const [oura, whoop, strava] = await Promise.all([
          ouraOn ? loadOuraData(14).catch(() => ({})) : Promise.resolve(null),
          whoopOn ? loadWhoopData(14).catch(() => ({})) : Promise.resolve(null),
          // 28 days so Strava fills reach the full acute:chronic window.
          stravaOn ? loadStravaActivities(28).catch(() => []) : Promise.resolve([]),
        ]);
        if (!alive) return;
        setOuraGrouped(oura);
        setWhoopGrouped(whoop);
        setStravaByDate(groupStravaByDate(strava));
        perfMark("today", "wearables-ready");
      } catch {
        if (alive) { setOuraGrouped(null); setWhoopGrouped(null); setStravaByDate(null); }
      }
    })();
    return () => { alive = false; };
  }, [loaded, settings?.ouraConnected, settings?.whoopConnected, settings?.stravaConnected]);

  const stravaSuggestion = selectStravaLedgerSuggestion({
    stravaByDate,
    entries: allData,
    displayedDate: todayKey,
    todayKey: realToday,
  });

  const goals = settings?.goals || { calories:3600, protein:200, carbs:400, fats:100, water:128 };
  const userSupps = settings?.supplements || DEFAULT_SETTINGS.supplements;

  // First-week baseline state — drives the compact setup card near the top of
  // Today. Oura counts as connected when the ring is linked or a live biometric
  // score is present. Never blocks the normal Today content.
  const ouraConnected = settings?.ouraConnected === true || ouraRecovery != null;
  const firstWeek = isFirstWeekUser(settings, allData);

  const doneExercises = plannedLifting.filter((exercise) =>
    isExerciseHandled(exercise, wo.exercises[exercise.name] || {})
  ).length;


  // Recovery score from yesterday
  const yesterdayKey = (() => {
    const d = new Date(); d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  })();
  const subjectiveRecovery = allData ? calcRecoveryScore(allData[yesterdayKey], allData, yesterdayKey) : null;
  const recovery = resolveRecovery({ subjective: subjectiveRecovery, ouraScore: ouraRecovery });
  // Personal baseline applies to the subjective scorer only — Oura's own readiness
  // is already personalized against the wearer's HRV/RHR baselines.
  const recoveryPersonal = (recovery?.source === "subjective" && allData) ? computeRecoveryBaseline(allData, yesterdayKey, 30) : null;
  const dailyLoads = allData ? buildWearableLoadRows({ entries: allData, ouraData: ouraGrouped || {}, whoopData: whoopGrouped || {}, stravaByDate: stravaByDate || {}, maxDays: 28 }) : [];
  const trainingLoad = computeRollingLoads(dailyLoads);
  const dailyRecommendation = getDailyRecommendation(buildDecisionContext({
    todayProgram: p,
    entries: allData || {},
    settings,
    trainingLoad,
    todayKey,
    recovery,
    personal: recoveryPersonal,
    previousReadiness: prevReadinessRef.current,
  }));
  prevReadinessRef.current = dailyRecommendation.readiness;
  const adaptiveSuggestion = suggestWorkoutAdjustments({
    recommendation: dailyRecommendation,
    todayProgram: p,
    recentEntries: allData || {},
    settings,
  });
  const todayFuelNeeds = computeStillNeeded(nut, goals);
  // Broadsheet telemetry plates. Pure derivations
  // over data already in scope — the load model from entries, wearable
  // summaries from the already-fetched grouped maps, tomorrow from the
  // program. Computed only at the tier; display-only.
  // Plain derivations, deliberately un-memoized: buildDailyLoads walks 28
  // keyed lookups and the rest are O(days≤14) — cheaper than the memo
  // bookkeeping, and the React Compiler handles the rest.
  const bsLoad = (() => {
    if (!isBroadsheet) return null;
    const daily = buildDailyLoads(allData, 28, todayKey);
    const rolling = computeRollingLoads(daily);
    return { daily, rolling, zoneInfo: getLoadZoneInfo(rolling.zone) };
  })();
  const bsWhoop = isBroadsheet && whoopGrouped ? buildWhoopSummary(whoopGrouped) : null;
  const todayOuraSteps = (() => {
    const activity = normalizeActivity(ouraGrouped?.[todayKey]?.activity);
    return Number.isFinite(activity?.steps) ? activity.steps : null;
  })();
  const bsOuraLatest = (() => {
    if (!isBroadsheet || !ouraGrouped) return null;
    const dates = Object.keys(ouraGrouped).sort().reverse();
    return dates.length ? { date: dates[0], day: ouraGrouped[dates[0]] } : null;
  })();
  // Aggregated recovery context (enrichment layer). Null when Whoop is
  // not connected, so the decision engine runs its existing Oura-only path.
  const aggregatedContext = (ouraGrouped && whoopGrouped)
    ? buildAggregatedRecoveryContext({
        ouraData: ouraGrouped, whoopData: whoopGrouped, manualData: bod,
        recovery, trainingLoad, settings, recommendation: dailyRecommendation,
      })
    : null;
  const todayDecision = buildTodayDecision({
    recommendation: dailyRecommendation,
    recovery,
    nutrition: nut,
    goals,
    todayProgram: p,
    fuelNeeds: todayFuelNeeds,
    trainingLoad,
    manualBody: bod,
    adaptiveSuggestion,
    conflicts: aggregatedContext?.conflicts || null,
    aggregatedConfidence: aggregatedContext?.aggregatedConfidence || null,
  });
  const acceptedTrainingSuggestion = todayData.intelligence?.acceptedTrainingSuggestion;
  const keptOriginalTrainingPlan = todayData.intelligence?.keptOriginalTrainingPlan;
  const decisionResponse = todayData.intelligence?.todayDecisionResponse?.response || null;
  const decisionFeedbackBrief = getDecisionFeedbackBrief(allData || {});
  const recordDecisionResponse = (response) => {
    updateToday("intelligence.todayDecisionResponse", buildDecisionResponseEntry(todayDecision.call, response));
    showToast(`Decision marked: ${response}`);
  };
  useEffect(() => {
    const miles = parseFloat(wo.cardio?.miles);
    const time  = wo.cardio?.time || "";
    const pace  = wo.cardio?.pace || "";
    if (!miles || !time || pace) return; // nothing to do
    const parts = time.split(":");
    if (parts.length !== 2) return;
    const totalMins = parseInt(parts[0]) + parseInt(parts[1]) / 60;
    if (!totalMins || miles === 0) return;
    const paceMins = totalMins / miles;
    const pm = Math.floor(paceMins);
    const ps = Math.round((paceMins - pm) * 60);
    updateToday("workout.cardio.pace", `${pm}:${String(ps).padStart(2, "0")}`);
  }, [wo.cardio?.miles, wo.cardio?.time]); // eslint-disable-line react-hooks/exhaustive-deps

  // PR flash — detect if any set today is a new personal best
  const [prFlash, setPrFlash] = useState(null);
  const [sessionDone, setSessionDone] = useState(false);
  const prevDoneRef = useRef(0);

  const checkPR = (exName, newWeight) => {
    if (!allData || !newWeight) return;
    const w = parseFloat(newWeight);
    if (!w) return;
    let prevBest = 0;
    for (const [dk, d] of Object.entries(allData)) {
      if (dk === todayKey) continue;
      const sets = d.workout?.exercises?.[exName]?.sets || [];
      for (const s of sets) {
        const sw = parseFloat(s.weight) || 0;
        if (sw > prevBest) prevBest = sw;
      }
    }
    if (w > prevBest && prevBest > 0) {
      setPrFlash(`// new PR — ${exName} ${w} lbs`);
      setTimeout(() => setPrFlash(null), 3500);
    }
  };

  // Session completion detector — fires when all exercises go from incomplete to complete
  const totalExercises = plannedLifting.length;
  useEffect(() => {
    if (totalExercises === 0) return;
    if (doneExercises === totalExercises && prevDoneRef.current < totalExercises) {
      // Small delay so the last checkmark animation settles first
      setTimeout(() => setSessionDone(true), 400);
    }
    prevDoneRef.current = doneExercises;
  }, [doneExercises, totalExercises]);

  // Compute total volume for the completion overlay
  // ── Command-center summaries — pure reshaping of already-computed values ──
  // Planned-vs-today plan for the Today Plan card, and the quick-log status
  // strip. Both are display-only (see src/todaySummary.js); no persistence.
  const todayPlan = buildTodayPlan({ programDay: p, decision: todayDecision });

  // Single "Do next" row — the emphasized primary action derived from current
  // logging state. Display-only; the button just scrolls to the right inputs.
  const cardioLogged = hasPlannedCardio && (
    (parseFloat(wo.cardio?.miles) || 0) > 0 ||
    String(wo.cardio?.time || "").trim() !== "" ||
    Object.values(wo.cardioSessions || {}).some((c) => (parseFloat(c?.miles) || 0) > 0 || String(c?.time || "").trim() !== "")
  );
  const nextAction = buildNextAction({
    totalExercises,
    doneExercises,
    hasCardio: hasPlannedCardio,
    cardioLogged,
    isRest: todayPlan.isRest,
  });
  const [sessionModeOpen, setSessionModeOpen] = useState(false); // focused workout runner
  const [activeLiftingSessionId, setActiveLiftingSessionId] = useState(null);
  const [cardioSessionOpen, setCardioSessionOpen] = useState(false); // interval runner
  const [activeCardioSessionId, setActiveCardioSessionId] = useState(null);
  const [quickEditOpen, setQuickEditOpen] = useState({}); // Today is the launchpad; grids are deliberate quick edit.
  const activeLiftingSession = programSessions.find((s) => s.id === activeLiftingSessionId) || programSessions.find((s) => (s.lifting || []).length > 0) || { lifting: plannedLifting };
  const activeCardioSession = programSessions.find((s) => s.id === activeCardioSessionId && s.cardio) || programSessions.find((s) => s.cardio) || { id: "main", cardio: p.cardio };
  const checkinRef = useRef(null);

  // Front page — ONE primary CTA on the hero, derived from the same
  // next-action ladder. Start/continue launches Session Mode directly (the
  // fastest path to logging), cardio opens the interval runner, rest/done
  // scrolls to the check-in. No new write paths: these are the exact same
  // setters the in-block buttons already use. The jump mini-nav is gone —
  // the disclosure rows below replace it as the page's table of contents.
  const scrollToCheckin = () => checkinRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  const runNextAction = () => {
    if (!nextAction) return;
    if (nextAction.target === "checkin") { scrollToCheckin(); return; }
    if (nextAction.status === "cardio") {
      const sid = programSessions.find((s) => s.cardio)?.id;
      if (sid) setActiveCardioSessionId(sid);
      setCardioSessionOpen(true);
      return;
    }
    if (sessionAwareProgram) {
      const firstIncomplete = programSessions.find((s) => {
        const lifts = s.lifting || [];
        if (!lifts.length) return false;
        const done = lifts.filter((ex) => {
          const d = wo.exercises[ex.name];
          return d?.sets?.length === ex.sets && d.sets.every((x) => x.done);
        }).length;
        return done < lifts.length;
      });
      if (firstIncomplete) setActiveLiftingSessionId(firstIncomplete.id);
    }
    setSessionModeOpen(true);
  };
  const ctaLabel = !nextAction ? null
    : nextAction.status === "start" ? `Start session — ${todayName}`
    : nextAction.status === "continue" ? `Continue session — ${doneExercises}/${totalExercises} done`
    : nextAction.status === "cardio" ? "Start cardio"
    : nextAction.status === "done" ? "Wrap up — log check-in"
    : "Log check-in";

  const workoutStarted = doneExercises > 0 || cardioLogged;
  const workoutSubParts = [];
  if (plannedLifting.length > 0) workoutSubParts.push(`${doneExercises}/${plannedLifting.length} exercises`);
  if (hasPlannedCardio) workoutSubParts.push(cardioLogged ? "cardio logged" : "cardio planned");
  const workoutSub = [todayPlan.plannedLabel, workoutSubParts.join(" · ")].filter(Boolean).join(" — ");

  // Stable loading shell — render a non-empty command-center skeleton (hero +
  // plan + quick-log placeholders) instead of a blank Today while data loads.
  if (!loaded) return <LoadingShell plan={getSkeletonPlan("Today")} />;

  return (
    <div>
      {/* The Box Score — built at the moment of completion from the
          data already in hand; the finisher writes to the active session's
          cardio slot (or the plain slot on single-session days). */}
      {sessionDone && !isLoggingPast && (
        <SessionComplete
          boxScore={buildBoxScore({ data: allData, todayKey, todayName })}
          finisher={hasPlannedCardio && !cardioLogged && activeCardioSession?.cardio ? {
            label: `${activeCardioSession.cardio.type} · ${activeCardioSession.cardio.miles} mi`,
            onLog: () => {
              const c = activeCardioSession.cardio;
              if (activeCardioSession.id && activeCardioSession.id !== "main") {
                updateToday(`workout.cardioSessions.${activeCardioSession.id}.miles`, String(c.miles ?? ""));
              } else {
                updateToday("workout.cardio.miles", String(c.miles ?? ""));
              }
              showToast?.("Finisher logged — add your time on the day card anytime");
              setSessionDone(false);
            },
          } : null}
          onDismiss={() => { setSessionDone(false); }}
        />
      )}

      {/* The app header already owns the date for the normal Today view. Keep a
          date control only when a past day is actively being logged, where the
          selected date is essential context rather than duplicate chrome. */}
      {isLoggingPast && (
        <div style={{ padding:"9px 16px", borderBottom:`1px solid ${C.line}`, background:C.panel, display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:10, color:C.textDim, letterSpacing:"0.12em", textTransform:"uppercase" }}>Logging for</span>
            <input
              type="date"
              value={logDate || realToday}
              max={realToday}
              onChange={e => setLogDate(e.target.value === realToday ? null : e.target.value)}
              style={{ background:"none", border:"none", color: C.textDim, fontSize:11.5, fontFamily:mono, outline:"none", cursor:"pointer", letterSpacing:"0.04em" }}
            />
          </div>
          <button onClick={() => setLogDate(null)} style={{ background:"none", border:`1px solid ${C.lineBright}`, color:C.textDim, fontSize:10, letterSpacing:"0.1em", textTransform:"uppercase", cursor:"pointer", fontFamily:mono, padding:"3px 8px" }}>
            Back to Today
          </button>
        </div>
      )}
      {/* Broadsheet grid — decision rail · session ledger · telemetry
. The three <section>
          wrappers group EXISTING contiguous blocks; nothing moves in the
          source and no write path changes. Below the tier, container and
          wrappers are display:contents — zero layout effect. */}
      <div style={isBroadsheet ? { display: "grid", gridTemplateColumns: "var(--ovt-rail-m) 1fr var(--ovt-rail-s)", gap: 20, alignItems: "start" } : { display: "contents" }}>
      {/* PR Flash — at the tier this celebration spans the full
          spread (gridColumn 1/-1) instead of sitting crammed inside the 480px
          decision rail; on mobile it renders in the same flow position. */}
      {prFlash && (
        <div style={{ ...(isBroadsheet ? { gridColumn: "1 / -1" } : null), background: C.bg, border: `1px solid ${C.text}`, padding:"10px 16px", fontSize:11.5, color:C.text, letterSpacing:"0.08em", fontWeight:600 }}>
          {prFlash}
        </div>
      )}
      <section data-section="decision-rail" style={isBroadsheet ? { display: "flex", flexDirection: "column", gap: 12, minWidth: 0 } : { display: "contents" }}>

      {/* ── First-week setup card — new beta users only, and only for today
             (not when logging a past day). Compact, additive, navigates existing
             tabs. Disappears once the baseline week is behind them. ── */}
      {!isLoggingPast && firstWeek && (
        <FirstWeekCard
          settings={settings}
          entries={allData}
          program={program}
          ouraConnected={ouraConnected}
          setTab={setTab}
          showToast={showToast}
        />
      )}

      {/* One calm decision surface. Today Coach, day mode,
          live targets, the next meal, and evening closeout now share this
          command card; supporting controls live in focused sheets. */}
      {!isLoggingPast && (
        <PhysiqueOSPanel
          todayKey={todayKey}
          todayData={todayData}
          updateToday={updateToday}
          showToast={showToast}
          goals={goals}
          settings={settings}
          recommendation={dailyRecommendation}
          decision={todayDecision}
          adaptiveSuggestion={adaptiveSuggestion}
          currentResponse={decisionResponse}
          onResponse={recordDecisionResponse}
          feedbackBrief={decisionFeedbackBrief}
          cta={ctaLabel ? { label: ctaLabel, onGo: runNextAction, status: nextAction?.status, target: nextAction?.target } : null}
          adjustment={adaptiveSuggestion && !todayPlan.isRest ? {
            suggestion: adaptiveSuggestion,
            accepted: acceptedTrainingSuggestion,
            keptOriginal: keptOriginalTrainingPlan,
            onAccept: () => updateToday("intelligence.acceptedTrainingSuggestion", {
              version: 1,
              acceptedAt: new Date().toISOString(),
              mode: adaptiveSuggestion.mode,
              title: adaptiveSuggestion.title,
            }),
            onKeepOriginal: () => updateToday("intelligence.keptOriginalTrainingPlan", {
              version: 1,
              keptAt: new Date().toISOString(),
              title: adaptiveSuggestion.title,
            }),
          } : null}
          programDay={p}
          totalExercises={totalExercises}
          doneExercises={doneExercises}
          hasCardio={hasPlannedCardio}
          cardioLogged={cardioLogged}
          isRest={todayPlan.isRest}
          wearableSteps={todayOuraSteps}
          onOpenFuel={() => setTab?.("Fuel")}
        />
      )}
      </section>
      <section data-section="session-ledger" style={isBroadsheet ? { display: "flex", flexDirection: "column", gap: 12, minWidth: 0 } : { display: "contents" }}>

      {/* Race plan line — week of the plan, phase, countdown. Renders
             nothing without a plan; resolves against the displayed day. */}
      <RaceWeekLine program={activeProgram} dateKey={todayKey} />

      {/* ── 3 · Workout — a collapsed disclosure row on the front page
. The row carries plan + completion; expanding reveals the
             exact same session blocks and loggers as before, same write
             paths. Opens by default once work is logged, renders plain when
             logging a past day, and a bare rest day skips the fold. ── */}
      {/* ── 2b · Strava → cardio suggestion. Appears only when the
             displayed day has a recorded Strava activity and no manually
             logged cardio — the "ran outside the app" case, including rest
             days and past-day logging. One tap fills the same cardio fields
             the loggers below write; pace derives from the existing autofill. ── */}
      {stravaSuggestion && (() => {
        const suggestionEntry = stravaSuggestion.dateKey === todayKey
          ? todayData
          : (allData?.[stravaSuggestion.dateKey] || defaultDay());
        const applyAtDate = (path, value) => {
          if (stravaSuggestion.dateKey === todayKey) updateToday(path, value);
          else updateEntryAtDate?.(stravaSuggestion.dateKey, path, value);
        };
        return (
          <StravaCardioRow
            activities={stravaSuggestion.activities}
            cardio={suggestionEntry.workout?.cardio}
            cardioSessions={suggestionEntry.workout?.cardioSessions}
            dateKey={stravaSuggestion.dateKey}
            dayLabel={stravaSuggestion.dayLabel}
            isToday={stravaSuggestion.dateKey === realToday}
            onApply={(fill) => {
              applyAtDate("workout.cardio.miles", fill.miles);
              applyAtDate("workout.cardio.time", fill.time);
              const label = stravaSuggestion.dayLabel === "Today"
                ? "Today’s cardio"
                : stravaSuggestion.dayLabel === "Yesterday"
                  ? "Yesterday’s cardio"
                  : `Cardio for ${stravaSuggestion.dayLabel}`;
              showToast(`${label} filled from Strava`);
            }}
          />
        );
      })()}

      {plannedLifting.length === 0 && !hasPlannedCardio ? (
        <RestDayLogCard recovery={recovery} />
      ) : (
      <DisclosureBlock
        label={`Workout — ${todayName}`}
        sub={workoutSub}
        defaultOpen={workoutStarted || isBroadsheet}
        plain={isLoggingPast}
      >

      {sessionAwareProgram && programSessions.map((session) => {
        const sessionDoneCount = (session.lifting || []).filter((exercise) =>
          isExerciseHandled(exercise, wo.exercises[exercise.name] || {})
        ).length;
        const sessionStarted = (session.lifting || []).some((exercise) =>
          completedSetCount(exercise, wo.exercises[exercise.name] || {}) > 0 || Boolean(wo.exercises[exercise.name]?.skipped)
        );
        const sessionQuickEditOpen = Boolean(quickEditOpen[session.id]);
        const loggedCardio = wo.cardioSessions?.[session.id] || { miles:"", time:"", pace:"" };
        return (
          <div key={session.id} style={S.block}>
            <div style={S.blockHead}>
              <span style={S.blockTitle}>{"> "}{session.label} · {session.title}</span>
              <span style={S.blockStat}>{sessionDoneCount}/{(session.lifting||[]).length} COMPLETE</span>
            </div>
            {session.emphasis && <div style={{ fontSize:11, color:C.textDim, marginBottom:10, lineHeight:1.5 }}>{session.emphasis}</div>}
            {(session.lifting||[]).length > 0 && !isLoggingPast && sessionDoneCount < (session.lifting||[]).length && (
              <button type="button" onClick={() => { setActiveLiftingSessionId(session.id); setSessionModeOpen(true); }} style={{ width: "100%", background: "transparent", color: C.text, border: `1px solid ${C.lineBright}`, padding: "12px", fontFamily: mono, fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 500, cursor: "pointer", marginBottom: 10 }}>
                {sessionStarted ? `Resume ${session.label} · ${sessionDoneCount}/${(session.lifting||[]).length}` : `Start ${session.label} lifting`} →
              </button>
            )}
            {(session.lifting||[]).length > 0 && (
              <div style={{ borderTop:`1px solid ${C.line}`, marginTop:4 }}>
                {(session.lifting||[]).map((exercise, index) => {
                  const exerciseData = wo.exercises[exercise.name] || {};
                  const count = completedSetCount(exercise, exerciseData);
                  return (
                    <div key={`${exercise.name}-queue-${index}`} style={{ display:"grid", gridTemplateColumns:"1fr auto", gap:10, alignItems:"center", padding:"8px 0", borderBottom:`1px solid ${C.line}` }}>
                      <span style={{ fontSize:11.5, color:isExerciseHandled(exercise, exerciseData)?C.textDim:C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{exerciseData.performedName || exercise.name}</span>
                      <span style={{ fontFamily:mono, fontSize:9.5, color:exerciseData.skipped?C.amber:isExerciseHandled(exercise, exerciseData)?C.green:C.textFaint }}>{exerciseData.skipped?"SKIP":`${count}/${exercise.sets}`}</span>
                    </div>
                  );
                })}
                <button type="button" onClick={() => setQuickEditOpen((current) => ({ ...current, [session.id]: !sessionQuickEditOpen }))} style={{ width:"100%", marginTop:8, padding:"9px", border:`1px solid ${C.lineBright}`, background:"none", color:C.textDim, fontFamily:mono, fontSize:10, letterSpacing:"0.1em", textTransform:"uppercase", cursor:"pointer" }}>
                  {sessionQuickEditOpen ? "Hide quick edit" : "Quick edit sets"}
                </button>
              </div>
            )}
            {sessionQuickEditOpen && (session.lifting||[]).map((ex, i) => (
              <ExerciseLogger key={ex.name+i} exercise={ex} data={wo.exercises[ex.name]||{}} lastSets={lastSessionSets(allData, ex.name, todayKey)} onChange={v => updateToday(`workout.exercises.${ex.name}`, v)} showLabels={i===0} onPR={checkPR} />
            ))}
            {session.cardio && (
              <div style={{ marginTop:(session.lifting||[]).length?12:0, paddingTop:(session.lifting||[]).length?10:0, borderTop:(session.lifting||[]).length?`1px solid ${C.line}`:"none" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                  <span style={{ fontSize:11.5, color:C.text, letterSpacing:"0.08em", textTransform:"uppercase" }}>{session.cardio.type}</span>
                  <span style={{ fontSize:11, color:C.textDim }}>{cardioMeta(session.cardio)}</span>
                </div>
                {!isLoggingPast && <button type="button" onClick={() => { setActiveCardioSessionId(session.id); setCardioSessionOpen(true); }} style={{ width: "100%", background: "transparent", color: C.text, border: `1px solid ${C.lineBright}`, padding: "11px", fontFamily: mono, fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 500, cursor: "pointer", marginBottom: 12 }}>Start {session.label} cardio →</button>}
                {session.cardio.notes && <CardioNotes notes={session.cardio.notes} C={C} mono={mono} />}
                <div style={S.cardio}>
                  <div style={S.cardioCell}><input style={S.cardioInput} type="number" inputMode="decimal" placeholder={String(session.cardio.miles||"")} value={loggedCardio.miles || ""} onChange={e => updateToday(`workout.cardioSessions.${session.id}.miles`, e.target.value)} /><div style={S.cardioL}>Miles</div></div>
                  <div style={S.cardioCell}><input style={S.cardioInput} type="text" inputMode="numeric" placeholder="mm:ss" value={loggedCardio.time || ""} onChange={e => updateToday(`workout.cardioSessions.${session.id}.time`, e.target.value)} /><div style={S.cardioL}>Time</div></div>
                  <div style={S.cardioCell}><input style={S.cardioInput} type="text" placeholder="/mi" value={loggedCardio.pace || ""} onChange={e => updateToday(`workout.cardioSessions.${session.id}.pace`, e.target.value)} /><div style={S.cardioL}>Pace</div></div>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {!sessionAwareProgram && plannedLifting.length > 0 && (
        <div style={S.block}>
          <div style={S.blockHead}>
            <span style={S.blockTitle}>{"> "}Lifting</span>
            <span style={S.blockStat}>{doneExercises}/{plannedLifting.length} COMPLETE</span>
          </div>
          {/* Session Mode — focused one-exercise-at-a-time runner with rest
              timer, last-time, progression hint, and plate math. Same write
              path as the grid below; this is a lens, not a second store. */}
          {!isLoggingPast && doneExercises < plannedLifting.length && (
            <button
              type="button"
              onClick={() => setSessionModeOpen(true)}
              style={{ width: "100%", background: "transparent", color: C.text, border: `1px solid ${C.lineBright}`, padding: "12px", fontFamily: mono, fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 500, cursor: "pointer", marginBottom: 10 }}
            >
              {doneExercises > 0 ? `Resume session · ${doneExercises}/${plannedLifting.length}` : "Start session"} →
            </button>
          )}
          <button type="button" onClick={() => setQuickEditOpen((current) => ({ ...current, main: !current.main }))} style={{ width:"100%", padding:"9px", border:`1px solid ${C.lineBright}`, background:"none", color:C.textDim, fontFamily:mono, fontSize:10, letterSpacing:"0.1em", textTransform:"uppercase", cursor:"pointer", marginBottom:quickEditOpen.main?10:0 }}>
            {quickEditOpen.main ? "Hide quick edit" : "Quick edit sets"}
          </button>
          {quickEditOpen.main && plannedLifting.map((ex, i) => (
            <ExerciseLogger key={ex.name+i} exercise={ex} data={wo.exercises[ex.name]||{}} lastSets={lastSessionSets(allData, ex.name, todayKey)} onChange={v => updateToday(`workout.exercises.${ex.name}`, v)} showLabels={i===0} onPR={checkPR} />
          ))}
        </div>
      )}

      {!sessionAwareProgram && p.cardio && (
        <div style={S.block}>
          <div style={S.blockHead}>
            <span style={S.blockTitle}>{"> "}{p.cardio.type}</span>
            <span style={S.blockStat}>{cardioMeta(p.cardio)}</span>
          </div>
          {/* Cardio session runner — interval counterpart to Session
              Mode. Pre-fills from the plan's notes when unambiguous; logs
              elapsed time through the existing workout.cardio.time path. */}
          {!isLoggingPast && (
            <button
              type="button"
              onClick={() => setCardioSessionOpen(true)}
              style={{ width: "100%", background: "transparent", color: C.text, border: `1px solid ${C.lineBright}`, padding: "11px", fontFamily: mono, fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 500, cursor: "pointer", marginBottom: 12 }}
            >
              Start cardio session →
            </button>
          )}
          {p.cardio.notes && <CardioNotes notes={p.cardio.notes} C={C} mono={mono} />}
          <div style={S.cardio}>
            <div style={S.cardioCell}><input style={S.cardioInput} type="number" inputMode="decimal" placeholder={String(p.cardio.miles||"")} value={wo.cardio.miles} onChange={e => updateToday("workout.cardio.miles", e.target.value)} /><div style={S.cardioL}>Miles</div></div>
            <div style={S.cardioCell}><input style={S.cardioInput} type="text" inputMode="numeric" placeholder="mm:ss" value={wo.cardio.time} onChange={e => updateToday("workout.cardio.time", e.target.value)} /><div style={S.cardioL}>Time</div></div>
            <div style={S.cardioCell}><input style={S.cardioInput} type="text" placeholder="/mi" value={wo.cardio.pace} onChange={e => updateToday("workout.cardio.pace", e.target.value)} /><div style={S.cardioL}>Pace</div></div>
          </div>
        </div>
      )}
      </DisclosureBlock>
      )}
      </section>
      <section data-section="telemetry" style={isBroadsheet ? { display: "flex", flexDirection: "column", gap: 12, minWidth: 0 } : { display: "contents" }}>


      {/* ── 5 · Fuel + Recovery — quiet nav rows. One line each on
             the front page; the full story is one tap away. Replaces the old
             readiness one-liner and folds fuel status in without a second
             macro widget. ── */}
      {!isLoggingPast && dailyRecommendation && (
        <NavRow
          label="Recovery"
          sub={`${typeof dailyRecommendation.readinessIndex === "number" ? dailyRecommendation.readinessIndex + " · " : ""}${dailyRecommendation.summary}`}
          onClick={() => setTab && setTab("Recovery")}
        />
      )}

      {/* ── 6 · Check-in / supplements / notes — secondary, below the main flow ── */}
      <div ref={checkinRef} style={{ scrollMarginTop: 100 }}>
        <DisclosureBlock
          label="Daily log"
          sub="Body metrics · supplements · notes"
          defaultOpen={isLoggingPast}
          plain={isLoggingPast}
        >
          <CheckinCard bod={bod} wo={wo} supplements={todayData.supplements} userSupps={userSupps} updateToday={updateToday} />
        </DisclosureBlock>
      </div>
      {/* Telemetry plates — broadsheet only. */}
      {isBroadsheet && !isLoggingPast && (<>
        <div style={S.block} data-plate="load-model">
          <div style={S.blockHead}><span style={S.blockTitle}>{"> "}Load model</span><span style={S.blockStat}>{bsLoad?.zoneInfo?.label?.toUpperCase() || ""}</span></div>
          {bsLoad && bsLoad.rolling.zone !== "insufficient_data" ? (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 10 }}>
                <div><div style={{ fontSize: 18, fontWeight: 600, color: C.text, fontFamily: mono }}>{Math.round(bsLoad.rolling.acute)}</div><div style={{ fontSize: 9.5, color: C.textFaint, letterSpacing: "0.08em" }}>ACUTE 7D</div></div>
                <div><div style={{ fontSize: 18, fontWeight: 600, color: C.text, fontFamily: mono }}>{Math.round(bsLoad.rolling.chronic)}</div><div style={{ fontSize: 9.5, color: C.textFaint, letterSpacing: "0.08em" }}>CHRONIC 28D</div></div>
                <div><div style={{ fontSize: 18, fontWeight: 600, color: C.text, fontFamily: mono }}>{bsLoad.rolling.ratio.toFixed(2)}</div><div style={{ fontSize: 9.5, color: C.textFaint, letterSpacing: "0.08em" }}>A:C RATIO</div></div>
              </div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 28 }} aria-hidden="true">
                {bsLoad.daily.slice(0, 14).reverse().map((d, i) => {
                  const max = Math.max(...bsLoad.daily.slice(0, 14).map(x => x.load || 0), 1);
                  return <div key={i} style={{ flex: 1, height: `${Math.max(((d.load || 0) / max) * 100, 4)}%`, background: (d.load || 0) > 0 ? C.text : C.line }} />;
                })}
              </div>
              <div style={{ fontSize: 9.5, color: C.textFaint, letterSpacing: "0.1em", marginTop: 4 }}>DAILY LOAD · LAST 14D</div>
              {(() => { const f = (whoopGrouped || stravaByDate) ? findUnloggedLoadDays(bsLoad.daily, whoopGrouped, { window: 14, stravaByDate }) : []; return f.length > 0 ? (
                <AdvisoryNote compact>{f.length} unlogged-load day{f.length > 1 ? "s" : ""} — ratio understates load</AdvisoryNote>
              ) : null; })()}
            </>
          ) : (
            <div style={{ fontSize: 11, color: C.textFaint }}>Insufficient training history for the A:C model — needs ~2 weeks of logged sessions.</div>
          )}
        </div>
        {(bsWhoop?.cycle || bsOuraLatest?.day?.activity) && (
          <div style={S.block} data-plate="wearable-load">
            <div style={S.blockHead}><span style={S.blockTitle}>{"> "}Wearable load</span><span style={S.blockStat}>DISPLAY ONLY</span></div>
            {Number.isFinite(bsWhoop?.cycle?.strain) && (
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, padding: "5px 0", borderBottom: `1px solid ${C.line}` }}>
                <span style={{ color: C.textDim }}>Whoop strain</span><span style={{ color: C.text, fontFamily: mono }}>{bsWhoop.cycle.strain.toFixed(1)}</span>
              </div>
            )}
            {bsOuraLatest?.day?.activity && (
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, padding: "5px 0" }}>
                <span style={{ color: C.textDim }}>Oura activity</span>
                <span style={{ color: C.text, fontFamily: mono }}>
                  {[Number.isFinite(bsOuraLatest.day.activity.active_calories) ? `${bsOuraLatest.day.activity.active_calories} kcal` : null,
                    Number.isFinite(bsOuraLatest.day.activity.steps) ? `${bsOuraLatest.day.activity.steps.toLocaleString()} steps` : null,
                  ].filter(Boolean).join(" · ") || "synced"}
                </span>
              </div>
            )}
          </div>
        )}
      </>)}
      </section>
      </div>

      {/* Cardio session runner overlay (lazy) */}
      {cardioSessionOpen && (
        <Suspense fallback={null}>
          <CardioSession
            open={cardioSessionOpen}
            onClose={() => setCardioSessionOpen(false)}
            cardio={activeCardioSession.cardio}
            onLogTime={(mmss) => {
              if (sessionAwareProgram) updateToday(`workout.cardioSessions.${activeCardioSession.id}.time`, mmss);
              else updateToday("workout.cardio.time", mmss);
            }}
            showToast={showToast}
            settings={settings}
          />
        </Suspense>
      )}

      {/* Session Mode overlay (lazy-loaded, only fetched on open) */}
      {sessionModeOpen && (
        <Suspense fallback={null}>
          <SessionMode
            open={sessionModeOpen}
            onClose={() => setSessionModeOpen(false)}
            lifting={activeLiftingSession.lifting || plannedLifting}
            workoutData={wo}
            onUpdate={updateToday}
            todayKey={todayKey}
            allData={allData}
            onPR={checkPR}
            todayName={todayName}
            settings={settings}
            sessionId={activeLiftingSession.id || "main"}
            sessionLabel={`${activeLiftingSession.label || ""}${activeLiftingSession.title ? ` · ${activeLiftingSession.title}` : ""}`.trim() || "Lifting session"}
            saving={saving}
            savePending={savePending}
            appOnline={isOnline}
            programDay={p}
            bodyData={bod}
            safetyFlag={Boolean(todayData?.intelligence?.physiqueOS?.safetyFlag)}
          />
        </Suspense>
      )}
    </div>
  );
}

// Check-in Card
// Consolidates Body + Supplements + Notes into one collapsible card. Collapsed by
// default with a compact summary; expanded reveals the original inputs unchanged.
// All updateToday paths (body.*, supplements.<name>, workout.notes) are preserved.
function CheckinCard({ bod, wo, supplements, userSupps, updateToday }) {
  const { C, S } = useTheme();
  const mono = C.fontFamily;
  const [open, setOpen] = useState(false);
  const [metricsOpen, setMetricsOpen] = useState(false);
  const summary = summarizeCheckin({
    body: bod,
    workout: wo,
    supplements,
    supplementNames: userSupps,
  });
  const recoverySummary = summarizeManualRecovery(bod);
  const metricInputs = [
    ["sleepQuality", "Quality", "1-10", "numeric"],
    ["restingHeartRate", "RHR", "bpm", "numeric"],
    ["hrv", "HRV", "ms", "decimal"],
    ["stress", "Stress", "1-10", "numeric"],
    ["motivation", "Motivation", "1-10", "numeric"],
  ];

  return (
    <div style={S.block}>
      <button
        type="button"
        style={{ ...S.blockHead, width:"100%", background:"none", border:"none", padding:0, marginBottom: open ? 10 : 0, cursor: "pointer", textAlign:"left" }}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <span style={S.blockTitle}>{"> "}Check-in</span>
        <span style={S.blockStat}>{open ? "▲ hide" : "▼ show"}</span>
      </button>

      {!open && (
        <div style={{ display:"grid", gap:5 }}>
          <div style={{ fontSize: 13, color: C.textDim, fontFamily: mono, letterSpacing: "0.02em" }}>
            {summary.join("  ·  ")}
          </div>
          {recoverySummary && (
            <div style={{ fontSize: 11, color: C.textFaint, fontFamily: mono, letterSpacing: "0.02em", lineHeight:1.45 }}>
              {recoverySummary}
            </div>
          )}
        </div>
      )}

      {open && (<>
        <div style={S.bodyLine}>
          <div style={S.bodyCell}><input style={S.bodyInput} type="number" inputMode="decimal" placeholder="0" value={bod.weight}   onChange={e => updateToday("body.weight",   e.target.value)} /><div style={S.bodyL}>Weight lbs</div></div>
          <div style={S.bodyCell}><input style={S.bodyInput} type="number" inputMode="decimal" placeholder="0" value={bod.sleep}    onChange={e => updateToday("body.sleep",    e.target.value)} /><div style={S.bodyL}>Sleep hrs</div></div>
          <div style={S.bodyCell}><input style={S.bodyInput} type="number" inputMode="numeric" placeholder="0" value={bod.energy}   onChange={e => updateToday("body.energy",   e.target.value)} /><div style={S.bodyL}>Energy 1-10</div></div>
          <div style={S.bodyCell}><input style={S.bodyInput} type="number" inputMode="numeric" placeholder="0" value={bod.soreness} onChange={e => updateToday("body.soreness", e.target.value)} /><div style={S.bodyL}>Soreness 1-10</div></div>
        </div>

        <button
          type="button"
          onClick={() => setMetricsOpen(o => !o)}
          style={{ ...S.smallBtn, width:"100%", marginTop:10, justifyContent:"space-between", color: metricsOpen ? C.text : C.textDim }}
          aria-expanded={metricsOpen}
        >
          <span>i · recovery metrics</span>
          <span>{metricsOpen ? "hide" : "optional"}</span>
        </button>
        {metricsOpen && (
          <div style={{ marginTop:8, padding:"10px", border:`1px solid ${C.lineBright}`, background:C.cell }}>
            <div style={{ fontSize:11, color:C.textDim, lineHeight:1.5, marginBottom:10 }}>
              Manual recovery is first-class. Log sleep, quality, soreness, stress, motivation, and any illness/injury flag; HRV/RHR stay as context until a real baseline exists.
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(2, minmax(0, 1fr))", gap:8 }}>
              {metricInputs.map(([key, label, placeholder, inputMode]) => (
                <div key={key} style={S.bodyCell}>
                  <input
                    style={S.bodyInput}
                    type="number"
                    inputMode={inputMode}
                    placeholder={placeholder}
                    value={bod[key] || ""}
                    onChange={e => updateToday(`body.${key}`, e.target.value)}
                  />
                  <div style={S.bodyL}>{label}</div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => updateToday("body.illnessOrInjury", !bod.illnessOrInjury)}
              aria-pressed={Boolean(bod.illnessOrInjury)}
              style={{ ...S.smallBtn, width:"100%", marginTop:8, justifyContent:"space-between", color: bod.illnessOrInjury ? C.red : C.textDim, borderColor: bod.illnessOrInjury ? C.red : C.lineBright }}
            >
              <span>Illness / injury flag</span>
              <span>{bod.illnessOrInjury ? "flagged" : "clear"}</span>
            </button>
          </div>
        )}

        <div style={{ fontSize: 10, color: C.textFaint, letterSpacing: "0.14em", textTransform: "uppercase", margin: "14px 0 6px" }}>Supplements</div>
        <div style={S.supps}>
          {userSupps.map(s => {
            const on = supplements?.[s];
            return <button key={s} style={{ ...S.supp, ...(on ? S.suppOn : {}) }} onClick={() => updateToday(`supplements.${s}`, !on)}>{on?"✓ ":""}{s}</button>;
          })}
        </div>

        <input style={S.notesInput} placeholder="how did it feel..." value={wo.notes} onChange={e => updateToday("workout.notes", e.target.value)} />
      </>)}
    </div>
  );
}

// Epley formula: weight × (1 + reps/30). Only meaningful for sets ≤ 12 reps.
// Epley1RM moved to sessionIntelligence.js (canonical home for lift
// math); imported for local use in ExerciseLogger and re-exported so
// existing importers (ProgressTab) keep working.
import { epley1RM, effectiveE1RM } from "./sessionIntelligence";
export { epley1RM };

// Cardio Notes
// Collapsible coaching notes block shown above the cardio inputs.
// Long notes (Hyrox circuits, alternating interval weeks) are collapsed by default
// so the Today viewport prioritizes the call, next action, and logging inputs.
// Cardio header data: planned minutes (race-plan runs carry them),
// effort, and the pace target when the plan has one. Old programs show the
// effort alone, exactly as before.
function cardioMeta(cardio) {
  return [
    Number(cardio?.minutes) > 0 ? `${cardio.minutes} MIN` : null,
    (cardio?.effort || "").toUpperCase() || null,
    cardio?.targetPace || null,
  ].filter(Boolean).join(" · ");
}

function CardioNotes({ notes, C, mono }) {
  const [open, setOpen] = useState(false);
  const SHORT = notes.length <= 60;
  if (SHORT) {
    return (
      <div style={{ fontSize:13, color:C.textDim, lineHeight:1.6, padding:"0 0 10px", borderBottom:`1px solid ${C.lineBright}`, marginBottom:10, fontStyle:"italic" }}>
        {notes}
      </div>
    );
  }
  return (
    <div style={{ marginBottom:10 }}>
      <button onClick={() => setOpen(o => !o)} style={{ width:"100%", display:"flex", justifyContent:"space-between", alignItems:"center", background:open ? C.cell : "none", border:`1px solid ${C.lineBright}`, padding:"7px 10px", cursor:"pointer", marginBottom: open ? 0 : 0 }}>
        <span style={{ fontSize:11, color:C.text, letterSpacing:"0.14em", textTransform:"uppercase" }}>Session notes</span>
        <span style={{ fontSize:11, color:C.textFaint }}>{open ? "▲ hide" : "▼ show"}</span>
      </button>
      {open && (
        <div style={{ background:C.cell, border:`1px solid ${C.lineBright}`, borderTop:"none", padding:"10px 10px 10px" }}>
          {/* Split on sentence-ending punctuation to show as digestible lines */}
          {notes.split(/(?<=\.)\s+/).map((sentence, i) => (
            <div key={i} style={{ fontSize:13, color:C.textDim, lineHeight:1.65, marginBottom:4, display:"flex", gap:6 }}>
              <span style={{ color:C.text, flexShrink:0 }}>·</span>
              <span style={{ fontStyle:"italic" }}>{sentence}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Exercise Logger
// memo: prevents re-rendering all exercise loggers when unrelated state changes
// (e.g. nutrition inputs updating on every keystroke in TodayTab)
const ExerciseLogger = memo(function ExerciseLogger({ exercise, data, onChange, showLabels, onPR, lastSets = null }) {
  const { C, S } = useTheme();
  const [noteOpen, setNoteOpen] = useState(false);
  const [errors, setErrors] = useState({});
  const mode = resolveTrackingMode(exercise);
  const sets = reconcileExerciseSets(exercise, data.sets || []);
  const done = sets.filter((set) => isCompletedSet(set, exercise)).length;
  const best1RM = sets.reduce((best, set) => {
    if (!isCompletedSet(set, exercise) || (set.type && set.type !== "straight")) return best;
    const estimate = effectiveE1RM(set.weight, set.reps, set.rir);
    return estimate && estimate > best ? estimate : best;
  }, 0);

  const updateSet = (index, field, value) => {
    onChange({ ...data, sets: sets.map((set, setIndex) => setIndex === index ? { ...set, [field]: value } : set) });
    if (errors[index]) setErrors((current) => ({ ...current, [index]: "" }));
  };
  const toggleDone = (index) => {
    const set = sets[index];
    if (set.done) {
      const { completedAt, ...reopened } = set;
      void completedAt;
      onChange({ ...data, sets: sets.map((entry, setIndex) => setIndex === index ? { ...reopened, done: false } : entry) });
      return;
    }
    const validation = validateSet(set, exercise);
    if (!validation.valid) {
      setErrors((current) => ({ ...current, [index]: validation.message }));
      return;
    }
    onChange({ ...data, skipped: undefined, sets: sets.map((entry, setIndex) => setIndex === index ? { ...entry, done: true, completedAt: new Date().toISOString() } : entry) });
    if (onPR && set.weight) onPR(exercise.name, set.weight);
  };

  const labels = mode === TRACKING_MODES.TIMED_HOLD ? ["sec", "+ lbs"]
    : mode === TRACKING_MODES.CARRY ? ["lbs", "yards"]
      : mode === TRACKING_MODES.ASSISTED_REPS ? ["assist", "reps"]
        : mode === TRACKING_MODES.BODYWEIGHT_REPS ? ["+ lbs", "reps"]
          : ["lbs", "reps"];

  const firstField = (set, index) => {
    if (mode === TRACKING_MODES.TIMED_HOLD) {
      return <input style={{ ...S.cell, ...(set.done ? S.cellSet : {}) }} type="number" inputMode="numeric" placeholder={String(exercise.reps)} value={set.duration || ""} onChange={(event) => updateSet(index, "duration", event.target.value)} aria-label={`Set ${index + 1} duration`} />;
    }
    if (mode === TRACKING_MODES.ASSISTED_REPS) {
      return <input style={{ ...S.cell, ...(set.done ? S.cellSet : {}) }} type="number" inputMode="decimal" placeholder="—" value={set.assistance || ""} onChange={(event) => updateSet(index, "assistance", event.target.value)} aria-label={`Set ${index + 1} assistance`} />;
    }
    return <input style={{ ...S.cell, ...(set.done ? S.cellSet : {}) }} type="number" inputMode="decimal" placeholder={mode === TRACKING_MODES.BODYWEIGHT_REPS ? "0" : "—"} value={set.weight || ""} onChange={(event) => updateSet(index, "weight", event.target.value)} aria-label={`Set ${index + 1} load`} />;
  };
  const secondField = (set, index) => {
    if (mode === TRACKING_MODES.TIMED_HOLD) {
      return <input style={{ ...S.cell, ...(set.done ? S.cellSet : {}) }} type="number" inputMode="decimal" placeholder="0" value={set.weight || ""} onChange={(event) => updateSet(index, "weight", event.target.value)} aria-label={`Set ${index + 1} added load`} />;
    }
    if (mode === TRACKING_MODES.CARRY) {
      return <input style={{ ...S.cell, ...(set.done ? S.cellSet : {}) }} type="number" inputMode="numeric" placeholder={String(exercise.reps)} value={set.distance || ""} onChange={(event) => updateSet(index, "distance", event.target.value)} aria-label={`Set ${index + 1} distance`} />;
    }
    return <input style={{ ...S.cell, ...(set.done ? S.cellSet : {}) }} type="number" inputMode="numeric" placeholder={String(exercise.reps)} value={set.reps || ""} onChange={(event) => updateSet(index, "reps", event.target.value)} aria-label={`Set ${index + 1} reps`} />;
  };

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={S.exName}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6, flex: 1, minWidth: 0 }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{data.performedName || exercise.name}</span>
          {exercise.notes && (
            <button type="button" onClick={() => setNoteOpen((open) => !open)} aria-label={noteOpen ? "Hide exercise note" : "Show exercise note"} aria-expanded={noteOpen}
              style={{ background: "none", border: "none", color: noteOpen ? C.text : C.textFaint, fontSize: 11, fontFamily: "monospace", letterSpacing: "0.08em", padding: "0 8px", cursor: "pointer", flexShrink: 0, minHeight: 44, minWidth: 36, display: "inline-flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>
              {noteOpen ? "▲" : "i"}
            </button>
          )}
        </div>
        <span style={S.exTarget}>{exercise.sets}×{exercise.reps} · {done}/{exercise.sets}{best1RM > 0 && <span style={{ color: C.textDim, marginLeft: 6 }}>~ {best1RM} lbs 1RM</span>}</span>
      </div>
      {noteOpen && exercise.notes && <div style={{ fontSize: 11, color: C.textDim, fontStyle: "italic", lineHeight: 1.55, padding: "5px 10px", marginBottom: 8, background: C.cell, borderLeft: `2px solid ${C.green}` }}>{exercise.notes}</div>}
      {showLabels && <div style={S.colTag}><span style={S.colTagSpan}/><span style={S.colTagSpan}>{labels[0]}</span><span style={S.colTagSpan}>{labels[1]}</span><span style={S.colTagSpan}>rir</span><span style={S.colTagSpan}/></div>}
      {data.skipped && <button type="button" data-testid="skip-tag" onClick={() => onChange({ ...data, skipped: undefined })} style={{ background: "none", border: "none", cursor: "pointer", padding: "2px 8px 6px", fontFamily: C.fontFamily, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: C.textDim }}>skipped · {data.skipped} · tap to undo</button>}
      {sets.map((set, index) => (
        <div key={index}>
          {index === firstEmptyIndex(sets) && mode !== TRACKING_MODES.TIMED_HOLD && mode !== TRACKING_MODES.CARRY && (
            <GhostChip ghost={ghostForSet(sets, index, lastSets)} onFill={({ weight, reps }) => onChange({ ...data, sets: sets.map((entry, setIndex) => setIndex === index ? { ...entry, weight, reps } : entry) })} />
          )}
          <div style={S.setLine}>
            <span style={S.setN}>{index + 1}</span>
            {firstField(set, index)}
            {secondField(set, index)}
            <input style={{ ...S.cell, ...(set.done ? S.cellSet : {}) }} type="number" inputMode="numeric" min="0" max="9" placeholder="—" aria-label={`Set ${index + 1} RIR`} value={set.rir || ""} onChange={(event) => updateSet(index, "rir", event.target.value)} />
            <button type="button" style={{ ...S.x, ...(set.done ? S.xOn : {}) }} onClick={() => toggleDone(index)} aria-label={`Mark set ${index + 1} ${set.done ? "not done" : "done"}`}>{set.done ? "✓" : "○"}</button>
          </div>
          {errors[index] && <div role="status" style={{ padding: "4px 0 2px 26px", color: C.red, fontFamily: C.fontFamily, fontSize: 10 }}>{errors[index]}</div>}
          <CascadeSet set={set} showOffer isLast={index === sets.length - 1} onChange={(nextSet) => onChange({ ...data, sets: sets.map((entry, setIndex) => setIndex === index ? nextSet : entry) })} />
        </div>
      ))}
    </div>
  );
}); // end memo(ExerciseLogger)

