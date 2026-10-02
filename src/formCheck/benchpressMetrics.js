// Pure bench-press (side-view) metric extraction from pose landmarks.
//
// Pure, side-effect free helpers (no DOM, no MediaPipe, no I/O). From body
// landmarks only we read: an elbow-bend proxy for press depth/lockout
// (shoulder–elbow–wrist angle) and a coarse wrist-path proxy as a stand-in for
// bar path. We deliberately do NOT attempt barbell detection — only body
// landmarks are used, so the wrist-path read is rough and camera-dependent.

import { angleDeg, torsoLeanFromVertical } from "./squatMetrics";

// BlazePose indices we care about for a side-view bench press.
export const BENCHPRESS_LANDMARKS = {
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

// Pick the better-visible side, scored by the arm joints that drive the depth
// read (shoulder/elbow/wrist).
function pickSide(landmarks) {
  const L = BENCHPRESS_LANDMARKS;
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
// `torsoLeanDeg` (shoulder–hip tilt) is a coarse shoulder-stability proxy and is
// null when the hip isn't visible; a usable elbow angle still yields metrics.
export function extractBenchpressFrameMetrics(landmarks) {
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

  // V1.4: Elbow flare proxy — horizontal offset of elbow vs shoulder at bottom.
  // Larger positive = elbow is further forward than shoulder (more flare).
  const elbowFlare = elbow.x - shoulder.x;

  let torsoLeanDeg = null;
  if (visibility(hip) >= JOINT_VISIBILITY_FLOOR) {
    torsoLeanDeg = torsoLeanFromVertical(shoulder, hip);
  }

  const used = [shoulder, elbow, wrist];
  const visSum = used.reduce((s, p) => s + visibility(p), 0);
  const avgVisibility = visSum / used.length;

  return { elbowAngleDeg, elbowFlare, torsoLeanDeg, wristX: wrist.x, wristY: wrist.y, avgVisibility };
}

// Per-frame elbow-angle series — { tMs, elbowAngleDeg } — for rep segmentation.
// Carries only two numbers per usable frame; no landmarks/images/video.
export function buildBenchpressSeries(frames = []) {
  const list = Array.isArray(frames) ? frames : [];
  const series = [];
  for (let i = 0; i < list.length; i += 1) {
    const frame = list[i];
    const landmarks = frame && frame.landmarks;
    if (!landmarks || landmarks.length === 0) continue;
    const m = extractBenchpressFrameMetrics(landmarks);
    if (!m) continue;
    const tMs = frame && Number.isFinite(frame.tMs) ? frame.tMs : i * FALLBACK_FRAME_STEP_MS;
    series.push({ tMs, elbowAngleDeg: m.elbowAngleDeg });
  }
  return series;
}

// Coarse angle (degrees) of a 2D travel vector away from vertical. 0 = perfectly
// straight up/down, growing toward horizontal. Null for a degenerate (near-zero)
// travel. Image y grows downward, but we only use magnitudes here.
function deviationFromVertical(dx, dy) {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  if (Math.hypot(dx, dy) < 1e-6) return null;
  return (Math.atan2(Math.abs(dx), Math.abs(dy)) * 180) / Math.PI;
}

// Aggregate sampled frames into summary metrics. The smallest elbow angle is the
// chest/bottom depth read; the largest is the lockout proxy. The wrist positions
// at the bottom (min elbow) and top (max elbow) give a coarse bar-path proxy:
// how far the wrist drifts from a straight vertical line between them.
export function aggregateBenchpressMetrics(frames = []) {
  const list = Array.isArray(frames) ? frames : [];
  const framesAnalyzed = list.length;

  let framesWithLandmarks = 0;
  let visibilitySum = 0;
  let minElbowAngleDeg = null;
  let maxElbowAngleDeg = null;
  let wristAtBottom = null;
  let wristAtTop = null;
  let minLean = null;
  let maxLean = null;

  for (const frame of list) {
    const landmarks = frame && frame.landmarks;
    if (!landmarks || landmarks.length === 0) continue;
    const m = extractBenchpressFrameMetrics(landmarks);
    if (!m) continue;

    framesWithLandmarks += 1;
    visibilitySum += m.avgVisibility;

    if (minElbowAngleDeg == null || m.elbowAngleDeg < minElbowAngleDeg) {
      minElbowAngleDeg = m.elbowAngleDeg;
      wristAtBottom = { x: m.wristX, y: m.wristY };
    }
    if (maxElbowAngleDeg == null || m.elbowAngleDeg > maxElbowAngleDeg) {
      maxElbowAngleDeg = m.elbowAngleDeg;
      wristAtTop = { x: m.wristX, y: m.wristY };
    }
    if (m.torsoLeanDeg != null) {
      if (minLean == null || m.torsoLeanDeg < minLean) minLean = m.torsoLeanDeg;
      if (maxLean == null || m.torsoLeanDeg > maxLean) maxLean = m.torsoLeanDeg;
    }
  }

  const avgVisibility = framesWithLandmarks > 0 ? visibilitySum / framesWithLandmarks : 0;
  const elbowRangeDeg =
    minElbowAngleDeg != null && maxElbowAngleDeg != null ? maxElbowAngleDeg - minElbowAngleDeg : null;

  let wristPathDevDeg = null;
  if (wristAtBottom && wristAtTop) {
    wristPathDevDeg = deviationFromVertical(
      wristAtTop.x - wristAtBottom.x,
      wristAtTop.y - wristAtBottom.y,
    );
  }

  const shoulderShiftDeg = minLean != null && maxLean != null ? maxLean - minLean : null;

  return {
    framesAnalyzed,
    framesWithLandmarks,
    avgVisibility,
    metrics: {
      minElbowAngleDeg,
      maxElbowAngleDeg,
      elbowRangeDeg,
      wristPathDevDeg,
      shoulderShiftDeg,
    },
  };
}

// V1.4: Extract wrist positions from all usable frames for full-trajectory
// bar-path tracking. Returns an array of { tMs, x, y } in normalized image
// coordinates. Only frames with visible arm joints are included.
export function extractBenchpressWristPositions(frames = []) {
  const list = Array.isArray(frames) ? frames : [];
  const points = [];
  for (let i = 0; i < list.length; i += 1) {
    const frame = list[i];
    const landmarks = frame && frame.landmarks;
    if (!landmarks || landmarks.length === 0) continue;
    const m = extractBenchpressFrameMetrics(landmarks);
    if (!m) continue;
    const tMs = frame && Number.isFinite(frame.tMs) ? frame.tMs : i * FALLBACK_FRAME_STEP_MS;
    points.push({ tMs, x: m.wristX, y: m.wristY });
  }
  return points;
}
