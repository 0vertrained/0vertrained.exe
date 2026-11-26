// src/RaceBlockSection.jsx
// The race countdown on the Block screen, read from the program's race plan,
// which is the one source for the race. It is edited in Train, under Race
// plan; nothing here changes it.

import { getTodayKey } from "./constants";
import { isRunPlanSpec } from "./runPlanGenerator";
import { describeBuildWeek } from "./raceBuild";
import { formatPlanDate, raceWeekCopy } from "./RaceWeekLine";

export const TAPER_DAYS = 10;

// Build / taper / race day from days-to-race. Guidance copy only: the plan's
// own weeks decide what is trained; this is the block's stamp and note.
export function racePhase(daysToRace) {
  if (!Number.isFinite(daysToRace)) return null;
  if (daysToRace < 0) return { phase: "past", stamp: "DONE", note: "Race is run. Log a debrief in notes, then end the plan or set the next race." };
  if (daysToRace === 0) return { phase: "race_day", stamp: "RACE DAY", note: "Nothing left to gain in training. Execute the plan; pace the first half honest." };
  if (daysToRace <= TAPER_DAYS) return { phase: "taper", stamp: "TAPER", note: "Cut volume, hold a little intensity, protect sleep. Deload beats one more quality session from here." };
  return { phase: "build", stamp: "BUILD", note: "Build window. The plan’s weeks carry the mileage; keep the lifting and the easy days easy." };
}

const sentence = (text) => `${text.charAt(0)}${text.slice(1).toLowerCase()}`;

export function RaceBlockSection({ program } = {}) {
  const runPlan = isRunPlanSpec(program?.__raceBuild) ? program.__raceBuild : null;
  const todayKey = getTodayKey();
  const week = runPlan ? describeBuildWeek(program, todayKey) : null;
  const copy = week ? raceWeekCopy(week) : null;
  const phase = week ? racePhase(week.daysToRace) : null;

  return (
    <section aria-labelledby="block-race" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div className="sec">
        <h3 id="block-race" className="t-h">Race</h3>
        {phase && <span className={phase.phase === "taper" || phase.phase === "race_day" ? "tag" : "tag tag-f"}>{sentence(phase.stamp)}</span>}
      </div>

      {!runPlan && (
        <p className="t-s c2">No race on the calendar. Add one in Train, under Race plan, and the weeks to race day build themselves around your lifting.</p>
      )}

      {runPlan && !week && (
        <p className="t-s c2">{runPlan.raceName} · {formatPlanDate(runPlan.raceDate)} has passed. End the plan or set the next race in Train, under Race plan.</p>
      )}

      {runPlan && week && copy && (
        <>
          <p className="t-bs">{copy.countdown} · {copy.main}</p>
          <p className="t-s">{runPlan.raceName} · {formatPlanDate(runPlan.raceDate)}</p>
          <p className="t-s c2">{copy.eyebrow.replace(/^Race plan · /i, "")}</p>
          <p className="t-s c2">{phase.note} Edit the plan in Train, under Race plan.</p>
        </>
      )}
    </section>
  );
}
