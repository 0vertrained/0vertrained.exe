// src/ProgressTab.jsx
// Progress opens on one thing, this week's likely limiter, with the weekly
// review behind it. Under that are the trends, each its own screen: Strength,
// Running, Body, Recovery, and History. Block (the periodization view) opens
// from Train. Every screen reads the same logged data it always has; nothing
// here writes to a program or a workout.
import { Fragment, useState, useEffect, useRef, lazy, Suspense } from "react";
import { useMediaQuery, BROADSHEET_QUERY } from "./ui/useMediaQuery";
import { Icon, LinkRow, QuickNumber } from "./ui/ledger";
import { useTopBar } from "./ui/shell";
import { getTodayKey } from "./constants";
import { getLoggedCardioBlocks, hasLoggedWorkout } from "./loadModel";
import { cardioModality, cardioResultText } from "./cardioLog";
import { manualMilesForDay } from "./runningVolume";
import { calcWeeklyReview } from "./recovery";
import { buildWeeklyCoachReview } from "./weeklyCoachReview";
import { buildCoachingCalibrationProfile } from "./coachingCalibration";
import { WeeklyCoachingReview, weekInNumbers, ON_TARGET_NOTE } from "./WeeklyCoachingReview";
import { isOuraConnected, loadOuraData } from "./oura";
import { isWhoopConnected, loadWhoopData } from "./whoop";
import { buildDecisionFeedbackWeekly } from "./decisionFeedback";
import { buildPeriodizationPlan, suggestPeriodizationAction } from "./periodizationPlanner";
import { normalizePeriodizationSettings, readStoredPeriodization } from "./periodizationSettings";
import { calcStreak } from "./AppHeader";
import { LoadingShell } from "./ui/primitives";
import { getSkeletonPlan } from "./uiStability";
import { buildProgressLimiters, buildProgressEvidence, buildBlockProgressPreview } from "./progressSummary";
import { buildWearableTrendNotes } from "./recovery/wearableProgressContext";
import { epley1RM } from "./TodayTab";
import { ProgressHistory } from "./ProgressHistory";
import { RaceWeekLine } from "./RaceWeekLine";
import { PhysiqueSection } from "./sections/PhysiqueSection";
import { ProgressPhotos } from "./sections/ProgressPhotos";
import { ColumnChart, dayDate } from "./sections/charts";

const lazyNamed = (loader, name) => lazy(() => loader().then((module) => ({ default: module[name] })));
const CalibrationReport = lazyNamed(() => import("./ProgressInsights"), "CalibrationReport");
const CorrelationExplorer = lazyNamed(() => import("./ProgressInsights"), "CorrelationExplorer");
const WeightTrendFigure = lazyNamed(() => import("./WeightTrendFigure"), "WeightTrendFigure");
const RunningVolumeFigure = lazyNamed(() => import("./sections/RunningVolumeFigure"), "RunningVolumeFigure");
const RunningProgress = lazyNamed(() => import("./sections/RunningProgress"), "RunningProgress");
const MuscleVolumeSection = lazyNamed(() => import("./MuscleVolumeSection"), "MuscleVolumeSection");
const LiftIntelligenceSection = lazyNamed(() => import("./LiftIntelligenceSection"), "LiftIntelligenceSection");
const MuscleRecencyMap = lazyNamed(() => import("./LiftIntelligenceSection"), "MuscleRecencyMap");
const RecoveryLoadFigure = lazyNamed(() => import("./sections/TrendCharts"), "RecoveryLoadFigure");

const NBSP = "\u00a0";
const SCREEN_TITLES = { strength: "Strength", running: "Running", body: "Body", recovery: "Recovery", review: "Weekly review", history: "History" };
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
export function ProgressTab({ owner, onRaceClimb, data, settings, program, baseProgram = program, loaded, updateEntryAtDate, showToast, onOpenDay, onOpenEdition = null, onOpenBlock = null }) {
  // Train links straight to the block ("program") and to history; Back from
  // either returns there.
  // home | strength | running | body | recovery | review | history
  const [subView, setSubView] = useState("home");
  const [selectedDay, setSelectedDay] = useState(null);
  const isBroadsheet = useMediaQuery(BROADSHEET_QUERY);
  // The saved block settings, read once for the weekly review's block row.
  // They are edited in Train, under Block (BlockScreen.jsx).
  const [periodizationSaved] = useState(() => normalizePeriodizationSettings(readStoredPeriodization() || {}));
  const [wearableTrends, setWearableTrends] = useState(() => buildWearableTrendNotes({}));

  // A screen under Progress: its name in the top bar, and Back to where it
  // came from. A day opened from History on a phone goes back to History.
  const dayOpen = Boolean(selectedDay) && !isBroadsheet && subView === "history";
  useTopBar(subView === "home" ? null : dayOpen
    ? { title: dayDate(selectedDay), back: "History", onBack: () => setSelectedDay(null) }
    : { title: SCREEN_TITLES[subView] || "Progress", back: "Progress", onBack: () => { setSelectedDay(null); setSubView("home"); } });
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
  const workoutsDone = entries.filter(([, day]) => hasLoggedWorkout(day)).length;
  const totalMiles = entries.reduce((acc,[,d]) => acc + manualMilesForDay(d),0);
  const goals = settings?.goals || { protein:200, calories:3600, water:128 };
  const review = calcWeeklyReview(data, goals);
  const TARGET_LABELS = review.targetLabels || ["5 or more workouts", "15 or more miles", `${goals.protein} g protein on 5 days`, "7 hours of sleep a night", "Water goal on 5 days"];
  const calibrationProfile = buildCoachingCalibrationProfile({ data, wearableTrends });
  const coachReview = buildWeeklyCoachReview({ data, goals, settings, program, wearableTrends, calibrationProfile });
  const decisionFeedback = buildDecisionFeedbackWeekly(data);
  const streak = calcStreak(data);

  if (subView === "history") {
    return (
      <ProgressHistory
        owner={owner} onRaceClimb={onRaceClimb}
        data={data}
        program={baseProgram}
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
  const runs = last30.flatMap(([date, day]) => getLoggedCardioBlocks(day.workout)
    .filter(block => cardioModality(block) === "run")
    .map((block, index) => ({ ...block, pace: paceToSeconds(block.pace), date, key: `${date}-${index}` })));
  const runningScreen = [
    <Fragment key="figures">
      <Suspense fallback={loading("weekly miles")}>
        <RunningVolumeFigure data={data} settings={settings} />
      </Suspense>
      <Suspense fallback={loading("races and easy pace")}>
        <RunningProgress owner={owner} data={data} program={baseProgram} todayKey={todayKey} />
      </Suspense>
    </Fragment>,
    <Fragment key="runs">
      <RaceWeekLine program={program} dateKey={todayKey} />
      {runs.length > 0 && (
        <section aria-labelledby="runs-title" style={column(4)}>
          <h2 id="runs-title" className="t-h">Recent runs</h2>
          <ul className="rows">
            {runs.slice(-5).reverse().map((run) => (
              <li key={run.key} className="row" style={{ minHeight: 56 }}>
                <span className="kv grow">
                  <span className="t-bs">{dayDate(run.date)}</span>
                  <span className="n-s c2">{[cardioResultText(run), run.pace ? `${secondsToPace(run.pace)}${NBSP}min/mi` : ""].filter(Boolean).join(" · ")}</span>
                </span>
                {run.race && <span className="tag tag-f">Race</span>}
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
      <PhysiqueSection
        data={data}
        todayKey={todayKey}
        onSave={updateEntryAtDate ? (measurement, value) => { updateEntryAtDate(todayKey, `body.${measurement.key}`, String(value)); showToast?.(`${measurement.label} measurement saved`); } : null}
      />
      <ProgressPhotos owner={owner} todayKey={todayKey} showToast={showToast} />
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
    <WeeklyCoachingReview key="review" data={data} goals={goals} weeklySamples={calibrationProfile.weekly.samples} review={coachReview} week={review} limiter={limiter} updateEntryAtDate={updateEntryAtDate} showToast={showToast} />,
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

      <button type="button" className="row" onClick={() => onOpenBlock?.()} style={{ borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)", minHeight: 64, alignItems: "flex-start", paddingTop: 10, paddingBottom: 10 }}>
        <span className="kv grow">
          <span className="t-bs">Block{blockPreview.available ? `: ${blockPreview.blockLabel}, ${blockPreview.weekLabel.toLowerCase().replace("/", " of ")}` : ""}</span>
          {blockPreview.available && <span className="t-s">{blockPreview.actionLabel}</span>}
          <span className="t-s c2">{blockPreview.rationale}</span>
        </span>
        <Icon name="next" size="s" className="c2" />
      </button>

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
    ["body", "Body", review.avgWeight ? `Averaging ${review.avgWeight}${NBSP}lb over the last 7 days` : "Bodyweight, measurements and protein"],
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
  // Sunday evening: the week's edition, while it is out.
  const editionLine = typeof onOpenEdition === "function" && (
    <LinkRow label="The Sunday Edition is out" sub="Your week, ending on one change" onClick={onOpenEdition} style={{ borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }} />
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
              {editionLine}
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
              <p className="t-s c2" style={{ marginTop: 8 }}>{ON_TARGET_NOTE}</p>
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
        {editionLine}
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
