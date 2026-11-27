import { useEffect, useState } from "react";
import { dateKey } from "../coachWindows";
import { subscribeWhoopBluetooth, useWhoopBluetooth } from "./bluetooth";
import { historyWindow, readStoredPulse } from "./storedReadings";

const stack = { display: "grid", gap: 8, minWidth: 0 };
const clock = ms => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const MODES = [["overnight", "Overnight"], ["day", "Full day"], ["workout", "Workout window"]];

function PulseRange({ bins, peak, from, until }) {
  const low = Math.min(...bins.map(bin => bin.low));
  const scale = bpm => 50 - 46 * (bpm - low) / Math.max(peak - low, 1);
  return (
    <figure style={{ margin: 0 }}>
      <svg role="img" aria-label={`Recorded heart rate from ${low} to ${peak} bpm. Blank areas have no pulse readings.`}
        viewBox={`0 0 ${bins.length} 54`} preserveAspectRatio="none" style={{ width: "100%", height: 76 }}>
        {bins.map((bin, i) => bin.peak > 0 && <line key={i} x1={i + 0.5} x2={i + 0.5}
          y1={scale(bin.peak) - 0.8} y2={scale(bin.low) + 0.8} stroke="currentColor" strokeWidth={0.85} />)}
      </svg>
      <figcaption className="t-s c2" style={{ display: "flex", justifyContent: "space-between", gap: 4 }}>
        <span>{clock(from)}</span><span>{low}–{peak} bpm</span><span>{clock(until)}</span>
      </figcaption>
    </figure>
  );
}

export function StoredPulseWindow({ bridge, from, until, overnight = false }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [openedAt] = useState(() => Date.now());
  const end = Math.min(until, openedAt);
  useEffect(() => {
    let cancelled = false;
    if (end > from) {
      readStoredPulse(bridge, from, end, () => cancelled, { overnight })
        .then(value => { if (!cancelled && value) setResult({ ...value, end }); })
        .catch(cause => { if (!cancelled) setError(cause.message || "Couldn’t open stored readings."); });
    }
    return () => { cancelled = true; };
  }, [bridge, from, end, retry, overnight]);
  if (error) return <div style={stack}><p role="alert" className="t-s err">{error}</p>
    <button className="btn btn-s btn-sm" type="button" onClick={() => { setError(""); setRetry(n => n + 1); }}>Reload readings</button></div>;
  if (end <= from) return <p className="t-s c2">This time window hasn’t started yet.</p>;
  if (!result) return <p role="status" className="t-s c2">Opening stored readings…</p>;
  if (!result.samples && result.motionMinutes > 0) return <p className="t-s c2">
    {result.motionMinutes} {result.motionMinutes === 1 ? "minute contains" : "minutes contain"} motion sensor readings. There is no usable on-wrist pulse in this window.</p>;
  if (!result.samples) return <p className="t-s c2">{result.records
    ? "The strap returned records for this window without a usable on-wrist heart rate."
    : "No readings saved for this window. Sync the strap or choose another date."}</p>;
  const coverage = result.samples / result.totalSeconds * 100;
  return (
    <div style={stack}>
      <p className="t-bs">{result.average} bpm average · {result.peak} bpm peak</p>
      <PulseRange bins={result.bins} peak={result.peak} from={from} until={result.end} />
      <p className="t-s c2">Pulse recorded in {coverage < 1 ? "<1" : Math.round(coverage)}% of seconds. Gaps are blank.</p>
      {overnight && result.lowestFive !== null && <p className="t-s">Lowest five-minute average · <strong>{result.lowestFive} bpm</strong></p>}
      {overnight && (result.overnightRmssd != null ?
        <p className="t-s">Overnight-window HRV (RMSSD) · <strong>{result.overnightRmssd} ms</strong> · median of {result.hrvWindowCount} two-minute readings</p>
        : <p className="t-s c2">Overnight HRV needs three clean two-minute readings spread over at least an hour.</p>)}
    </div>
  );
}

export function WhoopStoredReadings({ bridge, history }) {
  const [mode, setMode] = useState("overnight");
  const [day, setDay] = useState(() => dateKey());
  const [start, setStart] = useState("07:00");
  const [end, setEnd] = useState("08:00");
  const window = historyWindow(day, mode, start, end);
  return (
    <div style={stack}>
      <div className="chips" role="group" aria-label="Stored reading window">
        {MODES.map(([id, label]) => <button key={id} type="button" className="chip" aria-pressed={id === mode}
          onClick={() => setMode(id)}>{label}</button>)}
      </div>
      <label className="t-s">{mode === "overnight" ? "Morning of" : "Date"}{" "}
        <input type="date" value={day} max={dateKey()} onChange={e => setDay(e.target.value)} /></label>
      {mode === "overnight" && <p className="t-s c2">8 pm to 10 am, local time. Choose Workout window to enter other hours.</p>}
      {mode === "workout" && <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <label className="t-s">From <input type="time" value={start} onChange={e => setStart(e.target.value)} /></label>
        <label className="t-s">To <input type="time" value={end} onChange={e => setEnd(e.target.value)} /></label>
        {end && start && end < start && <span className="t-s c2">Ends the following day.</span>}
      </div>}
      {window ? <StoredPulseWindow key={[bridge.owner, window.from, window.until, history.lastSyncAt, history.status].join("/")}
        bridge={bridge} {...window} overnight={mode === "overnight"} /> :
        <p className="t-s c2">Choose a date and two different times.</p>}
    </div>
  );
}

function RecoveryHistory({ bridge }) {
  const [history, setHistory] = useState(null);
  const [open, setOpen] = useState(false);
  useEffect(() => subscribeWhoopBluetooth({ onState: state => setHistory(state.history) }), [bridge]);
  if (!bridge.readHistory || !(history?.lastSyncAt || history?.records > 0)) return null;
  return (
    <section className="card" aria-label="Stored strap readings" style={{ ...stack, padding: 12 }}>
      <button className="row" type="button" onClick={() => setOpen(v => !v)} aria-expanded={open}>
        <span className="t-bs grow">Stored WHOOP readings</span><span className="t-s c2">{open ? "Close" : "View"}</span>
      </button>
      {open && <WhoopStoredReadings bridge={bridge} history={history} />}
    </section>
  );
}

export function WhoopRecoveryHistory() {
  const bridge = useWhoopBluetooth();
  return bridge ? <RecoveryHistory key={bridge.owner} bridge={bridge} /> : null;
}
