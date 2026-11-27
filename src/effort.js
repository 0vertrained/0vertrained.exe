// src/effort.js
// Effort on Apple's 1 to 10 scale, in its words: 1 to 3 easy, 4 to 6
// moderate, 7 and 8 hard, 9 and 10 all out. Used for the session rating on
// the Box Score and for a run's effort read from Apple Health.

const EFFORT_WORDS = [[3, "easy"], [6, "moderate"], [8, "hard"], [10, "all out"]];

export function effortWord(value) {
  const score = Number(value);
  if (!Number.isFinite(score) || score < 1 || score > 10) return "";
  return EFFORT_WORDS.find(([top]) => score <= top)?.[1] || "";
}
