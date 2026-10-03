// Rank promotion, the only takeover: the screen goes to surface-0, the new
// RankBadge at 96px scales from .92 to 1 with opacity over 400 ms, a brass
// hairline draws from the centre over 500 ms, then the rank name and its
// title rise in. Done appears after the hairline and is never auto-
// dismissed. With reduced motion the screen is static, Done at once.
import { useEffect, useRef, useState } from "react";
import { Button } from "../../design/Button";
import { cx } from "../../design/cx";
import { RankBadge } from "../../design/RankBadge";
import { useFocusTrap } from "../../design/useFocusTrap";
import type { Rank } from "../../domain/game/types";
import styles from "./PromotionTakeover.module.css";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

/** Badge 400 ms + hairline 500 ms: when Done appears (the CSS delays match). */
export const PROMOTION_DONE_AT_MS = 900;

export interface PromotionTakeoverProps {
  rank: Rank;
  /** The rank's title: "Contender". */
  title: string;
  onDone: () => void;
  /** Defaults to the device's prefers-reduced-motion setting. */
  reducedMotion?: boolean;
  id?: string;
}

export function PromotionTakeover({ rank, title, onDone, reducedMotion, id = "promotion" }: PromotionTakeoverProps) {
  const prefers = usePrefersReducedMotion();
  const reduced = reducedMotion ?? prefers;
  const [revealed, setRevealed] = useState(false);
  const shown = reduced || revealed;
  const panel = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const foot = useRef<HTMLDivElement>(null);
  useFocusTrap(panel, { fallback: heading });

  useEffect(() => {
    if (reduced) return;
    const timer = window.setTimeout(() => setRevealed(true), PROMOTION_DONE_AT_MS);
    return () => window.clearTimeout(timer);
  }, [reduced]);

  useEffect(() => {
    if (shown) foot.current?.querySelector("button")?.focus();
  }, [shown]);

  const headingId = `${id}-rank`;
  return (
    <div ref={panel} className={styles.takeover} role="dialog" aria-modal="true" aria-labelledby={headingId} data-reduced={reduced ? "true" : undefined}>
      <div className={styles.badge}>
        <RankBadge rank={rank} size="xl" />
      </div>
      <div className={styles.hairline} aria-hidden="true" />
      <div className={styles.text}>
        <h2 ref={heading} id={headingId} tabIndex={-1} className={cx("ot-display-md", styles.rank)}>Rank {rank}</h2>
        <p className={cx("ot-heading", styles.title)}>{title}</p>
      </div>
      <div ref={foot} className={styles.foot}>
        <Button variant="primary" full className={styles.done} hidden={!shown} onClick={onDone}>Done</Button>
      </div>
    </div>
  );
}
