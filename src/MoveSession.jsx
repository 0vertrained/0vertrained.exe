import { useState } from "react";
import { shiftDate } from "./coachWindows";
import { applyRaceBuild, changeDatedSession } from "./raceBuild";
import { getProgramSessions, plannedSessionTime } from "./programSessions";
import { datedSessionEdits, weekdayOf } from "./weekMoves";
import { Sheet } from "./ui/ledger";

const label = key => new Date(key + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const name = session => [session.label === "Session" ? "" : session.label, session.title].filter(Boolean).join(" · ");

export function SessionSchedule({ program, entries, week, todayKey, onSaveProgram, initialId = null, buttonLabel = "Move or skip a session" }) {
  const [open, setOpen] = useState(false);
  const edits = datedSessionEdits(program).filter(edit => week.some(day => day.dateKey === edit.from || day.dateKey === edit.to));
  const days = week.filter(day => day.split && day.sessions.some(s => !s.id.startsWith("moved-")));
  if (!days.length && !edits.length) return null;
  return <>
    <button type="button" className="btn btn-g btn-sm" onClick={() => setOpen(true)} style={{ alignSelf: "flex-start", paddingLeft: 0 }}>
      {buttonLabel}
    </button>
    {open && <SessionSheet {...{ program, entries, days, edits, todayKey, onSaveProgram, initialId }} onClose={() => setOpen(false)} />}
  </>;
}

function SessionSheet({ program, entries, days, edits, todayKey, onSaveProgram, onClose, initialId }) {
  const [pick, setPick] = useState(initialId ? { from: todayKey, id: initialId } : null);
  const [action, setAction] = useState("move");
  const [dateChoice, chooseDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const check = (request) => changeDatedSession(program, entries, { ...request, todayKey });
  const selectedDay = days.find(day => day.dateKey === pick?.from);
  const session = selectedDay?.sessions.find(s => s.id === pick?.id);
  const dates = [];
  if (session && action === "move") {
    for (let i = 0; i <= 7; i++) {
      const key = shiftDate(todayKey, i);
      if (key !== pick.from) {
        const change = check({ ...pick, to: key });
        dates.push({ key, reason: change.error, timeOfDay: change.program?.__sessionEdits.items.at(-1)?.timeOfDay });
      }
    }
  }
  const to = action === "skip" ? null : (dateChoice || dates.find(date => !date.reason)?.key);
  const destination = to ? getProgramSessions(applyRaceBuild(program, to)?.[weekdayOf(to)]) : [];
  const plannedTime = plannedSessionTime({ timeOfDay: dates.find(date => date.key === to)?.timeOfDay });
  const blocked = session ? check({ ...pick, to: null }).error : null;
  const remaining = selectedDay?.sessions.filter(s => s.id !== pick?.id) || [];
  async function save(request, message) {
    if (saving) return;
    const change = check(request);
    if (change.error) { setError(change.error); return; }
    setSaving(true);
    setError("");
    try {
      if (await onSaveProgram(change.program, { savedMessage: message }) !== false) { onClose(); return; }
    } catch { /* The change is only applied after persistence succeeds. */ }
    setError("Couldn’t save this schedule change. Try again.");
    setSaving(false);
  }
  return <Sheet open title={session ? name(session) : "Move or skip a session"} onClose={() => { if (!saving) onClose(); }}>
    {!session ? <>
      {edits.length > 0 && <div><h3 className="t-bs">Schedule changes</h3><ul className="rows">
        {edits.map(edit => {
          const reason = check({ ...edit, undo: true }).error;
          return <li key={edit.from + edit.id} className="row">
            <span className="kv grow"><span>{edit.title}</span><span className="t-s c2">
              {label(edit.from)} {edit.to ? "→ " + label(edit.to) : "· Skipped"}{reason && " · " + reason}
            </span></span>
            <button type="button" className="btn btn-s btn-sm" disabled={saving || !!reason}
              aria-label={"Undo " + edit.title} onClick={() => save({ ...edit, undo: true }, "Session restored")}>Undo</button>
          </li>;
        })}
      </ul></div>}
      <p className="t-s c2">Choose one session from this week.</p>
      <ul className="rows">{days.flatMap(day => day.sessions.filter(s => !s.id.startsWith("moved-")).map(slot => {
        const request = { from: day.dateKey, id: slot.id };
        const reason = check({ ...request, to: null }).error;
        return <li key={day.dateKey + slot.id}><button type="button" className="row" disabled={saving || !!reason}
          onClick={() => { setPick(request); setError(""); setAction("move"); chooseDate(""); }}>
          <span className="kv grow"><span className="t-bs">{label(day.dateKey)} · {name(slot)}</span>
            {reason && <span className="t-s c2">{reason}</span>}</span>
        </button></li>;
      }))}</ul>
    </> : <>
      <div className="row" aria-label="Schedule action">
        {["move", "skip"].map(value => <button key={value} type="button" className={"btn btn-sm " + (action === value ? "btn-p" : "btn-s")}
          disabled={saving} aria-pressed={action === value} onClick={() => { setAction(value); setError(""); }}>{value === "move" ? "Move" : "Skip"}</button>)}
      </div>
      {action === "move" && <label className="field"><span className="lbl">Destination date</span>
        <select className="input" disabled={saving} value={to || ""} onChange={event => { chooseDate(event.target.value); setError(""); }}>
          {!to && <option value="">No available date</option>}
          {dates.map(date => <option key={date.key} value={date.key} disabled={!!date.reason}>{label(date.key)}{date.reason && " · " + date.reason}</option>)}
        </select></label>}
      <p className="t-s">{label(pick.from)} after this change · {remaining.map(name).join(" + ") || "Rest day"}</p>
      {to && <p className="t-s">{label(to)} after this move · {[...destination.map(s => plannedSessionTime(s) + " " + s.title), plannedTime + " " + session.title].join(" + ")}</p>}
      {blocked && <p className="t-s c2">{blocked}</p>}
      <button type="button" className="btn btn-p btn-b" disabled={saving || !!blocked || (action === "move" && !dates.some(d => d.key === to && !d.reason))}
        onClick={() => save({ ...pick, to }, action === "skip" ? "Session skipped" : "Session moved")}>
        {saving ? "Saving…" : action === "skip" ? "Skip this session" : "Move this session"}
      </button>
      <button type="button" className="btn btn-g btn-b" disabled={saving} onClick={() => { setPick(null); setError(""); }}>Choose another session</button>
    </>}
    {error && <p role="alert" className="t-s">{error}</p>}
  </Sheet>;
}
