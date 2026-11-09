// src/EnergyIntelligence.jsx
// Adaptive TDEE block for Fuel → Plan. Shows the MEASURED expenditure
// (from your own intake-vs-trend ledger, adaptiveTDEE.js), lets you pick a
// goal rate, and computes advisory calorie/protein targets plus a weekly
// drift check. Advisory display only — updating the actual macro goals stays
// a deliberate act in Settings, not something this block does silently.

import { useMemo, useState } from "react";
import { useTheme } from "./theme";
import { computeAdaptiveTDEE, buildEnergyTargets, buildDriftCheck, readGoalRate, writeGoalRate, GOAL_RATES } from "./adaptiveTDEE";
import { MethodLine } from "./whitepaper";

export function EnergyIntelligence({ data, settings }) {
  const { C, S } = useTheme();
  const mono = C.fontFamily;
  const [goalRate, setGoalRate] = useState(() => readGoalRate());

  const tdee = useMemo(() => computeAdaptiveTDEE(data), [data]);
  const targets = tdee.ready && goalRate !== null ? buildEnergyTargets(tdee.tdee, goalRate, tdee.trendWeight) : null;
  const drift = tdee.ready && goalRate !== null ? buildDriftCheck(goalRate, tdee.actualWeeklyRate) : null;
  const currentGoal = parseFloat(settings?.goals?.calories);

  const pick = (rate) => { writeGoalRate(rate); setGoalRate(rate); };

  return (
    <div style={S.block}>
      <div style={S.blockHead}>
        <span style={S.blockTitle}>{"> "}Energy intelligence</span>
        {tdee.ready && <span style={S.blockStat}>{tdee.spanDays}D · {tdee.loggedDays} LOGGED · {tdee.confidence.toUpperCase()} CONF</span>}
      </div>

      {!tdee.ready ? (
        <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.6 }}>{tdee.note}</div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
            <span style={{ fontFamily: S.fontSerif, fontSize: 30, color: C.text, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{tdee.tdee.toLocaleString()}</span>
            <span style={{ fontSize: 11.5, color: C.textFaint, fontFamily: mono, letterSpacing: "0.06em", textTransform: "uppercase" }}>kcal/day measured TDEE</span>
          </div>
          <div style={{ marginBottom: 12 }}>
            <MethodLine
              testId="method-tdee"
              method={`From your own ledger: ${tdee.avgIntake.toLocaleString()} kcal avg intake, trend ${tdee.trendDeltaLbs > 0 ? "+" : ""}${tdee.trendDeltaLbs} lb over ${tdee.spanDays} days — not a formula estimate.`}
              detail={
                <>
                  Formula calculators (Mifflin, Katch) guess your burn from height and weight — often off by 300+ kcal. This number is <em>measured</em>: if you ate {tdee.avgIntake.toLocaleString()} kcal a day and your weight trend moved {tdee.trendDeltaLbs > 0 ? "up" : "down"} {Math.abs(tdee.trendDeltaLbs)} lb, arithmetic on the energy balance says your true burn is about {tdee.tdee.toLocaleString()}. It sharpens every week you log intake and weigh-ins, and it automatically absorbs what formulas can't see — your NEAT, your training, your metabolism.
                </>
              }
            />
          </div>

          <div style={{ fontSize: 10, letterSpacing: "0.15em", textTransform: "uppercase", color: C.textDim, fontFamily: mono, marginBottom: 6 }}>Goal</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {GOAL_RATES.map(g => (
              <button key={g.rate} type="button" onClick={() => pick(g.rate)}
                style={{ border: `1px solid ${goalRate === g.rate ? C.text : C.lineBright}`, background: goalRate === g.rate ? C.text : "none", color: goalRate === g.rate ? C.bg : C.textDim, fontSize: 10.5, fontFamily: mono, letterSpacing: "0.06em", padding: "8px 10px", cursor: "pointer", fontWeight: goalRate === g.rate ? 600 : 400 }}>
                {g.label}
              </button>
            ))}
          </div>

          {targets && (
            <div style={{ marginTop: 12 }}>
              <div style={S.ruledRow}><span style={S.ruledLabel}>Calorie target</span><span style={S.ruledValue}>{targets.calories.toLocaleString()} kcal/day</span></div>
              <div style={S.ruledRow}><span style={S.ruledLabel}>Protein anchor</span><span style={S.ruledValue}>{targets.protein} g · 1 g/lb trend weight</span></div>
              {Number.isFinite(currentGoal) && Math.abs(currentGoal - targets.calories) > 100 && (
                <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.55, marginTop: 8 }}>
                  Your Settings calorie goal is {currentGoal.toLocaleString()} — {Math.abs(currentGoal - targets.calories)} kcal {currentGoal > targets.calories ? "above" : "below"} this target. Update it in Settings if you're adopting the target.
                </div>
              )}
            </div>
          )}

          {drift && (
            <div style={{ marginTop: 10, padding: "9px 11px", border: `1px solid ${drift.onTrack ? C.line : C.text}` }}>
              <div style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: drift.onTrack ? C.textFaint : C.textDim, fontFamily: mono, marginBottom: 3 }}>
                {drift.onTrack ? "On track" : "Drift check"}
              </div>
              <div style={{ fontSize: 12, color: C.text, lineHeight: 1.5 }}>{drift.note}</div>
            </div>
          )}

          <div style={{ ...S.annotation, marginTop: 10, color: C.textFaint, lineHeight: 1.5 }}>
            measured from smoothed trend + logged intake · advisory only — this never changes your goals or logs
          </div>
        </>
      )}
    </div>
  );
}
