// The card: surface-1, a 1px line hairline, radius-md, space-4 padding.
// Panels separate by edge, never by shadow. `title` sets a heading above the
// content; `sunken` uses surface-0 for a panel inside a panel (the program
// preview in onboarding). Lists inside divide rows with `.ot-hairline`
// rather than nested panels.
import type { CSSProperties, ElementType, JSX, ReactNode } from "react";
import { cx } from "./cx";

export interface PanelProps {
  title?: ReactNode;
  sunken?: boolean;
  /** The element rendered; `section` by default. */
  as?: keyof JSX.IntrinsicElements;
  className?: string;
  /** Names the panel as a landmark region (for the set card, the quest card). */
  "aria-label"?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

export function Panel({ title, sunken, as = "section", className, style, children, "aria-label": label }: PanelProps) {
  const Tag: ElementType = as;
  return (
    <Tag className={cx("ot-panel", sunken && "ot-panel-sunken", className)} style={style} aria-label={label} role={label ? "region" : undefined}>
      {title ? <h2 className="ot-heading ot-panel-title">{title}</h2> : null}
      {children}
    </Tag>
  );
}
