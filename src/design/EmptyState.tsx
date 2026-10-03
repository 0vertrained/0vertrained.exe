// Centred: an optional bracket tag, a heading, one sentence in ink-2 and
// exactly one Button. Every empty list and every first run gets one; none is
// allowed without an action. `tag` is the notice tag of the context, `title`
// says what is true, `body` what will change it, `action` how. `error`
// renders the error boundary: a 2px danger rule on top, role="alert",
// "Something broke." / "Your data is safe." and an action that reloads.
import { Button, type ButtonVariant } from "./Button";
import { cx } from "./cx";

export interface EmptyStateAction {
  label: string;
  onClick?: () => void;
  /** Primary unless said otherwise (the error boundary's Reload is secondary). */
  variant?: ButtonVariant;
}

export interface EmptyStateProps {
  /** The notice tag of the context ("QUEST", "RECORDS"). */
  tag?: string;
  /** What is true ("No records yet"). */
  title: string;
  /** What will change it ("Your first logged set becomes your first record."). */
  body?: string;
  action?: EmptyStateAction;
  error?: boolean;
  className?: string;
}

export function EmptyState({ tag, title, body, action, error, className }: EmptyStateProps) {
  return (
    <div className={cx("ot-empty", error && "ot-error", className)} role={error ? "alert" : undefined}>
      {tag ? <span className="ot-tag ot-empty-tag">{`[${tag}]`}</span> : null}
      <h2 className="ot-heading ot-m0">{title}</h2>
      {body ? <p className="ot-body ot-empty-body">{body}</p> : null}
      {action ? (
        <Button variant={action.variant ?? "primary"} onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}
