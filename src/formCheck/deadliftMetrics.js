// Pure deadlift (side-view) metric extraction from pose landmarks.
//
// Like squatMetrics, these helpers turn MediaPipe Pose landmarks into coarse,
// body-only metrics. They are pure and side-effect free — no DOM, no MediaPipe,
// no I/O. We measure the hip hinge from the shoulder–hip–knee angle and the
// torso lean from vertical. We deliberately do NOT attempt bar-path or barbell
// detection: only body landmarks are used.

import { POSE_LANDMARKS, angleDeg, torsoLeanFromVertical } from "./squatMetrics";

// Minimum per-landmark visibility for a joint to be trusted in a single frame.
const JOINT_VISIBILITY_FLOOR = 0.5;

// Fallback frame spacing (ms) used only when a sampled frame lacks a timestamp.
const FALLBACK_FRAME_STEP_MS = 167;

function visibility(p) {
  return p && Number.isFinite(p.visibility) ? p.visibility : 0;
}

// Pick the better-visible body side for a side-view clip, scored by the combined
// visibility of the shoulder/hip/knee used for the hip-hinge read.
function pickSide(landmarks) {
  const L = POSE_LANDMARKS;
  const leftScore =
    visibility(landmarks[L.LEFT_SHOULDER]) +
    visibility(landmarks[L.LEFT_HIP]) +
    visibility(landmarks[L.LEFT_KNEE]);
  const rightScore =
    visibility(landmarks[L.RIGHT_SHOULDER]) +
    visibility(landmarks[L.RIGHT_HIP]) +
    visibility(landmarks[L.RIGHT_KNEE]);
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

// Extract per-frame metrics from one frame's landmark array, or null if the
// hinge joints aren't visible enough to trust.
export function extractDeadliftFrameMetrics(landmarks) {
  if (!Array.isArray(landmarks) || landmarks.length < 29) return null;
  const { shoulder, hip, knee, ankle } = pickSide(landmarks);

  if (
    visibility(shoulder) < JOINT_VISIBILITY_FLOOR ||
    visibility(hip) < JOINT_VISIBILITY_FLOOR ||
    visibility(knee) < JOINT_VISIBILITY_FLOOR
  ) {
    return null;
  }

  // Hip hinge: interior angle at the hip between the torso and the thigh.
  // ~180° standing tall, sharpening toward the bottom of a hinge.
  const hipAngleDeg = angleDeg(shoulder, hip, knee);
  if (hipAngleDeg == null) return null;

  // V1.4: Knee angle (hip–knee–ankle) — should stay relatively constant in a
  // stiff-leg/RDL pattern; large changes suggest knee bend during the pull.
  const kneeAngleDeg = angleDeg(hip, knee, ankle);

  const torsoLeanDeg = torsoLeanFromVertical(shoulder, hip);

  const used = [shoulder, hip, knee];
  const visSum = used.reduce((s, p) => s + visibility(p), 0);
  const avgVisibility = visSum / used.length;

  return { hipAngleDeg, kneeAngleDeg, torsoLeanDeg, avgVisibility };
}

// Per-frame hip-angle series — { tMs, hipAngleDeg } — for rep segmentation.
// Carries only two numbers per usable frame; no landmarks/images/video.
export function buildHipSeries(frames = []) {
  const list = Array.isArray(frames) ? frames : [];
  const series = [];
  for (let i = 0; i < list.length; i += 1) {
    const frame = list[i];
    const landmarks = frame && frame.landmarks;
    if (!landmarks || landmarks.length === 0) continue;
    const m = extractDeadliftFrameMetrics(landmarks);
    if (!m) continue;
    const tMs = frame && Number.isFinite(frame.tMs) ? frame.tMs : i * FALLBACK_FRAME_STEP_MS;
    series.push({ tMs, hipAngleDeg: m.hipAngleDeg });
  }
  return series;
}

// Aggregate sampled frames into summary metrics + detection stats. The deepest
// hinge (smallest hip angle) drives the "bottom" read; the largest hip angle is
// the lockout proxy.
export function aggregateDeadliftMetrics(frames = []) {
  const list = Array.isArray(frames) ? frames : [];
  const framesAnalyzed = list.length;

  let framesWithLandmarks = 0;
  let visibilitySum = 0;
  let minHipAngleDeg = null;
  let maxHipAngleDeg = null;
  let torsoLeanAtBottomDeg = null;
  // V1.4: Knee angle at the deepest hinge point.
  let kneeAtBottomDeg = null;

  for (const frame of list) {
    const landmarks = frame && frame.landmarks;
    if (!landmarks || landmarks.length === 0) continue;
    const m = extractDeadliftFrameMetrics(landmarks);
    if (!m) continue;

    framesWithLandmarks += 1;
    visibilitySum += m.avgVisibility;

    if (minHipAngleDeg == null || m.hipAngleDeg < minHipAngleDeg) {
      minHipAngleDeg = m.hipAngleDeg;
      torsoLeanAtBottomDeg = m.torsoLeanDeg;
      kneeAtBottomDeg = m.kneeAngleDeg;
    }
    if (maxHipAngleDeg == null || m.hipAngleDeg > maxHipAngleDeg) {
      maxHipAngleDeg = m.hipAngleDeg;
    }
  }

  const avgVisibility = framesWithLandmarks > 0 ? visibilitySum / framesWithLandmarks : 0;
  const hipRangeDeg =
    minHipAngleDeg != null && maxHipAngleDeg != null ? maxHipAngleDeg - minHipAngleDeg : null;

  return {
    framesAnalyzed,
    framesWithLandmarks,
    avgVisibility,
    metrics: {
      minHipAngleDeg,
      maxHipAngleDeg,
      hipRangeDeg,
      torsoLeanAtBottomDeg,
      kneeAngleDeg: kneeAtBottomDeg,
    },
  };
}
