// Elapsed or remaining time as mm:ss in the mono: display-xl (56px) is the
// cardio runner's clock; size="md" (28px) lives inside the RestTimerBar.
// Digits are tabular so the display never jitters. Drive it from a timestamp
// (Date.now() - startedAt), not setInterval increments, so it stays drift-free
// in a background tab. role="timer" with aria-live="off": announcing every
// second would be unbearable; announce only at zero ("Rest over").
import { cx } from "./cx";
import { mmss } from "./time";

export interface TimerDisplayProps {
  seconds: number;
  /** xl (default) for the runners, md inside the rest bar. */
  size?: "xl" | "md";
  /** The accessible name ("Rest remaining", "Elapsed"). */
  label?: string;
  className?: string;
}

export function TimerDisplay({ seconds, size = "xl", label, className }: TimerDisplayProps) {
  return (
    <time className={cx("ot-timer", size === "md" && "ot-timer-md", className)} role="timer" aria-live="off" aria-label={label}>
      {mmss(seconds)}
    </time>
  );
}
