// The 40px strip at the top of every tab: rank tile (24px), "Lv 17", a thin
// brass XP bar, the streak (flame, days, one shield glyph per shield: brass
// if held, ink-3 if spent) and the sync indicator. A Guest chip appears in
// guest mode. Sync is quiet by default: synced is an ink-3 dot and nothing
// else; saving pulses a chalk dot with the word; offline shows the icon and
// the count of queued days (not a warning); conflict shows a check and
// "Merged" for a few seconds. The strip never grows a second line, and
// nothing in it is tappable except the rank tile, which opens Stats (`onRank`).
import { cx } from "./cx";
import { Icon } from "./Icon";
import { ProgressBar } from "./ProgressBar";
import { RankBadge, type RankLetter } from "./RankBadge";
import styles from "./StatusStrip.module.css";

export type SyncState = "synced" | "saving" | "offline" | "conflict";

export interface StatusStripProps {
  rank: RankLetter | Uppercase<RankLetter>;
  level: number;
  xp: { value: number; max: number };
  streak?: { days: number; shields: number; shieldsTotal: number };
  sync?: { state: SyncState; count?: number };
  guest?: boolean;
  /** Makes the rank tile a button labelled "Rank C. Open Stats". */
  onRank?: () => void;
  className?: string;
}

function SyncNode({ sync }: { sync: NonNullable<StatusStripProps["sync"]> }) {
  if (sync.state === "offline") {
    return (
      <span className="ot-strip-sync" role="status" aria-live="polite">
        <Icon name="offline" size={16} />
        <span>{sync.count ?? "Offline"}</span>
      </span>
    );
  }
  if (sync.state === "conflict") {
    return (
      <span className="ot-strip-sync" role="status" aria-live="polite">
        <Icon name="check" size={16} />
        <span>Merged</span>
      </span>
    );
  }
  return (
    <span className="ot-strip-sync" role="status" aria-live="polite" aria-label={sync.state === "saving" ? "Saving" : "Synced"}>
      <span className="ot-sync-dot" data-sync={sync.state} />
      {sync.state === "saving" ? <span>Saving</span> : null}
    </span>
  );
}

export function StatusStrip({ rank, level, xp, streak = { days: 0, shields: 0, shieldsTotal: 2 }, sync = { state: "synced" }, guest, onRank, className }: StatusStripProps) {
  const shields = Array.from({ length: streak.shieldsTotal }, (_, i) => (
    <Icon key={i} name="shield" size={14} className={i < streak.shields ? undefined : "ot-shield-used"} />
  ));
  const badge = <RankBadge rank={rank} size="sm" />;
  return (
    <header className={cx("ot-strip", className)}>
      {onRank ? (
        <button type="button" className={cx("ot-focus", styles.rank)} aria-label={`Rank ${rank.toUpperCase()}. Open Stats`} onClick={onRank}>
          {badge}
        </button>
      ) : badge}
      <span className="ot-strip-level">Lv {level}</span>
      <ProgressBar kind="xp" size="thin" value={xp.max > 0 ? xp.value / xp.max : 0} label={`XP ${xp.value} of ${xp.max}`} />
      {guest ? <span className="ot-chip">Guest</span> : null}
      <span className="ot-strip-streak" aria-label={`Streak ${streak.days} days, ${streak.shields} of ${streak.shieldsTotal} shields`}>
        <Icon name="flame" size={16} />
        <span>{streak.days}</span>
        <span className="ot-strip-shields" aria-hidden="true">{shields}</span>
      </span>
      <SyncNode sync={sync} />
    </header>
  );
}
