// src/sections/AppleHealthCard.jsx
// Settings › Integrations, in iPhone app builds that read Apple Health's
// daily numbers. Turning it on asks iOS once to read them;
// src/health/useHealthDaily.js does the filling while it's on.

import { useState } from "react";
import { nativePlugin } from "../native";
import { readHealthDailyOn, writeHealthDailyOn } from "../health/healthDailyState";

const column = { display: "flex", flexDirection: "column", gap: 8 };

export function AppleHealthCard({ wearables = false }) {
  const [on, setOn] = useState(() => readHealthDailyOn());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const turnOn = async () => {
    setBusy(true);
    setMessage("");
    try {
      const result = await nativePlugin("OTHealth")?.enable?.();
      if (result?.available === false) {
        setMessage("Apple Health isn’t available on this iPhone.");
        return;
      }
      writeHealthDailyOn(true);
      setOn(true);
      setMessage("Today’s numbers will fill in on Today in a moment.");
    } catch {
      setMessage("Couldn’t turn this on. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const turnOff = () => {
    writeHealthDailyOn(false);
    setOn(false);
    setMessage("Numbers already filled in stay in your log.");
  };

  return (
    <section className="card" aria-labelledby="int-apple-health" style={{ ...column, padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <h2 id="int-apple-health" className="t-h grow">Apple Health</h2>
        {!on && (
          <button type="button" className="btn btn-p btn-sm" aria-disabled={busy || undefined} onClick={() => !busy && turnOn()}>
            {busy ? "Turning on…" : "Turn on"}
          </button>
        )}
        {on && <button type="button" className="btn btn-g btn-sm" onClick={turnOff}>Turn off</button>}
      </div>
      <p className={on ? "t-ss good" : "t-ss c2"}>{on ? "On · fills in your daily numbers" : "Off"}</p>
      <p className="t-s c2">
        {wearables
          ? "Fills in steps and weight from Apple Health. Sleep, resting heart rate and HRV keep coming from Oura or Whoop."
          : "Fills in steps, weight, sleep, resting heart rate and HRV from Apple Health."}
        {" "}Only empty fields are filled, and anything you type stays as you typed it. Turning it on asks to read these from Apple Health.
      </p>
      {message && <p className="t-s" role="status">{message}</p>}
    </section>
  );
}

export default AppleHealthCard;
