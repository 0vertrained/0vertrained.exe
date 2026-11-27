// src/widgets/widgetCards.js
// The week ahead as day cards for the iPhone's Home and Lock Screen widget:
// today and the next six days, each { date, title, detail, kind }, read the
// way Today will read that day (race plan and moved days included). Today's
// card says how far the day has got.
import { DEFAULT_PROGRAM, getDayName } from "../constants";
import { getProgramSessions } from "../programSessions";
import { withAdded } from "../addedExercises";
import { resolveCustomTrainingDay } from "../customTrainingDay";
import { applyRaceBuild } from "../raceBuild";
import { isExerciseHandled } from "../workoutLogging";

export const WIDGET_DAYS = 7;

function shift(dateKey, days) {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** "Easy run, 45 min" for a planned cardio block. */
export function cardioPart(cardio) {
  const minutes = Number(cardio?.minutes);
  const miles = Number(cardio?.miles);
  const amount = minutes > 0 ? `${Math.round(minutes)} min` : miles > 0 ? `${Math.round(miles * 10) / 10} mi` : "";
  return [cardio?.type || "Cardio", amount].filter(Boolean).join(", ");
}

/** One day's card. `logged` is that day's entry, for how far it has got. */
export function dayCard(program, dateKey, logged = null, { data, currentDateKey = dateKey, wearableScore, readiness } = {}) {
  const dayName = getDayName(new Date(`${dateKey}T12:00:00`));
  const live = applyRaceBuild(program || DEFAULT_PROGRAM, dateKey) || DEFAULT_PROGRAM;
  // Exercises added to the day count, as they do on Today.
  const projected = resolveCustomTrainingDay({ day: live[dayName] || DEFAULT_PROGRAM[dayName] || {},
    dateKey, currentDateKey, data: data || { [dateKey]: logged }, wearableScore, readiness });
  const day = withAdded(projected, logged?.workout);
  const sessions = getProgramSessions(day);
  const lifting = sessions.flatMap((session) => session.lifting || []);
  const runs = sessions.map((session) => session.cardio).filter(Boolean);
  if (!lifting.length && !runs.length) return { date: dateKey, title: "Rest day", detail: "", kind: "rest" };
  const parts = [];
  if (lifting.length) {
    const done = logged ? lifting.filter((exercise) => isExerciseHandled(exercise, logged?.workout?.exercises?.[exercise.name] || {})).length : 0;
    parts.push(done > 0 ? `${done} of ${lifting.length} exercises done` : `${lifting.length} ${lifting.length === 1 ? "exercise" : "exercises"}`);
  }
  if (day.adaptivePlan?.version === 1 && lifting.length) {
    const sets = lifting.reduce((sum, ex) => sum + Number(ex.sets || 0), 0);
    parts.push(`${sets} work set${sets === 1 ? "" : "s"}`);
  }
  for (const cardio of runs) parts.push(cardioPart(cardio));
  const kind = lifting.length && runs.length ? "both" : lifting.length ? "lift" : "run";
  return { date: dateKey, title: day.type || (lifting.length ? "Lifting" : runs[0]?.type || "Training"), detail: parts.join(" · "), kind };
}

/** Today's card, then the next six days'. */
export function weekCards({ program, data = {}, todayKey, wearableScore, readiness, days = WIDGET_DAYS }) {
  return Array.from({ length: days }, (_, index) => {
    const dateKey = shift(todayKey, index);
    return dayCard(program, dateKey, index === 0 ? data?.[dateKey] : null, { data, currentDateKey: todayKey, wearableScore, readiness });
  });
}
