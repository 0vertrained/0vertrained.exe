// Achievements: milestones read from the engine's outputs, each unlocking a
// title. They are a high-water mark: an id stored in settings.game.high stays
// unlocked even when the numbers behind it are later recomputed lower.

import type { DateKey } from "../dates";
import { ACHIEVEMENTS, RANK_ORDER, TITLE_COUNT } from "./config";
import { rankIndex, rankTitle } from "./ranks";
import type { AchievementState, DayResult, GameHigh, Rank, StreakState, WeeklyResult } from "./types";

export { TITLE_COUNT };

export interface AchievementInput {
  results: Record<DateKey, DayResult>;
  streak: StreakState;
  weeks: readonly WeeklyResult[];
  /** Records set so far, counted by the caller. */
  recordCount: number;
  /** The longest single cardio log ever, in minutes. */
  longestCardioMinutes: number;
  high?: Partial<GameHigh>;
}

interface Counts {
  questsCleared: number;
  checkins: number;
  restRecoveries: number;
  reducedCleared: number;
  fullWeeks: number;
  bestStreak: number;
  records: number;
  longestCardio: number;
}

/** A training quest (FULL or REDUCED) that was cleared under the game's rules. */
export const isClearedQuest = (r: DayResult): boolean =>
  r.isTrainingDay && (r.tier === "FULL" || r.tier === "REDUCED") && r.cleared && !r.legacy;

function count(input: AchievementInput): Counts {
  const results = Object.values(input.results);
  return {
    questsCleared: results.filter(isClearedQuest).length,
    checkins: results.filter((r) => r.checkinCounted).length,
    restRecoveries: results.filter((r) => r.tier === "REST" && r.recoveryDone).length,
    reducedCleared: results.filter((r) => r.tier === "REDUCED" && r.engineIssued && r.cleared).length,
    fullWeeks: input.weeks.filter((w) => w.closed && w.objectives.every((o) => o.met)).length,
    bestStreak: input.streak.best,
    records: input.recordCount,
    longestCardio: input.longestCardioMinutes,
  };
}

/** [progress, target] per achievement id. */
const RULES: Readonly<Record<string, (c: Counts) => [number, number]>> = {
  first_quest: (c) => [c.questsCleared, 1],
  calibrated: (c) => [c.checkins, 7],
  rest_is_training: (c) => [c.restRecoveries, 10],
  listener: (c) => [c.reducedCleared, 5],
  full_week: (c) => [c.fullWeeks, 1],
  unbroken_1: (c) => [c.bestStreak, 7],
  unbroken_2: (c) => [c.bestStreak, 30],
  unbroken_3: (c) => [c.bestStreak, 100],
  record_1: (c) => [c.records, 1],
  record_2: (c) => [c.records, 10],
  record_3: (c) => [c.records, 50],
  long_haul: (c) => [c.longestCardio, 60],
  century: (c) => [c.questsCleared, 100],
};

/** Progress and target for one achievement id; an id without a rule never unlocks on its own. */
export function progressFor(id: string, input: AchievementInput): [number, number] {
  return RULES[id]?.(count(input)) ?? [0, 1];
}

export function evaluateAchievements(input: AchievementInput): AchievementState[] {
  const counts = count(input);
  const held = new Set(input.high?.achievements ?? []);
  return ACHIEVEMENTS.map((spec) => {
    const [progress, target] = RULES[spec.id]?.(counts) ?? [0, 1];
    return { ...spec, unlocked: progress >= target || held.has(spec.id), progress: Math.min(progress, target), target };
  });
}

/** Ids unlocked now that the high-water mark doesn't hold yet. */
export function newlyUnlocked(states: readonly AchievementState[], high?: Partial<GameHigh>): string[] {
  const held = new Set(high?.achievements ?? []);
  return states.filter((s) => s.unlocked && !held.has(s.id)).map((s) => s.id);
}

export function achievementXp(ids: readonly string[]): number {
  return ids.reduce((sum, id) => sum + (ACHIEVEMENTS.find((a) => a.id === id)?.xp ?? 0), 0);
}

/** Unlocked achievement titles plus the title of every rank earned above E. */
export function titlesUnlocked(states: readonly AchievementState[], rank: Rank): string[] {
  const ranks = RANK_ORDER.slice(1, rankIndex(rank) + 1).map(rankTitle);
  return [...states.filter((s) => s.unlocked).map((s) => s.title), ...ranks];
}
