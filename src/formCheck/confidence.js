// Confidence reasoning for Form Check pose analysis.
//
// Pure helper that turns raw pose-detection stats into a human-readable
// confidence level. Conservative by design: when we can't clearly see the
// athlete, we say so rather than guessing at form.

export const CONFIDENCE_THRESHOLDS = {
  // Fraction of analyzed frames that must contain a detected body.
  minDetectionRate: 0.6,
  goodDetectionRate: 0.85,
  // Mean landmark visibility (0–1) needed to trust positions.
  minVisibility: 0.5,
  goodVisibility: 0.7,
};

export function assessConfidence({ framesAnalyzed = 0, framesWithLandmarks = 0, avgVisibility = 0 } = {}) {
  const reasons = [];

  if (!framesAnalyzed || framesAnalyzed <= 0) {
    return {
      level: "low",
      detectionRate: 0,
      avgVisibility: 0,
      reasons: ["No frames could be read from the video."],
    };
  }

  const detectionRate = framesWithLandmarks / framesAnalyzed;
  const T = CONFIDENCE_THRESHOLDS;

  if (detectionRate < T.minDetectionRate) {
    reasons.push("Your body wasn't clearly detected in enough of the video.");
  }
  if (avgVisibility < T.minVisibility) {
    reasons.push("Key body points weren't clearly visible — try better lighting and a clear background.");
  }

  let level;
  if (reasons.length > 0) {
    level = "low";
  } else if (detectionRate >= T.goodDetectionRate && avgVisibility >= T.goodVisibility) {
    level = "high";
  } else {
    level = "medium";
  }

  return { level, detectionRate, avgVisibility, reasons };
}
