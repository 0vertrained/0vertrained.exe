// src/recovery/conservativeBlending.js
// ─────────────────────────────────────────────────────────────────────────────
// V3.2 Conservative Blending
//
// Pure, side-effect-free layer that lets Whoop *supplement* the decision context
// WITHOUT ever changing, averaging, or re-deriving the canonical recovery SCORE.
// It sits on top of the V3.1 wearableSourceResolver (resolveRecoveryContext) and
// answers a single, narrow question: "given both wearables (and manual feel),
// how — if at all — should today's recommendation lean, and how confident are we?"
//
// The blend is deliberately one-directional and conservative:
//   • The recovery score is NEVER modified here. `recoveryScore` is echoed as-is
//     and `recoveryScoreUnchanged` is always true. calcRecoveryScore is untouched.
//   • Oura and Whoop values are NEVER averaged. Per-metric source PREFERENCE is
//     inherited from the resolver; this module only reads the resolved labels.
//   • Whoop STRAIN supplements training-load context only. A high strain can add
//     caution but can NEVER produce a *harder* training recommendation.
//   • Whoop HRV / RHR / sleep are used only as FALLBACK/context when Oura is
//     missing that metric (the resolver already decides this; we surface it).
//   • Conflicts LOWER confidence and can bias the recommendation conservative. A
//     major conflict biases conservative; a minor one only flags + lowers conf.
//   • Manual subjective readiness stays FIRST-CLASS and is never overridden.
//
// Everything is null-safe. No network, no Supabase, no localStorage, no logging
// of raw biometric payloads. Output is display/coach copy + small structured bits.
// ─────────────────────────────────────────────────────────────────────────────

// Whoop day-strain runs on a 0–21 scale. These thresholds mark where strain is
// worth surfacing as extra load context (never as a reason to train harder).
const STRAIN_ELEVATED = 14;
const STRAIN_HIGH = 18;

const CONFIDENCE_ORDER = ["low", "medium", "high"];

const SOURCE_DISPLAY = {
  oura: "Oura",
  whoop: "Whoop",
  manual: "Manual check-in",
  app_log: "App log",
};

// Friendly display labels for the metrics we attribute a source for.
const METRIC_LABELS = {
  hrv: "HRV",
  rhr: "Resting HR",
  sleep: "Sleep",
  strain: "Strain",
  recovery: "Recovery",
};

// Readiness bands, most-conservative first. Used ONLY to cap a recommendation
// toward caution — never to raise it toward more training.
const READINESS_RANK = { rest: 0, pull_back: 1, moderate: 2, normal: 3, push: 4 };
const RANK_READINESS = ["rest", "pull_back", "moderate", "normal", "push"];

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function downgradeConfidence(level, steps = 1) {
  const idx = CONFIDENCE_ORDER.indexOf(String(level));
  if (idx < 0) return level || null;
  return CONFIDENCE_ORDER[Math.max(0, idx - Math.max(0, steps))];
}

// Cap a readiness band so it can only move toward MORE caution, never toward
// more training. Returns the same band when the cap is already looser.
function capReadiness(readiness, maxBand) {
  const cur = READINESS_RANK[readiness];
  const cap = READINESS_RANK[maxBand];
  if (cur === undefined || cap === undefined) return readiness;
  return RANK_READINESS[Math.min(cur, cap)];
}

function sourceLabel(source) {
  return source ? SOURCE_DISPLAY[source] || source : null;
}

function metricLabelList(metrics) {
  return metrics.map((m) => METRIC_LABELS[m] || m).join(", ");
}

/**
 * Build the conservative blend context from a resolved recovery context.
 *
 * @param {object} params
 * @param {object} params.resolvedContext - output of resolveRecoveryContext (V3.1).
 * @param {object} params.recovery - the canonical recovery result ({score, source, band}).
 *   Its score is echoed verbatim and NEVER modified.
 * @param {object} params.trainingLoad - rolling-load model (for strain context framing).
 * @param {object} params.recommendation - the already-computed training recommendation.
 * @returns {object} blend context (see module header for the invariants).
 */
export function buildConservativeBlendContext({
  resolvedContext = null,
  recovery = null,
  trainingLoad = null,
  recommendation = null,
} = {}) {
  void trainingLoad; // reserved: strain framing may reference load zone later.
  void recommendation; // recommendation is adjusted separately, not read here.

  const recoveryScore = num(recovery?.score);
  const recoverySource = recovery?.source === "oura" ? "oura" : recovery?.source === "subjective" ? "subjective" : recovery?.source || null;

  // Nothing resolved (Oura-only path, or no wearables): return an inert, safe
  // context. Callers treat `applicable: false` as "behave exactly as before".
  const sources = resolvedContext?.sources || {};
  const hasWhoop = Object.values(sources).some((s) => s === "whoop");
  const hasOura = Object.values(sources).some((s) => s === "oura");
  const applicable = Boolean(resolvedContext && hasWhoop && hasOura);

  // ── Whoop strain as supplemental load context ──────────────────────────────
  const strainRes = resolvedContext?.strain || null;
  const strainValue = strainRes && strainRes.source === "whoop" ? num(strainRes.value) : null;
  let strainLevel = "none";
  if (strainValue !== null) {
    if (strainValue >= STRAIN_HIGH) strainLevel = "high";
    else if (strainValue >= STRAIN_ELEVATED) strainLevel = "elevated";
    else strainLevel = "normal";
  }
  const strainSignal = strainValue === null
    ? { present: false, level: "none", value: null, source: null, note: null }
    : {
        present: true,
        level: strainLevel,
        value: Math.round(strainValue * 10) / 10,
        source: "whoop",
        note:
          strainLevel === "high"
            ? `Whoop strain is high (${Math.round(strainValue * 10) / 10}) — extra training-load context only; not a reason to train harder.`
            : strainLevel === "elevated"
              ? `Whoop strain is elevated (${Math.round(strainValue * 10) / 10}) — supplemental load context.`
              : `Whoop strain ${Math.round(strainValue * 10) / 10} — within normal range.`,
      };

  // ── Fallback usage: a metric where the resolver had to fall back to Whoop ──
  const fallbacks = [];
  for (const metric of ["hrv", "rhr", "sleep"]) {
    const res = resolvedContext?.[metric];
    if (res && res.source === "whoop" && res.fallbackUsed) {
      fallbacks.push({
        metric,
        source: "whoop",
        label: METRIC_LABELS[metric] || metric,
        note: `${METRIC_LABELS[metric] || metric} uses Whoop as a fallback (Oura value missing) — treated as context, confidence lowered.`,
      });
    }
  }

  // ── Conflicts (echoed from the resolver, never recomputed) ─────────────────
  const conflicts = Array.isArray(resolvedContext?.conflicts) ? resolvedContext.conflicts : [];
  const conflictMetrics = conflicts.map((c) => c.metric);
  const hasMajorConflict = conflicts.some((c) => c?.severity === "major");
  const conflictSeverity = !conflicts.length ? "none" : hasMajorConflict ? "major" : "minor";
  const conflictAction = resolvedContext?.conflictAction?.action || (conflicts.length ? (hasMajorConflict ? "conservative" : "flag") : "use_primary");

  // ── Confidence adjustment (only ever downward) ─────────────────────────────
  // Conflicts and fallback usage both lower confidence. A major conflict lowers
  // it two steps; a minor conflict or a fallback lowers it one.
  const reasonParts = [];
  let steps = 0;
  if (conflicts.length) {
    steps = Math.max(steps, hasMajorConflict ? 2 : 1);
    reasonParts.push(
      `${hasMajorConflict ? "major" : "minor"} wearable disagreement on ${metricLabelList(conflictMetrics)}`
    );
  }
  if (fallbacks.length) {
    steps = Math.max(steps, 1);
    reasonParts.push(`Whoop fallback used for ${metricLabelList(fallbacks.map((f) => f.metric))}`);
  }
  const confidenceAdjustment = {
    direction: steps > 0 ? "down" : "none",
    steps,
    reason: reasonParts.length ? reasonParts.join("; ") : null,
  };

  // ── Conservative bias: major conflict OR high strain → lean cautious. High
  //    strain can only ever bias toward caution (never toward more training). ──
  const biasConservative = hasMajorConflict || strainLevel === "high";

  // ── Source labels for the supplemental metrics (display) ───────────────────
  const sourceLabels = {};
  for (const metric of ["hrv", "rhr", "sleep", "strain", "recovery"]) {
    const src = resolvedContext?.[metric]?.source || null;
    sourceLabels[metric] = { source: src, label: sourceLabel(src) };
  }

  const manualFirstClass = Boolean(resolvedContext?.subjective?.source === "manual");

  // ── User-facing conservative copy (single compact sentence) ────────────────
  let conservativeCopy;
  if (hasMajorConflict) {
    conservativeCopy = `Mixed signal day — Oura and Whoop disagree on ${metricLabelList(conflictMetrics)}. Using the more conservative read; your recovery score is unchanged.`;
  } else if (conflicts.length) {
    conservativeCopy = `Minor wearable disagreement on ${metricLabelList(conflictMetrics)} — flagged for awareness. Recovery score is unchanged.`;
  } else if (strainLevel === "high") {
    conservativeCopy = `${strainSignal.note} Recovery score is unchanged.`;
  } else if (fallbacks.length) {
    conservativeCopy = `Using Whoop as a fallback for ${metricLabelList(fallbacks.map((f) => f.metric))} because Oura is missing it — confidence lowered. Recovery score is unchanged.`;
  } else if (applicable) {
    conservativeCopy = "Oura and Whoop agree — recovery score is unchanged; Whoop adds strain and supplemental context only.";
  } else {
    conservativeCopy = null;
  }

  // ── Short structured notes for a disclosure list ───────────────────────────
  const notes = [];
  if (conflicts.length) {
    notes.push(
      hasMajorConflict
        ? `Wearables disagree materially on ${metricLabelList(conflictMetrics)} — leaning conservative.`
        : `Minor wearable disagreement on ${metricLabelList(conflictMetrics)} — flagged only.`
    );
  }
  if (strainSignal.present && strainLevel !== "normal") notes.push(strainSignal.note);
  fallbacks.forEach((f) => notes.push(f.note));
  if (manualFirstClass) notes.push("Manual check-in stays first-class and is never overridden.");

  return {
    applicable,
    recoveryScoreUnchanged: true,
    recoveryScore,
    recoverySource,
    strainSignal,
    fallbacks,
    conflicts,
    conflictMetrics,
    conflictSeverity,
    conflictAction,
    biasConservative,
    confidenceAdjustment,
    manualFirstClass,
    sourceLabels,
    conservativeCopy,
    notes,
    date: resolvedContext?.date || null,
  };
}

/**
 * Apply the blend's confidence + conservative bias to a training recommendation.
 * PURE: returns a new object; never mutates the input and never touches the
 * recovery score. It can only ever lower confidence and lean the recommendation
 * MORE conservative — it can never make training harder.
 *
 * @param {object} params
 * @param {object} params.recommendation - the recommendation to adjust.
 * @param {object} params.resolvedContext - resolver output (optional if blendContext given).
 * @param {object} params.blendContext - pre-built blend context (optional).
 * @returns {object|null} adjusted recommendation, or the input unchanged when
 *   there is nothing to adjust / no wearable blend applies.
 */
export function applyWearableConfidenceAdjustment({
  recommendation = null,
  resolvedContext = null,
  blendContext = null,
} = {}) {
  if (!recommendation || typeof recommendation !== "object") return recommendation ?? null;

  const blend =
    blendContext ||
    buildConservativeBlendContext({ resolvedContext, recommendation });

  // Oura-only path / nothing to blend → return the recommendation untouched
  // (a shallow clone so callers never accidentally share references).
  if (!blend || !blend.applicable) {
    return { ...recommendation };
  }

  const adjusted = { ...recommendation };
  const appliedNotes = [];
  let confidenceLowered = false;
  let biasedConservative = false;

  // Lower confidence only — never raise it.
  if (blend.confidenceAdjustment.direction === "down" && recommendation.confidence) {
    const lowered = downgradeConfidence(recommendation.confidence, blend.confidenceAdjustment.steps);
    if (lowered && lowered !== recommendation.confidence) {
      adjusted.confidence = lowered;
      confidenceLowered = true;
    }
    if (blend.confidenceAdjustment.reason) appliedNotes.push(`Confidence lowered: ${blend.confidenceAdjustment.reason}.`);
  }

  // Conservative bias — cap the readiness band toward caution. Major conflict /
  // high strain caps a "push" back to "moderate". This can only reduce, never
  // increase, the training call.
  if (blend.biasConservative && recommendation.readiness) {
    const capped = capReadiness(recommendation.readiness, "moderate");
    if (capped !== recommendation.readiness) {
      adjusted.readiness = capped;
      biasedConservative = true;
    }
    if (blend.conservativeCopy) appliedNotes.push(blend.conservativeCopy);
  }

  // Preserve the existing modifiers array shape used elsewhere, appending notes.
  const existingModifiers = Array.isArray(recommendation.modifiers) ? recommendation.modifiers : [];
  adjusted.modifiers = [...existingModifiers, ...appliedNotes.filter((n) => !existingModifiers.includes(n))];

  adjusted.wearableAdjustment = {
    applied: confidenceLowered || biasedConservative,
    confidenceLowered,
    biasedConservative,
    reason: blend.confidenceAdjustment.reason || (biasedConservative ? blend.conservativeCopy : null),
    conflictSeverity: blend.conflictSeverity,
    strainLevel: blend.strainSignal.level,
  };

  return adjusted;
}

/**
 * Build a user-facing explanation of the conservative blend for the Recovery UI.
 * Null-safe: returns { available: false } when the blend does not apply.
 *
 * @param {object} blendContext - output of buildConservativeBlendContext.
 * @returns {{available, title, headline, disclaimer, points: string[], conservativeCopy, sourceLine}}
 */
export function buildBlendExplanation(blendContext) {
  const disclaimer =
    "Your recovery score is unchanged. Whoop is used only for supplemental context, as a fallback when Oura is missing a value, and as a strain signal — Oura and Whoop scores are never averaged.";

  if (!blendContext || typeof blendContext !== "object" || !blendContext.applicable) {
    return {
      available: false,
      title: "Wearable intelligence",
      headline: null,
      disclaimer,
      points: [],
      conservativeCopy: null,
      sourceLine: null,
    };
  }

  const points = Array.isArray(blendContext.notes) ? [...blendContext.notes] : [];
  if (blendContext.confidenceAdjustment?.direction === "down" && blendContext.confidenceAdjustment.reason) {
    points.push(`Confidence lowered — ${blendContext.confidenceAdjustment.reason}.`);
  }

  // Compact per-metric source line (only the supplemental metrics that resolved).
  const sourceBits = [];
  for (const metric of ["hrv", "rhr", "sleep", "strain"]) {
    const entry = blendContext.sourceLabels?.[metric];
    if (entry && entry.label) sourceBits.push(`${METRIC_LABELS[metric] || metric} ${entry.label}`);
  }
  const sourceLine = sourceBits.length ? sourceBits.join(" · ") : null;

  const headline =
    blendContext.conflictSeverity === "major"
      ? "Mixed signal — conservative read"
      : blendContext.conflictSeverity === "minor"
        ? "Minor wearable disagreement"
        : blendContext.strainSignal?.level === "high"
          ? "High strain — extra load context"
          : blendContext.fallbacks?.length
            ? "Whoop fallback in use"
            : "Wearables aligned";

  return {
    available: true,
    title: "Wearable intelligence",
    headline,
    disclaimer,
    points: points.filter(Boolean),
    conservativeCopy: blendContext.conservativeCopy || null,
    sourceLine,
  };
}

export default {
  buildConservativeBlendContext,
  applyWearableConfidenceAdjustment,
  buildBlendExplanation,
};
