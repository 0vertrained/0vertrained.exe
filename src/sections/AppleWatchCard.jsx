// src/sections/AppleWatchCard.jsx
// Settings › Integrations, in the iPhone app only: runs on the Apple Watch.
// Turning it on asks iOS twice, once to add workouts to the Workout app and
// once to read runs from Apple Health. src/watch/useWatchRuns.js does the
// work while it's on.

import { useEffect, useState } from "react";
import { nativePlugin } from "../native";
import { readWatchRunsOn, writeWatchRunsOn } from "../watch/watchRunsState";

const column = { display: "flex", flexDirection: "column", gap: 8 };

const BLOCKED = {
  denied: "0VERTRAINED isn’t allowed to add workouts to your watch. Change that in the iPhone’s Settings app, then turn this on again.",
  restricted: "This iPhone doesn’t allow apps to add workouts to the watch.",
};

export function AppleWatchCard() {
  const [on, setOn] = useState(() => readWatchRunsOn());
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.resolve(nativePlugin("OTRuns")?.status?.())
      .then((next) => { if (!cancelled) setStatus(next || null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const unsupported = status?.supported === false && !status?.health;

  const turnOn = async () => {
    setBusy(true);
    setMessage("");
    try {
      const next = await nativePlugin("OTRuns")?.enable?.();
      setStatus(next || null);
      if (next?.scheduling === "authorized" || (next?.supported === false && next?.health)) {
        writeWatchRunsOn(true);
        setOn(true);
        setMessage(next.scheduling === "authorized" ? "This week’s supported cardio sessions are on their way to the Workout app." : "Apple Health workout import is on.");
      } else {
        setMessage(BLOCKED[next?.scheduling] || "Couldn’t turn this on. Try again.");
      }
    } catch {
      setMessage("Couldn’t turn this on. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    writeWatchRunsOn(false);
    setOn(false);
    setMessage("Workout scheduling and Health import are off.");
    try { await nativePlugin("OTRuns")?.clear?.(); } catch { /* removed next time it's turned off */ }
  };

  return (
    <section className="card" aria-labelledby="int-apple-watch" style={{ ...column, padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <h2 id="int-apple-watch" className="t-h grow">Apple Watch</h2>
        {!on && !unsupported && (
          <button type="button" className="btn btn-p btn-sm" aria-disabled={busy || undefined} onClick={() => !busy && turnOn()}>
            {busy ? "Turning on…" : "Turn on"}
          </button>
        )}
        {on && <button type="button" className="btn btn-g btn-sm" onClick={turnOff}>Turn off</button>}
      </div>
      {unsupported ? <p className="t-ss c2">Not available on this iPhone</p>
        : on ? <p className="t-ss good">On · Apple Health workout import</p>
        : <p className="t-ss c2">Off</p>}
      <p className="t-s c2">
        Schedules compatible cardio sessions in Apple Workout and imports each recorded workout from Apple Health. Your 0VERTRAINED Watch app also guides timed machine workouts, including the stair stepper.
      </p>
      <details className="t-s">
        <summary>Training from your Watch</summary>
        <p>Open 0VERTRAINED on your iPhone once to send the week to your Watch. During a lift, open Workout options to swap an exercise before its first set, pair it with the next exercise, or undo your last Watch set. “Saved on Watch” means the edits are waiting for your iPhone.</p>
        <p>Open a supported lift and tap Count reps · beta. Try a goblet squat, bench press, overhead press, curl, triceps pushdown, or lateral raise. Hold the starting position shown for the lift and begin on the wrist tap. For alternating curls, review the reps performed by your watch arm.</p>
        <p>Finish counting, check the number with the Crown, then tap Use reps and Log set. With Learn from my sets enabled, repeated corrections can tune future counts for that lift on this Watch. Undo last Watch set removes its feedback. Reset this lift clears its calibration.</p>
      </details>
      {message && <p className="t-s" role="status">{message}</p>}
    </section>
  );
}

export default AppleWatchCard;
