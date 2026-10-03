// Appears above the sticky Complete-set button the moment a set is logged:
// the word REST, the countdown in display-md, −30 s and +30 s as secondary
// buttons, Skip as ghost, and a thin chalk timer bar across the bottom. It
// counts down drift-free, buzzes once at zero, then stays at 00:00 until the
// next set or Skip. Rest is part of training, so the bar is calm: no colour
// change as it nears zero, no flashing at zero.
import { Button } from "./Button";
import { cx } from "./cx";
import { ProgressBar } from "./ProgressBar";
import { mmss } from "./time";

export interface RestTimerBarProps {
  /** Seconds the rest started with. */
  total: number;
  /** Seconds left. */
  remaining: number;
  onMinus?: () => void;
  onPlus?: () => void;
  onSkip?: () => void;
  className?: string;
}

export function RestTimerBar({ total, remaining, onMinus, onPlus, onSkip, className }: RestTimerBarProps) {
  return (
    <div className={cx("ot-rest", className)} role="region" aria-label="Rest timer">
      <span className="ot-rest-label">Rest</span>
      <span className="ot-rest-time" role="timer" aria-live="off">{mmss(remaining)}</span>
      <Button variant="secondary" onClick={onMinus} aria-label="Thirty seconds less">−30 s</Button>
      <Button variant="secondary" onClick={onPlus} aria-label="Thirty seconds more">+30 s</Button>
      <Button variant="ghost" onClick={onSkip}>Skip</Button>
      <ProgressBar kind="timer" size="thin" value={total > 0 ? remaining / total : 0} label="Rest remaining" />
    </div>
  );
}
