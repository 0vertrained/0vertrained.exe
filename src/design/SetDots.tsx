// One 12px dot per set, left to right, each inside a 44px-tall hit area:
// done (chalk disc), current (2px chalk ring, aria-current="step"), planned
// (line-control ring), extra (dashed ink-3 ring: logged, no XP), trial (brass
// ring; brass disc once done) and pain (a chalk square). Done, trial-done and
// pain dots call `onEdit(index)`; planned, current, extra and open trial dots
// are inert and aria-disabled. Dots never carry numbers: the sticky button
// says "Complete set 2 of 4". Keep to a single row.
import { cx } from "./cx";
import styles from "./SetDots.module.css";

export type SetState = "done" | "current" | "planned" | "extra" | "trial" | "pain";
/** `'done'`, or `{ state: 'trial', done: true }` for a cleared trial set. */
export type SetEntry = SetState | { state: SetState; done?: boolean };

export interface SetDotsProps {
  sets: SetEntry[];
  onEdit?: (index: number) => void;
  /** Accessible name of the list; "Sets" by default. */
  label?: string;
  className?: string;
}

const DOT_TEXT: Record<SetState, string> = {
  done: "done",
  current: "current",
  planned: "planned",
  extra: "extra, no XP",
  trial: "rank trial",
  pain: "pain flagged",
};

export function SetDots({ sets, onEdit, label = "Sets", className }: SetDotsProps) {
  return (
    <div className={cx("ot-dots", className)} role="list" aria-label={label}>
      {sets.map((s, i) => {
        const state = typeof s === "string" ? s : s.state;
        const done = typeof s === "object" && s.done === true;
        const editable = state === "done" || (state === "trial" && done) || state === "pain";
        return (
          <div key={i} role="listitem" className={styles.item}>
            <button
              type="button"
              className="ot-dot"
              data-state={state}
              data-done={done ? "true" : undefined}
              aria-label={`Set ${i + 1}, ${DOT_TEXT[state]}${editable ? ". Edit" : ""}`}
              aria-disabled={editable ? undefined : true}
              aria-current={state === "current" ? "step" : undefined}
              tabIndex={editable ? undefined : -1}
              onClick={editable && onEdit ? () => onEdit(i) : undefined}
            >
              <span className="ot-dot-glyph" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
