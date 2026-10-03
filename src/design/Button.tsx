// One primary action per screen; everything else is secondary or ghost.
// Labels are verbs in sentence case, with the count when there is one
// ("Complete set 2 of 4"). `danger` is destructive only and always behind a
// Dialog. Disabled stays readable: the day's final state lives here.
import type { ButtonHTMLAttributes } from "react";
import { cx } from "./cx";
import { Icon, type IconName } from "./Icon";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** 56px for the sticky primary in the runner; `sm` is the 36px in-row button. */
  size?: "md" | "lg" | "sm";
  full?: boolean;
  /** Hides the label behind a spinner and disables the button; keeps the variant's fill. */
  loading?: boolean;
  /** A 20px line icon before the label. */
  icon?: IconName;
  /** Marks the screen's one primary action for the active-layer test. */
  primary?: boolean;
}

export function Button({ variant = "secondary", size = "md", full, loading, icon, primary, className, children, type = "button", disabled, ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx("ot-btn", `ot-btn-${variant}`, size === "lg" && "ot-btn-lg", size === "sm" && "ot-btn-sm", full && "ot-btn-full", className)}
      aria-busy={loading ? true : undefined}
      disabled={disabled || loading ? true : undefined}
      data-primary={primary || variant === "primary" ? "true" : undefined}
      {...rest}
    >
      {loading ? <span className="ot-spinner" aria-hidden="true" /> : null}
      {icon ? <Icon name={icon} size={20} /> : null}
      <span className="ot-btn-label">{children}</span>
    </button>
  );
}
