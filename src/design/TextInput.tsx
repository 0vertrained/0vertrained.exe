// A label in small-strong/ink-2, the 48px field (surface-2, line-control
// border, 16px text so iOS does not zoom), and one line under it: a hint in
// ink-3 or an error in danger. `multiline` gives a 96px textarea and, with
// `maxLength`, a counter in the label row ("0/140"). Placeholders are
// examples, not instructions ("e.g. tweaked left knee"). Errors say what to
// do; the field gets aria-invalid and the message is announced. Pass
// `inputMode` for numeric fields and `autoComplete` for sign-in. Labels
// never float or disappear.
import { useState, type ChangeEvent, type FocusEvent, type InputHTMLAttributes, type KeyboardEvent } from "react";
import { cx } from "./cx";
import { labelId } from "./ids";

type Field = HTMLInputElement | HTMLTextAreaElement;

export interface TextInputProps {
  label: string;
  /** Controlled value; pair with `onChange`. */
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  hint?: string;
  /** Replaces the hint, marks the field invalid and is announced. */
  error?: string;
  type?: string;
  inputMode?: InputHTMLAttributes<HTMLInputElement>["inputMode"];
  autoComplete?: string;
  multiline?: boolean;
  maxLength?: number;
  disabled?: boolean;
  name?: string;
  onChange?: (value: string) => void;
  onBlur?: (e: FocusEvent<Field>) => void;
  onKeyDown?: (e: KeyboardEvent<Field>) => void;
  id?: string;
  className?: string;
}

export function TextInput({ label, value, defaultValue, placeholder, hint, error, type = "text", inputMode, autoComplete, multiline, maxLength, disabled, name, onChange, onBlur, onKeyDown, id, className }: TextInputProps) {
  const fieldId = id ?? labelId("ot-input", label);
  const controlled = value != null;
  const [inner, setInner] = useState(defaultValue ?? "");
  const val = controlled ? value : inner;
  const shared = {
    id: fieldId,
    className: "ot-input",
    placeholder,
    value: val,
    maxLength,
    disabled,
    autoComplete,
    name,
    inputMode,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? `${fieldId}-err` : hint ? `${fieldId}-hint` : undefined,
    onChange: (e: ChangeEvent<Field>) => {
      if (!controlled) setInner(e.target.value);
      onChange?.(e.target.value);
    },
    onBlur,
    onKeyDown,
  };
  return (
    <div className={cx("ot-field", className)}>
      <label className="ot-field-label" htmlFor={fieldId}>
        <span>{label}</span>
        {maxLength ? <span className="ot-field-count" aria-hidden="true">{val.length}/{maxLength}</span> : null}
      </label>
      {multiline ? <textarea {...shared} /> : <input {...shared} type={type} />}
      {error ? (
        <span id={`${fieldId}-err`} className="ot-field-error" role="alert">{error}</span>
      ) : hint ? (
        <span id={`${fieldId}-hint`} className="ot-field-hint">{hint}</span>
      ) : null}
    </div>
  );
}
