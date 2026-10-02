// The three profile stats, each 0–100: STR measured from loads, END from
// cardio, VIT from self-reports. Each is computed for today and again for
// 28 days ago so the profile can show a delta. Nothing here pays for doing
// more than planned: STR and END saturate at elite marks, and VIT reads
// honesty and rest, never volume.

import { addDays, dateRange, diffDays, type DateKey } from "../dates";
import type { CardioLog, DayMap, DayV2, ExerciseLog, SetLog, TrackingMode } from "../day/schema";
import { strengthGroupOf, type ExerciseMeta, type StrengthGroup } from "../exercise";
import { CHECKIN_ROWS, isCheckinCounted, selectedOption, type CheckinRow } from "../readiness/checkin";
import { e1rm } from "../training/liftMath";
import { isRecordEligible } from "../training/records";
import { modeOf } from "../training/sets";
import { round1 } from "../units";
import { DEFAULT_BODYWEIGHT_KG, STATS } from "./config";
import type { DayResult, GameSettings, StatValue, Stats } from "./types";

export interface StatsInput {
  days: DayMap;
  todayKey: DateKey;
  results: Record<DateKey, DayResult>;
  settings: GameSettings;
  metaFor: (log: ExerciseLog) => ExerciseMeta;
}

/** The delta compares today with this many days ago. */
export const DELTA_DAYS = 28;

const GROUPS: readonly StrengthGroup[] = ["squat", "hinge", "push", "pull"];
const BODYWEIGHT_MODES: readonly TrackingMode[] = ["bodyweight_reps", "assisted_reps"];
const SLEPT_ROW = CHECKIN_ROWS[0] as CheckinRow;
const SLEEP_SCORE: Partial<Record<string, number>> = STATS.vit.sleepScore;

/** Logged days inside the calendar window of `length` days ending on `endKey`, oldest first. */
function daysInWindow(days: DayMap, endKey: DateKey, length: number): [DateKey, DayV2][] {
  const fromKey = addDays(endKey, -(length - 1));
  return Object.keys(days)
    .filter((k) => k >= fromKey && k <= endKey)
    .sort()
    .map((k) => [k, days[k] as DayV2]);
}

// ─── STR ─────────────────────────────────────────────────────────────────────

/** A set's bar-equivalent e1RM in kg, or null when it can't prove strength. */
function loadEquivalentKg(set: SetLog, mode: TrackingMode, meta: ExerciseMeta, bodyweightKg: number): number | null {
  if (!isRecordEligible(set, mode)) return null;
  let load: number | null;
  if (mode === "loaded_reps") {
    load = set.weightKg;
  } else if (BODYWEIGHT_MODES.includes(mode) && meta.bwFactor !== undefined) {
    load = bodyweightKg * meta.bwFactor + (set.weightKg ?? 0) - (set.assistanceKg ?? 0);
  } else {
    return null;
  }
  const estimate = e1rm(load, set.reps);
  if (estimate === null) return null;
  const vertical = meta.pattern === "verticalPush" ? STATS.str.verticalPushFactor : 1;
  const perHand = meta.equipment === "dumbbell" ? STATS.str.dumbbellPerHandFactor : 1;
  return estimate * vertical * perHand;
}

interface StrRaw {
  value: number;
  measured: boolean;
  measuredGroups: number;
  groups: Record<StrengthGroup, number | null>;
}

function strAt(input: StatsInput, endKey: DateKey): StrRaw {
  const entered = input.settings.bodyweightKg;
  const bodyweightKg = entered != null && entered > 0 ? entered : DEFAULT_BODYWEIGHT_KG;
  const best: Partial<Record<StrengthGroup, number>> = {};
  for (const [, day] of daysInWindow(input.days, endKey, STATS.str.windowDays)) {
    for (const log of Object.values(day.workout.exercises)) {
      if (log.skipped) continue;
      const meta = input.metaFor(log);
      const group = strengthGroupOf(meta.pattern);
      if (!group) continue;
      const mode = modeOf(log, meta.trackingMode);
      for (const set of log.sets) {
        const kg = loadEquivalentKg(set, mode, meta, bodyweightKg);
        if (kg !== null && kg > (best[group] ?? 0)) best[group] = kg;
      }
    }
  }
  const groups: Record<StrengthGroup, number | null> = { squat: null, hinge: null, push: null, pull: null };
  let sum = 0;
  let measuredGroups = 0;
  for (const g of GROUPS) {
    const kg = best[g];
    if (kg === undefined) continue;
    const score = Math.min(100, (100 * (kg / bodyweightKg)) / STATS.str.elite[g]);
    groups[g] = Math.round(score);
    sum += score;
    measuredGroups += 1;
  }
  return { value: Math.max(1, Math.round(sum / GROUPS.length)), measured: measuredGroups > 0, measuredGroups, groups };
}

// ─── END ─────────────────────────────────────────────────────────────────────

/** A cardio log's minutes; distance-only logs convert at the configured pace. */
export function cardioMinutesOf(log: CardioLog): number {
  if (log.minutes != null && log.minutes > 0) return log.minutes;
  if (log.km != null && log.km > 0) return log.km * STATS.end.minutesPerKm;
  return 0;
}

interface EndRaw {
  value: number;
  measured: boolean;
  weeklyMinutes: number;
  longestMinutes: number;
}

function endAt(input: StatsInput, endKey: DateKey): EndRaw {
  const weeklyFrom = addDays(endKey, -(STATS.end.weeks * 7 - 1));
  let total = 0;
  let longest = 0;
  for (const [key, day] of daysInWindow(input.days, endKey, STATS.end.longestWindowDays)) {
    for (const log of day.workout.cardio) {
      const minutes = cardioMinutesOf(log);
      if (minutes > longest) longest = minutes;
      if (key >= weeklyFrom) total += minutes;
    }
  }
  const weeklyMinutes = total / STATS.end.weeks;
  const weekly = Math.min(100, weeklyMinutes / (STATS.end.weeklyMinutesFull / 100));
  const long = Math.min(100, longest / (STATS.end.longestMinutesFull / 100));
  const value = Math.max(1, Math.round(STATS.end.weeklyWeight * weekly + STATS.end.longestWeight * long));
  return { value, measured: longest > 0, weeklyMinutes: round1(weeklyMinutes), longestMinutes: round1(longest) };
}

// ─── VIT ─────────────────────────────────────────────────────────────────────

/** The Slept tap's contribution; no answer contributes nothing. */
function sleepScoreOf(day: DayV2): number {
  const text = selectedOption(SLEPT_ROW, day.checkin.sleepQuality)?.text;
  return text === undefined ? 0 : (SLEEP_SCORE[text] ?? 0);
}

function hasCompletedSet(day: DayV2 | undefined): boolean {
  return Object.values(day?.workout.exercises ?? {}).some((log) => log.sets.some((s) => s.done === true));
}

interface VitRaw {
  value: number;
  measured: boolean;
  calibrating: boolean;
  checkinRate: number;
  sleepScore: number;
  restHonor: number;
}

function vitAt(input: StatsInput, endKey: DateKey): VitRaw {
  const { startedOn } = input.settings;
  const since = startedOn === undefined ? null : diffDays(startedOn, endKey) + 1;
  const window = since === null ? STATS.vit.windowDays : Math.max(0, Math.min(STATS.vit.windowDays, since));
  const calibrating = since === null || since < STATS.vit.calibratingDays;
  const divisor = Math.max(STATS.vit.calibratingDays, window);
  let checkins = 0;
  let sleep = 0;
  let restDays = 0;
  let honoured = 0;
  for (const key of dateRange(addDays(endKey, -(window - 1)), endKey)) {
    const day = input.days[key];
    if (day && isCheckinCounted(day.checkin)) {
      checkins += 1;
      sleep += sleepScoreOf(day);
    }
    const tier = input.results[key]?.tier;
    if (tier === "REST" || tier === "RECOVER") {
      restDays += 1;
      if (!hasCompletedSet(day)) honoured += 1;
    }
  }
  const checkinRate = checkins / divisor;
  const sleepScore = sleep / divisor;
  const restHonor = restDays === 0 ? 1 : honoured / restDays;
  const value = Math.max(1, Math.round(STATS.vit.checkinWeight * checkinRate + STATS.vit.sleepWeight * sleepScore + STATS.vit.restWeight * restHonor));
  return { value, measured: window > 0, calibrating, checkinRate, sleepScore, restHonor };
}

// ─── Trend ───────────────────────────────────────────────────────────────────

function trend(value: number, previous: number | null): Pick<StatValue, "previous" | "delta" | "trend"> {
  if (previous === null) return { previous: null, delta: null, trend: "none" };
  const delta = value - previous;
  return { previous, delta, trend: Math.abs(delta) <= STATS.steadyBand ? "steady" : delta > 0 ? "up" : "down" };
}

function withTrend<T extends { value: number; measured: boolean }>(now: T, previous: T): Omit<T, "measured"> & StatValue {
  const { measured: _measured, ...rest } = now;
  return { ...rest, ...trend(now.value, previous.measured ? previous.value : null) };
}

export function computeStats(input: StatsInput): Stats {
  const previousKey = addDays(input.todayKey, -DELTA_DAYS);
  return {
    str: withTrend(strAt(input, input.todayKey), strAt(input, previousKey)),
    end: withTrend(endAt(input, input.todayKey), endAt(input, previousKey)),
    vit: withTrend(vitAt(input, input.todayKey), vitAt(input, previousKey)),
  };
}
