// src/adaptiveTraining.js
// Suggest-only workout adjustment rules. Pure module: no React, no network, no writes.

const READINESS = new Set(["push", "normal", "moderate", "pull_back", "rest"]);

function lower(value) {
  return String(value || "").toLowerCase();
}

function hasIntervals(program) {
  const text = [program?.type, program?.code, program?.cardio?.type, program?.cardio?.effort, program?.cardio?.notes].map(lower).join(" ");
  return /interval|speed|tempo|threshold|station|hyrox|high/.test(text);
}

function hasRun(program) {
  return !!program?.cardio || /run|hyrox|tempo|interval/.test(lower(program?.type));
}

function isLegBiased(program) {
  const text = [program?.type, program?.code, ...(program?.lifting || []).map(ex => ex?.name)].map(lower).join(" ");
  return /leg|squat|deadlift|lunge|calf|sled|wall ball|hamstring|quad|romanian/.test(text);
}

function hasLifting(program) {
  return Array.isArray(program?.lifting) && program.lifting.length > 0;
}

function loadRatioFromRecommendation(recommendation) {
  const loadReason = (recommendation?.reasons || []).find(r => r.source === "load" && typeof r.value === "number");
  return typeof loadReason?.value === "number" ? loadReason.value : null;
}

function baseSuggestion(mode, title, rationale, changes = [], safetyNotes = []) {
  return { mode, title, rationale, changes, safetyNotes };
}

export function suggestWorkoutAdjustments({ recommendation, todayProgram, recentEntries, settings } = {}) {
  const readiness = READINESS.has(recommendation?.readiness) ? recommendation.readiness : "normal";
  const acwr = loadRatioFromRecommendation(recommendation);
  const intervalDay = hasIntervals(todayProgram);
  const runDay = hasRun(todayProgram);
  const legDay = isLegBiased(todayProgram);
  const liftDay = hasLifting(todayProgram);

  if (!todayProgram) {
    return baseSuggestion(
      "keep",
      "No programmed workout found",
      "There is not enough program context to suggest a specific adjustment.",
      [{ type: "general", label: "Use the daily recommendation as the primary guide.", impact: "low confidence" }],
      []
    );
  }

  if (readiness === "rest") {
    return baseSuggestion(
      "rest",
      "Replace training with recovery",
      "Low readiness plus load stress makes extra intensity a poor trade today.",
      [
        { type: "session", label: "Skip hard training today", impact: "stress ↓" },
        { type: "recovery", label: "Use mobility, walking, or easy Zone 1 only", impact: "recovery ↑" },
      ],
      ["Do not chase missed volume tomorrow; resume when markers rebound."]
    );
  }

  if (readiness === "pull_back") {
    const changes = [];
    if (intervalDay) changes.push({ type: "cardio", label: "Swap intervals/tempo for Zone 2", impact: "intensity ↓" });
    if (liftDay) changes.push({ type: "sets", label: "Remove 1 set from each accessory lift", impact: "volume -25–40%" });
    if (legDay) changes.push({ type: "lower_body", label: "Keep lower-body work submaximal", impact: "tissue stress ↓" });
    changes.push({ type: "rpe", label: "Cap all work around RPE 6–7", impact: "fatigue ↓" });
    return baseSuggestion(
      intervalDay ? "swap_cardio" : "reduce_volume",
      "Pull back today's session",
      "The recommendation is conservative enough to reduce stress without abandoning the habit.",
      changes,
      ["No max-effort sets, finishers, or extra miles today."]
    );
  }

  if (readiness === "moderate") {
    const changes = [];
    if (intervalDay && (acwr === null || acwr > 1.25)) changes.push({ type: "cardio", label: "Make the run conversational or shorten the hard block", impact: "load controlled" });
    if (liftDay) changes.push({ type: "sets", label: "Keep main work; trim optional accessories if warm-ups feel heavy", impact: "volume -10–20%" });
    changes.push({ type: "rpe", label: "Cap top sets around RPE 7", impact: "intensity controlled" });
    return baseSuggestion(
      intervalDay && acwr !== null && acwr > 1.25 ? "swap_cardio" : "reduce_intensity",
      "Moderate the plan",
      "Training is still reasonable, but the upside of extra intensity is limited today.",
      changes,
      []
    );
  }

  if (readiness === "push") {
    return baseSuggestion(
      "keep",
      "Keep the plan — quality window",
      "Recovery and load are aligned well enough for the planned quality work.",
      [
        { type: "session", label: "Run the session as written", impact: "plan maintained" },
        { type: "guardrail", label: "Only push if warm-ups confirm the signal", impact: "risk managed" },
      ],
      ["A good day is not a license to add junk volume."]
    );
  }

  if (runDay && acwr !== null && acwr > 1.3) {
    return baseSuggestion(
      "swap_cardio",
      "Protect the run load",
      "Training load is elevated, so keep the aerobic habit without adding sharp intensity.",
      [{ type: "cardio", label: "Use Zone 2 instead of hard running", impact: "injury risk ↓" }],
      []
    );
  }

  return baseSuggestion(
    "keep",
    "Keep original plan",
    "No major adjustment is needed from the current readiness signal.",
    [{ type: "session", label: "Run the programmed workout", impact: "plan maintained" }],
    []
  );
}

export default { suggestWorkoutAdjustments };
