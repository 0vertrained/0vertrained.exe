// src/ProgramScreen.jsx
// Train › Program. Start from a preset, build your own, or edit the week.
// The editor writes the same program shape as before (one session a day, or
// morning and evening sessions) through onSaveProgram, and loading a preset
// keeps an active race plan. Train owns the top bar and which screen shows.

import { useEffect, useState } from "react";
import { DEFAULT_PROGRAM, DAYS, PROGRAM_PRESETS, PRESET_LINEUP, presetProgram } from "./constants";
import { resolveTrackingMode, TRACKING_MODES } from "./workoutLogging";
import { seedSupersetPrefsFromProgram } from "./liftLogPrefs";
import { buildSplitSessionsFromLegacy, getProgramSessions, usesProgramSessions } from "./programSessions";
import { useConfirm } from "./ui/ConfirmDialog";
import { isRunPlanSpec } from "./runPlanGenerator";
import { keepRacePlan } from "./raceBuild";
import { FoldRow, Icon, LinkRow, Seg } from "./ui/ledger";

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
  const next = { ...cardio, [field]: field === "miles" ? parseFloat(val) || 0 : val };
  if (field === "type" || field === "notes") delete next.steps;
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
  const run = sessions.some((s) => s.cardio);
  return lift && run ? "Both" : lift ? "Lift" : run ? "Run" : "Rest";
}
function dayLine(day) {
  const sessions = getProgramSessions(day || {});
  if (sessions.length === 0) return "Rest";
  const lifts = sessions.reduce((n, s) => n + (s.lifting || []).length, 0);
  const miles = sessions.reduce((n, s) => n + (Number(s.cardio?.miles) || 0), 0);
  const parts = [];
  if (sessions.length > 1) parts.push(`${sessions.length}${NBSP}sessions`);
  if (lifts) parts.push(`${lifts}${NBSP}exercise${lifts === 1 ? "" : "s"}`);
  if (sessions.some((s) => s.cardio)) parts.push(miles ? `run, ${miles}${NBSP}mi` : "run");
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
      {(session.lifting || []).map((ex, i) => (
        <p key={`${ex.name}-${i}`} className="t-s" style={{ display: "flex", gap: 8 }}>
          <span className="grow">{ex.name}</span><span className="n-s c2">{ex.sets}×{ex.reps}{targetUnit(ex)}</span>
        </p>
      ))}
      {session.cardio && (
        <p className="t-s c2">{[session.cardio.type || "Run", session.cardio.miles ? `${session.cardio.miles}${NBSP}mi` : null, session.cardio.effort || null].filter(Boolean).join(" · ")}{session.cardio.notes ? `. ${session.cardio.notes}` : ""}</p>
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

// A preset is "current" when every day of the week carries its session names.
function matchesPreset(program, id) {
  const preset = presetProgram(id);
  return DAYS.every((day) => (program?.[day]?.type || "") === (preset?.[day]?.type || ""));
}

export function ProgramHome({ program, onSaveProgram, onEdit, onBuild }) {
  const { confirm, confirmDialog } = useConfirm();
  const current = program || DEFAULT_PROGRAM;
  const hasRacePlan = isRunPlanSpec(program?.__raceBuild);
  const presets = PRESET_LINEUP.map((id) => PROGRAM_PRESETS[id]).filter(Boolean);
  const currentId = presets.find((p) => matchesPreset(current, p.id))?.id || null;
  const [picked, setPicked] = useState(currentId || presets[0]?.id || null);
  const [busy, setBusy] = useState(false);
  const chosen = PROGRAM_PRESETS[picked];

  const load = async () => {
    if (!chosen || busy || picked === currentId) return;
    const base = presetProgram(picked);
    const keepsPlan = hasRacePlan && !base.__raceBuild;
    if (!(await confirm({ message: `Switch to "${chosen.name}"? This will replace your current program.${keepsPlan ? " Your race plan stays." : ""}`, confirmLabel: "Switch program" }))) return;
    setBusy(true);
    const next = keepRacePlan(program, base);
    const ok = await onSaveProgram(next);
    setBusy(false);
    // Preset-declared supersets go live immediately (sticky prefs).
    if (ok) seedSupersetPrefsFromProgram(next);
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

  return (
    <div className="shell" data-screen="train-program">
      {confirmDialog}
      <div className="main" style={{ gap: 16 }}>
        <p className="t-s c2">Start from a preset, then edit the week.{hasRacePlan ? " Loading a preset keeps your race plan." : ""}</p>
        <div role="radiogroup" aria-label="Presets" onKeyDown={onKeyDown} style={column(8)}>
          {presets.map((p) => (
            <button key={p.id} data-id={p.id} type="button" className="opt" role="radio" aria-checked={picked === p.id} tabIndex={picked === p.id ? 0 : -1} onClick={() => setPicked(p.id)}>
              <span className="rad" aria-hidden="true" />
              <span className="kv grow" style={{ gap: 4 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}><span className="t-bs grow">{p.name}</span>{p.id === currentId && <span className="tag tag-f">Current</span>}</span>
                <span className="t-s c2">{firstSentence(p.desc)}</span>
                {picked === p.id && <WeekStrip program={presetProgram(p.id)} />}
              </span>
            </button>
          ))}
        </div>
        {chosen && (
          <ul className="rows" style={{ borderTop: "1px solid var(--line)" }}>
            <FoldRow key={picked} title={`${chosen.name}, day by day`} sub="Every session and exercise">
              <p className="t-s c2">{chosen.desc}</p>
              <DayByDay program={presetProgram(picked)} />
            </FoldRow>
          </ul>
        )}
        <button type="button" className="btn btn-p btn-b" aria-disabled={busy || picked === currentId || undefined} onClick={load}>
          {busy ? "Loading…" : picked === currentId ? `${chosen?.name} is your program` : `Load ${chosen?.name || "preset"}`}
        </button>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="btn btn-s" onClick={onBuild} style={{ flex: "1 1 0", minWidth: 0 }}>Build my own</button>
          <button type="button" className="btn btn-s" onClick={() => onEdit?.()} style={{ flex: "1 1 0", minWidth: 0 }}>Edit the week</button>
        </div>
        <p className="t-s c2">Loading replaces your current week{hasRacePlan ? "; your race plan stays" : ""}.</p>

        <section aria-labelledby="program-week" style={column(4)}>
          <h2 id="program-week" className="t-h">Your week</h2>
          <ul className="rows">
            {DAYS.map((day) => (
              <li key={day}><LinkRow label={`${day} · ${current[day]?.type || "Rest"}`} sub={dayLine(current[day])} onClick={() => onEdit?.(day)} /></li>
            ))}
          </ul>
        </section>
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
  const list = lifting || [];
  const set = (i, field, val) => {
    const next = [...list];
    next[i] = { ...next[i], [field]: field === "sets" || field === "reps" ? parseInt(val, 10) || 0 : val };
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
            <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
              <NumberField label="Sets" value={ex.sets} onChange={(v) => set(i, "sets", v)} />
              <NumberField label={targetName(ex)} value={ex.reps} onChange={(v) => set(i, "reps", v)} />
              <button type="button" className="ibtn" aria-label={`Move ${ex.name || `exercise ${i + 1}`} up`} aria-disabled={i === 0 || undefined} onClick={() => move(i, -1)}><Icon name="up" size="s" /></button>
              <button type="button" className="ibtn" aria-label={`Move ${ex.name || `exercise ${i + 1}`} down`} aria-disabled={i === list.length - 1 || undefined} onClick={() => move(i, 1)}><Icon name="down" size="s" /></button>
              <button type="button" className="ibtn" aria-label={`Remove ${ex.name || `exercise ${i + 1}`}`} onClick={() => onChange(list.filter((_, idx) => idx !== i))}><Icon name="close" size="s" /></button>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function CardioFields({ cardio, onChange, onToggle, whenNone }) {
  const summary = cardio ? [cardio.type || "Run", cardio.miles ? `${cardio.miles}${NBSP}mi` : null, cardio.effort || null].filter(Boolean).join(" · ") : whenNone;
  return (
    <section aria-label="Cardio" style={column(8)}>
      <div className="row" style={{ borderTop: "1px solid var(--line)", borderBottom: cardio ? "none" : undefined }}>
        <span className="kv grow"><span className="t-bs">Cardio</span><span className="t-s c2">{summary}</span></span>
        <button type="button" className="btn btn-s btn-sm" onClick={onToggle}>{cardio ? "Remove cardio" : "Add cardio"}</button>
      </div>
      {cardio && (
        <>
          <label className="field"><span className="lbl">Type</span><input className="input" value={cardio.type || ""} onChange={(event) => onChange("type", event.target.value)} /></label>
          <div style={{ display: "flex", gap: 8 }}>
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
      onToggle={() => setTarget({ cardio: target.cardio ? null : { type: "Run", miles, effort: "Zone 2", notes: "" } })}
    />
  );

  return (
    <div className="shell" data-screen="train-editor">
      {confirmDialog}
      <div className="main" style={{ gap: 16 }}>
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
            <button type="button" className="btn btn-s btn-b" onClick={() => setField("lifting", [...(p.lifting || []), { name: "New Exercise", sets: 3, reps: 10 }])}>Add exercise</button>
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
            <button type="button" className="btn btn-s btn-b" onClick={() => updateSession({ lifting: [...(active.lifting || []), { name: "New Exercise", sets: 2, reps: 10 }] })}>Add exercise</button>
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
