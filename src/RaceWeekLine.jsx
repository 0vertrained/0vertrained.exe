// src/RaceWeekLine.jsx
// One row in Today's plan: where you are in the race plan.
//   Race plan · week 3 of 12            68 days
//   Base · 140 min of running this week
// Display only — reads the resolved program's `__raceBuild` marker through
// describeBuildWeek.
// Renders nothing when no plan is active.

import { Icon } from "./ui/ledger";
import { describeBuildWeek } from "./raceBuild";
import { describeRoadTrailWeek } from "./plans/roadTrailHybrid";

export function formatPlanDate(dateKey) {
  const d = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateKey || "";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function hybridWeekLabel(week) {
  if (week.completed) return "Block complete · Recovery";
  if (!week.weekNumber) return `Starts ${formatPlanDate(week.startMonday)}`;
  return `Week ${week.weekNumber} of ${week.totalWeeks} · ${week.phase}`;
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
  const copy = raceWeekCopy(describeBuildWeek(program, dateKey));
  const hybrid = describeRoadTrailWeek(program, dateKey);
  if (!copy && !hybrid) return null;
  return (
    <>
      {hybrid && <p className="t-s c2">Road &amp; Trail Hybrid · {hybridWeekLabel(hybrid)}</p>}
      {copy && <div className="row" data-plate="race-week">
        <Icon name="run" className="c2" />
        <span className="kv grow"><span className="t-bs">{copy.eyebrow}</span><span className="t-s c2">{copy.main}</span></span>
        <span className="n-s c2">{copy.countdown}</span>
      </div>}
    </>
  );
}

export default RaceWeekLine;
