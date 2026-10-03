// The bottom sheet for every flow that is not a tab or a runner: surface-2,
// radius-lg top corners, a 36×4 grabber, a heading title with a 44px Close,
// a scrolling body and a footer that holds the sheet's one primary button.
// It is the modal: focus moves to the first control in the body (then the
// footer, else the title) on open, Tab stays inside, Escape and the scrim
// call `onClose`, and focus returns to the opener on close. The only thing
// above it is a confirm Dialog it opened.
import { useRef, type ReactNode } from "react";
import { cx } from "./cx";
import { IconButton } from "./IconButton";
import { useFocusTrap } from "./useFocusTrap";

export interface SheetProps {
  title: ReactNode;
  /** Renders nothing when false; otherwise the sheet is open. */
  open?: boolean;
  onClose?: () => void;
  /** The primary button, and at most one secondary under it. */
  footer?: ReactNode;
  id?: string;
  className?: string;
  children?: ReactNode;
}

export function Sheet(props: SheetProps) {
  if (props.open === false) return null;
  return <SheetPanel {...props} />;
}

function SheetPanel({ title, onClose, footer, id = "ot-sheet", className, children }: SheetProps) {
  const panel = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const foot = useRef<HTMLDivElement>(null);
  useFocusTrap(panel, { initialFocus: [body, foot], fallback: heading, onEscape: onClose });
  const titleId = `${id}-title`;
  return (
    <div className={cx("ot-sheet-layer", className)}>
      <div className="ot-scrim" onClick={onClose} />
      <div ref={panel} className="ot-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="ot-sheet-grabber" aria-hidden="true" />
        <div className="ot-sheet-head">
          <h2 ref={heading} id={titleId} className="ot-heading ot-sheet-title" tabIndex={-1}>{title}</h2>
          {onClose ? <IconButton name="close" label="Close" onClick={onClose} /> : null}
        </div>
        <div ref={body} className="ot-sheet-body">{children}</div>
        {footer ? <div ref={foot} className="ot-sheet-foot">{footer}</div> : null}
      </div>
    </div>
  );
}
