// What a day looks like read back, inside the day-detail sheet: the status
// word and the reason line, what the day paid, the sets as logged (one
// line per exercise), cardio, the check-in words and any records. Purely
// presentational: the sheet hands it a DayDetail.
import { cx } from "../../design/cx";
import styles from "./log.module.css";
import type { DayDetail } from "./logView";

export interface DayDetailBodyProps {
  detail: DayDetail;
}

export function DayDetailBody({ detail }: DayDetailBodyProps) {
  return (
    <div className={styles.detail}>
      <div>
        <span className="ot-small ot-ink-2 ot-block">{detail.statusWord}</span>
        {detail.reason ? <p className="ot-body ot-ink-2 ot-m0">{detail.reason}</p> : null}
      </div>

      {detail.lines.length > 0 ? (
        <section aria-label="XP">
          {detail.lines.map((line, i) => (
            <div key={`${line.label}-${i}`} className="ot-reward-line">
              <span className="ot-body">{line.label}</span>
              <span className="ot-reward-xp">+{line.xp} XP</span>
            </div>
          ))}
        </section>
      ) : null}

      {detail.exercises.length > 0 ? (
        <section aria-label="Exercises">
          <h3 className={cx("ot-tag ot-ink-2", styles.blockTag)}>Exercises</h3>
          <ul className={styles.plain}>
            {detail.exercises.map((e, i) => (
              <li key={`${e.name}-${i}`}>
                <span className="ot-body-strong">{e.name}</span>
                {e.skipped ? <span className="ot-small ot-ink-2 ot-block">Skipped · {e.skipped}</span> : null}
                {e.sets.length > 0 ? <span className="ot-numeral-sm ot-block">{e.sets.join(" · ")}</span> : null}
                {e.pain ? <span className="ot-small ot-ink-2 ot-block">Pain flagged</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {detail.cardio.length > 0 ? (
        <section aria-label="Cardio">
          <h3 className={cx("ot-tag ot-ink-2", styles.blockTag)}>Cardio</h3>
          <ul className={styles.plain}>
            {detail.cardio.map((c, i) => (
              <li key={`${c.kind}-${i}`} className={styles.cardio}>
                <span className="ot-body-strong">{c.kind}</span>
                <span className="ot-numeral-sm">{c.text}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {detail.checkin.length > 0 || detail.note ? (
        <section aria-label="Check-in">
          <h3 className={cx("ot-tag ot-ink-2", styles.blockTag)}>Check-in</h3>
          {detail.checkin.length > 0 ? <p className="ot-small ot-m0">{detail.checkin.join(" · ")}</p> : null}
          {detail.note ? <p className="ot-small ot-ink-2 ot-m0">{detail.note}</p> : null}
        </section>
      ) : null}

      {detail.records.length > 0 ? (
        <section aria-label="Records">
          <h3 className={cx("ot-tag ot-brass", styles.blockTag)}>[Record]</h3>
          <ul className={styles.plain}>
            {detail.records.map((r) => (
              <li key={r} className="ot-body">{r}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
