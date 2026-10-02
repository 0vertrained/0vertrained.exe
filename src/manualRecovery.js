// src/manualRecovery.js
// Helpers for parsing, normalizing, and summarizing manual recovery metrics.
// Handles the optional body fields that expand beyond the core sleep/soreness/energy.

const SUBJECTIVE_MIN = 1;
const SUBJECTIVE_MAX = 10;

/**
 * Parse and normalize manual recovery metrics from body object.
 * Returns null for unparseable/missing fields; clamps subjective ranges.
 * @param {object} body - The daily body object from the entry
 * @returns {object} Normalized metrics with present/missing arrays
 */
export function parseManualRecovery(body = {}) {
  const parse = (val) => {
    if (!val && val !== 0) return null;
    const num = Number(val);
    return Number.isFinite(num) ? num : null;
  };

  const clampSubjective = (val) => {
    if (val === null) return null;
    return Math.max(SUBJECTIVE_MIN, Math.min(SUBJECTIVE_MAX, val));
  };

  const sleep = parse(body.sleep);
  const sleepQuality = clampSubjective(parse(body.sleepQuality));
  const restingHeartRate = parse(body.restingHeartRate);
  const hrv = parse(body.hrv);
  const energy = clampSubjective(parse(body.energy));
  const soreness = clampSubjective(parse(body.soreness));
  const stress = clampSubjective(parse(body.stress));
  const motivation = clampSubjective(parse(body.motivation));
  const weight = parse(body.weight);
  const illnessOrInjury = typeof body.illnessOrInjury === "boolean"
    ? body.illnessOrInjury
    : body.illnessOrInjury === "true"
      ? true
      : body.illnessOrInjury === "false"
        ? false
        : null;

  const present = [];
  const missing = [];

  // Track which fields are available for completeness signaling
  [
    ["sleep", sleep],
    ["sleepQuality", sleepQuality],
    ["restingHeartRate", restingHeartRate],
    ["hrv", hrv],
    ["energy", energy],
    ["soreness", soreness],
    ["stress", stress],
    ["motivation", motivation],
    ["weight", weight],
    ["illnessOrInjury", illnessOrInjury],
  ].forEach(([name, value]) => {
    if (value !== null) present.push(name);
    else missing.push(name);
  });

  return {
    sleep,
    sleepQuality,
    restingHeartRate,
    hrv,
    energy,
    soreness,
    stress,
    motivation,
    weight,
    illnessOrInjury,
    present,
    missing,
  };
}

/**
 * Summarize manual recovery metrics as a human-readable string.
 * Shows only present metrics, formatted compactly.
 * @param {object} body - The daily body object
 * @returns {string} Brief summary like "Sleep 7.2h · Quality 8/10 · HRV 42"
 */
export function summarizeManualRecovery(body = {}) {
  const parsed = parseManualRecovery(body);
  const parts = [];

  if (parsed.sleep !== null) parts.push(`Sleep ${parsed.sleep}h`);
  if (parsed.sleepQuality !== null) parts.push(`Quality ${parsed.sleepQuality}/10`);
  if (parsed.restingHeartRate !== null) parts.push(`RHR ${parsed.restingHeartRate}`);
  if (parsed.hrv !== null) parts.push(`HRV ${parsed.hrv}`);
  if (parsed.stress !== null) parts.push(`Stress ${parsed.stress}/10`);
  if (parsed.motivation !== null) parts.push(`Motivation ${parsed.motivation}/10`);
  if (parsed.illnessOrInjury === true) parts.push("Illness/injury flagged");

  return parts.join(" · ");
}

/**
 * Get completeness score: how many optional recovery fields are filled in?
 * Used to signal to the UI if the athlete is providing rich data.
 * @param {object} body - The daily body object
 * @returns {object} { filled: number, total: number, ratio: 0-1 }
 */
export function getManualRecoveryCompleteness(body = {}) {
  const parsed = parseManualRecovery(body);
  // Exclude weight from completeness count; weight is logged separately
  const optionalFields = [
    "sleep",
    "sleepQuality",
    "restingHeartRate",
    "hrv",
    "energy",
    "soreness",
    "stress",
    "motivation",
    "illnessOrInjury",
  ];
  const filled = optionalFields.filter((f) => parsed[f] !== null).length;
  const ratio = filled / optionalFields.length;
  return { filled, total: optionalFields.length, ratio };
}

/**
 * Calculate conservative recovery score modifiers based on new manual metrics.
 * Modifiers are applied to the base recovery score to nudge it based on
 * sleep quality, stress, and motivation (not HRV/RHR, which need baseline).
 * @param {object} body - The daily body object
 * @returns {object} { modifierDelta: number, components: {...}, capped: number }
 */
export function calcRecoveryModifiers(body = {}) {
  const parsed = parseManualRecovery(body);

  // Conservative caps: do not let new fields dominate the core score.
  const sleepQualityMax = 4;
  const stressMax = 4;
  const motivationMax = 3;
  const illnessMax = 8;
  const maxTotal = 8;

  let delta = 0;
  const components = {};

  // Sleep quality: higher is better. Range [1,10] -> scale to [-4, 4]
  if (parsed.sleepQuality !== null) {
    const normalized = (parsed.sleepQuality - SUBJECTIVE_MIN) / (SUBJECTIVE_MAX - SUBJECTIVE_MIN); // [0,1]
    const contribution = (normalized * 2 - 1) * sleepQualityMax; // [-4, 4]
    delta += contribution;
    components.sleepQuality = {
      label: "Sleep quality",
      value: `${parsed.sleepQuality}/10`,
      delta: Math.round(contribution * 100) / 100,
    };
  }

  // Stress: higher is worse. Range [1,10] -> scale to [+4, -4]
  if (parsed.stress !== null) {
    const normalized = (parsed.stress - SUBJECTIVE_MIN) / (SUBJECTIVE_MAX - SUBJECTIVE_MIN); // [0,1]
    const contribution = (1 - normalized * 2) * stressMax; // [+4, -4]
    delta += contribution;
    components.stress = {
      label: "Stress",
      value: `${parsed.stress}/10`,
      delta: Math.round(contribution * 100) / 100,
    };
  }

  // Motivation: higher is better. Range [1,10] -> scale to [-3, 3]
  if (parsed.motivation !== null) {
    const normalized = (parsed.motivation - SUBJECTIVE_MIN) / (SUBJECTIVE_MAX - SUBJECTIVE_MIN); // [0,1]
    const contribution = (normalized * 2 - 1) * motivationMax; // [-3, 3]
    delta += contribution;
    components.motivation = {
      label: "Motivation",
      value: `${parsed.motivation}/10`,
      delta: Math.round(contribution * 100) / 100,
    };
  }

  // Illness/injury flag: strong caution, not a diagnosis.
  if (parsed.illnessOrInjury === true) {
    delta -= illnessMax;
    components.illnessOrInjury = {
      label: "Illness / injury flag",
      value: "flagged",
      delta: -illnessMax,
    };
  }

  // Cap total modifier
  const capped = Math.max(-maxTotal, Math.min(maxTotal, delta));

  return {
    modifierDelta: Math.round(capped * 100) / 100,
    components,
    capped,
  };
}
