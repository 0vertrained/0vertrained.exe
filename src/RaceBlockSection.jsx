// src/RaceBlockSection.jsx
// V19.6 · The race countdown on Progress → Program, read from the program's
// race plan (V19.3). Before this it was the V7 race block: a second race kept
// in localStorage with a Hyrox station ledger and its own "Set race target"
// form, so a runner could have two unconnected races on screen. The plan is
// the one source now; it's edited under Profile → Training plan → Race plan.

import { useTheme } from "./theme";
import { getTodayKey } from "./constants";
import { isRunPlanSpec } from "./runPlanGenerator";
import { describeBuildWeek } from "./raceBuild";
import { formatPlanDate, raceWeekCopy } from "./RaceWeekLine";

export const TAPER_DAYS = 10;

// Build / taper / race day from days-to-race. Guidance copy only — the plan's
// own weeks decide what's trained; this is the block's stamp and note.
export function racePhase(daysToRace) {
  if (!Number.isFinite(daysToRace)) return null;
  if (daysToRace < 0) return { phase: "past", stamp: "DONE", note: "Race is run. Log a debrief in notes, then end the plan or set the next race." };
  if (daysToRace === 0) return { phase: "race_day", stamp: "RACE DAY", note: "Nothing left to gain in training. Execute the plan; pace the first half honest." };
  if (daysToRace <= TAPER_DAYS) return { phase: "taper", stamp: "TAPER", note: "Cut volume, hold a little intensity, protect sleep. Deload beats one more quality session from here." };
  return { phase: "build", stamp: "BUILD", note: "Build window — the plan's weeks carry the mileage; keep the lifting and the easy days easy." };
}

export function RaceBlockSection({ program } = {}) {
  const { C, S } = useTheme();
  const runPlan = isRunPlanSpec(program?.__raceBuild) ? program.__raceBuild : null;
  const todayKey = getTodayKey();
  const week = runPlan ? describeBuildWeek(program, todayKey) : null;
  const copy = week ? raceWeekCopy(week) : null;
  const phase = week ? racePhase(week.daysToRace) : null;
  const tone = phase?.phase === "taper" || phase?.phase === "race_day" ? C.red : C.text;

  return (
    <div style={S.block}>
      <div style={S.blockHead}>
        <span style={S.blockTitle}>{"> "}Race</span>
        {phase && <span style={{ ...S.blockStat, color: tone }}>{phase.stamp}</span>}
      </div>

      {!runPlan && (
        <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.6 }}>
          No race on the calendar. Add one under Profile → Training plan → Race plan and the weeks to race day build themselves around your lifting.
        </div>
      )}

      {runPlan && !week && (
        <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.6 }}>
          {runPlan.raceName} · {formatPlanDate(runPlan.raceDate)} has passed. End the plan or set the next race under Profile → Training plan → Race plan.
        </div>
      )}

      {runPlan && week && copy && (
        <>
          <div style={{ fontFamily: S.fontSerif, fontSize: 20, color: tone, lineHeight: 1.15 }}>{copy.countdown} · {copy.main}</div>
          <div style={S.ruledRow}><span style={S.ruledLabel}>Race</span><span style={S.ruledValue}>{runPlan.raceName} · {formatPlanDate(runPlan.raceDate)}</span></div>
          <div style={S.ruledRow}><span style={S.ruledLabel}>Plan</span><span style={S.ruledValue}>{copy.eyebrow.replace(/^Race plan · /i, "")}</span></div>
          <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.6, marginTop: 8 }}>{phase.note} Edit the plan under Profile → Training plan.</div>
        </>
      )}
    </div>
  );
}
