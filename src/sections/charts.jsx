// src/sections/charts.jsx
// The charts Progress is drawn with: plain SVG carrying the chart classes in
// src/ledger.css. A chart is drawn at the width it is given, one unit to the
// pixel, so its text is 12 px on every screen instead of shrinking with a
// narrow phone. Each chart says what it shows in its label, and DataTable
// puts the same numbers behind "Show as table" so nothing is readable only
// as a picture.
import { useCallback, useRef, useState } from "react";

const DEFAULT_WIDTH = 358;

// The chart's own width in pixels, kept current as its column changes. The
// ref is a callback so a chart that appears later is measured too.
function useChartWidth() {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const observer = useRef(null);
  const ref = useCallback((node) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node || typeof ResizeObserver === "undefined") return;
    observer.current = new ResizeObserver(([entry]) => {
      const next = Math.round(entry.contentRect.width);
      if (next > 0) setWidth((current) => (current === next ? current : next));
    });
    observer.current.observe(node);
  }, []);
  return [ref, width];
}

export const shortDate = (dateKey) => new Date(`${dateKey}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
export const dayDate = (dateKey) => new Date(`${dateKey}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

function niceStep(raw) {
  const power = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / power;
  return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power;
}

// Round gridlines that bracket the values: two to four of them.
export function gridFor(values, { from = null, to = null } = {}) {
  const low = Math.min(...values);
  const high = Math.max(...values);
  let step = niceStep(((high - low) || Math.max(1, Math.abs(high) * 0.02)) / 2);
  const build = () => {
    const lo = from ?? Math.floor(low / step) * step;
    let hi = to ?? Math.ceil(high / step) * step;
    if (hi <= lo) hi = lo + step;
    const ticks = [];
    for (let value = lo; value <= hi + step / 1000; value += step) ticks.push(Math.round(value * 1000) / 1000);
    return { lo, hi, ticks };
  };
  let grid = build();
  while (grid.ticks.length > 4) { step *= 2; grid = build(); }
  return grid;
}

// One line over time. points: [{ date, value, raw?, also? }]. With rings,
// each point's raw reading is drawn as a ring behind the line. With second,
// each point's `also` is drawn as a dashed line behind it (a running average).
export function LineChart({ label, points, rings = false, second = false, height = 110, unit = "", format = String, from = null, to = null }) {
  const [ref, W] = useChartWidth();
  if (!points || points.length < 2) return null;
  const top = 16;
  const bottom = height - 26;
  const left = 40;
  const right = W - 12;
  const values = points.flatMap((point) => [point.value, ...(rings && point.raw != null ? [point.raw] : []), ...(second && point.also != null ? [point.also] : [])]);
  const { lo, hi, ticks } = gridFor(values, { from, to });
  const x = (index) => left + (index / (points.length - 1)) * (right - left);
  const y = (value) => bottom - ((value - lo) / (hi - lo)) * (bottom - top);
  const last = points[points.length - 1];
  const lastY = y(last.value);
  return (
    <svg ref={ref} className="ch" viewBox={`0 0 ${W} ${height}`} role="img" aria-label={label} style={{ height }}>
      <path className="ax" d={ticks.map((tick) => `M0 ${Math.round(y(tick)) + 0.5}h${W}`).join("")} />
      {ticks.map((tick, index) => (
        <text key={tick} className="tx" x="0" y={Math.round(y(tick)) - 4}>{format(tick)}{index === ticks.length - 1 && unit ? ` ${unit}` : ""}</text>
      ))}
      {rings && points.map((point, index) => point.raw != null && <circle key={point.date} className="raw" cx={x(index).toFixed(1)} cy={y(point.raw).toFixed(1)} r="3" />)}
      {second && <polyline className="ln2" points={points.map((point, index) => (point.also == null ? null : `${x(index).toFixed(1)},${y(point.also).toFixed(1)}`)).filter(Boolean).join(" ")} />}
      <polyline className="ln" points={points.map((point, index) => `${x(index).toFixed(1)},${y(point.value).toFixed(1)}`).join(" ")} />
      {points.length <= 12 && points.slice(0, -1).map((point, index) => <circle key={point.date} className="pt" cx={x(index).toFixed(1)} cy={y(point.value).toFixed(1)} r="3.5" />)}
      <circle className="on" cx={x(points.length - 1).toFixed(1)} cy={lastY.toFixed(1)} r="5" />
      <text className="txn" x={W} y={lastY < 30 ? lastY + 20 : lastY - 10} textAnchor="end">{format(last.value)}</text>
      <text className="tx" x={left - 8} y={height - 6}>{shortDate(points[0].date)}</text>
      <text className="tx" x={W} y={height - 6} textAnchor="end">{shortDate(last.date)}</text>
    </svg>
  );
}

// Columns from a zero line. columns: [{ key, value, x?, filled? }]. A column
// with no value is drawn as a stub, so a rest day reads as a day, not a gap.
export function ColumnChart({ label, columns, height = 110, format = String, goal = null }) {
  const [ref, W] = useChartWidth();
  if (!columns || columns.length === 0) return null;
  const base = height - 24;
  const top = 22;
  const high = Math.max(goal ?? 0, ...columns.map((column) => column.value), 1);
  const slot = (W - 16) / columns.length;
  const width = Math.min(30, slot * 0.66);
  const tall = (value) => (value / high) * (base - top);
  const showValues = columns.length <= 8;
  return (
    <svg ref={ref} className="ch" viewBox={`0 0 ${W} ${height}`} role="img" aria-label={label} style={{ height }}>
      <path className="ax" d={`M0 ${base + 0.5}h${W}`} />
      {goal != null && <path className="ax" strokeDasharray="4 4" d={`M0 ${Math.round(base - tall(goal)) + 0.5}h${W}`} />}
      {columns.map((column, index) => {
        const centre = 8 + slot * index + slot / 2;
        const empty = !(column.value > 0);
        const size = empty ? 3 : Math.max(3, tall(column.value));
        return (
          <g key={column.key}>
            <rect className={empty || column.filled === false ? "col2" : "col"} x={(centre - width / 2).toFixed(1)} y={(base - size).toFixed(1)} width={width.toFixed(1)} height={size.toFixed(1)} />
            {showValues && !empty && <text className="txn" x={centre.toFixed(1)} y={(base - size - 6).toFixed(1)} textAnchor="middle">{format(column.value)}</text>}
            {column.x && <text className="tx" x={centre.toFixed(1)} y={height - 6} textAnchor="middle">{column.x}</text>}
          </g>
        );
      })}
    </svg>
  );
}

// A trend at a glance on the wide home: one sentence beside its chart.
export function Glance({ text, children }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: children ? "minmax(0, 1fr) minmax(0, 1.4fr)" : "minmax(0, 1fr)", gap: 24, alignItems: "start" }}>
      <p className="t-s c2">{text}</p>
      {children}
    </div>
  );
}

// The numbers behind a chart. rows: arrays whose first cell names the row.
export function DataTable({ label = "Show as table", caption, head, rows }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-g btn-sm" aria-expanded={open} onClick={() => setOpen((value) => !value)} style={{ alignSelf: "flex-start", paddingLeft: 0 }}>
        {open ? "Hide table" : label}
      </button>
      {open && (
        <table className="tbl">
          <caption className="sr">{caption}</caption>
          <thead><tr>{head.map((cell, index) => <th key={cell} scope="col" style={index ? { textAlign: "right", paddingRight: 0 } : undefined}>{cell}</th>)}</tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row[0]}>
                <th scope="row">{row[0]}</th>
                {row.slice(1).map((cell, index) => <td key={index} className="n-s">{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
