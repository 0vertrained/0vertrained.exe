// src/sections/CardioFitness.jsx
// Progress → Running: Apple Watch's cardio fitness (VO2 max) over the last
// year, read from Apple Health in the iPhone app once runs from the watch
// are on (RunsPlugin.cardioFitness). Nothing shows without estimates.

import { useEffect, useState } from "react";
import { nativePlugin } from "../native";
import { APP_FOREGROUND_EVENT } from "../integrations/appForeground";
import { useDeviceToggle } from "../health/useDeviceToggle";
import { WATCH_RUNS_EVENT, readWatchRunsOn } from "../watch/watchRunsState";
import { cardioFitnessTrend } from "../runProgress";
import { LineChart, shortDate } from "./charts";

const NBSP = "\u00a0";

export function CardioFitness({ owner }) {
  const [reading, setReading] = useState(null);
  const on = useDeviceToggle(WATCH_RUNS_EVENT, readWatchRunsOn, owner, owner !== null && Boolean(nativePlugin("OTRuns")));
  useEffect(() => {
    const plugin = nativePlugin("OTRuns");
    if (typeof plugin?.cardioFitness !== "function" || !on) return undefined;
    let alive = true;
    let running = false;
    const refresh = async () => {
      if (running) return;
      running = true;
      try {
        const result = await plugin.cardioFitness({ days: 365 });
        if (alive) setReading({ owner, points: result?.points || [] });
      } catch { /* Try again when Progress returns to the foreground. */ }
      finally { running = false; }
    };
    void refresh();
    window.addEventListener(APP_FOREGROUND_EVENT, refresh);
    return () => {
      alive = false;
      window.removeEventListener(APP_FOREGROUND_EVENT, refresh);
    };
  }, [on, owner]);
  const trend = on && reading?.owner === owner && cardioFitnessTrend(reading?.points || []);
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
