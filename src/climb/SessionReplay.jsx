import { useEffect, useId, useMemo, useRef, useState } from "react";
import { clockText, distanceText, unitMeters } from "./ClimbScene";
import { DEMO_CHECK, runSessionReplay } from "./replaySession.js";
import "./sessionReplay.css";

const emptyPoints = [];
const signals = [
  {key:"courseGrade", label:"Course grade", style:"course"},
  {key:"requestedGrade", label:"Requested incline", style:"request"},
  {key:"measuredGrade", label:"Recorded deck", style:"deck"}
];
const scenarios = {
  recorded:"Recorded check", disconnect:"Disconnect treadmill", background:"Background app", console:"Console override"
};
const stageNames = {manual:"Manual",acquiring:"Requesting control",armed:"Armed",acknowledging:"Awaiting acknowledgment",settling:"Waiting for deck"};
const grade = n => Number.isFinite(n) ? n.toFixed(1) + "%" : "Unavailable";
const seconds = n => Number.isFinite(n) ? (n/1000).toFixed(2) + " s" : "Unavailable";
const dateText = ms => Number.isFinite(ms) ? new Date(ms).toLocaleString(undefined,{dateStyle:"short",timeStyle:"short"}) : "";
function time(at) {
  if (!Number.isFinite(at)) return "Unavailable";
  const rounded = Math.max(0, Math.round(at*1000));
  const fraction = String(rounded % 1000).padStart(3,"0").replace(/0+$/, "");
  return clockText(Math.floor(rounded/1000)) + (fraction ? "." + fraction : "");
}
const isWorkout = check => check.origin === "workout";
const checkName = check => isWorkout(check) ? check.name || "Indoor climb" : check.physicalMachine || "Treadmill check";

function CaptureFacts({check, demo}) {
  const stats = check.stats || {};
  const rows = [
    ["Recording type",demo ? "Demo recording" : isWorkout(check) ? "Indoor workout" : "Guided machine check"],
    ["Physical treadmill",check.physicalMachine || "Unavailable"],
    ["Transmitter",check.transmitter?.name || "Unavailable"],
    ["Captured packets",stats.packets ?? check.samples?.length ?? 0],
    ["Duration",time((stats.durationMs ?? (check.endedAt - check.startedAt)) / 1000)],
    ["Mean interval",seconds(stats.meanIntervalMs)],["Longest gap",seconds(stats.longestGapMs)],
    ["Continuity breaks",stats.interruptions ?? "Unavailable"],["Missed packets",stats.missedPackets ?? "Unavailable"],
    ...(!isWorkout(check) ? [["Baseline incline",grade(stats.baselineGrade)],["After adjustment",grade(stats.observedGrade)]] : [])
  ];
  return <details className="sr-capture"><summary>{demo ? "Demo check details" : isWorkout(check) ? "Workout recording details" : "Saved check details"}</summary>
    <dl className="sr-facts">{rows.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {check.markers?.at(-1)?.note && <p className="t-s c2">{check.markers.at(-1).note}</p>}
  </details>;
}

// Keep first, last and extrema per horizontal pixel bucket. Start a separate
// path fragment at every missing value or segment boundary, even in one pixel.
function signalPath(points, key, x, y) {
  const parts = [];
  let bucket = null, prevSegment = null, pen = false, previous = null;
  const flush = () => {
    if (!bucket) return;
    const retained = [...new Set([bucket.first,bucket.low,bucket.high,bucket.last])].sort((a,b)=>a-b);
    for (const index of retained) {
      const point = points[index];
      const px=x(point.at).toFixed(2), py=y(point[key]).toFixed(2);
      if (!pen) parts.push("M"+px+" "+py+"l0.01 0");
      else if (key === "requestedGrade") parts.push("H"+px+"V"+py);
      else parts.push("L"+px+" "+py);
      pen=true;
    }
    bucket=null;
  };
  points.forEach((point,i)=>{
    if (!Number.isFinite(point[key]) || point.segment !== prevSegment) {
      flush(); pen=false; previous=null;
    }
    prevSegment=point.segment;
    if (!Number.isFinite(point[key])) return;
    const column=Math.floor(x(point.at));
    if (previous !== column) {flush();previous=column;}
    if (!bucket) bucket={first:i,last:i,low:i,high:i};
    bucket.last=i;
    if (point[key] < points[bucket.low][key]) bucket.low=i;
    if (point[key] > points[bucket.high][key]) bucket.high=i;
  });
  flush();
  return parts.join("");
}

function chartData(points,duration) {
  const width=640, top=12, bottom=132;
  let low=0,high=1;
  for (const p of points) for (const {key} of signals) {
    if (Number.isFinite(p[key])) {low=Math.min(low,p[key]);high=Math.max(high,p[key]);}
  }
  low=Math.floor(low/2)*2;high=Math.ceil(high/2)*2;
  const x=at=>3+Math.min(1,Math.max(0,at / (duration || 1)))*(width-6);
  const y=n=>bottom-(n-low)/(high-low)*(bottom-top);
  return {low,high,x,zero:y(0),paths:signals.map(s=>({...s,d:signalPath(points,s.key,x,y)}))};
}

function ReplayPlot({result, unit}) {
  const [cursor,setCursor]=useState(0);
  const id=useId(), points=result.points || emptyPoints, duration=result.durationSeconds || 0;
  const graph=useMemo(()=>chartData(points,duration),[points,duration]);
  // Align the scrubber to wall time. Multiple hardware packets can arrive
  // together, followed by a long interval with no observations.
  let low=0, high=points.length;
  while (low<high) {
    const middle=(low+high)>>>1;
    if (points[middle].at<=cursor) low=middle+1; else high=middle;
  }
  const point=points[Math.max(0,low-1)];
  if (!point) return <p className="t-s c2">This check has no points to plot.</p>;
  return <div className="sr-plot">
    <div className="sr-key">{signals.map(s=><span key={s.key}><i aria-hidden="true" className={"sr-key-"+s.style}/>{s.label}</span>)}</div>
    <div className="sr-chart"><span className="sr-axis" aria-hidden="true"><span>{graph.high}%</span><span>{graph.low}%</span></span>
      <svg viewBox="0 0 640 144" preserveAspectRatio="none" role="img" aria-labelledby={id}>
        <title id={id}>Course grade, simulated requested incline and recorded deck incline over elapsed time. Missing readings leave gaps.</title>
        <path className="sr-grid" d={`M0 12H640 M0 ${graph.zero}H640 M0 132H640`}/>
        {graph.paths.map(s=><path key={s.key} data-signal={s.key} className={"sr-line sr-"+s.style} d={s.d}/>)}
        <path className="sr-cursor" d={`M${graph.x(cursor)} 8V136`}/>
      </svg>
    </div>
    <div className="sr-time-axis" aria-hidden="true"><span>0:00</span><span>{time(duration)}</span></div>
    <label className="field"><span className="lbl">Replay time</span><input type="range" min={0} max={duration}
      step={duration>600 ? 1 : .1} value={cursor} disabled={points.length<2} aria-valuetext={time(cursor)} onChange={e=>setCursor(Number(e.target.value))}/></label>
    <p className="t-s">{time(cursor)} · {distanceText(point.meters,unit)} on course · {stageNames[point.stage] || "Unknown controller state"}{cursor>point.at+.05 && " · Latest sample "+time(point.at)}</p>
    <dl className="sr-cursor-facts">{signals.map(s=><div key={s.key}><dt>{s.label}</dt><dd>{grade(point[s.key])}</dd></div>)}</dl>
  </div>;
}

function CommandLog({commands}) {
  const [page,setPage]=useState(0);
  const size=8, last=Math.ceil(commands.length/size)-1;
  if (!commands.length) return <p className="t-s c2">The simulator issued no incline commands.</p>;
  return <details className="sr-capture"><summary>Simulated incline commands ({commands.length})</summary>
    <ol className="sr-log" start={page*size+1}>{commands.slice(page*size,(page+1)*size).map((c,i)=>
      <li key={page*size+i}><span>{time(c.at)}</span>Request {grade(c.grade)}</li>)}</ol>
    {last>0 && <div className="cl-actions"><button className="btn btn-s btn-sm" type="button" disabled={page===0} onClick={()=>setPage(page-1)}>Earlier commands</button>
      <span className="t-s">{page+1} of {last+1}</span><button className="btn btn-s btn-sm" type="button" disabled={page>=last} onClick={()=>setPage(page+1)}>Later commands</button></div>}
  </details>;
}

function ReplayResult({result,unit,scenario}) {
  return <section className="cl-stack sr-result" aria-label="Replay result">
    <h4>Replay result</h4>
    <p className="t-s">{result.controller} simulator · {time(result.durationSeconds)} · {distanceText(result.trackedMeters,unit)} covered
      {result.estimatedMeters>0 && " · "+distanceText(result.estimatedMeters,unit)+" estimated from belt speed"}</p>
    <ReplayPlot result={result} unit={unit}/>
    <p className="t-s" role="status">{Number.isFinite(result.releasedAt) ? "Control released at "+time(result.releasedAt)+". " +(result.releaseReason || "") :
      result.acquired ? "Control stayed active through the final replay sample." : "The recording supplied insufficient feedback to acquire simulated control."}</p>
    {scenario !== "recorded" && <p className="t-s sr-fault">{result.faultSkipped || !Number.isFinite(result.faultAt) ?
      "The recording had no eligible point for this interruption." : scenarios[scenario]+" at "+time(result.faultAt)+" · "+
      (result.afterFaultCommands===0 ? "No incline commands followed the interruption." : result.afterFaultCommands+" incline commands followed the interruption.")}</p>}
    <CommandLog commands={result.commands || []}/>
  </section>;
}

function ReplayForm({course,unit,check, demo, confirm, onDelete}) {
  const [start,setStart]=useState(""), [cap,setCap]=useState("12"), [scenario,setScenario]=useState("recorded");
  const [result,setResult]=useState(null), [error,setError]=useState(""), [busy,setBusy]=useState(false), [removing,setRemoving]=useState(false);
  const generation=useRef(0), alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  function change(update,value) {
    generation.current++;setBusy(false);setError("");setResult(null);update(value);
  }
  async function run() {
    const startMeters=(start.trim() ? Number(start) : 0)*unitMeters(unit), limit=Number(cap);
    if (!Number.isFinite(startMeters) || startMeters<0 || startMeters>=course.distanceMeters) {
      setError("Choose a starting distance from zero to before the end of the course.");return;
    }
    if (!cap.trim() || !Number.isFinite(limit) || limit<0 || limit>15) {setError("Choose an incline cap from 0% to 15%.");return;}
    const request=++generation.current;
    setResult(null);setError("");setBusy(true);
    try {
      const output=await runSessionReplay({check,course,startMeters,cap:limit,scenario});
      if (request===generation.current && alive.current) setResult(output);
    } catch(e) {
      if (request===generation.current && alive.current) setError(e.message || "Replay could not finish.");
    } finally {if(request===generation.current && alive.current)setBusy(false);}
  }
  async function remove() {
    if (removing || isWorkout(check) || !onDelete || !confirm) return;
    setRemoving(true);
    try {
      if (await confirm({title:"Delete this saved machine check?",message:checkName(check)+" and its captured readings will be removed from this device.",confirmLabel:"Delete check",destructive:true}) && alive.current) {
        if (await onDelete(check.id)===false) throw new Error("The saved check could not be deleted.");
      }
    } catch(e) {if(alive.current)setError(e.message || "The saved check could not be deleted.");}
    finally {if(alive.current)setRemoving(false);}
  }
  const packets=check.stats?.packets ?? check.samples?.length ?? 0;
  return <>
    <p className="t-s c2">{demo ? "Synthetic sample" : isWorkout(check) ? "Indoor workout recording" : check.outcome === "completed" ? "Completed check" : "Partial check"} · {packets} captured {packets===1?"packet":"packets"}
      {packets===0 && " · No movement readings to replay"}</p>
    <CaptureFacts check={check} demo={demo}/>
    <div className="cl-fields"><label className="field"><span className="lbl">Course start ({unit})</span>
      <input className="input n" type="number" min="0" step="any" inputMode="decimal" placeholder="0.00"
        value={start} onChange={e=>change(setStart,e.target.value)}/></label>
      <label className="field"><span className="lbl">Replay incline cap (%)</span><input className="input n" type="number" min="0" max="15" step="any" inputMode="decimal"
        value={cap} onChange={e=>change(setCap,e.target.value)}/></label></div>
    <label className="field"><span className="lbl">Replay scenario</span><select className="input" value={scenario}
      onChange={e=>change(setScenario,e.target.value)}>{Object.entries(scenarios).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
    <p className="t-s c2">The virtual deck accepts 0–15% in half-point steps, with changes of up to two percentage points every three seconds. Commands and acknowledgments are simulated. Only the virtual deck responds.</p>
    <div className="cl-actions"><button type="button" className="btn btn-p" disabled={busy || !packets} onClick={run}>{busy ? "Running replay…" : "Run replay"}</button>
      {!demo && !isWorkout(check) && onDelete && confirm && <button type="button" className="btn btn-g" disabled={removing} onClick={remove}>Delete saved check</button>}</div>
    {error && <p className="err" role="alert">{error}</p>}
    {result && <ReplayResult result={result} unit={unit} scenario={scenario}/>}
  </>;
}

export function SessionReplay({course,unit="km",checks=[],onDelete,confirm}) {
  const [selected,setSelected]=useState(null);
  const saved=useMemo(()=>[...checks].filter(c=>c?.id).sort((a,b)=>(b.endedAt??b.startedAt??0)-(a.endedAt??a.startedAt??0)),[checks]);
  const check=selected==="demo" ? DEMO_CHECK : saved.find(c=>c.id===selected) ?? saved[0] ?? DEMO_CHECK;
  const demo=check===DEMO_CHECK;
  return <details className="cl-details sr-panel"><summary>Session replay</summary><div className="cl-detail-body">
    <p className="t-s c2">Replay a recording on <strong>{course.name}</strong> to compare the course grade, the incline the controller would request, and the incline captured on the treadmill.</p>
    <label className="field"><span className="lbl">Replay recording</span><select className="input" value={demo?"demo":check.id} onChange={e=>setSelected(e.target.value)}>
      {saved.map(c=><option key={c.id} value={c.id}>{!isWorkout(c) && "Machine check · "}{checkName(c)} · {dateText(c.endedAt ?? c.startedAt)}</option>)}
      <option value="demo">Demo check</option></select></label>
    <ReplayForm key={[course.revision??course.id,check.id,demo,unit].join("/")} {...{course,check,demo,unit,onDelete,confirm}}/>
  </div></details>;
}
