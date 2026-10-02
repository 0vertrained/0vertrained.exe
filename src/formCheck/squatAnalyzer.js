// Conservative squat (side-view) form analysis.
//
// Pure function: takes already-computed metrics and returns hedged, educational
// cues. It never issues clinical or absolute commands, and it refuses to render
// cues when confidence is low. Joint-angle thresholds are deliberately coarse.

const DISCLAIMER =
  "Educational estimate only — not a clinical or medical assessment. Camera angle and body type affect results.";

// Knee-angle bands (degrees at the bottom of the rep). Smaller angle = deeper.
// Coarse on purpose; we only claim rough depth, never exact joint angles.
export const PARALLEL_KNEE_ANGLE = 100; // at/below ~parallel
export const SHALLOW_KNEE_ANGLE = 120; // clearly above parallel

// Forward torso lean (degrees from vertical) that's worth a gentle note.
const TORSO_LEAN_WATCH = 55;

// Map a bottom-of-rep knee angle to a coarse depth label. Shared by the
// per-clip summary (analyzeSquat) and the per-rep timeline (repSegmentation) so
// both speak the same conservative language.
export function classifyDepth(minKneeAngleDeg) {
  if (minKneeAngleDeg == null || !Number.isFinite(minKneeAngleDeg)) return "unknown";
  if (minKneeAngleDeg <= PARALLEL_KNEE_ANGLE) return "at-or-below-parallel";
  if (minKneeAngleDeg <= SHALLOW_KNEE_ANGLE) return "near-parallel";
  return "above-parallel";
}

function lowConfidenceResult(confidence) {
  return {
    movement: "squat",
    assessable: false,
    depthAssessment: "unknown",
    cues: [],
    summary:
      "Not enough clear video to read your form. Retake from a side view in good lighting and try again.",
    confidence: confidence || { level: "low", reasons: [] },
    disclaimer: DISCLAIMER,
  };
}

export function analyzeSquat(metrics = {}, options = {}) {
  const confidence = options.confidence;
  if (confidence && confidence.level === "low") {
    return lowConfidenceResult(confidence);
  }

  const { minKneeAngleDeg, torsoForwardLeanDeg } = metrics;
  const cues = [];

  const depthAssessment = classifyDepth(minKneeAngleDeg);
  if (depthAssessment === "at-or-below-parallel") {
    cues.push({
      id: "depth",
      severity: "info",
      text: "Depth appears to reach roughly parallel or below — nice work.",
    });
  } else if (depthAssessment === "near-parallel") {
    cues.push({
      id: "depth",
      severity: "watch",
      text: "Depth appears close to parallel. If your mobility allows, you may be able to sink a touch lower.",
    });
  } else if (depthAssessment === "above-parallel") {
    cues.push({
      id: "depth",
      severity: "watch",
      text: "Depth appears above parallel. Consider a little more depth if it feels safe and your mobility allows.",
    });
  }

  if (
    torsoForwardLeanDeg != null &&
    Number.isFinite(torsoForwardLeanDeg) &&
    torsoForwardLeanDeg >= TORSO_LEAN_WATCH
  ) {
    cues.push({
      id: "torso",
      severity: "watch",
      text: "Your torso appears to lean forward a fair amount. Some lean is normal — if it feels excessive, you might focus on bracing your core.",
    });
  }

  const summary =
    cues.length === 0
      ? "No obvious issues stood out, but this is only a rough estimate."
      : "A few things to look at below — all rough estimates, not strict rules.";

  return {
    movement: "squat",
    assessable: true,
    depthAssessment,
    cues,
    summary,
    confidence: confidence || { level: "medium", reasons: [] },
    disclaimer: DISCLAIMER,
  };
}
