// src/recovery/aggregationModel.js
// Full Aggregation Model
//
// Pure, side-effect-free enrichment layer that sits between the wearable
// source resolver + conservative blending and the decision engine. It
// assembles a unified recovery context from every available source — Oura,
// Whoop, and manual check-in — and produces an aggregated confidence + source
// map + supplemental context for the Today Coach and Recovery UI.
//
// DESIGN INVARIANTS (enforced in code and tests):
//   1. The canonical recovery score is NEVER modified. It is echoed verbatim
//      from calcRecoveryScore (Oura-only). recoveryScoreUnchanged is always true.
//   2. Whoop recovery is CONTEXT ONLY. It is never blended into the score and
//      never averaged with Oura readiness. Different weightings = fake certainty.
//   3. Whoop strain supplements the training-load picture. It can only add
//      caution (bias conservative) — it can NEVER push the recommendation harder.
//   4. Confidence only ever goes DOWN. Conflicts, fallbacks, and missing core
//      metrics downgrade it. It is never raised by wearable data.
//   5. Manual subjective readiness is ALWAYS first-class and never overridden.
//   6. When Whoop is not connected, everything degrades gracefully to the
//      Oura-only path. The output is null/no-op and callers behave as before.
//
// No network, no Supabase, no localStorage, no side effects. Null-safe.

import { resolveRecoveryContext, buildSourceMap } from "./wearableSourceResolver";
import { buildConservativeBlendContext } from "./conservativeBlending";
import { buildWearableSourceNote } from "../recoverySummary";
import { normalizeRecovery, latestWhoopDate } from "../whoop/normalization";

const CONFIDENCE_ORDER = ["low", "medium", "high"];

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// One-step confidence downgrade (high → medium → low). low stays low.
function downgrade(level, steps = 1) {
  const idx = CONFIDENCE_ORDER.indexOf(String(level));
  if (idx < 0) return level || null;
  return CONFIDENCE_ORDER[Math.max(0, idx - Math.max(0, steps))];
}

// Whoop day-strain runs 0–21. These thresholds match conservativeBlending.js.
const STRAIN_ELEVATED = 14;
const STRAIN_HIGH = 18;

/**
 * Build the full aggregated recovery context from all available sources.
 *
 * @param {object} params
 * @param {object} [params.ouraData] - grouped Oura map (date → docs) or null
 * @param {object} [params.whoopData] - grouped Whoop map (date → docs) or null
 * @param {object} [params.manualData] - manual check-in body or null
 * @param {object} [params.recovery] - canonical calcRecoveryScore output { score, source, band }
 * @param {object} [params.trainingLoad] - existing ACWR model (unused in scoring, reserved)
 * @param {object} [params.settings] - user settings (reserved for future per-user overrides)
 * @param {string} [params.date] - optional explicit date (YYYY-MM-DD)
 * @param {object} [params.recommendation] - the decision engine's recommendation (for confidence base)
 * @returns {object|null} aggregated context, or null when no wearables are connected
 */
export function buildAggregatedRecoveryContext({
  ouraData = null,
  whoopData = null,
  manualData = null,
  recovery = null,
  trainingLoad = null,
  settings = null,
  date = null,
  recommendation = null,
} = {}) {
  void trainingLoad; // reserved: strain framing may reference load zone later.
  void settings; // reserved for future per-user source overrides.

  // If Whoop is not connected, there is nothing to aggregate beyond the
  // existing Oura-only path. Return null so callers use that path.
  const hasWhoop = whoopData && typeof whoopData === "object" && Object.keys(whoopData).length > 0;
  if (!hasWhoop) return null;

  // ── Canonical recovery score (NEVER modified) ──────────────────────────────
  const recoveryScore = num(recovery?.score);
  const recoverySource = recovery?.source || null;

  // ── Resolved per-metric context ────────────────────────────
  const resolvedContext = resolveRecoveryContext({
    ouraData, whoopData, manualData, date, settings: settings || {},
  });

  // ── Conservative blend ──────────────────────────────────────────────
  const blend = buildConservativeBlendContext({
    resolvedContext,
    recovery,
    trainingLoad,
    recommendation,
  });

  // ── Whoop recovery context (DISPLAY ONLY — never scored) ───────────────────
  // Read the Whoop recovery score directly from the Whoop data (not from the
  // resolver, which prefers Oura). Compare to the canonical recovery score for
  // a "delta" signal. A large delta is NOT a conflict by itself (different
  // weightings), but it is useful context for the coach. The resolver
  // already detects per-metric conflicts; this is a softer, score-level
  // comparison.
  const resolvedDate = resolvedContext?.date || date || latestWhoopDate(whoopData);
  const whoopDayData = resolvedDate ? whoopData?.[resolvedDate] : null;
  const whoopRecoveryNorm = whoopDayData ? normalizeRecovery(whoopDayData.recovery) : null;
  const whoopRecoveryScore = num(whoopRecoveryNorm?.recoveryScore);
  let whoopRecoveryContext = null;
  if (whoopRecoveryScore !== null) {
    const delta = recoveryScore !== null ? whoopRecoveryScore - recoveryScore : null;
    const absDelta = delta !== null ? Math.abs(delta) : null;
    const severity = absDelta === null ? "unknown" : absDelta >= 30 ? "large" : absDelta >= 15 ? "moderate" : "small";
    whoopRecoveryContext = {
      score: whoopRecoveryScore,
      deltaFromOura: delta,
      severity,
      note: severity === "large"
        ? `Whoop recovery (${whoopRecoveryScore}) differs materially from Oura readiness — context only, scores are never averaged.`
        : severity === "moderate"
          ? `Whoop recovery (${whoopRecoveryScore}) differs from Oura readiness — context only, scores are never averaged.`
          : `Whoop recovery (${whoopRecoveryScore}) aligns with Oura readiness — scores are never averaged.`,
    };
  }

  // ── Whoop strain context (SUPPLEMENTAL LOAD — never pushes harder) ──────────
  const strainValue = num(resolvedContext?.strain?.value);
  const strainSource = resolvedContext?.strain?.source || null;
  let whoopStrainContext = null;
  if (strainValue !== null) {
    const level = strainValue >= STRAIN_HIGH ? "high" : strainValue >= STRAIN_ELEVATED ? "elevated" : "normal";
    whoopStrainContext = {
      value: Math.round(strainValue * 10) / 10,
      level,
      source: strainSource,
      supplementType: "load_context",
      note: level === "high"
        ? `Whoop strain is high (${Math.round(strainValue * 10) / 10}) — supplemental load context only, not a reason to train harder.`
        : level === "elevated"
          ? `Whoop strain is elevated (${Math.round(strainValue * 10) / 10}) — supplemental load context.`
          : `Whoop strain ${Math.round(strainValue * 10) / 10} — within normal range.`,
    };
  }

  // ── Aggregated confidence (the key output) ──────────────────────────────────
  // Start from the recommendation's confidence (or "high" if none given), then
  // only ever downgrade. Never upgrade.
  let aggregatedConfidence = recommendation?.confidence || "high";
  const confidenceReasons = [];

  // 1. Conflicts downgrade confidence
  if (blend?.confidenceAdjustment?.direction === "down") {
    const steps = blend.confidenceAdjustment.steps || 1;
    aggregatedConfidence = downgrade(aggregatedConfidence, steps);
    confidenceReasons.push(
      `${blend.conflictSeverity === "major" ? "Major" : "Minor"} wearable disagreement on ${(blend.conflictMetrics || []).join(", ")}`
    );
  }

  // 2. Fallback usage downgrades confidence (Whoop filling in for missing Oura)
  const fallbackMetrics = (blend?.fallbacks || []).map((f) => f.metric);
  if (fallbackMetrics.length > 0) {
    aggregatedConfidence = downgrade(aggregatedConfidence, 1);
    confidenceReasons.push(`Whoop fallback used for ${fallbackMetrics.join(", ")}`);
  }

  // 3. Missing core metrics downgrade confidence
  const coreMetrics = ["hrv", "rhr", "sleep"];
  const missingCore = coreMetrics.filter((m) => {
    const resolved = resolvedContext?.[m];
    return !resolved || resolved.source === null || resolved.value === null;
  });
  if (missingCore.length > 0 && recoverySource === "oura") {
    aggregatedConfidence = downgrade(aggregatedConfidence, 1);
    confidenceReasons.push(`Missing core metrics: ${missingCore.join(", ")}`);
  }

  // 4. No recovery score at all → low confidence
  if (recoveryScore === null) {
    aggregatedConfidence = "low";
    confidenceReasons.push("No recovery score available");
  }

  // ── Source map + disclosure ─────────────────────────────────────────────────
  const sourceMap = buildSourceMap(resolvedContext);
  const sourceNote = buildWearableSourceNote(resolvedContext);

  // ── Assembled metrics with source labels ────────────────────────────────────
  const metrics = {};
  for (const key of ["hrv", "rhr", "sleep", "sleepQuality", "temp", "recovery", "strain", "respiratoryRate", "spo2", "subjective"]) {
    const resolved = resolvedContext?.[key];
    if (resolved) {
      metrics[key] = {
        value: resolved.value,
        source: resolved.source,
        confidence: resolved.confidence,
        fallbackUsed: resolved.fallbackUsed || false,
      };
    }
  }

  return {
    // Canonical score — UNCHANGED invariant
    recoveryScore,
    recoverySource,
    recoveryScoreUnchanged: true,

    // Per-metric resolved values
    metrics,

    // Supplemental context (display + coach, never scored)
    whoopRecoveryContext,
    whoopStrainContext,

    // Conflict + blend
    conflicts: resolvedContext?.conflicts || [],
    conflictAction: resolvedContext?.conflictAction || null,
    blend,

    // Aggregated confidence (the key output)
    aggregatedConfidence,
    confidenceReasons,

    // Source disclosure
    sourceMap,
    sourceNote,

    // Resolved date
    date: resolvedContext?.date || null,

    // Applicability flag (false when only Oura is connected)
    applicable: true,
  };
}

/**
 * Build a compact coach-facing summary from the aggregated context.
 * Capped at ~300 chars for LLM injection. Includes the canonical recovery
 * score, conflict flags, strain context, and source disclosure.
 * @param {object} aggContext - output of buildAggregatedRecoveryContext
 * @param {string|null} baseContext - the existing Oura-only coach context string
 * @returns {string|null}
 */
export function buildAggregatedCoachSummary(aggContext, baseContext = null) {
  if (!aggContext || !aggContext.applicable) return baseContext || null;

  const parts = [];
  if (baseContext) parts.push(baseContext);

  // Whoop strain context
  if (aggContext.whoopStrainContext && aggContext.whoopStrainContext.level !== "normal") {
    parts.push(aggContext.whoopStrainContext.note);
  }

  // Conflict flag
  if (aggContext.conflicts.length > 0) {
    const metrics = aggContext.conflicts.map((c) => c.metric).join(", ");
    parts.push(`Mixed signal day — Oura/Whoop disagree on ${metrics}; lean conservative`);
  }

  // Confidence reason (if lowered)
  if (aggContext.confidenceReasons.length > 0) {
    parts.push(`Confidence lowered: ${aggContext.confidenceReasons.join("; ")}`);
  }

  // Source disclosure
  if (aggContext.sourceNote) {
    parts.push(`Sources: ${aggContext.sourceNote}`);
  }

  let out = parts.filter(Boolean).join(". ");
  if (!out) return baseContext || null;
  if (out.length > 300) out = `${out.slice(0, 299).trimEnd()}…`;
  return out;
}

/**
 * Build a compact "why this confidence" explanation for the UI.
 * @param {object} aggContext
 * @returns {{label: string, reasons: string[], tone: string}}
 */
export function buildConfidenceExplanation(aggContext) {
  if (!aggContext || !aggContext.applicable) {
    return { label: null, reasons: [], tone: "neutral" };
  }
  const conf = aggContext.aggregatedConfidence;
  const tone = conf === "low" ? "warning" : conf === "medium" ? "caution" : "good";
  const label = `${conf} confidence`;
  return {
    label,
    reasons: aggContext.confidenceReasons || [],
    tone,
  };
}

export default {
  buildAggregatedRecoveryContext,
  buildAggregatedCoachSummary,
  buildConfidenceExplanation,
};