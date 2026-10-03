// The log's rows, shared by the Stats panel and the log screen: one
// full-width button per day (44px minimum), hairline-separated, carrying
// the date, the tier as a word, the status word and the XP in the mono.
import { cx } from "../../design/cx";
import { TierBadge } from "../../design/TierBadge";
import type { DateKey } from "../../domain/dates";
import styles from "./log.module.css";
import { groupDigits, type LogRow } from "./logView";

export interface LogRowsProps {
  rows: LogRow[];
  onOpen: (dateKey: DateKey) => void;
}

/** "+130 XP", or a dash for a day that paid nothing. */
export const xpText = (xp: number): string => (xp > 0 ? `+${groupDigits(xp)} XP` : "—");

export function LogRows({ rows, onOpen }: LogRowsProps) {
  return (
    <ul className={styles.list} aria-label="Logged days">
      {rows.map((row) => (
        <li key={row.dateKey}>
          <button type="button" className={styles.row} onClick={() => onOpen(row.dateKey)}>
            <span className={cx("ot-body-strong", styles.date)}>{row.dateText}</span>
            {row.tier ? <TierBadge tier={row.tier} size="sm" /> : null}
            <span className={cx("ot-small ot-ink-2", styles.status)}>{row.statusWord}</span>
            <span className={cx("ot-numeral-sm", row.xp > 0 ? undefined : "ot-ink-3", styles.xp)}>{xpText(row.xp)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
