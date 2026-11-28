import { useEffect, useRef, useState } from "react";
import { useConfirm } from "../ui/ConfirmDialog";
import { subscribeTreadmill } from "./hardware";
import { GuidedCheckCapture } from "./guidedCheck";

const seconds = ms => Number.isFinite(ms) ? `${(ms / 1000).toFixed(2)} s` : "Awaiting two packets";
const phaseNames = {baseline:"Baseline walk",adjust:"Console adjustment",observe:"After adjustment"};
const grade = value => Number.isFinite(value) ? value.toFixed(1) + "%" : "Unmeasured";

function Summary({check}) {
  const {stats}=check;
  return <dl className="cl-report-facts">
    <div><dt>Captured packets</dt><dd>{stats.packets}</dd></div>
    <div><dt>Mean packet interval</dt><dd>{seconds(stats.meanIntervalMs)}</dd></div>
    <div><dt>Longest observed gap</dt><dd>{seconds(stats.longestGapMs)}</dd></div>
    <div><dt>Baseline incline</dt><dd>{grade(stats.baselineGrade)}</dd></div>
    <div><dt>Incline after adjustment</dt><dd>{grade(stats.observedGrade)}</dd></div>
    <div><dt>Reported grade change</dt><dd>{stats.gradeResponse === "changed" ? `Observed ${seconds(stats.responseDelayMs)} after your marker` : stats.gradeResponse === "unchanged" ? "No change in the captured readings" : "Insufficient continuous readings"}</dd></div>
    {stats.interruptions>0 && <div><dt>Continuity boundaries</dt><dd>{stats.interruptions}</dd></div>}
    {stats.missedPackets>0 && <div><dt>Missed packets</dt><dd>{stats.missedPackets}</dd></div>}
  </dl>;
}

export function GuidedMachineCheck({reading, onSaveCheck}) {
  const [name,setName]=useState(""), [knob,setKnob]=useState("");
  const [mode,setMode]=useState("setup"), [error,setError]=useState(""), [saving,setSaving]=useState(false);
  const [view,setView]=useState(null);
  const capture=useRef(null), stop=useRef(null), alive=useRef(false), redraw=useRef(null), savingRef=useRef(false);
  const {confirm,confirmDialog}=useConfirm();
  function refresh() {
    if (!alive.current || !capture.current) return;
    const session=capture.current;
    setView({check:{...session.result,stats:{...session.result.stats}},phase:session.phase,paused:session.paused,online:session.online,lastGrade:session.lastGrade?.value});
    if (session.finished) {setMode("review"); stop.current?.();stop.current=null;}
  }
  useEffect(()=>{
    alive.current=true;
    const visibility=()=>{capture.current?.setHidden(document.hidden);refresh();};
    document.addEventListener("visibilitychange",visibility);
    return ()=>{alive.current=false;document.removeEventListener("visibilitychange",visibility);stop.current?.();stop.current=null;clearTimeout(redraw.current);capture.current=null;};
  },[]);
  const start=async()=>{
    if (capture.current || !name.trim() || (reading?.controlStage && reading.controlStage!=="manual")) return;
    const session=new GuidedCheckCapture(name,reading);
    capture.current=session;setError("");setMode("capture");refresh();
    try {
      const off=await subscribeTreadmill(packet=>{
        if (!alive.current || session!==capture.current || session.finished) return;
        session.record(packet);
        // Keep each native packet. Only screen refreshes are coalesced.
        if (session.finished) {refresh();return;}
        if (redraw.current===null) redraw.current=setTimeout(()=>{redraw.current=null;refresh();},200);
      });
      if (!alive.current || capture.current!==session || session.finished) off(); else stop.current=off;
    } catch {
      if (alive.current && capture.current===session) {session.finish(Date.now(),"Could not subscribe to treadmill events");refresh();setError("The treadmill listener could not start. Save the partial check or try another.");}
    }
  };
  const advance=()=>{
    const value=knob.trim() ? Number(knob) : null;
    if (knob.trim() && (!Number.isFinite(value) || value < -50 || value>100)) {setError("Enter the grade percentage shown on the console, or leave it blank.");return;}
    setError("");capture.current?.nextPhase(Date.now(),value);refresh();
  };
  const finish=()=>{capture.current?.finish();refresh();};
  const clear=()=>{stop.current?.();stop.current=null;capture.current=null;setView(null);setKnob("");setError("");setMode("setup");};
  const save=async()=>{
    if (!capture.current?.finished || savingRef.current) return;
    savingRef.current=true;setSaving(true);setError("");
    try {
      if (await onSaveCheck(capture.current.result)===false) throw new Error("Could not save the check. Try again before leaving this screen.");
      if (alive.current) {capture.current=null;setMode("saved");}
    } catch(e) {if(alive.current)setError(e.message || "Could not save the check. Try again.");}
    finally {savingRef.current=false;if(alive.current)setSaving(false);}
  };
  const auto=reading?.controlStage && reading.controlStage!=="manual";
  return <details className="cl-details"><summary>Guided Peloton check</summary><div className="cl-detail-body">
    {mode === "setup" && <><p className="t-s c2">Walk at your usual warm-up speed, then change incline at the console. The check records Bluetooth readings as you go. You control the treadmill throughout.</p>
      <label className="field"><span className="lbl">Physical treadmill name</span><input className="input" value={name} maxLength={120} placeholder="e.g. Peloton Tread+" onChange={e=>setName(e.target.value)}/></label>
      <p className="t-s">Bluetooth transmitter · {reading?.report?.deviceName || "None selected"}</p>
      {reading?.status!=="connected" && <p className="t-s c2">Connect a transmitter above to capture readings. You can save a partial check if the treadmill stays silent.</p>}
      {auto && <p className="t-s c2">Switch the workout to manual incline before starting a check.</p>}
      <button type="button" className="btn btn-s" disabled={!name.trim() || Boolean(auto)} onClick={start}>Start baseline walk</button></>}
    {mode === "capture" && view && <><h4>{phaseNames[view.phase]}</h4>
      <p className="t-s">{view.check.physicalMachine} · Transmitter {view.check.transmitter.name || "unconnected"}</p>
      {view.paused ? <p className="t-s" role="status">Check paused. Readings resume in a new interval.</p> : <p className="t-s c2">{view.phase === "baseline" ? "Walk at a constant incline until you see a baseline reading. Change the incline manually and mark when you turn the knob." : view.phase === "adjust" ? "Keep walking at the new console setting. Begin the observation once the deck settles." : "Continue walking while the transmitter reports the new setting. Finish when you have enough readings."}</p>}
      {!view.online && <p className="t-s c2">Waiting for the selected transmitter. You can reconnect above or finish this check.</p>}
      {view.phase === "baseline" && <><p className="t-s">Last baseline reading · {grade(view.lastGrade)}</p>
        <label className="field"><span className="lbl">New console incline (%) · optional</span><input className="input n" type="number" step="any" value={knob} onChange={e=>setKnob(e.target.value)}/></label></>}
      <Summary check={view.check}/>
      <div className="cl-actions">{view.phase !== "observe" && <button className="btn btn-p" type="button" disabled={view.paused} onClick={advance}>{view.phase === "baseline" ? "Mark manual incline change" : "Begin observation"}</button>}
        <button className="btn btn-s" type="button" onClick={()=>{capture.current?.setPaused(!view.paused);refresh();}}>{view.paused ? "Resume check" : "Pause check"}</button>
        <button className="btn btn-s" type="button" onClick={finish}>Finish check</button></div>
      <p className="t-s c2">Finish and save before leaving this screen.</p></>}
    {mode === "review" && view && <><h4>{view.check.outcome === "completed" ? "Check complete" : "Partial check"}</h4>
      <p className="t-s">{view.check.physicalMachine} · Transmitter {view.check.transmitter.name || "unconnected"}</p>
      {view.check.markers.at(-1)?.note && <p className="t-s c2">{view.check.markers.at(-1).note}</p>}
      <Summary check={view.check}/><div className="cl-actions"><button type="button" className="btn btn-p" disabled={saving} onClick={save}>Save machine check</button>
        <button type="button" className="btn btn-g" disabled={saving} onClick={async()=>{if(await confirm({title:"Discard this machine check?",message:"The captured readings will be removed.",confirmLabel:"Discard check",destructive:true}))clear();}}>Discard check</button></div></>}
    {mode === "saved" && <><p className="t-s" role="status">Machine check saved on this device.</p><button type="button" className="btn btn-s" onClick={clear}>Start another check</button></>}
    {error && <p className="err" role="alert">{error}</p>}{confirmDialog}
  </div></details>;
}
