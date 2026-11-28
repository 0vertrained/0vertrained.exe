import { useEffect, useRef, useState } from "react";
import { armTreadmill, climbHardwareAvailable, connectTreadmill, disarmTreadmill, disconnectTreadmill, getTreadmill, requestTreadmillIncline, scanTreadmills, subscribeTreadmill } from "./hardware";

export function useTreadmill() {
  const [reading, setReading] = useState(null);
  useEffect(() => {
    if (!climbHardwareAvailable()) return;
    let alive = true, dispose;
    const update = value => { if (alive) setReading(value); };
    subscribeTreadmill(update).then(unsubscribe => { if (alive) dispose = unsubscribe; else unsubscribe?.(); }).catch(() => {});
    getTreadmill().then(update).catch(() => {});
    return () => { alive = false; dispose?.(); void disconnectTreadmill().catch(() => {}); };
  }, []);
  return reading;
}

export function Equipment({ reading }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!climbHardwareAvailable()) return null;
  const action = async callback => {
    setBusy(true); setError("");
    try { await callback(); } catch (e) { setError(e.message || "Could not reach treadmill."); } finally { setBusy(false); }
  };
  return <details className="cl-details"><summary>Treadmill connection{reading?.deviceName ? " · " + reading.deviceName : ""}</summary>
    <div className="cl-detail-body"><p className="t-s c2">Read belt telemetry from a Bluetooth fitness machine. Set speed and incline at its console.</p>
      {reading?.status === "connected" ? <button className="btn btn-s" type="button" disabled={busy} onClick={() => action(disconnectTreadmill)}>Disconnect treadmill</button> : <>
        <button type="button" className="btn btn-s" disabled={busy || reading?.status === "connecting"} onClick={() => action(scanTreadmills)}>Find treadmills</button>
        {reading?.devices?.map(device => <button className="btn btn-s" type="button" key={device.id} disabled={busy || reading.status === "connecting"}
          onClick={() => action(() => connectTreadmill(device.id))}>Connect {device.name || "treadmill"} · {device.id.slice(-4)}</button>)}
      </>}
      {reading?.message && <p role="status" className="t-s c2">{reading.message}</p>}{error && <p role="alert" className="err">{error}</p>}
    </div></details>;
}

// Only mounted for a native-qualified machine during a measured belt workout.
// The native bridge independently enforces actuator limits and token ownership.
export function QualifiedIncline({ owner, recordingId, reading, target, cap, confirm }) {
  const [message, setMessage] = useState("");
  const [arming, setArming] = useState(false);
  const optedIn = useRef(false), lastRequest = useRef(null), pending = useRef(false);
  const release = () => {
    if (optedIn.current) void disarmTreadmill().catch(() => {});
    optedIn.current = false; lastRequest.current = null;
  };
  useEffect(() => {
    const hidden = () => { if (document.hidden) release(); };
    document.addEventListener("visibilitychange", hidden);
    return () => { document.removeEventListener("visibilitychange", hidden); release(); };
  }, []);
  useEffect(() => {
    if (!optedIn.current || pending.current || reading.controlStage !== "armed" || !reading.armToken || !Number.isFinite(target)) return;
    const grade = Math.max(0, Math.min(cap, target));
    // Round only in native code, against the specific machine's advertised step.
    if (lastRequest.current != null && Math.abs(lastRequest.current-grade) < .5) return;
    pending.current = true; lastRequest.current = grade;
    requestTreadmillIncline({owner, recordingId, armToken:reading.armToken, grade}).catch(e => {
      release(); setMessage(e.message || "Use the console to set incline.");
    }).finally(() => { pending.current=false; });
  }, [reading.controlStage, reading.armToken, target, cap, owner, recordingId]);
  const manual = reading.controlStage === "manual" || !reading.controlStage;
  return <div className="cl-stack"><button type="button" className="btn btn-s" disabled={arming} onClick={async () => {
    if (!manual) { release();setMessage("Use the console to set incline."); return; }
    if (!await confirm({title:"Let this treadmill follow the terrain?",message:"Automatic incline will move the deck during this climb, up to "+cap+"%. You control belt speed at the console.",confirmLabel:"Enable auto incline"})) return;
    setArming(true); setMessage(""); optedIn.current=true; lastRequest.current=null;
    try { await armTreadmill({owner,recordingId,capPercent:cap,confirmed:true}); if(!optedIn.current)await disarmTreadmill(); }
    catch(e){release();setMessage(e.message || "Could not arm incline. Use manual cues.");}finally{setArming(false);}
  }}>{manual ? "Enable auto incline" : "Use manual incline"}</button>
    {reading.targetIncline != null && !manual && <p className="t-s c2">Requested deck incline · {reading.targetIncline.toFixed(1)}%</p>}
    {message && <p role="status" className="t-s c2">{message}</p>}</div>;
}
