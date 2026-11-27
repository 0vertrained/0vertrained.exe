// src/ProgramScreen.jsx
// Train › Program. Start from a preset, build your own, or edit the week.
// The editor writes the same program shape as before (one session a day, or
// morning and evening sessions) through onSaveProgram, and loading a preset
// keeps an active race plan. Train owns the top bar and which screen shows.

import { useEffect, useState } from "react";
import { DEFAULT_PROGRAM, DAYS, PROGRAM_PRESETS, PRESET_LINEUP, ORIGINAL_PRESET_IDS, RESEARCH_PRESET_IDS, presetProgram, getTodayKey } from "./constants";
import { resolveTrackingMode, TRACKING_MODES } from "./workoutLogging";
import { seedSupersetPrefsFromProgram } from "./liftLogPrefs";
import { buildSplitSessionsFromLegacy, getProgramSessions, samePrescription, usesProgramSessions } from "./programSessions";
import { useConfirm } from "./ui/ConfirmDialog";
import { isRunPlanSpec } from "./runPlanGenerator";
import { applyRaceBuild, isRunCardio, keepRacePlan, mondayKeyOf } from "./raceBuild";
import { ROAD_TRAIL_TARGETS, startRoadTrailHybrid, describeRoadTrailWeek } from "./plans/roadTrailHybrid";
import { shiftDate } from "./coachWindows";
import { weekdayOf, weekMovesFor } from "./weekMoves";
import { formatPlanDate, hybridWeekLabel } from "./RaceWeekLine";
import { FoldRow, Icon, LinkRow, Seg } from "./ui/ledger";
import { AddExerciseSheet } from "./AddExercise";
import { buildCardio, CARDIO_SESSIONS, exercisePrescription } from "./programExerciseLibrary";

const NBSP = "\u00a0";
const column = (gap) => ({ display: "flex", flexDirection: "column", gap });
const firstSentence = (text = "") => {
  const match = String(text).match(/^.*?[.!?](\s|$)/);
  return (match ? match[0] : String(text)).trim();
};

// Structured steps (what the cardio timer pre-fills from) describe the
// same workout as the type and notes. Rewriting either here makes them stale,
// so they're dropped and the timer goes back to reading the notes.
export function editCardio(cardio, field, val) {
  const next = { ...cardio, [field]: field === "miles" || field === "minutes" ? Math.max(0, parseFloat(val) || 0) : val };
  if (field === "type" || field === "notes" || field === "minutes") delete next.steps;
  if (field === "type") delete next.modality;
  return next;
}

// A hold's target is seconds and a carry's is yards (the set composer
// already reads them that way), so "3×45" on a plank reads as "3×45s".
function targetUnit(exercise) {
  const mode = resolveTrackingMode(exercise);
  if (mode === TRACKING_MODES.TIMED_HOLD) return "s";
  if (mode === TRACKING_MODES.CARRY) return " yd";
  return "";
}
function targetName(exercise) {
  const mode = resolveTrackingMode(exercise);
  if (mode === TRACKING_MODES.TIMED_HOLD) return "Seconds";
  if (mode === TRACKING_MODES.CARRY) return "Yards";
  return "Reps";
}

// What a day holds, in a word: lifting, a run, both, or rest.
function dayKind(day) {
  const sessions = getProgramSessions(day || {});
  const lift = sessions.some((s) => (s.lifting || []).length > 0);
  const cardio = sessions.filter((s) => s.cardio);
  if (lift) return cardio.length ? "Both" : "Lift";
  if (!cardio.length) return "Rest";
  return cardio.every((s) => isRunCardio(s.cardio)) ? "Run" : "Cardio";
}
function dayLine(day) {
  const sessions = getProgramSessions(day || {});
  if (sessions.length === 0) return "Rest";
  const lifts = sessions.reduce((n, s) => n + (s.lifting || []).length, 0);
  const parts = [];
  if (sessions.length > 1) parts.push(`${sessions.length}${NBSP}sessions`);
  if (lifts) parts.push(`${lifts}${NBSP}exercise${lifts === 1 ? "" : "s"}`);
  for (const { cardio } of sessions) {
    if (!cardio) continue;
    const name = cardio.modality || (isRunCardio(cardio) ? "run" : "cardio");
    const dose = cardio.minutes ? `${cardio.minutes}${NBSP}min` : cardio.miles ? `${cardio.miles}${NBSP}mi` : "";
    parts.push([name, dose].filter(Boolean).join(", "));
  }
  return parts.join(" · ");
}

// The week at a glance: one cell a day.
function WeekStrip({ program }) {
  const days = DAYS.map((day) => [day, dayKind(program?.[day])]);
  return (
    <span className="wkp" role="img" aria-label={`Week: ${days.map(([day, kind]) => `${day} ${kind.toLowerCase()}`).join(", ")}`} style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}>
      {days.map(([day, kind]) => <span key={day} aria-hidden="true"><b>{day.charAt(0)}</b>{kind}</span>)}
    </span>
  );
}

// One session's lifting and run, as written.
function SessionList({ session }) {
  return (
    <div style={column(2)}>
      {(session.label || session.title) && <p className="t-ss">{[session.label, session.title].filter(Boolean).join(" · ")}</p>}
      {session.emphasis && <p className="t-ss c2">{session.emphasis}</p>}
      {(session.lifting || []).map((ex, i) => (
        <p key={`${ex.name}-${i}`} className="t-s" style={{ display: "flex", gap: 8 }}>
          <span className="grow">{ex.name}{ex.restSeconds && <small className="t-ss c2" style={{ display: "block" }}>{[ex.rir != null && `${ex.rir} reps in reserve`, `${ex.restSeconds} s rest`].filter(Boolean).join(" · ")}</small>}</span><span className="n-s c2">{ex.sets}×{ex.repMin && ex.repMin < ex.reps ? `${ex.repMin}–` : ""}{ex.reps}{targetUnit(ex)}</span>
        </p>
      ))}
      {session.cardio && (
        <p className="t-s c2">{[session.cardio.type || "Cardio", session.cardio.minutes ? `${session.cardio.minutes}${NBSP}min` : null, session.cardio.miles ? `${session.cardio.miles}${NBSP}mi` : null, session.cardio.effort || null].filter(Boolean).join(" · ")}{session.cardio.notes ? `. ${session.cardio.notes}` : ""}</p>
      )}
    </div>
  );
}

function DayByDay({ program }) {
  return (
    <div style={column(12)}>
      {DAYS.map((day) => {
        const sessions = getProgramSessions(program?.[day] || {});
        return (
          <div key={day} style={column(4)}>
            <p className="t-bs" style={{ display: "flex", gap: 8 }}><span className="c2" style={{ width: 92, flex: "none" }}>{day}</span><span>{sessions.length ? program[day].type || dayKind(program[day]) : "Rest"}</span></p>
            {sessions.map((session) => <SessionList key={session.id} session={session} />)}
          </div>
        );
      })}
    </div>
  );
}

function HybridTargetField({ value, onChange }) {
  return <label className="field"><span className="lbl">Hybrid race target</span>
    <select className="input" value={value} onChange={event => onChange(event.target.value)}>
      {Object.entries(ROAD_TRAIL_TARGETS).map(([id, goal]) => <option key={id} value={id}>{goal.name}</option>)}
    </select>
  </label>;
}

function HybridStartDate({ program, week, todayKey, onSaveProgram, saving, setSaving, editable = false }) {
  const [draft, setDraft] = useState(null);
  const start = week.startDate || week.startMonday;
  const selected = draft ?? start;
  const upcoming = todayKey < start;
  if (!onSaveProgram || (!upcoming && !editable)) return null;

  const withStart = date => startRoadTrailHybrid(program, date, { raceTarget: week.raceTarget });
  const preview = selected && selected !== start && describeRoadTrailWeek(withStart(selected), selected);
  const save = async date => {
    if (saving || !date || date === start) return;
    setSaving(true);
    try {
      if (await onSaveProgram(withStart(date), { savedMessage: "Hybrid start date updated" })) setDraft(null);
    } finally { setSaving(false); }
  };
  return <div style={column(6)}>
    {upcoming && <button type="button" className="btn btn-p" style={{ alignSelf: "start" }} disabled={saving} onClick={() => save(todayKey)}>Start today</button>}
    {editable && <label className="field"><span className="lbl">Block start date</span>
      <input type="date" className="input" value={selected} onChange={e => setDraft(e.target.value)} />
    </label>}
    {editable && selected !== start && <>
      <p className="hint">{preview ? `Hybrid target · ${preview.raceName} · ${formatPlanDate(preview.raceDate)}. Logged workouts keep their dates.` : "Choose a start date."}</p>
      <button type="button" className="btn btn-s" disabled={saving || !preview} onClick={() => save(selected)}>Save start date</button>
    </>}
  </div>;
}

export function RoadTrailBlock({ program, week, todayKey, onOpenProgram, onSaveProgram }) {
  const [selected, setSelected] = useState(null);
  const [draftTarget, setDraftTarget] = useState(null);
  const [saving, setSaving] = useState(false);
  const target = draftTarget || week.raceTarget;
  const changeTarget = async () => {
    if (saving || target === week.raceTarget) return;
    setSaving(true);
    try {
      const marker = { ...program.__hybridBlock, raceTarget: target };
      if (await onSaveProgram({ ...program, __hybridBlock: marker }, { savedMessage: "Hybrid race target updated" })) {
        setDraftTarget(null);
      }
    } finally { setSaving(false); }
  };
  const previewCount = week.totalWeeks + Number(week.completed);
  const previewWeek = Math.min(selected ?? (week.completed ? previewCount : week.weekNumber || 1), previewCount);
  const dates = Array.from({ length: previewCount }, (_, i) => i === 0 ? (week.startDate || week.startMonday) : shiftDate(week.startMonday, i * 7));
  const preview = applyRaceBuild(program, dates[previewWeek - 1]);
  const sessions = DAYS.flatMap(day => getProgramSessions(preview[day]));
  const sets = sessions.flatMap(session => session.lifting).reduce((sum, lift) => sum + Number(lift.sets || 0), 0);
  const minutes = sessions.reduce((sum, session) => sum + Number(session.cardio?.minutes || 0), 0);
  const miles = sessions.reduce((sum, session) => sum + (session.cardio?.minutes ? 0 : Number(session.cardio?.miles || 0)), 0);
  return (
    <div className="shell"><div className="main" style={column(16)}>
      <header className="kv" style={{ gap: 4 }}>
        <h2 className="t-xl">Road &amp; Trail Hybrid</h2>
        <p className="t-bs">{hybridWeekLabel(week)}</p>
        <p className="t-s c2">Hybrid target · {week.raceName} · {formatPlanDate(week.raceDate)}</p>
      </header>
      <HybridStartDate program={program} week={week} todayKey={todayKey} onSaveProgram={onSaveProgram} saving={saving} setSaving={setSaving} editable />
      {week.completed && <p className="t-s">Your recovery week stays on the calendar until you start another block or change programs.</p>}
      {isRunPlanSpec(program.__raceBuild) && <p className="t-s c2">{program.__raceBuild.raceName} supplies the runs on its scheduled weeks. Lifting follows the hybrid block.</p>}
      {onSaveProgram && todayKey <= week.raceDate && <div style={column(8)}>
        <HybridTargetField value={target} onChange={setDraftTarget} />
        {target !== week.raceTarget && <button type="button" className="btn btn-s" disabled={saving} onClick={changeTarget}>{saving ? "Saving…" : "Save race target"}</button>}
      </div>}
      <label className="field"><span className="lbl">Preview a training week</span>
        <select className="input" value={previewWeek} onChange={e => setSelected(Number(e.target.value))}>
          {dates.map((date, i) => <option key={date} value={i + 1}>{i < week.totalWeeks ? `Week ${i + 1} · ${describeRoadTrailWeek(program, date).phase}` : "Post-race recovery"} · {formatPlanDate(date)}</option>)}
        </select>
      </label>
      <p className="t-s">{sets} working sets{minutes > 0 && ` · ${minutes} min cardio`}{miles > 0 && ` · ${Number(miles.toFixed(2))} mi by distance`}</p>
      <DayByDay program={preview} />
      <a className="t-s" href="/training-guide.html#roadTrailHybrid" target="_blank" rel="noreferrer">Read the plan and its research ↗</a>
      <button type="button" className="btn btn-s" onClick={onOpenProgram}>Open program</button>
    </div></div>
  );
}

function matchesPresetDays(program, preset) {
  return DAYS.every((day) => program?.[day]?.type === preset[day]?.type && samePrescription(program[day], preset[day]));
}

export function ProgramHome({ program, liveProgram, onSaveProgram, onEdit, onBuild, onOpenBlock, todayKey = getTodayKey() }) {
  const { confirm, confirmDialog } = useConfirm();
  const current = program || DEFAULT_PROGRAM;
  const hasRacePlan = isRunPlanSpec(program?.__raceBuild);
  const hybridWeek = describeRoadTrailWeek(current, todayKey);
  const currentId = hybridWeek ? "roadTrailHybrid" : PRESET_LINEUP.find((id) => !presetProgram(id).__hybridBlock && matchesPresetDays(current, presetProgram(id)));
  const [picked, setPicked] = useState(currentId || RESEARCH_PRESET_IDS[0]);
  const thisMonday = mondayKeyOf(todayKey);
  const [startDate, setStartDate] = useState(todayKey);
  const [retainRace, setRetainRace] = useState(true);
  const [raceTarget, setRaceTarget] = useState(hybridWeek?.raceTarget || "road10k");
  const original = ORIGINAL_PRESET_IDS.includes(picked);
  const presets = (original ? ORIGINAL_PRESET_IDS : RESEARCH_PRESET_IDS).map((id) => PROGRAM_PRESETS[id]);
  const chooseCollection = (value) => {
    const ids = value === "original" ? ORIGINAL_PRESET_IDS : RESEARCH_PRESET_IDS;
    setPicked(ids.includes(currentId) ? currentId : ids[0]);
  };
  const [busy, setBusy] = useState(false);
  const chosen = PROGRAM_PRESETS[picked];
  const template = presetProgram(picked);

  const pickingHybrid = picked === "roadTrailHybrid";
  const restarting = pickingHybrid && currentId === picked && hybridWeek?.completed;
  const currentPick = currentId === picked && !restarting;
  const canRestore = currentPick && pickingHybrid && !matchesPresetDays(current, template);
  const base = pickingHybrid ? startRoadTrailHybrid(template, startDate, { raceTarget }) : template;
  const validStart = Boolean(base.__hybridBlock?.startDate) && startDate >= thisMonday;
  const keepExisting = hasRacePlan && !base.__raceBuild && (!pickingHybrid || retainRace);
  const next = keepExisting ? keepRacePlan(current, base) : base;
  const target = pickingHybrid && !currentPick && validStart ? describeRoadTrailWeek(next, startDate) : null;
  const firstDay = target && applyRaceBuild(next, startDate)[weekdayOf(startDate)];
  const startHint = target ? [
    startDate === todayKey && "Your block starts today.",
    startDate !== mondayKeyOf(startDate) && "Week 1 starts partway through the week.",
    `${target.raceName} on ${formatPlanDate(target.raceDate)}.`,
  ].filter(Boolean).join(" ") : `Choose ${formatPlanDate(thisMonday)} or later.`;
  const shownWeek = liveProgram || applyRaceBuild(current, todayKey);
  const movedDays = weekMovesFor(current, todayKey);
  const previewWeek = currentPick ? shownWeek : template;
  const previewLabel = currentPick ? `Your schedule · week of ${formatPlanDate(thisMonday)}` : pickingHybrid ? "Full week 1 template" : "Preset template";

  const canLoad = !busy && (currentPick ? canRestore : !pickingHybrid || validStart);
  const load = async () => {
    if (!chosen || !canLoad) return;
    const dateNote = pickingHybrid ? ` Week 1 starts ${formatPlanDate(startDate)}.` : "";
    const raceNote = keepExisting ? " Your race plan stays." : pickingHybrid && current.__raceBuild ? " Your existing race calendar will be replaced." : "";
    const prompt = canRestore
      ? { message: "Restore the original Road & Trail Hybrid workouts? This replaces your exercise edits and keeps your block dates, race target and calendars.", confirmLabel: "Restore workouts" }
      : { message: `Switch to "${chosen.name}"? This will replace your current program.${dateNote}${raceNote}`, confirmLabel: "Switch program" };
    if (!(await confirm(prompt))) return;
    setBusy(true);
    const saved = canRestore ? { ...current, ...Object.fromEntries(DAYS.map(day => [day, template[day]])) } : next;
    try {
      if (await onSaveProgram(saved)) seedSupersetPrefsFromProgram(saved);
    } finally {
      setBusy(false);
    }
  };

  // Arrow keys move the choice; the group is one Tab stop.
  const onKeyDown = (event) => {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const index = presets.findIndex((p) => p.id === picked);
    const next = presets[(index + step + presets.length) % presets.length];
    setPicked(next.id);
    event.currentTarget.querySelector(`[data-id="${next.id}"]`)?.focus();
  };

  const scheduledWeek = (
    <section aria-labelledby="program-week" style={column(4)}>
      <h2 id="program-week" className="t-h">Your week · {formatPlanDate(thisMonday)}</h2>
      {hybridWeek && <div style={column(6)}>
        <p className="t-s c2">{hybridWeekLabel(hybridWeek)}</p>
        {hasRacePlan && <p className="t-s c2">{program.__raceBuild.raceName} supplies the runs during its scheduled weeks. Road &amp; Trail Hybrid supplies the lifting.</p>}
        <HybridStartDate program={current} week={hybridWeek} todayKey={todayKey} onSaveProgram={onSaveProgram} saving={busy} setSaving={setBusy} />
        {onOpenBlock && <button type="button" className="btn btn-s btn-sm" style={{ alignSelf: "start" }} onClick={onOpenBlock}>View block and race target</button>}
      </div>}
      <ul className="rows">
        {DAYS.map((day) => (
          <li key={day}><LinkRow label={`${day} · ${shownWeek[day]?.type || "Rest"}`} sub={dayLine(shownWeek[day])} onClick={() => onEdit?.(movedDays?.[day] || day)} /></li>
        ))}
      </ul>
    </section>
  );

  return (
    <div className="shell" data-screen="train-program">
      {confirmDialog}
      <div className="main" style={{ gap: 16 }}>
        {hybridWeek && scheduledWeek}
        <p className="t-s c2">Choose a preset to replace your training week.</p>
        <label className="field"><span className="lbl">Plan collection</span>
          <select className="input" value={original ? "original" : "research"} onChange={(event) => chooseCollection(event.target.value)}>
            <option value="research">Research-based plans</option><option value="original">Original presets</option>
          </select>
        </label>
        <div role="radiogroup" aria-label="Presets" onKeyDown={onKeyDown} style={column(8)}>
          {presets.map((p) => (
            <button key={p.id} data-id={p.id} type="button" className="opt" role="radio" aria-checked={picked === p.id} tabIndex={picked === p.id ? 0 : -1} onClick={() => setPicked(p.id)}>
              <span className="rad" aria-hidden="true" />
              <span className="kv grow" style={{ gap: 4 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}><span className="t-bs grow">{p.name}</span>{p.id === currentId && <span className="tag tag-f">Current</span>}</span>
                <span className="t-s c2">{firstSentence(p.desc)}</span>
                {picked === p.id && <><span className="t-ss c2">{previewLabel}</span><WeekStrip program={previewWeek} /></>}
              </span>
            </button>
          ))}
        </div>
        {chosen && (
          <ul className="rows" style={{ borderTop: "1px solid var(--line)" }}>
            <FoldRow key={picked} title={`${chosen.name}, day by day`} sub={previewLabel}>
              <p className="t-s c2">{chosen.desc}</p>
              <DayByDay program={previewWeek} />
            </FoldRow>
            {chosen.guide && <FoldRow key={`${picked}-guide`} title="How to train on this plan" sub="Equipment, progression and recovery">
              <div style={column(9)}>
                {[(!pickingHybrid || currentPick) && chosen.guide.audience, chosen.guide.equipment, chosen.guide.progression, chosen.guide.recovery].filter(Boolean).map((line) => <p className="t-s" key={line}>{line}</p>)}
                <a href={`/training-guide.html#${picked}`} target="_blank" rel="noreferrer">Read the plan and its research ↗</a>
              </div>
            </FoldRow>}
          </ul>
        )}
        {pickingHybrid && !currentPick && <>
          <p className="t-s">{chosen.guide.audience}</p>
          <HybridTargetField value={raceTarget} onChange={setRaceTarget} />
          <label className="field"><span className="lbl" id="hybrid-start-label">Week 1 start date</span>
            <input type="date" className="input" value={startDate} aria-labelledby="hybrid-start-label" min={thisMonday} onChange={e => setStartDate(e.target.value)} aria-invalid={!validStart || undefined} aria-describedby="hybrid-start-hint" />
            <span id="hybrid-start-hint" className="hint">{startHint}</span>
          </label>
          {hasRacePlan && <label className="field"><span className="lbl" id="hybrid-calendar-label">Running calendar</span>
            <select className="input" aria-labelledby="hybrid-calendar-label" value={retainRace ? "keep" : "hybrid"} onChange={e => setRetainRace(e.target.value === "keep")}>
              <option value="keep">Keep {program.__raceBuild.raceName}</option>
              <option value="hybrid">Use Road &amp; Trail Hybrid runs</option>
            </select>
            <span className="hint">{retainRace ? "Your dated race plan sets the runs during its build. The strength taper follows the Week 1 date above." : "Loading the hybrid runs replaces your dated race plan."}</span>
          </label>}
          {firstDay && <p className="t-s">{formatPlanDate(startDate)} · {firstDay.type || "Rest"} · {dayLine(firstDay)}</p>}
        </>}
        <button type="button" className="btn btn-p btn-b" aria-disabled={!canLoad || undefined} onClick={load}>
          {busy ? "Loading…" : canRestore ? "Restore original workouts" : currentPick ? `${chosen?.name} is your program` : restarting ? "Start another hybrid block" : `Load ${chosen?.name || "preset"}`}
        </button>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="btn btn-s" onClick={onBuild} style={{ flex: "1 1 0", minWidth: 0 }}>Build my own</button>
          <button type="button" className="btn btn-s" onClick={() => onEdit?.()} style={{ flex: "1 1 0", minWidth: 0 }}>Edit the week</button>
        </div>

        {!hybridWeek && scheduledWeek}
      </div>
    </div>
  );
}

// ── The editor ───────────────────────────────────────────────────────────────

function NumberField({ label, value, onChange, decimal = false }) {
  return (
    <label className="field" style={{ flex: "1 1 0", minWidth: 0 }}>
      <span className="lbl">{label}</span>
      <input className="input n" type="number" inputMode={decimal ? "decimal" : "numeric"} value={value ?? ""} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function ExerciseList({ lifting, onChange, heading }) {
  const [choosing, setChoosing] = useState(false);
  const list = lifting || [];
  const set = (i, field, val) => {
    const next = [...list];
    const number = Math.max(0, parseInt(val, 10) || 0);
    next[i] = { ...next[i], [field]: field === "name" ? val : number };
    if (field === "repMin" && number > next[i].reps) next[i].reps = number;
    if (field === "reps" && number < next[i].repMin) next[i].repMin = number;

    if (field === "name" && val !== list[i].name) {
      // Renaming a weighted exercise to a hold must switch the logger's fields.
      delete next[i].trackingMode;
      delete next[i].progressionMode;
      const selected = exercisePrescription(val);
      if (selected?.trackingMode) next[i].trackingMode = selected.trackingMode;
    }
    onChange(next);
  };
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <section aria-label={heading} style={column(8)}>
      <div className="sec"><h3 className="t-h">{heading}</h3><span className="t-s c2">{list.length}{NBSP}exercise{list.length === 1 ? "" : "s"}</span></div>
      {list.length === 0 && <p className="t-s c2">No lifting yet. Add an exercise below.</p>}
      <ol className="rows" style={{ borderTop: list.length ? "1px solid var(--line)" : undefined }}>
        {list.map((ex, i) => (
          <li key={i} style={{ ...column(8), padding: "12px 0", borderBottom: "1px solid var(--line)" }}>
            <label className="field">
              <span className="lbl">Exercise {i + 1}</span>
              <input className="input" value={ex.name || ""} onChange={(event) => set(i, "name", event.target.value)} />
            </label>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 8, flexWrap: "wrap" }}>
              <NumberField label="Sets" value={ex.sets} onChange={(v) => set(i, "sets", v)} />
              {ex.repMin != null && <NumberField label={`Min ${targetName(ex).toLowerCase()}`} value={ex.repMin} onChange={(v) => set(i, "repMin", v)} />}
              <NumberField label={ex.repMin != null ? `Max ${targetName(ex).toLowerCase()}` : targetName(ex)} value={ex.reps} onChange={(v) => set(i, "reps", v)} />
              <button type="button" className="ibtn" aria-label={`Move ${ex.name || `exercise ${i + 1}`} up`} aria-disabled={i === 0 || undefined} onClick={() => move(i, -1)}><Icon name="up" size="s" /></button>
              <button type="button" className="ibtn" aria-label={`Move ${ex.name || `exercise ${i + 1}`} down`} aria-disabled={i === list.length - 1 || undefined} onClick={() => move(i, 1)}><Icon name="down" size="s" /></button>
              <button type="button" className="ibtn" aria-label={`Remove ${ex.name || `exercise ${i + 1}`}`} onClick={() => onChange(list.filter((_, idx) => idx !== i))}><Icon name="close" size="s" /></button>
            </div>
            {(ex.rir != null || ex.restSeconds != null) && <div style={{ display: "flex", gap: 8 }}>
              {ex.rir != null && <NumberField label="Reps in reserve" value={ex.rir} onChange={(v) => set(i, "rir", v)} />}
              {ex.restSeconds != null && <NumberField label="Rest seconds" value={ex.restSeconds} onChange={(v) => set(i, "restSeconds", v)} />}
            </div>}
          </li>
        ))}
      </ol>
      <button type="button" className="btn btn-s btn-b" onClick={() => setChoosing(true)}>Add exercise</button>
      <AddExerciseSheet open={choosing} program existing={list.map(ex => ex.name || "")}
        onClose={() => setChoosing(false)} onAdd={entry => { onChange([...list, entry]); setChoosing(false); }} />
    </section>
  );
}

function CardioFields({ cardio, onChange, onToggle, onSelect, whenNone }) {
  const summary = cardio ? [cardio.type || "Cardio", cardio.minutes ? `${cardio.minutes}${NBSP}min` : null, cardio.miles ? `${cardio.miles}${NBSP}mi` : null, cardio.effort || null].filter(Boolean).join(" · ") : whenNone;
  return (
    <section aria-label="Cardio" style={column(8)}>
      <div className="row" style={{ borderTop: "1px solid var(--line)", borderBottom: cardio ? "none" : undefined }}>
        <span className="kv grow"><span className="t-bs">Cardio</span><span className="t-s c2">{summary}</span></span>
        <button type="button" className="btn btn-s btn-sm" onClick={onToggle}>{cardio ? "Remove cardio" : "Add cardio"}</button>
      </div>
      {cardio && (
        <>
          <label className="field"><span className="lbl">Cardio library</span>
            <select className="input" value="" onChange={event => event.target.value && onSelect(buildCardio(event.target.value))}>
              <option value="">Choose a session</option>
              {Object.entries(CARDIO_SESSIONS).map(([key, item]) => <option value={key} key={key}>{item.type}</option>)}
            </select>
          </label>
          <label className="field"><span className="lbl">Type</span><input className="input" value={cardio.type || ""} onChange={(event) => onChange("type", event.target.value)} /></label>
          <div style={{ display: "flex", gap: 8 }}>
            <NumberField label="Target minutes" decimal value={cardio.minutes || ""} onChange={(v) => onChange("minutes", v)} />
            <NumberField label="Target miles" decimal value={cardio.miles || ""} onChange={(v) => onChange("miles", v)} />
            <label className="field" style={{ flex: "1 1 0", minWidth: 0 }}><span className="lbl">Effort</span><input className="input" value={cardio.effort || ""} onChange={(event) => onChange("effort", event.target.value)} /></label>
          </div>
          <label className="field"><span className="lbl">Notes, shown on Today</span><input className="input" value={cardio.notes || ""} onChange={(event) => onChange("notes", event.target.value)} /></label>
        </>
      )}
    </section>
  );
}

const EMPTY_DAY = { type: "", code: "", lifting: [], cardio: null };

export function ProgramEditor({ program, initialDay = null, onSaveProgram, onDone, onGuard = null }) {
  const { confirm, confirmDialog } = useConfirm();
  const original = program || DEFAULT_PROGRAM;
  const [draft, setDraft] = useState(() => JSON.parse(JSON.stringify(original)));
  const [day, setDay] = useState(DAYS.includes(initialDay) ? initialDay : DAYS[0]);
  const [activeByDay, setActiveByDay] = useState({});
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(original);

  // Train's Back asks before dropping changes.
  useEffect(() => {
    if (typeof onGuard !== "function") return undefined;
    onGuard(async () => !dirty || confirm({ message: "Leave without saving? Your changes to the week will be lost.", confirmLabel: "Leave", destructive: true }));
    return () => onGuard(null);
  }, [onGuard, dirty, confirm]);

  const p = draft[day] || EMPTY_DAY;
  const setDayValue = (next) => setDraft((prev) => ({ ...prev, [day]: next }));
  const setField = (field, val) => setDayValue({ ...p, [field]: val });

  const save = async () => {
    if (busy) return;
    if (!(await confirm({ message: "Save changes to your program? This will overwrite your current split.", confirmLabel: "Save changes" }))) return;
    setBusy(true);
    const ok = await onSaveProgram(draft);
    setBusy(false);
    if (ok) onDone?.();
  };

  const sessionsDay = usesProgramSessions(p);
  const sessions = sessionsDay ? getProgramSessions(p) : [];
  const activeId = activeByDay[day] || sessions[0]?.id || "am";
  const activeIndex = Math.max(0, sessions.findIndex((s) => s.id === activeId));
  const active = sessions[activeIndex] || sessions[0] || { id: "am", label: "AM", title: "AM Session", lifting: [], cardio: null };
  const setActive = (id) => setActiveByDay((prev) => ({ ...prev, [day]: id }));
  const updateSessions = (next) => setDayValue({ ...p, sessions: next, lifting: [], cardio: null });
  const updateSession = (patch) => updateSessions(sessions.map((s, i) => (i === activeIndex ? { ...s, ...patch } : s)));
  const addSession = () => {
    const n = sessions.length + 1;
    updateSessions([...sessions, { id: `session-${n}`, label: `S${n}`, title: `Session ${n}`, lifting: [], cardio: null }]);
    setActive(`session-${n}`);
  };
  const duplicateSession = () => {
    const id = `${active.id}-copy`;
    const clone = { ...active, id, label: `${active.label}+`, title: `${active.title} Copy`, lifting: [...(active.lifting || [])], cardio: active.cardio ? { ...active.cardio } : null };
    updateSessions([...sessions.slice(0, activeIndex + 1), clone, ...sessions.slice(activeIndex + 1)]);
    setActive(id);
  };
  const removeSession = () => {
    if (sessions.length <= 1) return;
    const next = sessions.filter((_, i) => i !== activeIndex);
    updateSessions(next);
    setActive(next[0]?.id || "am");
  };
  const moveSession = (dir) => {
    const j = activeIndex + dir;
    if (j < 0 || j >= sessions.length) return;
    const next = [...sessions];
    [next[activeIndex], next[j]] = [next[j], next[activeIndex]];
    updateSessions(next);
  };

  const cardioFor = (target, setTarget, miles) => (
    <CardioFields
      cardio={target.cardio}
      whenNone={`None on ${day}`}
      onChange={(field, val) => setTarget({ cardio: editCardio(target.cardio || { type: "", miles: 0, effort: "", notes: "" }, field, val) })}
      onSelect={cardio => setTarget({ cardio })}
      onToggle={() => setTarget({ cardio: target.cardio ? null : { type: "Run", miles, effort: "Zone 2", notes: "" } })}
    />
  );

  return (
    <div className="shell" data-screen="train-editor">
      {confirmDialog}
      <div className="main" style={{ gap: 16 }}>
        {original.__hybridBlock?.id === "roadTrailHybrid" && <p className="t-s c2">Edit the base week. The block scales your saved lifting sets by phase. Editing a run’s prescription keeps that run fixed across weeks.</p>}
        <div style={column(6)}>
          <span id="editor-day" className="lbl">Day</span>
          <Seg labelledBy="editor-day" options={DAYS.map((d) => ({ value: d, label: <><span aria-hidden="true">{d.charAt(0)}</span><span className="sr">{d}</span></> }))} value={day} onChange={setDay} />
        </div>
        <label className="field"><span className="lbl">{day}’s session name</span><input className="input" value={p.type || ""} onChange={(event) => setField("type", event.target.value)} /></label>
        <div className="field">
          <label className="lbl" htmlFor="editor-code">Short code</label>
          <input id="editor-code" className="input" value={p.code || ""} onChange={(event) => setField("code", event.target.value)} aria-describedby="editor-code-hint" />
          <span id="editor-code-hint" className="hint">Shown where space is tight, like PUSH+RUN.</span>
        </div>

        {!sessionsDay && (
          <>
            <ExerciseList heading="Lifting" lifting={p.lifting} onChange={(lifting) => setField("lifting", lifting)} />
            {cardioFor(p, (patch) => setDayValue({ ...p, ...patch }), 3)}
            <div className="row" style={{ borderTop: "1px solid var(--line)" }}>
              <span className="kv grow"><span className="t-bs">Second session</span><span className="t-s c2">Split the day into morning and evening</span></span>
              <button type="button" className="btn btn-s btn-sm" onClick={() => setDayValue(buildSplitSessionsFromLegacy(p))}>Split</button>
            </div>
          </>
        )}

        {sessionsDay && (
          <>
            <div style={column(6)}>
              <span id="editor-session" className="lbl">Session</span>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <div className="grow"><Seg labelledBy="editor-session" options={sessions.map((s) => ({ value: s.id, label: s.label || s.id }))} value={active.id} onChange={setActive} /></div>
                <button type="button" className="btn btn-s btn-sm" onClick={addSession}>Add</button>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <label className="field" style={{ flex: "1 1 0", minWidth: 0 }}><span className="lbl">Label</span><input className="input" value={active.label || ""} onChange={(event) => updateSession({ label: event.target.value, id: event.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || active.id })} /></label>
              <label className="field" style={{ flex: "2 1 0", minWidth: 0 }}><span className="lbl">Title</span><input className="input" value={active.title || ""} onChange={(event) => updateSession({ title: event.target.value })} /></label>
            </div>
            <label className="field"><span className="lbl">Emphasis or guardrail</span><input className="input" value={active.emphasis || ""} onChange={(event) => updateSession({ emphasis: event.target.value })} /></label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="btn btn-s btn-sm" aria-disabled={activeIndex === 0 || undefined} onClick={() => moveSession(-1)}>Move earlier</button>
              <button type="button" className="btn btn-s btn-sm" aria-disabled={activeIndex === sessions.length - 1 || undefined} onClick={() => moveSession(1)}>Move later</button>
              <button type="button" className="btn btn-s btn-sm" onClick={duplicateSession}>Duplicate</button>
              <button type="button" className="btn btn-g btn-sm" aria-disabled={sessions.length <= 1 || undefined} onClick={removeSession}>Remove</button>
            </div>
            <ExerciseList heading={`${active.label || "Session"} lifting`} lifting={active.lifting} onChange={(lifting) => updateSession({ lifting })} />
            {cardioFor(active, updateSession, 2)}
          </>
        )}
      </div>
      <div className="foot foot-tab" style={column(6)}>
        {dirty && <p className="t-s c2" role="status">Not saved yet.</p>}
        <button type="button" className="btn btn-p btn-b" aria-disabled={busy || !dirty || undefined} onClick={() => dirty && save()}>{busy ? "Saving…" : "Save program"}</button>
      </div>
    </div>
  );
}
