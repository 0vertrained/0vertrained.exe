// Equal segments in a 48px surface-2 track; the selected segment is
// surface-3 with a 1px chalk ring and ink text, the rest ink-2. role=
// "radiogroup" with radio segments, so it keys like native radios: arrows
// move the selection, Home/End jump to the ends, and only the selected
// segment is in the Tab order. Standalone for Units and Experience; `inline`
// adds a label column for the four check-in rows (Slept · Sore · Stress ·
// Energy). Options are one word each; never abbreviate them to fit. The
// selected segment is quiet on purpose: four rows of check-in should not
// look like four primary buttons.
import { useState, type KeyboardEvent } from "react";
import { cx } from "./cx";

export type SegmentedOption = string | { value: string; label: string };

export interface SegmentedControlProps {
  label: string;
  options: SegmentedOption[];
  /** Controlled value; pair with `onChange`. */
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  /** Renders the label column on the left for the check-in rows. */
  inline?: boolean;
  disabled?: boolean;
  className?: string;
}

const ARROW_STEP: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

export function SegmentedControl({ label, options, value, defaultValue, onChange, inline, disabled, className }: SegmentedControlProps) {
  const controlled = value != null;
  const [inner, setInner] = useState<string | null>(defaultValue ?? null);
  const val = controlled ? value : inner;
  const opts = options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  const selected = opts.findIndex((o) => o.value === val);
  const tabbable = selected >= 0 ? selected : 0;

  function select(index: number) {
    const o = opts[index];
    if (!o) return;
    if (!controlled) setInner(o.value);
    onChange?.(o.value);
  }
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const n = opts.length;
    if (n === 0) return;
    const radios = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
    const from = selected >= 0 ? selected : Math.max(0, radios.findIndex((r) => r === e.target));
    const step = ARROW_STEP[e.key];
    let next: number;
    if (step !== undefined) next = (from + step + n) % n;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    else return;
    e.preventDefault();
    select(next);
    radios[next]?.focus();
  }

  const group = (
    <div className={cx("ot-seg", className)} role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      {opts.map((o, i) => (
        <button key={o.value} type="button" role="radio" className="ot-seg-opt" aria-checked={val === o.value} tabIndex={i === tabbable ? 0 : -1} disabled={disabled} onClick={() => select(i)}>
          {o.label}
        </button>
      ))}
    </div>
  );
  if (!inline) return group;
  return (
    <div className="ot-seg-row">
      <span className="ot-seg-row-label">{label}</span>
      {group}
    </div>
  );
}
