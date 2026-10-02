// src/moreHub.js
// Pure display helpers for the More management hub (V2.4B). They turn the
// already-stored weekly program into a compact "current plan" summary shown on
// the hub landing card. No side effects, no persistence, no algorithm changes —
// purely presentational counting of values the app already has, so they are
// safe to unit test.
import { DAYS } from "./constants";
import { getProgramSessions } from "./programSessions";

// A day "has lifting" when it carries at least one exercise; "has cardio" when a
// cardio block is present. A day with neither is a rest day. A single day can be
// both a lifting and a cardio day (e.g. intervals + core), so the counts are not
// mutually exclusive — they describe emphasis, not a partition.
function dayHasLifting(day) {
  return getProgramSessions(day).some((session) => Array.isArray(session.lifting) && session.lifting.length > 0);
}
function dayHasCardio(day) {
  return getProgramSessions(day).some((session) => !!session.cardio);
}

/**
 * Summarize a weekly program for the More hub Training Plan card.
 * Returns stable counts plus a short human line. Missing/empty programs return
 * all-zero counts and a neutral "No program yet" line rather than throwing.
 *
 * @param {object|null} program keyed by weekday name (see DEFAULT_PROGRAM shape)
 * @returns {{ liftingDays:number, cardioDays:number, restDays:number, totalDays:number, hasProgram:boolean, line:string }}
 */
export function summarizeProgramForHub(program = null) {
  const days = program && typeof program === "object" ? program : {};
  let liftingDays = 0;
  let cardioDays = 0;
  let restDays = 0;
  let anyContent = false;

  for (const name of DAYS) {
    const day = days[name];
    const hasLift = dayHasLifting(day);
    const hasCardio = dayHasCardio(day);
    if (hasLift) liftingDays += 1;
    if (hasCardio) cardioDays += 1;
    if (!hasLift && !hasCardio) restDays += 1;
    if (hasLift || hasCardio) anyContent = true;
  }

  const hasProgram = anyContent;
  const line = hasProgram
    ? `${liftingDays} lifting · ${cardioDays} cardio · ${restDays} rest`
    : "No program yet — generate one to get started";

  return {
    liftingDays,
    cardioDays,
    restDays,
    totalDays: DAYS.length,
    hasProgram,
    line,
  };
}
