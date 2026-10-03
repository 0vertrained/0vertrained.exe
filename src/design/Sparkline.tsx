// A four-week line in ink-2 with a chalk dot on the latest point: no fill,
// no axes, no gradient. Pure SVG and aria-hidden; the tile's delta text
// carries the meaning. `brass` only where brass has been earned (the reward
// sheet), never on a stat tile.
import { cx } from "./cx";

export interface SparklineProps {
  /** Raw weekly values; fewer than two draw nothing. */
  data: number[];
  width?: number;
  height?: number;
  brass?: boolean;
  className?: string;
}

const PAD = 3;

export function Sparkline({ data, width = 120, height = 28, brass, className }: SparklineProps) {
  const cls = cx("ot-stat-spark", brass && "ot-spark-brass", className);
  const viewBox = `0 0 ${width} ${height}`;
  if (data.length < 2) return <svg className={cls} viewBox={viewBox} aria-hidden="true" />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max === min ? 1 : max - min;
  const pts = data.map((v, i): [number, number] => [
    PAD + (i / (data.length - 1)) * (width - 2 * PAD),
    PAD + (1 - (v - min) / span) * (height - 2 * PAD),
  ]);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const [lx, ly] = pts[pts.length - 1] ?? [0, 0];
  return (
    <svg className={cls} viewBox={viewBox} preserveAspectRatio="none" aria-hidden="true">
      <path className="ot-spark-line" d={d} vectorEffect="non-scaling-stroke" />
      <circle className="ot-spark-dot" cx={lx} cy={ly} r={2.5} />
    </svg>
  );
}
