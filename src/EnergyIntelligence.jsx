// src/EnergyIntelligence.jsx
// Adaptive TDEE block for Fuel → Plan. Shows estimated expenditure
// (from your own intake-vs-trend ledger, adaptiveTDEE.js), lets you pick a
// goal rate, and computes advisory calorie/protein targets plus a weekly
// drift check. Advisory display only — updating the actual macro goals stays
// a deliberate act in Settings, not something this block does silently.

import { useMemo, useState } from "react";
import { Icon, Method } from "./ui/ledger";
import { computeAdaptiveTDEE, buildEnergyTargets, buildDriftCheck, readGoalRate, writeGoalRate, GOAL_RATES } from "./adaptiveTDEE";
import { getTodayKey } from "./constants";

const NBSP = " ";

export function EnergyIntelligence({ data, settings }) {
  const [goalRate, setGoalRate] = useState(() => readGoalRate());
  const today = getTodayKey();
  const tdee = useMemo(() => computeAdaptiveTDEE(data, { asOf: today }), [data, today]);
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
        <p><span className="n-lg">{tdee.tdee.toLocaleString()}</span> <span className="t-b c2">kcal a day, estimated</span></p>
        <p className="t-s c2">{tdee.loggedDays} of {tdee.coverageDays} food logs confirmed ({tdee.density}% coverage).</p>
      </div>
      <Method
        testId="method-tdee"
        method={`Your confirmed food logs averaged ${tdee.avgIntake.toLocaleString()} kcal a day. Your smoothed weight changed by ${tdee.trendDeltaLbs > 0 ? "+" : ""}${tdee.trendDeltaLbs}${NBSP}lb over ${tdee.spanDays} days.`}
        detail={
          <>
            The estimate adjusts your average intake for the change between your first and last smoothed weigh-ins. It assumes the confirmed days represent your usual intake. Differences on other days and changes in water weight can affect the result.
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
    </section>
  );
}
