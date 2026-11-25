// src/WeightTrendFigure.jsx
// Bodyweight on Progress › Body: the one bodyweight chart in the app. Each
// weigh-in is a ring and the smoothed trend is the line, so the eye learns to
// read the line and let the scatter go. Built on weightTrend.js. A weigh-in
// can be added here for today; it lands in the same field the check-in writes.

import { useMemo, useState } from "react";
import { buildWeightTrend } from "./weightTrend";
import { Method } from "./ui/ledger";
import { LineChart, DataTable, Glance, dayDate } from "./sections/charts";

const NBSP = "\u00a0";
const TABLE_ROWS = 14;

// One number, asked for where it is needed: a button that opens a field.
export function QuickNumber({ action, label, hint, onSave }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const save = (event) => {
    event.preventDefault();
    const value = Number.parseFloat(text);
    if (!Number.isFinite(value) || value <= 0) { setError(hint); return; }
    onSave(value);
    setText(""); setError(""); setOpen(false);
  };
  if (!open) return <button type="button" className="btn btn-s btn-sm" onClick={() => setOpen(true)}>{action}</button>;
  return (
    <form onSubmit={save} noValidate style={{ display: "flex", flexDirection: "column", gap: 6, flex: "1 1 100%" }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
        <label className="field grow">
          <span className="lbl">{label}</span>
          <input className="input n" inputMode="decimal" autoComplete="off" autoFocus value={text} aria-invalid={error ? "true" : undefined} onChange={(event) => { setText(event.target.value); setError(""); }} />
        </label>
        <button type="submit" className="btn btn-p">Save</button>
        <button type="button" className="btn btn-g" onClick={() => { setOpen(false); setText(""); setError(""); }}>Cancel</button>
      </div>
      {error && <p className="err" role="alert">{error}</p>}
    </form>
  );
}

export function WeightTrendFigure({ data, onSaveWeight, glance = false }) {
  const trend = useMemo(() => buildWeightTrend(data), [data]);
  if (!trend) return null;
  if (glance && !trend.ready) return <Glance text={`${trend.count} of ${trend.needed} weigh-ins logged. The trend line appears after a few more.`} />;
  const add = onSaveWeight && <QuickNumber action="Add a weigh-in" label="Today’s weight (lb)" hint="Enter your weight in pounds, for example 181.4." onSave={onSaveWeight} />;

  if (!trend.ready) {
    return (
      <section aria-labelledby="weight-title" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h2 id="weight-title" className="t-h">Bodyweight</h2>
        <p className="t-s c2">{trend.count} of {trend.needed} weigh-ins logged. Log your morning weight a few more days and the trend line appears.</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{add}</div>
      </section>
    );
  }

  const { current, points } = trend;
  const rate = Math.abs(current.weeklyRate);
  const direction = current.direction === "holding" ? "holding steady" : `${current.direction === "losing" ? "down" : "up"} ${rate}${NBSP}lb a week`;
  const first = points[0];
  const recent = points.slice(-TABLE_ROWS).reverse();
  const chart = (
    <LineChart
      label={`Line chart of bodyweight trend over ${trend.count} weigh-ins, from ${first.trend} to ${current.trend} pounds, with single weigh-ins scattered around the line.`}
      points={points.map((point) => ({ date: point.date, value: point.trend, raw: point.weight }))}
      rings
      unit="lb"
    />
  );
  if (glance) return <Glance text={`Weight trend ${current.trend}${NBSP}lb, ${direction}. Line: smoothed trend. Rings: weigh-ins.`}>{chart}</Glance>;

  return (
    <section aria-labelledby="weight-title" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <h2 id="weight-title" className="t-h">Bodyweight</h2>
      <p className="t-s c2">Trend {current.trend}{NBSP}lb, {direction}, from {trend.count} weigh-ins. The line is the smoothed trend. The rings are your weigh-ins.</p>
      {chart}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: 8 }}>
        {add}
      </div>
      <DataTable
        caption={`Bodyweight: the last ${recent.length} weigh-ins and the trend on each day`}
        head={["Day", "Weigh-in", "Trend"]}
        rows={recent.map((point) => [dayDate(point.date), `${point.weight}${NBSP}lb`, `${point.trend}${NBSP}lb`])}
      />
      <Method
        testId="method-weight"
        method="Daily swings are mostly water and food in transit. The line is the part that is you."
        detail={<p>The trend is an exponentially smoothed average: each weigh-in moves it a tenth of the way toward the new reading. The weekly rate compares the trend now with the trend up to 14 weigh-ins ago, scaled by the calendar days between them.</p>}
      />
    </section>
  );
}
