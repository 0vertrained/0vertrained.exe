// Full-trajectory bar-path tracking from body landmarks only (Form Check V1.4).
//
// Pure, side-effect free helper. It takes a sequence of per-frame wrist (or any
// tracked-joint) positions — { tMs, x, y } in normalized [0,1] image coordinates
// — and summarizes how straight the path is across the WHOLE clip, not just two
// snapshots. This is a deliberately coarse stand-in for bar path: we never detect
// a barbell (off-the-shelf object detectors can't reliably identify one) and we
// only ever see body landmarks, so the read is rough and camera-angle sensitive.
//
// Nothing here is persisted or transmitted — it consumes derived numbers and
// returns derived numbers. No DOM, no MediaPipe, no I/O.

// We have no real-world scale (the camera distance/zoom is unknown), so distances
// are computed in normalized image units and scaled by this nominal factor purely
// so the reported "Mm" figures are human-readable. They are a relative proxy, not
// a calibrated measurement — treat them comparatively, not absolutely.
export const NOMINAL_MM_PER_UNIT = 1000;

// A path whose worst perpendicular deviation stays under this fraction of its own
// length reads as "straight". Coarse on purpose.
export const STRAIGHT_DEVIATION_RATIO = 0.08;

// When a path deviates to BOTH sides and the smaller excursion is at least this
// fraction of the larger one, we call it "inconsistent" rather than a clean
// one-directional drift.
const INCONSISTENT_SYMMETRY_RATIO = 0.5;

function isFinitePoint(p) {
  return p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

function unknownResult(pathPoints = []) {
  return {
    pathPoints,
    straightness: null,
    maxDeviationMm: null,
    deviationPattern: "unknown",
    pathLengthMm: null,
    directDistanceMm: null,
  };
}

// Summarize a wrist/bar trajectory. `points` is an array of { tMs, x, y }; only
// finite points are used. Returns a conservative shape (see unknownResult) when
// there isn't enough usable signal.
export function trackBarPath(points) {
  const list = Array.isArray(points) ? points : [];
  const pathPoints = list
    .filter(isFinitePoint)
    .map((p) => ({ tMs: Number.isFinite(p.tMs) ? p.tMs : null, x: p.x, y: p.y }));

  if (pathPoints.length < 2) return unknownResult(pathPoints);

  const first = pathPoints[0];
  const last = pathPoints[pathPoints.length - 1];
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const directDistance = Math.hypot(dx, dy);

  // Total path length = sum of consecutive segment lengths.
  let pathLength = 0;
  for (let i = 1; i < pathPoints.length; i += 1) {
    pathLength += Math.hypot(pathPoints[i].x - pathPoints[i - 1].x, pathPoints[i].y - pathPoints[i - 1].y);
  }

  // Degenerate: the joint never really moved. We can't read a path from noise.
  if (pathLength < 1e-6) return unknownResult(pathPoints);

  // Perpendicular distance of each point from the straight start→end line, and a
  // signed lateral excursion (relative to a linear x-interpolation along the
  // path) used to classify drift direction. +x is treated as "forward".
  let maxPerpDev = 0;
  let maxForward = 0; // largest +x excursion
  let maxBackward = 0; // largest -x excursion (stored as a positive magnitude)
  const n = pathPoints.length;
  const lineLen = directDistance > 1e-9 ? directDistance : 1;

  for (let i = 0; i < n; i += 1) {
    const p = pathPoints[i];
    // Perpendicular distance from the line through (first → last).
    const perp = Math.abs((p.x - first.x) * dy - (p.y - first.y) * dx) / lineLen;
    if (perp > maxPerpDev) maxPerpDev = perp;

    // Lateral x excursion vs the straight-line x at this fraction of the path.
    const frac = n > 1 ? i / (n - 1) : 0;
    const lineX = first.x + dx * frac;
    const lateral = p.x - lineX;
    if (lateral > maxForward) maxForward = lateral;
    if (-lateral > maxBackward) maxBackward = -lateral;
  }

  const ratio = maxPerpDev / pathLength;
  const straightness = clamp01(1 - ratio);

  let deviationPattern;
  if (ratio < STRAIGHT_DEVIATION_RATIO) {
    deviationPattern = "straight";
  } else {
    const bigger = Math.max(maxForward, maxBackward);
    const smaller = Math.min(maxForward, maxBackward);
    if (bigger > 0 && smaller >= INCONSISTENT_SYMMETRY_RATIO * bigger) {
      deviationPattern = "inconsistent";
    } else if (maxForward >= maxBackward) {
      deviationPattern = "forward-drift";
    } else {
      deviationPattern = "backward-drift";
    }
  }

  return {
    pathPoints,
    straightness,
    maxDeviationMm: maxPerpDev * NOMINAL_MM_PER_UNIT,
    deviationPattern,
    pathLengthMm: pathLength * NOMINAL_MM_PER_UNIT,
    directDistanceMm: directDistance * NOMINAL_MM_PER_UNIT,
  };
}
