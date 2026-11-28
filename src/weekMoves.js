// src/weekMoves.js
// Moving training around within one week without touching the program.
// The program stays the weekly template; a week can swap any two of its
// days, kept on the program as
//   __weekMoves: { "<that week's Monday>": { <day>: <day whose plan it shows> } }
// Swaps only, so a week keeps everything it had, just on other days. The
// week's resolver (applyRaceBuild in ./raceBuild) applies them after the
// race plan's own changes, so every screen, the watch and its scheduled runs
// see the same week. A week's moves are dropped eight weeks on, the next
// time moves are saved. Pure: dates are passed in.

import { alignmentOn } from "./plans/hybridAlignmentDates.js";
import { shiftDate } from "./coachWindows.js";

export const WEEK_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function keyOf(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** The Monday of the week holding a "YYYY-MM-DD" key. */
export function weekStartOf(dateKey) {
  const date = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return keyOf(date);
}

/** The weekday name of a "YYYY-MM-DD" key. */
export function weekdayOf(dateKey) {
  const date = new Date(`${dateKey}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : WEEK_DAYS[(date.getDay() + 6) % 7];
}

/** The week's moves as { day: source day }, or null without any. */
function savedMovesFor(program, start) {
  const moves = start ? program?.__weekMoves?.[start] : null;
  if (!moves || typeof moves !== "object") return null;
  const clean = {};
  for (const [day, source] of Object.entries(moves)) {
    if (WEEK_DAYS.includes(day) && WEEK_DAYS.includes(source) && day !== source) clean[day] = source;
  }
  return Object.keys(clean).length ? clean : null;
}

function moveLock(raceDate, key) {
  if (!raceDate) return null;
  if (key === raceDate) return "Race day";
  if (key < raceDate && key >= shiftDate(raceDate, -2)) return "Race taper";
  if (key > raceDate && (weekStartOf(key) === weekStartOf(raceDate) || key === shiftDate(raceDate, 1))) return "Post-race recovery";
  return null;
}

export function raceMoveLock(program, dateKey) {
  return moveLock(alignmentOn(program?.__hybridBlock, dateKey)?.raceDate, dateKey);
}

/** Project the saved swaps onto the days that can move. Passing over a pinned
 * day in a cycle keeps the remaining workouts in their original swap order. */
export function weekMovesFor(program, dateKey) {
  const monday = weekStartOf(dateKey);
  const saved = savedMovesFor(program, monday);
  const marker = program?.__hybridBlock;
  if (!saved || !marker?.alignments?.length) return saved;
  const dates = Object.fromEntries(WEEK_DAYS.map((day, index) => [day, shiftDate(monday, index)]));
  const moves = {};
  for (const [day, first] of Object.entries(saved)) {
    const raceDate = alignmentOn(marker, dates[day])?.raceDate;
    // A race that already held its date must also stay out of later workouts
    // when the athlete restores independent dates partway through that week.
    const locked = name => moveLock(raceDate, dates[name]) ||
      (dates[name] < dates[day] && raceMoveLock(program, dates[name]));
    if (locked(day)) continue;
    let source = first;
    const visited = new Set();
    while (source && !visited.has(source) && locked(source)) {
      visited.add(source);
      source = saved[source];
    }
    if (source && source !== day && !visited.has(source)) moves[day] = source;
  }
  return Object.keys(moves).length ? moves : null;
}

/**
 * The program with the week's moves applied: each moved day shows the plan
 * of the day it came from. The same reference when the week has none.
 */
export function applyWeekMoves(program, dateKey, resolveSource = null) {
  const moves = weekMovesFor(program, dateKey);
  if (!moves) return program;
  const next = { ...program };
  for (const [day, source] of Object.entries(moves)) {
    next[day] = (resolveSource ? resolveSource(day, source) : program[source]) ?? null;
  }
  return next;
}

/** The day a date's plan was moved from, or null when it's its own. */
export function movedFrom(program, dateKey) {
  const day = weekdayOf(dateKey);
  return (day && weekMovesFor(program, dateKey)?.[day]) || null;
}

// The week as a full map, every day to the day whose plan it shows.
function fullMap(program, dateKey) {
  const moves = savedMovesFor(program, weekStartOf(dateKey)) || {};
  return Object.fromEntries(WEEK_DAYS.map((day) => [day, moves[day] || day]));
}

// How long past weeks keep their moves, so their days still read as they
// were trained.
const KEEP_WEEKS = 8;

// The moves map without days that show their own plan, and without weeks
// more than eight before this one.
function withWeek(program, start, map) {
  const oldest = new Date(`${start}T12:00:00`);
  oldest.setDate(oldest.getDate() - 7 * KEEP_WEEKS);
  const cutoff = keyOf(oldest);
  const kept = {};
  for (const [weekStart, moves] of Object.entries(program?.__weekMoves || {})) {
    if (weekStart >= cutoff) kept[weekStart] = moves;
  }
  const moves = Object.fromEntries(Object.entries(map).filter(([day, source]) => day !== source));
  if (Object.keys(moves).length) kept[start] = moves;
  else delete kept[start];
  const next = { ...program };
  if (Object.keys(kept).length) next.__weekMoves = kept;
  else delete next.__weekMoves;
  return next;
}

/** The program with two days of a week swapped, on top of any earlier moves. */
export function swapDays(program, dateKey, first, second) {
  const start = weekStartOf(dateKey);
  if (!start || !WEEK_DAYS.includes(first) || !WEEK_DAYS.includes(second) || first === second) return program;
  if (program.__hybridBlock?.alignments?.length) {
    const firstDate = shiftDate(start, WEEK_DAYS.indexOf(first));
    const secondDate = shiftDate(start, WEEK_DAYS.indexOf(second));
    if (raceMoveLock(program, firstDate) || raceMoveLock(program, secondDate)) return program;
  }
  const map = fullMap(program, dateKey);
  [map[first], map[second]] = [map[second], map[first]];
  return withWeek(program, start, map);
}

/** The program with a week back as planned. */
export function resetWeek(program, dateKey) {
  const start = weekStartOf(dateKey);
  if (!start) return program;
  return withWeek(program, start, Object.fromEntries(WEEK_DAYS.map((day) => [day, day])));
}
