// Pure squat-metric extraction from pose landmarks.
//
// These helpers convert MediaPipe Pose landmarks (BlazePose, 33 points, each in
// normalized [0,1] image coordinates with a `visibility` score) into the coarse
// metrics that `analyzeSquat` understands. They are intentionally pure and
// side-effect free — no DOM, no MediaPipe, no I/O — so they are easy to unit
// test and reason about. The actual frame sampling lives in localVideoAnalyzer.

// BlazePose landmark indices we care about for a side-view squat.
export const POSE_LANDMARKS = {
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
};

// Minimum per-landmark visibility for a joint to be trusted in a single frame.
const JOINT_VISIBILITY_FLOOR = 0.5;

function isPoint(p) {
  return p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

// Interior angle (degrees) at vertex `b` formed by points a-b-c. Returns null
// for degenerate input (missing points or a zero-length limb segment).
export function angleDeg(a, b, c) {
  if (!isPoint(a) || !isPoint(b) || !isPoint(c)) return null;
  const v1x = a.x - b.x;
  const v1y = a.y - b.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const m1 = Math.hypot(v1x, v1y);
  const m2 = Math.hypot(v2x, v2y);
  if (m1 === 0 || m2 === 0) return null;
  let cos = (v1x * v2x + v1y * v2y) / (m1 * m2);
  // Guard against floating point drift outside [-1, 1].
  cos = Math.max(-1, Math.min(1, cos));
  return (Math.acos(cos) * 180) / Math.PI;
}

// Forward lean of the torso from vertical (degrees). 0 = perfectly upright.
// Image coordinates put y growing downward, so the torso vector runs from hip
// up to shoulder; we only care about its tilt magnitude from the vertical axis.
export function torsoLeanFromVertical(shoulder, hip) {
  if (!isPoint(shoulder) || !isPoint(hip)) return null;
  const dx = shoulder.x - hip.x;
  const dy = shoulder.y - hip.y;
  if (dx === 0 && dy === 0) return null;
  return (Math.atan2(Math.abs(dx), Math.abs(dy)) * 180) / Math.PI;
}

function visibility(p) {
  return p && Number.isFinite(p.visibility) ? p.visibility : 0;
}

// Pick the better-visible body side (left vs right) for a side-view clip. The
// camera typically sees one profile clearly; we score each side by the combined
// visibility of its hip/knee/ankle and use whichever is stronger.
function pickSide(landmarks) {
  const L = POSE_LANDMARKS;
  const leftScore =
    visibility(landmarks[L.LEFT_HIP]) +
    visibility(landmarks[L.LEFT_KNEE]) +
    visibility(landmarks[L.LEFT_ANKLE]);
  const rightScore =
    visibility(landmarks[L.RIGHT_HIP]) +
    visibility(landmarks[L.RIGHT_KNEE]) +
    visibility(landmarks[L.RIGHT_ANKLE]);
  if (rightScore > leftScore) {
    return {
      shoulder: landmarks[L.RIGHT_SHOULDER],
      hip: landmarks[L.RIGHT_HIP],
      knee: landmarks[L.RIGHT_KNEE],
      ankle: landmarks[L.RIGHT_ANKLE],
      score: rightScore,
    };
  }
  return {
    shoulder: landmarks[L.LEFT_SHOULDER],
    hip: landmarks[L.LEFT_HIP],
    knee: landmarks[L.LEFT_KNEE],
    ankle: landmarks[L.LEFT_ANKLE],
    score: leftScore,
  };
}

// Extract per-frame metrics from one frame's landmark array (33 points), or
// null if the lower body isn't visible enough to trust. `detected` callers can
// use a null return to count this frame as "no usable landmarks".
export function extractFrameMetrics(landmarks) {
  if (!Array.isArray(landmarks) || landmarks.length < 29) return null;
  const side = pickSide(landmarks);
  const { shoulder, hip, knee, ankle } = side;

  // Require the three lower-body joints to clear the visibility floor; the squat
  // depth read is meaningless without them.
  if (
    visibility(hip) < JOINT_VISIBILITY_FLOOR ||
    visibility(knee) < JOINT_VISIBILITY_FLOOR ||
    visibility(ankle) < JOINT_VISIBILITY_FLOOR
  ) {
    return null;
  }

  const kneeAngleDeg = angleDeg(hip, knee, ankle);
  if (kneeAngleDeg == null) return null;

  // V1.4: Hip angle (shoulder–hip–knee) — tracks hip hinge during squat.
  const hipAngleDeg = angleDeg(shoulder, hip, knee);

  const torsoLeanDeg = torsoLeanFromVertical(shoulder, hip);

  // V1.4: Knee-over-toe proxy — horizontal offset of knee vs ankle in normalized coords.
  const kneeOverToe = knee.x - ankle.x;

  // Average visibility across the joints we actually used.
  const used = [shoulder, hip, knee, ankle];
  const visSum = used.reduce((s, p) => s + visibility(p), 0);
  const avgVisibility = visSum / used.length;

  return { kneeAngleDeg, hipAngleDeg, torsoLeanDeg, kneeOverToe, avgVisibility };
}

// Fallback frame spacing (ms) used only when a sampled frame lacks a timestamp.
// Matches the ~6fps sampling cadence in localVideoAnalyzer so synthesized
// timelines stay roughly to scale.
const FALLBACK_FRAME_STEP_MS = 167;

// Build a per-frame knee-angle series — { tMs, kneeAngleDeg } — for the frames
// where the lower body is visible enough to trust. This is the conservative,
// derived input that rep segmentation consumes; it carries no landmarks, image
// data, or video, just two numbers per usable frame. Frames without usable
// landmarks are skipped (not zero-filled) so noise can't masquerade as motion.
export function buildKneeSeries(frames = []) {
  const list = Array.isArray(frames) ? frames : [];
  const series = [];
  for (let i = 0; i < list.length; i += 1) {
    const frame = list[i];
    const landmarks = frame && frame.landmarks;
    if (!landmarks || landmarks.length === 0) continue;

    const m = extractFrameMetrics(landmarks);
    if (!m) continue;

    const tMs =
      frame && Number.isFinite(frame.tMs) ? frame.tMs : i * FALLBACK_FRAME_STEP_MS;
    series.push({ tMs, kneeAngleDeg: m.kneeAngleDeg });
  }
  return series;
}

// Aggregate a sequence of sampled frames into the summary metrics + detection
// stats that `assessConfidence` and `analyzeSquat` consume.
//
// `frames` is an array of items shaped like:
//   { landmarks: NormalizedLandmark[] | null }
// where `landmarks` is null/empty when no pose was detected in that frame.
export function aggregateSquatMetrics(frames = []) {
  const list = Array.isArray(frames) ? frames : [];
  const framesAnalyzed = list.length;

  let framesWithLandmarks = 0;
  let visibilitySum = 0;
  let minKneeAngleDeg = null;
  // Torso lean at the deepest point (smallest knee angle) is the most relevant.
  let leanAtDeepest = null;
  // V1.4: Hip angle and knee-over-toe at deepest point.
  let hipAtDeepest = null;
  let kneeOverToeAtDeepest = null;

  for (const frame of list) {
    const landmarks = frame && frame.landmarks;
    if (!landmarks || landmarks.length === 0) continue;

    const m = extractFrameMetrics(landmarks);
    if (!m) continue;

    framesWithLandmarks += 1;
    visibilitySum += m.avgVisibility;

    if (minKneeAngleDeg == null || m.kneeAngleDeg < minKneeAngleDeg) {
      minKneeAngleDeg = m.kneeAngleDeg;
      leanAtDeepest = m.torsoLeanDeg;
      hipAtDeepest = m.hipAngleDeg;
      kneeOverToeAtDeepest = m.kneeOverToe;
    }
  }

  const avgVisibility = framesWithLandmarks > 0 ? visibilitySum / framesWithLandmarks : 0;

  return {
    framesAnalyzed,
    framesWithLandmarks,
    avgVisibility,
    metrics: {
      minKneeAngleDeg,
      torsoForwardLeanDeg: leanAtDeepest,
      hipAngleDeg: hipAtDeepest,
      kneeOverToe: kneeOverToeAtDeepest,
    },
  };
}
