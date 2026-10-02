// Conservative push-up (side-view) form analysis.
//
// Pure function over already-computed body-landmark metrics. It returns hedged,
// educational cues about depth (elbow bend) and body-line consistency (hip
// sag/pike). It never issues clinical commands and refuses to render cues when
// confidence is low.

const DISCLAIMER =
  "Educational estimate only — not a clinical or medical assessment. Camera angle and body type affect results.";

// Elbow-angle (degrees) bands at the bottom of the rep. Smaller = deeper bend.
export const DEEP_ELBOW_ANGLE = 100; // at/below -> appears to reach a good range
export const NEAR_ELBOW_ANGLE = 120; // between -> partial

// Body-line deviation (degrees from a straight 180° plank) worth a gentle note.
export const BODY_LINE_WATCH_DEG = 15;

// Map the deepest elbow angle to a coarse depth label.
export function classifyPushupDepth(minElbowAngleDeg) {
  if (minElbowAngleDeg == null || !Number.isFinite(minElbowAngleDeg)) return "unknown";
  if (minElbowAngleDeg <= DEEP_ELBOW_ANGLE) return "deep";
  if (minElbowAngleDeg <= NEAR_ELBOW_ANGLE) return "near";
  return "shallow";
}

function lowConfidenceResult(confidence) {
  return {
    movement: "pushup",
    assessable: false,
    depthAssessment: "unknown",
    bodyLineAssessment: "unknown",
    cues: [],
    summary:
      "Not enough clear video to read your form. Retake from a side view in good lighting and try again.",
    confidence: confidence || { level: "low", reasons: [] },
    disclaimer: DISCLAIMER,
  };
}

export function analyzePushup(metrics = {}, options = {}) {
  const confidence = options.confidence;
  if (confidence && confidence.level === "low") {
    return lowConfidenceResult(confidence);
  }

  const { minElbowAngleDeg, bodyLineDevDeg } = metrics;
  const cues = [];

  const depthAssessment = classifyPushupDepth(minElbowAngleDeg);
  if (depthAssessment === "deep") {
    cues.push({
      id: "depth",
      severity: "info",
      text: "Depth appears to reach a good range — your elbows seem to bend well through the rep.",
    });
  } else if (depthAssessment === "near") {
    cues.push({
      id: "depth",
      severity: "watch",
      text: "Depth appears close. If your mobility allows, you may be able to bend the elbows a touch more.",
    });
  } else if (depthAssessment === "shallow") {
    cues.push({
      id: "depth",
      severity: "watch",
      text: "Depth appears shallow. Consider lowering a little further if it feels safe and your shoulders allow.",
    });
  }

  // Body-line / hip-sag proxy.
  let bodyLineAssessment = "unknown";
  if (Number.isFinite(bodyLineDevDeg)) {
    if (bodyLineDevDeg >= BODY_LINE_WATCH_DEG) {
      bodyLineAssessment = "watch";
      cues.push({
        id: "body-line",
        severity: "watch",
        text: "Your body line appears to bend at the hips (a slight sag or pike). Bracing your core may help keep a straighter line — this is only a rough estimate.",
      });
    } else {
      bodyLineAssessment = "steady";
    }
  }

  const summary =
    cues.length === 0
      ? "No obvious issues stood out, but this is only a rough estimate."
      : "A few things to look at below — all rough estimates, not strict rules.";

  return {
    movement: "pushup",
    assessable: true,
    depthAssessment,
    bodyLineAssessment,
    cues,
    summary,
    confidence: confidence || { level: "medium", reasons: [] },
    disclaimer: DISCLAIMER,
  };
}
