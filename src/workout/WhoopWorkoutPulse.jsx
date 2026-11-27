import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { subscribeWhoopBluetooth } from "../whoop/bluetooth";

const FRESH_MS = 12_000;
const CHECKPOINT_MS = 30_000;

function freshSample(sample, now) {
  return Number.isInteger(sample?.bpm) && sample.bpm > 0 && sample.bpm <= 300 &&
    Number.isFinite(sample.timestamp) && sample.timestamp <= now && now - sample.timestamp < FRESH_MS;
}

export const WhoopWorkoutPulse = forwardRef(function WhoopWorkoutPulse({ saved, onSave }, ref) {
  const [connected, setConnected] = useState(false);
  const [live, setLive] = useState(null);
  const [recording, setRecording] = useState(false);
  const capture = useRef(null);
  const write = useRef(onSave);
  useLayoutEffect(() => { write.current = onSave; }, [onSave]);

  function flush() {
    const run = capture.current;
    if (!run?.dirty) return;
    run.dirty = false;
    run.lastWrite = Date.now();
    write.current(run.summary);
  }
  useImperativeHandle(ref, () => ({ flush }), []);

  useEffect(() => {
    let timer;
    let lastShown = 0;
    function display(sample) {
      if (!freshSample(sample, Date.now()) || sample.timestamp <= lastShown) return;
      lastShown = sample.timestamp;
      clearTimeout(timer);
      setLive(sample);
      timer = setTimeout(() => setLive(null), Math.max(0, FRESH_MS - (Date.now() - sample.timestamp)));
    }
    function receive(sample) {
      if (!freshSample(sample, Date.now())) return;
      display(sample);
      const run = capture.current;
      if (!run || sample.timestamp < run.startedAt || sample.timestamp <= (run.summary?.lastSampleAt || 0)) return;
      const old = run.summary;
      run.summary = {
        count: (old?.count || 0) + 1,
        bpmTotal: (old?.bpmTotal || 0) + sample.bpm,
        peakBpm: Math.max(old?.peakBpm || 0, sample.bpm),
        lastSampleAt: sample.timestamp,
      };
      run.dirty = true;
      if (Date.now() - run.lastWrite >= CHECKPOINT_MS) flush();
    }
    const unsubscribe = subscribeWhoopBluetooth({
      onSample: receive,
      onState(state) {
        const active = state.status === "connected";
        setConnected(active);
        if (active) display(state.lastSample);
        else { clearTimeout(timer); lastShown = 0; setLive(null); }
      },
      onError() { setConnected(false); setLive(null); },
    });
    const checkpoint = () => { if (document.hidden) flush(); };
    document.addEventListener("visibilitychange", checkpoint);
    return () => {
      clearTimeout(timer);
      unsubscribe();
      document.removeEventListener("visibilitychange", checkpoint);
    };
  }, []);

  function toggle() {
    if (capture.current) {
      flush();
      capture.current = null;
      setRecording(false);
    } else {
      capture.current = { summary: saved || null, startedAt: Date.now(), lastWrite: 0, dirty: false };
      setRecording(true);
    }
  }

  if (!connected && !recording) return null;
  return (
    <section className="kv" aria-label="WHOOP workout heart rate" style={{ gap: 4, padding: "8px 16px" }}>
      <div className="sec">
        <span className="t-s"><strong>WHOOP</strong> · {live ? <span className="n">{live.bpm} bpm</span> : "Waiting for heart rate"}</span>
        <button type="button" className="btn btn-s btn-sm" aria-pressed={recording} onClick={toggle}>{recording ? "Stop recording HR" : "Record HR"}</button>
      </div>
      <p className="t-s c2">{recording
        ? "Recording readings received while this workout is open."
        : "Record to save average and peak heart rate with this workout."}</p>
    </section>
  );
});
