// Seven day markers for the current week, then the weekly quest row. Each day
// is a 44px-tall button (`onDay`) that opens the day-detail sheet: kept (chalk
// disc + check), rest (tier-rest ring and dot: a rest day earns XP), protected
// (brass ring + shield: a shield spent to keep the streak), open (nothing
// yet), missed (ink-3 ring with a dash: neutral, never red) and upcoming
// (dotted ring). `today` is a modifier on any state. The strip reports; it
// does not scold: a missed day weighs the same as an upcoming one.
import { cx } from "./cx";
import { Icon } from "./Icon";
import { ProgressBar } from "./ProgressBar";

export type DayState = "kept" | "rest" | "protected" | "open" | "missed" | "upcoming";

export interface WeekDay {
  /** The day letter shown in the marker. */
  label: string;
  /** The full name for the accessible label ("Monday"); falls back to `label`. */
  name?: string;
  state: DayState;
  today?: boolean;
  /** What the day paid, shown under the marker. */
  xp?: number;
}

export interface WeekStripProps {
  days: WeekDay[];
  weekly?: { label?: string; progress: string; xp?: number; value: number };
  onDay?: (index: number, day: WeekDay) => void;
  className?: string;
}

const DAY_TEXT: Record<DayState, string> = {
  kept: "kept",
  rest: "rest day",
  protected: "protected by a shield",
  open: "open",
  missed: "nothing logged",
  upcoming: "upcoming",
};

export function WeekStrip({ days, weekly, onDay, className }: WeekStripProps) {
  return (
    <div className={cx("ot-weekstrip", className)}>
      <div className="ot-week" role="list" aria-label="This week">
        {days.map((d, i) => (
          <div key={i} role="listitem">
            <button
              type="button"
              className="ot-day"
              data-state={d.state}
              data-today={d.today ? "true" : undefined}
              aria-label={`${d.name ?? d.label}${d.today ? ", today" : ""}: ${DAY_TEXT[d.state]}${d.xp ? `, ${d.xp} XP` : ""}`}
              onClick={onDay ? () => onDay(i, d) : undefined}
            >
              <span className="ot-day-letter" aria-hidden="true">{d.label}</span>
              <span className="ot-day-mark" aria-hidden="true">
                {d.state === "kept" ? <Icon name="check" size={16} /> : d.state === "protected" ? <Icon name="shield" size={14} /> : null}
              </span>
              <span className="ot-day-num" aria-hidden="true">{d.xp != null ? d.xp : " "}</span>
            </button>
          </div>
        ))}
      </div>
      {weekly ? (
        <div className="ot-weekly">
          <span className="ot-body-strong">{weekly.label ?? "Weekly quest"}</span>
          <span className="ot-numeral-sm ot-ink-2">{weekly.progress}{weekly.xp ? ` · +${weekly.xp} XP` : ""}</span>
          <ProgressBar kind="objective" size="thin" value={weekly.value || 0} label="Weekly quest progress" />
        </div>
      ) : null}
    </div>
  );
}
