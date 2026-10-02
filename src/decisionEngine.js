// src/decisionEngine.js
// Deterministic, explainable v0 decision layer. No React, no network, no writes.

import { summarizeProgramDay } from "./programSummary";
import { READINESS, CONFIDENCE, SEVERITY } from "./intelligenceTypes";
import {
  ACWR_ZONES, MONOTONY_FLAG, READINESS_INDEX, READINESS_CUTS,
  READINESS_HYSTERESIS, PERSONALIZATION,
} from "./intelligenceConfig";

const n = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeRecoveryScore(raw) {
  if (!raw) return null;
  if (typeof raw === "number") return clamp(Math.round(raw), 0, 100);
  if (typeof raw === "object") {
    const score = n(raw.score ?? raw.recoveryScore ?? raw.value);
    return score === null ? null : clamp(Math.round(score), 0, 100);
  }
  return null;
}

function normalizeLoad(raw) {
  if (!raw) return { ratio: null, zone: null, acute: null, chronic: null, monotony: null };
  const zone = typeof raw.zone === "string" ? raw.zone : null;
  const ratioRaw = n(raw.ratio ?? raw.acwr);
  // Insufficient-data or non-positive ratios are NOT a real "0.00 ACWR" — treat
  // them as missing so confidence drops and the engine doesn't assert a number
  // it doesn't have.
  const ratio = (zone === "insufficient_data" || ratioRaw === null || ratioRaw <= 0) ? null : ratioRaw;
  return {
    ratio,
    zone,
    acute: n(raw.acute),
    chronic: n(raw.chronic),
    monotony: n(raw.monotony),
  };
}

function inferProgramLabel(todayProgram) {
  return summarizeProgramDay(todayProgram).label;
}

export function buildDecisionContext({
  todayProgram = null,
  entries = {},
  ouraData = null,
  settings = {},
  trainingLoad = null,
  todayKey = null,
  recovery = null,
  personal = null,
  previousReadiness = null,
} = {}) {
  const recoveryScore = normalizeRecoveryScore(recovery ?? ouraData?.recovery ?? ouraData?.score);
  const load = normalizeLoad(trainingLoad);
  const missingData = [];
  if (recoveryScore === null) missingData.push("recovery");
  if (load.ratio === null) missingData.push("training load");
  if (!todayProgram) missingData.push("today program");

  return {
    todayKey,
    todayProgram,
    programLabel: inferProgramLabel(todayProgram),
    entries,
    settings,
    recoveryScore,
    load,
    personal,
    previousReadiness,
    missingData,
  };
}

const clampUnit = (x) => Math.max(0, Math.min(1, x));

// Continuous readiness index in [0,100]. Recovery sets the ceiling; training
// load discounts it (high ACWR / monotony). Personalization nudges the recovery
// sub-score by how today compares to the athlete's own rolling baseline. This
// replaces the old hard-threshold cliffs where 54 vs 55 flipped the call.
export function computeReadinessIndex(recovery, load = {}, personal = null) {
  if (recovery === null || recovery === undefined) return null;
  const K = READINESS_INDEX;

  let rSub = clampUnit((recovery - K.restFloor) / (K.pushCeil - K.restFloor));
  let z = null;
  if (personal && personal.n >= PERSONALIZATION.minDays && personal.sd > 0) {
    z = (recovery - personal.mean) / personal.sd;
    const adj = Math.max(-PERSONALIZATION.maxAdjust, Math.min(PERSONALIZATION.maxAdjust, z * PERSONALIZATION.k));
    rSub = clampUnit(rSub + adj);
  }

  let loadFactor = 1;
  const acwr = load?.ratio ?? null;
  if (acwr !== null && acwr > K.loadKneeLow) {
    loadFactor = Math.max(K.loadFloor, Math.min(1, 1 - ((acwr - K.loadKneeLow) / (K.loadKneeHigh - K.loadKneeLow)) * (1 - K.loadFloor)));
  }
  if (load?.monotony && load.monotony > MONOTONY_FLAG) loadFactor *= K.monotonyPenalty;

  return { index: Math.round(clampUnit(rSub * loadFactor) * 100), z };
}

function rawBandFromIndex(i) {
  if (i >= READINESS_CUTS.push) return READINESS.PUSH;
  if (i >= READINESS_CUTS.normal) return READINESS.NORMAL;
  if (i >= READINESS_CUTS.moderate) return READINESS.MODERATE;
  if (i >= READINESS_CUTS.pull_back) return READINESS.PULL_BACK;
  return READINESS.REST;
}

// Map the index to a band, with a deadband around boundaries so the band only
// changes when the index moves decisively (no day-to-day flicker).
function bandFromIndex(i, prev = null) {
  const band = rawBandFromIndex(i);
  if (!prev || band === prev) return band;
  const order = { rest: 0, pull_back: 1, moderate: 2, normal: 3, push: 4 };
  const boundaries = [READINESS_CUTS.pull_back, READINESS_CUTS.moderate, READINESS_CUTS.normal, READINESS_CUTS.push];
  const up = order[band] > order[prev];
  const boundary = boundaries[Math.min(order[band], order[prev])];
  if (up && i < boundary + READINESS_HYSTERESIS) return prev;
  if (!up && i > boundary - READINESS_HYSTERESIS) return prev;
  return band;
}

function confidenceFor(ctx) {
  const missing = ctx.missingData.length;
  if (missing === 0) return CONFIDENCE.HIGH;
  if (missing <= 2) return CONFIDENCE.MEDIUM;
  return CONFIDENCE.LOW;
}

function reason(source, severity, label, detail, value = null, baseline = null) {
  return { source, severity, label, detail, value, baseline };
}

export function getDailyRecommendation(context = {}) {
  const ctx = context.recoveryScore !== undefined ? context : buildDecisionContext(context);
  const recovery = ctx.recoveryScore;
  const acwr = ctx.load?.ratio ?? null;
  const reasons = [];
  const warnings = [];
  const suggestedAdjustments = [];

  if (recovery !== null) {
    if (recovery < 45) {
      reasons.push(reason("recovery", SEVERITY.WARNING, "Low recovery", `Recovery is ${recovery}/100. Treat this as a recovery-first day.`, recovery, 70));
      warnings.push("Recovery is materially suppressed.");
    } else if (recovery < 55) {
      reasons.push(reason("recovery", SEVERITY.CAUTION, "Recovery suppressed", `Recovery is ${recovery}/100. Reduce intensity or volume.`, recovery, 70));
    } else if (recovery < 70) {
      reasons.push(reason("recovery", SEVERITY.CAUTION, "Moderate recovery", `Recovery is ${recovery}/100. Train, but avoid heroics.`, recovery, 70));
    } else if (recovery >= 80) {
      reasons.push(reason("recovery", SEVERITY.POSITIVE, "Strong recovery", `Recovery is ${recovery}/100. You likely have room for quality work.`, recovery, 70));
    } else {
      reasons.push(reason("recovery", SEVERITY.NEUTRAL, "Normal recovery", `Recovery is ${recovery}/100.`, recovery, 70));
    }
  }

  if (acwr !== null) {
    if (acwr > 1.5) {
      reasons.push(reason("load", SEVERITY.WARNING, "High training load", `ACWR is ${acwr.toFixed(2)}, above the high-risk threshold.`, acwr, 1.3));
      warnings.push("Acute load is high relative to chronic load.");
    } else if (acwr > 1.3) {
      reasons.push(reason("load", SEVERITY.CAUTION, "Elevated training load", `ACWR is ${acwr.toFixed(2)}, above the normal range.`, acwr, 1.3));
    } else if (acwr >= 0.8 && acwr <= 1.2) {
      reasons.push(reason("load", SEVERITY.POSITIVE, "Stable training load", `ACWR is ${acwr.toFixed(2)}, inside the productive range.`, acwr, 1.0));
    } else {
      reasons.push(reason("load", SEVERITY.NEUTRAL, "Low or changing load", `ACWR is ${acwr.toFixed(2)}.`, acwr, 1.0));
    }
  }

  if (ctx.programLabel) {
    reasons.push(reason("program", SEVERITY.NEUTRAL, "Scheduled work", `Today is ${ctx.programLabel}.`, null, null));
  }

  // Training monotony (Foster): repetitive day-to-day load raises illness/
  // overtraining risk independent of ACWR. Informational — does not gate readiness.
  if (ctx.load?.monotony !== null && ctx.load?.monotony > 2) {
    reasons.push(reason("load", SEVERITY.CAUTION, "High training monotony", `Monotony is ${ctx.load.monotony.toFixed(2)} (>2). Vary hard and easy days to lower strain.`, ctx.load.monotony, 2));
  }

  const readinessSignal = computeReadinessIndex(recovery, ctx.load, ctx.personal);
  const readinessIndex = readinessSignal ? readinessSignal.index : null;
  const recoveryZ = readinessSignal ? readinessSignal.z : null;

  let readiness;
  if (readinessIndex === null) {
    // No recovery signal — assess from load alone, conservatively.
    if (acwr !== null && acwr > ACWR_ZONES.overreachMax) readiness = READINESS.PULL_BACK;
    else if (acwr !== null && acwr > ACWR_ZONES.optimalMax) readiness = READINESS.MODERATE;
    else readiness = READINESS.NORMAL;
  } else {
    readiness = bandFromIndex(readinessIndex, ctx.previousReadiness);
  }

  // Personalization note — fires only when a real baseline existed and today is
  // notably off it, so "low/high for you" surfaces even when absolutes look mid.
  if (recoveryZ !== null && ctx.personal && Math.abs(recoveryZ) >= 1) {
    const lowFor = recoveryZ < 0;
    reasons.push(reason("recovery", lowFor ? SEVERITY.CAUTION : SEVERITY.POSITIVE,
      lowFor ? "Low for your baseline" : "Above your baseline",
      `Recovery ${recovery}/100 is ${Math.abs(recoveryZ).toFixed(1)} SD ${lowFor ? "below" : "above"} your ${ctx.personal.n}-day norm (~${ctx.personal.mean}).`,
      recovery, ctx.personal.mean));
  }

  const copy = {
    [READINESS.PUSH]: {
      title: "Push Window",
      summary: "Recovery and load both support quality work today.",
      adjustment: "Keep the planned session. If warm-ups feel good, this is a reasonable day for intensity.",
    },
    [READINESS.NORMAL]: {
      title: "Normal Load",
      summary: "Run the plan as written and monitor how warm-ups feel.",
      adjustment: "Keep the planned workout. Stop short of grinding reps.",
    },
    [READINESS.MODERATE]: {
      title: "Moderate Load",
      summary: "Train today, but keep intensity controlled and avoid adding volume.",
      adjustment: "Cap top sets around RPE 7 and keep cardio conversational if possible.",
    },
    [READINESS.PULL_BACK]: {
      title: "Pull Back",
      summary: "Your recovery/load profile argues for reducing stress today.",
      adjustment: "Reduce volume 25–40%, remove finishers, and avoid intervals or max-effort sets.",
    },
    [READINESS.REST]: {
      title: "Rest Recommended",
      summary: "Low recovery plus elevated load is a bad trade. Recovery still counts as training.",
      adjustment: "Choose rest, mobility, or an easy walk. Resume intensity when markers rebound.",
    },
  }[readiness];

  suggestedAdjustments.push(copy.adjustment);

  return {
    readiness,
    readinessIndex,
    recoveryZ: recoveryZ === null ? null : Math.round(recoveryZ * 100) / 100,
    confidence: confidenceFor(ctx),
    title: copy.title,
    summary: copy.summary,
    reasons: reasons.slice(0, 6),
    suggestedAdjustments,
    warnings,
    missingData: ctx.missingData || [],
  };
}

export function summarizeRecommendationForCoach(rec) {
  if (!rec) return null;
  return {
    readiness: rec.readiness,
    confidence: rec.confidence,
    title: String(rec.title || "").slice(0, 80),
    summary: String(rec.summary || "").slice(0, 240),
    reasons: Array.isArray(rec.reasons)
      ? rec.reasons.slice(0, 5).map(r => ({
          source: String(r.source || "").slice(0, 24),
          severity: String(r.severity || "").slice(0, 16),
          label: String(r.label || "").slice(0, 80),
        }))
      : [],
  };
}

export default { buildDecisionContext, getDailyRecommendation, summarizeRecommendationForCoach };
