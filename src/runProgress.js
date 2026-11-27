// src/runProgress.js
// How your running is coming along, from the runs you log. Easy runs are
// told apart by what the plan had for that day, so a fast interval day never
// blurs into easy pace. Two reads come from them:
//   • easy pace, the last four weeks against the four before;
//   • ground covered per heartbeat on easy runs that have heart rate: the
//     same pace at a lower heart rate, or a faster pace at the same one,
//     both show up as more ground per beat.
import { cardioModality } from "./cardioLog";
import { DEFAULT_PROGRAM, getDayName } from "./constants";
import { applyRaceBuild } from "./raceBuild";
import { getProgramSessions } from "./programSessions";
import { METERS_PER_MILE, parseDuration, parseRunTime } from "./runPaces";
import { normalizeRace } from "./raceResults";

const EASY = /easy|long|recovery|zone\s*2|aerobic|base/i;
const HARD = /tempo|threshold|interval|repeat|race|benchmark|progression|fartlek|hill|speed|vo2/i;
const EASY_STEPS = new Set(["run", "warmup", "cooldown"]);

/** Whether a planned run is an easy one: every part easy, or named that way. */
export function isEasyRunPlan(cardio) {
  if (!cardio || typeof cardio !== "object") return false;
  const steps = Array.isArray(cardio.steps) ? cardio.steps : [];
  if (steps.length) {
    return steps.every((step) => step?.kind === "strides" || (EASY_STEPS.has(step?.kind) && (step.intensity || "easy") === "easy"));
  }
  const text = `${cardio.type || ""} ${cardio.effort || ""}`;
  return EASY.test(text) && !HARD.test(text);
}

export { parseRunTime } from "./runPaces";

function parsePace(value) {
  const text = String(value ?? "").replace(/\s*\/\s*mi(le)?$/i, "").trim();
  return text ? parseDuration(text) : null;
}

function shiftKey(dateKey, days) {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// Each logged run on a day with the run the plan had in its slot.
function runsOnDay(day, plan) {
  const workout = day?.workout || {};
  const sessions = getProgramSessions(plan || {});
  const pairs = [];
  const sessionRuns = workout.cardioSessions || {};
  for (const [id, block] of Object.entries(sessionRuns)) {
    pairs.push([block, sessions.find((session) => session.id === id)?.cardio || null]);
  }
  // On a day split into sessions, runs go in each session's slot and the
  // plain slot holds a run nobody planned.
  const split = Array.isArray(plan?.sessions) && plan.sessions.length > 0;
  if (workout.cardio) pairs.push([workout.cardio, split ? null : plan?.cardio || null]);
  return pairs;
}

/**
 * Runs logged over the last `days` days up to today, oldest first:
 * { dateKey, miles, seconds, pace, hr, easy, race }. Pace is seconds per
 * mile, from the Pace field or worked out from miles and time.
 */
export function loggedRuns(entries = {}, program = null, { todayKey, days = 56 } = {}) {
  const runs = [];
  if (!todayKey) return runs;
  for (let back = days - 1; back >= 0; back -= 1) {
    const dateKey = shiftKey(todayKey, -back);
    const day = entries?.[dateKey];
    if (!day?.workout) continue;
    const live = applyRaceBuild(program || DEFAULT_PROGRAM, dateKey) || DEFAULT_PROGRAM;
    const dayName = getDayName(new Date(`${dateKey}T12:00:00`));
    const plan = live[dayName] || DEFAULT_PROGRAM[dayName];
    for (const [block, planned] of runsOnDay(day, plan)) {
      const miles = Number.parseFloat(block?.miles);
      if (!(miles > 0) || cardioModality(block) !== "run") continue;
      const seconds = parseRunTime(block.time);
      const pace = parsePace(block.pace) || (seconds ? Math.round(seconds / miles) : null);
      const hr = Math.round(Number(block.hr));
      const race = normalizeRace(block.race);
      runs.push({ dateKey, miles, seconds, pace, hr: hr > 0 ? hr : null, easy: !race && isEasyRunPlan(block.type ? block : planned), race });
    }
  }
  return runs;
}

function inWindow(runs, fromKey, toKey) {
  return runs.filter((run) => run.dateKey > fromKey && run.dateKey <= toKey);
}

function milesWeightedPace(runs) {
  let miles = 0;
  let seconds = 0;
  for (const run of runs) {
    if (!run.pace) continue;
    miles += run.miles;
    seconds += run.pace * run.miles;
  }
  return miles ? Math.round(seconds / miles) : null;
}

/**
 * Easy pace over the last four weeks against the four before:
 * { recent: { pace, runs }, earlier: { pace, runs } }, or null without
 * easy runs lately.
 */
export function easyPaceTrend(runs = [], { todayKey, windowDays = 28 } = {}) {
  const easy = runs.filter((run) => run.easy && run.pace);
  const recent = inWindow(easy, shiftKey(todayKey, -windowDays), todayKey);
  if (!recent.length) return null;
  const earlier = inWindow(easy, shiftKey(todayKey, -2 * windowDays), shiftKey(todayKey, -windowDays));
  return {
    recent: { pace: milesWeightedPace(recent), runs: recent.length },
    earlier: earlier.length ? { pace: milesWeightedPace(earlier), runs: earlier.length } : null,
  };
}

/** Meters covered per heartbeat on a run, or null without time and heart rate. */
export function metersPerBeat(run) {
  if (!run?.hr || !run?.seconds || !run?.miles) return null;
  return (run.miles * METERS_PER_MILE) / (run.hr * (run.seconds / 60));
}

function averageReach(runs) {
  const values = runs.map(metersPerBeat).filter((value) => value > 0);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

/**
 * Ground per heartbeat on easy runs, the last three weeks against the three
 * before: { recent, earlier, change } with change as a fraction. Null with
 * fewer than two such runs lately.
 */
export function heartRateTrend(runs = [], { todayKey, windowDays = 21 } = {}) {
  const easy = runs.filter((run) => run.easy && metersPerBeat(run));
  const recent = inWindow(easy, shiftKey(todayKey, -windowDays), todayKey);
  if (recent.length < 2) return null;
  const earlier = inWindow(easy, shiftKey(todayKey, -2 * windowDays), shiftKey(todayKey, -windowDays));
  const recentReach = averageReach(recent);
  const earlierReach = earlier.length >= 2 ? averageReach(earlier) : null;
  return {
    recent: { reach: Math.round(recentReach * 100) / 100, runs: recent.length },
    earlier: earlierReach ? { reach: Math.round(earlierReach * 100) / 100, runs: earlier.length } : null,
    change: earlierReach ? Math.round(((recentReach - earlierReach) / earlierReach) * 1000) / 1000 : null,
  };
}

/**
 * Apple's cardio fitness (VO2 max) estimates, [{ date, value }] oldest
 * first, read: { latest, change, since }, the change against the first
 * estimate in the 90 days before the latest (null with none earlier).
 */
export function cardioFitnessTrend(points = []) {
  const list = (Array.isArray(points) ? points : [])
    .filter((point) => typeof point?.date === "string" && Number.isFinite(Number(point.value)) && Number(point.value) > 0)
    .map((point) => ({ date: point.date, value: Number(point.value) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!list.length) return null;
  const latest = list[list.length - 1];
  const earlier = list.find((point) => point.date >= shiftKey(latest.date, -90));
  const change = earlier && earlier.date !== latest.date ? Math.round((latest.value - earlier.value) * 10) / 10 : null;
  return { latest, change, since: change == null ? null : earlier.date, points: list };
}
