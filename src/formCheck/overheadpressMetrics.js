// Pure overhead-press (side-view) metric extraction from pose landmarks.
//
// Pure, side-effect free helpers (no DOM, no MediaPipe, no I/O). From body
// landmarks only we read: an elbow-bend proxy for depth/lockout
// (shoulder–elbow–wrist angle), a shoulder-elevation proxy (hip–shoulder–elbow
// angle), and forward/backward lean (shoulder–hip tilt from vertical). We do NOT
// attempt barbell detection — only body landmarks are used.

import { angleDeg, torsoLeanFromVertical } from "./squatMetrics";

export const OVERHEADPRESS_LANDMARKS = {
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
};

const JOINT_VISIBILITY_FLOOR = 0.5;
const FALLBACK_FRAME_STEP_MS = 167;

function visibility(p) {
  return p && Number.isFinite(p.visibility) ? p.visibility : 0;
}

function pickSide(landmarks) {
  const L = OVERHEADPRESS_LANDMARKS;
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
  };
}

// Extract per-frame metrics, or null if the arm joints aren't visible enough.
// `shoulderAngleDeg`/`forwardLeanDeg` need the hip and are null without it.
export function extractOverheadpressFrameMetrics(landmarks) {
  if (!Array.isArray(landmarks) || landmarks.length < 25) return null;
  const { shoulder, elbow, wrist, hip } = pickSide(landmarks);

  if (
    visibility(shoulder) < JOINT_VISIBILITY_FLOOR ||
    visibility(elbow) < JOINT_VISIBILITY_FLOOR ||
    visibility(wrist) < JOINT_VISIBILITY_FLOOR
  ) {
    return null;
  }

  const elbowAngleDeg = angleDeg(shoulder, elbow, wrist);
  if (elbowAngleDeg == null) return null;

  let shoulderAngleDeg = null;
  let forwardLeanDeg = null;
  if (visibility(hip) >= JOINT_VISIBILITY_FLOOR) {
    shoulderAngleDeg = angleDeg(hip, shoulder, elbow);
    forwardLeanDeg = torsoLeanFromVertical(shoulder, hip);
  }

  const used = [shoulder, elbow, wrist];
  const visSum = used.reduce((s, p) => s + visibility(p), 0);
  const avgVisibility = visSum / used.length;

  return { elbowAngleDeg, shoulderAngleDeg, forwardLeanDeg, wristX: wrist.x, wristY: wrist.y, avgVisibility };
}

export function buildOverheadpressSeries(frames = []) {
  const list = Array.isArray(frames) ? frames : [];
  const series = [];
  for (let i = 0; i < list.length; i += 1) {
    const frame = list[i];
    const landmarks = frame && frame.landmarks;
    if (!landmarks || landmarks.length === 0) continue;
    const m = extractOverheadpressFrameMetrics(landmarks);
    if (!m) continue;
    const tMs = frame && Number.isFinite(frame.tMs) ? frame.tMs : i * FALLBACK_FRAME_STEP_MS;
    series.push({ tMs, elbowAngleDeg: m.elbowAngleDeg });
  }
  return series;
}

// Aggregate sampled frames into summary metrics. The smallest elbow angle is the
// rack/bottom depth read; the largest is the overhead lockout proxy. The largest
// shoulder angle is the overhead-reach proxy, and the worst lean is reported.
export function aggregateOverheadpressMetrics(frames = []) {
  const list = Array.isArray(frames) ? frames : [];
  const framesAnalyzed = list.length;

  let framesWithLandmarks = 0;
  let visibilitySum = 0;
  let minElbowAngleDeg = null;
  let maxElbowAngleDeg = null;
  let shoulderAngleDeg = null; // largest (most overhead) reached
  let forwardLeanDeg = null; // worst (largest) lean seen

  for (const frame of list) {
    const landmarks = frame && frame.landmarks;
    if (!landmarks || landmarks.length === 0) continue;
    const m = extractOverheadpressFrameMetrics(landmarks);
    if (!m) continue;

    framesWithLandmarks += 1;
    visibilitySum += m.avgVisibility;

    if (minElbowAngleDeg == null || m.elbowAngleDeg < minElbowAngleDeg) {
      minElbowAngleDeg = m.elbowAngleDeg;
    }
    if (maxElbowAngleDeg == null || m.elbowAngleDeg > maxElbowAngleDeg) {
      maxElbowAngleDeg = m.elbowAngleDeg;
    }
    if (m.shoulderAngleDeg != null && (shoulderAngleDeg == null || m.shoulderAngleDeg > shoulderAngleDeg)) {
      shoulderAngleDeg = m.shoulderAngleDeg;
    }
    if (m.forwardLeanDeg != null && (forwardLeanDeg == null || m.forwardLeanDeg > forwardLeanDeg)) {
      forwardLeanDeg = m.forwardLeanDeg;
    }
  }

  const avgVisibility = framesWithLandmarks > 0 ? visibilitySum / framesWithLandmarks : 0;
  const elbowRangeDeg =
    minElbowAngleDeg != null && maxElbowAngleDeg != null ? maxElbowAngleDeg - minElbowAngleDeg : null;

  return {
    framesAnalyzed,
    framesWithLandmarks,
    avgVisibility,
    metrics: {
      minElbowAngleDeg,
      maxElbowAngleDeg,
      elbowRangeDeg,
      shoulderAngleDeg,
      forwardLeanDeg,
    },
  };
}

// V1.4: Extract wrist positions from all usable frames for full-trajectory
// bar-path tracking. Returns an array of { tMs, x, y } in normalized image
// coordinates. Only frames with visible arm joints are included.
export function extractOverheadpressWristPositions(frames = []) {
  const list = Array.isArray(frames) ? frames : [];
  const points = [];
  for (let i = 0; i < list.length; i += 1) {
    const frame = list[i];
    const landmarks = frame && frame.landmarks;
    if (!landmarks || landmarks.length === 0) continue;
    const m = extractOverheadpressFrameMetrics(landmarks);
    if (!m) continue;
    const tMs = frame && Number.isFinite(frame.tMs) ? frame.tMs : i * FALLBACK_FRAME_STEP_MS;
    points.push({ tMs, x: m.wristX, y: m.wristY });
  }
  return points;
}
