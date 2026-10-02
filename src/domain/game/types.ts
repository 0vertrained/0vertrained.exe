// Types shared by the game engine's modules.

import type { DateKey } from "../dates";
import type { DayMap, Tier } from "../day/schema";
import type { ProgramPayloadV2 } from "../program/types";
import type { RecordCandidate } from "../training/records";
import type { ExerciseMeta } from "../exercise";
import type { ExerciseLog } from "../day/schema";

export type Rank = "E" | "D" | "C" | "B" | "A" | "S";

export interface RankSpec {
  rank: Rank;
  title: string;
  minLevel: number;
  minQualifyingWeeks: number;
  /** Rank D only: kept days instead of qualifying weeks. */
  minKeptDays?: number;
  /** max(STR, END) must reach this. */
  minStrOrEnd: number;
  minVit: number;
  /** Promotion also needs a passed Rank Trial. */
  trial: boolean;
}

export interface AchievementSpec {
  id: string;
  title: string;
  description: string;
  xp: number;
}

export interface Pause {
  from: DateKey;
  to: DateKey;
  reason: "sick" | "travel" | "life";
}

/** Written once, never lowered: promotions, passed trials, unlocked achievements. */
export interface GameHigh {
  rank: Rank;
  trialsPassed: { rank: Rank; date: DateKey }[];
  achievements: string[];
}

/** settings.game */
export interface GameSettings {
  title?: string | null;
  bodyweightKg?: number | null;
  /** The first day the game judges. Days before it with no entry are neutral. */
  startedOn?: DateKey;
  /** Imported history up to and including this day is scored by the legacy rule. */
  importedThrough?: DateKey;
  pauses?: Pause[];
  high?: Partial<GameHigh>;
}

/**
 * kept      counts toward the streak (cleared, or a rest day)
 * missed    a scheduled training day whose logging window closed uncleared
 * open      not cleared yet, window still open (today, yesterday)
 * protected illness or pause: the streak neither grows nor breaks
 * neutral   not judged (before the start, no program, legacy day with no work)
 */
export type DayStatus = "kept" | "missed" | "open" | "protected" | "neutral";

export interface XpLine {
  key: "checkin" | "training" | "recovery" | "rest" | "record" | "legacy";
  label: string;
  xp: number;
}

export interface DayResult {
  dateKey: DateKey;
  status: DayStatus;
  /** Null when the day issues no quest (neutral, paused, legacy). */
  tier: Tier | null;
  engineIssued: boolean;
  isTrainingDay: boolean;
  illness: boolean;
  paused: boolean;
  legacy: boolean;
  /** Planned-work completion 0–1 (training days). */
  completion: number;
  completedSets: number;
  plannedSets: number;
  cardioMinutes: number;
  plannedCardioMinutes: number;
  cleared: boolean;
  checkinCounted: boolean;
  recoveryDone: boolean;
  /** Exercises whose remaining sets a pain flag credited today. */
  painCredited: string[];
  /** Every record candidate detected today (saved regardless of XP). */
  records: RecordCandidate[];
  /** Records that earned XP today. */
  recordXp: RecordCandidate[];
  lines: XpLine[];
  xp: number;
  /** The reason line of the issued quest. */
  reason: string;
}

export interface StreakState {
  current: number;
  best: number;
  shields: number;
  /** Days a shield was spent on, oldest first. */
  shieldUsedOn: DateKey[];
}

export interface WeeklyObjective {
  key: "training" | "checkins";
  label: string;
  done: number;
  target: number;
  met: boolean;
}

export interface WeeklyResult {
  weekStart: DateKey;
  closed: boolean;
  objectives: WeeklyObjective[];
  /** Objective A met: counts toward rank requirements. */
  qualifying: boolean;
  xp: number;
}

export interface StatValue {
  value: number;
  /** Value 28 days ago, for the delta. */
  previous: number | null;
  delta: number | null;
  trend: "up" | "steady" | "down" | "none";
}

export interface Stats {
  str: StatValue & { measuredGroups: number; groups: Record<"squat" | "hinge" | "push" | "pull", number | null> };
  end: StatValue & { weeklyMinutes: number; longestMinutes: number };
  vit: StatValue & { calibrating: boolean; checkinRate: number; sleepScore: number; restHonor: number };
}

export interface Requirement {
  key: "level" | "weeks" | "keptDays" | "strOrEnd" | "vit" | "trial";
  label: string;
  target: number;
  current: number;
  met: boolean;
}

export interface NextRank {
  rank: Rank | null;
  title: string | null;
  requirements: Requirement[];
  /** Every requirement except the trial is met. */
  trialAvailable: boolean;
}

export type TrialKind = "loaded" | "bodyweight" | "cardio";

export interface TrialSpec {
  targetRank: Rank;
  kind: TrialKind;
  /** The exercise it attaches to (loaded / bodyweight); null for cardio. */
  exerciseId: string | null;
  exerciseName: string | null;
  loadKg: number | null;
  reps: number | null;
  minutes: number | null;
  /** Plain-words prescription shown on the sheet. */
  spec: string;
}

export interface AchievementState extends AchievementSpec {
  unlocked: boolean;
  /** Progress toward the requirement, for locked ones. */
  progress: number;
  target: number;
}

export type ProgressStatus = "ready" | "loading-history";

export interface ProgressInput {
  days: DayMap;
  program: ProgramPayloadV2 | null;
  settings: GameSettings;
  todayKey: DateKey;
  /** False while older history is still paging in: records and level-ups are withheld. */
  historyComplete?: boolean;
  /** The athlete's UTC offset, for the late-logging window. */
  utcOffsetMinutes?: number;
  /** The caller's clock; the domain never reads one. Defaults to the end of todayKey. */
  nowMs?: number;
  metaFor: (log: ExerciseLog) => ExerciseMeta;
}

export interface NextAction {
  key: "checkin" | "begin" | "continue" | "cardio" | "recovery" | "claim" | "cleared" | "paused" | "none";
  label: string;
  primary: boolean;
}

export interface Progress {
  status: ProgressStatus;
  rulesVersion: number;
  xp: number;
  level: number;
  levelProgress: { into: number; needed: number; fraction: number };
  /** max(derived, high-water mark) */
  rank: Rank;
  derivedRank: Rank;
  rankTitle: string;
  nextRank: NextRank;
  stats: Stats;
  streak: StreakState;
  qualifyingWeeks: number;
  keptDays: number;
  weeks: WeeklyResult[];
  achievements: AchievementState[];
  titles: { unlocked: string[]; total: number };
  days: Record<DateKey, DayResult>;
  today: DayResult;
  trial: TrialSpec | null;
  /** High-water marks newly reached by this computation; the caller persists them. */
  newHighs: Partial<GameHigh>;
}
