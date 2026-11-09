// src/RaceWeekLine.jsx
// One ruled line on Today: where you are in the race plan.
//   RACE PLAN · WEEK 3 OF 12            68 DAYS
//   Base · 140 min of running this week
// Display only — reads the resolved program's `__raceBuild` marker through
// describeBuildWeek.
// Renders nothing when no plan is active.

import { useTheme } from "./theme";
import { describeBuildWeek } from "./raceBuild";

export function formatPlanDate(dateKey) {
  const d = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateKey || "";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

/** Pure copy for the line — exported for tests. Null when there's no plan. */
export function raceWeekCopy(desc) {
  if (!desc) return null;
  const countdown = desc.daysToRace === 0 ? "Race day" : desc.daysToRace === 1 ? "Tomorrow" : `${desc.daysToRace} days`;
  if (desc.pending) {
    return {
      eyebrow: `Race plan · starts ${formatPlanDate(desc.startsOn)}`,
      main: `${desc.totalWeeks} weeks to ${desc.raceName}`,
      countdown,
    };
  }
  const phase = String(desc.label || "").split("—")[1]?.trim() || desc.label || "";
  const minutes = Number.isFinite(desc.totalRunMinutes) && desc.totalRunMinutes > 0 && desc.phase !== "race"
    ? ` · ${desc.totalRunMinutes} min of running this week`
    : "";
  return {
    eyebrow: `Race plan · week ${desc.weekIndex + 1} of ${desc.totalWeeks}`,
    main: `${phase}${minutes}`,
    countdown,
  };
}

export function RaceWeekLine({ program, dateKey }) {
  const { C, S } = useTheme();
  const copy = raceWeekCopy(describeBuildWeek(program, dateKey));
  if (!copy) return null;
  return (
    <div
      data-plate="race-week"
      style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "13px 16px", borderBottom: `1px solid ${C.line}`, background: C.bg }}
    >
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontFamily: S.fontAnnot, fontSize: 10.5, letterSpacing: "0.14em", textTransform: "uppercase", color: C.textDim }}>{copy.eyebrow}</span>
        <span style={{ display: "block", fontFamily: S.fontMain, fontSize: 14, fontWeight: 500, color: C.text, marginTop: 3 }}>{copy.main}</span>
      </span>
      <span style={{ fontFamily: S.fontAnnot, fontSize: 11, color: C.textFaint, letterSpacing: "0.08em", textTransform: "uppercase", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{copy.countdown}</span>
    </div>
  );
}

export default RaceWeekLine;
