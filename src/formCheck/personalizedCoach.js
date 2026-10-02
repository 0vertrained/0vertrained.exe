// V1.8 — Personalized Coach Layer (frontend-only, pure).
//
// Combines already-derived app context (recovery read, block emphasis, training
// goal) with derived Form Check history (recurring focus, best recent score) to
// produce a short, conservative coaching context. It is intentionally cautious:
// NO diagnosis, NO medical claims, NO prescriptions. Every output is a hedged
// framing nudge ("treat as technique practice", "keep the same camera angle").
//
// This module reads nothing and writes nothing — callers pass in plain derived
// values so it stays deterministic and unit-testable.

// Normalize a recovery signal into "low" | "moderate" | "high" | null.
// Accepts either a recovery-score color ("good"|"warn"|"low") or an explicit
// level string.
export function normalizeRecoveryLevel(input) {
  if (typeof input !== "string" || !input.trim()) return null;
  const v = input.trim().toLowerCase();
  if (v === "good" || v === "high" || v === "ready") return "high";
  if (v === "warn" || v === "moderate" || v === "medium") return "moderate";
  if (v === "low" || v === "poor" || v === "rest") return "low";
  return null;
}

// Build a derived, render-ready personalized coaching context.
//
// Inputs (all optional):
//   recovery         — recovery-score color/level string (see normalizeRecoveryLevel)
//   strengthEmphasis — truthy if the current block emphasizes strength
//   goal             — block goal string ("strength" | "hypertrophy" | "endurance" | …)
//   recurringFocus   — { label, count } from findRecurringFocus, or null
//   bestRecentScore  — number or null
//   movementLabel    — human movement label for phrasing (e.g. "Squat")
//
// Returns { available, headline, notes[], cameraTip, emphasis }.
export function buildPersonalizedCoachContext({
  recovery = null,
  strengthEmphasis = false,
  goal = null,
  recurringFocus = null,
  bestRecentScore = null,
  movementLabel = null,
} = {}) {
  const recoveryLevel = normalizeRecoveryLevel(recovery);
  const goalKey = typeof goal === "string" ? goal.trim().toLowerCase() : null;
  const notes = [];
  let emphasis = null;
  let cameraTip = null;

  // Recovery framing — avoid max-effort language when recovery is low.
  if (recoveryLevel === "low") {
    notes.push("Recovery looks low right now — use this check as technique practice rather than a max-effort test.");
    emphasis = "technique";
  } else if (recoveryLevel === "high") {
    notes.push("Recovery looks solid — a good day to groove clean, confident reps.");
  }

  // Training emphasis framing.
  if (strengthEmphasis || goalKey === "strength" || goalKey === "power") {
    notes.push("Your block emphasizes strength — prioritize consistent depth and bracing over chasing extra load.");
    if (!emphasis) emphasis = "consistency";
  } else if (goalKey === "hypertrophy") {
    notes.push("With a hypertrophy focus, favor controlled tempo and full range over speed.");
    if (!emphasis) emphasis = "range";
  } else if (goalKey === "endurance") {
    notes.push("With an endurance focus, keep form steady as reps add up rather than pushing intensity.");
    if (!emphasis) emphasis = "steadiness";
  }

  // Recurring form focus → keep the camera consistent so trends stay comparable.
  if (recurringFocus && recurringFocus.label && (recurringFocus.count || 0) >= 2) {
    cameraTip = `“${recurringFocus.label}” keeps coming up — film your next ${movementLabel || "check"} from the same angle so that trend stays comparable.`;
  }

  // Light positive reinforcement when a strong recent check exists.
  if (Number.isFinite(bestRecentScore) && bestRecentScore >= 85) {
    notes.push(`Your best recent ${movementLabel || "check"} scored ${bestRecentScore} — aim to repeat that setup.`);
  }

  const available = notes.length > 0 || Boolean(cameraTip);
  let headline = null;
  if (available) {
    if (emphasis === "technique") headline = "Today: technique focus";
    else if (emphasis === "consistency") headline = "Today: consistency focus";
    else headline = "Personalized note";
  }

  return {
    available,
    headline,
    notes: notes.slice(0, 3),
    cameraTip,
    emphasis,
  };
}
