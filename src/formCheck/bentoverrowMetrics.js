// Pure bent-over-row (side-view) metric extraction from pose landmarks.
//
// Pure, side-effect free helpers (no DOM, no MediaPipe, no I/O). From body
// landmarks only we read: an elbow-bend proxy for pull range
// (shoulder–elbow–wrist angle — arms straight when extended, bent when pulled
// in) and the torso tilt from vertical as a hinge-stability proxy. We do NOT
// attempt barbell detection — only body landmarks are used.

import { angleDeg, torsoLeanFromVertical } from "./squatMetrics";

export const BENTOVERROW_LANDMARKS = {
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
  const L = BENTOVERROW_LANDMARKS;
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
// `torsoLeanDeg` (shoulder–hip tilt from vertical) needs the hip and is null
// without it, but a usable elbow angle still yields metrics.
export function extractBentoverrowFrameMetrics(landmarks) {
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

  let torsoLeanDeg = null;
  if (visibility(hip) >= JOINT_VISIBILITY_FLOOR) {
    torsoLeanDeg = torsoLeanFromVertical(shoulder, hip);
  }

  const used = [shoulder, elbow, wrist];
  const visSum = used.reduce((s, p) => s + visibility(p), 0);
  const avgVisibility = visSum / used.length;

  return { elbowAngleDeg, torsoLeanDeg, avgVisibility };
}

export function buildBentoverrowSeries(frames = []) {
  const list = Array.isArray(frames) ? frames : [];
  const series = [];
  for (let i = 0; i < list.length; i += 1) {
    const frame = list[i];
    const landmarks = frame && frame.landmarks;
    if (!landmarks || landmarks.length === 0) continue;
    const m = extractBentoverrowFrameMetrics(landmarks);
    if (!m) continue;
    const tMs = frame && Number.isFinite(frame.tMs) ? frame.tMs : i * FALLBACK_FRAME_STEP_MS;
    series.push({ tMs, elbowAngleDeg: m.elbowAngleDeg });
  }
  return series;
}

// Aggregate sampled frames into summary metrics. The smallest elbow angle is the
// pull-range read (how far the elbows bend at the top of the pull); the largest
// is the extended/bottom proxy. `torsoLeanDeg` here is the *spread* of torso
// tilt across the set — a coarse hinge-stability proxy (small = stable hinge,
// large = the torso shifts between reps).
export function aggregateBentoverrowMetrics(frames = []) {
  const list = Array.isArray(frames) ? frames : [];
  const framesAnalyzed = list.length;

  let framesWithLandmarks = 0;
  let visibilitySum = 0;
  let minElbowAngleDeg = null;
  let maxElbowAngleDeg = null;
  let minLean = null;
  let maxLean = null;

  for (const frame of list) {
    const landmarks = frame && frame.landmarks;
    if (!landmarks || landmarks.length === 0) continue;
    const m = extractBentoverrowFrameMetrics(landmarks);
    if (!m) continue;

    framesWithLandmarks += 1;
    visibilitySum += m.avgVisibility;

    if (minElbowAngleDeg == null || m.elbowAngleDeg < minElbowAngleDeg) {
      minElbowAngleDeg = m.elbowAngleDeg;
    }
    if (maxElbowAngleDeg == null || m.elbowAngleDeg > maxElbowAngleDeg) {
      maxElbowAngleDeg = m.elbowAngleDeg;
    }
    if (m.torsoLeanDeg != null) {
      if (minLean == null || m.torsoLeanDeg < minLean) minLean = m.torsoLeanDeg;
      if (maxLean == null || m.torsoLeanDeg > maxLean) maxLean = m.torsoLeanDeg;
    }
  }

  const avgVisibility = framesWithLandmarks > 0 ? visibilitySum / framesWithLandmarks : 0;
  const elbowRangeDeg =
    minElbowAngleDeg != null && maxElbowAngleDeg != null ? maxElbowAngleDeg - minElbowAngleDeg : null;
  const torsoLeanDeg = minLean != null && maxLean != null ? maxLean - minLean : null;

  return {
    framesAnalyzed,
    framesWithLandmarks,
    avgVisibility,
    metrics: {
      minElbowAngleDeg,
      maxElbowAngleDeg,
      elbowRangeDeg,
      torsoLeanDeg,
    },
  };
}
