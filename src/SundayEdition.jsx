// src/SundayEdition.jsx
// The Sunday Edition: the week, read once, ending on exactly one change.
//
// Draws the pure model from sundayEdition.js in a fixed order: the week in
// recovery, training load, sets by muscle (exceptions only), fuel, how the
// week felt against the numbers, then the one change. A thin section says so
// in a line and steps aside. Nothing here is re-graded in hindsight: each
// morning is shown as it was scored that day.
import { useMemo } from "react";
import { Flow, TopBar, Method } from "./ui/ledger";
import { LineChart, ColumnChart } from "./sections/charts";
import { buildSundayEdition } from "./sundayEdition";

const NBSP = "\u00a0";
const column = (gap) => ({ display: "flex", flexDirection: "column", gap });

export function SundayEdition({ data, ouraData, whoopData, settings, onClose, now = null }) {
  const model = useMemo(
    () => buildSundayEdition({ data, ouraData, whoopData, settings, now: now || new Date() }),
    [data, ouraData, whoopData, settings, now]
  );
  const { edition, recoveryWeek, loadLedger, volumeDigest, fuelWeek, divergenceDiary, oneChange, completeness } = model;
  const loadByDate = Object.fromEntries(loadLedger.days.map((day) => [day.date, day.load]));
  const scored = recoveryWeek.scorePoints.map((point, index, all) => {
    const window = all.slice(Math.max(0, index - 2), index + 1);
    return { date: point.date, value: point.value, also: all.length >= 4 ? Math.round(window.reduce((sum, item) => sum + item.value, 0) / window.length) : null };
  });

  return (
    <Flow label="The Sunday Edition" onClose={onClose} data-testid="sunday-edition">
      <div className="shell">
        <TopBar title="The Sunday Edition" close="Close" onClose={onClose} />
        <div className="main">
          <div className="mo-print" style={column(20)}>
            <header style={{ ...column(8), borderTop: "3px solid var(--ink)", paddingTop: 12 }}>
              <p className="t-s c2">Edition {edition.number}</p>
              <h2 className="t-xl">The week of {edition.label}</h2>
            </header>
            {completeness.caveat && <p className="banner">{completeness.caveat}</p>}

            <section aria-labelledby="edition-recovery" style={column(8)}>
              <div className="sec"><h3 id="edition-recovery" className="t-title">The week in recovery</h3><span className="t-s c2">{completeness.wearableMornings} of 7 mornings</span></div>
              <table className="tbl" aria-labelledby="edition-recovery">
                <thead><tr><th scope="col">Day</th><th scope="col">State</th><th scope="col" style={{ textAlign: "right" }}>Score</th><th scope="col" style={{ textAlign: "right", paddingRight: 0 }}>Load</th></tr></thead>
                <tbody>
                  {recoveryWeek.timeline.map((day) => (
                    <tr key={day.date}>
                      <th scope="row">{day.dayName}</th>
                      <td>{day.stateName === "—" ? "No reading" : day.stateName}</td>
                      <td className="n-s">{day.score ?? "—"}</td>
                      <td className="n-s">{loadByDate[day.date] != null ? Math.round(loadByDate[day.date]) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {scored.length >= 2 && (
                <LineChart
                  label={`Line chart of the week’s recovery score, from ${scored[0].value} to ${scored[scored.length - 1].value}.`}
                  points={scored}
                  second={scored.length >= 4}
                  height={96}
                />
              )}
              <p className="t-b">{recoveryWeek.summary}</p>
              {recoveryWeek.sleepDebt && <p className="t-s">Sleep this week: {recoveryWeek.sleepDebt.debtHours}{NBSP}h of debt, {String(recoveryWeek.sleepDebt.band).toLowerCase()}.</p>}
              <Method testId="method-edition-recovery" method="Each morning is scored and classed exactly as it was that day. Nothing is re-graded in hindsight." />
            </section>

            <section aria-labelledby="edition-load" style={column(8)}>
              <div className="sec"><h3 id="edition-load" className="t-title">Training load</h3>{loadLedger.zoneLabel && <span className="tag tag-f">{loadLedger.zoneLabel}</span>}</div>
              <p className="t-s">
                {loadLedger.weekTotal} this week{loadLedger.deltaPct !== null ? `, ${loadLedger.deltaPct === 0 ? "level with" : `${Math.abs(loadLedger.deltaPct)}% ${loadLedger.deltaPct > 0 ? "up on" : "down on"}`} last week` : ""}.
              </p>
              <ColumnChart
                label={`Bar chart of training load by day this week. The week’s total is ${loadLedger.weekTotal}.`}
                columns={loadLedger.days.map((day) => ({ key: day.date, value: Math.round(day.load), x: day.dayName.slice(0, 1) }))}
                height={96}
              />
              <Method testId="method-edition-load" method="Load is counted in effort-minutes across lifting and cardio, the same currency as Training load in Recovery." />
            </section>

            <section aria-labelledby="edition-volume" style={column(8)}>
              <h3 id="edition-volume" className="t-title">Sets by muscle</h3>
              {!volumeDigest.ready || volumeDigest.exceptions.length === 0 ? (
                <p className="t-s">{volumeDigest.line}{volumeDigest.ready ? " Nothing to fix here." : ""}</p>
              ) : (
                <ul className="lst">{volumeDigest.exceptions.map((exception) => <li key={exception.key}>{exception.line}</li>)}</ul>
              )}
              <Method testId="method-edition-volume" method="Exceptions only. A muscle inside its range does not need your attention this week." />
            </section>

            <section aria-labelledby="edition-fuel" style={column(8)}>
              <h3 id="edition-fuel" className="t-title">Fuel</h3>
              <p className="t-s">{fuelWeek.line}</p>
              {(fuelWeek.avgCalories !== null || fuelWeek.tdee) && (
                <ul className="rows">
                  {fuelWeek.avgCalories !== null && (
                    <li className="row"><span className="t-bs grow">Calories, daily average</span><span className="n-s">{fuelWeek.avgCalories.toLocaleString("en-US")}{fuelWeek.calorieTarget ? ` of ${fuelWeek.calorieTarget.toLocaleString("en-US")}` : ""}</span></li>
                  )}
                  {fuelWeek.tdee && (
                    <li className="row"><span className="t-bs grow">Measured burn</span><span className="n-s">{fuelWeek.tdee.value.toLocaleString("en-US")}{NBSP}kcal a day</span></li>
                  )}
                </ul>
              )}
              {fuelWeek.tdee && <Method testId="method-edition-fuel" method={`Measured from ${fuelWeek.tdee.spanDays} days of what you ate against what you weighed, not a formula.`} />}
            </section>

            {divergenceDiary.length > 0 && (
              <section aria-labelledby="edition-diary" style={column(8)}>
                <h3 id="edition-diary" className="t-title">How you felt against the numbers</h3>
                <ul className="rows">
                  {divergenceDiary.map((entry) => (
                    <li key={entry.date} className="row" style={{ alignItems: "flex-start", paddingTop: 10, paddingBottom: 10 }}>
                      <span className="t-ss" style={{ flex: "0 0 48px" }}>{entry.dayName}</span>
                      <span className="kv grow"><span className="t-s">{entry.note}</span>{entry.resolution && <span className="t-s c2">{entry.resolution}</span>}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section aria-labelledby="edition-change" data-testid="one-change" style={{ ...column(8), border: "2px solid var(--ink)", borderRadius: 12, padding: 16, background: "var(--surface)" }}>
              <p className="t-s c2">One change for next week</p>
              <h3 id="edition-change" className="t-read" style={{ fontWeight: 600 }}>{oneChange.text}</h3>
              <p className="t-s">Why: {oneChange.reason}</p>
              <p className="t-s c2">{oneChange.method}</p>
            </section>
            <p className="t-s c2">Next edition Sunday.</p>
          </div>
        </div>
        <div className="foot"><button type="button" className="btn btn-p btn-lg btn-b" onClick={onClose}>Done</button></div>
      </div>
    </Flow>
  );
}

export default SundayEdition;
