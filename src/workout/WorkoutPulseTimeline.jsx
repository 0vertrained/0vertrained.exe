import { memo, useId, useMemo, useState } from "react";
import { displaySet } from "../workoutLogging";
import { previousPulseSet, pulseCoverage, pulseSets } from "./pulseTimeline";

const seriesStyle = { display: "grid", gap: 6, minWidth: 0 };
const elapsed = ms => {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};
function describeChange(change) {
  if (change === 0) return "HR was unchanged";
  return `HR ${change > 0 ? "fell" : "rose"} ${Math.abs(change)} bpm`;
}

function TraceFigure({ trace, sets, selected }) {
  const labelId = useId();
  const segments = trace.segments;
  const duration = Math.max(1, trace.endedAt - trace.startedAt);
  let low = Infinity, high = -Infinity;
  for (const segment of segments) {
    for (const [, bpm] of segment) { low = Math.min(low, bpm); high = Math.max(high, bpm); }
  }
  const upper = Math.ceil((high + 3) / 10) * 10;
  const lower = Math.floor((low - 3) / 10) * 10;
  const x = offset => 32 + 312 * offset / duration;
  const y = bpm => 9 + 58 * (upper - bpm) / (upper - lower);
  const coverage = pulseCoverage(trace);
  return (
    <figure aria-labelledby={labelId} style={{ ...seriesStyle, margin: 0 }}>
      <svg viewBox="0 0 352 89" role="img" aria-label="Heart rate over the recording, with breaks where readings are missing" style={{ width: "100%", display: "block", color: "var(--ink)" }}>
        {[upper, lower].map(bpm => (
          <g key={bpm}>
            <text x="0" y={y(bpm) + 3} fill="var(--ink-2)" fontSize="10">{bpm}</text>
            <line x1="32" x2="344" y1={y(bpm)} y2={y(bpm)} stroke="var(--line)" />
          </g>
        ))}
        {sets.map(set => <g key={set.offset}>
          {set.restMs > 0 && <rect x={x(set.offset)} y="9" width={Math.max(0, x(Math.min(duration, set.offset + set.restMs)) - x(set.offset))} height="58" fill="var(--ink)" opacity={selected === set ? 0.10 : 0.04} />}
          <line x1={x(set.offset)} x2={x(set.offset)} y1="9" y2="67" stroke="var(--ink-2)" strokeDasharray={selected === set ? undefined : "2 3"} />
        </g>)}
        {segments.map(points => points.length === 1
          ? <circle key={points[0][0]} cx={x(points[0][0])} cy={y(points[0][1])} r="2" fill="currentColor" />
          : <polyline key={points[0][0]} points={points.map(([offset, bpm]) => `${x(offset).toFixed(1)},${y(bpm).toFixed(1)}`).join(" ")} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />)}
        <text x="32" y="84" fontSize="10" fill="var(--ink-2)">0:00</text>
        <text x="344" y="84" textAnchor="end" fontSize="10" fill="var(--ink-2)">{elapsed(duration)}</text>
      </svg>
      <figcaption className="t-s c2" id={labelId}>{coverage == null ? "One reading" : `Readings in ${coverage}% of seconds`}{sets.length > 0 ? " · Lines mark logged sets. Shading shows rest." : ""}</figcaption>
    </figure>
  );
}

export const WorkoutPulseTimeline = memo(function WorkoutPulseTimeline({ summary, workout, data, dateKey }) {
  const [selection, select] = useState(null);
  const sets = useMemo(() => pulseSets(summary, workout?.exercises), [summary, workout?.exercises]);
  const selected = sets.find(item => item.offset === selection) || sets.find(item => item.change != null) || sets[0];
  const previous = useMemo(() => previousPulseSet(data, dateKey, summary?.trace?.startedAt, selected), [data, dateKey, summary?.trace?.startedAt, selected]);
  if (!(summary?.count > 0 && summary.bpmTotal > 0 && summary.peakBpm > 0)) return null;
  const trace = summary.trace;
  return (
    <div style={seriesStyle}>
      <p className="t-s">{summary.label || "Workout"} · WHOOP · {Math.round(summary.bpmTotal / summary.count)} bpm average · {summary.peakBpm} bpm peak</p>
      {trace?.segments?.length > 0 && <>
        <TraceFigure trace={trace} sets={sets} selected={selected} />
        {selected && <div style={seriesStyle}>
          <label className="t-s">Inspect set{" "}
            <select className="input" style={{ maxWidth: "100%" }} aria-label="Inspect set" value={selected.offset} onChange={event => select(Number(event.target.value))}>
              {sets.map(set => <option key={set.offset} value={set.offset}>{set.name} · set {set.index + 1} · {elapsed(set.offset)}</option>)}
            </select>
          </label>
          <p className="t-s"><strong>{displaySet(selected.set, { name: selected.name, trackingMode: selected.mode })}</strong> · {selected.change == null ? "A full minute of recorded rest is needed to measure the change." : `${describeChange(selected.change)} in the first minute of rest.`}</p>
          {previous && <p className="t-s c2">{previous.date} · {displaySet(previous.set, { name: previous.name, trackingMode: previous.mode })} · {describeChange(previous.change)} during the same minute.</p>}
        </div>}
      </>}
    </div>
  );
});
