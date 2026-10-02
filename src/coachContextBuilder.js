// src/coachContextBuilder.js
// ─────────────────────────────────────────────────────────────────────────────
// V3.1 Unified Coach Context Builder
//
// Produces a compact recovery summary for LLM coach injection that spans BOTH
// wearables when they are connected. When only Oura is connected this delegates
// to the existing Oura-only builder unchanged, so nothing about the single-source
// path shifts. When Whoop is also connected it layers on the Whoop-specific
// signals (strain, respiratory rate) plus a "mixed signal" flag and a source
// disclosure, all through the pure wearableSourceResolver (no averaging, no
// re-scoring, no network).
//
// Output is capped at ~300 chars so it stays safe to inject into a prompt.
// ─────────────────────────────────────────────────────────────────────────────

import { buildOuraCoachContext } from "./oura/coachContext";
import { resolveRecoveryContext } from "./recovery/wearableSourceResolver";
import { buildConservativeBlendContext, buildBlendExplanation } from "./recovery/conservativeBlending";
import { buildWearableSourceNote } from "./recoverySummary";
import { buildCoachMemoryContext } from "./coachMemory";

const MAX_LEN = 300;
// The wearable summary is capped at MAX_LEN; the optional coach-memory suffix is
// itself capped (~240) inside buildCoachMemoryContext, so the combined string
// stays prompt-safe. Memory is appended only when the athlete has opted in.
const COMBINED_MAX = MAX_LEN + 260;

// V4.5 — append the opt-in, suggest-only coach memory (coaching preferences) to
// whatever the wearable builder produced. When preferences are disabled/absent
// this is a no-op, so the coach behaves exactly as before. Trend is intentionally
// omitted here (this builder has no entries) — preferences alone are enough to
// personalize tone/focus without touching any score or program.
function withCoachMemory(base, settings) {
  let memory;
  try {
    memory = buildCoachMemoryContext({ preferences: settings?.coachPreferences });
  } catch {
    memory = null;
  }
  if (!memory) return base || null;
  let out = base ? `${base}. ${memory}` : memory;
  if (out.length > COMBINED_MAX) out = `${out.slice(0, COMBINED_MAX - 1).trimEnd()}…`;
  return out;
}

function round(v, dp = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function whoopConnectedFrom(whoopData) {
  return Boolean(whoopData && typeof whoopData === "object" && Object.keys(whoopData).length);
}

/**
 * Build a unified coach context string from every available source.
 * @param {{ouraData, whoopData, manualData, settings}} params
 * @returns {string|null} ~200-300 char summary, or null when nothing to say.
 */
export function buildCoachContext({ ouraData, whoopData, manualData, settings = {} } = {}) {
  // No Whoop → behave exactly like the legacy Oura-only builder (plus opt-in memory).
  if (!whoopConnectedFrom(whoopData)) {
    return withCoachMemory(buildOuraCoachContext(ouraData, settings), settings);
  }

  try {
    const ctx = resolveRecoveryContext({ ouraData, whoopData, manualData, settings });
    const parts = [];

    // Base Oura recovery summary keeps the canonical recovery score/wording.
    const base = buildOuraCoachContext(ouraData, settings);
    if (base) parts.push(base);

    // Whoop-specific signals that Oura does not provide as well.
    const strain = ctx.strain;
    if (strain && strain.source === "whoop" && Number.isFinite(strain.value)) {
      parts.push(`Whoop strain ${round(strain.value, 1)}`);
    }
    const resp = ctx.respiratoryRate;
    if (resp && resp.source === "whoop" && Number.isFinite(resp.value)) {
      parts.push(`Resp rate ${round(resp.value, 1)}/min (Whoop)`);
    }

    // Conflict + conservative blend flag — the single most important cross-source signal for a coach.
    const conflicts = Array.isArray(ctx.conflicts) ? ctx.conflicts : [];
    if (conflicts.length) {
      const metrics = conflicts.map((c) => c.metric).join(", ");
      parts.push(`Mixed signal day — Oura/Whoop disagree on ${metrics}; lean conservative`);
    }

    const blend = buildConservativeBlendContext({ resolvedContext: ctx });
    const blendExplanation = buildBlendExplanation(blend);
    if (blendExplanation?.conservativeCopy) {
      parts.push(blendExplanation.conservativeCopy);
    } else if (blend?.confidenceAdjustment?.direction === "down" && blend.confidenceAdjustment.reason) {
      parts.push(`Confidence lowered: ${blend.confidenceAdjustment.reason}`);
    }

    // V3.6 — aggregated confidence floor from the aggregation model
    if (blend?.confidenceAdjustment?.direction === "down") {
      const steps = blend.confidenceAdjustment.steps || 1;
      const confWord = steps >= 2 ? "low" : "medium";
      parts.push(`Aggregated confidence: ${confWord}`);
    }

    // Compact source disclosure so the coach can attribute each reading.
    const note = buildWearableSourceNote(ctx);
    if (note) parts.push(`Sources: ${note}`);

    let out = parts.filter(Boolean).join(". ");
    if (!out) return withCoachMemory(base, settings);
    if (out.length > MAX_LEN) out = `${out.slice(0, MAX_LEN - 1).trimEnd()}…`;
    return withCoachMemory(out, settings);
  } catch {
    // Any resolver hiccup falls back to the proven Oura-only behavior.
    return withCoachMemory(buildOuraCoachContext(ouraData, settings), settings);
  }
}

// Backward compatibility: keep the Oura-only builder importable from here too.
export { buildOuraCoachContext };

export default { buildCoachContext, buildOuraCoachContext };
