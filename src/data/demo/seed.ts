// The demo character: ten weeks on the Beginner Full Body preset, built from
// `todayKey` alone so "Try the demo" shows the same athlete on any date. The
// week is rotated so today is the Full Body C session, issued REDUCED (slept
// poorly, very sore) and still untouched, with a push-up rep record within
// reach. The history carries one illness day, one missed day a streak shield
// covered, one reduced day the athlete honoured, and a few load steps that
// set records. Everything is fabricated and never uploaded.

import { addDays, diffDays, dateRange, WEEKDAYS, weekdayIndex, type DateKey, type Weekday } from "../../domain/dates";
import { emptyDay, type CheckIn, type DayMap, type DayV2, type ExerciseLog, type PlannedExercise, type SetLog } from "../../domain/day/schema";
import { issueDailyQuest } from "../../domain/game/quest";
import type { GameSettings } from "../../domain/game/types";
import { getPreset } from "../../domain/program/presets";
import { plannedCardioMinutes, plannedDay, plannedSetsForDay } from "../../domain/program/revisions";
import type { ProgramPayloadV2, ProgramWeek } from "../../domain/program/types";

export interface DemoSeed {
  todayKey: DateKey;
  startedOn: DateKey;
  program: ProgramPayloadV2;
  days: DayMap;
  settings: GameSettings;
}

export const DEMO_PRESET_ID = "beginner";
export const DEMO_WEEKS = 10;
export const DEMO_BODYWEIGHT_KG = 80;
export const DEMO_TITLE = "Initiate";

/** The preset day today lands on. Full Body C: push-ups, so a rep record is one set away. */
const TODAY_PRESET_DAY: Weekday = "Friday";

/** Days before today, counted from the rotated week: A is 4 days before C, B is 2. */
const SESSION_A_OFFSET = -4;
const SESSION_B_OFFSET = -2;

const EVENTS = {
  /** Week 4's B session: no entry at all. A shield covers it. */
  missed: { week: 4, offset: SESSION_B_OFFSET },
  /** Week 6's A session: ill, protected, nothing trained. */
  illness: { week: 6, offset: SESSION_A_OFFSET },
  /** Week 8's B session: slept poorly and very sore, so one set less per lift, done. */
  reduced: { week: 8, offset: SESSION_B_OFFSET },
} as const;

/** Starting load and the weeks (0-based) each step lands; eight steps, eight records. */
interface Progression {
  start: number;
  step: number;
  at: readonly number[];
}

const LOADED_KG: Readonly<Record<string, Progression>> = {
  "back-squat": { start: 50, step: 2.5, at: [3, 6, 9] },
  "barbell-bench-press": { start: 40, step: 2.5, at: [4, 8] },
  "barbell-row": { start: 40, step: 0, at: [] },
  "overhead-press": { start: 25, step: 0, at: [] },
  "conventional-deadlift": { start: 70, step: 5, at: [5] },
  "incline-db-press": { start: 14, step: 0, at: [] },
  "lat-pulldown": { start: 40, step: 5, at: [7] },
  "standing-calf-raise": { start: 60, step: 0, at: [] },
  "goblet-squat": { start: 20, step: 0, at: [] },
  "one-arm-db-row": { start: 18, step: 0, at: [] },
  "romanian-deadlift": { start: 50, step: 0, at: [] },
};

const BODYWEIGHT_REPS: Readonly<Record<string, Progression>> = {
  "walking-lunge": { start: 10, step: 0, at: [] },
  "push-up": { start: 10, step: 2, at: [5] },
  "crunch": { start: 15, step: 0, at: [] },
};

const HOLD_SECONDS: Readonly<Record<string, Progression>> = {
  plank: { start: 45, step: 0, at: [] },
};

const CHECKIN_FINE: CheckIn = { sleepQuality: 6, soreness: 5, stress: 5, energy: 6 };
const CHECKIN_WELL: CheckIn = { sleepQuality: 9, soreness: 2, stress: 2, energy: 9 };
const CHECKIN_ROUGH: CheckIn = { sleepQuality: 3, soreness: 8, stress: 5, energy: 6 };
const CHECKIN_ILL: CheckIn = { ...CHECKIN_FINE, illness: true };

function progressed(p: Progression, weekIndex: number): number {
  return p.start + p.step * p.at.filter((w) => w <= weekIndex).length;
}

/** The preset week shifted so `TODAY_PRESET_DAY` falls on today's weekday. */
export function rotatedWeek(week: ProgramWeek, todayKey: DateKey): ProgramWeek {
  const shift = weekdayIndex(todayKey) - WEEKDAYS.indexOf(TODAY_PRESET_DAY);
  const out = {} as ProgramWeek;
  WEEKDAYS.forEach((day, i) => {
    out[WEEKDAYS[(((i + shift) % 7) + 7) % 7] as Weekday] = week[day];
  });
  return out;
}

function setsFor(e: PlannedExercise, sets: number, weekIndex: number, completedAt: string): SetLog[] {
  return Array.from({ length: sets }, (_, i) => {
    const s: SetLog = { id: `s${i + 1}`, weightKg: null, reps: null, done: true, completedAt };
    const loaded = LOADED_KG[e.id];
    const bodyweight = BODYWEIGHT_REPS[e.id];
    const hold = HOLD_SECONDS[e.id];
    if (loaded) {
      s.weightKg = progressed(loaded, weekIndex);
      s.reps = Number(e.reps) || 8;
    } else if (bodyweight) {
      s.reps = progressed(bodyweight, weekIndex);
    } else if (hold) {
      s.seconds = progressed(hold, weekIndex);
    } else {
      s.weightKg = 20;
      s.reps = Number(e.reps) || 8;
    }
    return s;
  });
}

/** The whole character for `todayKey`: program, days, settings. */
export function seed(todayKey: DateKey): DemoSeed {
  const preset = getPreset(DEMO_PRESET_ID);
  if (!preset) throw new Error(`Demo preset "${DEMO_PRESET_ID}" is missing.`);
  const startedOn = addDays(todayKey, -(DEMO_WEEKS * 7 - 1));
  const week = rotatedWeek(preset.week, todayKey);
  const program: ProgramPayloadV2 = { v: 2, revisions: [{ effectiveFrom: startedOn, source: `preset:${preset.id}`, week }] };
  const plannedWeeklySets = WEEKDAYS.reduce((n, d) => n + plannedSetsForDay(week[d]), 0);
  const plannedWeeklyCardioMinutes = WEEKDAYS.reduce((n, d) => n + plannedCardioMinutes(week[d].cardio), 0);
  const eventDay = (e: { week: number; offset: number }): DateKey => addDays(startedOn, e.week * 7 + 6 + e.offset);
  const missedOn = eventDay(EVENTS.missed);
  const illOn = eventDay(EVENTS.illness);
  const reducedOn = eventDay(EVENTS.reduced);

  const days: DayMap = {};
  for (const key of dateRange(startedOn, todayKey)) {
    if (key === missedOn) continue;
    const dayIndex = diffDays(startedOn, key);
    const weekIndex = Math.floor(dayIndex / 7);
    const planned = plannedDay(program, key);
    const isToday = key === todayKey;
    const checkin: CheckIn = key === illOn ? CHECKIN_ILL : key === reducedOn || isToday ? CHECKIN_ROUGH : dayIndex % 5 === 2 ? CHECKIN_WELL : CHECKIN_FINE;
    const quest = issueDailyQuest({
      dateKey: key, programDay: planned, plannedWeeklySets, plannedWeeklyCardioMinutes, checkin, days,
      issuedAt: `${key}T06:30:00.000Z`,
    });
    const day: DayV2 = emptyDay();
    day.checkin = checkin;
    day.quest = quest;
    if (!isToday && (quest.tier === "FULL" || quest.tier === "REDUCED")) {
      const completedAt = `${key}T17:30:00.000Z`;
      for (const e of quest.planned.exercises) {
        const log: ExerciseLog = { name: e.name, trackingMode: e.trackingMode, sets: setsFor(e, e.sets, weekIndex, completedAt) };
        if (e.libraryId) log.libraryId = e.libraryId;
        day.workout.exercises[e.id] = log;
      }
      const minutes = quest.planned.cardioMinutes;
      if (minutes) {
        day.workout.cardio.push({ id: "c1", kind: planned.cardio?.kind ?? "Easy Walk", minutes, km: planned.cardio?.km ?? null, source: "manual", completedAt: `${key}T18:15:00.000Z` });
      }
      day.quest = { ...quest, claimedAt: `${key}T18:30:00.000Z` };
    } else if (!isToday && (quest.tier === "REST" || quest.tier === "RECOVER")) {
      day.quest = { ...quest, recoveryDone: true, claimedAt: `${key}T19:00:00.000Z` };
    }
    days[key] = day;
  }

  const settings: GameSettings = { title: DEMO_TITLE, bodyweightKg: DEMO_BODYWEIGHT_KG, startedOn };
  return { todayKey, startedOn, program, days, settings };
}
