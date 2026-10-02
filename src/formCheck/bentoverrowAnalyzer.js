// Conservative bent-over-row (side-view) form analysis.
//
// Pure function over already-computed body-landmark metrics. It returns hedged,
// educational cues about pull range (how far the elbows bend) and hinge
// stability (how much the torso shifts). It never issues clinical commands,
// never claims barbell tracking, and refuses to render cues when confidence is
// low.

const DISCLAIMER =
  "Educational estimate from body landmarks only — not a clinical or medical assessment, and it does not track the bar. Camera angle and body type affect results.";

// Elbow-angle (degrees) bands at the top of the pull. Smaller = a bigger pull.
export const FULL_ROW_ELBOW_ANGLE = 90; // at/below -> appears to pull back well
export const PARTIAL_ROW_ELBOW_ANGLE = 120; // between -> partial pull

// Torso-tilt spread (degrees) across the set worth a gentle hinge note.
export const HINGE_DRIFT_WATCH_DEG = 12;

export function classifyRowPull(minElbowAngleDeg) {
  if (minElbowAngleDeg == null || !Number.isFinite(minElbowAngleDeg)) return "unknown";
  if (minElbowAngleDeg <= FULL_ROW_ELBOW_ANGLE) return "full-range";
  if (minElbowAngleDeg <= PARTIAL_ROW_ELBOW_ANGLE) return "partial-range";
  return "limited-range";
}

export function classifyRowHinge(torsoLeanDeg) {
  if (torsoLeanDeg == null || !Number.isFinite(torsoLeanDeg)) return "unknown";
  return torsoLeanDeg <= HINGE_DRIFT_WATCH_DEG ? "stable-hinge" : "drifting-hinge";
}

function lowConfidenceResult(confidence) {
  return {
    movement: "bentoverrow",
    assessable: false,
    depthAssessment: "unknown",
    hingeAssessment: "unknown",
    cues: [],
    summary:
      "Not enough clear video to read your form. Retake from a side view in good lighting and try again.",
    confidence: confidence || { level: "low", reasons: [] },
    disclaimer: DISCLAIMER,
  };
}

export function analyzeBentoverrow(metrics = {}, options = {}) {
  const confidence = options.confidence;
  if (confidence && confidence.level === "low") {
    return lowConfidenceResult(confidence);
  }

  const { minElbowAngleDeg, torsoLeanDeg } = metrics;
  const cues = [];

  const depthAssessment = classifyRowPull(minElbowAngleDeg);
  if (depthAssessment === "full-range") {
    cues.push({
      id: "pull",
      severity: "info",
      text: "Pull range appears good — your elbows seem to pull back well toward the body.",
    });
  } else if (depthAssessment === "partial-range") {
    cues.push({
      id: "pull",
      severity: "watch",
      text: "Pull range appears close. If your mobility allows, you may be able to pull the elbows back a touch further.",
    });
  } else if (depthAssessment === "limited-range") {
    cues.push({
      id: "pull",
      severity: "watch",
      text: "Pull range appears limited. Consider pulling the elbows back a little further if it feels safe and controlled.",
    });
  }

  // Hinge-stability proxy from how much the torso tilt shifts across the set.
  const hingeAssessment = classifyRowHinge(torsoLeanDeg);
  if (hingeAssessment === "stable-hinge") {
    cues.push({
      id: "hinge",
      severity: "info",
      text: "Your hip hinge appears stable through the set — your torso angle seems to hold roughly steady.",
    });
  } else if (hingeAssessment === "drifting-hinge") {
    cues.push({
      id: "hinge",
      severity: "watch",
      text: "Your torso angle appears to shift between reps. Bracing your core to hold the hinge may help — this is only a rough estimate.",
    });
  }

  const summary =
    cues.length === 0
      ? "No obvious issues stood out, but this is only a rough estimate."
      : "A few things to look at below — all rough estimates from body position, not strict rules.";

  return {
    movement: "bentoverrow",
    assessable: true,
    depthAssessment,
    hingeAssessment,
    cues,
    summary,
    confidence: confidence || { level: "medium", reasons: [] },
    disclaimer: DISCLAIMER,
  };
}
