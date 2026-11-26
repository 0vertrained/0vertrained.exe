// src/DemoPage.jsx
// The public demo at #/demo: move recovery and training load and see the call
// the app would make. It runs the app's own engines (see
// landing/ReadinessSpecimen.jsx), on a planned training day with nothing else
// logged. Reached from the home page, from Sign in, and from Settings, under
// About, where a signed-in athlete can share it.
import { useState } from "react";
import { TopBar } from "./ui/ledger";
import { CallSpecimen, callFor } from "./landing/ReadinessSpecimen";
import { PRIVACY_HREF, PublicFooter } from "./landing/PublicFooter";

const recoverySentence = (value) => (value >= 70 ? "Recovery is strong." : value >= 55 ? "Recovery is middling." : value >= 40 ? "Recovery is low." : "Recovery is very low.");
const loadSentence = (ratio) => (ratio <= 1.1 ? "Training load is steady." : ratio <= 1.3 ? "Load is climbing but still in range." : ratio <= 1.5 ? "Load is well above your usual." : "Load is far above your usual.");

// How the call is made, in order. The numbers are the engine's
// (READINESS_INDEX and READINESS_CUTS in intelligenceConfig.js).
const HOW = [
  "Recovery sets how much room there is for hard work: none at 35 or below, all of it at 85 or above.",
  "Training load can only take room away. Above a ratio of 1.1 it starts to; at 1.6 and above, 40% of the room is left.",
  "The room left picks the call: Push, Train, Easy or Recover. On a planned rest day, the rest day stands.",
  "In the app, a sore or ill check-in, or two wearables that disagree, can only make the call more cautious.",
];

const HYBRID = [
  ["Strength", "Push, pull, legs and arms splits, double progression, and two sessions a day when you want them."],
  ["Race plan", "Set a 5K, 10K or half marathon and the weeks to race day build around your lifting."],
  ["Running", "Easy volume is protected and hard days are earned."],
  ["Recovery", "Deloads come when your training load calls for one, not on a fixed fourth week."],
  ["Fuel", "Daily calories and protein scaled to your bodyweight, and a supplement checklist."],
];

function Slider({ id, label, value, min, max, step, display, hint, onChange }) {
  return (
    <div className="field">
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <label className="lbl grow" htmlFor={id}>{label}</label>
        <span className="n" aria-hidden="true">{display}</span>
      </div>
      <input id={id} className="range" type="range" min={min} max={max} step={step} value={value} aria-valuetext={display} aria-describedby={`${id}-hint`} onChange={(event) => onChange(Number(event.target.value))} />
      <span id={`${id}-hint`} className="hint">{hint}</span>
    </div>
  );
}

export default function DemoPage({ onClose, signedIn = false }) {
  const [recovery, setRecovery] = useState(76);
  const [loadRatio, setLoadRatio] = useState(1.05);
  const call = callFor(recovery, loadRatio);

  return (
    <div className="ot" data-screen="demo">
      <div className="shell">
        <TopBar title="Demo" close="Close" onClose={onClose} />
        <main className="main" style={{ gap: 40, paddingTop: 16, paddingBottom: 40 }}>
          <section aria-labelledby="demo-title" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <h2 id="demo-title" className="t-xl">Move the inputs. Watch the call.</h2>
            <p className="t-read">Each morning 0VERTRAINED weighs how recovered you are against how hard you have been training, and makes one call. This is the engine the app runs.</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))", gap: 24, alignItems: "start" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                <Slider
                  id="demo-rec"
                  label="Recovery"
                  value={recovery}
                  min={10}
                  max={100}
                  step={1}
                  display={`${recovery} of 100`}
                  hint="From your morning check-in, or from HRV, resting heart rate and sleep if Oura or Whoop is connected."
                  onChange={setRecovery}
                />
                <Slider
                  id="demo-load"
                  label="Training load ratio"
                  value={loadRatio}
                  min={0.6}
                  max={1.8}
                  step={0.01}
                  display={loadRatio.toFixed(2)}
                  hint="Your last week of training against your last four. Up to 1.1 is steady."
                  onChange={setLoadRatio}
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <CallSpecimen recovery={recovery} loadRatio={loadRatio} note={`${recoverySentence(recovery)} ${loadSentence(loadRatio)}`} caption="A planned training day with nothing else logged." />
                <p className="sr" aria-live="polite">{`${call.stamp}. ${call.headline}`}</p>
              </div>
            </div>
          </section>

          <section aria-labelledby="demo-how" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <h2 id="demo-how" className="t-title">How the call is made</h2>
            <ol className="rows" style={{ margin: 0, padding: 0, listStyle: "none", }}>
              {HOW.map((line, index) => (
                <li key={line} style={{ display: "flex", gap: 12, padding: "4px 0" }}>
                  <span className="n c2" style={{ flex: "none", width: "2ch" }}>{index + 1}</span>
                  <span className="t-b">{line}</span>
                </li>
              ))}
            </ol>
          </section>

          <section aria-labelledby="demo-hybrid" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <h2 id="demo-hybrid" className="t-title">Built for people who lift and run</h2>
            <dl className="rows" style={{ margin: 0 }}>
              {HYBRID.map(([name, text]) => (
                <div key={name} className="kv" style={{ padding: "4px 0" }}>
                  <dt className="t-bs">{name}</dt>
                  <dd className="t-b c2" style={{ margin: 0 }}>{text}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section aria-labelledby="demo-private" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <h2 id="demo-private" className="t-title">Your log is yours</h2>
            <p className="t-b">No ads, and your data is never sold. Oura and Whoop are optional, and their tokens stay on the server. The coach reads a short summary of your training and recovery, not your wearable tokens or your full log. <a className="u" href={PRIVACY_HREF}>Read the privacy policy</a>.</p>
          </section>

          {!signedIn && (
            <section aria-labelledby="demo-start" className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <h2 id="demo-start" className="t-title">Try it with your own training</h2>
              <p className="t-b c2">No email needed. Places in the beta are limited.</p>
              <a className="btn btn-p btn-b" href="#signup">Create an account</a>
              <a className="btn btn-s btn-b" href="#signin">Sign in</a>
            </section>
          )}
        </main>
        <PublicFooter />
      </div>
    </div>
  );
}
