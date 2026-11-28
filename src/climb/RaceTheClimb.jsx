import { useEffect, useMemo, useRef, useState } from "react";
import { getTodayKey } from "../constants";
import { useConfirm } from "../ui/ConfirmDialog";
import { buildIndoorGhost, climbReadout, SAMPLE_COURSE, selectClimb, startClimb, withRecordedGhost } from "./engine";
import { ClimbScene, clockText, distanceText, gainText, unitMeters } from "./ClimbScene";
import { Equipment, useTreadmill } from "./ClimbEquipment";
import { ClimbImports } from "./ClimbImports";
import { ClimbWorkout, Debrief, Metric } from "./ClimbWorkout";
import "./raceTheClimb.css";

const validCourse = course => Boolean(course?.revision && Number.isFinite(course.distanceMeters) && course.distanceMeters > 0 &&
  Array.isArray(course.landmarks) && Array.isArray(course.points) && course.points.length >= 2);
const empty = [];
const validDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s);
const numeric = s => String(s).trim() && Number.isFinite(Number(s)) ? Number(s) : null;

function RangeEditor({ course, unit, onApply }) {
  const [open,setOpen] = useState(false), [profile,setProfile] = useState(course.hasElevation);
  const [start, setStart] = useState(0), [end, setEnd] = useState(course.distanceMeters);
  const [name, setName] = useState(course.name);
  const [marks, setMarks] = useState(course.landmarks.filter(mark => mark.meters < course.distanceMeters));
  const [newName, setNewName] = useState(""), [newDistance, setNewDistance] = useState("");
  const [error, setError] = useState("");
  const minimum = Math.min(10, course.distanceMeters);
  const add = () => {
    const meters = Number(newDistance) * unitMeters(unit);
    if (!newName.trim() || !Number.isFinite(meters) || meters <= start || meters >= end || marks.length >= 39) {
      setError("Place a named landmark between the start and crest. A course can hold 40 landmarks including the finish."); return;
    }
    setMarks([...marks, { id: crypto.randomUUID(), name: newName.trim(), meters }].sort((a, b) => a.meters - b.meters));
    setNewName(""); setNewDistance(""); setError("");
  };
  return <details className="cl-details" onToggle={e=>setOpen(e.currentTarget.open)}><summary>Edit section and landmarks</summary><div className="cl-detail-body">
    {open && <ClimbScene course={course} unit={unit} athleteMeters={start} selectedRange={{start,end}} profile={profile && course.hasElevation}
      onProfile={setProfile} progressLabel="Section start"/>}
    <label className="field"><span className="lbl">Section name</span><input className="input" maxLength={120} value={name} onChange={e => setName(e.target.value)} /></label>
    <label className="field"><span className="lbl">Start point · {distanceText(start, unit)}</span><input type="range" aria-label="Section start point" min="0" max={course.distanceMeters} step="any" value={start}
      onChange={e => setStart(Math.min(+e.target.value, end - minimum))} /></label>
    <label className="field"><span className="lbl">Crest · {distanceText(end, unit)}</span><input type="range" aria-label="Section crest" min="0" max={course.distanceMeters} step="any" value={end}
      onChange={e => setEnd(Math.max(+e.target.value, start + minimum))} /></label>
    <div className="cl-actions">{marks.filter(m => m.meters > start && m.meters < end).map(m => <button type="button" className="btn btn-s btn-sm" key={m.id}
      aria-label={"Remove landmark " + m.name} onClick={() => setMarks(marks.filter(item => item.id !== m.id))}>{m.name} ×</button>)}</div>
    <div className="cl-fields"><label className="field"><span className="lbl">New landmark name</span><input className="input" value={newName} maxLength={120} onChange={e => setNewName(e.target.value)} /></label>
      <label className="field"><span className="lbl">Position ({unit})</span><input className="input n" type="number" step="any" value={newDistance} onChange={e => setNewDistance(e.target.value)} /></label></div>
    <div className="cl-actions"><button type="button" className="btn btn-s" onClick={add}>Add landmark</button><button type="button" className="btn btn-p" onClick={async () => {
      try {
        if (!name.trim()) throw new Error("Name your section.");
        const landmarks = marks.filter(m => m.meters > start && m.meters < end).map(m => ({ ...m, meters: m.meters - start }));
        await onApply(selectClimb(course, { name: name.trim(), startMeters: start, endMeters: end, landmarks }));
      } catch (e) { setError(e.message); }
    }}>Save section</button></div>{error && <p className="err" role="alert">{error}</p>}
  </div></details>;
}

function Preview({ course, unit, profile, onProfile, reference, indoorGhost, pace }) {
  const [meters, setMeters] = useState(0), [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => {
      const next = Math.min(course.distanceMeters, meters + course.distanceMeters / 100);
      setMeters(next);
      if (next >= course.distanceMeters) setPlaying(false);
    }, 120);
    return () => clearTimeout(timer);
  }, [playing, meters, course.distanceMeters]);
  const finished = meters >= course.distanceMeters;
  const referenceState = useMemo(() => startClimb(course, {
    id: "preview", now: 1, reference, indoorGhost, paceSecondsPerKm: pace,
  }), [course, reference, indoorGhost, pace]);
  const readout = climbReadout(course, { ...referenceState, distanceMeters: meters }, 1 + meters * 330);
  return <div className="cl-stack cl-preview"><ClimbScene {...{ course, unit, profile, onProfile }} athleteMeters={meters} ghostMeters={readout.ghostMeters} progressLabel="Preview runner" />
    <div className="cl-preview-controls"><button type="button" className="btn btn-s btn-sm" onClick={() => {
      if (finished) setMeters(0);
      setPlaying(!playing);
    }}>{playing ? "Pause preview" : finished ? "Replay preview" : "Play preview"}</button>
      <label className="field"><span className="lbl">Preview position · {distanceText(meters, unit)}</span>
        <input type="range" aria-label="Preview position" min="0" max={course.distanceMeters} step="any" value={meters}
          onChange={e => { setPlaying(false); setMeters(Number(e.target.value)); }} /></label></div>
  </div>;
}

function CourseSetup({ course, owner, unit, profile, onProfile, treadmill, results, initialSetup, scheduledSlot, todayKey, getScheduleSlots,
  onScheduleCourse, onUpdateActive, onCourse, watchReading }) {
  const ghosts = useMemo(() => results.map(({ run, dateKey }) => {
    const ghost = buildIndoorGhost(course, run);
    return ghost ? { ghost, dateKey } : null;
  }).filter(Boolean), [course, results]);
  const defaults = initialSetup || {};
  const [referenceId, setReferenceId] = useState(() => defaults.reference === "solo" ? "solo" :
    defaults.reference === "pacer" ? "pacer" : defaults.reference === "indoor" && ghosts.some(g => g.ghost.id === defaults.indoorGhostId) ? defaults.indoorGhostId :
    course.hasRecordedGhost ? "recorded" : "pacer");
  const [pace, setPace] = useState(defaults.paceSecondsPerKm || 360);
  const [cap, setCap] = useState(defaults.gradeCap ?? 12);
  const [estimate, setEstimate] = useState(false), [beltPace,setBeltPace] = useState(360);
  const [date, setDate] = useState(todayKey || getTodayKey());
  const [slot, setSlot] = useState(defaults.sessionId || scheduledSlot?.id || "");
  const [busy, setBusy] = useState(false), [feedback, setFeedback] = useState(""), [error, setError] = useState("");
  const working = useRef(false);
  const download = useRef(null);
  const [downloading,setDownloading] = useState(false);
  useEffect(() => () => download.current?.abort(), []);
  const slots = validDate(date) ? (getScheduleSlots?.(date) || []) : [];
  const reference = ["pacer","recorded","solo"].includes(referenceId) ? referenceId : "indoor";
  const indoorGhost = ghosts.find(g => g.ghost.id === referenceId)?.ghost || null;
  const period = Math.round(pace * unitMeters(unit) / 1000);
  const options = { reference, indoorGhostId: indoorGhost?.id || null, paceSecondsPerKm: pace, gradeCap: Number(cap), sessionId: slot || null };
  async function submit(scheduling, warmup = false) {
    if (working.current) return;
    working.current = true; setBusy(true); setError(""); setFeedback("");
    try {
      if (numeric(cap) == null || +cap < 0 || +cap > 30) throw new Error("Choose a manual incline cap between 0% and 30%.");
      if (scheduling && !validDate(date)) throw new Error("Choose a training date.");
      if (scheduling) {
        if (await onScheduleCourse(course, date, options) === false) throw new Error("Course scheduling failed. Try again.");
        setFeedback("Scheduled for " + date);
      } else {
        const key = getTodayKey();
        const run = startClimb(course, { owner, paceSecondsPerKm: pace, reference, indoorGhost });
        const active = { course, run, dateKey: key, phase: warmup ? "warmup" : "climb", manualPaceSeconds:estimate ? beltPace : null,
          recording: {startedAt:run.startedAt, baseMeters:0, extraMeters:0, distanceMeters:0}, gradeCap: Number(cap), paused: false, source: treadmill?.status === "connected" ? "belt" : "manual",
          sessionId: key === (scheduledSlot?.dateKey || defaults.dateKey) ? (scheduledSlot?.id || defaults.sessionId || null) : null };
        if (await onUpdateActive(active) === false) throw new Error("Unable to start. Check device storage and retry.");
      }
    } catch (e) { setError(e.message); }
    finally { working.current = false; setBusy(false); }
  }
  return <>
    <Preview {...{ course, unit, profile: profile && course.hasElevation, onProfile, reference, indoorGhost, pace }} />
    <div className="cl-metrics"><Metric label="Course length">{distanceText(course.distanceMeters, unit)}</Metric><Metric label="Ascent">{gainText(course.ascentMeters, unit)}</Metric>
      <Metric label="Landmarks">{course.landmarks.length}</Metric></div>
    <div className="cl-fields"><label className="field"><span className="lbl">Race against</span><select className="input" value={referenceId} onChange={e => setReferenceId(e.target.value)}>
      {course.hasRecordedGhost && <option value="recorded">{course.ghostName ? "Outdoor ghost · " + course.ghostName : "Recorded outdoor effort"}</option>}<option value="pacer">Target pacer</option><option value="solo">Solo run</option>
      {ghosts.map(({ghost,dateKey}) => <option key={ghost.id} value={ghost.id}>Indoor attempt · {dateKey} · {clockText(ghost.points.at(-1)?.elapsedSeconds)}</option>)}
    </select></label>
      {reference === "pacer" && <label className="field"><span className="lbl">Target pace · {clockText(period)} / {unit}</span>
        <input type="range" aria-label="Target pace" min={180} max={1200} step="5" value={pace} onChange={e => setPace(+e.target.value)} /></label>}
    </div>
    <div className="cl-actions"><button type="button" className="btn btn-p" disabled={!owner || busy} onClick={() => submit(false)}>Start indoor climb</button>
      <button type="button" className="btn btn-s" disabled={!owner || busy} onClick={() => submit(false,true)}>Warm up first</button>
      <span className="t-s c2">{treadmill?.status === "connected" ? treadmill.deviceName : (watchReading?.connected ? "Watch or console distance" : "Console distance")} · Manual incline</span></div>
    <RangeEditor course={course} unit={unit} onApply={onCourse} />
    {course.source !== "sample" && !course.terrain && <details className="cl-details"><summary>Offline terrain</summary><div className="cl-detail-body">
      <p className="t-s c2">Download elevation around this route for its 3D terrain view. This sends the course area to USGS and saves the terrain on this device.</p>
      <button type="button" className="btn btn-s" disabled={busy} onClick={async () => {
        if (download.current) return;
        const controller = new AbortController(); download.current=controller; setDownloading(true);setBusy(true); setError("");
        try {
          const { downloadClimbTerrain } = await import("./terrain");
          const next = await downloadClimbTerrain(course, {signal: controller.signal});
          if (!controller.signal.aborted) await onCourse(next);
        } catch(e) { if (!controller.signal.aborted) setError(e.message || "Could not download terrain. Your course is still available."); }
        finally { download.current=null; if (!controller.signal.aborted) {setDownloading(false);setBusy(false);} }
      }}>{downloading ? "Downloading terrain…" : "Download US terrain"}</button>
    </div></details>}
    <details className="cl-details"><summary>Workout setup</summary><div className="cl-detail-body">
      <label className="field"><span className="lbl">Manual incline cap (%)</span><input className="input n" value={cap} type="number" min="0" max="30" step="0.5"
        onChange={e => setCap(e.target.value)} /></label><p className="t-s c2">Set a cap your deck supports. Use its console to adjust speed and grade.</p>
      <label className="cl-check"><input type="checkbox" checked={estimate} onChange={e=>setEstimate(e.target.checked)}/> Estimate preview position between console readings</label>
      {estimate && <label className="field"><span className="lbl">Console pace estimate · {clockText(beltPace*unitMeters(unit)/1000)} / {unit}</span>
        <input type="range" aria-label="Console pace estimate" min="180" max="1200" step="5" value={beltPace} onChange={e=>setBeltPace(+e.target.value)}/></label>}
    </div></details>
    <Equipment reading={treadmill} />
    {onScheduleCourse && <details className="cl-details"><summary>Schedule as my run</summary><div className="cl-detail-body">
      <div className="cl-fields"><label className="field"><span className="lbl">Training date</span><input className="input" type="date" value={date} onChange={e => { setDate(e.target.value); setSlot(""); setFeedback(""); }} /></label>
        <label className="field"><span className="lbl">Training slot</span><select className="input" value={slot} onChange={e => { setSlot(e.target.value); setFeedback(""); }}>
          <option value="">Independent run</option>{slots.map(s => <option value={s.id} key={s.id}>{s.label || s.title}</option>)}
        </select></label></div><button type="button" className="btn btn-s" disabled={!owner || busy} onClick={() => submit(true)}>Schedule climb</button>
      {feedback && <p role="status" className="t-s">{feedback}</p>}</div></details>}
    {error && <p className="err" role="alert">{error}</p>}
  </>;
}

function AthleteClimb({ owner, courses = empty, results = empty, active, onUpdateActive, onSaveCourse, onDeleteCourse, onSaveResult, onScheduleCourse, initialCourse,
  initialSetup, initialHealthRun, scheduledSlot, getScheduleSlots, todayKey, watchReading, onConnectWatch, courseSources, storageError, missingCourse }) {
  const [selected, setSelected] = useState(validCourse(initialCourse) ? initialCourse : SAMPLE_COURSE);
  const [unit, setUnit] = useState(() => { try { return owner && localStorage.getItem("0vt.climb.units."+owner)==="mi" ? "mi" : "km"; } catch { return "km"; } });
  const [profile, setProfile] = useState(() => Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches));
  const [recent, setRecent] = useState(null), [error, setError] = useState("");
  const { confirm, confirmDialog } = useConfirm();
  const treadmill = useTreadmill();
  const library = Array.from(new Map([SAMPLE_COURSE, ...courses, initialCourse, selected].filter(validCourse).map(c => [c.revision,c])).values());
  const history = Array.from(new Map([...(recent ? [recent] : []), ...results].filter(r => r?.run?.id && r.run.status !== "active")
    .map(r => [r.run.id, r])).values()).sort((a,b) => b.run.startedAt - a.run.startedAt);
  async function saveCourse(course) {
    if (!validCourse(course)) throw new Error("The course could not be read.");
    if (await onSaveCourse?.(course) === false) throw new Error("Course save failed. Check device storage and try again.");
    setSelected(course); setError("");
  }
  const repeat = async (origin, startMeters, endMeters) => {
    try {
      const course = library.find(c => c.revision === origin.run.courseRevision) || (validCourse(origin.course) ? origin.course : null);
      if (!course) throw new Error("Import the original course revision on this device to repeat this section.");
      await saveCourse(selectClimb(course,{startMeters,endMeters,name:course.name+" · section"}));
      window.scrollTo?.({top:0,behavior:"auto"});
    } catch(e) { setError(e.message); }
  };
  return <div className="cl-shell"><div className="cl-title"><h1>Race the Climb</h1><label><span className="sr-only">Distance units</span>
    <select aria-label="Distance units" value={unit} className="input" onChange={e => { const next=e.target.value;setUnit(next);try { if(owner)localStorage.setItem("0vt.climb.units."+owner,next); } catch { /* This choice still applies in memory. */ } }}><option value="km">km</option><option value="mi">mi</option></select></label></div>
    {active && validCourse(active.course) && active.run?.owner === owner ? <ClimbWorkout key={active.run.id} {...{
      active, onUpdateActive, onSaveResult, unit, profile, onProfile: setProfile, treadmill, watchReading, onConnectWatch,
    }} onSaved={value => {
      setRecent(value); setSelected(value.course);
    }} /> : <>
      <header className="cl-head"><p className="lbl">{selected.source === "sample" ? "Sample course" : selected.hasRecordedGhost ? "Timed course" : "Saved course"}</p><h2>{selected.name}</h2></header>
      {missingCourse && <p role="status" className="t-s c2">Import your scheduled course on this device to open its full profile.</p>}
      {library.length > 1 && <label className="field"><span className="lbl">Course library</span><select className="input" value={selected.revision}
        onChange={e => setSelected(library.find(c => c.revision === e.target.value) || SAMPLE_COURSE)}>
        {library.map(c => <option value={c.revision} key={c.revision}>{c.name}{c.ghostName ? " · " + c.ghostName : ""} · {distanceText(c.distanceMeters,unit)}</option>)}</select></label>}
      <CourseSetup key={selected.revision} course={selected} {...{ owner, unit, profile, onProfile:setProfile, treadmill, results:history,
        initialSetup:initialCourse?.revision === selected.revision ? initialSetup : null, scheduledSlot, todayKey, getScheduleSlots, onScheduleCourse, onUpdateActive, watchReading }} onCourse={saveCourse} />
      <ClimbImports initialHealthRun={initialHealthRun} selectedName={selected.name} onGhost={selected.source === "sample" ? null : recorded => saveCourse(withRecordedGhost(selected, recorded))}
        onCourse={saveCourse} owner={owner} courseSources={courseSources} />
      {onDeleteCourse && selected.revision !== SAMPLE_COURSE.revision && <button type="button" className="btn btn-g" onClick={async () => {
        if (!await confirm({title:"Remove this course download?", message:"Saved workout results stay in your history.",confirmLabel:"Remove download",destructive:true}))return;
        try { if (await onDeleteCourse(selected.revision) === false) throw new Error("Could not remove this download."); setSelected(SAMPLE_COURSE); }
        catch(e) { setError(e.message); }
      }}>Remove course download</button>}
      {history.length > 0 && <section className="cl-stack" aria-label="Climb history"><h2 className="t-h">Indoor climb history</h2>
        {history.map(item => <details key={item.run.id} className="cl-details" open={recent?.run.id === item.run.id || undefined}><summary>{item.course?.name || item.run.name || "Climb"} · {item.dateKey}</summary>
          <div className="cl-detail-body"><Debrief course={library.find(c=>c.revision === item.run.courseRevision) || item.course} run={item.run} unit={unit} onRepeat={(a,b) => repeat(item,a,b)} /></div></details>)}</section>}
    </>}
    {initialHealthRun && active && <p className="t-s c2">Your current indoor workout is open. Finish it to import the selected outdoor run.</p>}
    {(error || storageError) && <p role="alert" className="err">{error || storageError}</p>}{confirmDialog}
  </div>;
}

export default function RaceTheClimb(props) { return <AthleteClimb key={props.owner || ""} {...props} />; }
