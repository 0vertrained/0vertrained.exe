// src/ProgressTab.jsx
// Progress opens on one thing, this week's likely limiter, with the weekly
// review behind it. Under that are the trends, each its own screen: Strength,
// Running, Body, Recovery, and History. Block (the periodization view) opens
// from Train. Every screen reads the same logged data it always has; nothing
// here writes to a program or a workout.
import { Fragment, useState, useEffect, useRef, lazy, Suspense } from "react";
import { useMediaQuery, BROADSHEET_QUERY } from "./ui/useMediaQuery";
import { useTheme } from "./theme";
import { Icon, QuickNumber } from "./ui/ledger";
import { useTopBar } from "./ui/shell";
import { DEFAULT_PROGRAM, getTodayKey, getDayName } from "./constants";
import { calcRecoveryScore, calcWeeklyReview } from "./recovery";
import { buildWeeklyCoachReview } from "./weeklyCoachReview";
import { buildCoachingCalibrationProfile } from "./coachingCalibration";
import { WeeklyCoachingReview, weekInNumbers } from "./WeeklyCoachingReview";
import { ClinicianGuardrailsCard } from "./ClinicianGuardrailsCard";
import { isOuraConnected, loadOuraData } from "./oura";
import { isWhoopConnected, loadWhoopData } from "./whoop";
import { buildDailyLoads, computeRollingLoads } from "./loadModel";
import { buildDecisionContext, getDailyRecommendation } from "./decisionEngine";
import { buildDecisionFeedbackWeekly } from "./decisionFeedback";
import { buildPeriodizationPlan, suggestPeriodizationAction } from "./periodizationPlanner";
import {
  PERIODIZATION_GOAL_PRESETS,
  RUN_EMPHASIS_OPTIONS,
  STRENGTH_EMPHASIS_OPTIONS,
  normalizePeriodizationSettings,
  describePeriodizationPreview,
  periodizationSettingsChanged,
  buildPeriodizationStoragePatch,
  buildNextBlockSettings,
  buildBlockSnapshot,
  appendBlockHistory,
  readStoredPeriodization,
  writeStoredPeriodization,
  readStoredPeriodizationHistory,
  writeStoredPeriodizationHistory,
} from "./periodizationSettings";
import { calcStreak } from "./AppHeader";
import { LoadingShell } from "./ui/primitives";
import { getSkeletonPlan } from "./uiStability";
import { buildProgressLimiters, buildProgressEvidence, buildBlockProgressPreview } from "./progressSummary";
import { buildWearableTrendNotes } from "./recovery/wearableProgressContext";
import { epley1RM } from "./TodayTab";
import { ProgressHistory } from "./ProgressHistory";
import { RaceWeekLine } from "./RaceWeekLine";
import { ColumnChart, dayDate } from "./sections/charts";

const lazyNamed = (loader, name) => lazy(() => loader().then((module) => ({ default: module[name] })));
const CalibrationReport = lazyNamed(() => import("./ProgressInsights"), "CalibrationReport");
const CorrelationExplorer = lazyNamed(() => import("./ProgressInsights"), "CorrelationExplorer");
const WeightTrendFigure = lazyNamed(() => import("./WeightTrendFigure"), "WeightTrendFigure");
const RunningVolumeFigure = lazyNamed(() => import("./sections/RunningVolumeFigure"), "RunningVolumeFigure");
const MuscleVolumeSection = lazyNamed(() => import("./MuscleVolumeSection"), "MuscleVolumeSection");
const LiftIntelligenceSection = lazyNamed(() => import("./LiftIntelligenceSection"), "LiftIntelligenceSection");
const MuscleRecencyMap = lazyNamed(() => import("./LiftIntelligenceSection"), "MuscleRecencyMap");
const RaceBlockSection = lazyNamed(() => import("./RaceBlockSection"), "RaceBlockSection");
const RecoveryLoadFigure = lazyNamed(() => import("./sections/TrendCharts"), "RecoveryLoadFigure");

const NBSP = "\u00a0";
const SCREEN_TITLES = { strength: "Strength", running: "Running", body: "Body", recovery: "Recovery", review: "Weekly review", history: "History", periodization: "Block" };
const column = (gap) => ({ display: "flex", flexDirection: "column", gap });

// Pace is logged as "m:ss" per mile.
function paceToSeconds(paceStr) {
  if (!paceStr || typeof paceStr !== "string") return null;
  const parts = paceStr.replace("/mile", "").replace("/mi", "").trim().split(":");
  if (parts.length !== 2) return null;
  const mins = parseInt(parts[0], 10);
  const secs = parseInt(parts[1], 10);
  if (isNaN(mins) || isNaN(secs)) return null;
  return mins * 60 + secs;
}
function secondsToPace(secs) {
  const whole = Math.round(secs);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

// Progress tab
export function ProgressTab({  data, settings, program, loaded, updateEntryAtDate, showToast, onSaveCoachingSettings, initialSubView = null, onOpenDay, onExit }) {
  const { C, S } = useTheme();
  const mono = C.fontFamily;
  // Train links straight to the block ("program") and to history; Back from
  // either returns there.
  // home | strength | running | body | recovery | review | history | periodization
  const landing = initialSubView === "program" ? "periodization" : initialSubView === "history" ? "history" : null;
  const [subView, setSubView] = useState(landing || "home");
  const [selectedDay, setSelectedDay] = useState(null);
  const isBroadsheet = useMediaQuery(BROADSHEET_QUERY);
  const [periodizationEditOpen, setPeriodizationEditOpen] = useState(false);
  // Block settings persist via a namespaced localStorage key (see periodizationSettings.js
  // PERSISTENCE NOTE). Saved = last persisted; Draft = in-flight edits.
  const [periodizationSaved, setPeriodizationSaved] = useState(() => normalizePeriodizationSettings(readStoredPeriodization() || {}));
  const [periodizationDraft, setPeriodizationDraft] = useState(periodizationSaved);
  const [periodizationHistory, setPeriodizationHistory] = useState(() => readStoredPeriodizationHistory());
  const [wearableTrends, setWearableTrends] = useState(() => buildWearableTrendNotes({}));

  // A screen under Progress: its name in the top bar, and Back to where it
  // came from. A day opened from History on a phone goes back to History.
  const dayOpen = Boolean(selectedDay) && !isBroadsheet && subView === "history";
  const fromTrain = Boolean(onExit) && subView === landing;
  useTopBar(subView === "home" ? null : dayOpen
    ? { title: dayDate(selectedDay), back: "History", onBack: () => setSelectedDay(null) }
    : { title: SCREEN_TITLES[subView] || "Progress", back: fromTrain ? "Train" : "Progress", onBack: () => { setSelectedDay(null); if (fromTrain) onExit(); else setSubView("home"); } });
  // Each screen starts at its top.
  const firstView = useRef(true);
  useEffect(() => {
    if (firstView.current) { firstView.current = false; return; }
    (document.scrollingElement || document.documentElement).scrollTop = 0;
  }, [subView, dayOpen]);

  useEffect(() => {
    let cancelled = false;
    if (!loaded) {
      setWearableTrends(buildWearableTrendNotes({}));
      return () => { cancelled = true; };
    }
    (async () => {
      try {
        const [ouraOn, whoopOn] = await Promise.all([
          isOuraConnected().catch(() => false),
          isWhoopConnected().catch(() => false),
        ]);
        const [ouraData, whoopData] = await Promise.all([
          ouraOn ? loadOuraData(30).catch(() => ({})) : Promise.resolve({}),
          whoopOn ? loadWhoopData(30).catch(() => ({})) : Promise.resolve({}),
        ]);
        if (!cancelled) {
          setWearableTrends(buildWearableTrendNotes({ ouraData, whoopData, manualData: null, days: 30 }));
        }
      } catch {
        if (!cancelled) setWearableTrends(buildWearableTrendNotes({}));
      }
    })();
    return () => { cancelled = true; };
  }, [loaded, settings?.ouraConnected, settings?.whoopConnected]);
  
  // Show loading state if app data hasn't loaded yet. Keep hooks above this guard
  // so switching from loading → loaded never changes hook order.
  if (!loaded) return <LoadingShell plan={getSkeletonPlan("Progress")} />;
  const entries  = Object.entries(data).sort((a,b) => a[0].localeCompare(b[0]));
  const last30   = entries.slice(-30);
  const avg      = arr => arr.length ? (arr.reduce((a,b)=>a+b,0)/arr.length).toFixed(1) : "—";
  const weights  = last30.map(([,d]) => parseFloat(d.body?.weight)).filter(Boolean);
  const proteins = last30.map(([,d]) => parseFloat(d.nutrition?.protein)).filter(Boolean);
  const sleeps   = last30.map(([,d]) => parseFloat(d.body?.sleep)).filter(Boolean);
  const workoutsDone = entries.filter(([,d]) => {
    return Object.keys(d.workout?.exercises||{}).length > 0 || parseFloat(d.workout?.cardio?.miles) > 0;
  }).length;
  const totalMiles = entries.reduce((acc,[,d]) => acc+(parseFloat(d.workout?.cardio?.miles)||0),0);
  const goals = settings?.goals || { protein:200, calories:3600, water:128 };
  const review = calcWeeklyReview(data, goals);
  const TARGET_LABELS = review.targetLabels || ["5 or more workouts", "15 or more miles", `${goals.protein} g protein on 5 days`, "7 hours of sleep a night", "Water goal on 5 days"];
  const calibrationProfile = buildCoachingCalibrationProfile({ data, wearableTrends });
  const coachReview = buildWeeklyCoachReview({ data, goals, settings, program, wearableTrends, calibrationProfile });
  const decisionFeedback = buildDecisionFeedbackWeekly(data);
  const streak = calcStreak(data);

  // ── Periodization sub-view ──
  if (subView === "periodization") {
    const blockStart = periodizationDraft.startDate || entries[0]?.[0] || getTodayKey();
    const plan = buildPeriodizationPlan({
      startDate: blockStart,
      todayKey: getTodayKey(),
      program,
      entries: data,
      blockLengthWeeks: periodizationDraft.blockLengthWeeks,
      blockName: periodizationDraft.name,
      goal: periodizationDraft.goal,
      deloadWeek: periodizationDraft.deloadWeek,
      runEmphasis: periodizationDraft.runEmphasis,
      strengthEmphasis: periodizationDraft.strengthEmphasis,
    });
    const today = getTodayKey();
    const yesterdayKeyForRecovery = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; })();
    const todayName = getDayName(new Date(today + "T12:00:00"));
    const dailyLoads = buildDailyLoads(data, 28);
    const trainingLoad = computeRollingLoads(dailyLoads);
    const recovery = calcRecoveryScore(data[yesterdayKeyForRecovery], data, yesterdayKeyForRecovery);
    const dailyRecommendation = getDailyRecommendation(buildDecisionContext({
      todayProgram: program?.[todayName] || DEFAULT_PROGRAM[todayName],
      entries: data,
      settings,
      trainingLoad,
      todayKey: today,
      recovery,
    }));
    const action = suggestPeriodizationAction({ plan, todayKey: today, recommendation: dailyRecommendation, entries: data, trainingLoad });
    const current = action.currentWeek;
    const riskColor = action.risk === "high" ? C.red : action.risk === "medium" ? C.text : C.green;

    // ── Block settings lifecycle (suggest-only; never writes program/workouts) ──
    const periodizationDirty = periodizationSettingsChanged(periodizationSaved, periodizationDraft);
    const previewLines = describePeriodizationPreview(periodizationSaved, periodizationDraft);
    const blockEnded = !!plan.endDate && today > plan.endDate;
    const cap = (s) => (typeof s === "string" && s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

    const commitPeriodization = (settingsObj, opts = {}) => {
      const patch = buildPeriodizationStoragePatch({ ...settingsObj, savedAt: new Date().toISOString() });
      writeStoredPeriodization(patch);
      const normalized = normalizePeriodizationSettings(patch);
      setPeriodizationSaved(normalized);
      setPeriodizationDraft(normalized);
      if (opts.history) {
        writeStoredPeriodizationHistory(opts.history);
        setPeriodizationHistory(opts.history);
      }
      setPeriodizationEditOpen(false);
    };
    const handleSavePeriodization = () => commitPeriodization(periodizationDraft);
    const handleResetPeriodization = () => setPeriodizationDraft(periodizationSaved);
    const handleCancelPeriodization = () => { setPeriodizationDraft(periodizationSaved); setPeriodizationEditOpen(false); };
    const handleStartNextBlock = () => {
      const snapshot = buildBlockSnapshot(plan, today);
      const nextHistory = appendBlockHistory(periodizationHistory, snapshot);
      commitPeriodization(buildNextBlockSettings(plan), { history: nextHistory });
    };

    const statusColor = (status) => status === "current" ? C.text : status === "completed" ? C.textFaint : C.textDim;
    const previousBlock = periodizationHistory[0] || null;

    return (
      <div className="legacy-screen">

        {/* Broadsheet Program spread: summary, race block,
            and this-week guidance rail left; the week table + block history —
            the part that reads as a table — gets the width. */}
        <div style={isBroadsheet ? { display: "grid", gridTemplateColumns: "var(--ovt-rail-m) 1fr", gap: 20, alignItems: "start" } : { display: "contents" }}>
        <section data-section="prog-rail" style={isBroadsheet ? { display: "flex", flexDirection: "column", gap: 12, minWidth: 0 } : { display: "contents" }}>
        {/* ── Polished summary card ── */}
        <div style={S.block}>
          <div style={S.blockHead}>
            <span style={S.blockTitle}>{"> "}Block</span>
            {!periodizationEditOpen && <button onClick={() => setPeriodizationEditOpen(true)} style={{ ...S.smallBtn, padding:"4px 10px", fontSize:9.5 }}>Edit block</button>}
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", gap:10, marginBottom:6 }}>
            <span style={{ fontSize:16, color:C.text, letterSpacing:"0.04em", textTransform:"uppercase", fontWeight:600 }}>{plan.name}</span>
            <span style={{ ...S.blockStat, color:C.text, fontSize:11 }}>Week {plan.currentWeekNumber}/{plan.blockLengthWeeks}</span>
          </div>
          <div style={{ fontFamily:S.fontSerif, fontStyle:"italic", color:C.textDim, fontSize:14, lineHeight:1.35, marginBottom:8 }}>{plan.goal}</div>
          <div style={S.ruledRow}><span style={S.ruledLabel}>Dates</span><span style={S.ruledValue}>{plan.startDate} → {plan.endDate}</span></div>
          <div style={S.ruledRow}><span style={S.ruledLabel}>Structure</span><span style={S.ruledValue}>{plan.blockLengthWeeks} weeks · Deload W{plan.deloadWeek}</span></div>
          <div style={S.ruledRow}><span style={S.ruledLabel}>Emphasis</span><span style={S.ruledValue}>Run {cap(plan.emphasis.run)} · Strength {cap(plan.emphasis.strength)}</span></div>
          <div style={S.ruledRow}><span style={S.ruledLabel}>Progress</span><span style={S.ruledValue}>{plan.completionPct}%</span></div>
          <div style={{ ...S.annotation, marginTop:8 }}>planner guidance only — no weekly program or workout is rewritten</div>
          {blockEnded && (
            <div style={{ marginTop:10, borderTop:`1px solid ${C.line}`, paddingTop:10, display:"flex", justifyContent:"space-between", alignItems:"center", gap:10 }}>
              <span style={{ fontSize:11.5, color:C.textDim }}>This block has ended.</span>
              <button onClick={handleStartNextBlock} style={{ ...S.smallBtn, padding:"6px 12px", fontSize:10, borderColor:C.text }}>Start next block</button>
            </div>
          )}
        </div>

        {/* ── Race block — countdown, taper flag, station benchmarks ── */}
        <Suspense fallback={<div style={S.block}><div style={S.annotation}>Loading race block…</div></div>}>
          <RaceBlockSection program={program} />
        </Suspense>

        {/* ── Edit mode ── */}
        {periodizationEditOpen && (
          <div style={S.block}>
            <div style={S.blockHead}>
              <span style={S.blockTitle}>{"> "}Block Settings</span>
              <span style={{ ...S.blockStat, color: periodizationDirty ? C.text : C.textFaint }}>{periodizationDirty ? "unsaved" : "saved"}</span>
            </div>

            {/* Identity */}
            <div style={{ ...S.annotation, marginBottom:8, color:C.textDim }}>Identity</div>
            <div style={{ display:"grid", gap:9, marginBottom:14 }}>
              <label style={{ display:"grid", gap:4 }}>
                <span style={S.ruledLabel}>Block name</span>
                <input value={periodizationDraft.name} onChange={e => setPeriodizationDraft(d => ({ ...d, name:e.target.value }))} style={{ background:C.cell, border:`1px solid ${C.lineBright}`, color:C.text, padding:"8px 9px", fontFamily:mono, fontSize:13 }} />
              </label>
              <label style={{ display:"grid", gap:4 }}>
                <span style={S.ruledLabel}>Goal preset</span>
                <select value={periodizationDraft.goalPreset} onChange={e => {
                  const preset = e.target.value;
                  const presetGoal = PERIODIZATION_GOAL_PRESETS[preset]?.goal || "";
                  setPeriodizationDraft(d => ({ ...d, goalPreset:preset, goal: preset === "custom" ? d.goal : (presetGoal || d.goal) }));
                }} style={{ background:C.cell, border:`1px solid ${C.lineBright}`, color:C.text, padding:"8px 9px", fontFamily:mono, fontSize:13 }}>
                  {Object.entries(PERIODIZATION_GOAL_PRESETS).map(([key, p]) => <option key={key} value={key}>{p.label}</option>)}
                </select>
              </label>
              <label style={{ display:"grid", gap:4 }}>
                <span style={S.ruledLabel}>Goal description</span>
                <textarea value={periodizationDraft.goal} onChange={e => setPeriodizationDraft(d => ({ ...d, goal:e.target.value }))} rows={2} style={{ background:C.cell, border:`1px solid ${C.lineBright}`, color:C.text, padding:"8px 9px", fontFamily:mono, fontSize:13, resize:"vertical" }} />
              </label>
            </div>

            {/* Structure */}
            <div style={{ ...S.annotation, marginBottom:8, color:C.textDim }}>Structure</div>
            <div style={{ display:"grid", gap:9, marginBottom:14 }}>
              <label style={{ display:"grid", gap:4 }}>
                <span style={S.ruledLabel}>Start date</span>
                <input type="date" value={periodizationDraft.startDate || plan.startDate} onChange={e => setPeriodizationDraft(d => ({ ...d, startDate:e.target.value }))} style={{ background:C.cell, border:`1px solid ${C.lineBright}`, color:C.text, padding:"8px 9px", fontFamily:mono, fontSize:13 }} />
              </label>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                <label style={{ display:"grid", gap:4 }}>
                  <span style={S.ruledLabel}>Length</span>
                  <select value={periodizationDraft.blockLengthWeeks} onChange={e => setPeriodizationDraft(d => ({ ...d, blockLengthWeeks:Number(e.target.value), deloadWeek:Math.min(Number(e.target.value), d.deloadWeek || Number(e.target.value)) }))} style={{ background:C.cell, border:`1px solid ${C.lineBright}`, color:C.text, padding:"8px 9px", fontFamily:mono, fontSize:13 }}>
                    {[4,5,6,7,8].map(w => <option key={w} value={w}>{w} weeks</option>)}
                  </select>
                </label>
                <label style={{ display:"grid", gap:4 }}>
                  <span style={S.ruledLabel}>Deload</span>
                  <select value={periodizationDraft.deloadWeek} onChange={e => setPeriodizationDraft(d => ({ ...d, deloadWeek:Number(e.target.value) }))} style={{ background:C.cell, border:`1px solid ${C.lineBright}`, color:C.text, padding:"8px 9px", fontFamily:mono, fontSize:13 }}>
                    {Array.from({ length: Number(periodizationDraft.blockLengthWeeks) || 4 }, (_, i) => i + 1).map(w => <option key={w} value={w}>Week {w}</option>)}
                  </select>
                </label>
              </div>
            </div>

            {/* Emphasis */}
            <div style={{ ...S.annotation, marginBottom:8, color:C.textDim }}>Emphasis</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:6 }}>
              <label style={{ display:"grid", gap:4 }}>
                <span style={S.ruledLabel}>Run</span>
                <select value={periodizationDraft.runEmphasis} onChange={e => setPeriodizationDraft(d => ({ ...d, runEmphasis:e.target.value }))} style={{ background:C.cell, border:`1px solid ${C.lineBright}`, color:C.text, padding:"8px 9px", fontFamily:mono, fontSize:13 }}>
                  {RUN_EMPHASIS_OPTIONS.map(o => <option key={o} value={o}>{cap(o)}</option>)}
                </select>
              </label>
              <label style={{ display:"grid", gap:4 }}>
                <span style={S.ruledLabel}>Strength</span>
                <select value={periodizationDraft.strengthEmphasis} onChange={e => setPeriodizationDraft(d => ({ ...d, strengthEmphasis:e.target.value }))} style={{ background:C.cell, border:`1px solid ${C.lineBright}`, color:C.text, padding:"8px 9px", fontFamily:mono, fontSize:13 }}>
                  {STRENGTH_EMPHASIS_OPTIONS.map(o => <option key={o} value={o}>{cap(o)}</option>)}
                </select>
              </label>
            </div>

            {/* Preview — only when dirty */}
            {periodizationDirty && (
              <div style={{ marginTop:10, borderTop:`1px solid ${C.line}`, paddingTop:10 }}>
                <div style={{ ...S.annotation, marginBottom:6, color:C.textDim }}>Preview</div>
                {previewLines.map((line, idx) => (
                  <div key={idx} style={{ fontSize:11.5, color: idx === previewLines.length - 1 ? C.textFaint : C.textDim, lineHeight:1.5, marginBottom:3, fontStyle: idx === previewLines.length - 1 ? "italic" : "normal" }}>· {line}</div>
                ))}
              </div>
            )}

            {/* Buttons */}
            <div style={{ display:"flex", gap:8, marginTop:12 }}>
              <button onClick={handleSavePeriodization} disabled={!periodizationDirty} style={{ ...S.smallBtn, flex:1, padding:"9px 0", borderColor: periodizationDirty ? C.text : C.line, color: periodizationDirty ? C.text : C.textFaint, cursor: periodizationDirty ? "pointer" : "default", opacity: periodizationDirty ? 1 : 0.6 }}>Save</button>
              <button onClick={handleResetPeriodization} disabled={!periodizationDirty} style={{ ...S.smallBtn, flex:1, padding:"9px 0", opacity: periodizationDirty ? 1 : 0.6, cursor: periodizationDirty ? "pointer" : "default" }}>Reset</button>
              <button onClick={handleCancelPeriodization} style={{ ...S.smallBtn, flex:1, padding:"9px 0" }}>Cancel</button>
            </div>
          </div>
        )}

        {/* ── Current week status ── */}
        <div style={S.block}>
          <div style={S.blockHead}>
            <span style={S.blockTitle}>{"> "}Current Week</span>
            <span style={{ ...S.blockStat, color:riskColor }}>{action.action.replace("_", " ")}</span>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"auto 1fr", gap:14, alignItems:"end" }}>
            <div><span style={S.leadFigure}>W{current?.weekNumber || 1}</span><span style={S.leadUnit}>{current?.focus || "base"}</span></div>
            <div style={{ paddingBottom:7 }}>
              <div style={{ ...S.figureRule, background:riskColor, marginBottom:7 }} />
              <div style={{ fontFamily:S.fontSerif, fontStyle:"italic", color:C.textDim, fontSize:14, lineHeight:1.35 }}>{action.rationale}</div>
            </div>
          </div>
          <div style={{ borderTop:`1px solid ${C.line}`, marginTop:12 }}>
            <div style={S.ruledRow}><span style={S.ruledLabel}>Density</span><span style={S.ruledValue}>{action.density.trainingDays}/7 days · {action.density.miles} mi</span></div>
            <div style={S.ruledRow}><span style={S.ruledLabel}>Weekly template</span><span style={S.ruledValue}>{plan.programAnalysis.liftingDays} lift · {plan.programAnalysis.runDays} run · {plan.programAnalysis.hardDays} hard</span></div>
          </div>
        </div>

        {/* ── Suggested action ── */}
        <div style={S.block}>
          <div style={S.blockHead}><span style={S.blockTitle}>{"> "}Suggested Action</span><span style={{ ...S.blockStat, color:riskColor }}>{action.risk} risk</span></div>
          {(action.suggestedChanges || []).map((change, idx) => (
            <div key={`${change.type}-${idx}`} style={S.ruledRow}>
              <span style={S.ruledLabel}>{change.type}</span>
              <span style={{ ...S.ruledValue, maxWidth:"62%" }}>{change.label}</span>
            </div>
          ))}
          <div style={{ ...S.annotation, marginTop:8 }}>suggest-only — review before changing training. no program edits are made automatically.</div>
        </div>

        </section>
        <section data-section="prog-table" style={isBroadsheet ? { display: "flex", flexDirection: "column", gap: 12, minWidth: 0 } : { display: "contents" }}>
        {/* ── Week list ── */}
        <div style={S.block}>
          <div style={S.blockHead}><span style={S.blockTitle}>{"> "}{plan.blockLengthWeeks}-Week Block</span><span style={S.blockStat}>{plan.programAnalysis.weeklyMiles} MI/WK BASE</span></div>
          {plan.weeks.map(week => {
            const active = week.status === "current";
            return (
              <div key={week.weekNumber} style={{ padding:"10px 0", borderBottom:`1px solid ${C.line}`, borderLeft: active ? `2px solid ${C.text}` : "2px solid transparent", paddingLeft: active ? 8 : 10, opacity: week.status === "completed" ? 0.6 : 1 }}>
                <div style={{ display:"flex", justifyContent:"space-between", gap:8, marginBottom:4 }}>
                  <span style={{ fontSize:13, color:C.text, letterSpacing:"0.05em", textTransform:"uppercase" }}>Week {week.weekNumber} · {week.label}</span>
                  <span style={{ fontSize:10, color:statusColor(week.status), letterSpacing:"0.1em", textTransform:"uppercase" }}>{week.status}</span>
                </div>
                <div style={{ fontSize:11.5, color:C.textDim, lineHeight:1.45 }}>{week.guidance}</div>
                <div style={{ fontSize:10, color:C.textFaint, marginTop:4 }}>{week.startDate} → {week.endDate} · {Math.round(week.volumeMultiplier * 100)}% vol · target {week.targetMiles} mi</div>
              </div>
            );
          })}
        </div>

        {/* ── Block history (current + previous) ── */}
        {previousBlock && (
          <div style={S.block}>
            <div style={S.blockHead}><span style={S.blockTitle}>{"> "}Block History</span><span style={S.blockStat}>{periodizationHistory.length} archived</span></div>
            <div style={S.ruledRow}><span style={S.ruledLabel}>Current</span><span style={S.ruledValue}>{plan.name} · Week {plan.currentWeekNumber}/{plan.blockLengthWeeks}</span></div>
            <div style={S.ruledRow}><span style={S.ruledLabel}>Previous</span><span style={S.ruledValue}>{previousBlock.name} · ended {previousBlock.completedAt || previousBlock.endDate}</span></div>
            <div style={{ ...S.annotation, marginTop:8 }}>last {Math.min(periodizationHistory.length, 6)} blocks kept locally</div>
          </div>
        )}
        </section>
        </div>
      </div>
    );
  }

  if (subView === "history") {
    return (
      <ProgressHistory
        data={data}
        program={program}
        goals={goals}
        selectedDay={selectedDay}
        onSelectDay={setSelectedDay}
        isBroadsheet={isBroadsheet}
        onOpenDay={onOpenDay}
      />
    );
  }

  // Block guidance reuses the saved (not draft) block settings. It is read
  // only: nothing on Progress writes a program or a workout.
  let blockPlanPreview;
  let blockActionPreview;
  try {
    const previewToday = getTodayKey();
    blockPlanPreview = buildPeriodizationPlan({
      startDate: periodizationSaved.startDate || entries[0]?.[0] || previewToday,
      todayKey: previewToday,
      program,
      entries: data,
      blockLengthWeeks: periodizationSaved.blockLengthWeeks,
      blockName: periodizationSaved.name,
      goal: periodizationSaved.goal,
      deloadWeek: periodizationSaved.deloadWeek,
      runEmphasis: periodizationSaved.runEmphasis,
      strengthEmphasis: periodizationSaved.strengthEmphasis,
    });
    blockActionPreview = suggestPeriodizationAction({ plan: blockPlanPreview, todayKey: previewToday, entries: data });
  } catch {
    blockPlanPreview = null;
    blockActionPreview = null;
  }
  const progressLimiters = buildProgressLimiters({ data, goals, review, decisionFeedback });
  const progressEvidence = buildProgressEvidence({ data, goals, settings });
  const blockPreview = buildBlockProgressPreview({ plan: blockPlanPreview, action: blockActionPreview });

  const loading = (label) => <p className="t-s c2" role="status">Loading {label}…</p>;
  const fmtInt = (value) => Math.round(Number(value) || 0).toLocaleString("en-US");
  const limiter = progressLimiters[0] || null;
  const todayKey = getTodayKey();
  const saveToday = (path, message) => (value) => { updateEntryAtDate?.(todayKey, path, String(value)); showToast?.(message); };

  // ── Strength ──
  const topLifts = review.topLifts.length > 0 && (
    <section aria-labelledby="top-lifts" style={column(4)}>
      <h2 id="top-lifts" className="t-h">Heaviest in the last 7 days</h2>
      <ul className="rows">
        {review.topLifts.map(([name, weight]) => {
          const orm = epley1RM(weight, 5); // at 5 reps, as a conservative benchmark
          return (
            <li key={name} className="row" style={{ minHeight: 52 }}>
              <span className="kv grow"><span className="t-bs">{name}</span>{orm && <span className="t-s c2">About {orm}{NBSP}lb for one rep, if that was a set of five</span>}</span>
              <span className="n">{weight}{NBSP}lb</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
  const strengthScreen = [
    <Suspense key="lift" fallback={loading("strength")}>
      <LiftIntelligenceSection data={data} />
    </Suspense>,
    <Suspense key="sets" fallback={loading("sets this week")}>
      <MuscleVolumeSection data={data} />
      <MuscleRecencyMap data={data} />
      {topLifts}
    </Suspense>,
  ];

  // ── Running ──
  const runs = last30
    .map(([date, d]) => {
      const miles = parseFloat(d.workout?.cardio?.miles) || 0;
      return miles > 0 ? { date, miles, time: d.workout.cardio.time || "", pace: paceToSeconds(d.workout.cardio.pace) } : null;
    })
    .filter(Boolean);
  const paced = runs.filter((run) => run.pace);
  const paces = paced.map((run) => run.pace);
  const bestPace = paces.length ? Math.min(...paces) : null;
  const runningScreen = [
    <Suspense key="miles" fallback={loading("weekly miles")}>
      <RunningVolumeFigure data={data} settings={settings} />
    </Suspense>,
    <Fragment key="runs">
      {paced.length >= 2 && (
        <section aria-labelledby="pace-title" style={column(8)}>
          <div className="sec"><h2 id="pace-title" className="t-h">Pace</h2><span className="t-s c2">{paced.length} runs in your last 30 logged days</span></div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
            {[["Best", bestPace], ["Average", paces.reduce((a, b) => a + b, 0) / paces.length], ["Latest", paces[paces.length - 1]]].map(([label, seconds]) => (
              <div key={label} className="kv"><span className="t-c c2">{label}</span><span className="n-md">{secondsToPace(seconds)}</span><span className="t-s c2">min/mi</span></div>
            ))}
          </div>
        </section>
      )}
      <RaceWeekLine program={program} dateKey={todayKey} />
      {runs.length > 0 && (
        <section aria-labelledby="runs-title" style={column(4)}>
          <h2 id="runs-title" className="t-h">Recent runs</h2>
          <ul className="rows">
            {runs.slice(-5).reverse().map((run) => (
              <li key={run.date} className="row" style={{ minHeight: 56 }}>
                <span className="kv grow">
                  <span className="t-bs">{dayDate(run.date)}</span>
                  <span className="n-s c2">{[`${run.miles}${NBSP}mi`, run.time, run.pace ? `${secondsToPace(run.pace)}${NBSP}min/mi` : ""].filter(Boolean).join(" · ")}</span>
                </span>
                {run.pace && run.pace === bestPace && <span className="tag tag-f">Best pace</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="t-s c2">{fmtInt(totalMiles)}{NBSP}mi logged all time.</p>
    </Fragment>,
  ];

  // ── Body ──
  const week7 = Array.from({ length: 7 }, (_, index) => {
    const d = new Date(`${todayKey}T12:00:00`);
    d.setDate(d.getDate() - (6 - index));
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return { key, letter: d.toLocaleDateString("en-US", { weekday: "narrow" }), protein: parseFloat(data[key]?.nutrition?.protein) || 0 };
  });
  const proteinDays = week7.filter((day) => day.protein > 0);
  const proteinGoal = parseFloat(goals.protein) || 0;
  const proteinMet = proteinDays.filter((day) => proteinGoal > 0 && day.protein >= proteinGoal).length;
  const proteinAvg = proteinDays.length ? Math.round(proteinDays.reduce((total, day) => total + day.protein, 0) / proteinDays.length) : 0;
  const waistNow = coachReview.trend.waistCurrent;
  const waistDelta = coachReview.trend.waistDelta;
  const waistChange = waistDelta == null ? "" : waistDelta === 0 ? ", level with last week" : `, ${waistDelta > 0 ? "up" : "down"} ${Math.abs(waistDelta)}${NBSP}in on last week`;
  const waistLine = waistNow ? `${waistNow}${NBSP}in this week${waistChange}` : "No measurement yet this week";
  const bodyScreen = [
    <Suspense key="weight" fallback={loading("bodyweight")}>
      <WeightTrendFigure data={data} onSaveWeight={updateEntryAtDate ? saveToday("body.weight", "Weigh-in saved") : undefined} />
    </Suspense>,
    <Fragment key="rest">
      <div className="row" style={{ borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)", minHeight: 64, flexWrap: "wrap", paddingTop: 8, paddingBottom: 8 }}>
        <span className="kv grow">
          <span className="t-bs">Waist</span>
          <span className="t-s c2">{waistLine}</span>
        </span>
        {updateEntryAtDate && (
          <QuickNumber
            action={waistNow ? "Update waist (in)" : "Add waist (in)"}
            label="This week’s waist (in)"
            hint="Enter your waist in inches, for example 32.5."
            onSave={(value) => { updateEntryAtDate(coachReview.weekEndKey, "body.waist", String(value)); showToast?.("Waist measurement saved"); }}
          />
        )}
      </div>
      <section aria-labelledby="protein-title" style={column(8)}>
        <h2 id="protein-title" className="t-h">Protein, last 7{NBSP}days</h2>
        {proteinDays.length === 0 ? (
          <p className="t-s c2">No protein logged in the last 7 days. Log food in Fuel and each day shows here against your goal.</p>
        ) : (
          <>
            <p className="t-s c2">{proteinAvg}{NBSP}g a day on average{proteinGoal ? ` against a ${proteinGoal}${NBSP}g goal. Goal met on ${proteinMet} of ${proteinDays.length} logged days. Filled bars met the goal.` : "."}</p>
            <ColumnChart
              label={`Bar chart of daily protein for 7 days${proteinGoal ? ` against a ${proteinGoal} gram goal. The goal was met on ${proteinMet} of ${proteinDays.length} logged days` : ""}.`}
              columns={week7.map((day) => ({ key: day.key, value: day.protein, x: day.letter, filled: proteinGoal > 0 ? day.protein >= proteinGoal : true }))}
              goal={proteinGoal || null}
            />
          </>
        )}
      </section>
      <section aria-labelledby="avg-30" style={column(4)}>
        <h2 id="avg-30" className="t-h">30-day averages</h2>
        <ul className="rows">
          <li className="row"><span className="t-bs grow">Body weight</span><span className="n">{avg(weights)}{NBSP}lb</span></li>
          <li className="row"><span className="t-bs grow">Daily protein</span><span className="n">{avg(proteins)}{NBSP}g</span></li>
          <li className="row"><span className="t-bs grow">Sleep</span><span className="n">{avg(sleeps)}{NBSP}h</span></li>
        </ul>
        <p className="t-s c2">Across the days you logged each one, out of your last 30 logged days.</p>
      </section>
    </Fragment>,
  ];

  // ── Recovery ──
  const wearableNotes = wearableTrends?.notes || [];
  const recoveryScreen = [
    <Fragment key="load">
      <Suspense fallback={loading("recovery")}>
        <RecoveryLoadFigure data={data} />
      </Suspense>
      <section aria-labelledby="devices-title" style={column(4)}>
        <h2 id="devices-title" className="t-h">From your devices</h2>
        {wearableNotes.length === 0 && <p className="t-s c2">{wearableTrends?.summary || "Not enough wearable data yet to show a trend."}</p>}
        {wearableNotes.length > 0 && (
          <ul className="rows">
            {wearableNotes.slice(0, 4).map((note) => (
              <li key={note.metric} className="row" style={{ alignItems: "flex-start", paddingTop: 10, paddingBottom: 10 }}>
                <span className="tag">{note.sourceLabel || "Pending"}</span>
                <span className="kv grow"><span className="t-bs">{note.label}</span><span className="t-s c2">{note.note}</span></span>
              </li>
            ))}
          </ul>
        )}
        {wearableNotes.length > 0 && <p className="t-s c2">Each note names its source. Devices are never averaged together.</p>}
      </section>
    </Fragment>,
    <Fragment key="insights">
      <section aria-labelledby="insights-title" style={column(8)}>
        <h2 id="insights-title" className="t-h">Insights</h2>
        <Suspense fallback={loading("insights")}>
          <CalibrationReport data={data} wearableTrends={wearableTrends} />
          <CorrelationExplorer data={data} />
        </Suspense>
      </section>
    </Fragment>,
  ];

  // ── Weekly review ──
  const reviewScreen = [
    <WeeklyCoachingReview key="review" review={coachReview} week={review} limiter={limiter} updateEntryAtDate={updateEntryAtDate} showToast={showToast} />,
    <Fragment key="rest">
      <section aria-labelledby="targets-title" style={column(4)}>
        <h2 id="targets-title" className="t-h">Weekly targets</h2>
        <ul className="rows">
          {TARGET_LABELS.map((label, index) => (
            <li key={label} className="row" style={{ minHeight: 44 }}>
              <Icon name={review.targetChecks[index] ? "done" : "open"} className={review.targetChecks[index] ? "good" : "c2"} />
              <span className="t-bs grow">{label}</span>
              <span className="t-s c2">{review.targetChecks[index] ? "Met" : "Open"}</span>
            </li>
          ))}
        </ul>
        <p className="t-s c2">Counted over the last 7 days.</p>
      </section>

      {progressLimiters.length > 1 && (
        <section aria-labelledby="limiters-title" style={column(4)}>
          <h2 id="limiters-title" className="t-h">Also worth watching</h2>
          <ul className="rows">
            {progressLimiters.slice(1).map((card) => (
              <li key={card.id} className="row" style={{ alignItems: "flex-start", paddingTop: 10, paddingBottom: 10 }}>
                <span className="kv grow">
                  <span className="t-bs">{card.title}</span>
                  <span className="t-s c2">{card.body}</span>
                  <span className="t-s c2">{[card.metric, card.action].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="tag tag-f">{card.status}</span>
              </li>
            ))}
          </ul>
          <p className="t-s c2">A conservative read. These are likely limiters, not diagnoses.</p>
        </section>
      )}

      <section aria-labelledby="evidence-title" style={column(8)}>
        <div className="sec"><h2 id="evidence-title" className="t-h">The last 30 days</h2><span className="t-s c2">{progressEvidence.streakLabel}</span></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "12px 16px" }}>
          {progressEvidence.cards.map((card) => (
            <span key={card.label} className="kv"><span className="t-c c2">{card.label}</span><span className="n">{card.value}</span><span className="t-s c2">{card.subtext}</span></span>
          ))}
        </div>
      </section>

      <button type="button" className="row" onClick={() => setSubView("periodization")} style={{ borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)", minHeight: 64, alignItems: "flex-start", paddingTop: 10, paddingBottom: 10 }}>
        <span className="kv grow">
          <span className="t-bs">Block{blockPreview.available ? `: ${blockPreview.blockLabel}, ${blockPreview.weekLabel.toLowerCase().replace("/", " of ")}` : ""}</span>
          {blockPreview.available && <span className="t-s">{blockPreview.actionLabel}</span>}
          <span className="t-s c2">{blockPreview.rationale}</span>
        </span>
        <Icon name="next" size="s" className="c2" />
      </button>

      <ClinicianGuardrailsCard settings={settings} onSaveCoachingSettings={onSaveCoachingSettings} showToast={showToast} />
    </Fragment>,
  ];

  const screens = { strength: strengthScreen, running: runningScreen, body: bodyScreen, recovery: recoveryScreen, review: reviewScreen };
  if (screens[subView]) {
    // One column on a phone. On a wide screen the same two halves sit side by side.
    const [first, second] = screens[subView];
    return (
      <div className="shell" data-screen={`progress-${subView}`}>
        {isBroadsheet ? (
          <div className="main" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 48, alignItems: "start", width: "100%", maxWidth: 1180, margin: "0 auto" }}>
            <div style={{ ...column(16), minWidth: 0 }}>{first}</div>
            <div style={{ ...column(16), minWidth: 0 }}>{second}</div>
          </div>
        ) : (
          <div className="main" style={{ gap: 16 }}>{first}{second}</div>
        )}
      </div>
    );
  }

  // ── Home ──
  const streakLine = streak.count > 0
    ? `Logging streak: ${streak.count} day${streak.count === 1 ? "" : "s"}.`
    : "No logging streak right now. It starts again with the next thing you log.";
  const trends = [
    ["strength", "Strength", review.topLifts.length ? `Heaviest in the last 7 days: ${review.topLifts[0][0]}, ${review.topLifts[0][1]}${NBSP}lb` : "Lifts, sets by muscle, and what is fresh"],
    ["running", "Running", `${Math.round(review.totalMiles * 10) / 10}${NBSP}mi in the last 7 days`],
    ["body", "Body", review.avgWeight ? `Averaging ${review.avgWeight}${NBSP}lb over the last 7 days` : "Bodyweight, waist and protein"],
    ["recovery", "Recovery", parseFloat(review.avgSleep) > 0 ? `Sleep averaging ${review.avgSleep}${NBSP}h a night over the last 7 days` : "Recovery against load, and your patterns"],
    ["history", "History", `${fmtInt(entries.length)} day${entries.length === 1 ? "" : "s"} logged, searchable`],
  ];
  const reviewCard = (
    <section className="card" aria-labelledby="limiter" data-section="ov-verdict" style={{ ...column(6), ...(isBroadsheet ? { padding: 24 } : null) }}>
      <p className="t-c c2">The last 7 days · likely limiter</p>
      {limiter ? (
        <>
          <h2 id="limiter" className={isBroadsheet ? "t-xl" : "t-hl"}>{limiter.title}</h2>
          <p className="t-s c2">{limiter.body}</p>
          <p className="t-s c2">{[limiter.metric, limiter.action].filter(Boolean).join(" · ")}</p>
        </>
      ) : (
        <h2 id="limiter" className={isBroadsheet ? "t-xl" : "t-hl"}>Nothing is holding the week back.</h2>
      )}
      <button type="button" className={isBroadsheet ? "btn btn-p" : "btn btn-p btn-b"} onClick={() => setSubView("review")} style={{ marginTop: 6, alignSelf: isBroadsheet ? "flex-start" : undefined }}>Open the weekly review</button>
    </section>
  );
  const allTime = (
    <section aria-labelledby="all-time" data-section="ov-plates" style={column(8)}>
      <h2 id="all-time" className="t-h">All time</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, maxWidth: 560 }}>
        {[["Workouts", fmtInt(workoutsDone)], ["Miles", fmtInt(totalMiles)], ["Days logged", fmtInt(entries.length)]].map(([label, value]) => (
          <span key={label} className="kv"><span className="t-c c2">{label}</span><span className="n-md">{value}</span></span>
        ))}
      </div>
    </section>
  );

  if (isBroadsheet) {
    return (
      <div className="shell" data-screen="progress">
        <div className="main" style={{ gap: 32 }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
            <p className="t-b c2 grow">{streakLine}</p>
            <button type="button" className="btn btn-s" onClick={() => setSubView("history")}>History</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 32, alignItems: "start" }}>
            <div style={column(24)}>
              {reviewCard}
              {allTime}
            </div>
            <section aria-labelledby="home-numbers">
              <table className="tbl" aria-labelledby="home-numbers">
                <caption id="home-numbers" className="t-title" style={{ textAlign: "left", paddingBottom: 4 }}>The week in numbers</caption>
                <tbody>
                  {weekInNumbers(coachReview, review).slice(0, 8).map(([label, value]) => (
                    <tr key={label}><th scope="row">{label}</th><td className="n-s" style={{ whiteSpace: "normal" }}>{value}</td></tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
          <div data-section="ov-trends" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 32 }}>
            {trends.slice(0, 4).map(([key, label, sub]) => (
              <section key={key} aria-labelledby={`trend-${key}`} style={{ ...column(8), borderTop: "1px solid var(--edge)", paddingTop: 12 }}>
                <div className="sec">
                  <h2 id={`trend-${key}`} className="t-title">{label}</h2>
                  <button type="button" className="btn btn-g btn-sm" aria-label={`Open ${label.toLowerCase()}`} onClick={() => setSubView(key)}>Open</button>
                </div>
                <Suspense fallback={<p className="t-s c2">{sub}.</p>}>
                  {key === "strength" && <LiftIntelligenceSection data={data} glance />}
                  {key === "running" && <RunningVolumeFigure data={data} settings={settings} glance />}
                  {key === "body" && <WeightTrendFigure data={data} glance />}
                  {key === "recovery" && <RecoveryLoadFigure data={data} glance />}
                </Suspense>
              </section>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="shell" data-screen="progress">
      <div className="main" style={{ gap: 16 }}>
        {reviewCard}
        <section aria-labelledby="trends" data-section="ov-trends" style={column(4)}>
          <h2 id="trends" className="t-h">Trends</h2>
          <ul className="rows">
            {trends.map(([key, label, sub]) => (
              <li key={key}>
                <button type="button" className="row" onClick={() => setSubView(key)} style={{ minHeight: 60 }}>
                  <span className="kv grow"><span className="t-bs">{label}</span><span className="t-s c2">{sub}</span></span>
                  <Icon name="next" size="s" className="c2" />
                </button>
              </li>
            ))}
          </ul>
        </section>
        {allTime}
        <p className="t-s c2">{streakLine}</p>
      </div>
    </div>
  );
}
