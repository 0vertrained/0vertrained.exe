// The day's tier as a labelled, outlined tag: the word is always present and
// the colour only helps. FULL is chalk (the baseline day, in the UI's own
// material); REDUCED, RECOVER and REST carry a hue, none of them amber or
// red: a scaled day is an adjustment, not a warning. It is the only coloured
// element on a Quest card; the copy beside it explains the tier in one line.
import { cx } from "./cx";

export type Tier = "full" | "reduced" | "recover" | "rest";

const TIER_LABEL: Record<string, string> = { full: "Full", reduced: "Reduced", recover: "Recover", rest: "Rest" };

export interface TierBadgeProps {
  /** The design system's lowercase tier or the engine's uppercase one; both normalise. */
  tier: Tier | Uppercase<Tier>;
  /** sm 24px (quest log, day detail, check-in line), lg 32px (the Quest card). */
  size?: "sm" | "lg";
  className?: string;
}

export function TierBadge({ tier, size = "sm", className }: TierBadgeProps) {
  const t = tier.toLowerCase() as Tier;
  const label = TIER_LABEL[t] ?? t;
  return (
    <span className={cx("ot-tier", size === "lg" && "ot-tier-lg", className)} data-tier={t} role="img" aria-label={`Tier: ${label}`}>
      {label}
    </span>
  );
}
