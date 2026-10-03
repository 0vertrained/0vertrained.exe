// A 44×44 hit area around one 24px line icon. `label` is required: the glyph
// alone names nothing. `outlined` for an icon button that sits alone on a
// surface (the runner's Exit).
import type { ButtonHTMLAttributes } from "react";
import { cx } from "./cx";
import { Icon, type IconName } from "./Icon";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  name: IconName;
  label: string;
  outlined?: boolean;
  size?: number;
  rotate?: 0 | 90 | 180 | 270;
}

export function IconButton({ name, label, outlined, size = 24, rotate, className, type = "button", ...rest }: IconButtonProps) {
  return (
    <button type={type} className={cx("ot-iconbtn", outlined && "ot-iconbtn-outlined", className)} aria-label={label} {...rest}>
      <Icon name={name} size={size} rotate={rotate} />
    </button>
  );
}
