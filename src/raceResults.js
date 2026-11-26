// src/raceResults.js
// Races you've run. A logged run marked as a race keeps its result on the
// run (cardio.race = { distance, seconds, name }), so it counts toward the
// week's miles like any run and is also kept as a result: your best time
// at each distance, the times your fitness predicts, and, with a race plan,
// the training paces that result sets.
import { RACE_DISTANCES, METERS_PER_MILE, buildPaceZones, normalizeBenchmark, vdotFromRace } from "./runPaces";

// The distances a result can be logged at, shortest first.
export const RESULT_DISTANCES = ["5k", "10k", "half", "marathon"];
// A result this close in fitness to the plan's own isn't worth a change.
const VDOT_NOTICE = 0.3;

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** A race result as stored, or null when it isn't one. */
export function normalizeRace(raw) {
  if (!raw || typeof raw !== "object") return null;
  const distance = RESULT_DISTANCES.includes(raw.distance) ? raw.distance : null;
  const seconds = Math.round(Number(raw.seconds));
  if (!distance || !Number.isFinite(seconds) || seconds <= 0) return null;
  if (!vdotFromRace(distance, seconds)) return null;
  const name = typeof raw.name === "string" ? raw.name.trim().slice(0, 60) : "";
  return { distance, seconds, name };
}

/** Miles in a race distance, to two places: 3.11 for a 5K. */
export function raceMiles(distance) {
  const meters = RACE_DISTANCES[distance]?.meters;
  return meters ? Math.round((meters / METERS_PER_MILE) * 100) / 100 : null;
}

/** Seconds per mile for a result. */
export function racePace(result) {
  const meters = RACE_DISTANCES[result?.distance]?.meters;
  return meters && result.seconds ? Math.round(result.seconds / (meters / METERS_PER_MILE)) : null;
}

/** "5K", "Half marathon". */
export function raceLabel(distance) {
  return RACE_DISTANCES[distance]?.label || "Race";
}

// Every run block on a day: the plain run and any session's.
function runBlocks(day) {
  const workout = day?.workout || {};
  return [workout.cardio, ...Object.values(workout.cardioSessions || {})].filter((block) => block && typeof block === "object");
}

/** Every race result in the log, newest first, each with its pace and fitness. */
export function raceResults(entries = {}) {
  const results = [];
  for (const [dateKey, day] of Object.entries(entries || {})) {
    if (!DATE_KEY.test(dateKey)) continue;
    for (const block of runBlocks(day)) {
      const race = normalizeRace(block.race);
      if (!race) continue;
      results.push({ ...race, dateKey, pace: racePace(race), vdot: vdotFromRace(race.distance, race.seconds) });
    }
  }
  return results.sort((a, b) => b.dateKey.localeCompare(a.dateKey) || a.seconds - b.seconds);
}

/** Your fastest result at each distance, keyed by distance. */
export function personalBests(results = []) {
  const best = {};
  for (const result of results) {
    if (!best[result.distance] || result.seconds < best[result.distance].seconds) best[result.distance] = result;
  }
  return best;
}

/**
 * What your running fitness is read from: the most recent race result, or
 * the race plan's own result when that is newer or there are no races.
 * { source: "race" | "plan", benchmark, zones } or null.
 */
export function currentFitness({ results = [], spec = null } = {}) {
  const planBenchmark = normalizeBenchmark(spec?.benchmark);
  const latest = results[0] || null;
  const fromRace = latest ? { distance: latest.distance, seconds: latest.seconds, date: latest.dateKey } : null;
  const usePlan = planBenchmark && (!fromRace || (planBenchmark.date && planBenchmark.date > fromRace.date));
  const benchmark = usePlan ? planBenchmark : fromRace;
  const zones = benchmark ? buildPaceZones(benchmark) : null;
  if (!zones) return null;
  return { source: usePlan ? "plan" : "race", benchmark: zones.benchmark, zones, name: usePlan ? "" : latest?.name || "" };
}

/**
 * With a race plan: whether a result should set the plan's paces, and what
 * they'd become. Null without a plan, when the result is older than the
 * plan's own result, or when it says the same.
 */
export function paceUpdateFor({ result, dateKey, spec }) {
  if (!spec || !result) return null;
  const benchmark = normalizeBenchmark({ distance: result.distance, seconds: result.seconds, date: dateKey });
  const next = benchmark ? buildPaceZones(benchmark) : null;
  if (!next) return null;
  const current = buildPaceZones(spec.benchmark);
  const currentDate = normalizeBenchmark(spec.benchmark)?.date || null;
  if (current && currentDate && dateKey && currentDate > dateKey) return null;
  if (current && Math.abs(current.vdot - next.vdot) < VDOT_NOTICE) return null;
  return { benchmark, next, current };
}
