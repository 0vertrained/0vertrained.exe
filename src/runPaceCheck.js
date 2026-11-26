// src/runPaceCheck.js
// How a logged run's pace sat against the plan. Only a run meant to be run
// at one easy effort gets a verdict: an easy or long run on a race plan, with
// its target range. A session with intervals or a faster finish averages
// paces that were meant to differ, so it gets none, and neither does a run
// planned by effort alone.

import { formatPace } from "./runPaces";

const RANGE = /(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})\s*\/\s*mi/;
const CLOCK = /^(\d{1,3}):([0-5]\d)(?::([0-5]\d))?$/;
// Steps that keep a run at one easy effort. Strides are seconds long.
const STEADY = new Set(["run", "warmup", "cooldown"]);

/** Seconds in "m:ss" or "h:mm:ss", or null. */
export function parseClock(text) {
  const match = CLOCK.exec(String(text || "").trim());
  if (!match) return null;
  const [, first, second, third] = match;
  const seconds = third != null
    ? Number(first) * 3600 + Number(second) * 60 + Number(third)
    : Number(first) * 60 + Number(second);
  return seconds > 0 ? seconds : null;
}

/** The planned easy range in seconds per mile, or null when there isn't one to hold the run to. */
export function targetRange(cardio) {
  const steps = Array.isArray(cardio?.steps) ? cardio.steps : [];
  const steady = steps.every((step) => step?.kind === "strides" || (STEADY.has(step?.kind) && step.intensity === "easy"));
  if (!steady) return null;
  const match = RANGE.exec(String(cardio?.targetPace || ""));
  if (!match) return null;
  const one = Number(match[1]) * 60 + Number(match[2]);
  const two = Number(match[3]) * 60 + Number(match[4]);
  const fast = Math.min(one, two);
  const slow = Math.max(one, two);
  return { fast, slow, label: `${formatPace(fast)}–${formatPace(slow)}/mi` };
}

/** Seconds per mile from the log: its Pace, or Time over Miles. */
export function loggedPace(logged) {
  const fromPace = parseClock(logged?.pace);
  if (fromPace) return fromPace;
  const miles = Number.parseFloat(logged?.miles);
  const seconds = parseClock(logged?.time);
  return miles > 0 && seconds ? Math.round(seconds / miles) : null;
}

/** { status: "on" | "fast" | "slow", pace, fast, slow, label }, or null. */
export function paceCheck(cardio, logged) {
  const range = targetRange(cardio);
  const pace = loggedPace(logged);
  if (!range || !pace) return null;
  const status = pace < range.fast ? "fast" : pace > range.slow ? "slow" : "on";
  return { status, pace, ...range };
}

export function paceCheckText(check) {
  const pace = `${formatPace(check.pace)}/mi`;
  if (check.status === "on") return `On target: ${pace}, inside the easy range of ${check.label}.`;
  if (check.status === "fast") return `Quicker than planned: ${pace} against an easy range of ${check.label}. Keep easy days conversational.`;
  return `Slower than planned: ${pace} against an easy range of ${check.label}. That's fine on an easy day.`;
}
