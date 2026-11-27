// src/sections/AppleHealthCard.jsx
// Settings › Integrations, in iPhone app builds that read Apple Health's
// daily numbers. Turning it on asks iOS once to read them;
// src/health/useHealthDaily.js does the filling while it's on. In builds
// that can also save to Health, a switch below turns saving on
// (src/health/useHealthWrite.js does the saving).

import { useState } from "react";
import { nativePlugin } from "../native";
import { readHealthDailyOn, writeHealthDailyOn } from "../health/healthDailyState";
import { readHealthWriteOn, writeHealthWriteOn } from "../health/healthWrite";
import { Switch } from "../ui/ledger";

const DENIED_WORDS = { weight: "weight", food: "food", workouts: "workouts" };

// Saving to Apple Health: your typed weight, each day's food totals, and
// lifts with your effort rating.
function SaveToHealth({ owner }) {
  const [on, setOn] = useState(() => readHealthWriteOn(owner));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const toggle = async () => {
    if (busy) return;
    setMessage("");
    if (on) {
      writeHealthWriteOn(false, owner);
      setOn(false);
      setMessage("What’s already in Apple Health stays there.");
      return;
    }
    setBusy(true);
    try {
      const status = await nativePlugin("OTHealthWrite")?.enable?.();
      if (status?.available === false) {
        setMessage("Apple Health isn’t available on this iPhone.");
        return;
      }
      const denied = Object.keys(DENIED_WORDS).filter((key) => status?.[key] === "denied").map((key) => DENIED_WORDS[key]);
      writeHealthWriteOn(true, owner);
      setOn(true);
      setMessage(denied.length
        ? `Apple Health didn’t allow saving ${denied.join(" and ")}. Allow it in the Health app under Sharing, Apps, 0VERTRAINED.`
        : "Today’s numbers go to Apple Health in a moment.");
    } catch {
      setMessage("Couldn’t turn this on. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, borderTop: "1px solid var(--line)", paddingTop: 8 }}>
      <div className="row" style={{ alignItems: "flex-start" }}>
        <span className="kv grow">
          <span id="health-save" className="t-bs">Save to Apple Health</span>
          <span className="t-s c2">The weight you type, each day’s food totals, and lifts you finish on this iPhone, with how hard they were. Lifts tracked on your watch are saved by the watch; they get your rating.</span>
        </span>
        <Switch checked={on} onChange={toggle} labelledBy="health-save" disabled={busy} />
      </div>
      {message && <p className="t-s" role="status">{message}</p>}
    </div>
  );
}

const column = { display: "flex", flexDirection: "column", gap: 8 };

export function AppleHealthCard({ owner, wearables = false }) {
  const [on, setOn] = useState(() => readHealthDailyOn(owner));
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
      writeHealthDailyOn(true, owner);
      setOn(true);
      setMessage("Today’s numbers will fill in on Today in a moment.");
    } catch {
      setMessage("Couldn’t turn this on. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const turnOff = () => {
    writeHealthDailyOn(false, owner);
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
      {nativePlugin("OTHealthWrite") && <SaveToHealth owner={owner} />}
    </section>
  );
}

export default AppleHealthCard;
