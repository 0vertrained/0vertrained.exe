// Conservative bench-press (side-view) form analysis.
//
// Pure function over already-computed body-landmark metrics. It returns hedged,
// educational cues about press depth (elbow bend), lockout (extension), and a
// coarse wrist-path proxy. It never issues clinical commands, never claims
// barbell or precise bar-path tracking (we only see body landmarks), and refuses
// to render cues when confidence is low.

const DISCLAIMER =
  "Educational estimate from body landmarks only — not a clinical or medical assessment, and it does not track the bar. The wrist-path read is a rough proxy; camera angle and body type affect results.";

// Elbow-angle (degrees) bands at the bottom of the press. Smaller = deeper bend.
export const FULL_BENCH_ELBOW_ANGLE = 100; // at/below -> appears to reach a full range
export const PARTIAL_BENCH_ELBOW_ANGLE = 125; // between -> partial

// Lockout proxy: the largest elbow angle reached (closest to straight arms).
export const FULL_LOCKOUT_ELBOW_ANGLE = 160; // at/above -> appears to lock out
export const PARTIAL_LOCKOUT_ELBOW_ANGLE = 150; // below -> appears incomplete

// Coarse wrist-path / shoulder-shift deviations (degrees) worth a gentle note.
export const WRIST_PATH_WATCH_DEG = 20;
export const SHOULDER_SHIFT_WATCH_DEG = 20;

// Map the deepest elbow angle to a coarse depth label.
export function classifyBenchDepth(minElbowAngleDeg) {
  if (minElbowAngleDeg == null || !Number.isFinite(minElbowAngleDeg)) return "unknown";
  if (minElbowAngleDeg <= FULL_BENCH_ELBOW_ANGLE) return "full-range";
  if (minElbowAngleDeg <= PARTIAL_BENCH_ELBOW_ANGLE) return "partial-range";
  return "limited-range";
}

function lowConfidenceResult(confidence) {
  return {
    movement: "benchpress",
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

export function analyzeBenchpress(metrics = {}, options = {}) {
  const confidence = options.confidence;
  if (confidence && confidence.level === "low") {
    return lowConfidenceResult(confidence);
  }

  const { minElbowAngleDeg, maxElbowAngleDeg, wristPathDevDeg, shoulderShiftDeg } = metrics;
  const cues = [];

  const depthAssessment = classifyBenchDepth(minElbowAngleDeg);
  if (depthAssessment === "full-range") {
    cues.push({
      id: "depth",
      severity: "info",
      text: "Depth appears to reach a full range — your elbows seem to bend roughly to a right angle at the bottom.",
    });
  } else if (depthAssessment === "partial-range") {
    cues.push({
      id: "depth",
      severity: "watch",
      text: "Depth appears close. If your shoulders allow, you may be able to bring the bar a touch lower toward the chest.",
    });
  } else if (depthAssessment === "limited-range") {
    cues.push({
      id: "depth",
      severity: "watch",
      text: "Depth appears shallow. Consider lowering a little further if it feels safe and your shoulders allow.",
    });
  }

  // Lockout proxy from the straightest elbow reached.
  let lockoutAssessment = "unknown";
  if (Number.isFinite(maxElbowAngleDeg)) {
    if (maxElbowAngleDeg >= FULL_LOCKOUT_ELBOW_ANGLE) {
      lockoutAssessment = "full";
      cues.push({
        id: "lockout",
        severity: "info",
        text: "Arms appear to reach full extension at the top.",
      });
    } else if (maxElbowAngleDeg < PARTIAL_LOCKOUT_ELBOW_ANGLE) {
      lockoutAssessment = "incomplete";
      cues.push({
        id: "lockout",
        severity: "watch",
        text: "Lockout appears incomplete in this clip. If it feels safe, you may be able to press a little taller — though camera angle can also cause this.",
      });
    } else {
      lockoutAssessment = "moderate";
    }
  }

  // Wrist-path proxy (rough stand-in for bar path — we do not track the bar).
  let wristPathAssessment = "unknown";
  if (Number.isFinite(wristPathDevDeg)) {
    if (wristPathDevDeg >= WRIST_PATH_WATCH_DEG) {
      wristPathAssessment = "watch";
      cues.push({
        id: "wrist-path",
        severity: "watch",
        text: "Your wrist path appears to drift rather than tracking straight up and down. This is only a rough proxy for bar path and is sensitive to camera angle.",
      });
    } else {
      wristPathAssessment = "steady";
    }
  }

  // Shoulder-stability note from how much the shoulder–hip line shifts.
  if (Number.isFinite(shoulderShiftDeg) && shoulderShiftDeg >= SHOULDER_SHIFT_WATCH_DEG) {
    cues.push({
      id: "shoulder",
      severity: "watch",
      text: "Your shoulders appear to shift through the set. Keeping them set on the bench may help — this is only a rough estimate.",
    });
  }

  const summary =
    cues.length === 0
      ? "No obvious issues stood out, but this is only a rough estimate."
      : "A few things to look at below — all rough estimates from body position, not strict rules.";

  return {
    movement: "benchpress",
    assessable: true,
    depthAssessment,
    lockoutAssessment,
    wristPathAssessment,
    cues,
    summary,
    confidence: confidence || { level: "medium", reasons: [] },
    disclaimer: DISCLAIMER,
  };
}
