import { useCallback, useEffect, useRef, useState } from "react";
import { nativeKeepAwake, nativePlugin } from "../native";
import { APP_FOREGROUND_EVENT } from "../integrations/appForeground";
import { Icon, Sheet } from "../ui/ledger";

function clock(seconds) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function SetInputs({ state, readOnly, send }) {
  const [draft, setDraft] = useState(() => Object.fromEntries(state.fields.map(({ prop }) => [prop, state.values[prop] ?? ""])));
  const values = Object.fromEntries(state.fields.filter(({ prop }) => draft[prop] !== "").map(({ prop }) => [prop, Number(draft[prop])]));
  const changed = state.fields.some(({ prop }) => (values[prop] ?? 0) !== (state.values[prop] ?? 0));
  const valid = state.fields.every(({ prop, max, required }) => {
    const value = values[prop] ?? 0;
    return Number.isFinite(value) && value >= 0 && value <= max && (!required || value > 0)
      && (prop !== "reps" || Number.isInteger(value));
  });
  return <>
    <div className="mirror-fields">
      {state.fields.map(({ prop, label, unit, max, step }) => (
        <label key={prop} className="kv">
          <span className="t-s c2">{label}</span>
          <input className="input n" aria-label={label} type="number" inputMode={prop === "reps" ? "numeric" : "decimal"}
            min="0" max={max} step={step || "any"} value={draft[prop]} placeholder={unit} disabled={readOnly}
            onChange={event => setDraft({ ...draft, [prop]: event.target.value })} />
        </label>
      ))}
    </div>
    <button type="button" className="btn btn-p btn-b" disabled={readOnly || !valid} onClick={() => send("logSet", values)}>Log set on Watch</button>
    {changed && <button type="button" className="btn btn-s btn-b" disabled={readOnly || !valid} onClick={() => send("setTarget", values)}>Update Watch target</button>}
  </>;
}

function CardioProgress({ cardio, now }) {
  if (cardio.kind === "rehearsal") {
    if (!cardio.checkpointName) return null;
    const remaining = Number.isFinite(cardio.checkpointMeters) && Number.isFinite(cardio.distanceMeters)
      ? Math.max(0, cardio.checkpointMeters - cardio.distanceMeters) : null;
    return <div>
      <h4 className="t-bs">{cardio.atStation ? "At station" : "Next checkpoint"} · {cardio.checkpointName}</h4>
      {remaining != null && !cardio.atStation && <p className="t-s">{(remaining / 1000).toFixed(2)} km to checkpoint</p>}
      {cardio.checkpointTargetSeconds > 0 && <p className="t-s c2">Target elapsed · {clock(cardio.checkpointTargetSeconds)}</p>}
      {cardio.checkpointInstruction && <p className="t-s">{cardio.checkpointInstruction}</p>}
    </div>;
  }
  if (!cardio.stepLabel) return null;
  return <div>
    <h4 className="t-bs">{cardio.stepLabel}</h4>
    {cardio.stepCount > 1 && <p className="t-s">Step {cardio.stepIndex} of {cardio.stepCount}</p>}
    {cardio.stepStartedAt > 0 && <p className="t-s c2">{clock((now - cardio.stepStartedAt) / 1000)} in step</p>}
    {cardio.stepTargetSeconds > 0 && <p className="t-s c2">Target duration · {clock(cardio.stepTargetSeconds)}</p>}
    {cardio.stepTargetMeters > 0 && <p className="t-s c2">Target distance · {(cardio.stepTargetMeters / 1000).toFixed(2)} km</p>}
  </div>;
}

function WorkoutDisplay({ response, now, sendCommand }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const sending = useRef(false);
  const { state } = response;
  const connected = response.connected && now - response.receivedAt < 12_000;
  const cardio = state.cardio;
  const displayName = cardio ? (cardio.kind === "rehearsal" ? "Rehearsal display" : "Cardio display") : "Bench display";
  const rest = Math.ceil(((state.restUntil || 0) - now) / 1000);
  const readOnly = Boolean(cardio) || !connected || busy || state.liveReps != null;
  const send = async (action, values = {}) => {
    if (readOnly || sending.current) return;
    sending.current = true;
    setBusy(true);
    setMessage("");
    try {
      await sendCommand({ action, values, id: crypto.randomUUID(), cursor: state.cursor, observedAt: state.sampledAt });
      setMessage(action === "undo" ? "Last set undone." : action === "setTarget" ? "Watch target updated." : "Set logged on Watch.");
    } catch (error) {
      setMessage(error?.message || "Check the latest set on your Watch.");
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };
  useEffect(() => {
    if (open && nativeKeepAwake(true)) return () => { nativeKeepAwake(false); };
  }, [open]);

  return <>
    <button className="mirror-entry" type="button" aria-haspopup="dialog" onClick={() => setOpen(true)}>
      <Icon name="train" size="s" /><span className="grow">Live Watch workout</span>
      <span className="t-s c2">{connected ? displayName : "Reconnecting"}</span><Icon name="next" size="s" />
    </button>
    <Sheet open={open} title={displayName} onClose={() => setOpen(false)}>
      <div className="mirror-panel">
        <div className="sec"><span className="t-s c2">{state.title}</span><span className="n">{clock((now - state.startedAt) / 1000)} elapsed</span></div>
        <h3 className="t-h">{cardio ? cardio.name : state.display || "All sets complete"}</h3>
        {!cardio && state.cursor.index != null && <p className="t-s">Set {state.cursor.index + 1} of {state.total}</p>}
        {!connected && <p role="status" className="banner">Reconnecting to Watch. You can keep logging on your wrist.</p>}
        {connected && <div className="mirror-metrics">
          {!cardio && rest > 0 && <span><strong className="n">{clock(rest)}</strong> rest left</span>}
          {Number.isFinite(cardio?.distanceMeters) && <span><strong className="n">{(cardio.distanceMeters / 1000).toFixed(2)}</strong> km</span>}
          {state.heartRate > 0 && <span><strong className="n">{Math.round(state.heartRate)}</strong> bpm</span>}
          {!cardio && state.liveReps != null && <span><strong className="n">{state.liveReps}</strong> reps detected</span>}
        </div>}
        {cardio && connected && <CardioProgress cardio={cardio} now={now} />}
        {!cardio && state.next && <p className="t-s c2">Next exercise · {state.next}</p>}
        {!cardio && state.cursor.index != null && <SetInputs key={JSON.stringify([state.cursor.revision, state.cursor.section, state.cursor.exercise, state.cursor.index])} state={state} readOnly={readOnly} send={send} />}
        {!cardio && state.cursor.lastSetID && <button type="button" className="btn btn-g" disabled={readOnly} onClick={() => send("undo")}>Undo last set</button>}
        {busy && <p role="status" className="t-s c2">Waiting for Watch…</p>}
        {message && <p role="status" className="t-s">{message}</p>}
      </div>
    </Sheet>
  </>;
}

export default function LiveLiftMirror({ owner }) {
  const plugin = nativePlugin("OTWatch");
  const [response, setResponse] = useState(null);
  const [now, setNow] = useState(Date.now);
  const request = useRef({ sequence: 0 });
  const refresh = useCallback(async () => {
    if (!owner || !plugin?.mirrorStatus) return;
    const current = ++request.current.sequence;
    try {
      const next = await plugin.mirrorStatus({ owner });
      if (request.current.sequence === current) {
        setResponse(next?.state?.cursor?.owner === owner ? next : null);
        setNow(Date.now());
      }
    } catch { if (request.current.sequence === current) setResponse(null); }
  }, [owner, plugin]);
  useEffect(() => {
    if (!owner || !plugin?.mirrorStatus) return;
    let disposed = false;
    let handle;
    const tracker = request.current;
    Promise.resolve(plugin.addListener("liftMirrorChanged", refresh)).then(subscription => {
      if (disposed) subscription?.remove();
      else handle = subscription;
    }).catch(() => {});
    Promise.resolve().then(() => { if (!disposed) refresh(); });
    window.addEventListener(APP_FOREGROUND_EVENT, refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      disposed = true;
      tracker.sequence++;
      handle?.remove();
      window.removeEventListener(APP_FOREGROUND_EVENT, refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [owner, plugin, refresh]);
  const matching = Boolean(owner) && response?.state.cursor.owner === owner && now - response.receivedAt < 120_000;
  useEffect(() => {
    if (!matching) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [matching]);
  if (!matching) return null;
  return <WorkoutDisplay key={response.state.cursor.workoutID} response={response} now={now} sendCommand={async command => {
    try { await plugin.mirrorCommand({ owner, payload: JSON.stringify(command) }); }
    finally { await refresh(); }
  }} />;
}
