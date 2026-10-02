// Every number in the game lives here. Tuning the economy is an edit to this
// file, covered by the engine's tests; the README rules table is generated
// from it (scripts/gen-rules.mjs) and CI fails when the two drift.
//
// Principles the numbers encode:
//   - XP pays for training to plan, never for doing more (it saturates).
//   - A fixed weekly pool is split across planned days, so a 3-day and a
//     6-day plan level at the same rate.
//   - Listening doesn't cost (an engine-scaled day pays in full); faking
//     doesn't pay (a week with no training earns at most ~65% of a full one).
//   - Nothing is ever taken away for missing a day; only the streak resets,
//     and shields or a pause protect it.

import type { Rank, RankSpec, AchievementSpec } from "./types";

/** Bump when a rule changes meaning; stored on every quest snapshot. */
export const RULES_VERSION = 1;

export const XP = Object.freeze({
  /** Once per day, when at least 3 of the 4 check-in rows are answered. */
  checkin: 10,
  /** Split evenly across the plan's training days (rounded to trainingShareStep; 1 keeps the pool exact). */
  weeklyTrainingPool: 360,
  trainingShareStep: 1,
  /** share × 0.6 × completion, plus share × 0.4 once completion reaches the cleared threshold. */
  completionWeight: 0.6,
  clearBonusWeight: 0.4,
  clearedThreshold: 0.8,
  /** A scheduled rest day's recovery objective. */
  restDay: 20,
  /** Engine-issued RECOVER days that pay the full training share, per rolling 7 days; later ones pay restDay. */
  recoverFullPayPer7Days: 1,
  /** Exercises whose remaining sets a pain flag may credit, per rolling 7 days. */
  painCreditPer7Days: 2,
  record: 25,
  recordsPerDay: 1,
  recordsPer7Days: 2,
  recordMinPriorExposures: 3,
  weeklyObjective: 50,
  weeklyBothBonus: 50,
  rankTrial: 300,
  /** Imported v19 history: any day with logged work. */
  legacyTrainingDay: 100,
  /** Sets completed later than this after the day ends are saved but earn nothing. */
  lateLoggingHours: 48,
});

/** XP from level L to L+1 is perLevel × L; cumulative XP to reach L is (perLevel/2) × L × (L−1). */
export const LEVELS = Object.freeze({ perLevel: 60, max: 99 });

export const STREAK = Object.freeze({
  shieldEveryKeptDays: 7,
  maxShields: 2,
  /** Illness and paused days share one allowance. */
  pauseAllowanceDays: 14,
  pauseWindowDays: 90,
});

/** How an engine-issued REDUCED day scales the plan. */
export const REDUCED = Object.freeze({
  setsPerLiftMinus: 1,
  minSetsPerLift: 1,
  cardioFactor: 0.7,
  cardioRoundMinutes: 5,
});

export const RANK_ORDER: readonly Rank[] = ["E", "D", "C", "B", "A", "S"];

export const RANKS: readonly RankSpec[] = Object.freeze([
  { rank: "E", title: "Recruit", minLevel: 1, minQualifyingWeeks: 0, minStrOrEnd: 0, minVit: 0, trial: false },
  { rank: "D", title: "Initiate", minLevel: 5, minQualifyingWeeks: 0, minKeptDays: 7, minStrOrEnd: 0, minVit: 0, trial: false },
  { rank: "C", title: "Contender", minLevel: 12, minQualifyingWeeks: 4, minStrOrEnd: 25, minVit: 0, trial: true },
  { rank: "B", title: "Veteran", minLevel: 22, minQualifyingWeeks: 12, minStrOrEnd: 40, minVit: 50, trial: true },
  { rank: "A", title: "Elite", minLevel: 35, minQualifyingWeeks: 30, minStrOrEnd: 55, minVit: 60, trial: true },
  { rank: "S", title: "Paragon", minLevel: 50, minQualifyingWeeks: 60, minStrOrEnd: 70, minVit: 70, trial: true },
]);

export const STATS = Object.freeze({
  str: {
    windowDays: 90,
    /** Bodyweight ratios that score 100 per strength group. */
    elite: { squat: 2.5, hinge: 3.0, push: 1.75, pull: 1.75 },
    /** Vertical pressing is converted to a bench-equivalent. */
    verticalPushFactor: 1.5,
    /** Per-hand dumbbell loads are doubled before comparing with a bar. */
    dumbbellPerHandFactor: 2,
  },
  end: {
    weeks: 4,
    longestWindowDays: 90,
    /** Weekly minutes that score 100, and the longest single session that scores 100. */
    weeklyMinutesFull: 450,
    longestMinutesFull: 180,
    weeklyWeight: 0.6,
    longestWeight: 0.4,
    /** Distance-only logs are converted to time at this pace. */
    minutesPerKm: 6,
  },
  vit: {
    windowDays: 28,
    /** Shows "calibrating" until this many days have passed since startedOn. */
    calibratingDays: 7,
    checkinWeight: 40,
    sleepWeight: 35,
    restWeight: 25,
    /** The Slept tap's contribution. */
    sleepScore: { poorly: 0.4, fine: 0.75, well: 1.0 },
  },
  /** A change within this many points of the value 28 days ago reads as "steady". */
  steadyBand: 3,
});

export const TRIAL = Object.freeze({
  /** Loaded lifts: reps at this share of the 90-day best estimated max. Never a true max. */
  loadRatio: 0.8,
  reps: 5,
  /** Bodyweight moves: reps at this share of the 90-day best set, then a plank. */
  bodyweightRatio: 0.8,
  plankCapSeconds: 180,
  /** Cardio-only athletes: continuous minutes, no pause. */
  cardioMinutes: 20,
  minDaysBetween: 7,
  bestWindowDays: 90,
});

/** Used for the STR stat until the athlete enters a bodyweight. */
export const DEFAULT_BODYWEIGHT_KG = 75;

export const ACHIEVEMENTS: readonly AchievementSpec[] = Object.freeze([
  { id: "first_quest", title: "First Quest", description: "Clear your first training quest.", xp: 50 },
  { id: "calibrated", title: "Calibrated", description: "Check in 7 times.", xp: 50 },
  { id: "rest_is_training", title: "Rest Is Training", description: "Complete 10 rest-day recovery objectives.", xp: 100 },
  { id: "listener", title: "Listener", description: "Clear 5 reduced quests as issued, with the training done.", xp: 100 },
  { id: "full_week", title: "Full Week", description: "Clear both weekly objectives in one week.", xp: 100 },
  { id: "unbroken_1", title: "Unbroken I", description: "A 7-day streak.", xp: 50 },
  { id: "unbroken_2", title: "Unbroken II", description: "A 30-day streak.", xp: 150 },
  { id: "unbroken_3", title: "Unbroken III", description: "A 100-day streak.", xp: 400 },
  { id: "record_1", title: "Record Breaker I", description: "Set a record.", xp: 50 },
  { id: "record_2", title: "Record Breaker II", description: "Set 10 records.", xp: 100 },
  { id: "record_3", title: "Record Breaker III", description: "Set 50 records.", xp: 250 },
  { id: "long_haul", title: "Long Haul", description: "One cardio session of 60 minutes or more.", xp: 100 },
  { id: "century", title: "Century", description: "Clear 100 training quests.", xp: 250 },
]);

/** Every achievement plus every rank above E unlocks a title. */
export const TITLE_COUNT = ACHIEVEMENTS.length + RANK_ORDER.length - 1;
