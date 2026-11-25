// src/sections/TrendCharts.jsx
// Recovery against load on Progress › Recovery. Each day's recovery score is
// set beside that day's training load over the trailing window, with one
// plain sentence about how the two have moved together, so logged data turns
// into something you know about yourself. Defensive: it says what it needs
// until there is enough signal to be honest.

import { calcRecoveryScore } from "../recovery";
import { computeSessionLoad } from "../loadModel";
import { Method } from "../ui/ledger";
import { LineChart, ColumnChart, DataTable, Glance, dayDate, shortDate } from "./charts";

const NEEDED = 5;

function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx, b = ys[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

export function RecoveryLoadFigure({ data, days = 21, glance = false }) {
  // The trailing series of days that have a usable recovery score.
  const allDates = Object.keys(data || {}).sort();
  const series = [];
  for (const date of allDates.slice(-days)) {
    let rec = null;
    try { const r = calcRecoveryScore(data[date], data, date); if (r && typeof r.score === "number") rec = r.score; } catch {}
    if (rec === null) continue;
    let load = 0;
    try { load = computeSessionLoad(data[date]).load || 0; } catch {}
    series.push({ date, recovery: Math.round(rec), load: Math.round(load) });
  }

  if (series.length < NEEDED && glance) return <Glance text={`${series.length} of ${NEEDED} days logged. Recovery against load appears after about a week.`} />;
  if (series.length < NEEDED) {
    return (
      <section aria-labelledby="recload-title" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <h2 id="recload-title" className="t-h">Recovery against load</h2>
        <p className="t-s c2">After about a week of logged training and recovery, this shows how your score tracks your daily load, and whether hard days are stacking up. {series.length} of {NEEDED} days so far.</p>
      </section>
    );
  }

  const loads = series.map((point) => point.load);
  const scores = series.map((point) => point.recovery);
  let peak = 0;
  for (let i = 1; i < series.length; i++) if (series[i].load > series[peak].load) peak = i;

  const r = pearson(loads, scores);
  const takeaway = r === null ? "There is not enough variation yet to read a relationship."
    : r <= -0.35 ? "Your higher-load days are landing on lower-recovery days. Be careful stacking hard sessions."
    : r >= 0.35 ? "Your harder days are falling on better-recovered days. That is good sequencing."
    : "There is no strong link between load and recovery in this window.";
  const first = series[0];
  const last = series[series.length - 1];
  const restDays = loads.filter((load) => !(load > 0)).length;
  const scoreChart = (
    <LineChart
      label={`Line chart of recovery score for ${series.length} days, from ${first.recovery} to ${last.recovery}.`}
      points={series.map((point) => ({ date: point.date, value: point.recovery }))}
      height={104}
    />
  );
  if (glance) return <Glance text={`Recovery score over ${series.length} days. ${takeaway}`}>{scoreChart}</Glance>;

  return (
    <section aria-labelledby="recload-title" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <h2 id="recload-title" className="t-h">Recovery against load, {series.length} days</h2>
      <p className="t-s c2">{takeaway} Your heaviest day was {dayDate(series[peak].date)}.</p>
      <p className="t-c" style={{ marginTop: 4 }}>Recovery score, 0 to 100</p>
      {scoreChart}
      <p className="t-c">Daily training load</p>
      <ColumnChart
        label={`Bar chart of daily training load for ${series.length} days, with ${restDays} day${restDays === 1 ? "" : "s"} of no load. The heaviest day was ${series[peak].load}.`}
        columns={series.map((point, index) => ({ key: point.date, value: point.load, x: index === 0 || index === series.length - 1 ? shortDate(point.date) : "" }))}
        height={92}
      />
      <DataTable
        label="Show both as a table"
        caption="Recovery score and training load by day, newest first"
        head={["Day", "Score", "Load"]}
        rows={[...series].reverse().map((point) => [dayDate(point.date), point.recovery, point.load])}
      />
      <Method
        testId="method-recovery-load"
        method="Each day’s recovery score beside the same day’s session load."
        detail={<p>The sentence above comes from the correlation between the two across this window{r !== null ? ` (r = ${r.toFixed(2)})` : ""}: below −0.35 reads as hard days landing on poor recovery, above 0.35 as good sequencing, and anything between as no clear link. An association in your own days, not proof of cause.</p>}
      />
    </section>
  );
}
