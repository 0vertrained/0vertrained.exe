// src/oura/coachContext.js
// ─────────────────────────────────────────────────────────────────────────────
// Oura Coach Context Builder
//
// Builds compact Oura recovery summaries for LLM coach injection.
// ─────────────────────────────────────────────────────────────────────────────

import { calcRecoveryScore, calcHRVScore, calcRHRScore } from "./algorithms";
import { calcOuraDataQuality, getTrainingRecommendation } from "./insights";

/**
 * Build a compact Oura recovery summary for the Coach prompt.
 * Returns null if Oura is not connected or no data is available.
 * Output is ~150-200 chars, safe for injection into LLM context.
 */
export function buildOuraCoachContext(ouraData, settings = {}) {
  if (!ouraData || !Object.keys(ouraData).length) return null;

  try {
    const rec = calcRecoveryScore(ouraData, settings);
    const hrv = calcHRVScore(ouraData, settings);
    const rhr = calcRHRScore(ouraData);
    const q = calcOuraDataQuality(ouraData, 7);

    const parts = [];
    parts.push(`Recovery: ${rec.score}/100 (${rec.band.replace(/_/g, " ")})`);

    const hrvZ = parseFloat(hrv.zScore);
    if (Number.isFinite(hrvZ)) {
      const hrvLabel = hrvZ >= 0.5 ? "above baseline" : hrvZ <= -0.5 ? "below baseline" : "at baseline";
      parts.push(`HRV ${hrvLabel} (z=${hrvZ.toFixed(1)})`);
    }

    const rhrDelta = parseFloat(rhr.delta);
    if (Number.isFinite(rhrDelta)) {
      const rhrLabel = rhrDelta <= -1 ? "low" : rhrDelta >= 3 ? "elevated" : "stable";
      parts.push(`RHR ${rhrLabel} (${rhrDelta > 0 ? "+" : ""}${rhrDelta.toFixed(0)} bpm vs baseline)`);
    }

    if (rec.subscores) {
      parts.push(`Sleep: ${rec.subscores.sleep}/25, Temp: ${rec.subscores.temp}/15`);
    }

    if (q?.fallbackMode) {
      parts.push("(partial data — some values use Oura readiness fallback)");
    }

    const reco = getTrainingRecommendation({ recovery: rec, readiness: null, quality: q });
    if (reco?.label) {
      parts.push(`Recommendation: ${reco.label}`);
    }

    return parts.join(". ");
  } catch {
    return null;
  }
}
