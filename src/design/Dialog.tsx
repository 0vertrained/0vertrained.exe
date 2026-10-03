// Confirm only: a title, one sentence of consequence, and two equal buttons,
// Cancel (secondary) and the action (primary, or `danger` when it destroys).
// The body states what happens and what does not; the confirm label repeats
// the verb ("Switch preset", "Delete account"), never "OK". role="alertdialog"
// above any sheet: focus lands on Cancel, Tab stays inside, Escape cancels,
// the scrim does nothing, and focus returns to the opener on close. A dialog
// never contains an input, a list or a second question.
import { useRef } from "react";
import { Button } from "./Button";
import { cx } from "./cx";
import { useFocusTrap } from "./useFocusTrap";

export interface DialogProps {
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** The action destroys something: the confirm button is the danger variant. */
  danger?: boolean;
  /** Renders nothing when false; otherwise the dialog is open. */
  open?: boolean;
  onConfirm?: () => void;
  onCancel?: () => void;
  id?: string;
  className?: string;
}

export function Dialog(props: DialogProps) {
  if (props.open === false) return null;
  return <DialogPanel {...props} />;
}

function DialogPanel({ title, body, confirmLabel = "Confirm", cancelLabel = "Cancel", danger, onConfirm, onCancel, id = "ot-dialog", className }: DialogProps) {
  const panel = useRef<HTMLDivElement>(null);
  const actions = useRef<HTMLDivElement>(null);
  useFocusTrap(panel, { initialFocus: [actions], onEscape: onCancel });
  const titleId = `${id}-title`;
  const bodyId = `${id}-body`;
  return (
    <div className={cx("ot-dialog-layer", className)}>
      <div className="ot-scrim" />
      <div ref={panel} className="ot-dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId}>
        <h2 id={titleId} className="ot-heading ot-dialog-title">{title}</h2>
        <p id={bodyId} className="ot-body ot-dialog-body">{body}</p>
        <div ref={actions} className="ot-dialog-actions">
          <Button variant="secondary" onClick={onCancel}>{cancelLabel}</Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
}
