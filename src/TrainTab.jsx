// src/TrainTab.jsx
// Train: the plan, in one place. Today's session, the seven days of this
// week, and the rows that lead to the program, the block, the race plan and
// history. The program screens themselves still come from MoreTab's
// ProgramTab; they are shown here one level down.
import { useEffect, useRef, useState } from "react";
import { DAYS, getTodayKey } from "./constants";
import { getProgramSessions, flattenProgramLifting } from "./programSessions";
import { summarizeProgramDay } from "./programSummary";
import { isExerciseHandled } from "./workoutLogging";
import { mondayKeyOf, describeBuildWeek } from "./raceBuild";
import { isRunPlanSpec } from "./runPlanGenerator";
import { formatPlanDate, raceWeekCopy } from "./RaceWeekLine";
import { summarizeProgramForHub } from "./moreHub";
import { Icon, LinkRow } from "./ui/ledger";
import { useTopBar } from "./ui/shell";
import { ProgramTab } from "./MoreTab";

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
    const hasCardio = getProgramSessions(day).some((session) => !!session.cardio);
    const cardioLogged = (parseFloat(logged.cardio?.miles) || 0) > 0 || String(logged.cardio?.time || "").trim() !== ""
      || Object.values(logged.cardioSessions || {}).some((c) => (parseFloat(c?.miles) || 0) > 0 || String(c?.time || "").trim() !== "");
    const isRest = lifting.length === 0 && !hasCardio;
    const done = !isRest && doneLifts === lifting.length && (!hasCardio || cardioLogged);
    const when = dateKey === todayKey ? "today" : dateKey < todayKey ? "past" : "ahead";
    const parts = [];
    if (lifting.length) parts.push(done ? "Lifting" : when === "ahead" ? `${lifting.length}${NBSP}exercises` : `${doneLifts} of ${lifting.length}${NBSP}exercises`);
    if (hasCardio) parts.push(summary.cardioLabel || "Cardio");
    if (done) parts.push("done");
    return {
      dayName, dateKey, when, isRest, done,
      started: doneLifts > 0 || cardioLogged,
      label: `${dayName.slice(0, 3)}${NBSP}${date.getDate()}`,
      title: isRest ? "Rest day" : (summary.label || dayName),
      detail: isRest ? "No training planned" : parts.join(" · "),
      liftCount: lifting.length,
    };
  });
}

export function TrainTab({ program, liveProgram, entries, settings, onSaveProgram, onApplyGeneratedProgram, onStartToday, onOpenDay, onOpenProgress }) {
  // "home", or the program screens opened at one of their actions.
  const [view, setView] = useState("home");
  // A screen opened from Train starts at its top, not wherever Train was scrolled.
  const firstView = useRef(true);
  useEffect(() => {
    if (firstView.current) { firstView.current = false; return; }
    window.scrollTo?.(0, 0);
  }, [view]);
  const todayKey = getTodayKey();
  const shown = liveProgram || program;
  const week = buildTrainWeek({ program: shown, entries, todayKey });
  const today = week.find((d) => d.when === "today") || week[0];
  const planSummary = summarizeProgramForHub(program);
  const hasRacePlan = isRunPlanSpec(program?.__raceBuild);
  const raceCopy = hasRacePlan ? raceWeekCopy(describeBuildWeek(program, todayKey)) : null;

  useTopBar(view === "home" ? null : {
    title: view === "race" ? "Race plan" : "Program",
    back: "Train",
    onBack: () => setView("home"),
  });

  if (view !== "home") {
    return (
      <div className="legacy-screen">
        <ProgramTab key={view} program={program} onSaveProgram={onSaveProgram} onApplyGeneratedProgram={onApplyGeneratedProgram} settings={settings} initialAction={view === "race" ? "race" : null} />
      </div>
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
        </section>

        <section aria-labelledby="train-plan" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <h2 id="train-plan" className="t-h">The plan</h2>
          <ul className="rows">
            <li><LinkRow label="Program" sub={planSummary.hasProgram ? planSummary.line : "No program yet. Build one or pick a preset."} onClick={() => setView("program")} /></li>
            <li><LinkRow label="Block" sub="Where this week sits in the block" onClick={() => onOpenProgress("program")} /></li>
            <li><LinkRow label="Race plan" sub={hasRacePlan ? `${program.__raceBuild.raceName} · ${formatPlanDate(program.__raceBuild.raceDate)}${raceCopy ? ` · ${raceCopy.countdown}` : ""}` : "Train for a 5K, 10K or half, built around your lifting"} onClick={() => setView("race")} /></li>
            <li><LinkRow label="History" sub="Every session and run" onClick={() => onOpenProgress("history")} /></li>
          </ul>
        </section>
      </div>
    </div>
  );
}
