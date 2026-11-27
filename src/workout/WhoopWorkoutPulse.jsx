import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { subscribeWhoopBluetooth } from "../whoop/bluetooth";
import { WhoopReadingStatus } from "../whoop/WhoopReadingStatus";
import { WorkoutPulseTimeline } from "./WorkoutPulseTimeline";
import { extendPulse, PULSE_GAP_MS } from "./pulseTimeline";

const CHECKPOINT_MS = 30_000;

function freshSample(sample, now) {
  return Number.isInteger(sample?.bpm) && sample.bpm > 0 && sample.bpm <= 300 &&
    Number.isFinite(sample.timestamp) && sample.timestamp <= now && now - sample.timestamp < PULSE_GAP_MS;
}

export const WhoopWorkoutPulse = forwardRef(function WhoopWorkoutPulse({ saved, onSave, workout, data, dateKey }, ref) {
  const [status, setStatus] = useState(null);
  const [live, setLive] = useState(null);
  const [lastReadingAt, setLastReadingAt] = useState(null);
  const [recording, setRecording] = useState(false);
  const capture = useRef(null);
  const write = useRef(onSave);
  const checkpointed = useRef(saved || null);
  useLayoutEffect(() => { write.current = onSave; }, [onSave]);
  useLayoutEffect(() => { checkpointed.current = saved || null; }, [saved]);

  function extendRest(run, now) {
    if (run.restAt == null) return;
    const trace = run.summary.trace;
    const sets = [...trace.sets];
    const marker = sets.at(-1);
    if (!marker) return;
    sets[sets.length - 1] = { ...marker, restMs: Math.max(0, now - run.restAt) };
    run.summary = { ...run.summary, trace: { ...trace, sets } };
  }

  function flush(end = false) {
    const run = capture.current;
    if (!run?.hasSamples) return;
    const now = Date.now();
    if (end && now > run.summary.trace.endedAt) {
      run.summary = { ...run.summary, trace: { ...run.summary.trace, endedAt: now } };
      run.dirty = true;
    }
    if (!run.dirty) return;
    extendRest(run, now);
    run.dirty = false;
    run.lastWrite = now;
    checkpointed.current = run.summary;
    write.current(run.summary);
  }

  function endRest() {
    const run = capture.current;
    if (run?.restAt == null) return;
    extendRest(run, Date.now());
    run.restAt = null;
    run.dirty = true;
    flush();
  }

  useImperativeHandle(ref, () => ({
    flush: () => flush(true),
    endRest,
    logSet({ name, index, completedAt, mode }) {
      const run = capture.current;
      if (!run) return;
      endRest();
      const trace = run.summary.trace;
      const marker = { name, index, offset: Date.parse(completedAt) - trace.startedAt, mode };
      run.summary = { ...run.summary, trace: { ...trace, sets: [...trace.sets, marker] } };
      run.dirty = true;
    },
    startRest(completedAt) {
      const run = capture.current;
      if (run?.summary.trace.sets.length) run.restAt = Date.parse(completedAt);
    },
  }), []);

  useEffect(() => {
    let timer;
    let lastShown = 0;
    let deviceId = null;
    function display(sample) {
      if (!freshSample(sample, Date.now()) || sample.timestamp <= lastShown) return;
      lastShown = sample.timestamp;
      clearTimeout(timer);
      setLive(sample);
      setLastReadingAt(sample.timestamp);
      timer = setTimeout(() => setLive(null), Math.max(0, PULSE_GAP_MS - (Date.now() - sample.timestamp)));
    }
    function receive(sample) {
      if (!freshSample(sample, Date.now())) return;
      display(sample);
      const run = capture.current;
      if (!run || sample.timestamp < run.startedAt || sample.timestamp <= (run.summary.lastSampleAt || 0)) return;
      run.summary = extendPulse(run.summary, sample, run.startedAt, run.newSegment);
      run.newSegment = false;
      run.hasSamples = true;
      run.dirty = true;
      if (Date.now() - run.lastWrite >= CHECKPOINT_MS) flush();
    }
    function disconnected() {
      clearTimeout(timer);
      lastShown = 0;
      setLive(null);
      if (capture.current) {
        capture.current.newSegment = true;
        flush();
      }
    }
    const unsubscribe = subscribeWhoopBluetooth({
      onSample: receive,
      onState(next) {
        const id = next.device?.id ?? next.savedDevice?.id ?? null;
        if (id !== deviceId) {
          deviceId = id;
          setLastReadingAt(null);
          disconnected();
        }
        setStatus(next);
        if (next.status === "connected") display(next.lastSample);
        else disconnected();
      },
      onError() { setStatus(null); disconnected(); },
    });
    function leaving() {
      if (capture.current) capture.current.newSegment = true;
      flush(true);
    }
    const checkpoint = () => { if (document.hidden) leaving(); };
    document.addEventListener("visibilitychange", checkpoint);
    window.addEventListener("pagehide", leaving);
    return () => {
      clearTimeout(timer);
      unsubscribe();
      window.removeEventListener("pagehide", leaving);
      document.removeEventListener("visibilitychange", checkpoint);
    };
  }, []);

  function toggle() {
    if (capture.current) {
      flush(true);
      capture.current = null;
      setRecording(false);
    } else {
      const existing = checkpointed.current;
      const startedAt = Date.now();
      const trace = existing?.trace || { startedAt, endedAt: startedAt, segments: [], sets: [] };
      capture.current = { summary: { ...existing, trace }, startedAt, lastWrite: 0, newSegment: true, hasSamples: false, dirty: false, restAt: null };
      setRecording(true);
    }
  }

  const connected = status?.status === "connected";
  if (!connected && !status?.savedDevice && !recording) return null;
  return (
    <section className="kv" aria-label="WHOOP workout heart rate" style={{ gap: 4, padding: "8px 16px" }}>
      <div className="sec">
        <span className="t-s"><strong>WHOOP</strong> · {live ? <span className="n">{live.bpm} bpm</span> : connected ? "Waiting for heart rate" : "Strap disconnected"}</span>
        <button type="button" className="btn btn-s btn-sm" aria-pressed={recording} disabled={!connected && !recording} onClick={toggle}>{recording ? "Stop recording HR" : "Record HR"}</button>
      </div>
      <WhoopReadingStatus batteryPercent={status?.batteryPercent} batteryAt={status?.batteryAt} lastReadingAt={Math.max(lastReadingAt || 0, status?.lastReadingAt || 0, status?.lastSample?.timestamp || 0) || null} />
      <p className="t-s c2">{recording
        ? connected ? "Recording your heart-rate timeline." : "Recording paused until the strap reconnects."
        : connected ? "Save a heart-rate timeline with this workout." : "Reconnect your strap in Settings to record."}</p>
      {saved?.trace?.segments?.length > 0 && <details>
        <summary className="t-s">Workout timeline</summary>
        <WorkoutPulseTimeline summary={saved} workout={workout} data={data} dateKey={dateKey} />
      </details>}
    </section>
  );
});
