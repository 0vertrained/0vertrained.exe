// Load and reps in the set card: the label (its unit under it) on the left,
// a 56×56 minus, the value in a 120px column, a 56×56 plus. The value is an
// inputMode="decimal" field so it can be typed; the buttons are the
// one-handed path. `step` is 5 for lb, 2.5 for kg, 1 for reps, 5 for seconds;
// the minus button disables at `min`. What is shown is what will be logged:
// the value never animates, and `disabled` (a set saving) never hides it.
import { useState, type ChangeEvent } from "react";
import { cx } from "./cx";
import { Icon } from "./Icon";
import { labelId } from "./ids";

export interface StepperProps {
  label: string;
  /** Shown under the label in the tag style ("Load  LB"). */
  unit?: string;
  /** Controlled value; pair with `onChange`. */
  value?: number;
  defaultValue?: number;
  step?: number;
  min?: number;
  max?: number;
  /** Receives the clamped value after a tap or a typed number. */
  onChange?: (value: number) => void;
  /** Overrides the display, e.g. seconds as "0:45" for holds. */
  format?: (value: number) => string;
  disabled?: boolean;
  id?: string;
  className?: string;
}

export function Stepper({ label, unit, value, defaultValue, step = 1, min = 0, max = Infinity, onChange, format, disabled, id, className }: StepperProps) {
  const controlled = value != null;
  const [inner, setInner] = useState(defaultValue ?? 0);
  // What the field shows while it is being typed in; cleared on blur so the
  // display snaps back to the clamped, formatted value.
  const [draft, setDraft] = useState<string | null>(null);
  const current = controlled ? value : inner;
  const inputId = id ?? labelId("ot-stepper", label);

  function set(next: number) {
    const clamped = Math.max(min, Math.min(max, next));
    if (!controlled) setInner(clamped);
    onChange?.(clamped);
  }
  function onInput(e: ChangeEvent<HTMLInputElement>) {
    setDraft(e.target.value);
    const n = parseFloat(e.target.value);
    if (!Number.isNaN(n)) set(n);
  }

  const shown = format ? format(current) : Number.isInteger(current) ? String(current) : current.toFixed(1);
  return (
    <div className={cx("ot-stepper", className)}>
      <div className="ot-stepper-label">
        <label htmlFor={inputId}>{label}</label>
        {unit ? <span className="ot-stepper-unit">{unit}</span> : null}
      </div>
      <button type="button" className="ot-stepper-btn" aria-label={`Decrease ${label}`} disabled={disabled || current <= min} onClick={() => set(current - step)}>
        <Icon name="minus" />
      </button>
      <input
        id={inputId}
        className="ot-stepper-value"
        inputMode="decimal"
        value={draft ?? shown}
        aria-label={unit ? `${label}, ${unit}` : label}
        disabled={disabled}
        onChange={onInput}
        onBlur={() => setDraft(null)}
      />
      <button type="button" className="ot-stepper-btn" aria-label={`Increase ${label}`} disabled={disabled || current >= max} onClick={() => set(current + step)}>
        <Icon name="plus" />
      </button>
    </div>
  );
}
