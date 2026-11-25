// src/TodayTab.jsx
// Today: how am I, what do I do, where am I on fuel. The check-in folds to a
// line, the call sits under it with the day's one primary action, then the
// plan, the day's progress and the daily log. The pieces private to this
// screen (FirstWeekCard, RunFields, QuickEdit, DailyLog, CardioNotes,
// ExerciseLogger) live below it.
import { useState, useEffect, useRef, memo, lazy, Suspense } from "react";
import { useMediaQuery, BROADSHEET_QUERY } from "./ui/useMediaQuery";
import { buildWhoopSummary } from "./whoop";
import { perfStart, perfMark } from "./perf";
import { Icon, LinkRow, Switch } from "./ui/ledger";
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
import { MorningCheckin } from "./MorningCheckin";
import { buildTodayDecision, buildDecisionResponseEntry } from "./todayDecision";
import { getDecisionFeedbackBrief } from "./decisionFeedback";
import { SessionComplete } from "./SessionComplete";
import { LoadingShell, AdvisoryNote } from "./ui/primitives";
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
import { useDayOps, CallCard, FuelSnapshot, DayProgress, CallSheets } from "./TodayCall";
import { RaceWeekLine } from "./RaceWeekLine";
import { isRunCardio } from "./raceBuild";

// SessionMode is lazy — it only loads when a session actually starts,
// keeping it out of the initial bundle.
const SessionMode = lazy(() => import("./SessionMode").then(m => ({ default: m.SessionMode })));
const CardioSession = lazy(() => import("./CardioSession").then(m => ({ default: m.CardioSession })));

// First week
// A new account's setup checklist: where the baseline stands, the one next
// step, and the full list behind a disclosure. It never blocks Today.
function FirstWeekCard({ settings, entries, program, ouraConnected, setTab, showToast }) {
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
      showToast?.("Select all, then copy");
    }
  };

  return (
    <section className="card" data-section="first-week" aria-labelledby="first-week" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="sec"><h2 id="first-week" className="t-h">Baseline week</h2><span className="t-s c2">{summary.label}</span></div>
      <p className="t-s c2">
        {summary.complete
          ? "Setup checklist complete. Keep logging to firm up your baseline."
          : "The app is learning what is normal for you. Aim for 3 to 7 logged days."}
      </p>

      {summary.next && (
        <div className="row" style={{ borderTop: "1px solid var(--line)", paddingTop: 8 }}>
          <span className="kv grow"><span className="t-c c2">Next step</span><span className="t-bs">{summary.next.label}</span></span>
          <button type="button" className="btn btn-s btn-sm" onClick={() => goTo(summary.next)}>{summary.next.cta}</button>
        </div>
      )}

      <button type="button" className="btn btn-g btn-sm" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)} style={{ alignSelf: "flex-start", paddingLeft: 0 }}>
        {expanded ? "Hide checklist" : `Show all steps (${summary.done} of ${summary.total})`}
      </button>

      {expanded && (
        <>
          <ul className="rows">
            {checklist.map((item) => (
              <li key={item.id} className="row" style={{ alignItems: "flex-start", paddingTop: 4 }}>
                <Icon name={item.status === "done" ? "done" : "open"} className={item.status === "done" ? "good" : "c2"} />
                <span className="kv grow"><span className="t-bs">{item.label}{item.status === "done" && <span className="sr"> (done)</span>}</span><span className="t-s c2">{item.detail}</span></span>
                {item.status !== "done" && <button type="button" className="btn btn-s btn-sm" onClick={() => goTo(item)}>{item.cta}</button>}
              </li>
            ))}
          </ul>
          <div className="kv" style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }}>
            <h3 className="t-ss">{coach.headline}</h3>
            <p className="t-s c2">{coach.body}</p>
          </div>
        </>
      )}

      <div style={{ borderTop: "1px solid var(--line)", paddingTop: 4, display: "flex", flexDirection: "column", gap: 8 }}>
        {!feedbackOpen ? (
          <button type="button" className="btn btn-g btn-sm" onClick={() => setFeedbackOpen(true)} style={{ alignSelf: "flex-start", paddingLeft: 0 }}>Write a beta feedback note</button>
        ) : (
          <>
            <label className="field" style={{ paddingTop: 6 }}>
              <span className="lbl">Beta feedback note</span>
              <span className="hint">Copies a plain-text note: app version, tab, logged days, setup goal and mode, browser. No personal logs or account details.</span>
              <textarea className="input area" value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="What worked, what was confusing, what you’d change" />
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="btn btn-s btn-sm" onClick={copyFeedback}>Copy beta feedback note</button>
              <button type="button" className="btn btn-g btn-sm" onClick={() => { setFeedbackOpen(false); setFallbackText(null); }}>Close</button>
            </div>
            {fallbackText && (
              <textarea className="input area n" readOnly aria-label="Beta feedback note to copy" value={fallbackText} onFocus={(e) => e.target.select()} rows={6} />
            )}
          </>
        )}
      </div>
    </section>
  );
}

// Miles, time and pace for one run. Pace fills itself from the other two (see
// the effect in TodayTab), so it is offered last.
function RunFields({ logged = {}, planned = null, onChange }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
      <label className="field"><span className="lbl">Miles</span><input className="input n" type="number" inputMode="decimal" autoComplete="off" placeholder={String(planned?.miles || "")} value={logged.miles || ""} onChange={(e) => onChange("miles", e.target.value)} /></label>
      <label className="field"><span className="lbl">Time</span><input className="input n" type="text" inputMode="numeric" autoComplete="off" placeholder="mm:ss" value={logged.time || ""} onChange={(e) => onChange("time", e.target.value)} /></label>
      <label className="field"><span className="lbl">Pace</span><input className="input n" type="text" autoComplete="off" placeholder="/mi" value={logged.pace || ""} onChange={(e) => onChange("pace", e.target.value)} /></label>
    </div>
  );
}

// Quick edit: every exercise of a session with its sets, for correcting a log
// without opening the runner. Same write path as the runner.
function QuickEdit({ lifting, workout, allData, todayKey, updateToday, onPR }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", paddingBottom: 8 }}>
      <ul className="rows" style={{ paddingBottom: 8 }}>
        {lifting.map((exercise, index) => {
          const exerciseData = workout.exercises[exercise.name] || {};
          const handled = isExerciseHandled(exercise, exerciseData);
          return (
            <li key={`${exercise.name}-queue-${index}`} className="row" style={{ minHeight: 36 }}>
              <span className={`t-s grow clip${handled ? " c2" : ""}`}>{exerciseData.performedName || exercise.name}</span>
              <span className="n-s c2">{exerciseData.skipped ? "Skipped" : `${completedSetCount(exercise, exerciseData)}/${exercise.sets}`}</span>
            </li>
          );
        })}
      </ul>
      {lifting.map((ex, i) => (
        <ExerciseLogger key={ex.name + i} exercise={ex} data={workout.exercises[ex.name] || {}} lastSets={lastSessionSets(allData, ex.name, todayKey)} onChange={(v) => updateToday(`workout.exercises.${ex.name}`, v)} onPR={onPR} />
      ))}
    </div>
  );
}

export function TodayTab({  todayName, todayData, updateToday, updateEntryAtDate, showToast, loaded, program, settings, allData, logDate, setLogDate, ouraRecovery, setTab, saving = false, isOnline = true, savePending = false, intent = null, onIntentHandled = null, onOpenEdition = null }) {
  // Broadsheet: below 1440px every wrapper is display:contents and
  // this component lays out as before.
  const isBroadsheet = useMediaQuery(BROADSHEET_QUERY);
  const prevReadinessRef = useRef(null); // remembers last band so readiness doesn't flicker (hysteresis)
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

  const checkPR = (exName, newWeight) => {
    if (!allData || !newWeight) return;
    const w = parseFloat(newWeight);
    if (!w) return;
    const prevBest = priorBestWeight(allData, exName, todayKey);
    if (w > prevBest && prevBest > 0) {
      setPrFlash({ name: exName, weight: w });
      setTimeout(() => setPrFlash(null), 3500);
    }
  };

  // The Box Score opens when the runner's Finish session is tapped, and from
  // the call card once every exercise is done or skipped. It never opens by
  // itself over whatever is on screen.
  const totalExercises = plannedLifting.length;
  const skippedExercises = plannedLifting.filter((exercise) => wo.exercises[exercise.name]?.skipped).length;
  const liftingDone = totalExercises > 0 && doneExercises === totalExercises;

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
  const planRef = useRef(null);
  // The run-by-hand fields: opened on request, and whenever a run sits there.
  const hasPlainCardio = !sessionAwareProgram && Boolean(p.cardio);
  const unplannedRunLogged = !hasPlainCardio && ((parseFloat(wo.cardio?.miles) || 0) > 0 || String(wo.cardio?.time || "").trim() !== "");
  const [runOpen, setRunOpen] = useState(false);

  // Targets, day mode, closeout and the sheets behind the call.
  const ops = useDayOps({
    todayKey, todayData, updateToday, showToast, goals, settings,
    recommendation: dailyRecommendation, decision: todayDecision, adaptiveSuggestion,
    programDay: p, totalExercises, doneExercises, hasCardio: hasPlannedCardio, cardioLogged,
    isRest: todayPlan.isRest, wearableSteps: todayOuraSteps,
  });

  // The call card's primary action runs the same ladder as before: start or
  // continue opens the session runner, cardio opens the interval runner, and
  // a finished or rest day goes to closing it out. No new write paths: these
  // are the same setters the plan rows use.
  const runNextAction = () => {
    if (!nextAction) return;
    if (nextAction.status === "cardio") {
      const sid = programSessions.find((s) => s.cardio)?.id;
      if (sid) setActiveCardioSessionId(sid);
      setCardioSessionOpen(true);
      return;
    }
    if (nextAction.status !== "start" && nextAction.status !== "continue") { ops.setSheet("closeout"); return; }
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

  // A request from outside Today (the Log sheet, or Train): start the session
  // if there is one to start, or show the run fields. It is handed back once
  // acted on, so coming back to Today later does not repeat it.
  const intentNonce = intent?.nonce;
  useEffect(() => {
    if (!intentNonce || !loaded) return;
    const toPlan = () => requestAnimationFrame(() => planRef.current?.scrollIntoView?.({ behavior: "auto", block: "start" }));
    if (intent.kind === "run") { setRunOpen(true); toPlan(); }
    else if (!isLoggingPast && ["start", "continue", "cardio"].includes(nextAction?.status)) runNextAction();
    else toPlan();
    onIntentHandled?.();
  }, [intentNonce, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stable loading shell — render a non-empty skeleton instead of a blank
  // Today while data loads.
  if (!loaded) return <LoadingShell plan={getSkeletonPlan("Today")} />;

  const sessionTitle = todayPlan.plannedLabel || todayName;
  // With one lifting session the call card starts it and its plan row only
  // edits; with several, each row starts its own.
  const liftingSessionCount = programSessions.filter((s) => (s.lifting || []).length > 0).length;
  const longDay = (date) => date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const shiftDay = (offset) => {
    const date = new Date(`${todayKey}T12:00:00`);
    date.setDate(date.getDate() + offset);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return { key, date };
  };
  const prevDay = shiftDay(-1);
  const nextDay = shiftDay(1);
  // The one primary action on the call card, from the same ladder as before:
  // start, continue, cardio, then closing out the day.
  const primary = isLoggingPast ? null
    : !nextAction ? null
    : nextAction.status === "start" ? { label: "Start session", onGo: runNextAction }
    : nextAction.status === "continue" ? { label: "Resume session", onGo: runNextAction }
    : nextAction.status === "cardio" ? { label: isRunCardio(activeCardioSession?.cardio) ? "Start run" : "Start cardio", onGo: runNextAction }
    : null;
  // Once the lifting is done the card names it and offers the Box Score, and
  // closing out the day becomes the next thing to do.
  const boxScore = liftingDone && !isLoggingPast ? buildBoxScore({ data: allData, todayKey, todayName: sessionTitle }) : null;
  const finished = boxScore ? {
    line: `Done · ${doneExercises - skippedExercises} of ${totalExercises}\u00a0exercises${skippedExercises ? `, ${skippedExercises} skipped` : ""}`,
    onOpen: () => setSessionDone(true),
  } : null;
  const closeIsNext = !isLoggingPast && !primary && Boolean(nextAction) && (nextAction.status === "done" || nextAction.status === "rest");

  // One planned cardio block: what is planned, the runner, and the three fields.
  const cardioBlock = ({ cardio, logged, path, onStart, startLabel }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "4px 0 8px" }}>
      <div className="row">
        <Icon name="run" />
        <span className="kv grow"><span className="t-bs clip">{cardio.type}</span><span className="t-s c2">{cardioMeta(cardio) || "Cardio"}</span></span>
        {!isLoggingPast && onStart && <button type="button" className="btn btn-s btn-sm" onClick={onStart}>{startLabel}</button>}
      </div>
      {cardio.notes && <CardioNotes notes={cardio.notes} />}
      <RunFields logged={logged} planned={cardio} onChange={(field, value) => updateToday(`${path}.${field}`, value)} />
    </div>
  );

  return (
    <div className="shell" data-screen="today">
      {/* The Box Score, built at the moment of completion from the data
          already in hand; the finisher writes to the active session's cardio
          slot (or the plain slot on single-session days). */}
      {sessionDone && !isLoggingPast && (
        <SessionComplete
          boxScore={boxScore || buildBoxScore({ data: allData, todayKey, todayName: sessionTitle })}
          dateKey={todayKey}
          sessionName={sessionTitle}
          finisher={hasPlannedCardio && !cardioLogged && activeCardioSession?.cardio ? {
            label: `${activeCardioSession.cardio.type} · ${activeCardioSession.cardio.miles} mi`,
            onLog: () => {
              const c = activeCardioSession.cardio;
              if (activeCardioSession.id && activeCardioSession.id !== "main") {
                updateToday(`workout.cardioSessions.${activeCardioSession.id}.miles`, String(c.miles ?? ""));
              } else {
                updateToday("workout.cardio.miles", String(c.miles ?? ""));
              }
              showToast?.("Finisher logged. Add your time on Today whenever you like.");
              setSessionDone(false);
            },
          } : null}
          onDismiss={() => { setSessionDone(false); }}
        />
      )}

      {/* Broadsheet grid: decision rail, session ledger, telemetry. Below the
          tier the container and the three sections are display:contents, so a
          phone reads them as one column in source order. */}
      <div className="main" style={isBroadsheet ? { display: "grid", gridTemplateColumns: "var(--ovt-rail-m) 1fr var(--ovt-rail-s)", gap: 24, alignItems: "start" } : undefined}>

      {/* Logging a past day: step by a day, pick a date, and say plainly that
          the call belongs to today only. */}
      {isLoggingPast && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, ...(isBroadsheet ? { gridColumn: "1 / -1" } : null) }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button type="button" className="ibtn ibtn-o" aria-label={`Previous day, ${longDay(prevDay.date)}`} onClick={() => setLogDate(prevDay.key)}><Icon name="back" /></button>
            <label className="grow" style={{ display: "flex", minWidth: 0 }}>
              <span className="sr">Day being logged</span>
              <input className="input n" type="date" value={logDate || realToday} max={realToday} onChange={(e) => setLogDate(!e.target.value || e.target.value === realToday ? null : e.target.value)} />
            </label>
            <button type="button" className="ibtn ibtn-o" aria-label={`Next day, ${longDay(nextDay.date)}`} onClick={() => setLogDate(nextDay.key >= realToday ? null : nextDay.key)}><Icon name="next" /></button>
          </div>
          <p className="banner"><Icon name="info" size="s" /><span>You are editing a past day. The call is only shown for today.</span></p>
        </div>
      )}

      {/* A record: the tag is stamped, then one pass of light crosses it. */}
      {prFlash ? (
        <div className="banner" role="status" style={{ alignItems: "center", borderColor: "var(--earned)", ...(isBroadsheet ? { gridColumn: "1 / -1" } : null) }}>
          <span className="tag tag-e mo-stamp mo-foil" style={{ "--d": "200ms" }}>PR</span>
          <span className="grow"><span className="t-ss">{prFlash.name}</span><br /><span className="t-s c2">{prFlash.weight}{"\u00a0"}lb is your heaviest set on record.</span></span>
        </div>
      ) : boxScore?.prs?.length > 0 && (
        <button type="button" className="banner" onClick={() => setSessionDone(true)} aria-label={`Personal record: ${boxScore.prs.map((pr) => pr.name).join(", ")}. New best estimated one-rep max today. Open the Box Score.`} style={{ alignItems: "center", textAlign: "left", width: "100%", borderColor: "var(--earned)", ...(isBroadsheet ? { gridColumn: "1 / -1" } : null) }}>
          <span className="tag tag-e">PR</span>
          <span className="grow"><span className="t-ss">{boxScore.prs.map((pr) => pr.name).join(", ")}</span><br /><span className="t-s c2">New best estimated one-rep max today.</span></span>
          <Icon name="next" size="s" className="c2" />
        </button>
      )}

      <section data-section="decision-rail" style={isBroadsheet ? { display: "flex", flexDirection: "column", gap: 12, minWidth: 0 } : { display: "contents" }}>

      {/* First-week setup: new accounts only, and only for today. */}
      {!isLoggingPast && firstWeek && (
        <FirstWeekCard settings={settings} entries={allData} program={program} ouraConnected={ouraConnected} setTab={setTab} showToast={showToast} />
      )}

      {/* The check-in comes before the call: rate how you feel before the
          number tells you. It folds to one line once answered. */}
      <MorningCheckin body={bod} updateToday={updateToday} />

      {!isLoggingPast && (
        <>
          {/* Sunday evening: the week's edition, while it is out. */}
          {typeof onOpenEdition === "function" && (
            <LinkRow label="The Sunday Edition is out" sub="Your week, ending on one change" onClick={onOpenEdition} style={{ borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }} />
          )}
          <CallCard ops={ops} decision={todayDecision} recommendation={dailyRecommendation} sessionTitle={sessionTitle} exerciseCount={totalExercises} primary={primary} isRest={todayPlan.isRest} finished={finished} onOpenRecovery={() => setTab?.("Recovery")} />
          <FuelSnapshot ops={ops} onOpenFuel={() => setTab?.("Fuel")} />
        </>
      )}
      </section>

      <section data-section="session-ledger" ref={planRef} aria-labelledby="today-plan" style={isBroadsheet ? { display: "flex", flexDirection: "column", gap: 8, minWidth: 0 } : { display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid var(--line)", paddingTop: 12, scrollMarginTop: 64 }}>
        <h2 id="today-plan" className="t-ss">{isLoggingPast ? "Training" : "Today’s plan"}</h2>

        {/* Race plan line: week of the plan, phase, countdown. Renders nothing without a plan. */}
        <RaceWeekLine program={activeProgram} dateKey={todayKey} />

        <div className="rows">
        {sessionAwareProgram && programSessions.map((session) => {
          const lifts = session.lifting || [];
          const sessionDoneCount = lifts.filter((exercise) => isExerciseHandled(exercise, wo.exercises[exercise.name] || {})).length;
          const sessionStarted = lifts.some((exercise) => completedSetCount(exercise, wo.exercises[exercise.name] || {}) > 0 || Boolean(wo.exercises[exercise.name]?.skipped));
          const open = Boolean(quickEditOpen[session.id]);
          return (
            <div key={session.id}>
              {lifts.length > 0 && (
                <div className="row">
                  <Icon name="train" />
                  <span className="kv grow"><span className="t-bs clip">{session.label} · {session.title}</span><span className="t-s c2">Lifting · {sessionDoneCount} of {lifts.length}{"\u00a0"}exercises done</span></span>
                  {!isLoggingPast && liftingSessionCount > 1 && sessionDoneCount < lifts.length && (
                    <button type="button" className="btn btn-s btn-sm" onClick={() => { setActiveLiftingSessionId(session.id); setSessionModeOpen(true); }}>{sessionStarted ? "Resume" : "Start"}</button>
                  )}
                  <button type="button" className="btn btn-s btn-sm" aria-expanded={open} onClick={() => setQuickEditOpen((current) => ({ ...current, [session.id]: !open }))}>{open ? "Hide" : "Quick edit"}</button>
                </div>
              )}
              {session.emphasis && <p className="t-s c2" style={{ paddingBottom: 4 }}>{session.emphasis}</p>}
              {open && <QuickEdit lifting={lifts} workout={wo} allData={allData} todayKey={todayKey} updateToday={updateToday} onPR={checkPR} />}
              {session.cardio && cardioBlock({
                cardio: session.cardio,
                logged: wo.cardioSessions?.[session.id] || {},
                path: `workout.cardioSessions.${session.id}`,
                onStart: () => { setActiveCardioSessionId(session.id); setCardioSessionOpen(true); },
                startLabel: isRunCardio(session.cardio) ? "Start run" : "Start cardio",
              })}
            </div>
          );
        })}

        {!sessionAwareProgram && plannedLifting.length > 0 && (
          <div>
            <div className="row">
              <Icon name="train" />
              <span className="kv grow"><span className="t-bs clip">{p.type || "Lifting"}</span><span className="t-s c2">Lifting · {doneExercises - skippedExercises} of {plannedLifting.length}{"\u00a0"}exercises done{skippedExercises ? `, ${skippedExercises} skipped` : ""}</span></span>
              <button type="button" className="btn btn-s btn-sm" aria-expanded={Boolean(quickEditOpen.main)} onClick={() => setQuickEditOpen((current) => ({ ...current, main: !current.main }))}>{quickEditOpen.main ? "Hide" : "Quick edit"}</button>
            </div>
            {quickEditOpen.main && <QuickEdit lifting={plannedLifting} workout={wo} allData={allData} todayKey={todayKey} updateToday={updateToday} onPR={checkPR} />}
          </div>
        )}

        {!sessionAwareProgram && p.cardio && cardioBlock({
          cardio: p.cardio,
          logged: wo.cardio || {},
          path: "workout.cardio",
          onStart: () => setCardioSessionOpen(true),
          startLabel: isRunCardio(p.cardio) ? "Start run" : "Start cardio",
        })}

        {/* A run nobody planned still gets logged: the same three fields, on any day. */}
        {!hasPlainCardio && (
          <div>
            <div className="row">
              <Icon name="run" />
              <span className="kv grow"><span className="t-bs">{hasPlannedCardio ? "Another run" : "Run"}</span><span className="t-s c2">{unplannedRunLogged ? `${wo.cardio.miles || "—"}${"\u00a0"}mi · ${wo.cardio.time || "no time"}` : "Not logged"}</span></span>
              <button type="button" className="btn btn-s btn-sm" aria-expanded={runOpen || unplannedRunLogged} onClick={() => setRunOpen((open) => !open)}>{runOpen ? "Hide" : unplannedRunLogged ? "Edit" : "Log run"}</button>
            </div>
            {runOpen && <div style={{ paddingBottom: 8 }}><RunFields logged={wo.cardio || {}} onChange={(field, value) => updateToday(`workout.cardio.${field}`, value)} /></div>}
          </div>
        )}

        {isLoggingPast && plannedLifting.length === 0 && !hasPlannedCardio && (
          <div className="row"><Icon name="done" className="good" /><span className="kv grow"><span className="t-bs">Rest day</span><span className="t-s c2">No training was planned.</span></span></div>
        )}
        </div>

        {/* Strava: appears only when the displayed day has a recorded
            activity and no cardio logged by hand. One tap fills the same
            cardio fields the loggers above write. */}
        {stravaSuggestion && (() => {
          const suggestionEntry = stravaSuggestion.dateKey === todayKey ? todayData : (allData?.[stravaSuggestion.dateKey] || defaultDay());
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
                const label = stravaSuggestion.dayLabel === "Today" ? "Today’s cardio"
                  : stravaSuggestion.dayLabel === "Yesterday" ? "Yesterday’s cardio"
                  : `Cardio for ${stravaSuggestion.dayLabel}`;
                showToast(`${label} filled from Strava`);
              }}
            />
          );
        })()}
      </section>

      <section data-section="telemetry" style={isBroadsheet ? { display: "flex", flexDirection: "column", gap: 12, minWidth: 0 } : { display: "contents" }}>
        {!isLoggingPast && (
          <div style={isBroadsheet ? undefined : { borderTop: "1px solid var(--line)", paddingTop: 12 }}>
            <DayProgress ops={ops} primary={closeIsNext} />
          </div>
        )}

        <div ref={checkinRef} style={{ scrollMarginTop: 64, borderTop: "1px solid var(--line)", paddingTop: 4 }}>
          <DailyLog bod={bod} wo={wo} supplements={todayData.supplements} userSupps={userSupps} updateToday={updateToday} defaultOpen={Boolean(isLoggingPast)} />
        </div>

        {isLoggingPast && <button type="button" className="btn btn-p btn-b" onClick={() => setLogDate(null)}>Back to today</button>}

        {/* Telemetry: 1440 px and up only. */}
        {isBroadsheet && !isLoggingPast && (<>
          <section className="card" data-plate="load-model" aria-labelledby="load-model" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div className="sec"><h2 id="load-model" className="t-ss">Training load</h2><span className="t-s c2">{bsLoad?.zoneInfo?.label || ""}</span></div>
            {bsLoad && bsLoad.rolling.zone !== "insufficient_data" ? (
              <>
                <dl style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
                  <div className="kv"><dt className="t-c c2">Last 7 days</dt><dd className="n-md">{Math.round(bsLoad.rolling.acute)}</dd></div>
                  <div className="kv"><dt className="t-c c2">Last 28 days</dt><dd className="n-md">{Math.round(bsLoad.rolling.chronic)}</dd></div>
                  <div className="kv"><dt className="t-c c2">Ratio</dt><dd className="n-md">{bsLoad.rolling.ratio.toFixed(2)}</dd></div>
                </dl>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 32 }} role="img" aria-label="Daily load over the last 14 days">
                  {bsLoad.daily.slice(0, 14).reverse().map((d, i) => {
                    const max = Math.max(...bsLoad.daily.slice(0, 14).map((x) => x.load || 0), 1);
                    return <div key={i} style={{ flex: 1, height: `${Math.max(((d.load || 0) / max) * 100, 4)}%`, background: (d.load || 0) > 0 ? "var(--ink)" : "var(--line)", borderRadius: 1 }} />;
                  })}
                </div>
                <p className="t-c c2">Daily load, last 14 days</p>
                {(() => { const f = (whoopGrouped || stravaByDate) ? findUnloggedLoadDays(bsLoad.daily, whoopGrouped, { window: 14, stravaByDate }) : []; return f.length > 0 ? (
                  <AdvisoryNote compact>{f.length} unlogged-load day{f.length > 1 ? "s" : ""} — ratio understates load</AdvisoryNote>
                ) : null; })()}
              </>
            ) : (
              <p className="t-s c2">Not enough training history for the load ratio yet. It needs about two weeks of logged sessions.</p>
            )}
          </section>
          {(bsWhoop?.cycle || bsOuraLatest?.day?.activity) && (
            <section className="card" data-plate="wearable-load" aria-labelledby="wearable-load" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div className="sec"><h2 id="wearable-load" className="t-ss">From your wearables</h2><span className="t-s c2">Shown only, never scored</span></div>
              <ul className="rows">
                {Number.isFinite(bsWhoop?.cycle?.strain) && (
                  <li className="row" style={{ minHeight: 36 }}><span className="t-s grow">Whoop strain</span><span className="n-s">{bsWhoop.cycle.strain.toFixed(1)}</span></li>
                )}
                {bsOuraLatest?.day?.activity && (
                  <li className="row" style={{ minHeight: 36 }}>
                    <span className="t-s grow">Oura activity</span>
                    <span className="n-s">
                      {[Number.isFinite(bsOuraLatest.day.activity.active_calories) ? `${bsOuraLatest.day.activity.active_calories} kcal` : null,
                        Number.isFinite(bsOuraLatest.day.activity.steps) ? `${bsOuraLatest.day.activity.steps.toLocaleString()} steps` : null,
                      ].filter(Boolean).join(" · ") || "synced"}
                    </span>
                  </li>
                )}
              </ul>
            </section>
          )}
        </>)}
      </section>
      </div>

      {!isLoggingPast && (
        <CallSheets
          ops={ops}
          decision={todayDecision}
          currentResponse={decisionResponse}
          onResponse={recordDecisionResponse}
          feedbackBrief={decisionFeedbackBrief}
          onOpenRecovery={() => setTab?.("Recovery")}
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
        />
      )}

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
            onFinish={() => setSessionDone(true)}
            sessionLabel={[activeLiftingSession.label && activeLiftingSession.label !== "Session" ? activeLiftingSession.label : null, activeLiftingSession.title || null].filter(Boolean).join(" · ") || sessionTitle || "Lifting session"}
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

// Daily log
// Weight, sleep and the optional recovery numbers, the illness flag,
// supplements and a note, behind one disclosure. Every updateToday path
// (body.*, supplements.<name>, workout.notes) is the one it has always been.
function DailyLog({ bod, wo, supplements, userSupps, updateToday, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const [moreOpen, setMoreOpen] = useState(false);
  const taken = userSupps.filter((s) => supplements?.[s]).length;
  // What is in the log so far, in plain words, for the closed row.
  const summary = [
    bod.weight ? `${bod.weight}\u00a0lb` : null,
    bod.sleep ? `${bod.sleep}\u00a0h sleep` : null,
    userSupps.length ? `${taken} of ${userSupps.length} supplements` : null,
    wo.notes ? "note added" : null,
  ].filter(Boolean).join(" · ") || "Nothing logged yet";
  const field = (key, label, inputMode) => (
    <label className="field" key={key}>
      <span className="lbl">{label}</span>
      <input className="input n" type="number" inputMode={inputMode} autoComplete="off" value={bod[key] || ""} onChange={(e) => updateToday(`body.${key}`, e.target.value)} />
    </label>
  );

  return (
    <section data-section="daily-log" aria-label="Daily log" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <button type="button" className="row" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="kv grow">
          <span className="t-bs">Daily log</span>
          <span className="t-s c2">{open ? "Weight, sleep, resting heart rate, HRV, supplements, notes" : summary}</span>
        </span>
        <Icon name={open ? "up" : "down"} size="s" className="c2" />
      </button>

      {open && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "12px 16px" }}>
            {field("weight", "Weight (lb)", "decimal")}
            {field("sleep", "Sleep (h)", "decimal")}
            {field("restingHeartRate", "Resting HR (bpm)", "numeric")}
            {field("hrv", "HRV (ms)", "decimal")}
          </div>

          <button type="button" className="btn btn-g btn-sm" aria-expanded={moreOpen} onClick={() => setMoreOpen((o) => !o)} style={{ alignSelf: "flex-start", paddingLeft: 0 }}>
            {moreOpen ? "Hide motivation and illness flag" : "More: motivation, illness flag"}
          </button>
          {moreOpen && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <label className="field" style={{ maxWidth: 180 }}>
                <span className="lbl">Motivation (1 to 10)</span>
                <input className="input n" type="number" inputMode="numeric" min="1" max="10" autoComplete="off" value={bod.motivation || ""} onChange={(e) => updateToday("body.motivation", e.target.value)} />
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 44 }}>
                <span className="kv grow"><span id="illness-flag" className="t-bs">Illness or injury today</span><span className="t-s c2">When this is on, the call stays easy at most.</span></span>
                <Switch checked={Boolean(bod.illnessOrInjury)} onChange={(next) => updateToday("body.illnessOrInjury", next)} labelledBy="illness-flag" />
              </div>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="sec"><h3 className="t-ss">Supplements</h3><span className="t-s c2">{taken} of {userSupps.length}</span></div>
            <div className="chips">
              {userSupps.map((s) => {
                const on = Boolean(supplements?.[s]);
                return <button key={s} type="button" className="chip" aria-pressed={on} onClick={() => updateToday(`supplements.${s}`, !on)}>{s}</button>;
              })}
            </div>
          </div>

          <label className="field">
            <span className="lbl">Notes for today (optional)</span>
            <textarea className="input area" rows={2} value={wo.notes || ""} onChange={(e) => updateToday("workout.notes", e.target.value)} />
          </label>
        </>
      )}
    </section>
  );
}

// Epley formula: weight × (1 + reps/30). Only meaningful for sets ≤ 12 reps.
// Epley1RM moved to sessionIntelligence.js (canonical home for lift
// math); imported for local use in ExerciseLogger and re-exported so
// existing importers (ProgressTab) keep working.
import { epley1RM, effectiveE1RM, priorBestWeight } from "./sessionIntelligence";
export { epley1RM };

// Planned minutes (race-plan runs carry them), effort, and the pace target
// when the plan has one. Old programs show the effort alone.
function cardioMeta(cardio) {
  return [
    Number(cardio?.minutes) > 0 ? `${cardio.minutes}\u00a0min` : null,
    cardio?.effort || null,
    cardio?.targetPace || null,
  ].filter(Boolean).join(" · ");
}

// Session notes above the cardio fields. A short note is shown as it is; a
// long one (interval ladders, alternating weeks) folds behind a disclosure so
// the fields stay in reach, and opens as one line per sentence.
function CardioNotes({ notes }) {
  const [open, setOpen] = useState(false);
  if (notes.length <= 60) return <p className="t-s c2">{notes}</p>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <button type="button" className="btn btn-g btn-sm" aria-expanded={open} onClick={() => setOpen((o) => !o)} style={{ alignSelf: "flex-start", paddingLeft: 0 }}>{open ? "Hide session notes" : "Session notes"}</button>
      {open && <ul className="lst">{notes.split(/(?<=\.)\s+/).map((line, i) => <li key={i}>{line}</li>)}</ul>}
    </div>
  );
}

// Exercise logger
// One exercise as a grid of sets: load, reps, reps in reserve, and a done
// toggle per row. Quick edit uses it to correct a log without the runner.
// memo: keeps every grid from re-rendering when unrelated state changes
// (a keystroke in a nutrition field, say).
const ExerciseLogger = memo(function ExerciseLogger({ exercise, data, onChange, onPR, lastSets = null }) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [errors, setErrors] = useState({});
  const mode = resolveTrackingMode(exercise);
  const sets = reconcileExerciseSets(exercise, data.sets || []);
  const done = sets.filter((set) => isCompletedSet(set, exercise)).length;
  const name = data.performedName || exercise.name;
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

  // Column heads and the two fields each tracking mode logs. Each field keeps
  // the set property it has always written.
  const columns = mode === TRACKING_MODES.TIMED_HOLD ? [
    { head: "Seconds", prop: "duration", label: "duration", inputMode: "numeric", placeholder: String(exercise.reps) },
    { head: "Added lb", prop: "weight", label: "added load", inputMode: "decimal", placeholder: "0" },
  ] : mode === TRACKING_MODES.CARRY ? [
    { head: "lb", prop: "weight", label: "load", inputMode: "decimal", placeholder: "" },
    { head: "Yards", prop: "distance", label: "distance", inputMode: "numeric", placeholder: String(exercise.reps) },
  ] : mode === TRACKING_MODES.ASSISTED_REPS ? [
    { head: "Assist lb", prop: "assistance", label: "assistance", inputMode: "decimal", placeholder: "" },
    { head: "Reps", prop: "reps", label: "reps", inputMode: "numeric", placeholder: String(exercise.reps) },
  ] : [
    { head: mode === TRACKING_MODES.BODYWEIGHT_REPS ? "Added lb" : "lb", prop: "weight", label: "load", inputMode: "decimal", placeholder: mode === TRACKING_MODES.BODYWEIGHT_REPS ? "0" : "" },
    { head: "Reps", prop: "reps", label: "reps", inputMode: "numeric", placeholder: String(exercise.reps) },
  ];
  const ghostable = mode !== TRACKING_MODES.TIMED_HOLD && mode !== TRACKING_MODES.CARRY;

  return (
    <section className="sets" aria-label={name}>
      <div className="sec">
        <h3 className="t-ss grow clip">{name}</h3>
        <span className="n-s c2">{exercise.sets}{" "}×{" "}{exercise.reps} · {done}/{exercise.sets}</span>
      </div>
      {best1RM > 0 && <p className="t-s c2">Estimated one-rep max <span className="n-s">{best1RM}{" "}lb</span></p>}
      {exercise.notes && (
        <>
          <button type="button" className="btn btn-g btn-sm" aria-expanded={noteOpen} onClick={() => setNoteOpen((open) => !open)} style={{ alignSelf: "flex-start", paddingLeft: 0 }}>{noteOpen ? "Hide exercise note" : "Show exercise note"}</button>
          {noteOpen && <p className="banner">{exercise.notes}</p>}
        </>
      )}
      {data.skipped && (
        <div className="row" data-testid="skip-tag">
          <span className="t-s c2 grow">Skipped: {data.skipped}</span>
          <button type="button" className="btn btn-s btn-sm" onClick={() => onChange({ ...data, skipped: undefined })}>Undo skip</button>
        </div>
      )}
      <div className="sets-h" aria-hidden="true"><span>Set</span><span>{columns[0].head}</span><span>{columns[1].head}</span><span>RIR</span><span>Done</span></div>
      {sets.map((set, index) => (
        <div key={index} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {ghostable && index === firstEmptyIndex(sets) && (
            <GhostChip ghost={ghostForSet(sets, index, lastSets)} onFill={({ weight, reps }) => onChange({ ...data, sets: sets.map((entry, setIndex) => setIndex === index ? { ...entry, weight, reps } : entry) })} />
          )}
          <div className={`sets-r${set.done ? " is-done" : ""}`}>
            <span className="n-s c2">{index + 1}</span>
            {columns.map((column) => (
              <input key={column.prop} className="input n" type="number" inputMode={column.inputMode} autoComplete="off" placeholder={column.placeholder} value={set[column.prop] || ""} onChange={(event) => updateSet(index, column.prop, event.target.value)} aria-label={`${name}, set ${index + 1} ${column.label}`} aria-invalid={errors[index] ? "true" : undefined} />
            ))}
            <input className="input n" type="number" inputMode="numeric" min="0" max="9" autoComplete="off" value={set.rir || ""} onChange={(event) => updateSet(index, "rir", event.target.value)} aria-label={`${name}, set ${index + 1} reps in reserve`} />
            <button type="button" className="ibtn ibtn-o" aria-pressed={Boolean(set.done)} aria-label={`${name}, set ${index + 1} done`} onClick={() => toggleDone(index)}><Icon name="check" size="s" /></button>
          </div>
          {errors[index] && <p className="err" role="alert"><Icon name="warn" size="s" />{errors[index]}</p>}
          <CascadeSet set={set} showOffer isLast={index === sets.length - 1} onChange={(nextSet) => onChange({ ...data, sets: sets.map((entry, setIndex) => setIndex === index ? nextSet : entry) })} />
        </div>
      ))}
    </section>
  );
}); // end memo(ExerciseLogger)

