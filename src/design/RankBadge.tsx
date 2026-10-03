// The rank letter in a square tile. E, D, C are outlined (slate, moss,
// copper); B and A are filled (bronze, silver); S is gold with an inset
// hallmark frame. The letter is always present: never a rank by colour alone.
import { cx } from "./cx";

export type RankLetter = "e" | "d" | "c" | "b" | "a" | "s";
export type RankBadgeSize = "sm" | "md" | "lg" | "xl";

export interface RankBadgeProps {
  rank: RankLetter | Uppercase<RankLetter>;
  /** sm 24px (strip, log), md 40px (titles, trial sheet), lg 56px (Stats), xl 96px (promotion). */
  size?: RankBadgeSize;
  className?: string;
}

export function RankBadge({ rank, size = "sm", className }: RankBadgeProps) {
  const letter = rank.toLowerCase() as RankLetter;
  return (
    <span className={cx("ot-rank", size !== "sm" && `ot-rank-${size}`, className)} data-rank={letter} role="img" aria-label={`Rank ${letter.toUpperCase()}`}>
      {letter.toUpperCase()}
    </span>
  );
}
