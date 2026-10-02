// The level curve: quadratic and closed-form, so a level is one square root
// away from a total and never needs a stored counter.
//
//   XP from L to L+1 = perLevel × L
//   XP to reach L    = (perLevel / 2) × L × (L − 1)
//   level(xp)        = floor((1 + sqrt(1 + xp / (perLevel / 8))) / 2), capped
//
// With perLevel = 60 and ~650 XP per adherent week: L5 ≈ week 1, L10 ≈ a
// month, L22 ≈ five months, L50 ≈ two years.

import { LEVELS } from "./config";

const half = LEVELS.perLevel / 2;

export function xpToReachLevel(level: number): number {
  const L = Math.max(1, Math.min(LEVELS.max, Math.floor(level)));
  return half * L * (L - 1);
}

export function xpToNextLevel(level: number): number {
  return LEVELS.perLevel * Math.max(1, Math.floor(level));
}

export function levelFromXp(xp: number): number {
  if (!(xp > 0)) return 1;
  const level = Math.floor((1 + Math.sqrt(1 + xp / (LEVELS.perLevel / 8))) / 2);
  return Math.max(1, Math.min(LEVELS.max, level));
}

export interface LevelProgress {
  level: number;
  into: number;
  needed: number;
  fraction: number;
}

export function levelProgress(xp: number): LevelProgress {
  const level = levelFromXp(xp);
  if (level >= LEVELS.max) return { level, into: 0, needed: 0, fraction: 1 };
  const into = Math.max(0, xp - xpToReachLevel(level));
  const needed = xpToNextLevel(level);
  return { level, into, needed, fraction: Math.min(1, into / needed) };
}
