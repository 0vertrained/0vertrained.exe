// src/WeightTrendFigure.jsx
// Bodyweight trend block for Progress → Overview. Raw weigh-ins render
// as faint dots, the exponentially smoothed trend as the line — the point is
// teaching the eye to read the line and ignore the scatter. Display only,
// built on weightTrend.js.

import { useMemo } from "react";
import { useTheme } from "./theme";
import { buildWeightTrend, SMOOTHING_ALPHA } from "./weightTrend";

export function WeightTrendFigure({ data }) {
  const { C, S } = useTheme();
  const trend = useMemo(() => buildWeightTrend(data), [data]);

  if (!trend) return null;

  return (
    <div style={S.block}>
      <div style={S.blockHead}>
        <span style={S.blockTitle}>{"> "}Bodyweight trend</span>
        {trend.ready && <span style={S.blockStat}>{trend.count} weigh-ins · 90D</span>}
      </div>

      {!trend.ready ? (
        <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.6 }}>
          {trend.count}/{trend.needed} weigh-ins logged — log morning weight in Check-in a few more days to unlock the smoothed trend.
        </div>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
            <span style={{ fontFamily: S.fontSerif, fontSize: 26, color: C.text, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
              {trend.current.trend}
              <span style={{ fontSize: 13, color: C.textFaint, marginLeft: 4 }}>lb trend</span>
            </span>
            <span style={{ fontSize: 11.5, color: trend.current.direction === "holding" ? C.textDim : C.text, fontFamily: C.fontFamily, letterSpacing: "0.04em" }}>
              {trend.current.weeklyRate > 0 ? "+" : ""}{trend.current.weeklyRate} lb/wk · {trend.current.direction}
            </span>
          </div>
          <TrendChart points={trend.points} C={C} />
          <div style={{ ...S.annotation, marginTop: 8, color: C.textFaint, lineHeight: 1.5 }}>
            dots = scale readings · line = smoothed trend (α={SMOOTHING_ALPHA}) — daily swings are water and glycogen, the line is you
          </div>
        </>
      )}
    </div>
  );
}

function TrendChart({ points, C, width = 300, height = 90 }) {
  const pad = 6;
  const vals = points.flatMap(p => [p.weight, p.trend]);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = (max - min) || 1;
  const px = (i) => pad + (i / Math.max(1, points.length - 1)) * (width - pad * 2);
  const py = (v) => height - pad - ((v - min) / span) * (height - pad * 2);
  const line = points.map((p, i) => `${px(i).toFixed(1)},${py(p.trend).toFixed(1)}`).join(" ");
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Bodyweight trend chart" style={{ display: "block" }}>
      {points.map((p, i) => (
        <circle key={i} cx={px(i).toFixed(1)} cy={py(p.weight).toFixed(1)} r="1.8" fill={C.textFaint} fillOpacity="0.5" />
      ))}
      <polyline points={line} fill="none" stroke={C.text} strokeWidth="1.6" />
    </svg>
  );
}
