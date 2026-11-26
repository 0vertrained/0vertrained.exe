// src/sharedCall.js
// One call, the same on Today and on Recovery. Two engines read the day:
// Today's (the recovery score with training load, soreness and the check-in)
// and Recovery's (the wearable score with its limiters: sleep debt, alerts,
// load, the check-in). Both screens show the more cautious of the two, with
// the recovery score beside it. Neither engine's own math changes here.

import { resolveRecoveryContext } from "./recovery/wearableSourceResolver";
import { buildConservativeBlendContext, applyWearableConfidenceAdjustment, buildBlendExplanation } from "./recovery/conservativeBlending";
import { buildRecoveryVerdict, describeCall } from "./recovery/verdictResolver";
import { readCheckin, checkinSeverity } from "./checkinMorning";

// Recovery's calls, least cautious first.
export const CALL_ORDER = ["push", "train", "capped", "easy", "recover"];

// Today's engine speaks in four calls; Recovery's resolver in five.
const TODAY_TO_SHARED = { push: "push", maintain: "train", modify: "easy", recover: "recover" };
// The other way, for capping Today's call: Today has no "capped", so a capped
// day keeps Today's plan as written (maintain) and shows the capped call.
export const SHARED_TO_TODAY = { push: "push", train: "maintain", capped: "maintain", easy: "modify", recover: "recover" };

/**
 * Recovery's verdict from its loaded state: blend the two wearables when both
 * are connected, read this morning's check-in, then resolve one call. Recovery
 * and Today both call this, so they read the verdict the same way.
 */
export function deriveRecoveryVerdict({
  recovery = null,
  sleepDebt = null,
  alerts = null,
  trainingLoad = null,
  confidence = null,
  recommendation = null,
  ouraGrouped = null,
  whoopGrouped = null,
  whoopConnected = false,
  manualBody = {},
  todayBody = {},
  settings = {},
} = {}) {
  const resolvedContext = (whoopConnected && ouraGrouped)
    ? resolveRecoveryContext({ ouraData: ouraGrouped, whoopData: whoopGrouped, manualData: manualBody, settings })
    : null;
  const wearableConflicts = resolvedContext?.conflicts || [];
  const blendContext = resolvedContext
    ? buildConservativeBlendContext({ resolvedContext, recovery, trainingLoad, recommendation })
    : null;
  const blendedRecommendation = blendContext?.applicable
    ? applyWearableConfidenceAdjustment({ recommendation, resolvedContext, blendContext })
    : recommendation;
  const blendExplanation = buildBlendExplanation(blendContext);
  const checkin = readCheckin(todayBody || {});
  const checkinCaution = { severity: checkinSeverity(checkin), flags: checkin.flags };
  const verdict = recovery
    ? buildRecoveryVerdict({ recommendation: blendedRecommendation, recovery, sleepDebt, alerts, trainingLoad, confidence, checkin: checkinCaution })
    : null;
  return {
    verdict,
    checkin,
    wearableConflicts,
    blendedRecommendation,
    blendExplanation,
    resolvedRecommendation: verdict ? verdict.recommendation : blendedRecommendation,
  };
}

/**
 * The same, from what loadRecoveryData returned. Null until a wearable
 * load has scored the night.
 */
export function recoveryVerdictFromLoad(load, { data = {}, todayKey, yesterdayKey, settings = {} } = {}) {
  const snapshot = load?.snapshot;
  if (!load?.connected || !snapshot?.recovery) return null;
  return deriveRecoveryVerdict({
    recovery: snapshot.recovery,
    sleepDebt: snapshot.sleepDebt,
    alerts: snapshot.alerts,
    trainingLoad: snapshot.trainingLoad,
    confidence: snapshot.confidence,
    recommendation: snapshot.recommendation,
    ouraGrouped: load.ouraGrouped,
    whoopGrouped: load.whoopGrouped,
    whoopConnected: load.whoopConnected,
    manualBody: data?.[yesterdayKey]?.body || {},
    todayBody: data?.[todayKey]?.body || {},
    settings,
  }).verdict;
}

/**
 * The one call both screens show.
 * @param {object} opts
 * @param {string|null} opts.todayCall - Today's engine call, before any cap
 *   from Recovery: push | maintain | modify | recover.
 * @param {object|null} opts.recoveryVerdict - from deriveRecoveryVerdict.
 * @param {number|null} opts.score - the recovery score shown beside the call.
 * @returns {object|null} { call, level, stamp, headline, source, score },
 *   where source says whose call it is: "today", "recovery" or "both".
 */
export function resolveSharedCall({ todayCall = null, recoveryVerdict = null, score = null } = {}) {
  const fromToday = todayCall ? TODAY_TO_SHARED[todayCall] || "train" : null;
  const fromRecovery = CALL_ORDER.includes(recoveryVerdict?.call) ? recoveryVerdict.call : null;
  if (!fromToday && !fromRecovery) return null;
  let call = fromToday || fromRecovery;
  let source = fromToday ? "today" : "recovery";
  if (fromToday && fromRecovery) {
    const today = CALL_ORDER.indexOf(fromToday);
    const recovery = CALL_ORDER.indexOf(fromRecovery);
    call = today >= recovery ? fromToday : fromRecovery;
    source = today === recovery ? "both" : today > recovery ? "today" : "recovery";
  }
  const shown = Number.isFinite(Number(score)) && score !== null ? Math.round(Number(score)) : null;
  return { ...describeCall(call), source, score: shown };
}
