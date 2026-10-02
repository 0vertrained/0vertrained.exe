// src/intelligenceConfig.js
// Single source of truth for the thresholds the intelligence layer used to
// duplicate (and disagree on) across recovery.js, decisionEngine.js, and
// loadModel.js. Tune behavior here, not in five places.

// Recovery "read" bands (0–100) — the descriptive recovery state.
export const RECOVERY_BANDS = Object.freeze({
  readyToPush: 85,
  good: 70,
  moderate: 55,
  takeEasy: 40,
  considerRest: 25,
});

// Recovery → semantic colour key.
export const RECOVERY_COLOR = Object.freeze({ good: 75, warn: 50 });

// Acute:Chronic Workload Ratio zone edges.
export const ACWR_ZONES = Object.freeze({
  underMax: 0.8,      // < this = undertraining
  optimalMax: 1.3,    // ≤ this = optimal
  overreachMax: 1.5,  // ≤ this = overreaching, above = high risk
});

// Foster training-monotony flag (mean/SD of daily load over a week).
export const MONOTONY_FLAG = 2.0;

// Continuous readiness index (0–100): recovery sets the ceiling, load discounts
// it. See computeReadinessIndex in decisionEngine.js.
export const READINESS_INDEX = Object.freeze({
  restFloor: 35,      // recovery at/below → recovery sub-score 0
  pushCeil: 85,       // recovery at/above → recovery sub-score 1
  loadKneeLow: 1.1,   // ACWR at/below → no load discount
  loadKneeHigh: 1.6,  // ACWR at/above → maximum load discount
  loadFloor: 0.4,     // most load can discount readiness to
  monotonyPenalty: 0.92,
});

// Index → readiness band cut points, plus a deadband so the band doesn't flip
// on trivial day-to-day noise near a boundary (hysteresis).
export const READINESS_CUTS = Object.freeze({ push: 80, normal: 62, moderate: 42, pull_back: 25 });
export const READINESS_HYSTERESIS = 4;

// Personalization: compare today's recovery to the user's own rolling baseline.
// Bounded nudge, and only once there's enough history to mean anything.
export const PERSONALIZATION = Object.freeze({
  minDays: 14,
  windowDays: 30,
  k: 0.05,         // index nudge per 1 SD from personal mean
  maxAdjust: 0.15, // cap on the nudge (sub-score units)
});

// Protein target derivation when no explicit goal is set (g per lb bodyweight).
export const PROTEIN_PER_LB = 0.9;
