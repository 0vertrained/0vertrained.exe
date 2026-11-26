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

  const unsupported = status?.supported === false;

  const turnOn = async () => {
    setBusy(true);
    setMessage("");
    try {
      const next = await nativePlugin("OTRuns")?.enable?.();
      setStatus(next || null);
      if (next?.scheduling === "authorized") {
        writeWatchRunsOn(true);
        setOn(true);
        setMessage("This week’s runs are on their way to the Workout app.");
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
    setMessage("Your runs are off the watch.");
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
        : on ? <p className="t-ss good">On · runs go to the Workout app</p>
        : <p className="t-ss c2">Off</p>}
      <p className="t-s c2">
        Puts the next 7 days of planned runs, with their pace targets, in the Workout app on your watch, and fills in the log from runs you record on the watch. Turning it on asks to add workouts to your watch and to read runs from Apple Health.
      </p>
      {message && <p className="t-s" role="status">{message}</p>}
    </section>
  );
}

export default AppleWatchCard;
