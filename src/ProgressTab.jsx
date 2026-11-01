// src/ProgressTab.jsx
// V8 refactor · Extracted verbatim from App.jsx (no behavior change): the
// Progress tab with its shared subnav, the History Events/Entries toggle,
// and the pace/chart helpers that only Progress uses.
import { useState, useEffect, lazy, Suspense } from "react";
import { isDemoMode, DEMO_FORM_HISTORY } from "./demoData";
import { useMediaQuery, BROADSHEET_QUERY } from "./ui/useMediaQuery";
import { useTheme } from "./theme";
import { DEFAULT_PROGRAM, defaultDay, getTodayKey, getDayName } from "./constants";
import { calcRecoveryScore, calcWeeklyReview } from "./recovery";
import { buildWeeklyCoachReview } from "./weeklyCoachReview";
import { buildCoachingCalibrationProfile } from "./coachingCalibration";
import { CoachingOutcomeCenter } from "./CoachingOutcomeCenter";
import { isOuraConnected, loadOuraData } from "./oura";
import { isWhoopConnected, loadWhoopData } from "./whoop";
import { buildDailyLoads, computeRollingLoads } from "./loadModel";
import { buildDecisionContext, getDailyRecommendation } from "./decisionEngine";
import { buildDecisionFeedbackWeekly } from "./decisionFeedback";
import { buildAthleteTimeline, filterTimelineEvents, groupTimelineByDate, summarizeTimeline } from "./athleteTimeline";
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
import { loadHistory as loadFormCheckHistory, buildFormCheckHistorySummary, compareFormCheckEntries, getPreviousForMovement, buildAllMovementTrends } from "./formCheck/formCheckHistory";
import { buildPersonalizedCoachContext } from "./formCheck/personalizedCoach";
import { calcStreak } from "./AppHeader";
import { DisclosureBlock, LoadingShell } from "./ui/primitives";
import { getSkeletonPlan } from "./uiStability";
import { buildProgressLimiters, buildProgressEvidence, buildFormCheckProgressPreview, buildBlockProgressPreview } from "./progressSummary";
import { buildWearableTrendNotes } from "./recovery/wearableProgressContext";
import { epley1RM } from "./TodayTab";

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
const LineFigure = lazyNamed(() => import("./sections/Figure"), "LineFigure");

// ─── Progress Tab ─────────────────────────────────────────────────────────────
// V6 · One shared subnav for every Progress subview. Previously the Summary
// view had a 5-tab underline bar while each subview had prev/next pager
// arrows — two navigation metaphors on one screen, neither complete. Now
// every view renders this same 4-tab bar: Overview · Form · Program ·
// History (Timeline + Log merged — both are "what happened," toggled inside
// History rather than owning separate tabs).
export function ProgressSubnav({ subView, setSubView, formBadge = 0 }) {
  const { C } = useTheme();
  const mono = C.fontFamily;
  // V15.2 · At the broadsheet tier this graduates into a sub-masthead: taller,
  // and FORM carries an unreviewed-checks badge (mockup 1h).
  const isBroadsheet = useMediaQuery(BROADSHEET_QUERY);
  const tabs = [
    { key: "charts", label: "Overview", match: ["charts"] },
    { key: "coach", label: "Coach", match: ["coach"] },
    { key: "form", label: "Form", match: ["form"] },
    { key: "periodization", label: "Program", match: ["periodization"] },
    { key: "timeline", label: "History", match: ["timeline", "log"] },
  ];
  // Segmented control — reads as navigation, not a filter row. The active
  // segment carries a subtle fill + a 2px ink underline indicator (echoing the
  // app's bottom-nav active language), inactive segments stay faint and are
  // separated by hairline dividers. Sticky so the sub-nav holds while scrolling.
  return (
    <div
      role="tablist"
      aria-label="Progress sections"
      style={{ display: "flex", borderBottom: `1px solid ${C.line}`, background: C.panel, position: "sticky", top: 0, zIndex: 40 }}
    >
      {tabs.map((t, i) => {
        const active = t.match.includes(subView);
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={active}
            onClick={() => setSubView(t.key)}
            style={{
              flex: 1,
              padding: isBroadsheet ? "15px 6px 12px" : "11px 6px 9px",
              background: active ? C.bg : "none",
              border: "none",
              borderLeft: i > 0 ? `1px solid ${C.line}` : "none",
              borderBottom: active ? `2px solid ${C.text}` : "2px solid transparent",
              marginBottom: -1,
              color: active ? C.text : C.textFaint,
              fontSize: 10,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              fontFamily: mono,
              cursor: "pointer",
              fontWeight: active ? 600 : 400,
              transition: "color 140ms ease, background 140ms ease",
            }}
          >
            {t.label}
            {t.key === "form" && isBroadsheet && formBadge > 0 && (
              <span style={{ marginLeft: 6, background: C.text, color: C.bg, fontSize: 9, padding: "1px 5px", letterSpacing: "0.08em", fontFamily: mono }}>{formBadge}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// Events ↔ Entries toggle inside History — one tab, two lenses on the same
// logged past. Replaces the separate Timeline and Log top-level tabs.
export function HistoryModeToggle({ subView, setSubView }) {
  const { C } = useTheme();
  const mono = C.fontFamily;
  const modes = [
    { key: "timeline", label: "Events" },
    { key: "log", label: "Entries" },
  ];
  return (
    <div style={{ display: "flex", gap: 6, padding: "10px 16px", borderBottom: `1px solid ${C.line}`, background: C.block }}>
      {modes.map(m => (
        <button
          key={m.key}
          onClick={() => setSubView(m.key)}
          style={{ border: `1px solid ${subView === m.key ? C.text : C.lineBright}`, background: "none", color: subView === m.key ? C.text : C.textDim, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: mono, padding: "6px 12px", cursor: "pointer", fontWeight: subView === m.key ? 600 : 400 }}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

export function ProgressTab({  data, settings, program, loaded, updateEntryAtDate, showToast, onSaveCoachingSettings }) {
  const { C, S } = useTheme();
  const mono = C.fontFamily;
  const [subView, setSubView] = useState("charts"); // "charts" (Summary) | "log" | "timeline" | "periodization" | "form"
  // V2.6: the default Summary view is the reflection loop; dense metrics/charts
  // collapse behind one disclosure so the score narrative isn't repeated up top.
  const [selectedDay, setSelectedDay] = useState(null);
  // V15.2 · Broadsheet tier flag + FORM badge. "Unreviewed" = form checks
  // saved after the last time the Form sub-tab was opened (stamped below).
  // A view-timestamp, not fabricated review state.
  const isBroadsheet = useMediaQuery(BROADSHEET_QUERY);
  const [formViewedAt, setFormViewedAt] = useState(() => { try { return localStorage.getItem("ovt-form-viewed-at") || ""; } catch { return ""; } });
  const [logFilter, setLogFilter] = useState("all");
  const [logSearch, setLogSearch] = useState("");
  const [timelineFilter, setTimelineFilter] = useState("all");
  const [periodizationEditOpen, setPeriodizationEditOpen] = useState(false);
  // Block settings persist via a namespaced localStorage key (see periodizationSettings.js
  // PERSISTENCE NOTE). Saved = last persisted; Draft = in-flight edits.
  const [periodizationSaved, setPeriodizationSaved] = useState(() => normalizePeriodizationSettings(readStoredPeriodization() || {}));
  const [periodizationDraft, setPeriodizationDraft] = useState(periodizationSaved);
  const [periodizationHistory, setPeriodizationHistory] = useState(() => readStoredPeriodizationHistory());
  const [formCheckHistory, setFormCheckHistory] = useState(() => (isDemoMode() ? DEMO_FORM_HISTORY : loadFormCheckHistory())); // V15.5 · seeded demo checks
  useEffect(() => {
    if (subView !== "form") return;
    const now = new Date().toISOString();
    setFormViewedAt(now);
    try { localStorage.setItem("ovt-form-viewed-at", now); } catch { /* fine */ }
  }, [subView]);
  const formBadge = formCheckHistory.filter(e => (e?.date || "") > formViewedAt).length;
  const [wearableTrends, setWearableTrends] = useState(() => buildWearableTrendNotes({}));

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
  const scoreColor = review.weekScore >= 80 ? C.green : review.weekScore >= 50 ? C.textDim : C.red;
  const TARGET_LABELS = review.targetLabels || ["5+ workouts", "15+ miles", `${goals.protein}g protein 5d`, "7+ hrs sleep avg", "Water goal 5d"];
  const calibrationProfile = buildCoachingCalibrationProfile({ data, wearableTrends });
  const coachReview = buildWeeklyCoachReview({ data, goals, settings, program, wearableTrends, calibrationProfile });
  const decisionFeedback = buildDecisionFeedbackWeekly(data);
  const streak = calcStreak(data);
  const streakColor = streak.count >= 30 ? C.textDim : streak.count >= 7 ? C.green : C.textDim;

  // V18.6 · Dedicated coaching workspace. Outcome lifecycle, plan versions,
  // projection, monthly review, phase transitions, inbox, and controls live
  // here instead of turning Overview or Today into another dense dashboard.
  if (subView === "coach") {
    return (
      <div>
        <ProgressSubnav subView={subView} setSubView={setSubView} formBadge={formBadge} />
        <CoachingOutcomeCenter
          review={coachReview}
          data={data}
          settings={settings}
          updateEntryAtDate={updateEntryAtDate}
          showToast={showToast}
          onSaveCoachingSettings={onSaveCoachingSettings}
        />
      </div>
    );
  }

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
      <div>
        <ProgressSubnav subView={subView} setSubView={setSubView} formBadge={formBadge} />

        {/* V15.2 · Broadsheet Program spread (mockup 1j): summary, race block,
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

        {/* ── V7 · Race block — countdown, taper flag, station benchmarks ── */}
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

  // ── Form Check sub-view ──
  if (subView === "form") {
    // V1.4: derived progress memory — aggregate summary + same-movement comparison.
    const fcSummary = buildFormCheckHistorySummary(formCheckHistory);
    const latest = fcSummary.latest;
    const latestCmp = fcSummary.latestComparison;
    const latestScore = latest ? (latest.formScore && typeof latest.formScore === "object" ? latest.formScore.score : typeof latest.formScore === "number" ? latest.formScore : null) : null;
    const latestFocus = latestCmp?.primaryFocus || latest?.progressSignals?.primaryFocus || null;
    const latestTrend = latest?.progressSignals?.trendKey;
    const chipTone = (tone) => tone === "positive" ? C.green : tone === "negative" ? C.red : C.textDim;
    // V1.6: multi-check trend coach per movement (derived history only).
    const trends = buildAllMovementTrends(formCheckHistory);
    const trendTone = (t) => t === "improving" ? C.green : t === "declining" ? C.red : t === "stable" ? C.text : C.textDim;
    const trendLabel = (t) => t === "improving" ? "Improving" : t === "declining" ? "Declining" : t === "stable" ? "Holding steady" : "Not enough data";
    // V1.8: personalized coach context from recovery + block emphasis + recurring focus.
    let recoveryColor;
    try {
      const yKey = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; })();
      const rec = calcRecoveryScore(data[yKey], data, yKey);
      recoveryColor = rec?.color || null;
    } catch { recoveryColor = null; }
    const topTrend = trends[0] || null;
    const personalized = buildPersonalizedCoachContext({
      recovery: recoveryColor,
      strengthEmphasis: periodizationSaved?.strengthEmphasis,
      goal: periodizationSaved?.goal,
      recurringFocus: topTrend?.recurringFocus || null,
      bestRecentScore: topTrend?.bestRecentScore ?? null,
      movementLabel: topTrend?.label || null,
    });
    return (
      <div>
        <ProgressSubnav subView={subView} setSubView={setSubView} formBadge={formBadge} />
        <div style={isBroadsheet ? { display: "grid", gridTemplateColumns: "var(--ovt-rail-s) 1fr", gap: 20, alignItems: "start" } : { display: "contents" }}>
        <section data-section="form-ledger" style={isBroadsheet ? { display: "flex", flexDirection: "column", gap: 12, minWidth: 0, gridColumn: 2, gridRow: 1 } : { display: "contents" }}>
        <div style={S.block}>
          <div style={S.blockHead}>
            <span style={S.blockTitle}>{"> "}Form Check History</span>
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={S.blockStat}>{fcSummary.total} SAVED · {fcSummary.movementCount} MOVE</span>
              <button onClick={() => setFormCheckHistory(loadFormCheckHistory())} style={{ ...S.smallBtn, padding: "3px 8px", fontSize: 9.5 }}>Refresh</button>
            </span>
          </div>
          <div style={{ fontSize:11.5, color:C.textDim, lineHeight:1.55 }}>
            Derived summaries only — no raw video, frames, images, or landmarks are stored.
          </div>
          {latest && (
            <>
              <div style={{ marginTop:10, display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:1, background:C.lineBright, border:`1px solid ${C.lineBright}` }}>
                <div style={{ background:C.block, padding:"8px 4px", textAlign:"center" }}><div style={{ fontSize:15, color:C.text, fontWeight:600 }}>{latestScore ?? "—"}</div><div style={S.bodyL}>Score</div></div>
                <div style={{ background:C.block, padding:"8px 4px", textAlign:"center" }}><div style={{ fontSize:15, color:C.text, fontWeight:600 }}>{latest.repCount ?? "—"}</div><div style={S.bodyL}>Reps</div></div>
                <div style={{ background:C.block, padding:"8px 4px", textAlign:"center" }}><div style={{ fontSize:15, color:C.text, fontWeight:600 }}>{latest.depthAssessment || "—"}</div><div style={S.bodyL}>Depth</div></div>
                <div style={{ background:C.block, padding:"8px 4px", textAlign:"center" }}><div style={{ fontSize:15, color:C.text, fontWeight:600 }}>{latest.confidence?.level || "—"}</div><div style={S.bodyL}>Conf</div></div>
              </div>
              {latestCmp && (
                <div style={{ marginTop:8 }}>
                  <div style={{ fontSize:11.5, color:C.text, lineHeight:1.5 }}>{latestCmp.summary}</div>
                  {latestCmp.chips.length > 0 && (
                    <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginTop:6 }}>
                      {latestCmp.chips.map((chip, i) => (
                        <span key={`${chip.label}-${i}`} style={{ fontSize:10, color:chipTone(chip.tone), border:`1px solid ${C.lineBright}`, padding:"3px 5px", letterSpacing:"0.04em" }}>
                          {chip.label} {chip.value}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {(latestFocus || Number.isFinite(latestTrend)) && (
                <div style={{ fontSize:11, color:C.textDim, marginTop:7, lineHeight:1.5 }}>
                  {latestFocus ? <>focus · {latestFocus}</> : null}
                  {latestFocus && Number.isFinite(latestTrend) ? " · " : null}
                  {Number.isFinite(latestTrend) ? <>trend key {latestTrend}</> : null}
                </div>
              )}
            </>
          )}
        </div>
        </section>
        <section data-section="form-trends" style={isBroadsheet ? { display: "flex", flexDirection: "column", gap: 12, minWidth: 0, gridColumn: 1, gridRow: 1 } : { display: "contents" }}>
        {/* V1.8: Personalized coach note (derived from recovery + block + history) */}
        {personalized.available && (
          <div style={S.block}>
            <div style={S.blockHead}><span style={S.blockTitle}>{"> "}{personalized.headline || "Personalized Note"}</span></div>
            {personalized.notes.map((n, i) => (
              <div key={i} style={{ fontSize:11.5, color:C.text, lineHeight:1.5, marginTop: i === 0 ? 4 : 6 }}>{n}</div>
            ))}
            {personalized.cameraTip && <div style={{ fontSize:11, color:C.textDim, lineHeight:1.5, marginTop:7 }}>{personalized.cameraTip}</div>}
            <div style={{ fontSize:10, color:C.textFaint, marginTop:8, lineHeight:1.4 }}>Context-only framing from your recovery, block, and saved checks — not medical or diagnostic advice.</div>
          </div>
        )}

        {/* V1.6: Movement trend coach cards */}
        {trends.length > 0 && (
          <div style={S.block}>
            <div style={S.blockHead}><span style={S.blockTitle}>{"> "}Movement Trends</span><span style={S.blockStat}>{trends.length} MOVE</span></div>
            <div style={{ display:"flex", flexDirection:"column", gap:1, marginTop:6 }}>
              {trends.map((tr) => (
                <div key={tr.movement || tr.label} style={{ border:`1px solid ${C.lineBright}`, padding:"10px 12px", background:C.block }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", gap:10 }}>
                    <span style={{ fontSize:13, color:C.text, letterSpacing:"0.04em", textTransform:"uppercase" }}>{tr.label}</span>
                    <span style={{ fontSize:10.5, color:trendTone(tr.scoreTrend), letterSpacing:"0.08em", textTransform:"uppercase" }}>
                      {trendLabel(tr.scoreTrend)}{Number.isFinite(tr.scoreDeltaFromOldest) && tr.scoreDeltaFromOldest !== 0 ? ` ${tr.scoreDeltaFromOldest > 0 ? "+" : ""}${tr.scoreDeltaFromOldest}` : ""}
                    </span>
                  </div>
                  <div style={{ fontSize:11, color:C.textDim, marginTop:5, lineHeight:1.45 }}>
                    {tr.count} check{tr.count === 1 ? "" : "s"}
                    {Number.isFinite(tr.bestRecentScore) ? ` · best ${tr.bestRecentScore}` : ""}
                    {tr.recurringFocus?.label ? ` · focus: ${tr.recurringFocus.label}` : ""}
                  </div>
                  {tr.nextCheckRecommendation && <div style={{ fontSize:11, color:C.textDim, marginTop:6, lineHeight:1.5 }}>→ {tr.nextCheckRecommendation}</div>}
                  <div style={{ fontSize:10, color:C.textFaint, marginTop:6, lineHeight:1.4, fontStyle:"italic" }}>{tr.confidenceNote}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ ...S.block, padding:0 }}>
          {formCheckHistory.length === 0 && <div style={{ padding:16, fontSize:11.5, color:C.textDim }}>No saved form checks yet. Use Profile → Form Check, analyze a clip, then save the derived summary. Saved checks compare against earlier ones for the same movement.</div>}
          {formCheckHistory.map((entry, idx) => {
            const prev = getPreviousForMovement(formCheckHistory, entry);
            const cmp = compareFormCheckEntries(entry, prev);
            const entryScore = entry.formScore && typeof entry.formScore === "object" ? entry.formScore.score : typeof entry.formScore === "number" ? entry.formScore : null;
            const nextCue = entry.coaching?.nextSetCue || entry.coaching?.watchItems?.[0] || null;
            return (
              <div key={`${entry.date}-${idx}`} style={{ padding:"11px 16px", borderBottom:`1px solid ${C.line}` }}>
                <div style={{ display:"flex", justifyContent:"space-between", gap:10, marginBottom:5 }}>
                  <span style={{ fontSize:13, color:C.text, letterSpacing:"0.04em", textTransform:"uppercase" }}>{cmp.movementLabel}</span>
                  <span style={{ fontSize:10, color:C.textFaint }}>{entry.date ? entry.date.slice(0,10) : "—"}</span>
                </div>
                <div style={{ fontSize:11.5, color:C.textDim, lineHeight:1.45 }}>
                  {entryScore != null ? `score ${entryScore} · ` : ""}{entry.repCount ?? "—"} reps · {entry.depthAssessment || "depth unknown"} · confidence {entry.confidence?.level || "—"}
                </div>
                {cmp.hasPrevious && cmp.chips.length > 0 && (
                  <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginTop:7 }}>
                    {cmp.chips.map((chip, i) => (
                      <span key={`${chip.label}-${i}`} style={{ fontSize:10, color:chipTone(chip.tone), border:`1px solid ${C.lineBright}`, padding:"3px 5px", letterSpacing:"0.04em" }}>
                        {chip.label} {chip.value}
                      </span>
                    ))}
                  </div>
                )}
                {cmp.primaryFocus && (
                  <div style={{ fontSize:11, color:C.textDim, marginTop:6 }}>
                    focus · {cmp.primaryFocus}{cmp.focusChanged ? " (changed)" : ""}
                  </div>
                )}
                {entry.timeline?.length > 0 && (
                  <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginTop:8 }}>
                    {entry.timeline.slice(0, 8).map(rep => (
                      <span key={rep.index} style={{ fontSize:10, color:C.textDim, border:`1px solid ${C.lineBright}`, padding:"3px 5px" }}>
                        R{rep.index}: {rep.depthAssessment || "—"}{rep.tempoSec ? ` · ${rep.tempoSec}s` : ""}
                      </span>
                    ))}
                  </div>
                )}
                {nextCue && <div style={{ fontSize:11, color:C.textDim, marginTop:7, lineHeight:1.5 }}>next set · {nextCue}</div>}
                {entry.cues?.[0]?.text && <div style={{ fontSize:11, color:C.textDim, fontStyle:"italic", marginTop:7 }}>“{entry.cues[0].text}”</div>}
              </div>
            );
          })}
        </div>
        </section>
        </div>
      </div>
    );
  }

  // V15.2 · Day detail, shared by both History lenses (mockup 1k). On mobile
  // the Entries lens keeps its full-screen takeover exactly as before; at the
  // broadsheet tier both lenses dock this alongside the master list instead.
  const dayDetailPanel = selectedDay ? (() => {
      const d = data[selectedDay] || defaultDay();
      const dayName = getDayName(new Date(selectedDay + "T12:00:00"));
      const p = (program?.[dayName]) || DEFAULT_PROGRAM[dayName];
      return (
        <div>
          <div style={{ ...S.block, display:"flex", alignItems:"center", gap:12 }}>
            <button style={S.smallBtn} onClick={() => setSelectedDay(null)}>← Back</button>
            <span style={{ fontSize:13.5, color:C.text, letterSpacing:"0.05em" }}>{selectedDay} · {dayName}</span>
          </div>
          <div style={S.block}>
            <div style={S.blockHead}><span style={S.blockTitle}>{"> "}Workout · {p?.type}</span></div>
            {Object.entries(d.workout?.exercises||{}).length === 0 && <div style={{ fontSize:11.5, color:C.textDim }}>No lifting logged.</div>}
            {Object.entries(d.workout?.exercises||{}).map(([name,ex]) => (
              <div key={name} style={{ marginBottom:10 }}>
                <div style={{ fontSize:13, color:C.text, textTransform:"uppercase", letterSpacing:"0.04em", marginBottom:4 }}>{name}</div>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(80px, 1fr))", gap:4 }}>
                  {(ex.sets||[]).map((s,i) => (
                    <div key={i} style={{ background: C.bg, border:`1px solid ${s.done ? C.text : C.lineBright}`, padding:"5px 6px", textAlign:"center" }}>
                      <div style={{ fontSize:13, fontWeight:600, color: s.done ? C.green : C.textDim }}>{s.weight ? `${s.weight}` : "—"}</div>
                      <div style={{ fontSize:9.5, color:C.textFaint, marginTop:1 }}>×{s.reps||"—"}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {d.workout?.cardio?.miles && (
              <div style={{ marginTop:8, background:C.block, border:`1px solid ${C.lineBright}`, padding:"8px 10px" }}>
                <div style={{ fontSize:11, color:C.text, letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:4 }}>Run</div>
                <div style={{ display:"flex", gap:16, fontSize:13, color:C.text }}>
                  <span>{d.workout.cardio.miles}mi</span>
                  {d.workout.cardio.time && <span>{d.workout.cardio.time}</span>}
                  {d.workout.cardio.pace && <span>{d.workout.cardio.pace}/mi</span>}
                </div>
              </div>
            )}
            {d.workout?.notes && <div style={{ fontSize:11.5, color:C.textDim, marginTop:8, fontStyle:"italic" }}>// {d.workout.notes}</div>}
          </div>
          <div style={S.block}>
            <div style={S.blockHead}><span style={S.blockTitle}>{"> "}Nutrition</span></div>
            <div style={S.macroLine}>
              <div style={S.macroCell}><div style={{ fontSize:16, fontWeight:600, color:C.text }}>{d.nutrition?.calories||"—"}</div><div style={S.macroL}>Cal</div></div>
              <div style={S.macroCell}><div style={{ fontSize:16, fontWeight:600, color:C.text }}>{d.nutrition?.protein||"—"}</div><div style={S.macroL}>Pro</div></div>
              <div style={S.macroCell}><div style={{ fontSize:16, fontWeight:600, color:C.text }}>{d.nutrition?.carbs||"—"}</div><div style={S.macroL}>Carb</div></div>
              <div style={S.macroCell}><div style={{ fontSize:16, fontWeight:600, color:C.text }}>{d.nutrition?.fats||"—"}</div><div style={S.macroL}>Fat</div></div>
            </div>
            <div style={{ fontSize:11.5, color:C.textDim, marginTop:6 }}>WATER: {d.nutrition?.water||0}oz</div>
          </div>
          <div style={S.block}>
            <div style={S.blockHead}><span style={S.blockTitle}>{"> "}Body</span></div>
            <div style={S.bodyLine}>
              <div style={S.bodyCell}><div style={{ fontSize:15, fontWeight:600 }}>{d.body?.weight||"—"}</div><div style={S.bodyL}>Weight</div></div>
              <div style={S.bodyCell}><div style={{ fontSize:15, fontWeight:600 }}>{d.body?.sleep||"—"}</div><div style={S.bodyL}>Sleep</div></div>
              <div style={S.bodyCell}><div style={{ fontSize:15, fontWeight:600 }}>{d.body?.energy||"—"}</div><div style={S.bodyL}>Energy</div></div>
              <div style={S.bodyCell}><div style={{ fontSize:15, fontWeight:600 }}>{d.body?.soreness||"—"}</div><div style={S.bodyL}>Soreness</div></div>
            </div>
          </div>
        </div>
      );
  })() : null;
  const dayDetailHint = (
    <div style={S.block} data-section="hist-detail-hint">
      <div style={S.blockHead}><span style={S.blockTitle}>{"> "}Day detail</span></div>
      <div style={{ fontSize: 11.5, color: C.textDim, lineHeight: 1.5 }}>Select a day from the ledger and it opens here, alongside the timeline.</div>
    </div>
  );

  // ── Timeline sub-view ──
  if (subView === "timeline") {
    const timeline = buildAthleteTimeline(data, { limit: 100 });
    const filteredTimeline = filterTimelineEvents(timeline, timelineFilter);
    const timelineGroups = groupTimelineByDate(filteredTimeline);
    const timelineSummary = summarizeTimeline(filteredTimeline);
    const toneFor = (tone) => tone === "positive" ? C.green : tone === "warning" ? C.red : tone === "caution" ? C.text : C.textDim;
    const labelFor = (type) => ({ training: "TRAIN", nutrition: "FUEL", recovery: "REC", note: "NOTE", intelligence: "INTEL" }[type] || type.toUpperCase());
    const filterLabels = [["all","All"],["training","Training"],["nutrition","Fuel"],["recovery","Recovery"],["intelligence","Intel"],["note","Notes"]];

    return (
      <div>
        <ProgressSubnav subView={subView} setSubView={setSubView} formBadge={formBadge} />
        <HistoryModeToggle subView={subView} setSubView={setSubView} />
        <div style={isBroadsheet ? { display: "grid", gridTemplateColumns: "var(--ovt-rail-s) 1fr", gap: 20, alignItems: "start" } : { display: "contents" }}>
        <section data-section="hist-master" style={isBroadsheet ? { display: "flex", flexDirection: "column", gap: 12, minWidth: 0 } : { display: "contents" }}>
        <div style={S.block}>
          <div style={S.blockHead}><span style={S.blockTitle}>{"> "}Timeline Summary</span><span style={S.blockStat}>{timelineSummary.total} EVENTS</span></div>
          <div style={S.bodyLine}>
            <div style={S.bodyCell}><div style={{ fontSize:17, fontWeight:600, color:C.text }}>{timelineSummary.recentTrainingDays}</div><div style={S.bodyL}>Train Days</div></div>
            <div style={S.bodyCell}><div style={{ fontSize:17, fontWeight:600, color:C.text }}>{timelineSummary.recentMiles}</div><div style={S.bodyL}>Miles</div></div>
            <div style={S.bodyCell}><div style={{ fontSize:17, fontWeight:600, color:C.text }}>{Math.round(timelineSummary.recentVolume/1000)}k</div><div style={S.bodyL}>Volume</div></div>
          </div>
          <div style={{ ...S.annotation, marginTop:8 }}>read-only timeline synthesized from workouts, nutrition, recovery, notes, and intelligence decisions</div>
        </div>
        <div style={{ display:"flex", overflowX:"auto", borderBottom:`1px solid ${C.line}`, background:C.panel }}>
          {filterLabels.map(([key,label]) => (
            <button key={key} onClick={() => setTimelineFilter(key)} style={{ flex:"0 0 auto", padding:"9px 10px", background:"none", border:"none", borderBottom: timelineFilter===key ? `1px solid ${C.text}` : "1px solid transparent", marginBottom:-1, color: timelineFilter===key ? C.text : C.textFaint, fontSize:10, letterSpacing:"0.1em", textTransform:"uppercase", fontFamily:mono, cursor:"pointer" }}>{label}</button>
          ))}
        </div>
        <div style={{ ...S.block, padding:0 }}>
          {filteredTimeline.length === 0 && <div style={{ padding:16, fontSize:11.5, color:C.textDim }}>No timeline events match.</div>}
          {timelineGroups.map(group => (
            <div key={group.date} style={{ borderBottom:`1px solid ${C.line}` }}>
              <div onClick={isBroadsheet ? () => setSelectedDay(group.date) : undefined} role={isBroadsheet ? "button" : undefined} tabIndex={isBroadsheet ? 0 : undefined} onKeyDown={isBroadsheet ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedDay(group.date); } } : undefined} aria-label={isBroadsheet ? `Open day detail for ${group.date}` : undefined} style={{ padding:"10px 16px 6px", background:C.block, display:"flex", justifyContent:"space-between", cursor: isBroadsheet ? "pointer" : "default" }}>
                <span style={{ fontSize:11, color:C.text, letterSpacing:"0.12em", textTransform:"uppercase" }}>{group.dayLabel}</span>
                <span style={{ fontSize:9.5, color:C.textFaint }}>{group.date}</span>
              </div>
              {group.events.map((ev, idx) => (
                <div key={`${ev.id}-${idx}`} style={{ display:"grid", gridTemplateColumns:"52px 1fr", gap:10, padding:"10px 16px", borderTop:`1px solid ${C.lineBright}` }}>
                  <div style={{ marginTop:2, fontSize:9.5, color:toneFor(ev.tone), letterSpacing:"0.12em" }}>{labelFor(ev.type)}</div>
                  <div>
                    <div style={{ fontSize:13.5, color:C.text, letterSpacing:"0.03em", textTransform:"uppercase", marginBottom:4 }}>{ev.title}</div>
                    <div style={{ fontSize:11.5, color:C.textDim, lineHeight:1.45 }}>{ev.detail}</div>
                    {ev.metrics && Object.keys(ev.metrics).length > 0 && (
                      <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginTop:7 }}>
                        {Object.entries(ev.metrics).filter(([,v]) => v !== null && v !== undefined && v !== 0 && v !== "").slice(0, 4).map(([k,v]) => (
                          <span key={k} style={{ fontSize:9.5, color:C.textFaint, letterSpacing:"0.08em", textTransform:"uppercase" }}>{k}: {v}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
        </section>
        <section data-section="hist-detail" style={isBroadsheet ? { display: "flex", flexDirection: "column", gap: 12, minWidth: 0 } : { display: "none" }}>
          {dayDetailPanel || dayDetailHint}
        </section>
        </div>
      </div>
    );
  }

  // ── Log sub-view ──
  if (subView === "log") {
    const logEntries = Object.entries(data).sort((a,b) => b[0].localeCompare(a[0]));
    const logFiltered = logEntries.filter(([date, d]) => {
      if (logSearch) {
        const q = logSearch.toLowerCase();
        if (date.includes(q)) return true;
        if (Object.keys(d.workout?.exercises||{}).some(k => k.toLowerCase().includes(q))) return true;
        if ((d.workout?.notes||"").toLowerCase().includes(q)) return true;
        if (String(d.workout?.cardio?.miles||"").includes(q)) return true;
        if (String(d.nutrition?.calories||"").includes(q)) return true;
        if (String(d.nutrition?.protein||"").includes(q)) return true;
        return false;
      }
      if (logFilter === "workouts") return Object.keys(d.workout?.exercises||{}).length > 0;
      if (logFilter === "runs") return parseFloat(d.workout?.cardio?.miles) > 0;
      if (logFilter === "nutrition") return parseFloat(d.nutrition?.calories) > 0;
      return true;
    });

    if (selectedDay && !isBroadsheet) return dayDetailPanel;
    return (
      <div>
        <ProgressSubnav subView={subView} setSubView={setSubView} formBadge={formBadge} />
        <HistoryModeToggle subView={subView} setSubView={setSubView} />
        <div style={isBroadsheet ? { display: "grid", gridTemplateColumns: "var(--ovt-rail-s) 1fr", gap: 20, alignItems: "start" } : { display: "contents" }}>
        <section data-section="hist-master" style={isBroadsheet ? { display: "flex", flexDirection: "column", gap: 12, minWidth: 0 } : { display: "contents" }}>
        <div style={{ padding:"10px 16px", borderBottom:`1px solid ${C.line}`, background:C.panel }}>
          <input style={{ ...S.cell, textAlign:"left", padding:"9px 10px", fontSize:14, fontWeight:400, width:"100%" }}
            placeholder="search by date or exercise..."
            value={logSearch} onChange={e => setLogSearch(e.target.value)} />
        </div>
        <div style={{ display:"flex", borderBottom:`1px solid ${C.line}`, background:C.panel }}>
          {[["all","All"],["workouts","Lifting"],["runs","Runs"],["nutrition","Nutrition"]].map(([key,label]) => (
            <button key={key} onClick={() => { setLogFilter(key); setLogSearch(""); }}
              style={{ flex:1, padding:"8px 4px", background:"none", border:"none", borderBottom: logFilter===key ? `1px solid ${C.text}` : "1px solid transparent", marginBottom:-1, color: logFilter===key ? C.text : C.textFaint, fontSize:10, letterSpacing:"0.1em", textTransform:"uppercase", fontFamily:mono, cursor:"pointer" }}>{label}</button>
          ))}
        </div>
        <div style={{ ...S.block, padding:"8px 16px" }}>
          <span style={S.blockStat}>{logFiltered.length} ENTRIES</span>
        </div>
        <div style={{ ...S.block, padding:0 }}>
          {logFiltered.length===0 && <div style={{ padding:"16px", fontSize:11.5, color:C.textDim }}>No entries match.</div>}
          {logFiltered.map(([date,d]) => {
            const dayName = getDayName(new Date(date+"T12:00:00"));
            const hasLifting = Object.keys(d.workout?.exercises||{}).length > 0;
            const hasRun = parseFloat(d.workout?.cardio?.miles) > 0;
            const hasMacros = parseFloat(d.nutrition?.calories) > 0;
            const hasNote = !!(d.workout?.notes?.trim());
            return (
              <button key={date} type="button"
                aria-label={`View log detail for ${date}`}
                onClick={() => setSelectedDay(date)}
                style={{ width:"100%", display:"flex", alignItems:"center", gap:10, padding:"11px 16px", border:"none", borderBottom:`1px solid ${C.line}`, background:"none", color:"inherit", cursor:"pointer", textAlign:"left" }}>
                <div style={{ display:"flex", flexDirection:"column", gap:3, flexShrink:0 }}>
                  <span style={{ width:7, height:7, background: hasLifting||hasRun ? C.green : C.textFaint }} />
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:13, color:C.text, marginBottom:3 }}>{date} <span style={{ color:C.textDim }}>· {dayName.slice(0,3).toUpperCase()}</span></div>
                  <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                    {hasLifting && <span style={{ fontSize:10, color:C.textDim, letterSpacing:"0.05em" }}>↑ {Object.keys(d.workout.exercises).length} lifts</span>}
                    {hasRun && <span style={{ fontSize:10, color:C.text, letterSpacing:"0.05em" }}>⟳ {d.workout.cardio.miles}mi</span>}
                    {hasMacros && <span style={{ fontSize:10, color:C.textDim, letterSpacing:"0.05em" }}>{d.nutrition.calories}cal · {d.nutrition.protein}gP</span>}
                    {d.body?.weight && <span style={{ fontSize:10, color:C.textDim, letterSpacing:"0.05em" }}>{d.body.weight}lb</span>}
                  </div>
                  {hasNote && <div style={{ fontSize:10, color:C.textFaint, fontStyle:"italic", marginTop:4, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:"90%" }}>// {d.workout.notes}</div>}
                </div>
                <span style={{ color:C.textFaint, fontSize:13, flexShrink:0 }} aria-hidden="true">→</span>
              </button>
            );
          })}
        </div>
        </section>
        <section data-section="hist-detail" style={isBroadsheet ? { display: "flex", flexDirection: "column", gap: 12, minWidth: 0 } : { display: "none" }}>
          {dayDetailPanel || dayDetailHint}
        </section>
        </div>
      </div>
    );
  }

  // ── V2.5 Progress Intelligence Loop — reflection-first default view ──
  // Reshape already-computed objects into the "is the plan working?" hierarchy.
  // Block preview reuses the saved (not draft) block settings; all previews are
  // read-only and suggest-only. No program/workout is written from Progress.
  const fcSummaryPreview = buildFormCheckHistorySummary(formCheckHistory);
  const movementTrendsPreview = buildAllMovementTrends(formCheckHistory);

  let blockPlanPreview;
  let blockActionPreview;
  try {
    const blockStartPreview = periodizationSaved.startDate || entries[0]?.[0] || getTodayKey();
    blockPlanPreview = buildPeriodizationPlan({
      startDate: blockStartPreview,
      todayKey: getTodayKey(),
      program,
      entries: data,
      blockLengthWeeks: periodizationSaved.blockLengthWeeks,
      blockName: periodizationSaved.name,
      goal: periodizationSaved.goal,
      deloadWeek: periodizationSaved.deloadWeek,
      runEmphasis: periodizationSaved.runEmphasis,
      strengthEmphasis: periodizationSaved.strengthEmphasis,
    });
    const todayKeyPreview = getTodayKey();
    const yKeyPreview = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; })();
    const todayNamePreview = getDayName(new Date(todayKeyPreview + "T12:00:00"));
    const trainingLoadPreview = computeRollingLoads(buildDailyLoads(data, 28));
    const recoveryPreview = calcRecoveryScore(data[yKeyPreview], data, yKeyPreview);
    const recPreview = getDailyRecommendation(buildDecisionContext({
      todayProgram: program?.[todayNamePreview] || DEFAULT_PROGRAM[todayNamePreview],
      entries: data,
      settings,
      trainingLoad: trainingLoadPreview,
      todayKey: todayKeyPreview,
      recovery: recoveryPreview,
    }));
    blockActionPreview = suggestPeriodizationAction({ plan: blockPlanPreview, todayKey: todayKeyPreview, recommendation: recPreview, entries: data, trainingLoad: trainingLoadPreview });
  } catch {
    blockPlanPreview = null;
    blockActionPreview = null;
  }

  const progressLimiters = buildProgressLimiters({ data, goals, review, decisionFeedback, formCheckSummary: fcSummaryPreview });
  const progressEvidence = buildProgressEvidence({ data, goals, settings });
  const formPreview = buildFormCheckProgressPreview({ formCheckHistory, formCheckSummary: fcSummaryPreview, movementTrends: movementTrendsPreview });
  const blockPreview = buildBlockProgressPreview({ plan: blockPlanPreview, action: blockActionPreview });

  const toneColor = (tone) => tone === "good" ? C.green : tone === "warning" ? C.red : tone === "caution" ? C.text : C.textDim;

  // V16.4 · Overview third column (mockup 1h, completed). The planning
  // DisclosureBlock is MOBILE CHROME — at the tier the spread IS the unfolded
  // view (the Recovery V15.1 fold pattern). The three groups below are the
  // exact JSX previously inlined; mobile composes them in the V13 order with
  // the fold intact, the broadsheet distributes them: figures → center,
  // trends + planning → right rail.
  const ovTrendsChunk = (<>
      {/* ── 3b · Wearable trend context — source-aware, no fabricated trends ── */}
      <DisclosureBlock label="Wearable context" sub={wearableTrends?.hasEnoughData ? "Source-aware recovery trends" : "Building your baseline"}>
      <div style={S.block}>
        <div style={S.blockHead}>
          <span style={S.blockTitle}>{"> "}Wearable Trend Context</span>
          <span style={S.blockStat}>{wearableTrends?.hasEnoughData ? "SOURCE-AWARE" : "BUILDING"}</span>
        </div>
        <div style={{ fontSize: 11.5, color: C.textDim, lineHeight: 1.5, marginTop: 5 }}>
          {wearableTrends?.summary || "Not enough wearable data yet to trend."}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 1, marginTop: 8 }}>
          {(wearableTrends?.notes || []).slice(0, 4).map((note) => (
            <div key={note.metric} style={{ border: `1px solid ${C.lineBright}`, padding: "8px 10px", background: C.block }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                <span style={{ fontSize: 11, color: C.text, letterSpacing: "0.08em", textTransform: "uppercase" }}>{note.label}</span>
                <span style={{ fontSize: 9.5, color: C.textFaint, letterSpacing: "0.08em", textTransform: "uppercase" }}>{note.sourceLabel || "pending"}</span>
              </div>
              <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.45, marginTop: 4 }}>{note.note}</div>
            </div>
          ))}
        </div>
        <div style={{ ...S.annotation, marginTop: 8 }}>Oura and Whoop trends are never averaged; each row names the winning source.</div>
      </div>
      </DisclosureBlock>

      {/* ── 4 · Planning tools, reports, and charts — disclosed on demand. */}
  </>);
  const ovPlanningGroup = (<>
      <div style={S.block}>
        <div style={S.blockHead}>
          <span style={S.blockTitle}>{"> "}Block Guidance</span>
          {blockPreview.available && <span style={{ ...S.blockStat, color:toneColor(blockPreview.riskTone) }}>{blockPreview.weekLabel}</span>}
        </div>
        {blockPreview.available ? (
          <>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", gap:10, marginBottom:6 }}>
              <span style={{ fontSize:14, color:C.text, letterSpacing:"0.04em", textTransform:"uppercase", fontWeight:600 }}>{blockPreview.blockLabel}</span>
              <span style={{ fontSize:11, color:toneColor(blockPreview.riskTone), letterSpacing:"0.06em", textTransform:"uppercase" }}>{blockPreview.actionLabel}</span>
            </div>
            <div style={{ fontFamily:S.fontSerif, fontStyle:"italic", color:C.textDim, fontSize:14, lineHeight:1.4 }}>{blockPreview.rationale}</div>
            <div style={{ ...S.annotation, marginTop:8 }}>{blockPreview.suggestOnlyNote}</div>
          </>
        ) : (
          <div style={{ fontSize:11.5, color:C.textDim, lineHeight:1.5 }}>{blockPreview.rationale}</div>
        )}
        <button onClick={() => setSubView("periodization")} style={{ ...S.smallBtn, width:"100%", textAlign:"left", display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 12px", marginTop:10 }}>
          <span>Open Block View</span>
          <span style={{ fontSize:13, color:C.textFaint }}>→</span>
        </button>
      </div>

      {/* ── 5 · Form Check Trends preview (derived summaries only) ── */}
      <div style={S.block}>
        <div style={S.blockHead}>
          <span style={S.blockTitle}>{"> "}Form Check Trends</span>
          {formPreview.available && formPreview.trendLabel && <span style={S.blockStat}>{formPreview.trendLabel.toUpperCase()}</span>}
        </div>
        {formPreview.available ? (
          <>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", gap:10, marginBottom:5 }}>
              <span style={{ fontSize:13.5, color:C.text, letterSpacing:"0.04em", textTransform:"uppercase" }}>{formPreview.latestLabel}</span>
              {formPreview.scoreLabel && <span style={{ fontSize:11, color:C.textDim }}>{formPreview.scoreLabel}</span>}
            </div>
            <div style={{ fontSize:11.5, color:C.textDim, lineHeight:1.5 }}>→ {formPreview.nextAction}</div>
          </>
        ) : (
          <div style={{ fontSize:11.5, color:C.textDim, lineHeight:1.5 }}>{formPreview.nextAction}</div>
        )}
        <div style={{ fontSize:10, color:C.textFaint, marginTop:8, lineHeight:1.4 }}>{formPreview.privacyNote}</div>
        <button onClick={() => setSubView("form")} style={{ ...S.smallBtn, width:"100%", textAlign:"left", display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 12px", marginTop:10 }}>
          <span>Open Form Check Trends</span>
          <span style={{ fontSize:13, color:C.textFaint }}>→</span>
        </button>
      </div>

      {/* Detailed metrics + charts stay intact inside the Planning tools fold. */}
      {/* Weekly metrics ledger — factual roll-up. Coaching narrative lives in Coach Review below. */}
      <div style={S.block}>
        <div style={S.blockHead}>
          <span style={S.blockTitle}>{"> "}Weekly metrics</span>
          <span style={{ fontSize:16, fontWeight:600, color:scoreColor }}>{review.weekScore}<span style={{ fontSize:10, color:C.textDim }}>/100</span></span>
        </div>
        <div style={{ height:2, background:C.line, marginBottom:10 }}>
          <div style={{ height:"100%", background:scoreColor, width:`${review.weekScore}%` }} />
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:1, background:C.lineBright, border:`1px solid ${C.lineBright}`, marginBottom:10 }}>
          {[
            { val:`${review.workoutsDone}/7`, label:"Workouts", color: review.workoutsDone>=5 ? C.green : C.text },
            { val:`${review.totalMiles}mi`,   label:"Miles",    color: review.totalMiles>=15  ? C.green : C.text },
            { val:`${review.avgProtein}g`,    label:"Protein", color: review.avgProtein>=goals.protein ? C.green : C.text },
            { val:`${review.avgSleep}hrs`,    label:"Sleep", color: parseFloat(review.avgSleep)>=7 ? C.green : C.text },
            { val: review.avgWeight ? `${review.avgWeight}lb` : "—", label:"Weight", color:C.text },
            { val:`${Math.round(review.totalVolume/1000)}k lbs`, label:"Volume", color:C.text },
          ].map(({ val, label, color }) => (
            <div key={label} style={{ background:C.block, padding:"8px 4px", textAlign:"center" }}>
              <div style={{ fontSize:14, fontWeight:600, color }}>{val}</div>
              <div style={{ fontSize: 9.5, color:C.textFaint, letterSpacing:"0.08em", textTransform:"uppercase", marginTop:2 }}>{label}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize:10, color:C.textDim, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:6 }}>Weekly targets</div>
        {TARGET_LABELS.map((label, i) => (
          <div key={i} style={{ display:"flex", alignItems:"center", gap:8, padding:"4px 0", borderBottom:`1px solid ${C.line}` }}>
            <span style={{ color: review.targetChecks[i] ? C.green : C.textFaint, fontSize:13 }}>{review.targetChecks[i] ? "✓" : "○"}</span>
            <span style={{ fontSize:11.5, color: review.targetChecks[i] ? C.text : C.textDim }}>{label}</span>
          </div>
        ))}
        {review.watchouts?.length > 0 && (
          <div style={{ marginTop:10 }}>
            <div style={{ fontSize:10, color:C.textDim, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:6 }}>Watchouts</div>
            {review.watchouts.slice(0, 3).map(item => <div key={item} style={{ fontSize:11.5, color:C.textDim, padding:"3px 0" }}>○ {item}</div>)}
          </div>
        )}
        {review.topLifts.length > 0 && (
          <div style={{ marginTop:12 }}>
            <div style={{ fontSize:10, color:C.textDim, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:6 }}>Top lifts this week</div>
            {review.topLifts.map(([name, weight]) => {
              const orm = epley1RM(weight, 5); // estimate at 5 reps as a conservative benchmark
              return (
                <div key={name} style={{ display:"flex", justifyContent:"space-between", padding:"4px 0", fontSize:11.5 }}>
                  <span style={{ color:C.text, textTransform:"uppercase", letterSpacing:"0.03em" }}>{name}</span>
                  <span style={{ color:C.text }}>
                    {weight} lbs
                    {orm && <span style={{ color:C.textDim, marginLeft:6 }}>· ~{orm} 1RM est.</span>}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>


  </>);
  const ovFiguresGroup = (<>
      {/* ── V11 · Per-muscle weekly volume audit ── */}
      <MuscleVolumeSection data={data} />

      {/* ── V12 · Per-lift e1RM trends + stall detection ── */}
      <LiftIntelligenceSection data={data} />

      {/* ── V12 · Recovery map — what's fresh today ── */}
      <MuscleRecencyMap data={data} />

      {/* ── V7 · Coach calibration — decision responses vs next-day recovery ── */}
      <CalibrationReport data={data} wearableTrends={wearableTrends} />

      {/* ── V7 · N=1 correlation explorer — collapsed by default ── */}
      <CorrelationExplorer data={data} />

      {/* ── V10 · Bodyweight trend — smoothed line over raw weigh-ins ── */}
      <WeightTrendFigure data={data} />

      {/* V13.3 · Weekly running miles — manual + Strava, deduped per day. */}
      <RunningVolumeFigure data={data} settings={settings} />

      <div style={S.block}>
        <div style={S.blockHead}><span style={S.blockTitle}>{"> "}All-Time</span></div>
        <div style={S.bodyLine}>
          <div style={S.bodyCell}><div style={{ fontSize:17, fontWeight:600, color:C.text }}>{workoutsDone}</div><div style={S.bodyL}>Workouts</div></div>
          <div style={S.bodyCell}><div style={{ fontSize:17, fontWeight:600, color:C.text  }}>{totalMiles.toFixed(0)}</div><div style={S.bodyL}>Miles</div></div>
          <div style={S.bodyCell}><div style={{ fontSize:17, fontWeight:600, color:C.text  }}>{entries.length}</div><div style={S.bodyL}>Days</div></div>
          <div style={S.bodyCell}><div style={{ fontSize:17, fontWeight:600, color:streakColor }}>{streak.count}</div><div style={S.bodyL}>Streak</div></div>
        </div>
      </div>
      <div style={S.block}>
        <div style={S.blockHead}><span style={S.blockTitle}>{"> "}30-Day Averages</span></div>
        <div style={S.progRow}><span>BODY WEIGHT</span><span style={{ color:C.text }}>{avg(weights)} lbs</span></div>
        <div style={{ ...S.bar, marginBottom:10 }} />
        <div style={S.progRow}><span>DAILY PROTEIN</span><span style={{ color:C.text }}>{avg(proteins)} g</span></div>
        <div style={{ ...S.bar, marginBottom:10 }} />
        <div style={S.progRow}><span>SLEEP</span><span style={{ color:C.text }}>{avg(sleeps)} hrs</span></div>
      </div>
      {weights.length>1  && <div style={S.block}><div style={S.blockHead}><span style={S.blockTitle}>{"> "}Weight Trend</span><span style={S.blockStat}>LAST 30D</span></div><MiniChart data={weights} color={C.green} unit="" /></div>}
      {proteins.length>1 && <div style={S.block}><div style={S.blockHead}><span style={S.blockTitle}>{"> "}Protein Trend</span><span style={S.blockStat}>TARGET {goals.protein}g</span></div><MiniChart data={proteins} color={C.text} unit="g" target={goals.protein} /></div>}
      <RunPaceTrend data={data} />
      <RecoveryLoadFigure data={data} />
  </>);

  return (
    <div>
      <ProgressSubnav subView={subView} setSubView={setSubView} formBadge={formBadge} />

      {/* V15.2 · Broadsheet Overview spread. The mockup's full three-column
          cut (1h) would slice through the planning-tools DisclosureBlock —
          stateful chrome — so this ships the structure-respecting two-column
          form: verdict rail left, plates + tools right (disclosure opened by
          default at the tier). The 3-col refinement needs the disclosure
          restructured first; tracked in the plan. */}
      <div style={isBroadsheet ? { display: "grid", gridTemplateColumns: "var(--ovt-rail-m) 1fr var(--ovt-rail-s)", gap: 20, alignItems: "start" } : { display: "contents" }}>
      <section data-section="ov-verdict" style={isBroadsheet ? { display: "flex", flexDirection: "column", gap: 12, minWidth: 0, gridColumn: 1, gridRow: 1 } : { display: "contents" }}>
      {/* ── 2 · Limiting Factors ── */}
      <div style={S.block}>
        <div style={S.blockHead}><span style={S.blockTitle}>{"> "}Limiting Factors</span></div>
        <div style={{ display:"flex", flexDirection:"column", gap:1, marginTop:6 }}>
          {progressLimiters.slice(0, 1).map((card) => (
            <div key={card.id} style={{ border:`1px solid ${C.lineBright}`, borderLeft:`2px solid ${toneColor(card.tone)}`, padding:"10px 12px", background:C.block }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", gap:10 }}>
                <span style={{ fontSize:13, color:C.text, letterSpacing:"0.04em", textTransform:"uppercase" }}>{card.title}</span>
                <span style={{ fontSize:10, color:toneColor(card.tone), letterSpacing:"0.08em", textTransform:"uppercase" }}>{card.status}</span>
              </div>
              <div style={{ fontSize:11.5, color:C.textDim, marginTop:5, lineHeight:1.45 }}>{card.body}</div>
              <div style={{ fontSize:10.5, color:C.textFaint, marginTop:6, letterSpacing:"0.04em" }}>{card.metric}{card.action ? ` · ${card.action}` : ""}</div>
            </div>
          ))}
        </div>
        <div style={{ ...S.annotation, marginTop:8 }}>conservative read — likely limiters, not diagnoses</div>
      </div>

      {/* ── 3 · Evidence behind the verdict — disclosed on demand. */}
      <DisclosureBlock label="Trend evidence" sub={`${progressEvidence.streakLabel} · last 30 days`}>
        {progressLimiters.length > 1 && (
          <div style={S.block}>
            <div style={S.blockHead}><span style={S.blockTitle}>{"> "}Other limiting factors</span></div>
            <div style={{ display:"flex", flexDirection:"column", gap:1, marginTop:6 }}>
              {progressLimiters.slice(1).map((card) => (
                <div key={card.id} style={{ border:`1px solid ${C.lineBright}`, borderLeft:`2px solid ${toneColor(card.tone)}`, padding:"10px 12px", background:C.block }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", gap:10 }}>
                    <span style={{ fontSize:13, color:C.text, letterSpacing:"0.04em", textTransform:"uppercase" }}>{card.title}</span>
                    <span style={{ fontSize:10, color:toneColor(card.tone), letterSpacing:"0.08em", textTransform:"uppercase" }}>{card.status}</span>
                  </div>
                  <div style={{ fontSize:11.5, color:C.textDim, marginTop:5, lineHeight:1.45 }}>{card.body}</div>
                  <div style={{ fontSize:10.5, color:C.textFaint, marginTop:6, letterSpacing:"0.04em" }}>{card.metric}{card.action ? ` · ${card.action}` : ""}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      <div style={S.block}>
        <div style={S.blockHead}><span style={S.blockTitle}>{"> "}Trend Evidence</span><span style={S.blockStat}>LAST 30D · {progressEvidence.streakLabel.toUpperCase()}</span></div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(2, 1fr)", gap:1, background:C.lineBright, border:`1px solid ${C.lineBright}` }}>
          {progressEvidence.cards.map((card) => (
            <div key={card.label} style={{ background:C.block, padding:"9px 10px" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", gap:8 }}>
                <span style={{ fontSize:9.5, color:C.textFaint, letterSpacing:"0.1em", textTransform:"uppercase" }}>{card.label}</span>
              </div>
              <div style={{ fontSize:15, fontWeight:600, color:toneColor(card.tone), marginTop:3 }}>{card.value}</div>
              <div style={{ fontSize:10, color:C.textFaint, marginTop:2, letterSpacing:"0.04em" }}>{card.subtext}</div>
            </div>
          ))}
        </div>
        <div style={{ ...S.annotation, marginTop:8 }}>full weekly ledger &amp; trend charts are in Planning tools</div>
      </div>
      </DisclosureBlock>

      </section>
      <section data-section="ov-plates" style={isBroadsheet ? { display: "flex", flexDirection: "column", gap: 12, minWidth: 0, gridColumn: 2, gridRow: 1 } : { display: "contents" }}>
      {isBroadsheet ? (
        <Suspense fallback={<div style={S.block}><div style={S.annotation}>Loading figures…</div></div>}>
          {ovFiguresGroup}
        </Suspense>
      ) : (<>
        {ovTrendsChunk}
        <DisclosureBlock label="Planning tools" sub="Block guidance, form trends, weekly ledger, and charts">
      <Suspense fallback={<div style={S.block}><div style={S.annotation}>Loading planning tools…</div></div>}>
          {ovPlanningGroup}
          {ovFiguresGroup}
        </Suspense>
        </DisclosureBlock>
      </>)}
      </section>
      <section data-section="ov-trends" style={isBroadsheet ? { display: "flex", flexDirection: "column", gap: 12, minWidth: 0, gridColumn: 3, gridRow: 1 } : { display: "contents" }}>
        {isBroadsheet && (<>
          {ovTrendsChunk}
          <Suspense fallback={<div style={S.block}><div style={S.annotation}>Loading planning tools…</div></div>}>
            {ovPlanningGroup}
          </Suspense>
        </>)}
      </section>
      </div>
    </div>
  );
}

// ─── Run Pace Trend Chart ─────────────────────────────────────────────────────
// Converts pace string "mm:ss" to seconds for charting, back to "mm:ss" for display
function paceToSeconds(paceStr) {
  if (!paceStr || typeof paceStr !== "string") return null;
  const clean = paceStr.replace("/mi","").replace("/mile","").trim();
  const parts = clean.split(":");
  if (parts.length !== 2) return null;
  const mins = parseInt(parts[0]);
  const secs = parseInt(parts[1]);
  if (isNaN(mins) || isNaN(secs)) return null;
  return mins * 60 + secs;
}

function secondsToPace(secs) {
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return `${m}:${String(s).padStart(2,"0")}`;
}

function RunPaceTrend({  data }) {
  const { C, S } = useTheme();
  const mono = C.fontFamily;
  const entries = Object.entries(data).sort((a,b) => a[0].localeCompare(b[0]));

  // Collect pace + miles per run entry (last 30 days)
  const runData = entries
    .slice(-30)
    .map(([date, d]) => {
      const pace  = paceToSeconds(d.workout?.cardio?.pace);
      const miles = parseFloat(d.workout?.cardio?.miles) || 0;
      return pace && miles > 0 ? { date, pace, miles } : null;
    })
    .filter(Boolean);

  if (runData.length < 2) return null;

  const paces  = runData.map(r => r.pace);
  const minP   = Math.min(...paces);
  const maxP   = Math.max(...paces);
  const rangeP = maxP - minP || 1;

  // Note: lower pace = faster. We invert Y so faster (lower) is higher on chart.
  const w = 300, h = 80, pad = 10;
  const points = paces.map((p, i) => ({
    x: pad + (i / (paces.length - 1 || 1)) * (w - 2 * pad),
    // Invert: fast pace (low seconds) plots HIGH
    y: pad + ((p - minP) / rangeP) * (h - 2 * pad),
  }));
  const path = points.map((p,i) => `${i===0?"M":"L"} ${p.x} ${p.y}`).join(" ");

  const bestPace   = Math.min(...paces);
  const latestPace = paces[paces.length - 1];
  const trendColor = latestPace <= bestPace ? C.green : C.textDim;

  return (
    <div style={S.block}>
      <div style={S.blockHead}>
        <span style={S.blockTitle}>{"> "}Run Pace Trend</span>
        <span style={S.blockStat}>LAST 30D · {runData.length} RUNS</span>
      </div>

      {/* Summary stats */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:1, background:C.lineBright, border:`1px solid ${C.lineBright}`, marginBottom:10 }}>
        <div style={{ background:C.block, padding:"7px 4px", textAlign:"center" }}>
          <div style={{ fontSize:14, fontWeight:600, color:C.text }}>{secondsToPace(bestPace)}</div>
          <div style={{ fontSize: 9.5, color:C.textFaint, letterSpacing:"0.08em", textTransform:"uppercase", marginTop:2 }}>Best /mi</div>
        </div>
        <div style={{ background:C.block, padding:"7px 4px", textAlign:"center" }}>
          <div style={{ fontSize:14, fontWeight:600, color:C.text }}>{secondsToPace(Math.round(paces.reduce((a,b)=>a+b,0)/paces.length))}</div>
          <div style={{ fontSize: 9.5, color:C.textFaint, letterSpacing:"0.08em", textTransform:"uppercase", marginTop:2 }}>Avg /mi</div>
        </div>
        <div style={{ background:C.block, padding:"7px 4px", textAlign:"center" }}>
          <div style={{ fontSize:14, fontWeight:600, color:trendColor }}>{secondsToPace(latestPace)}</div>
          <div style={{ fontSize: 9.5, color:C.textFaint, letterSpacing:"0.08em", textTransform:"uppercase", marginTop:2 }}>Latest /mi</div>
        </div>
      </div>

      {/* Chart — inverted so faster (lower pace) is visually higher */}
      <div style={{ position:"relative" }}>
        <div style={{ fontSize:9.5, color:C.textFaint, letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:4, display:"flex", justifyContent:"space-between" }}>
          <span>faster ↑</span>
          <span>↓ slower</span>
        </div>
        <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} style={{ display:"block" }}>
          {/* Best pace reference line */}
          <line
            x1={pad} y1={pad + ((bestPace - minP) / rangeP) * (h - 2 * pad)}
            x2={w-pad} y2={pad + ((bestPace - minP) / rangeP) * (h - 2 * pad)}
            stroke={C.line} strokeWidth={1} strokeDasharray="3,3"
          />
          <path d={path} fill="none" stroke={C.text} strokeWidth={1.5} />
          {points.map((p,i) => (
            <rect key={i} x={p.x-2} y={p.y-2} width={4} height={4} fill={C.text} />
          ))}
          {/* Latest pace label */}
          <text x={w-pad} y={points[points.length-1].y - 5} textAnchor="end" fill={trendColor} fontSize={8} fontFamily={mono}>
            {secondsToPace(latestPace)}
          </text>
        </svg>
        <div style={{ display:"flex", gap:12, marginTop:6 }}>
          <div style={{ display:"flex", alignItems:"center", gap:4, fontSize:9.5, color:C.textDim }}>
            <div style={{ width:12, height:1, background:C.textDim, borderTop:"1px dashed" }} />
            best pace
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:4, fontSize:9.5, color:C.textDim }}>
            <div style={{ width:12, height:2, background:C.text }} />
            your pace
          </div>
        </div>
      </div>

      {/* Recent runs table */}
      <div style={{ marginTop:12 }}>
        <div style={{ fontSize:9.5, color:C.textDim, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:6 }}>Recent runs</div>
        {runData.slice(-5).reverse().map((r, i) => (
          <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"4px 0", borderBottom:`1px solid ${C.line}`, fontSize:11 }}>
            <span style={{ color:C.textDim }}>{r.date}</span>
            <span style={{ color:C.text }}>{r.miles}mi</span>
            <span style={{ color: r.pace <= bestPace ? C.green : C.text, fontWeight:600 }}>{secondsToPace(r.pace)}/mi</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MiniChart({ data, color, unit, target }) {
  return (
    <LineFigure
      width={300}
      height={70}
      series={[{ values: data, stroke: color, endLabel: `${data[data.length - 1]}${unit || ""}` }]}
      referenceLines={target ? [{ value: target, label: `TARGET ${target}${unit || ""}` }] : []}
      ariaLabel={`Trend over ${data.length} entries${target ? `, target ${target}${unit || ""}` : ""}. Latest ${data[data.length - 1]}${unit || ""}.`}
    />
  );
}
