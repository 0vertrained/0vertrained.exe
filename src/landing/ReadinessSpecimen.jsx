// src/landing/ReadinessSpecimen.jsx
// The call card as the public pages show it. It runs the app's own engines:
// the readiness index turns a recovery score and a training-load ratio into a
// band, Today's engine turns the band into the call, and the call is named
// the way the app names it. Every call shown is one the app would make for a
// planned training day with nothing else logged.
import { useState } from "react";
import { computeReadinessIndex } from "../decisionEngine";
import { READINESS_CUTS } from "../intelligenceConfig";
import { buildTodayDecision } from "../todayDecision";
import { describeTodayCall } from "../recovery/verdictResolver";
import { Meter } from "../ui/ledger";

// A planned training day, so a high score can be a push. On a programmed rest
// day the app keeps the rest day whatever the score.
const TRAINING_DAY = { name: "Planned session", lifting: [{ name: "Squat" }] };

export function bandFor(index) {
  if (index >= READINESS_CUTS.push) return "push";
  if (index >= READINESS_CUTS.normal) return "normal";
  if (index >= READINESS_CUTS.moderate) return "moderate";
  if (index >= READINESS_CUTS.pull_back) return "pull_back";
  return "rest";
}

// { call, level, stamp, headline } for a recovery score and a load ratio.
export function callFor(recovery, loadRatio) {
  const readiness = computeReadinessIndex(recovery, { ratio: loadRatio }, null);
  const decision = buildTodayDecision({
    recommendation: { readiness: bandFor(readiness ? readiness.index : 0) },
    recovery: { score: recovery },
    trainingLoad: { ratio: loadRatio },
    todayProgram: TRAINING_DAY,
  });
  return describeTodayCall(decision.call);
}

// The card: effort meter, the call, the recovery score and the call's line,
// laid out like Today's call card.
export function CallSpecimen({ recovery, loadRatio, note = null, caption = null }) {
  const call = callFor(recovery, loadRatio);
  return (
    <figure className="card" style={{ display: "flex", flexDirection: "column", gap: 8, margin: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Meter level={call.level} label={`Effort level ${call.level} of 5`} />
        <span className="grow" style={{ display: "flex" }}><span className="stamp">{call.stamp}</span></span>
        <span style={{ display: "flex", alignItems: "baseline", gap: 2 }}>
          <span className="sr">Recovery score </span>
          <span className="n-md">{recovery}</span>
          <span className="t-s c2"><span aria-hidden="true">/100</span><span className="sr"> of 100</span></span>
        </span>
      </div>
      <p className="t-hl">{call.headline}</p>
      {note && <p className="t-s c2">{note}</p>}
      {caption && <figcaption className="t-s c2">{caption}</figcaption>}
    </figure>
  );
}

// Four sample mornings, one for each call the engine reaches on a training
// day. A button steps between them; nothing changes on its own.
export const SAMPLE_MORNINGS = [
  { recovery: 82, loadRatio: 1.05, note: "Recovery is high and training load is steady." },
  { recovery: 72, loadRatio: 1.2, note: "Recovery is good. Load is climbing but still in range." },
  { recovery: 58, loadRatio: 1.45, note: "Training has run well ahead of recovery this week." },
  { recovery: 45, loadRatio: 1.1, note: "Recovery is low, even though training load is normal." },
];

export function SampleMornings() {
  const [step, setStep] = useState(0);
  const [stepped, setStepped] = useState(false);
  const morning = SAMPLE_MORNINGS[step];
  const call = callFor(morning.recovery, morning.loadRatio);
  const label = `Sample morning ${step + 1} of ${SAMPLE_MORNINGS.length}`;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <CallSpecimen
        recovery={morning.recovery}
        loadRatio={morning.loadRatio}
        note={morning.note}
        caption={`${label}: recovery ${morning.recovery} of 100, training load ratio ${morning.loadRatio.toFixed(2)}.`}
      />
      <button type="button" className="btn btn-s" style={{ alignSelf: "flex-start" }} onClick={() => { setStep((value) => (value + 1) % SAMPLE_MORNINGS.length); setStepped(true); }}>
        Show another morning
      </button>
      <p className="sr" aria-live="polite">{stepped ? `${label}. ${call.stamp}. ${call.headline}` : ""}</p>
    </div>
  );
}
