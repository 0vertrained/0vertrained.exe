// Pure push-up (side-view) metric extraction from pose landmarks.
//
// Pure, side-effect free helpers (no DOM, no MediaPipe, no I/O). We read two
// coarse, body-only signals: an elbow-bend proxy for depth (shoulder–elbow–wrist
// angle) and a body-line proxy for hip sag/pike (deviation of the
// shoulder–hip–ankle angle from a straight 180° line).

import { angleDeg } from "./squatMetrics";

// BlazePose indices we care about for a side-view push-up.
export const PUSHUP_LANDMARKS = {
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
};

const JOINT_VISIBILITY_FLOOR = 0.5;
const FALLBACK_FRAME_STEP_MS = 167;

function visibility(p) {
  return p && Number.isFinite(p.visibility) ? p.visibility : 0;
}

// Pick the better-visible side, scored by the arm joints that drive the depth
// read (shoulder/elbow/wrist).
function pickSide(landmarks) {
  const L = PUSHUP_LANDMARKS;
  const leftScore =
    visibility(landmarks[L.LEFT_SHOULDER]) +
    visibility(landmarks[L.LEFT_ELBOW]) +
    visibility(landmarks[L.LEFT_WRIST]);
  const rightScore =
    visibility(landmarks[L.RIGHT_SHOULDER]) +
    visibility(landmarks[L.RIGHT_ELBOW]) +
    visibility(landmarks[L.RIGHT_WRIST]);
  const side = rightScore > leftScore ? "RIGHT" : "LEFT";
  return {
    shoulder: landmarks[L[`${side}_SHOULDER`]],
    elbow: landmarks[L[`${side}_ELBOW`]],
    wrist: landmarks[L[`${side}_WRIST`]],
    hip: landmarks[L[`${side}_HIP`]],
    ankle: landmarks[L[`${side}_ANKLE`]],
  };
}

// Extract per-frame metrics, or null if the arm joints aren't visible enough.
// `bodyLineDevDeg` is null when the hip/ankle aren't visible enough to read the
// body line, but a usable elbow angle still yields metrics.
export function extractPushupFrameMetrics(landmarks) {
  if (!Array.isArray(landmarks) || landmarks.length < 29) return null;
  const { shoulder, elbow, wrist, hip, ankle } = pickSide(landmarks);

  if (
    visibility(shoulder) < JOINT_VISIBILITY_FLOOR ||
    visibility(elbow) < JOINT_VISIBILITY_FLOOR ||
    visibility(wrist) < JOINT_VISIBILITY_FLOOR
  ) {
    return null;
  }

  const elbowAngleDeg = angleDeg(shoulder, elbow, wrist);
  if (elbowAngleDeg == null) return null;

  // Body line: shoulder–hip–ankle. A perfectly straight plank is ~180°; the
  // deviation from straight grows as the hips sag or pike.
  let bodyLineDevDeg = null;
  if (visibility(hip) >= JOINT_VISIBILITY_FLOOR && visibility(ankle) >= JOINT_VISIBILITY_FLOOR) {
    const bodyLineDeg = angleDeg(shoulder, hip, ankle);
    if (bodyLineDeg != null) bodyLineDevDeg = Math.abs(180 - bodyLineDeg);
  }

  const used = [shoulder, elbow, wrist];
  const visSum = used.reduce((s, p) => s + visibility(p), 0);
  const avgVisibility = visSum / used.length;

  return { elbowAngleDeg, bodyLineDevDeg, avgVisibility };
}

// Per-frame elbow-angle series — { tMs, elbowAngleDeg } — for rep segmentation.
export function buildElbowSeries(frames = []) {
  const list = Array.isArray(frames) ? frames : [];
  const series = [];
  for (let i = 0; i < list.length; i += 1) {
    const frame = list[i];
    const landmarks = frame && frame.landmarks;
    if (!landmarks || landmarks.length === 0) continue;
    const m = extractPushupFrameMetrics(landmarks);
    if (!m) continue;
    const tMs = frame && Number.isFinite(frame.tMs) ? frame.tMs : i * FALLBACK_FRAME_STEP_MS;
    series.push({ tMs, elbowAngleDeg: m.elbowAngleDeg });
  }
  return series;
}

// Aggregate sampled frames into summary metrics. The bottom (smallest elbow
// angle) drives the depth read; the worst body-line deviation flags sag/pike.
export function aggregatePushupMetrics(frames = []) {
  const list = Array.isArray(frames) ? frames : [];
  const framesAnalyzed = list.length;

  let framesWithLandmarks = 0;
  let visibilitySum = 0;
  let minElbowAngleDeg = null;
  let bodyLineDevDeg = null; // worst (largest) deviation seen
  let bodyLineDevAtBottomDeg = null;

  for (const frame of list) {
    const landmarks = frame && frame.landmarks;
    if (!landmarks || landmarks.length === 0) continue;
    const m = extractPushupFrameMetrics(landmarks);
    if (!m) continue;

    framesWithLandmarks += 1;
    visibilitySum += m.avgVisibility;

    if (minElbowAngleDeg == null || m.elbowAngleDeg < minElbowAngleDeg) {
      minElbowAngleDeg = m.elbowAngleDeg;
      if (m.bodyLineDevDeg != null) bodyLineDevAtBottomDeg = m.bodyLineDevDeg;
    }
    if (m.bodyLineDevDeg != null && (bodyLineDevDeg == null || m.bodyLineDevDeg > bodyLineDevDeg)) {
      bodyLineDevDeg = m.bodyLineDevDeg;
    }
  }

  const avgVisibility = framesWithLandmarks > 0 ? visibilitySum / framesWithLandmarks : 0;

  return {
    framesAnalyzed,
    framesWithLandmarks,
    avgVisibility,
    metrics: {
      minElbowAngleDeg,
      bodyLineDevDeg,
      bodyLineDevAtBottomDeg,
    },
  };
}
