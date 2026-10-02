// src/intelligenceTypes.js
// Shared JSDoc shapes for the 0vertrained Intelligence Layer.

/**
 * @typedef {"push"|"normal"|"moderate"|"pull_back"|"rest"} ReadinessBand
 * @typedef {"low"|"medium"|"high"} Confidence
 *
 * @typedef {Object} IntelligenceReason
 * @property {"recovery"|"load"|"sleep"|"nutrition"|"program"|"trend"|"manual"} source
 * @property {"positive"|"neutral"|"caution"|"warning"} severity
 * @property {string} label
 * @property {string} detail
 * @property {number|null} value
 * @property {number|null} baseline
 *
 * @typedef {Object} IntelligenceRecommendation
 * @property {ReadinessBand} readiness
 * @property {Confidence} confidence
 * @property {string} title
 * @property {string} summary
 * @property {IntelligenceReason[]} reasons
 * @property {string[]} suggestedAdjustments
 * @property {string[]} warnings
 * @property {string[]} missingData
 */

export const READINESS = Object.freeze({
  PUSH: "push",
  NORMAL: "normal",
  MODERATE: "moderate",
  PULL_BACK: "pull_back",
  REST: "rest",
});

export const CONFIDENCE = Object.freeze({
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
});

export const SEVERITY = Object.freeze({
  POSITIVE: "positive",
  NEUTRAL: "neutral",
  CAUTION: "caution",
  WARNING: "warning",
});
