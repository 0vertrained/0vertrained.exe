// A row with a label, an optional sublabel in small/ink-2, and the 48×28
// switch on the right: off is a surface-3 track with an ink-2 knob, on is a
// chalk track with an on-chalk knob. role="switch", labelled by the row text;
// the row is at least 48px tall. For settings that take effect immediately
// (rest-timer sound, haptics) and "Ill or injured" in the check-in sheet,
// where the sublabel shows the pause allowance left. Never for an action
// that needs a confirm: that is a Button and a Dialog.
import { useState } from "react";
import { cx } from "./cx";
import { labelId } from "./ids";

export interface SwitchProps {
  label: string;
  sublabel?: string;
  /** Controlled state; pair with `onChange`. */
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (on: boolean) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
}

export function Switch({ label, sublabel, checked, defaultChecked, onChange, disabled, id, className }: SwitchProps) {
  const controlled = checked != null;
  const [inner, setInner] = useState(defaultChecked === true);
  const on = controlled ? checked : inner;
  const labelledBy = `${id ?? labelId("ot-switch", label)}-label`;
  return (
    <div className={cx("ot-switch-row", className)}>
      <span id={labelledBy}>
        <span className="ot-body-strong ot-block">{label}</span>
        {sublabel ? <span className="ot-small ot-block ot-ink-2">{sublabel}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        className="ot-switch"
        aria-checked={on}
        aria-labelledby={labelledBy}
        disabled={disabled}
        onClick={() => {
          if (!controlled) setInner(!on);
          onChange?.(!on);
        }}
      />
    </div>
  );
}
