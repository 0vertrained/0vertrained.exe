// src/TrainTab.jsx
// Train: the plan, in one place. Today's session, the seven days of this
// week, and the rows that lead to the program, the block, the race plan and
// history. Each of those is a screen of Train, one level down, with Train's
// own Back: Program and its editor (ProgramScreen.jsx), the builder, the race
// plan, the block and history.
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { DAYS, DEFAULT_PROGRAM, getTodayKey } from "./constants";
import { getProgramSessions, flattenProgramLifting, usesProgramSessions } from "./programSessions";
import { summarizeProgramDay } from "./programSummary";
import { isExerciseHandled } from "./workoutLogging";
import { mondayKeyOf, describeBuildWeek, keepRacePlan } from "./raceBuild";
import { isRunPlanSpec } from "./runPlanGenerator";
import { formatPlanDate, raceWeekCopy, hybridWeekLabel } from "./RaceWeekLine";
import { summarizeProgramForHub } from "./moreHub";
import { Icon, LinkRow } from "./ui/ledger";
import { useTopBar } from "./ui/shell";
import { ProgramHome, ProgramEditor, RoadTrailBlock } from "./ProgramScreen";
import { changeHybridRacePlan } from "./hybridRaceAlignment";
import { describeRoadTrailWeek } from "./plans/roadTrailHybrid";
import { ProgramBuilderPanel } from "./ProgramBuilderPanel";
import { RacePlanPanel } from "./RacePlanPanel";
import { useMediaQuery, BROADSHEET_QUERY } from "./ui/useMediaQuery";
import { dayDate } from "./sections/charts";
import { canResetWeek, hasSessionEditOn, movedFrom, raceMoveLock, resetWeek, swapDays, weekMovesFor } from "./weekMoves";
import { SessionSchedule } from "./MoveSession";
import { legacyCardioSessionId } from "./cardioLog";
import { workoutStarted } from "./sessionMoves";
import { MoveDaySheet } from "./MoveDay";

// The block brings the planner and the decision engine with it, so it loads
// when it is opened.
const ClimbHub = lazy(() => import("./climb/ClimbHub"));
const RaceRehearsal = lazy(() => import("./rehearsal/RaceRehearsal").then(module => ({ default: module.RaceRehearsal })));
const BlockScreen = lazy(() => import("./BlockScreen").then((module) => ({ default: module.BlockScreen })));
// History is Progress's; it loads when it is opened here too.
const ProgressHistory = lazy(() => import("./ProgressHistory").then((module) => ({ default: module.ProgressHistory })));

const TITLES = { climb: "Race the Climb", rehearsal: "Race rehearsal", program: "Program", edit: "Edit the week", build: "Build a program", race: "Race plan", block: "Block", history: "History" };
const PARENT = { edit: "Program", build: "Program" };
const loading = (what) => <div className="shell"><div className="main"><p className="t-s c2" role="status">Loading {what}…</p></div></div>;

const NBSP = "\u00a0";

function keyOf(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function shortDate(dateKey, options) {
  return new Date(`${dateKey}T12:00:00`).toLocaleDateString("en-US", options).replace(" ", NBSP);
}

// The seven days of the week that holds todayKey, Monday first, each with its
// planned day and what has been logged against it.
export function buildTrainWeek({ program, entries, todayKey }) {
  const monday = new Date(`${mondayKeyOf(todayKey)}T12:00:00`);
  return DAYS.map((dayName, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    const dateKey = keyOf(date);
    const day = program?.[dayName] || {};
    const summary = summarizeProgramDay(day);
    const lifting = flattenProgramLifting(day);
    const logged = entries?.[dateKey]?.workout || {};
    const doneLifts = lifting.filter((exercise) => isExerciseHandled(exercise, logged.exercises?.[exercise.name] || {})).length;
    const sessions = getProgramSessions(day);
    const cardios = sessions.filter(session => session.cardio);
    const hasCardio = cardios.length > 0;
    const split = usesProgramSessions(day);
    const legacyId = split ? legacyCardioSessionId(sessions, logged) : null;
    const recorded = session => {
      const block = split && session.id !== legacyId ? logged.cardioSessions?.[session.id] : logged.cardio;
      return (parseFloat(block?.miles) || 0) > 0 || String(block?.time || "").trim() !== "";
    };
    const isRest = lifting.length === 0 && !hasCardio;
    const done = !isRest && doneLifts === lifting.length && cardios.every(recorded);
    const when = dateKey === todayKey ? "today" : dateKey < todayKey ? "past" : "ahead";
    const from = movedFrom(program, dateKey);
    const parts = from ? [`From ${from}`] : [];
    if (lifting.length) parts.push(done ? "Lifting" : when === "ahead" ? `${lifting.length}${NBSP}exercises` : `${doneLifts} of ${lifting.length}${NBSP}exercises`);
    for (const session of cardios) {
      parts.push(summarizeProgramDay({ cardio: session.cardio }).cardioLabel);
    }
    if (done) parts.push("done");
    return {
      dayName, dateKey, when, isRest, done,
      split, started: workoutStarted(logged),
      label: `${dayName.slice(0, 3)}${NBSP}${date.getDate()}`,
      title: isRest ? "Rest day" : (summary.label || dayName),
      detail: isRest ? [...parts, "No training planned"].join(" · ") : parts.join(" · "),
      liftCount: lifting.length, sessions, moveLock: raceMoveLock(program, dateKey) || (hasSessionEditOn(program, dateKey) ? "Individual session rescheduled" : null),
    };
  });
}

export function TrainTab({ owner, initialHealthRun, onSaveClimbAttempt, onSaveRehearsalAttempt, program, liveProgram, entries, settings, onSaveProgram, onApplyGeneratedProgram, onStartToday, onOpenDay, initialView = null }) {
  // "home", or one of its screens: program, edit, build, race, block, history.
  const [historyRun, setHistoryRun] = useState(initialHealthRun || null);
  const [view, setView] = useState(initialView === "climb" ? "climb" : initialView === "block" ? "block" : "home");
  const [editDay, setEditDay] = useState(null);
  const [selectedDay, setSelectedDay] = useState(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const isBroadsheet = useMediaQuery(BROADSHEET_QUERY);
  // The editor's check before Back drops unsaved changes.
  const leaveGuard = useRef(null);
  const setLeaveGuard = useCallback((fn) => { leaveGuard.current = fn; }, []);
  // A screen opened from Train starts at its top, not wherever Train was scrolled.
  const firstView = useRef(true);
  useEffect(() => {
    if (firstView.current) { firstView.current = false; return; }
    (document.scrollingElement || document.documentElement).scrollTop = 0;
  }, [view]);
  const todayKey = getTodayKey();
  const shown = liveProgram || program;
  const week = buildTrainWeek({ program: shown, entries, todayKey });
  const today = week.find((d) => d.when === "today") || week[0];
  const planSummary = summarizeProgramForHub(program);
  const hasRacePlan = isRunPlanSpec(program?.__raceBuild);
  const hybridWeek = describeRoadTrailWeek(program, todayKey);
  const raceCopy = hasRacePlan ? raceWeekCopy(describeBuildWeek(program, todayKey)) : null;
  // This week's moved days, kept on the program for this week only.
  const weekMoved = Boolean(weekMovesFor(program, todayKey));
  const swapThisWeek = (first, second) => onSaveProgram(swapDays(program || DEFAULT_PROGRAM, todayKey, first, second), { savedMessage: `${first} and ${second} swapped for this week` });
  const resetThisWeek = () => onSaveProgram(resetWeek(program || DEFAULT_PROGRAM, todayKey), { savedMessage: "This week is back as planned" });

  const dayOpen = view === "history" && Boolean(selectedDay) && !isBroadsheet;
  useTopBar(view === "home" ? null : dayOpen
    ? { title: dayDate(selectedDay), back: "History", onBack: () => setSelectedDay(null) }
    : {
      title: TITLES[view] || "Train",
      back: PARENT[view] || "Train",
      onBack: async () => {
        if (view === "edit" && leaveGuard.current && !(await leaveGuard.current())) return;
        setSelectedDay(null);
        setView(PARENT[view] ? "program" : "home");
      },
    });

  if (view === "block") {
    if (hybridWeek) return <RoadTrailBlock program={program} entries={entries} week={hybridWeek} todayKey={todayKey} onSaveProgram={onSaveProgram} onOpenProgram={() => setView("program")} />;
    return (
      <Suspense fallback={loading("the block")}>
        <BlockScreen data={entries} settings={settings} program={shown} onOpenProgram={() => setView("program")} />
      </Suspense>
    );
  }

  if (view === "program") {
    return <ProgramHome program={program} liveProgram={liveProgram} todayKey={todayKey} onOpenBlock={() => setView("block")} onSaveProgram={onSaveProgram} onBuild={() => setView("build")} onEdit={(day = null) => { setEditDay(day); setView("edit"); }} />;
  }
  if (view === "edit") {
    return <ProgramEditor program={program} initialDay={editDay} onSaveProgram={onSaveProgram} onDone={() => setView("program")} onGuard={setLeaveGuard} />;
  }
  if (view === "build") {
    return (
      <ProgramBuilderPanel
        settings={settings}
        hasRacePlan={hasRacePlan}
        initialGoal={settings?.programBuilder?.goal || undefined}
        onApply={async (payload) => {
          const generated = payload.keepExistingRace === false ? payload.program : keepRacePlan(program, payload.program);
          const ok = await onApplyGeneratedProgram({ ...payload, program: generated });
          if (ok !== false) setView("program");
        }}
      />
    );
  }
  // Race plan: Save writes the spec into the program's marker; End removes
  // it. Both go through the normal program save path.
  if (view === "climb") {
    return <Suspense fallback={loading("Race the Climb")}><ClimbHub key={owner} owner={owner} entries={entries} program={program}
      todayKey={todayKey} onSaveProgram={onSaveProgram} onSaveAttempt={onSaveClimbAttempt} initialHealthRun={historyRun} fromToday={initialView === "climb" && !historyRun} /></Suspense>;
  }
  if (view === "rehearsal") {
    return <Suspense fallback={<p className="t-s c2">Opening race rehearsal…</p>}>
      <RaceRehearsal onOpenClimb={() => { setHistoryRun(null); setView("climb"); }} owner={owner} program={program} entries={entries} todayKey={todayKey} onSaveProgram={onSaveProgram} onSaveAttempt={onSaveRehearsalAttempt} />
    </Suspense>;
  }
  if (view === "race") {
    const base = program || DEFAULT_PROGRAM;
    return (
      <RacePlanPanel
        program={base}
        todayKey={todayKey}
        onOpenBlock={hybridWeek ? () => setView("block") : undefined}
        onSave={async (spec) => {
          const ok = await onSaveProgram(changeHybridRacePlan(base, spec, entries, todayKey));
          if (ok) setView(hybridWeek ? "block" : "home");
          return ok;
        }}
        onEnd={async () => {
          const ok = await onSaveProgram(changeHybridRacePlan(base, null, entries, todayKey));
          if (ok) setView("home");
          return ok;
        }}
      />
    );
  }
  if (view === "history") {
    return (
      <Suspense fallback={loading("history")}>
        <ProgressHistory owner={owner} onRaceClimb={run => { setHistoryRun(run); setView("climb"); }} data={entries} program={program} goals={settings?.goals} selectedDay={selectedDay} onSelectDay={setSelectedDay} isBroadsheet={isBroadsheet} onOpenDay={onOpenDay} />
      </Suspense>
    );
  }

  return (
    <div className="shell">
      <div className="main" style={{ gap: 16 }}>
        <section className="card" aria-labelledby="train-today" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <p className="t-c c2">Today · {shortDate(todayKey, { weekday: "short", month: "short", day: "numeric" })}</p>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <h2 id="train-today" className="t-h grow clip">{today.title}</h2>
            {today.liftCount > 0 && <span className="t-s c2">{today.liftCount}{NBSP}exercises</span>}
          </div>
          {today.sessions.length > 1 && <ul className="rows" aria-label="Today’s sessions">
            {today.sessions.map(session => <li key={session.id} className="row" style={{ minHeight: 36 }}>
              <span className="t-ss c2">{session.label}</span>
              <span className="t-s grow">{session.title}</span>
              {session.cardio?.minutes > 0 && <span className="t-s c2">{session.cardio.minutes}{NBSP}min</span>}
            </li>)}
          </ul>}
          {today.isRest
            ? <p className="t-s c2">No training planned. A planned rest day counts as a day kept.</p>
            : today.done
              ? <p className="t-s c2" style={{ display: "flex", alignItems: "center", gap: 6 }}><Icon name="done" size="s" className="good" />Done for today.</p>
              : <button type="button" className="btn btn-p btn-b" onClick={onStartToday}>{today.started ? "Resume session" : "Start session"}</button>}
        </section>

        <section aria-labelledby="train-week" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div className="sec">
            <h2 id="train-week" className="t-h">This week</h2>
            <span className="t-s c2">{shortDate(week[0].dateKey, { month: "short", day: "numeric" })} to {shortDate(week[6].dateKey, { month: "short", day: "numeric" })}</span>
          </div>
          <MoveDaySheet open={moveOpen} week={week} onSwap={swapThisWeek} onReset={weekMoved && canResetWeek(program, todayKey) ? resetThisWeek : null} onClose={() => setMoveOpen(false)} />
          <ol className="rows">
            {week.map((d) => {
              const body = (
                <>
                  <span className={d.when === "today" ? "n-s" : "n-s c2"} style={{ width: 52, flex: "none", fontWeight: d.when === "today" ? 600 : undefined }}>{d.label}</span>
                  <span className="kv grow"><span className="t-bs clip">{d.title}</span><span className="t-s c2">{d.detail}</span></span>
                  {d.when === "today" && <span className="tag tag-f">Today</span>}
                  {d.when !== "today" && d.done && <svg className="i good" viewBox="0 0 24 24" role="img" aria-label="Done"><circle cx="12" cy="12" r="9" /><path d="M8 12.5l3 3 5-6" /></svg>}
                  {d.when === "past" && !d.done && <Icon name="next" size="s" className="c2" />}
                </>
              );
              // Today and past days open in Today, where they are logged; a day
              // ahead is plain text until there is something to do with it.
              return (
                <li key={d.dateKey}>
                  {d.when === "ahead"
                    ? <div className="row">{body}</div>
                    : <button type="button" className="row" onClick={() => onOpenDay(d.when === "today" ? null : d.dateKey)}>{body}</button>}
                </li>
              );
            })}
          </ol>
          <SessionSchedule {...{ program, entries, week, todayKey, onSaveProgram }} />
          <button type="button" className="btn btn-g btn-sm" onClick={() => setMoveOpen(true)} style={{ alignSelf: "flex-start", paddingLeft: 0 }}>
            {weekMoved ? "Move another day" : "Move a day this week"}
          </button>
        </section>

        <section aria-labelledby="train-plan" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <h2 id="train-plan" className="t-h">The plan</h2>
          <ul className="rows">
            <li><LinkRow label="Program" sub={planSummary.hasProgram ? planSummary.line : "No program yet. Build one or pick a preset."} onClick={() => setView("program")} /></li>
            <li><LinkRow label="Block" sub={hybridWeek ? `Road & Trail Hybrid · ${hybridWeekLabel(hybridWeek)}` : "Where this week sits in the block"} onClick={() => setView("block")} /></li>
            <li><LinkRow label="Race the Climb" sub="Rehearse a climb indoors against a ghost or pacer" onClick={() => { setHistoryRun(null); setView("climb"); }} /></li>
            <li><LinkRow label="Race rehearsal" sub={program?.__rehearsal?.name || "Draw a course and practice your splits and aid stops"} onClick={() => setView("rehearsal")} /></li>
            <li><LinkRow label="Race plan" sub={hasRacePlan ? `${program.__raceBuild.raceName} · ${formatPlanDate(program.__raceBuild.raceDate)}${raceCopy ? ` · ${raceCopy.countdown}` : ""}` : "Train for a 5K, 10K or half, built around your lifting"} onClick={() => setView("race")} /></li>
            <li><LinkRow label="History" sub="Every session and run" onClick={() => setView("history")} /></li>
          </ul>
        </section>
      </div>
    </div>
  );
}
