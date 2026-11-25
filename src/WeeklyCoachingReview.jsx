// src/WeeklyCoachingReview.jsx
// The weekly review on Progress: one recommendation, the likely limiter, the
// week in numbers, and why. It reads the weekly coach review and the week's
// totals; it never changes a target. The only thing it writes is this week's
// waist measurement, when there is none yet.

import { useState } from "react";
import { Icon } from "./ui/ledger";
import { shortDate } from "./sections/charts";

const NBSP = "\u00a0";
const sentence = (text) => (text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : "");
const signed = (value) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value)}`;
const STRENGTH = { stable: "Stable", watch: "Watch", action: "Needs action" };
const AUTHORITY = { calibrated: "Calibrated", suggest: "Suggesting", observe: "Observing" };

export function weekInNumbers(review, week) {
  const { trend, adherence, metrics } = review;
  return [
    ["Week score", `${week.weekScore} of 100`],
    ["Weight", trend.weightDelta == null ? "Not enough weigh-ins yet" : `${signed(trend.weightDelta)}${NBSP}lb on last week · ${review.currentWindow.weightCount} weigh-ins`],
    ["Waist", trend.waistCurrent ? `${trend.waistCurrent}${NBSP}in${trend.waistDelta == null ? "" : ` · ${signed(trend.waistDelta)}${NBSP}in`}` : "No measurement yet"],
    ["Training", `${adherence.training}% · ${metrics.workoutDays} session${metrics.workoutDays === 1 ? "" : "s"}`],
    ["Protein goal met", `${adherence.protein}% of days · ${metrics.avgProtein}${NBSP}g avg`],
    ["Calorie goal met", `${adherence.calories}% of days · ${metrics.avgCalories}${NBSP}kcal avg`],
    ["Running", `${Math.round(metrics.totalMiles * 10) / 10}${NBSP}mi`],
    ["Strength", `${STRENGTH[review.strength?.status] || "Building a baseline"} · ${review.strength?.comparisons?.length || 0} lifts compared`],
    ["Recovery", sentence(review.recoveryTrend?.status || "stable")],
    ["Sleep", `${metrics.avgSleep || 0}${NBSP}h a night`],
    ["Lifting volume", `${Math.round(week.totalVolume / 1000)}k${NBSP}lb`],
  ];
}

export function WeeklyCoachingReview({ review, week, limiter = null, updateEntryAtDate, showToast }) {
  const [waist, setWaist] = useState("");
  const [waistError, setWaistError] = useState("");
  const recommendation = review.recommendation;
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
        <p className="t-b">{recommendation.summary}</p>
        <p className="t-s c2">{sentence(review.confidence)} confidence · {review.observationMode ? "Observation mode" : AUTHORITY[review.calibration?.authority] || "Suggesting"}</p>
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
