// Movement routing for Form Check.
//
// Maps a protocol movement key (e.g. "deadlift-side-view") to the pure helper
// bundle that drives its local analysis: aggregate (frames -> coarse metrics),
// buildSeries (frames -> per-frame angle series), analyze (metrics -> cues), and
// segment (series -> rep timeline). Unknown/missing keys fall back to squat so
// the pipeline always has a usable, conservative module.

import { getProtocol } from "./protocols";
import { aggregateSquatMetrics, buildKneeSeries } from "./squatMetrics";
import { analyzeSquat } from "./squatAnalyzer";
import { aggregateDeadliftMetrics, buildHipSeries } from "./deadliftMetrics";
import { analyzeDeadlift } from "./deadliftAnalyzer";
import { aggregatePushupMetrics, buildElbowSeries } from "./pushupMetrics";
import { analyzePushup } from "./pushupAnalyzer";
import { aggregateBenchpressMetrics, buildBenchpressSeries, extractBenchpressWristPositions } from "./benchpressMetrics";
import { analyzeBenchpress } from "./benchpressAnalyzer";
import { aggregateOverheadpressMetrics, buildOverheadpressSeries, extractOverheadpressWristPositions } from "./overheadpressMetrics";
import { analyzeOverheadpress } from "./overheadpressAnalyzer";
import { aggregateBentoverrowMetrics, buildBentoverrowSeries } from "./bentoverrowMetrics";
import { analyzeBentoverrow } from "./bentoverrowAnalyzer";
import {
  segmentReps,
  segmentDeadliftReps,
  segmentPushupReps,
  segmentBenchpressReps,
  segmentOverheadpressReps,
  segmentBentoverrowReps,
} from "./repSegmentation";

export const DEFAULT_MOVEMENT_MODULE = "squat";

const MODULES = {
  squat: {
    movement: "squat",
    aggregate: aggregateSquatMetrics,
    buildSeries: buildKneeSeries,
    analyze: analyzeSquat,
    segment: segmentReps,
  },
  deadlift: {
    movement: "deadlift",
    aggregate: aggregateDeadliftMetrics,
    buildSeries: buildHipSeries,
    analyze: analyzeDeadlift,
    segment: segmentDeadliftReps,
  },
  pushup: {
    movement: "pushup",
    aggregate: aggregatePushupMetrics,
    buildSeries: buildElbowSeries,
    analyze: analyzePushup,
    segment: segmentPushupReps,
  },
  benchpress: {
    movement: "benchpress",
    aggregate: aggregateBenchpressMetrics,
    buildSeries: buildBenchpressSeries,
    analyze: analyzeBenchpress,
    segment: segmentBenchpressReps,
    extractWristPositions: extractBenchpressWristPositions,
  },
  overheadpress: {
    movement: "overheadpress",
    aggregate: aggregateOverheadpressMetrics,
    buildSeries: buildOverheadpressSeries,
    analyze: analyzeOverheadpress,
    segment: segmentOverheadpressReps,
    extractWristPositions: extractOverheadpressWristPositions,
  },
  bentoverrow: {
    movement: "bentoverrow",
    aggregate: aggregateBentoverrowMetrics,
    buildSeries: buildBentoverrowSeries,
    analyze: analyzeBentoverrow,
    segment: segmentBentoverrowReps,
  },
};

const MODULE_ALIASES = {
  // Lower-body/squat variants reuse the squat fallback analyzer locally.
  frontsquat: "squat",
  gobletsquat: "squat",
  lunge: "squat",
  // Hinge variants reuse deadlift local helpers.
  rdl: "deadlift",
  hipthrust: "deadlift",
  kettlebellswing: "deadlift",
  // Press variants reuse bench/OHP helpers.
  inclinebench: "benchpress",
  dbbench: "benchpress",
  dip: "benchpress",
  dbshoulderpress: "overheadpress",
  // Pull variants reuse row helpers locally.
  pullup: "bentoverrow",
  latpulldown: "bentoverrow",
  cablerow: "bentoverrow",
  // Advanced lifts get conservative local hinge fallback; hosted backend gives richer V1.9 output.
  powerclean: "deadlift",
  snatch: "deadlift",
  cleanjerk: "deadlift",
};

// Resolve the helper bundle for a movement (protocol) key. Falls back to the
// squat module for unknown/missing keys — getProtocol already resolves unknown
// keys to the default protocol, but we guard the movement lookup too.
export function getMovementModule(movementKey) {
  const protocol = getProtocol(movementKey);
  const key = protocol && protocol.movement;
  const moduleKey = MODULES[key] ? key : MODULE_ALIASES[key];
  return MODULES[moduleKey] || MODULES[DEFAULT_MOVEMENT_MODULE];
}
