// Conservative overhead-press (side-view) form analysis.
//
// Pure function over already-computed body-landmark metrics. It returns hedged,
// educational cues about depth (elbow bend at the rack), lockout (overhead
// extension), and forward/backward lean. It never issues clinical commands,
// never claims barbell tracking, and refuses to render cues when confidence is
// low.

const DISCLAIMER =
  "Educational estimate from body landmarks only — not a clinical or medical assessment, and it does not track the bar. Camera angle and body type affect results.";

// Elbow-angle (degrees) bands at the rack/bottom. Smaller = deeper bend.
export const FULL_OHP_ELBOW_ANGLE = 100; // at/below -> appears to start from a full range
export const PARTIAL_OHP_ELBOW_ANGLE = 125; // between -> partial

// Lockout proxy: the straightest elbow reached overhead.
export const FULL_LOCKOUT_ELBOW_ANGLE = 160; // at/above -> appears to lock out overhead
export const PARTIAL_LOCKOUT_ELBOW_ANGLE = 150; // below -> appears incomplete

// Forward/backward lean (degrees from vertical) worth a gentle note.
export const FORWARD_LEAN_WATCH_DEG = 18;

export function classifyOverheadDepth(minElbowAngleDeg) {
  if (minElbowAngleDeg == null || !Number.isFinite(minElbowAngleDeg)) return "unknown";
  if (minElbowAngleDeg <= FULL_OHP_ELBOW_ANGLE) return "full-range";
  if (minElbowAngleDeg <= PARTIAL_OHP_ELBOW_ANGLE) return "partial-range";
  return "limited-range";
}

function lowConfidenceResult(confidence) {
  return {
    movement: "overheadpress",
    assessable: false,
    depthAssessment: "unknown",
    lockoutAssessment: "unknown",
    cues: [],
    summary:
      "Not enough clear video to read your form. Retake from a side view in good lighting and try again.",
    confidence: confidence || { level: "low", reasons: [] },
    disclaimer: DISCLAIMER,
  };
}

export function analyzeOverheadpress(metrics = {}, options = {}) {
  const confidence = options.confidence;
  if (confidence && confidence.level === "low") {
    return lowConfidenceResult(confidence);
  }

  const { minElbowAngleDeg, maxElbowAngleDeg, forwardLeanDeg } = metrics;
  const cues = [];

  const depthAssessment = classifyOverheadDepth(minElbowAngleDeg);
  if (depthAssessment === "full-range") {
    cues.push({
      id: "depth",
      severity: "info",
      text: "Starting depth appears full — your elbows seem to bend well at the bottom before pressing.",
    });
  } else if (depthAssessment === "partial-range") {
    cues.push({
      id: "depth",
      severity: "watch",
      text: "Starting depth appears close. If your mobility allows, you may be able to start from a slightly deeper bend.",
    });
  } else if (depthAssessment === "limited-range") {
    cues.push({
      id: "depth",
      severity: "watch",
      text: "Starting depth appears shallow. Consider starting from a slightly deeper bend if it feels safe and your shoulders allow.",
    });
  }

  // Lockout proxy from the straightest elbow reached overhead.
  let lockoutAssessment = "unknown";
  if (Number.isFinite(maxElbowAngleDeg)) {
    if (maxElbowAngleDeg >= FULL_LOCKOUT_ELBOW_ANGLE) {
      lockoutAssessment = "full";
      cues.push({
        id: "lockout",
        severity: "info",
        text: "Arms appear to reach overhead extension at the top.",
      });
    } else if (maxElbowAngleDeg < PARTIAL_LOCKOUT_ELBOW_ANGLE) {
      lockoutAssessment = "incomplete";
      cues.push({
        id: "lockout",
        severity: "watch",
        text: "Overhead lockout appears incomplete in this clip. If it feels safe, you may be able to press a little taller — though camera angle can also cause this.",
      });
    } else {
      lockoutAssessment = "moderate";
    }
  }

  // Forward/backward lean note.
  let leanAssessment = "unknown";
  if (Number.isFinite(forwardLeanDeg)) {
    if (forwardLeanDeg >= FORWARD_LEAN_WATCH_DEG) {
      leanAssessment = "watch";
      cues.push({
        id: "lean",
        severity: "watch",
        text: "Your torso appears to lean noticeably through the press. Bracing your core and glutes may help keep it more upright — this is only a rough estimate.",
      });
    } else {
      leanAssessment = "steady";
    }
  }

  const summary =
    cues.length === 0
      ? "No obvious issues stood out, but this is only a rough estimate."
      : "A few things to look at below — all rough estimates from body position, not strict rules.";

  return {
    movement: "overheadpress",
    assessable: true,
    depthAssessment,
    lockoutAssessment,
    leanAssessment,
    cues,
    summary,
    confidence: confidence || { level: "medium", reasons: [] },
    disclaimer: DISCLAIMER,
  };
}
