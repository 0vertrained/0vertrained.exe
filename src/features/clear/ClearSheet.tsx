// The Quest cleared reward sheet: the day's total in brass, one line per XP
// source, the level block with the XP fill (the first thing that moves,
// 200 ms after the sheet lands), records with the new value in brass, stat
// moves and the streak, a title line, the compact session summary. Done is
// the only way out, so the sheet has no Close. Presentational: the
// container hands it a ClearSummary.
import type { CSSProperties } from "react";
import { Button } from "../../design/Button";
import { cx } from "../../design/cx";
import { Icon } from "../../design/Icon";
import { Notice } from "../../design/Notice";
import { ProgressBar } from "../../design/ProgressBar";
import { Sheet } from "../../design/Sheet";
import { TierBadge } from "../../design/TierBadge";
import { formatWeight, type UnitSystem } from "../../domain/units";
import type { ClearRecord, ClearStat, ClearStreak, ClearSummary } from "./clearModel";
import styles from "./ClearSheet.module.css";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";
import { useXpFill } from "./useXpFill";

export interface ClearSheetProps {
  summary: ClearSummary;
  units: UnitSystem;
  onDone: () => void;
  /** Defaults to the device's prefers-reduced-motion setting. */
  reducedMotion?: boolean;
}

const group = (n: number): string => n.toLocaleString("en-US");

/** formatWeight with digit grouping: "9,840 lb". */
export function formatVolume(kg: number, units: UnitSystem): string {
  return formatWeight(kg, units).replace(/^\d+/, (digits) => group(Number(digits)));
}

/** "Rest Keeper unlocked." / "Rest Keeper and Trial Passed unlocked." */
export function titlesLine(titles: readonly string[]): string {
  const names = titles.length < 2 ? titles.join("") : `${titles.slice(0, -1).join(", ")} and ${titles[titles.length - 1]}`;
  return `${names} unlocked.`;
}

function RecordRow({ record }: { record: ClearRecord }) {
  return (
    <div className={styles.recordRow}>
      <span className="ot-body-strong">{record.label}</span>
      <span className="ot-numeral">
        <span className="ot-ink-2">{record.previousText} → </span>
        <span className="ot-brass">{record.currentText}</span>
      </span>
    </div>
  );
}

function StatCell({ stat }: { stat: ClearStat }) {
  return (
    <div>
      <div className="ot-tag ot-ink-2">{stat.name}</div>
      <div className="ot-numeral">
        <span className="ot-ink-2">{stat.before} → </span>
        {stat.after}
      </div>
    </div>
  );
}

function StreakCell({ streak }: { streak: ClearStreak }) {
  const shields = Array.from({ length: streak.shieldsTotal }, (_, i) => i < streak.shields);
  return (
    <div>
      <div className="ot-tag ot-ink-2">Streak</div>
      <div className={cx("ot-numeral", styles.streak)}>
        <span>{streak.days} {streak.days === 1 ? "day" : "days"}</span>
        <span className={styles.shields} role="img" aria-label={`${streak.shields} of ${streak.shieldsTotal} shields`}>
          {shields.map((held, i) => <Icon key={i} name="shield" size={14} className={held ? undefined : styles.shieldSpent} />)}
        </span>
      </div>
    </div>
  );
}

export function ClearSheet({ summary, units, onDone, reducedMotion }: ClearSheetProps) {
  const prefers = usePrefersReducedMotion();
  const reduced = reducedMotion ?? prefers;
  const { level } = summary;
  const fill = useXpFill({ from: level.previousFraction, to: level.fraction, leveledUp: level.leveledUp, reduced });
  const fillStyle = fill.fillMs === null ? undefined : ({ "--ot-fill": `${fill.fillMs}ms` } as CSSProperties);
  const duration = summary.summary.durationMinutes === null ? "—" : `${summary.summary.durationMinutes} min`;

  const title = (
    <span className={styles.title}>
      <span className={cx("ot-tag ot-brass", styles.tag)}>[Quest cleared]</span>
      <TierBadge tier={summary.tier} />
    </span>
  );

  return (
    <Sheet id="cleared" title={title} footer={<Button variant="primary" full onClick={onDone}>Done</Button>}>
      <div className={cx("ot-display-lg ot-brass", styles.total)}>+{summary.total} XP</div>
      <div>
        {summary.lines.map((line) => (
          <div key={line.key} className="ot-reward-line">
            <span>
              <span className="ot-body-strong">{line.label}</span>
              {line.sublabel ? <span className="ot-small ot-ink-2 ot-block">{line.sublabel}</span> : null}
            </span>
            <span className="ot-reward-xp">+{line.xp} XP</span>
          </div>
        ))}
      </div>

      <section className={styles.level} aria-label="Level">
        <div className={styles.levelHead}>
          <span className="ot-numeral">Lv {level.after}</span>
          <span className="ot-numeral-sm ot-ink-2">{group(level.into)} / {group(level.needed)} XP</span>
        </div>
        <div style={fillStyle}>
          <ProgressBar kind="xp" size="lg" value={fill.value} label={`Level ${level.after} progress`} />
        </div>
        {fill.showLevelUp ? (
          <div className={cx("ot-levelup", !reduced && "ot-rise")}>
            <span className="ot-tag">[Level up]</span>
            <span className="ot-body">Level {level.after}. {level.nextRankLine}</span>
          </div>
        ) : null}
      </section>

      {summary.records.length > 0 ? (
        <>
          <hr className="ot-hairline" />
          <section className={styles.block} aria-label="Records">
            <div className={cx("ot-tag ot-brass", styles.blockTag)}>[Record]</div>
            {summary.records.map((r) => <RecordRow key={`${r.kind}:${r.name}`} record={r} />)}
          </section>
        </>
      ) : null}

      <hr className="ot-hairline" />
      <div className={styles.grid}>
        {summary.stats.map((s) => <StatCell key={s.name} stat={s} />)}
        <StreakCell streak={summary.streak} />
      </div>

      {summary.titles.length > 0 ? (
        <Notice tag="TITLE" tone="brass" className={styles.titles}>{titlesLine(summary.titles)}</Notice>
      ) : null}

      <hr className="ot-hairline" />
      <div className={cx("ot-summary", styles.summary)}>
        <div><span className="ot-numeral">{duration}</span><span className="ot-caption">duration</span></div>
        <div><span className="ot-numeral">{summary.summary.sets}</span><span className="ot-caption">sets</span></div>
        <div><span className="ot-numeral">{formatVolume(summary.summary.volumeKg, units)}</span><span className="ot-caption">volume</span></div>
      </div>
    </Sheet>
  );
}
