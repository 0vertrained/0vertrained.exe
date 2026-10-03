// A stat's name (tag, ink-2), its value (display-md), a four-week sparkline
// and a delta line in words. `onClick` makes the tile a button named
// "STR 43, +4 in 4 weeks. Explain." that opens the explain sheet. Up is ink;
// steady and down are ink-2. Down is never red, never an arrow, never a
// warning: a stat that drops is information, not a verdict. Brass never
// appears on a tile; stat changes are celebrated once, on the reward sheet.
import { cx } from "./cx";
import { Sparkline } from "./Sparkline";

export type StatDeltaKind = "up" | "steady" | "down";

export interface StatDelta {
  kind: StatDeltaKind;
  /** Carries the meaning: "+4 in 4 weeks", "steady", "−2 in 4 weeks". */
  text: string;
}

export interface StatTileProps {
  name: string;
  value: number | string;
  /** The raw weekly values behind the sparkline. */
  series?: number[];
  delta?: StatDelta;
  onClick?: () => void;
  className?: string;
}

const STEADY: StatDelta = { kind: "steady", text: "steady" };

export function StatTile({ name, value, series = [], delta = STEADY, onClick, className }: StatTileProps) {
  const cls = cx("ot-stat", className);
  const body = (
    <>
      <div className="ot-stat-name">{name}</div>
      <div className="ot-stat-value">{value}</div>
      <Sparkline data={series} />
      <div className="ot-stat-delta">{delta.text}</div>
    </>
  );
  return onClick ? (
    <button type="button" className={cls} data-delta={delta.kind} onClick={onClick} aria-label={`${name} ${value}, ${delta.text}. Explain.`}>
      {body}
    </button>
  ) : (
    <div className={cls} data-delta={delta.kind}>{body}</div>
  );
}
