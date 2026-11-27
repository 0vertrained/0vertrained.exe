// src/WeeklyCoachingReview.jsx
// The weekly review on Progress: one recommendation, the likely limiter, the
// week in numbers, and why. It reads the weekly coach review and the week's
// totals, with an optional response and a seven-day follow-up.

import { useState } from "react";
import { weeklyRecommendationIntent, WEEKLY_ENDPOINT } from "./coachingCalibration";
import { Icon } from "./ui/ledger";
import { shortDate } from "./sections/charts";

const NBSP = "\u00a0";
const sentence = (text) => (text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : "");
const signed = (value) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value)}`;
const STRENGTH = { stable: "Stable", watch: "Watch", action: "Needs action" };
const AUTHORITY = { calibrated: "Calibrated", suggest: "Suggesting", observe: "Observing" };

// The coach review counts a day as on target with some room either side.
export const ON_TARGET_NOTE = "On target means protein at 90% of your goal or more, and calories within 10% of it.";

export function weekInNumbers(review, week) {
  const { trend, adherence, metrics } = review;
  return [
    ["Week score", `${week.weekScore} of 100`],
    ["Weight", trend.weightDelta == null ? "Not enough weigh-ins yet" : `${signed(trend.weightDelta)}${NBSP}lb on last week · ${review.currentWindow.weightCount} weigh-ins`],
    ["Waist", trend.waistCurrent ? `${trend.waistCurrent}${NBSP}in${trend.waistDelta == null ? "" : ` · ${signed(trend.waistDelta)}${NBSP}in`}` : "No measurement yet"],
    ["Training", `${adherence.training}% · ${metrics.workoutDays} session${metrics.workoutDays === 1 ? "" : "s"}`],
    ["Protein on target", review.currentWindow.nutritionDays ? `${adherence.protein}% of confirmed days · ${metrics.avgProtein}${NBSP}g avg` : "No confirmed food logs with protein"],
    ["Calories on target", review.currentWindow.nutritionDays ? `${adherence.calories}% of confirmed days · ${metrics.avgCalories}${NBSP}kcal avg` : "No confirmed food logs with protein"],
    ["Running", `${Math.round(metrics.totalMiles * 10) / 10}${NBSP}mi`],
    ["Strength", `${STRENGTH[review.strength?.status] || "Building a baseline"} · ${review.strength?.comparisons?.length || 0} lifts compared`],
    ["Recovery", sentence(review.recoveryTrend?.status || "stable")],
    ["Sleep", `${metrics.avgSleep || 0}${NBSP}h a night`],
    ["Lifting volume", `${Math.round(week.totalVolume / 1000)}k${NBSP}lb`],
  ];
}

const INTENTS = { approved: "I’ll try it", modified: "I’ll adapt it", rejected: "Pass this week" };

function WeeklyFeedback({ review, data, goals, active, followUp, onWrite }) {
  const today = review.weekEndKey;
  const intent = active && data[active.date]?.intelligence?.weeklyCoachReviewResponse;
  const prior = followUp && data[followUp.date]?.intelligence?.weeklyCoachReviewResponse;
  const path = "intelligence.weeklyCoachReviewResponse";

  function record(response) {
    const entry = intent ? { ...intent, response } : weeklyRecommendationIntent({ data, review, goals, response });
    onWrite(active?.date || today, path, entry);
  }
  function report(followThrough) {
    onWrite(followUp.date, path, { ...prior, followThrough, followThroughOn: today });
  }

  return (
    <div className="kv" style={{ gap: 10 }}>
      {WEEKLY_ENDPOINT[intent?.recommendationKind || review.recommendation.kind] && <p className="t-s c2">{WEEKLY_ENDPOINT[intent?.recommendationKind || review.recommendation.kind]}</p>}
      {active && <p className="t-s c2">Your {shortDate(active.date)} choice for {intent.title || intent.recommendationKind} · {INTENTS[active.response]}. Follow-up on {shortDate(active.outcomeEnd)}.</p>}
      {(!active || active.date === today) && (
        <div className="chips" role="group" aria-label="Respond to this recommendation">
          {Object.entries(INTENTS).map(([key, label]) => <button key={key} className="chip" type="button" aria-pressed={active?.response === key} onClick={() => record(key)}>{label}</button>)}
        </div>
      )}
      {prior && <section className="kv" aria-label="Previous recommendation follow-up">
        <h3 className="t-h">Did you follow your {shortDate(followUp.date)} plan?</h3>
        <p className="t-s c2">{prior.title || prior.recommendationKind} · {shortDate(followUp.outcomeEnd)} follow-up</p>
        <div className="chips">
          <button type="button" className="chip" onClick={() => report("followed")}>I followed it</button>
          <button type="button" className="chip" onClick={() => report("skipped")}>I didn’t follow it</button>
        </div>
      </section>}
    </div>
  );
}

export function WeeklyCoachingReview({ review, week, limiter = null, data = {}, goals = {}, weeklySamples = [], updateEntryAtDate, showToast }) {
  const [waist, setWaist] = useState("");
  const [waistError, setWaistError] = useState("");
  const newest = [...weeklySamples].reverse();
  const today = review.weekEndKey;
  const active = newest.find(sample => sample.date <= today && sample.outcomeEnd > today);
  const followUp = newest.find(sample => sample.outcomeEnd <= today && sample.response !== "rejected" && !sample.execution);
  const saved = active && data[active.date]?.intelligence?.weeklyCoachReviewResponse;
  const recommendation = saved?.recommendation || (saved ? { kind: saved.recommendationKind,
    title: saved.title || saved.recommendationKind.replace(/_/g, " ") } : review.recommendation);
  const confidence = saved ? saved.confidence : review.confidence;
  const title = /[.!?]$/.test(recommendation.title) ? recommendation.title : `${recommendation.title}.`;
  const reasons = [...(recommendation.evidence || []).slice(0, 4), ...(recommendation.blockers || []).slice(0, 2)];

  const saveWaist = (event) => {
    event.preventDefault();
    const value = Number.parseFloat(waist);
    if (!Number.isFinite(value) || value <= 0) {
      setWaistError("Enter your waist in inches, for example 32.5.");
      return;
    }
    updateEntryAtDate?.(review.weekEndKey, "body.waist", String(value));
    setWaist(""); setWaistError("");
    showToast?.("Waist measurement saved");
  };

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className="tag">Week of {shortDate(review.weekStartKey)}</span>
        <span className="tag tag-f">Phase: {review.phase.replace(/_/g, " ")}</span>
      </div>

      <section aria-labelledby="review-recommendation" style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: "3px solid var(--ink)", paddingTop: 10 }}>
        <p className="t-s c2">One recommendation</p>
        <h2 id="review-recommendation" className="t-xl">{title}</h2>
        {recommendation.summary && <p className="t-b">{recommendation.summary}</p>}
        {confidence && <p className="t-s c2">{sentence(confidence)} confidence · {recommendation.observationMode ? "Observation mode" : AUTHORITY[recommendation.authority] || "Suggesting"}</p>}
        {updateEntryAtDate && <WeeklyFeedback review={review} data={data} goals={goals} active={active} followUp={followUp} onWrite={updateEntryAtDate} />}
      </section>

      {limiter && (
        <p className="banner">
          <Icon name="info" size="s" />
          <span><b>Likely limiter: {limiter.title.toLowerCase()}.</b> {[limiter.metric, limiter.action].filter(Boolean).join(". ")}</span>
        </p>
      )}

      <section aria-labelledby="review-numbers">
        <table className="tbl" aria-labelledby="review-numbers">
          <caption id="review-numbers" className="t-h" style={{ textAlign: "left", paddingBottom: 4 }}>The week in numbers</caption>
          <tbody>
            {weekInNumbers(review, week).map(([label, value]) => (
              <tr key={label}><th scope="row">{label}</th><td className="n-s" style={{ whiteSpace: "normal" }}>{value}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="t-s c2" style={{ marginTop: 8 }}>{ON_TARGET_NOTE}</p>
      </section>

      {reasons.length > 0 && (
        <section aria-labelledby="review-why" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <h2 id="review-why" className="t-h">Why this recommendation</h2>
          <ul className="lst">{reasons.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>
        </section>
      )}

      {!review.trend.waistCurrent && (
        <form onSubmit={saveWaist} noValidate style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
            <label className="field grow">
              <span className="lbl">This week’s waist (in)</span>
              <input className="input n" inputMode="decimal" autoComplete="off" value={waist} aria-invalid={waistError ? "true" : undefined} onChange={(event) => { setWaist(event.target.value); setWaistError(""); }} />
            </label>
            <button type="submit" className="btn btn-s">Save</button>
          </div>
          {waistError && <p className="err" role="alert">{waistError}</p>}
        </form>
      )}

      <p className="t-s c2">This review never changes a target. You change them yourself in Settings.</p>
    </>
  );
}

export default WeeklyCoachingReview;
