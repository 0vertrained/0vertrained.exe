// The XP fill on the cleared sheet, as a timeline of bar values: the bar
// renders at the previous fraction, moves to the new one 200 ms after mount,
// and on a level up fills to 1, holds 200 ms, snaps to 0 with the fill
// duration at 0 ms, then refills over 400 ms while the [Level up] line
// rises in. Reduced motion is a cut: the final state, no timers.
import { useEffect, useState } from "react";

/** Milliseconds, matching the design system's motion table. */
export const XP_FILL_TIMING = Object.freeze({
  start: 200,
  fill: 600,
  hold: 200,
  /** One frame between the snap to 0 and the refill, so the snap commits with no transition. */
  snap: 40,
  refill: 400,
});

export interface XpFillInput {
  from: number;
  to: number;
  leveledUp: boolean;
  reduced: boolean;
}

export interface XpFillState {
  /** 0–1, what the bar shows now. */
  value: number;
  /** Overrides the bar's fill duration (0 for the snap, 400 for the refill); null keeps the kit's 600 ms. */
  fillMs: number | null;
  /** The [Level up] line is on screen. */
  showLevelUp: boolean;
}

export function useXpFill({ from, to, leveledUp, reduced }: XpFillInput): XpFillState {
  const [state, setState] = useState<XpFillState>({ value: from, fillMs: null, showLevelUp: false });

  useEffect(() => {
    if (reduced) return;
    const t = XP_FILL_TIMING;
    const timers: number[] = [];
    const at = (ms: number, next: XpFillState) => timers.push(window.setTimeout(() => setState(next), ms));
    if (!leveledUp) {
      at(t.start, { value: to, fillMs: null, showLevelUp: false });
    } else {
      at(t.start, { value: 1, fillMs: null, showLevelUp: false });
      at(t.start + t.fill + t.hold, { value: 0, fillMs: 0, showLevelUp: true });
      at(t.start + t.fill + t.hold + t.snap, { value: to, fillMs: t.refill, showLevelUp: true });
    }
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [from, to, leveledUp, reduced]);

  return reduced ? { value: to, fillMs: null, showLevelUp: leveledUp } : state;
}
