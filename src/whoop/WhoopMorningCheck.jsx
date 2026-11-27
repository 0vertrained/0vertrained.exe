import { useEffect, useId, useState } from "react";
import { dateKey } from "../coachWindows";
import { nativeKeepAwake } from "../native";
import { getWhoopBluetooth, subscribeWhoopBluetooth, useWhoopBluetooth } from "./bluetooth";
import {
  BASELINE_MORNINGS, MEASURE_MS, SETTLE_MS, measureMorningCheck,
  morningBaseline, readMorningChecks, saveMorningCheck,
} from "./morningCheck";

const cardStyle = { display: "grid", gap: 8, padding: 12 };
const duration = SETTLE_MS + MEASURE_MS;
const asDate = day => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

function Countdown({ seconds }) {
  return <span className="n" role="timer" aria-label="Time remaining">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</span>;
}

function MorningResults({ records }) {
  if (!records.length) return null;
  const latest = records[0];
  const baseline = morningBaseline(records, latest.day);
  const delta = (current, usual) => {
    const difference = Math.round((current - usual) * 10) / 10;
    return difference > 0 ? `+${difference}` : String(difference);
  };
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <p className="t-s"><strong>{asDate(latest.day)}</strong> · HRV {latest.rmssd} ms · Seated pulse {latest.pulse} bpm</p>
      {baseline.rmssd != null ? (
        <p className="t-ss c2">Compared with your median over {baseline.count} earlier mornings, HRV {delta(latest.rmssd, baseline.rmssd)} ms and pulse {delta(latest.pulse, baseline.pulse)} bpm.</p>
      ) : (
        <p className="t-ss c2">Building your baseline · {baseline.count} of {BASELINE_MORNINGS} prior mornings in the last 28 days.</p>
      )}
      {records.length > 1 && (
        <details>
          <summary className="t-ss">Recent morning checks</summary>
          <ul className="rows">
            {records.slice(0, 7).map(record => <li className="row t-s" key={record.day}><span className="grow">{asDate(record.day)}</span> {record.rmssd} ms · {record.pulse} bpm</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

function AthleteMorningCheck({ owner }) {
  const titleId = useId();
  const [connected, setConnected] = useState(false);
  const [paired, setPaired] = useState(false);
  const [startedAt, setStartedAt] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [receivingIntervals, setReceivingIntervals] = useState(false);
  const [records, setRecords] = useState(() => readMorningChecks(owner));
  const [unsaved, setUnsaved] = useState(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let ended = false;
    let timer;
    let lastIntervalAt = null;
    const samples = [];
    const measuring = startedAt != null;

    function cancel(reason) {
      if (!measuring || ended) return;
      ended = true;
      setMessage(reason);
      setStartedAt(null);
    }

    function tick() {
      if (ended || getWhoopBluetooth()?.owner !== owner) return;
      const sinceStart = Date.now() - startedAt;
      if (sinceStart < duration) {
        setElapsed(Math.max(0, sinceStart));
        setReceivingIntervals(lastIntervalAt != null && Date.now() - lastIntervalAt < 5_000);
        return;
      }
      ended = true;
      setStartedAt(null);
      const result = measureMorningCheck(samples, startedAt);
      if (result.error) { setMessage(result.error); return; }
      const next = saveMorningCheck(owner, result);
      if (next) {
        setRecords(next);
        setMessage(`Check saved on this iPhone · ${result.coverage}% signal coverage.`);
      } else {
        setUnsaved(result);
        setMessage("This iPhone couldn’t save the check. Keep this screen open and retry.");
      }
    }

    const unsubscribe = subscribeWhoopBluetooth({
      onState(state) {
        setConnected(state.status === "connected");
        setPaired(!!(state.savedDevice || state.device));
        if (state.status !== "connected") cancel("The strap disconnected. Reconnect and start a fresh check.");
      },
      onSample: measuring ? sample => {
        const now = Date.now();
        if (ended || sample.timestamp <= startedAt + SETTLE_MS || sample.timestamp > startedAt + duration ||
            sample.timestamp > now || now - sample.timestamp > 5_000) return;
        samples.push(sample);
        if (sample.rrMs?.length) lastIntervalAt = sample.timestamp;
      } : undefined,
      onError() {
        setConnected(false);
        cancel("Couldn’t read the strap connection. Reconnect and try again.");
      },
    });
    const onHidden = () => { if (document.hidden) cancel("The check was interrupted. Keep this screen open and try again."); };
    if (measuring) {
      nativeKeepAwake(true);
      timer = setInterval(tick, 500);
      document.addEventListener("visibilitychange", onHidden);
    }
    return () => {
      ended = true;
      clearInterval(timer);
      unsubscribe();
      if (measuring) {
        document.removeEventListener("visibilitychange", onHidden);
        nativeKeepAwake(false);
      }
    };
  }, [startedAt, owner]);

  function start() {
    setMessage("");
    setElapsed(0);
    setReceivingIntervals(false);
    setStartedAt(Date.now());
  }

  function retrySave() {
    if (getWhoopBluetooth()?.owner !== owner) return;
    const next = saveMorningCheck(owner, unsaved);
    if (!next) return;
    setRecords(next);
    setUnsaved(null);
    setMessage("Check saved on this iPhone.");
  }

  const active = startedAt != null;
  const settling = elapsed < SETTLE_MS;
  const repeated = records[0]?.day === dateKey(new Date());
  if (!connected && !paired && !active && !records.length && !unsaved && !message) return null;
  return (
    <section className="card" aria-labelledby={titleId} style={cardStyle}>
      <h2 className="t-h" id={titleId}>Morning HRV check</h2>
      {!active && <p className="t-s c2">Sit quietly at the same time after waking. Settle for one minute, then measure two minutes of beat intervals for HRV (RMSSD) and seated pulse.</p>}
      {active ? (
        <>
          <div className="sec">
            <span className="t-bs">{settling ? "Settling in" : "Measuring beats"}</span>
            <Countdown seconds={Math.ceil(((settling ? SETTLE_MS : duration) - elapsed) / 1_000)} />
          </div>
          <p className="t-s c2">{settling ? "Rest your wrist and breathe normally. Recording starts automatically." :
            receivingIntervals ? "Beat intervals received. Stay seated until the check finishes." : "Waiting for beat intervals. Keep your strap snug."}</p>
          <button type="button" className="btn btn-s btn-sm" onClick={() => { setStartedAt(null); setMessage("Check cancelled."); }}>Cancel check</button>
        </>
      ) : unsaved ? (
        <>
          <p className="t-s">Unsaved reading · HRV {unsaved.rmssd} ms · Seated pulse {unsaved.pulse} bpm</p>
          <button type="button" className="btn btn-s btn-sm" onClick={retrySave}>Retry saving check</button>
        </>
      ) : (
        <>
          <button type="button" className="btn btn-s btn-sm" disabled={!connected} onClick={start}>Start 3-minute check</button>
          {connected && repeated && <p className="t-ss c2">A completed repeat replaces today’s reading.</p>}
          {!connected && <p className="t-ss c2">Connect your strap in Integrations to begin.</p>}
        </>
      )}
      {message && <p role="status" className="t-s">{message}</p>}
      {!active && <MorningResults records={records} />}
    </section>
  );
}

export function WhoopMorningCheck() {
  const bridge = useWhoopBluetooth();
  return bridge?.owner ? <AthleteMorningCheck key={bridge.owner} owner={bridge.owner} /> : null;
}
