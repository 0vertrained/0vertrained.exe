// src/oura.js
// Oura Ring Integration — Modular Re-export Facade
//
// This file re-exports all named exports from modular submodules, maintaining
// compatibility with existing imports while organizing code coherently.

import * as auth from "./oura/auth";
import * as dataLoading from "./oura/dataLoading";
import * as normalization from "./oura/normalization";
import * as statistics from "./oura/statistics";
import * as algorithms from "./oura/algorithms";
import * as alerts from "./oura/alerts";
import * as insights from "./oura/insights";
import * as coachContext from "./oura/coachContext";

// Auth & Connection Management
export {
  getOuraAuthUrl,
  isOuraConnected,
  disconnectOura,
  getOuraTokenStatus,
  getOuraSyncEvents,
  syncOuraNow,
  getOuraSyncCounts,
} from "./oura/auth";

// Data Loading
export {
  loadOuraData,
  loadOuraTokens,
} from "./oura/dataLoading";

// Data Normalization
export {
  normalizeSleep,
  normalizeReadiness,
  normalizeActivity,
  normalizeHeartRate,
  normalizeSpO2,
  firstDoc,
  getSleepDoc,
  getAnySleepDoc,
  isMainSleepDoc,
  mainSleepDurationSeconds,
  napSleepDurationSeconds,
  getReadinessDoc,
  readinessContributor,
  latestDay,
  recoveryDates,
  latestRecoveryDay,
  hrvRmssd,
  hrvRmssdWithSource,
  rhrValue,
  tempDeviation,
} from "./oura/normalization";

// Statistics & Math
export {
  mean,
  stdDev,
  median,
  trimmedMean,
  lnRMSSD,
  zScore,
  cv,
  linearRegression,
  rollingWindow,
} from "./oura/statistics";

// Algorithms
export {
  calcHRVScore,
  calcRHRScore,
  calcSleepSubscore,
  calcTempScore,
  calcRecoveryScore,
  calcSleepQualityIndex,
  calcTrainingReadiness,
  hrvTrendSlopePerDay,
  rhrTrendSlopePerDay,
  getHRVRecommendation,
  calcSleepDebt,
} from "./oura/algorithms";

// Alerts & History
export {
  checkAlerts,
  getAlertHistory,
  saveAlertSnapshot,
  clearAlertHistory,
  getAlertHistoryKey,
} from "./oura/alerts";

// Insights & Recommendations
export {
  calcOuraDataQuality,
  calcMetricBaselines,
  calcRecoveryConfidence,
  getTrainingRecommendation,
  calcRecoveryInsights,
  describeMetricSources,
} from "./oura/insights";

// Coach Context
export {
  buildOuraCoachContext,
} from "./oura/coachContext";

// Default export — aggregate object for compatibility with any namespace/default consumers.
export default {
  ...auth,
  ...dataLoading,
  ...normalization,
  ...statistics,
  ...algorithms,
  ...alerts,
  ...insights,
  ...coachContext,
};
