// Coarse rep segmentation for side-view clips.
//
// Pure, side-effect free. Input is a sampled per-frame angle series (built from
// Server-derived pose frames — no video, no raw landmarks, no I/O reaches this module).
// Output is a conservative rep timeline.
//
// The core engine (`segmentAngleReps`) is movement-agnostic: every supported
// movement bottoms out at a *smaller* joint angle (knee for squats, hip for
// deadlift hinges, elbow for push-ups), so the same descend/ascend detection
// works for all three. Thin wrappers supply the value accessor, a depth/
// assessment classifier, and a "looks shallow" predicate.
//
// Philosophy mirrors the rest of Form Check: when we can't clearly see a rep we
// say so (return no reps with a reason) rather than fabricating a timeline.

import { classifyDepth, SHALLOW_KNEE_ANGLE } from "./squatAnalyzer";
import { classifyHinge, PARTIAL_HINGE_HIP_ANGLE } from "./deadliftAnalyzer";
import { classifyPushupDepth, NEAR_ELBOW_ANGLE } from "./pushupAnalyzer";
import { classifyBenchDepth, PARTIAL_BENCH_ELBOW_ANGLE } from "./benchpressAnalyzer";
import { classifyOverheadDepth, PARTIAL_OHP_ELBOW_ANGLE } from "./overheadpressAnalyzer";
import { classifyRowPull, PARTIAL_ROW_ELBOW_ANGLE } from "./bentoverrowAnalyzer";

const DEFAULTS = {
  // Need a few usable samples before any timeline is meaningful.
  minSamples: 6,
  // Total angle travel (deg) required to believe a real rep happened. Below this
  // it's almost certainly noise / standing still.
  minRangeDeg: 25,
  // Light smoothing window (centered moving average) to tame single-frame jitter.
  smoothWindow: 3,
  // Hysteresis bands, expressed as a fraction of the clip's own angle range.
  downFrac: 0.6,
  upFrac: 0.25,
  // A rep faster than this is worth a gentle "controlled tempo" flag.
  fastTempoSec: 0.7,
};

function round1(n) {
  return Math.round(n * 10) / 10;
}

// Centered moving average; window clamped at the array edges.
function smooth(values, window) {
  if (window <= 1 || values.length === 0) return values.slice();
  const half = Math.floor(window / 2);
  const out = new Array(values.length);
  for (let i = 0; i < values.length; i += 1) {
    let sum = 0;
    let count = 0;
    for (let j = i - half; j <= i + half; j += 1) {
      if (j >= 0 && j < values.length) {
        sum += values[j];
        count += 1;
      }
    }
    out[i] = sum / count;
  }
  return out;
}

function emptyResult(reason) {
  return { reps: [], repCount: 0, timelineSummary: reason, confident: false, reason };
}

function repFlags(minAngleDeg, tempoSec, opts) {
  const flags = [];
  if (typeof opts.isShallow === "function" && opts.isShallow(minAngleDeg)) flags.push("shallow");
  if (tempoSec != null && tempoSec > 0 && tempoSec < opts.fastTempoSec) flags.push("fast");
  return flags;
}

// Movement-agnostic core. `config.getValue(sample)` returns the joint angle that
// bottoms out at the deepest point; `config.classify(minAngleDeg)` returns the
// coarse assessment label; `config.isShallow(minAngleDeg)` flags shallow reps.
export function segmentAngleReps(samples, config = {}) {
  const opts = { ...DEFAULTS, ...config };
  const getValue = config.getValue || ((s) => s.value);
  const classify = config.classify || (() => "unknown");

  const list = (Array.isArray(samples) ? samples : [])
    .map((s) => (s ? { tMs: s.tMs, value: getValue(s) } : s))
    .filter((s) => s && Number.isFinite(s.tMs) && Number.isFinite(s.value))
    .sort((a, b) => a.tMs - b.tMs);

  if (list.length < opts.minSamples) {
    return emptyResult("Not enough clear frames to break the clip into reps.");
  }

  const smoothed = smooth(
    list.map((s) => s.value),
    opts.smoothWindow,
  );
  const maxA = Math.max(...smoothed);
  const minA = Math.min(...smoothed);
  const range = maxA - minA;

  if (range < opts.minRangeDeg) {
    return emptyResult("Not enough movement to separate reps — try a clear side-view clip of a few reps.");
  }

  const downThreshold = maxA - range * opts.downFrac;
  const upThreshold = maxA - range * opts.upFrac;

  const reps = [];
  let state = "up";
  let pendingStartMs = list[0].tMs;
  let bottomMs = null;
  let bottomAngle = null;

  for (let i = 0; i < list.length; i += 1) {
    const a = smoothed[i];
    const t = list[i].tMs;

    if (state === "up") {
      if (a <= downThreshold) {
        state = "down";
        bottomAngle = a;
        bottomMs = t;
      } else if (a >= upThreshold) {
        pendingStartMs = t;
      }
    } else {
      if (a < bottomAngle) {
        bottomAngle = a;
        bottomMs = t;
      }
      if (a >= upThreshold) {
        const startMs = pendingStartMs;
        const endMs = t;
        const minAngleDeg = round1(bottomAngle);
        const tempoSec = round1((endMs - startMs) / 1000);
        reps.push({
          index: reps.length + 1,
          startMs,
          bottomMs,
          endMs,
          assessment: classify(minAngleDeg),
          minAngleDeg,
          tempoSec,
          flags: repFlags(minAngleDeg, tempoSec, opts),
        });
        state = "up";
        pendingStartMs = t;
        bottomMs = null;
        bottomAngle = null;
      }
    }
  }
  // A trailing descent that never returns to standing is conservatively dropped.

  const repCount = reps.length;
  if (repCount === 0) {
    return emptyResult("Couldn't clearly separate individual reps — try a steady side-view clip.");
  }

  const timelineSummary = `${repCount} rep${repCount === 1 ? "" : "s"} detected`;
  return { reps, repCount, timelineSummary, confident: true, reason: null };
}

// ── Squat (knee angle) ─────────────────────────────────────────────────────
// Backward-compatible: reps carry the legacy `kneeAngleDeg`/`depthAssessment`
// fields alongside the generic ones.
export function segmentReps(samples, options = {}) {
  const out = segmentAngleReps(samples, {
    ...options,
    getValue: (s) => s.kneeAngleDeg,
    classify: classifyDepth,
    isShallow: (a) => a != null && a > SHALLOW_KNEE_ANGLE,
  });
  return {
    ...out,
    reps: out.reps.map((r) => ({
      ...r,
      depthAssessment: r.assessment,
      minKneeAngleDeg: r.minAngleDeg,
    })),
  };
}

// ── Deadlift (hip angle) ────────────────────────────────────────────────────
export function segmentDeadliftReps(samples, options = {}) {
  const out = segmentAngleReps(samples, {
    ...options,
    getValue: (s) => s.hipAngleDeg,
    classify: classifyHinge,
    isShallow: (a) => a != null && a > PARTIAL_HINGE_HIP_ANGLE,
  });
  return {
    ...out,
    reps: out.reps.map((r) => ({
      ...r,
      depthAssessment: r.assessment,
      minHipAngleDeg: r.minAngleDeg,
    })),
  };
}

// ── Push-up (elbow angle) ───────────────────────────────────────────────────
export function segmentPushupReps(samples, options = {}) {
  const out = segmentAngleReps(samples, {
    ...options,
    getValue: (s) => s.elbowAngleDeg,
    classify: classifyPushupDepth,
    isShallow: (a) => a != null && a > NEAR_ELBOW_ANGLE,
  });
  return {
    ...out,
    reps: out.reps.map((r) => ({
      ...r,
      depthAssessment: r.assessment,
      minElbowAngleDeg: r.minAngleDeg,
    })),
  };
}

// ── Upper-body elbow-angle movements ────────────────────────────────────────
// Bench press, overhead press, and bent-over row all read the raw elbow angle
// (shoulder–elbow–wrist), exactly like the push-up wrapper. The engine's
// contract is that every movement "bottoms out at a smaller joint angle", and
// the contracted position of each of these — chest for the bench, the rack for
// the overhead press, elbows-pulled-in for the row — is precisely where the raw
// elbow angle is smallest. So the same descend/ascend hysteresis detects that
// contracted position as the rep bottom, and `minElbowAngleDeg` is the real
// joint angle there (no inversion needed; inverting would instead report the
// straight-arm rest position and flip the depth labels).
function segmentElbowMovement(samples, options, classify, partialAngle) {
  const out = segmentAngleReps(samples, {
    ...options,
    getValue: (s) => s.elbowAngleDeg,
    classify,
    isShallow: (a) => a != null && a > partialAngle,
  });
  return {
    ...out,
    reps: out.reps.map((r) => ({
      ...r,
      depthAssessment: r.assessment,
      minElbowAngleDeg: r.minAngleDeg,
    })),
  };
}

export function segmentBenchpressReps(samples, options = {}) {
  return segmentElbowMovement(samples, options, classifyBenchDepth, PARTIAL_BENCH_ELBOW_ANGLE);
}

export function segmentOverheadpressReps(samples, options = {}) {
  return segmentElbowMovement(samples, options, classifyOverheadDepth, PARTIAL_OHP_ELBOW_ANGLE);
}

export function segmentBentoverrowReps(samples, options = {}) {
  return segmentElbowMovement(samples, options, classifyRowPull, PARTIAL_ROW_ELBOW_ANGLE);
}
