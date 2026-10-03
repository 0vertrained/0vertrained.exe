// Placeholder shapes in surface-3 while a tab loads: `lines={n}` for text,
// or a block with `width`, `height` and `radius`. They pulse in opacity
// (1.4 s) and hold still under reduced motion. Match the shape of what is
// coming (a Quest card skeleton is a 32px badge line, three 56px rows and a
// 48px button), and never show one for less than 300 ms: flash the real
// content instead. Each shape is a role="status" named "Loading" so the
// busy state is announced; ARIA prohibits a bare aria-label on a div.
import { cx } from "./cx";

export interface SkeletonProps {
  /** Text lines: the last is 60% wide, the others step 100 / 88 / 76%. */
  lines?: number;
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  className?: string;
}

/** Text-like line widths: a ragged right edge, the last line shorter. */
function lineWidth(index: number, lines: number): string {
  return `${index === lines - 1 ? 60 : 100 - (index % 3) * 12}%`;
}

export function Skeleton({ lines, width = "100%", height = 48, radius, className }: SkeletonProps) {
  if (lines) {
    const rows = Array.from({ length: lines }, (_, i) => (
      <div key={i} className="ot-skeleton ot-skeleton-line" style={{ width: lineWidth(i, lines) }} />
    ));
    return (
      <div className={cx("ot-skeleton-stack", className)} role="status" aria-busy="true" aria-label="Loading">
        {rows}
      </div>
    );
  }
  return <div className={cx("ot-skeleton", className)} style={{ width, height, borderRadius: radius }} role="status" aria-busy="true" aria-label="Loading" />;
}
