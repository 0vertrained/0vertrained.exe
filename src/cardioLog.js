import { formatDuration, parseRunTime } from "./runPaces";

const RUN_HINT = /\b(run|runs|running|jog|jogging|intervals?|tempo|threshold|strides?|fartlek|track|hill repeats?|shakeout|race|5k|10k|half marathon|marathon|zone\s*2|long zone)\b/i;
const NON_RUN = /\b(walk|walking|hike|hiking|bike|biking|bikeerg|ride|cycling|cycle|spin|spinning|row|rowing|rower|elliptical|swim|swimming|ski|skierg|erg|stairs?|stairmaster|stepper|stairclimber|rope|sled)\b/i;
const EXPLICIT_RUN = /\b(run|runs|running|jog|jogging)\b/i;

/**
 * Is this prescribed cardio a run? Walks, bike, row etc. are not — unless the
 * type also says run ("Zone 2 Bike/Run", "Long Run/Walk"), in which case the
 * plan claims it so running is never doubled up.
 */
export function isRunCardio(cardio) {
  if (cardio?.modality) return cardio.modality === "run";
  const text = String(cardio?.type || "");
  if (!cardio || !RUN_HINT.test(text)) return false;
  return !NON_RUN.test(text) || EXPLICIT_RUN.test(text);
}

const SPORT_NAMES = {
  run: "Run", walk: "Walk", bike: "Bike", row: "Row", elliptical: "Elliptical",
  swim: "Swim", stairs: "Stair climber", stair: "Stair climber", ski: "Ski", hike: "Hike", rope: "Jump rope", cross: "Cross training", cardio: "Cardio",
};

export function hasCardioResult(block) {
  return Number(block?.miles) > 0 || parseRunTime(block?.time) > 0;
}

// Prefer what was recorded. The current weekly template can change after a
// session. Older distance-only entries were logged through the run form.
export function cardioModality(block) {
  if (block?.modality) return block.modality;
  if (block?.type) {
    if (isRunCardio(block)) return "run";
    const text = String(block.type).toLowerCase();
    if (/bik|ride|cycl|spin/.test(text)) return "bike";
    if (/hik/.test(text)) return "hike";
    if (/walk/.test(text)) return "walk";
    if (/row/.test(text)) return "row";
    if (/elliptical/.test(text)) return "elliptical";
    if (/rope/.test(text)) return "rope";
    if (/stair|stepper/.test(text)) return "stair";
    if (/swim/.test(text)) return "swim";
    if (/skierg|ski erg|cross.?train/.test(text)) return "cross";
    if (/ski/.test(text)) return "ski";
    return "cardio";
  }
  if (block?.activityRefs?.length) {
    const sports = new Set(block.activityRefs.map(ref => ref?.kind));
    const kind = sports.size === 1 && [...sports][0];
    return kind === "ride" ? "bike" : SPORT_NAMES[kind] ? kind : "cardio";
  }
  return Number(block?.miles) > 0 || block?.race ? "run" : "cardio";
}

export function cardioLabel(block) {
  return block?.type || SPORT_NAMES[cardioModality(block)] || "Cardio";
}

export function cardioResultText(block) {
  const miles = Number(block?.miles);
  const time = formatDuration(parseRunTime(block?.time));
  return [miles > 0 ? `${miles}\u00a0mi` : "", time].filter(Boolean).join(" · ");
}
