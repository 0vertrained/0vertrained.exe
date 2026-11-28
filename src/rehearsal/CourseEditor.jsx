import { useRef, useState } from "react";
import { DEFAULT_PROGRAM } from "../constants";
import { formatDuration, parseDuration } from "../runPaces";
import { useConfirm } from "../ui/ConfirmDialog";
import CourseMap from "./CourseMap";
import { buildCourse, checkpointKinds, courseDistances, importGpx, validCourseId } from "./course";

const editable = course => ({ ...course, checkpoints: course.checkpoints.map(cp => ({ ...cp, time: formatDuration(cp.targetSeconds) || "" })) });
const emptyCourse = todayKey => ({ id: crypto.randomUUID(), name: "", date: todayKey, points: [], checkpoints: [] });

function restoreDraft(raw) {
  if (!raw || !validCourseId(raw.id) || typeof raw.name !== "string" || typeof raw.date !== "string" ||
      !Array.isArray(raw.points) || raw.points.length > 450 || !raw.points.every(pt => pt && Number.isFinite(pt.lat) &&
        Math.abs(pt.lat) <= 85.051129 && Number.isFinite(pt.lon) && Math.abs(pt.lon) <= 180) ||
      !Array.isArray(raw.checkpoints) || raw.checkpoints.length > 40 || !raw.checkpoints.every(cp => cp &&
        validCourseId(cp.id) && Number.isInteger(cp.pointIndex) && cp.pointIndex >= 0 && cp.pointIndex < raw.points.length &&
        typeof cp.name === "string" && checkpointKinds.includes(cp.kind) && typeof cp.time === "string" &&
        (cp.instruction == null || typeof cp.instruction === "string"))) return null;
  return raw;
}

function CoordinateInput({ points, onAdd, onMove, onRemove }) {
  const [position, setPosition] = useState("new");
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const valid = lat.trim() && lon.trim() && Number.isFinite(Number(lat)) && Number.isFinite(Number(lon))
    && Math.abs(Number(lat)) <= 85 && Math.abs(Number(lon)) <= 180;
  return <details><summary>Enter or edit coordinates</summary><div className="rr-stack">
    <label className="field"><span className="lbl">Route point</span><select className="input" value={position} onChange={event => {
      const value = event.target.value;
      setPosition(value); setLat(points[value]?.lat?.toString() ?? ""); setLon(points[value]?.lon?.toString() ?? "");
    }}>
      <option value="new">New point</option>
      {points.map((_, index) => <option key={index} value={index}>Point {index + 1}</option>)}
    </select></label>
    <div className="rr-pair">
      <label className="field"><span className="lbl">Latitude</span><input className="input n" inputMode="decimal" value={lat} onChange={e => setLat(e.target.value)} /></label>
      <label className="field"><span className="lbl">Longitude</span><input className="input n" inputMode="decimal" value={lon} onChange={e => setLon(e.target.value)} /></label>
    </div>
    <button type="button" className="btn btn-s" disabled={!valid || (position !== "new" && !points[position])} onClick={() => {
      const point = { lat: Number(lat), lon: Number(lon) };
      if (position === "new") onAdd(point); else onMove(Number(position), point);
    }}>{position === "new" ? "Add route point" : "Move route point"}</button>
    {position !== "new" && points[position] && <button type="button" className="btn btn-g" onClick={async () => {
      if (await onRemove(Number(position))) { setPosition("new"); setLat(""); setLon(""); }
    }}>Remove route point</button>}
  </div></details>;
}

export function CourseEditor({ owner, program, initialCourse, todayKey, onSaveProgram, onDone, onCancel }) {
  const saved = program?.__rehearsal;
  const [base] = useState(() => JSON.stringify(saved ?? null));
  const draftKey = owner ? "0vt.courseDraft.v1." + owner : null;
  const [draft, setDraft] = useState(() => {
    if (draftKey) {
      try {
        const cached = JSON.parse(localStorage.getItem(draftKey));
        const restored = cached?.base === base && restoreDraft(cached.draft);
        if (restored) return restored;
      } catch { /* Start with the saved course if this draft cannot be read. */ }
    }
    return initialCourse ? editable(initialCourse) : emptyCourse(todayKey);
  });
  const [mode, setMode] = useState("draw");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [changes, setChanges] = useState([]);
  const [selected, setSelected] = useState(null);
  const [pointSelection, setPointSelection] = useState("");
  const file = useRef(null);
  const saving = useRef(false);
  const { confirm, confirmDialog } = useConfirm();
  const distances = courseDistances(draft.points);
  const change = (next, record = true) => {
    if (record) setChanges(prev => [...prev.slice(-19), draft]);
    setDraft(next); setError("");
    if (draftKey) {
      try { localStorage.setItem(draftKey, JSON.stringify({ base, draft: next })); }
      catch { setError("This draft will stay open here. Device storage could not keep a copy."); }
    }
  };
  const add = point => {
    if (draft.points.length >= 450) { setError("This course already has 450 route points."); return; }
    change({ ...draft, points: [...draft.points, point], checkpoints: draft.checkpoints.map(cp =>
      cp.kind === "finish" && cp.pointIndex === draft.points.length - 1 ? { ...cp, pointIndex: draft.points.length } : cp) });
  };
  const remove = async index => {
    const anchored = draft.checkpoints.filter(cp => cp.pointIndex === index && cp.kind !== "finish");
    const message = anchored.length
      ? "Remove this route point and its checkpoints: " + anchored.map(cp => cp.name).join(", ") + "?"
      : "Remove this route point? The course distance and remaining checkpoint positions will update.";
    if (!await confirm({ title: "Remove route point?", message, confirmLabel: "Remove point", destructive: true })) return false;
    const points = draft.points.filter((_, i) => i !== index);
    const checkpoints = draft.checkpoints.flatMap(cp => {
      if (cp.pointIndex === index) return cp.kind === "finish" && points.length >= 2 ? [{ ...cp, pointIndex: points.length - 1 }] : [];
      return [{ ...cp, pointIndex: cp.pointIndex > index ? cp.pointIndex - 1 : cp.pointIndex }];
    });
    change({ ...draft, points, checkpoints });
    setPointSelection("");
    return true;
  };
  const move = (index, point) => change({ ...draft, points: draft.points.map((p, i) => i === index ? point : p) });
  const checkpoint = (index, inserted = null) => {
    if (!Number.isInteger(index) || index < 1 || (!inserted && index >= draft.points.length)) {
      setError("Choose a route point after the start."); return;
    }
    if (inserted && draft.points.length >= 450) { setError("Choose an existing point on this course."); return; }
    const existing = !inserted && draft.checkpoints.find(cp => cp.pointIndex === index);
    if (existing) { setSelected(existing.id); return; }
    if (draft.checkpoints.length >= 40) { setError("This course already has 40 checkpoints."); return; }
    const cp = { id: crypto.randomUUID(), pointIndex: index, kind: "split", name: "Split " + (draft.checkpoints.length + 1), time: "", instruction: "" };
    const points = inserted ? [...draft.points.slice(0, index), inserted, ...draft.points.slice(index)] : draft.points;
    const checkpoints = draft.checkpoints.map(item => inserted && item.pointIndex >= index ? { ...item, pointIndex: item.pointIndex + 1 } : item);
    change({ ...draft, points, checkpoints: [...checkpoints, cp].sort((a, b) => a.pointIndex - b.pointIndex) });
    setSelected(cp.id);
  };
  const editCheckpoint = (id, patch) => change({ ...draft, checkpoints: draft.checkpoints.map(cp => cp.id === id ? { ...cp, ...patch } : cp) });
  const loadFile = async event => {
    const picked = event.target.files?.[0];
    event.target.value = "";
    if (!picked) return;
    try {
      if (picked.size > 8 * 1024 * 1024) throw new Error("Choose a GPX file smaller than 8 MB.");
      const parsed = importGpx(await picked.text());
      if (draft.points.length && !await confirm({ title: "Replace this route?", message: "The GPX route and checkpoints will replace the current drawing.", confirmLabel: "Replace route" })) return;
      change(editable({ ...draft, ...parsed, name: parsed.name || draft.name }));
      setSelected(null);
    } catch (e) { setError(e.message || "Could not read this GPX file."); }
  };
  const save = async () => {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError("");
    try {
      if (JSON.stringify(saved ?? null) !== base) throw new Error("This course changed while you were editing. Close and reopen the editor to review the saved course.");
      const checkpoints = draft.checkpoints.map(({ time, ...cp }) => {
        const targetSeconds = time.trim() ? parseDuration(time) : null;
        if (time.trim() && !targetSeconds) throw new Error("Enter the elapsed target for " + (cp.name || "this checkpoint") + " as m:ss or h:mm:ss.");
        return { ...cp, targetSeconds };
      });
      const course = buildCourse({ ...draft, checkpoints });
      const ok = await onSaveProgram({ ...(program || DEFAULT_PROGRAM), __rehearsal: course }, { savedMessage: "Race rehearsal course saved" });
      if (ok === false) throw new Error("Course save failed. Your draft is ready to retry.");
      try { if (draftKey) localStorage.removeItem(draftKey); } catch { /* Already saved to the program. */ }
      onDone(course);
    } catch (e) { setError(e.message || "Course save failed. Try again."); }
    finally { saving.current = false; setBusy(false); }
  };
  const active = draft.checkpoints.find(cp => cp.id === selected);
  return <section className="rr-stack" aria-label="Course editor">
    <div className="rr-pair">
      <label className="field"><span className="lbl">Course name</span><input className="input" maxLength={120} value={draft.name} onChange={e => change({ ...draft, name: e.target.value })} /></label>
      <label className="field"><span className="lbl">Rehearsal date</span><input className="input" type="date" value={draft.date} onChange={e => change({ ...draft, date: e.target.value })} /></label>
    </div>
    <div className="rr-actions">
      {[["draw", "Draw route"], ["checkpoint", "Place checkpoints"], ["pan", "Explore map"]].map(([id, label]) =>
        <button key={id} type="button" className="chip" aria-pressed={mode === id} onClick={() => setMode(id)}>{label}</button>)}
    </div>
    <CourseMap points={draft.points} checkpoints={draft.checkpoints} mode={mode} onAddPoint={add} onPickPoint={checkpoint} onMovePoint={move} onInsertCheckpointPoint={checkpoint} />
    <p className="t-s c2">{mode === "draw" ? "Tap along the road or trail to draw it, or import a GPX track." : mode === "checkpoint" ? "Tap the course where you want a split or a station." : "Pan and zoom to inspect the course."}</p>
    <div className="rr-actions">
      <span className="n grow">{((distances.at(-1) || 0) / 1000).toFixed(2)} km</span>
      <button className="btn btn-s btn-sm" type="button" onClick={() => file.current?.click()}>Import GPX</button>
      <input ref={file} hidden type="file" accept=".gpx,application/gpx+xml,application/xml,text/xml" aria-label="GPX file" onChange={loadFile} />
      <button className="btn btn-g btn-sm" type="button" disabled={!changes.length} onClick={() => {
        change(changes.at(-1), false); setChanges(prev => prev.slice(0, -1));
      }}>Undo change</button>
      <button className="btn btn-g btn-sm" type="button" disabled={!draft.points.length} onClick={async () => {
        if (await confirm({ title: "Clear route?", message: "Remove all route points and checkpoints from this draft?", confirmLabel: "Clear route" })) {
          change({ ...draft, points: [], checkpoints: [] }); setSelected(null);
        }
      }}>Clear route</button>
    </div>
    <CoordinateInput points={draft.points} onAdd={add} onMove={move} onRemove={remove} />
    {draft.points.length > 1 && <div className="rr-actions">
      <label className="field grow"><span className="lbl">Checkpoint position</span><select className="input" value={pointSelection} onChange={e => setPointSelection(e.target.value)}>
        <option value="">Choose route point</option>
        {draft.points.slice(1).map((_, i) => <option key={i} value={i + 1}>Point {i + 2} · {(distances[i + 1] / 1000).toFixed(2)} km</option>)}
      </select></label>
      <button type="button" className="btn btn-s btn-sm" disabled={pointSelection === ""} onClick={() => checkpoint(Number(pointSelection))}>Set checkpoint</button>
    </div>}
    {draft.checkpoints.length > 0 && <ul className="rows">
      {draft.checkpoints.map(cp => <li key={cp.id}><button type="button" className="row" aria-expanded={cp.id === selected} onClick={() => setSelected(cp.id === selected ? null : cp.id)}>
        <span className="grow">{cp.name || "Unnamed checkpoint"}</span><span className="n-s">{((distances[cp.pointIndex] || 0) / 1000).toFixed(2)} km</span>
      </button></li>)}
    </ul>}
    {active && <fieldset className="rr-stack rr-box"><legend>Checkpoint details</legend>
      <label className="field"><span className="lbl">Checkpoint name</span><input className="input" value={active.name} maxLength={120} onChange={e => editCheckpoint(active.id, { name: e.target.value })} /></label>
      <div className="rr-pair">
        <label className="field"><span className="lbl">Station type</span><select className="input" value={active.kind} onChange={e => editCheckpoint(active.id, { kind: e.target.value })}>
          {checkpointKinds.map(k => <option key={k} value={k}>{k[0].toUpperCase() + k.slice(1)}</option>)}</select></label>
        <label className="field"><span className="lbl">Target elapsed time</span><input className="input n" placeholder="m:ss or h:mm:ss" value={active.time} onChange={e => editCheckpoint(active.id, { time: e.target.value })} /></label>
      </div>
      <label className="field"><span className="lbl">Station instructions</span><input className="input" placeholder="e.g. Take gel and refill bottle" value={active.instruction || ""} maxLength={240} onChange={e => editCheckpoint(active.id, { instruction: e.target.value })} /></label>
      <button type="button" className="btn btn-g btn-sm" onClick={() => { change({ ...draft, checkpoints: draft.checkpoints.filter(cp => cp.id !== selected) }); setSelected(null); }}>Remove checkpoint</button>
    </fieldset>}
    {error && <p role="alert" className="err">{error}</p>}
    <div className="rr-actions"><button type="button" className="btn btn-p" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save course"}</button>
      {onCancel && <button type="button" className="btn btn-s" disabled={busy} onClick={onCancel}>Close editor</button>}</div>
    {confirmDialog}
  </section>;
}
