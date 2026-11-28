import { useEffect, useRef, useState } from "react";
import { importClimbGpx, listClimbGpxSegments } from "./engine";
import { healthRoutesAvailable, importHealthRoute, listHealthRoutes } from "./hardware";

export function ClimbImports({ onCourse, onGhost, selectedName, owner, courseSources = [], initialHealthRun }) {
  const input = useRef(null), mounted = useRef(false);
  useEffect(() => { mounted.current=true; return () => { mounted.current=false; }; }, []);
  const [file, setFile] = useState(null);
  const [segment, setSegment] = useState(0);
  const [purpose, setPurpose] = useState("course");
  const accept = (course, as) => as === "ghost" && onGhost ? onGhost(course) : onCourse(course);
  const [runs, setRuns] = useState(null);
  const [raceDate, setRaceDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = async (xml, name, as = purpose) => {
    if (!mounted.current) return;
    const segments = listClimbGpxSegments(xml);
    if (segments.length > 1) {
      setFile({ xml, segments, name, as }); setSegment(segments[0].index);
    } else {
      const course = importClimbGpx(xml, { segmentIndex: segments[0]?.index ?? 0 });
      await accept(course, as); setFile(null);
    }
  };
  const perform = async task => {
    if (busy) return;
    setBusy(true); setError("");
    try { await task(); }
    catch (e) { setError(e.message || "Could not import this course."); }
    finally { setBusy(false); }
  };
  const requested = useRef(null), details = useRef(null);
  const importRoute = run => perform(async () => {
    await load(await importHealthRoute(run.id,owner),run.name, "course");
    setRuns(null);
  });
  const importer=useRef(importRoute);
  useEffect(()=>{importer.current=importRoute;});
  useEffect(() => {
    if (busy || !initialHealthRun?.id || requested.current === initialHealthRun.id || !owner || (initialHealthRun.owner && initialHealthRun.owner !== owner) || !healthRoutesAvailable()) return;
    requested.current = initialHealthRun.id;
    if (details.current) details.current.open = true;
    void importer.current(initialHealthRun);
  }, [initialHealthRun, owner, busy]);
  return <details ref={details} className="cl-details"><summary>Add a course</summary><div className="cl-detail-body">
    <p className="t-s c2">Import a race course or a timed outdoor run. A recording with timestamps can become your ghost.</p>
    {onGhost && <label className="field"><span className="lbl">Import as</span><select className="input" value={purpose} onChange={e=>{setPurpose(e.target.value);setFile(null);setError("");}}>
      <option value="course">New course</option><option value="ghost">Personal ghost on {selectedName}</option></select></label>}
    {healthRoutesAvailable() && <label className="field"><span className="lbl">Around race date (optional)</span>
      <input type="date" className="input" value={raceDate} onChange={e => { setRaceDate(e.target.value);setRuns(null); }} /></label>}
    <div className="cl-actions">
      <button type="button" className="btn btn-s" disabled={busy} onClick={() => input.current?.click()}>Import GPX</button>
      {healthRoutesAvailable() && <button type="button" className="btn btn-s" disabled={busy}
        onClick={() => perform(async () => setRuns(await listHealthRoutes(owner, raceDate || undefined)))}>Choose Apple Health run</button>}
    </div>
    <input hidden type="file" ref={input} aria-label="Import GPX file" accept=".gpx,application/gpx+xml,application/xml,text/xml" onChange={e => {
      const selected = e.target.files?.[0]; e.target.value = "";
      if (selected) perform(async () => {
        if (selected.size > 8 * 1024 * 1024) throw new Error("Choose a GPX file under 8 MB.");
        await load(await selected.text(), selected.name);
      });
    }} />
    {busy && <p role="status">Reading course…</p>}
    {initialHealthRun && error && <button type="button" className="btn btn-s" disabled={busy} onClick={()=>importRoute(initialHealthRun)}>Retry {initialHealthRun.name || "Health route"}</button>}
    {file && <div className="cl-stack"><label className="field"><span className="lbl">Continuous segment in {file.name}</span>
      <select className="input" value={segment} onChange={e => setSegment(Number(e.target.value))}>
        {file.segments.map(s => <option key={s.index} value={s.index}>{s.name} · {s.pointCount} points</option>)}
      </select></label><button type="button" className="btn btn-s" disabled={busy} onClick={() => perform(async () => {
        await accept(importClimbGpx(file.xml, { segmentIndex: segment }), file.as); setFile(null);
      })}>Import selected segment</button></div>}
    {Array.isArray(runs) && (runs.length ? <ul className="rows">{runs.map(r => <li key={r.id}><button type="button" className="btn btn-g cl-health" disabled={busy}
      onClick={() => perform(async () => { await load(await importHealthRoute(r.id, owner), r.name); setRuns(null); })}>{r.name} · {r.date}</button></li>)}</ul>
      : <p className="t-s c2">No outdoor runs with readable routes. You can import a GPX or use the sample climb.</p>)}
    <details><summary>Find a race GPX</summary><p className="t-s c2">Open the race organizer’s course map, choose your race distance, and look for “GPX” or “Download route.” Save the file to Files, then import it here.</p>
      {courseSources.map(link => <p key={link.url}><a href={link.url} target="_blank" rel="noreferrer">{link.name}</a></p>)}</details>
    {error && <p className="err" role="alert">{error}</p>}
  </div></details>;
}
