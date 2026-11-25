// src/EnergyIntelligence.jsx
// Adaptive TDEE block for Fuel → Plan. Shows the MEASURED expenditure
// (from your own intake-vs-trend ledger, adaptiveTDEE.js), lets you pick a
// goal rate, and computes advisory calorie/protein targets plus a weekly
// drift check. Advisory display only — updating the actual macro goals stays
// a deliberate act in Settings, not something this block does silently.

import { useMemo, useState } from "react";
import { Icon } from "./ui/ledger";
import { computeAdaptiveTDEE, buildEnergyTargets, buildDriftCheck, readGoalRate, writeGoalRate, GOAL_RATES } from "./adaptiveTDEE";

const NBSP = " ";

// How a figure was worked out: one line, with the longer account on request.
function Method({ testId, method, detail }) {
  const [open, setOpen] = useState(false);
  return (
    <div data-testid={testId} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <p className="t-s c2">{method}</p>
      <button type="button" className="btn btn-g btn-sm" aria-expanded={open} onClick={() => setOpen((value) => !value)} style={{ alignSelf: "flex-start", paddingLeft: 0 }}>{open ? "Hide how this is measured" : "How this is measured"}</button>
      {open && <p className="t-s">{detail}</p>}
    </div>
  );
}

export function EnergyIntelligence({ data, settings }) {
  const [goalRate, setGoalRate] = useState(() => readGoalRate());
  const tdee = useMemo(() => computeAdaptiveTDEE(data), [data]);
  const targets = tdee.ready && goalRate !== null ? buildEnergyTargets(tdee.tdee, goalRate, tdee.trendWeight) : null;
  const drift = tdee.ready && goalRate !== null ? buildDriftCheck(goalRate, tdee.actualWeeklyRate) : null;
  const currentGoal = parseFloat(settings?.goals?.calories);
  const pick = (rate) => { writeGoalRate(rate); setGoalRate(rate); };

  if (!tdee.ready) {
    return (
      <section aria-labelledby="energy-title" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h2 id="energy-title" className="t-h">What you burn</h2>
        <p className="t-b c2">{tdee.note}</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="energy-title" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 id="energy-title" className="t-h">What you burn</h2>
      <div className="kv" style={{ gap: 4 }}>
        <p><span className="n-lg">{tdee.tdee.toLocaleString()}</span> <span className="t-b c2">kcal a day, measured</span></p>
        <p className="t-s c2">{tdee.spanDays} days, {tdee.loggedDays} of them logged. Confidence: {tdee.confidence}.</p>
      </div>
      <Method
        testId="method-tdee"
        method={`From your own log: ${tdee.avgIntake.toLocaleString()} kcal average intake, weight trend ${tdee.trendDeltaLbs > 0 ? "+" : ""}${tdee.trendDeltaLbs}${NBSP}lb over ${tdee.spanDays} days. This is not a formula estimate.`}
        detail={
          <>
            Formula calculators (Mifflin, Katch) guess your burn from height and weight, and are often off by 300 kcal or more. This number is measured: if you ate {tdee.avgIntake.toLocaleString()} kcal a day and your weight trend moved {tdee.trendDeltaLbs > 0 ? "up" : "down"} {Math.abs(tdee.trendDeltaLbs)}{NBSP}lb, the energy balance puts your true burn at about {tdee.tdee.toLocaleString()}. It sharpens every week you log intake and weigh-ins, and it takes in what formulas cannot see: your daily movement, your training and your metabolism.
          </>
        }
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span id="energy-goal" className="lbl">Goal</span>
        <div className="chips" role="radiogroup" aria-labelledby="energy-goal">
          {GOAL_RATES.map((goal) => (
            <button key={goal.rate} type="button" className="chip" role="radio" aria-checked={goalRate === goal.rate} onClick={() => pick(goal.rate)}>{goal.label.replace("lb/wk", "lb a week")}</button>
          ))}
        </div>
      </div>

      {targets && (
        <ul className="rows">
          <li className="row"><span className="t-bs grow">Calorie target</span><span className="n">{targets.calories.toLocaleString()}{NBSP}kcal a day</span></li>
          <li className="row"><span className="kv grow"><span className="t-bs">Protein anchor</span><span className="t-s c2">1 g per lb of trend weight</span></span><span className="n">{targets.protein}{NBSP}g</span></li>
        </ul>
      )}
      {targets && Number.isFinite(currentGoal) && Math.abs(currentGoal - targets.calories) > 100 && (
        <p className="banner"><Icon name="info" size="s" /><span>Your calorie goal in Settings is {currentGoal.toLocaleString()}, which is {Math.abs(currentGoal - targets.calories)} kcal {currentGoal > targets.calories ? "above" : "below"} this target. Change it in Settings if you are adopting the target.</span></p>
      )}
      {drift && (
        <div className="banner" style={drift.onTrack ? undefined : { borderColor: "var(--ink)" }}>
          <Icon name={drift.onTrack ? "done" : "warn"} size="s" className={drift.onTrack ? "good" : "caution"} />
          <span><span className="t-ss">{drift.onTrack ? "On track." : "Drift check."}</span> {drift.note}</span>
        </div>
      )}
      <p className="t-s c2">Measured from your smoothed weight trend and logged intake. It is advice only and never changes your goals or your logs.</p>
    </section>
  );
}
