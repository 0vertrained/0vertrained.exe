// src/runningVolume.js
// Weekly running volume — pure math for the Progress figure.
//
// Dedupe rule (one number per day, never both): a day's miles are the
// MANUALLY logged cardio miles when any exist (getLoggedCardioBlocks — the
// load model's own definition of "logged"), otherwise the day's Strava run
// miles. Confirming a Strava suggestion writes manual fields, so a confirmed
// run naturally moves from the "strava" column to the "manual" column without
// ever counting twice.
//
// Weeks are Monday-anchored calendar weeks (training-week convention),
// newest last so the sparkline reads left → right into the present.

import { getLoggedCardioBlocks } from "./loadModel";

export function mondayOf(dateKey) {
  const d = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.getDay(); // 0 Sun … 6 Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function manualMilesForDay(entry) {
  const blocks = getLoggedCardioBlocks(entry?.workout || {});
  return blocks.reduce((sum, c) => sum + (parseFloat(c?.miles) || 0), 0);
}

export function stravaRunMilesForDay(dayActivities) {
  return (dayActivities || []).reduce(
    (sum, a) => sum + (a?.kind === "run" ? Number(a.miles) || 0 : 0),
    0
  );
}

/**
 * Build weekly totals for the last `weeks` Monday-anchored weeks, oldest → newest.
 * Returns { weeks: [{ weekStart, miles, manualMiles, stravaMiles, days }],
 *           thisWeekMiles, lastWeekMiles, stravaContributed }.
 */
export function buildWeeklyRunVolume({ entries = {}, stravaByDate = {}, weeks = 8, asOf = new Date() } = {}) {
  const today = asOf instanceof Date ? asOf : new Date(asOf);
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const thisMonday = mondayOf(todayKey);
  const buckets = new Map();
  for (let w = weeks - 1; w >= 0; w--) {
    const d = new Date(`${thisMonday}T12:00:00`);
    d.setDate(d.getDate() - w * 7);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    buckets.set(key, { weekStart: key, miles: 0, manualMiles: 0, stravaMiles: 0, days: 0 });
  }

  const dayKeys = new Set([...Object.keys(entries || {}), ...Object.keys(stravaByDate || {})]);
  let stravaContributed = false;
  for (const dateKey of dayKeys) {
    const weekKey = mondayOf(dateKey);
    const bucket = weekKey ? buckets.get(weekKey) : null;
    if (!bucket) continue;
    const manual = manualMilesForDay(entries?.[dateKey]);
    const strava = manual > 0 ? 0 : stravaRunMilesForDay(stravaByDate?.[dateKey]);
    const miles = manual > 0 ? manual : strava;
    if (!(miles > 0)) continue;
    bucket.miles += miles;
    bucket.manualMiles += manual;
    bucket.stravaMiles += strava;
    bucket.days += 1;
    if (strava > 0) stravaContributed = true;
  }

  const list = [...buckets.values()].map((b) => ({
    ...b,
    miles: Math.round(b.miles * 10) / 10,
    manualMiles: Math.round(b.manualMiles * 10) / 10,
    stravaMiles: Math.round(b.stravaMiles * 10) / 10,
  }));
  return {
    weeks: list,
    thisWeekMiles: list[list.length - 1]?.miles ?? 0,
    lastWeekMiles: list[list.length - 2]?.miles ?? 0,
    stravaContributed,
  };
}
