// One bar, three kinds told apart by fill: xp (brass, 600 ms ease-out),
// objective (chalk, 120 ms) and timer (chalk, no transition so it never lags
// the clock). The fill is a scaleX transform on the compositor.
import type { CSSProperties } from "react";
import { cx } from "./cx";

export interface ProgressBarProps {
  kind?: "xp" | "objective" | "timer";
  /** 0–1. */
  value: number;
  /** thin 4px (strip, rows), md 6px (cards), lg 8px (the level bar on the cleared sheet). */
  size?: "thin" | "md" | "lg";
  /** Required: the accessible name of the progressbar. */
  label: string;
  className?: string;
}

export function ProgressBar({ kind = "objective", value, size = "md", label, className }: ProgressBarProps) {
  const v = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  const fill = { "--ot-value": v } as CSSProperties;
  return (
    <div
      className={cx("ot-bar", size === "thin" && "ot-bar-thin", size === "lg" && "ot-bar-lg", className)}
      data-kind={kind}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
      aria-label={label}
    >
      <div className="ot-bar-fill" style={fill} />
    </div>
  );
}
