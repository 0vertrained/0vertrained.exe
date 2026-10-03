// The rows and tiles the Stats panels and their sheets share: a record row
// (name in body-strong, the est. max or best in numeral, the date in
// caption, a sparkline of the last 90 days) and the titles grid (unlocked
// tiles in ink that feature a title on tap, locked tiles with a lock Icon
// and the requirement in small/ink-3).
import { cx } from "../../design/cx";
import { Icon } from "../../design/Icon";
import { Sparkline } from "../../design/Sparkline";
import type { RecordRow, TitleTile } from "./statsView";
import styles from "./StatsRows.module.css";

export function RecordRowView({ row }: { row: RecordRow }) {
  return (
    <li className={styles.record}>
      <div className={styles.recordText}>
        <span className="ot-body-strong">{row.name}</span>
        <span className="ot-numeral">{row.valueText}</span>
        <span className="ot-caption ot-ink-2">{row.dateText}</span>
      </div>
      <div className={styles.spark}>
        <Sparkline data={row.series} width={96} />
      </div>
    </li>
  );
}

export interface RecordListProps {
  rows: RecordRow[];
  label: string;
}

export function RecordList({ rows, label }: RecordListProps) {
  return (
    <ul className={styles.list} aria-label={label}>
      {rows.map((row) => <RecordRowView key={row.key} row={row} />)}
    </ul>
  );
}

export interface TitleGridProps {
  tiles: TitleTile[];
  label: string;
  /** Called with the title to feature. */
  onFeature: (title: string) => void;
}

export function TitleGrid({ tiles, label, onFeature }: TitleGridProps) {
  return (
    <ul className={styles.titles} aria-label={label}>
      {tiles.map((t) => (
        <li key={t.id}>
          {t.unlocked ? (
            <button type="button" className={cx(styles.tile, styles.unlocked)} aria-pressed={t.featured} onClick={() => onFeature(t.title)}>
              <span className="ot-body-strong">{t.title}</span>
              {/* aria-pressed carries the state; the caption is for the eye, so the name stays the title. */}
              {t.featured ? <span className="ot-caption ot-ink-2" aria-hidden="true">Featured</span> : null}
            </button>
          ) : (
            <div className={cx(styles.tile, styles.locked)}>
              <span className={styles.lockRow}>
                <Icon name="lock" size={16} />
                <span className="ot-small-strong">{t.title}</span>
              </span>
              <span className="ot-small ot-ink-3">{t.requirement}</span>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
