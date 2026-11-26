// src/watch/runWorkouts.js
// A planned run as a workout the Apple Watch's own Workout app can follow:
// the run's steps with their goals, and a pace or heart-rate alert on the
// steps that have a target. The iPhone app schedules these with WorkoutKit
// (ios/App/App/RunsPlugin.swift), so they wait in the Workout app under
// 0VERTRAINED, and the watch app opens today's from its Today list
// (ios/App/Shared/RunWorkout.swift builds the WorkoutKit objects).
//
// Paces come from the race plan's zones, in seconds per mile like the rest
// of the app. Without zones, easy and hard steps get a heart-rate zone cue
// instead, which the watch works out from its own heart-rate zones. Steps
// run by feel (jogs, strides, fartlek) get no alert.

import { suggestPlanFromNotes } from "../cardioSession";
import { DEFAULT_PROGRAM, getDayName } from "../constants";
import { getProgramSessions } from "../programSessions";
import { applyRaceBuild, isRunCardio, resolveRaceBuildConfig } from "../raceBuild";
import { METERS_PER_MILE, RACE_DISTANCES } from "../runPaces";

export const RUN_WORKOUT_VERSION = 1;
// Runs from today through the next six days are kept on the watch.
export const SCHEDULE_DAYS = 7;

// When a scheduled run starts, by the session's time of day.
const START_TIMES = { morning: "07:00", am: "07:00", midday: "12:00", lunch: "12:00", afternoon: "16:00", evening: "17:30", pm: "17:30", night: "19:00" };
const DEFAULT_START = "07:00";
// Seconds per mile either side of a single target pace.
const PACE_SPREAD = { threshold: 8, interval: 8, repetition: 6, race: 6 };
// Heart-rate zone cues when there are no paces.
const EFFORT_ZONE = { easy: 2, threshold: 4, interval: 4 };
// Time between strides, by feel.
const STRIDE_RECOVERY_SECONDS = 60;
const EASY_EFFORT = /\b(zone\s*2|easy|conversational|recovery|aerobic)\b/i;
const INDOOR = /\b(treadmill|indoor)\b/i;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

const positive = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};

const time = (minutes) => ({ kind: "time", seconds: Math.round(minutes * 60) });
const distance = (meters) => ({ kind: "distance", meters: Math.round(meters) });

/** Zones and race distance of the program's race plan, or nulls. */
export function paceContext(program) {
  const config = resolveRaceBuildConfig(program?.__raceBuild);
  return { zones: config?.zones || null, raceDistance: config?.distance || null };
}

function paceAlert(zones, intensity, raceDistance) {
  if (!zones) return null;
  if (intensity === "easy") {
    const { fast, slow } = zones.easy || {};
    return positive(fast) && positive(slow) ? { kind: "pace", fast: Math.round(fast), slow: Math.round(slow) } : null;
  }
  const spread = PACE_SPREAD[intensity];
  const target = intensity === "race" ? zones.race?.[raceDistance] : zones[intensity];
  if (!spread || !positive(target)) return null;
  return { kind: "pace", fast: Math.round(target - spread), slow: Math.round(target + spread) };
}

/** The alert for a step at this intensity: its pace, or a heart-rate zone without paces. */
export function alertFor(intensity, { zones = null, raceDistance = null } = {}) {
  if (zones) return paceAlert(zones, intensity, raceDistance);
  const zone = EFFORT_ZONE[intensity];
  return zone ? { kind: "hrZone", zone } : null;
}

const block = (iterations, steps) => ({ iterations, steps });
const work = (goal, alert = null) => ({ purpose: "work", goal, alert });
const recovery = (goal) => ({ purpose: "recovery", goal, alert: null });

// The plan's steps as a warm-up, blocks of work and recovery, and a
// cool-down. A warm-up anywhere but first, or a cool-down anywhere but last,
// is run as a block like any other step.
function fromSteps(steps, context) {
  let warmup = null;
  let cooldown = null;
  const blocks = [];
  steps.forEach((step, index) => {
    const minutes = positive(step?.minutes);
    switch (step?.kind) {
      case "warmup":
        if (index === 0 && minutes) { warmup = { goal: time(minutes), alert: null }; return; }
        break;
      case "cooldown":
        if (index === steps.length - 1 && minutes) { cooldown = { goal: time(minutes), alert: null }; return; }
        break;
      case "repeat": {
        const reps = Math.round(positive(step.reps) || 0);
        const workMinutes = positive(step.work?.minutes);
        if (!reps || !workMinutes) return;
        const recoveryMinutes = positive(step.recovery?.minutes);
        blocks.push(block(reps, [
          work(time(workMinutes), alertFor(step.work?.intensity, context)),
          ...(recoveryMinutes ? [recovery(time(recoveryMinutes))] : []),
        ]));
        return;
      }
      case "strides": {
        const reps = Math.round(positive(step.reps) || 0);
        const seconds = positive(step.seconds);
        if (reps && seconds) {
          blocks.push(block(reps, [work({ kind: "time", seconds: Math.round(seconds) }), recovery({ kind: "time", seconds: STRIDE_RECOVERY_SECONDS })]));
        }
        return;
      }
      case "time_trial":
      case "race": {
        const meters = RACE_DISTANCES[step.distance]?.meters;
        if (meters) blocks.push(block(1, [work(distance(meters), step.kind === "race" ? alertFor("race", context) : null)]));
        return;
      }
      default:
        break;
    }
    if (minutes) blocks.push(block(1, [work(time(minutes), alertFor(step?.intensity, context))]));
  });
  return { warmup, blocks, cooldown };
}

// A run with no steps: intervals its notes spell out, read the way the
// phone's interval timer reads them ("4×4 min, 3 min easy"). Otherwise one
// stretch, its time if it has one, else its distance, with an easy cue when
// it's meant to be easy.
function single(cardio, context) {
  const easy = EASY_EFFORT.test(`${cardio.effort || ""} ${cardio.type || ""}`);
  const intervals = easy ? null : suggestPlanFromNotes(cardio.notes);
  if (intervals && intervals.rounds >= 2) {
    return {
      warmup: intervals.warmup > 0 ? { goal: { kind: "time", seconds: intervals.warmup }, alert: null } : null,
      blocks: [block(intervals.rounds, [
        work({ kind: "time", seconds: intervals.work }, alertFor("interval", context)),
        ...(intervals.rest > 0 ? [recovery({ kind: "time", seconds: intervals.rest })] : []),
      ])],
      cooldown: null,
    };
  }
  const minutes = positive(cardio.minutes);
  const miles = positive(cardio.miles);
  const goal = minutes ? time(minutes) : miles ? distance(miles * METERS_PER_MILE) : { kind: "open" };
  return { warmup: null, blocks: [block(1, [work(goal, easy ? alertFor("easy", context) : null)])], cooldown: null };
}

/** What the watch app shows under the run's name, e.g. "35 min · 8:10–8:45/mi". */
export function runSummary(cardio) {
  const minutes = positive(cardio?.minutes);
  const miles = positive(cardio?.miles);
  const amount = minutes ? `${Math.round(minutes)} min` : miles ? `${Math.round(miles * 10) / 10} mi` : null;
  return [amount, cardio?.targetPace || cardio?.effort || null].filter(Boolean).join(" · ");
}

/** The run as the Workout app's steps: { warmup, blocks, cooldown }. */
export function runStructure(cardio, context = {}) {
  if (!cardio) return null;
  const fromPlan = Array.isArray(cardio.steps) && cardio.steps.length ? fromSteps(cardio.steps, context) : null;
  return fromPlan?.blocks.length ? fromPlan : single(cardio, context);
}

// FNV-1a, four ways, as one 128-bit id written like a UUID: the same run on
// the same day always gets the same id, and any change to it a new one.
export function stableUuid(text) {
  const words = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b].map((seed, lane) => {
    let hash = (seed ^ (lane * 0x27d4eb2d)) >>> 0;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i) + lane;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  });
  const hex = words.join("");
  // Version 4 and variant bits, so the result parses as a UUID anywhere.
  const version = `4${hex.slice(13, 16)}`;
  const variant = `${((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}`;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${version}-${variant}-${hex.slice(20, 32)}`;
}

/** The day's runs, from the program as Today shows it. */
export function runSessionsFor(program, dateKey) {
  const dayName = getDayName(new Date(`${dateKey}T12:00:00`));
  const live = applyRaceBuild(program, dateKey) || DEFAULT_PROGRAM;
  const day = live[dayName] || DEFAULT_PROGRAM[dayName];
  return getProgramSessions(day).filter((session) => isRunCardio(session.cardio));
}

/** One planned run as the spec the iPhone and watch apps build a workout from. */
export function runWorkout(session, { dateKey, index = 0, context = {} } = {}) {
  const cardio = session?.cardio;
  const structure = runStructure(cardio, context);
  if (!structure) return null;
  const content = {
    v: RUN_WORKOUT_VERSION,
    name: String(cardio.type || session.title || "Run"),
    summary: runSummary(cardio),
    // Only the run's name decides: notes that mention a treadmill as an
    // option still mean a run outside.
    location: INDOOR.test(String(cardio.type || "")) ? "indoor" : "outdoor",
    ...structure,
  };
  return {
    id: stableUuid(JSON.stringify({ dateKey, session: session.id, index, content })),
    date: dateKey,
    time: START_TIMES[String(session.timeOfDay || "").toLowerCase()] || DEFAULT_START,
    ...content,
  };
}

/** A day's planned runs as workout specs. */
export function runWorkoutsFor(program, dateKey) {
  if (!DATE_KEY.test(dateKey || "")) return [];
  const context = paceContext(program);
  return runSessionsFor(program, dateKey)
    .map((session, index) => runWorkout(session, { dateKey, index, context }))
    .filter(Boolean);
}

function addDays(dateKey, days) {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const pad = (number) => String(number).padStart(2, "0");

// A run today whose start time has passed starts at the next quarter hour
// instead, so the Workout app still shows it as today's.
function startFor(run, todayKey, now) {
  if (run.date !== todayKey) return run.time;
  const [hours, minutes] = run.time.split(":").map(Number);
  const planned = hours * 60 + minutes;
  const current = now.getHours() * 60 + now.getMinutes();
  if (planned > current) return run.time;
  const next = Math.min(23 * 60 + 45, Math.ceil((current + 1) / 15) * 15);
  return `${pad(Math.floor(next / 60))}:${pad(next % 60)}`;
}

/** The runs to keep on the watch: today's and the next six days'. */
export function runSchedule(program, todayKey, { days = SCHEDULE_DAYS, now = new Date() } = {}) {
  if (!DATE_KEY.test(todayKey || "")) return [];
  const runs = [];
  for (let offset = 0; offset < days; offset += 1) {
    for (const run of runWorkoutsFor(program, addDays(todayKey, offset))) {
      runs.push({ ...run, time: startFor(run, todayKey, now) });
    }
  }
  return runs;
}
