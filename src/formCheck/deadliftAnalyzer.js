// Conservative deadlift (side-view) form analysis.
//
// Pure function over already-computed body-landmark metrics. It returns hedged,
// educational cues about the hip hinge and lockout posture. It never issues
// clinical commands, never claims bar-path precision (we only see body
// landmarks), and refuses to render cues when confidence is low.

const DISCLAIMER =
  "Educational estimate from body landmarks only — not a clinical or medical assessment, and it does not track the bar. Camera angle and body type affect results.";

// Hip-angle (degrees) bands at the bottom of the hinge. Smaller = deeper hinge.
// Coarse on purpose; we only claim a rough hinge, never exact joint angles.
export const CLEAR_HINGE_HIP_ANGLE = 120; // at/below -> a clear hinge
export const PARTIAL_HINGE_HIP_ANGLE = 155; // between -> partial hinge

// Lockout proxy: the largest hip angle reached (closest to standing tall).
export const TALL_LOCKOUT_HIP_ANGLE = 160; // at/above -> appears tall
export const PARTIAL_LOCKOUT_HIP_ANGLE = 150; // below -> appears incomplete

// Map the deepest hip angle to a coarse hinge label.
export function classifyHinge(minHipAngleDeg) {
  if (minHipAngleDeg == null || !Number.isFinite(minHipAngleDeg)) return "unknown";
  if (minHipAngleDeg <= CLEAR_HINGE_HIP_ANGLE) return "clear-hinge";
  if (minHipAngleDeg <= PARTIAL_HINGE_HIP_ANGLE) return "partial-hinge";
  return "minimal-hinge";
}

function lowConfidenceResult(confidence) {
  return {
    movement: "deadlift",
    assessable: false,
    hingeAssessment: "unknown",
    lockoutAssessment: "unknown",
    depthAssessment: "unknown",
    cues: [],
    summary:
      "Not enough clear video to read your form. Retake from a side view in good lighting and try again.",
    confidence: confidence || { level: "low", reasons: [] },
    disclaimer: DISCLAIMER,
  };
}

export function analyzeDeadlift(metrics = {}, options = {}) {
  const confidence = options.confidence;
  if (confidence && confidence.level === "low") {
    return lowConfidenceResult(confidence);
  }

  const { minHipAngleDeg, maxHipAngleDeg } = metrics;
  const cues = [];

  const hingeAssessment = classifyHinge(minHipAngleDeg);
  if (hingeAssessment === "clear-hinge") {
    cues.push({
      id: "hinge",
      severity: "info",
      text: "A clear hip hinge appears present — your torso pivots over the hips as expected.",
    });
  } else if (hingeAssessment === "partial-hinge") {
    cues.push({
      id: "hinge",
      severity: "watch",
      text: "The hip hinge appears partial. If your mobility allows, you may be able to hinge a touch more before the lift.",
    });
  } else if (hingeAssessment === "minimal-hinge") {
    cues.push({
      id: "hinge",
      severity: "watch",
      text: "Couldn't clearly see a hip hinge in this clip. Make sure your full side profile is in frame so the movement is easier to read.",
    });
  }

  // Lockout proxy from the tallest hip angle reached.
  let lockoutAssessment = "unknown";
  if (Number.isFinite(maxHipAngleDeg)) {
    if (maxHipAngleDeg >= TALL_LOCKOUT_HIP_ANGLE) {
      lockoutAssessment = "tall";
      cues.push({
        id: "lockout",
        severity: "info",
        text: "Lockout appears tall — you seem to finish standing roughly upright.",
      });
    } else if (maxHipAngleDeg < PARTIAL_LOCKOUT_HIP_ANGLE) {
      lockoutAssessment = "incomplete";
      cues.push({
        id: "lockout",
        severity: "watch",
        text: "Lockout appears incomplete in this clip. If it feels safe, you may be able to finish a little taller — though camera angle can also cause this.",
      });
    } else {
      lockoutAssessment = "moderate";
    }
  }

  const summary =
    cues.length === 0
      ? "No obvious issues stood out, but this is only a rough estimate."
      : "A few things to look at below — all rough estimates from body position, not strict rules.";

  return {
    movement: "deadlift",
    assessable: true,
    hingeAssessment,
    lockoutAssessment,
    // Mirror the hinge label into depthAssessment so the shared history/UI
    // (which keys off depthAssessment) has a movement-appropriate label.
    depthAssessment: hingeAssessment,
    cues,
    summary,
    confidence: confidence || { level: "medium", reasons: [] },
    disclaimer: DISCLAIMER,
  };
}
