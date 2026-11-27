// src/sections/PhysiqueSection.jsx
// Progress → Body, under the waist: shoulders, chest and arms, each with
// its latest measurement and the change since the one before, and the
// shoulder-to-waist ratio over time (src/physique.js). A measurement saves
// to today's body log.

import { QuickNumber } from "../ui/ledger";
import { LineChart, shortDate } from "./charts";
import { MEASUREMENTS, latestReading, measurementSeries, shoulderToWaist } from "../physique";

const NBSP = "\u00a0";

function changeText(latest, unit) {
  if (latest.change == null) return "";
  const since = shortDate(latest.since);
  if (latest.change === 0) return `, level with ${since}`;
  return `, ${latest.change > 0 ? "up" : "down"} ${Math.abs(latest.change)}${unit} since ${since}`;
}

function readingLine(latest) {
  if (!latest) return "Not measured yet";
  return `${latest.value}${NBSP}in on ${shortDate(latest.date)}${changeText(latest, `${NBSP}in`)}`;
}

function ratioLine(ratio, waistMeasured, shouldersMeasured) {
  if (!ratio.length) {
    if (!shouldersMeasured) return "Measure your shoulders and waist to see how they compare.";
    if (!waistMeasured) return "Measure your waist too, in the same week as your shoulders.";
    return "Measure your waist in the same week as your shoulders to see how they compare.";
  }
  const last = ratio[ratio.length - 1];
  const first = ratio[0];
  const moved = Math.round((last.value - first.value) * 100) / 100;
  const trend = ratio.length < 2 ? "" : moved === 0 ? `, level with ${shortDate(first.date)}` : `, ${moved > 0 ? "up" : "down"} ${Math.abs(moved).toFixed(2)} since ${shortDate(first.date)}`;
  return `${last.value.toFixed(2)} on ${shortDate(last.date)}${trend}. Shoulders divided by waist; it rises as the shoulders grow or the waist comes in.`;
}

export function PhysiqueSection({ data, todayKey, onSave = null }) {
  const ratio = shoulderToWaist(data);
  const shouldersMeasured = measurementSeries(data, "shoulders").length > 0;
  const waistMeasured = measurementSeries(data, "waist").length > 0;
  return (
    <>
      <ul className="rows" aria-label="Measurements">
        {MEASUREMENTS.map((measurement) => {
          const latest = latestReading(measurementSeries(data, measurement.key));
          const lower = measurement.label.toLowerCase();
          return (
            <li key={measurement.key} className="row" style={{ minHeight: 64, flexWrap: "wrap", paddingTop: 8, paddingBottom: 8 }}>
              <span className="kv grow">
                <span className="t-bs">{measurement.label}</span>
                <span className="t-s c2">{readingLine(latest)}</span>
              </span>
              {onSave && (
                <QuickNumber
                  action={latest?.date === todayKey ? `Update ${lower} (in)` : `Add ${lower} (in)`}
                  label={`${measurement.label} today (in)`}
                  hint={measurement.hint}
                  onSave={(value) => onSave(measurement, value)}
                />
              )}
            </li>
          );
        })}
      </ul>
      <section aria-labelledby="ratio-title" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h2 id="ratio-title" className="t-h">Shoulder-to-waist</h2>
        <p className="t-s c2">{ratioLine(ratio, waistMeasured, shouldersMeasured)}</p>
        {ratio.length >= 2 && (
          <LineChart
            label={`Line chart of the shoulder-to-waist ratio over ${ratio.length} measurements, ${ratio[ratio.length - 1].value.toFixed(2)} on ${shortDate(ratio[ratio.length - 1].date)}.`}
            points={ratio}
            format={(value) => value.toFixed(2)}
          />
        )}
      </section>
    </>
  );
}

export default PhysiqueSection;
