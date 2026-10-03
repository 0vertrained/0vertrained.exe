// One objective of the day's quest: a state mark, the label, and on the
// right its progress and XP value. `not-started` is an empty ring,
// `in-progress` a chalk ring with a dot (and a thin objective bar under the
// label when `progress` has a total), `done` a chalk disc with a check. XP
// is ink-2 until the row is done, then brass: XP turns brass only when
// earned. Rows are not tappable by default; `onClick` makes the row a button
// for the few rows that open something (the stat explain sheet pattern).
import { cx } from "./cx";
import { Icon } from "./Icon";
import { ProgressBar } from "./ProgressBar";

export type ObjectiveState = "not-started" | "in-progress" | "done";

export interface ObjectiveProgress {
  done: number;
  total: number;
  unit?: string;
}

export interface ObjectiveRowProps {
  /** The thing to do ("Training", "Run", "Recovery"), never a sentence. */
  label: string;
  sublabel?: string;
  state?: ObjectiveState;
  /** {done,total,unit} renders "7/12 sets"; a string renders as given ("25 min"). */
  progress?: ObjectiveProgress | string;
  /** XP value; ink-2 until done, brass when done. */
  xp?: number;
  onClick?: () => void;
  className?: string;
}

const STATE_TEXT: Record<ObjectiveState, string> = { "not-started": "Not started. ", "in-progress": "In progress. ", done: "Done. " };

export function ObjectiveRow({ label, sublabel, state = "not-started", progress, xp, onClick, className }: ObjectiveRowProps) {
  const detailed = typeof progress === "object" ? progress : null;
  const ptext = typeof progress === "string" ? progress : detailed ? `${detailed.done}/${detailed.total}${detailed.unit ? ` ${detailed.unit}` : ""}` : null;
  const frac = detailed && detailed.total ? detailed.done / detailed.total : 0;
  const cls = cx("ot-obj", className);
  const body = (
    <>
      <span className="ot-obj-mark" aria-hidden="true">{state === "done" ? <Icon name="check" size={16} /> : null}</span>
      <span>
        <span className="ot-obj-label">{label}</span>
        {sublabel ? <span className="ot-obj-sub ot-block">{sublabel}</span> : null}
        {state === "in-progress" && detailed ? <ProgressBar kind="objective" size="thin" value={frac} label={`${label} progress`} /> : null}
        <span className="ot-visually-hidden">{STATE_TEXT[state]}</span>
      </span>
      <span className="ot-obj-right">
        {ptext ? <span className="ot-obj-progress">{ptext}</span> : null}
        {xp != null ? <span className="ot-obj-xp">{`+${xp} XP`}</span> : null}
      </span>
    </>
  );
  return onClick ? (
    <button type="button" className={cls} data-state={state} onClick={onClick}>{body}</button>
  ) : (
    <div className={cls} data-state={state}>{body}</div>
  );
}
