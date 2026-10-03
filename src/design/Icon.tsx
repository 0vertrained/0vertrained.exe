// The 19-glyph line set from the design system: 24px grid, 1.75 stroke,
// round caps and joins, drawn in currentColor so an icon takes the colour of
// its text. Decorative beside a label (no `label`): aria-hidden. Alone in a
// control: the control carries the label (IconButton does).
import { cx } from "./cx";

export const ICONS = {
  quest: ["M6 21V4", "M6 4h11l-2.5 4 2.5 4H6"],
  stats: ["M5 20V12", "M12 20V5", "M19 20V9"],
  profile: ["M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M4.5 20.5a7.5 7.5 0 0 1 15 0"],
  check: ["M5 12.5l4.5 4.5L19 7.5"],
  lock: ["M7 11V8a5 5 0 0 1 10 0v3", "M5 11h14v9H5z"],
  flame: ["M12 3c3.3 3.3 6 6.2 6 9.8a6 6 0 0 1-12 0c0-1.7.6-3.2 1.6-4.5.4 1.2 1.2 2.1 2.2 2.6C9.3 8.3 10.2 5.5 12 3z"],
  shield: ["M12 3.5l7 2.5v5.5c0 4.3-3 7.6-7 9-4-1.4-7-4.7-7-9V6z"],
  chevron: ["M9.5 5.5l6.5 6.5-6.5 6.5"],
  more: ["M6 12h.01", "M12 12h.01", "M18 12h.01"],
  swap: ["M4 8h13l-3-3", "M20 16H7l3 3"],
  skip: ["M5 6l9 6-9 6z", "M18.5 6v12"],
  pain: ["M12 4.5v9", "M12 18.5v.5", "M12 21.5a9.5 9.5 0 1 0 0-19 9.5 9.5 0 0 0 0 19z"],
  timer: ["M12 21a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15z", "M12 9.5v4l2.5 2", "M9.5 3h5", "M12 3v3"],
  offline: ["M4 4l16 16", "M5 10.5a10 10 0 0 1 14 0", "M8.5 14a5 5 0 0 1 7 0", "M12 18h.01"],
  close: ["M6 6l12 12", "M18 6L6 18"],
  plus: ["M12 5v14", "M5 12h14"],
  minus: ["M5 12h14"],
  pause: ["M8 5v14", "M16 5v14"],
  exit: ["M14 5H6v14h8", "M19 12h-9", "M15 8l4 4-4 4"],
} as const;

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

export interface IconProps {
  name: IconName;
  /** 24 in controls and tabs, 20 inside buttons, 16 inline, 14 in day markers. Never below 14. */
  size?: number;
  /** Makes the icon meaningful on its own (role="img"); omit when a label sits beside it. */
  label?: string;
  /** `chevron` points right: 90 for down, 180 for back, 270 for up. */
  rotate?: number;
  className?: string;
}

export function Icon({ name, size = 24, label, rotate = 0, className }: IconProps) {
  return (
    <svg
      className={cx("ot-icon", className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={rotate ? { transform: `rotate(${rotate}deg)` } : undefined}
    >
      {ICONS[name].map((d) => <path key={d} d={d} />)}
    </svg>
  );
}
