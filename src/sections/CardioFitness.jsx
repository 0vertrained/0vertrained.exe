// src/sections/CardioFitness.jsx
// Progress → Running: Apple Watch's cardio fitness (VO2 max) over the last
// year, read from Apple Health in the iPhone app once runs from the watch
// are on (RunsPlugin.cardioFitness). Nothing shows without estimates.

import { useEffect, useState } from "react";
import { nativePlugin } from "../native";
import { readWatchRunsOn } from "../watch/watchRunsState";
import { cardioFitnessTrend } from "../runProgress";
import { LineChart, shortDate } from "./charts";

const NBSP = "\u00a0";

export function CardioFitness() {
  const [points, setPoints] = useState(null);
  useEffect(() => {
    const plugin = nativePlugin("OTRuns");
    if (typeof plugin?.cardioFitness !== "function" || !readWatchRunsOn()) return undefined;
    let alive = true;
    plugin.cardioFitness({ days: 365 }).then((result) => { if (alive) setPoints(result?.points || []); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const trend = cardioFitnessTrend(points || []);
  if (!trend) return null;
  const { latest, change, since } = trend;
  const moved = change == null ? "" : change === 0 ? `, level with ${shortDate(since)}` : `, ${change > 0 ? "up" : "down"} ${Math.abs(change)} since ${shortDate(since)}`;
  return (
    <section aria-labelledby="vo2-title" data-testid="cardio-fitness" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <h2 id="vo2-title" className="t-h">Cardio fitness</h2>
      <div className="kv">
        <span className="n-md">{latest.value.toFixed(1)}{NBSP}<span className="t-s c2">mL/kg/min</span></span>
        <span className="t-s c2">VO2 max from your Apple Watch, {shortDate(latest.date)}{moved}.</span>
      </div>
      {trend.points.length >= 2 && (
        <LineChart label={`Line chart of cardio fitness over ${trend.points.length} estimates, ${latest.value.toFixed(1)} on ${shortDate(latest.date)}.`} points={trend.points} format={(value) => value.toFixed(1)} />
      )}
      <p className="t-s c2">The watch estimates it from outdoor runs, walks and hikes with heart rate. It moves slowly; read the trend, not one day.</p>
    </section>
  );
}

export default CardioFitness;
