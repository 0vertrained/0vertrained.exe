// ─── Recovery Score Calculator ────────────────────────────────────────────────
// Calculates a 0-100 recovery score from recovery STATE (sleep, soreness,
// energy). Sleep is smoothed over a 7-day window anchored to the scored day so
// one bad night doesn't tank the score. Training load is modeled separately by
// the ACWR/strain layer and is deliberately NOT folded in here.
//
// Optional new manual metrics (sleepQuality, stress, motivation) apply mild
// conservative modifiers to the core score without changing old data behavior.

import { RECOVERY_BANDS, RECOVERY_COLOR, PERSONALIZATION } from "./intelligenceConfig";
import { calcRecoveryModifiers } from "./manualRecovery";

export function calcRecoveryScore(yesterdayData, allData, refDateKey = null) {
  if (!yesterdayData) return null;

  const rawSleep  = parseFloat(yesterdayData.body?.sleep);
  const rawSore   = parseFloat(yesterdayData.body?.soreness);
  const rawEnergy = parseFloat(yesterdayData.body?.energy);

  // 7-day rolling sleep average ANCHORED to the day being scored (inclusive),
  // not to "now" — so a historical day is scored against its own window.
  // V4 calibration: blend 60% acute (last night) + 40% 7-day average when
  // enough history exists. A pure 7-day average masked acute deprivation —
  // one 4h night barely moved the score. The blend preserves the smoothing
  // benefit while letting last night carry appropriate weight.
  const directSleep = Number.isFinite(rawSleep) && rawSleep > 0 ? rawSleep : null;
  let sleepInput = directSleep;
  let sleepBlend = "acute"; // acute | blended | averaged
  if (allData) {
    const end = refDateKey ? new Date(`${refDateKey}T12:00:00`) : new Date();
    const sleepVals = [];
    for (let i = 0; i <= 6; i++) {
      const d = new Date(end); d.setDate(end.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
      const s = parseFloat(allData[key]?.body?.sleep);
      if (s > 0) sleepVals.push(s);
    }
    if (sleepVals.length >= 3) {
      const sevenDayAvg = sleepVals.reduce((a, b) => a + b, 0) / sleepVals.length;
      if (directSleep !== null) {
        // 60% acute, 40% 7-day average — acute night matters but history smooths
        sleepInput = directSleep * 0.6 + sevenDayAvg * 0.4;
        sleepBlend = "blended";
      } else {
        // No acute sleep logged — fall back to the 7-day average alone
        sleepInput = sevenDayAvg;
        sleepBlend = "averaged";
      }
    }
  }

  // Total tonnage from the scored day (kept for callers, not used in the score).
  let volume = 0;
  for (const ex of Object.values(yesterdayData.workout?.exercises || {})) {
    for (const set of ex.sets || []) {
      const w = parseFloat(set.weight) || 0;
      const r = parseFloat(set.reps)   || 0;
      if (w > 0 && r > 0) volume += w * r;
    }
  }

  // Availability — a missing input must NOT be scored as worst-case.
  const sleepAvail  = sleepInput !== null;
  const soreAvail   = Number.isFinite(rawSore) && rawSore > 0;
  const energyAvail = Number.isFinite(rawEnergy) && rawEnergy > 0;

  // Recovery STATE only (sleep / soreness / energy). Sleep is the strongest
  // recovery driver, so it carries the most weight.
  const W_SLEEP = 45, W_SORE = 30, W_ENERGY = 25;
  const sleepScore    = sleepAvail  ? Math.min(W_SLEEP, (sleepInput / 8) * W_SLEEP) : 0;
  // Soreness: concave curve — forgiving 1-5 (normal training DOMS), steeper
  // 6-10 (real recovery concern). Linear scoring penalized soreness 3 (normal
  // training) almost as much as soreness 6 (problem). The curve preserves most
  // of the score for mild/moderate soreness and drops fast only when high.
  //   sore 1 → ~30/30  (full)
  //   sore 3 → ~27/30  (normal training, -3.1)
  //   sore 5 → ~21/30  (moderate, -5.7 from 3)
  //   sore 7 → ~14/30  (high, -7.4 from 5)
  //   sore 9 → ~5/30   (severe, -8.8 from 7)
  const sorenessScore = soreAvail
    ? Math.max(0, Math.min(W_SORE, W_SORE * (1 - Math.pow((rawSore - 1) / 9, 1.5))))
    : 0;
  const energyScore   = energyAvail ? Math.max(0, ((rawEnergy - 1) / 9) * W_ENERGY) : 0;

  // Renormalize over AVAILABLE weight so a data gap neither helps nor tanks it.
  const parts = [
    { w: W_SLEEP,  pts: sleepScore,    avail: sleepAvail },
    { w: W_SORE,   pts: sorenessScore, avail: soreAvail },
    { w: W_ENERGY, pts: energyScore,   avail: energyAvail },
  ];
  const availWeight = parts.reduce((s, p) => s + (p.avail ? p.w : 0), 0) || 1;
  const sumPoints   = parts.reduce((s, p) => s + (p.avail ? p.pts : 0), 0);
  const score = Math.min(100, Math.max(0, Math.round((sumPoints / availWeight) * 100)));

  // Confidence reflects how many of the three subjective inputs were present.
  const present = [sleepAvail, soreAvail, energyAvail].filter(Boolean).length;
  const confidence = present >= 3 ? "high" : present === 2 ? "medium" : "low";
  const missing = [];
  if (!sleepAvail)  missing.push("sleep");
  if (!soreAvail)   missing.push("soreness");
  if (!energyAvail) missing.push("energy");

  // Apply optional manual metric modifiers (sleepQuality, stress, motivation).
  // These are conservative and do not change scores for old data without these fields.
  const modifiers = calcRecoveryModifiers(yesterdayData.body || {});
  const modifiedScore = Math.min(100, Math.max(0, Math.round(score + modifiers.modifierDelta)));

  const naLabel = "not logged";
  return {
    score: modifiedScore,
    baseScore: score,
    source: "subjective",
    confidence,
    missing,
    volume: Math.round(volume),
    components: {
      sleep:    { score: Math.round(sleepScore),    max: W_SLEEP,  label: "Sleep",    value: sleepAvail ? (sleepBlend === "blended" ? `${sleepInput.toFixed(1)}hrs (60% acute + 40% 7d)` : sleepBlend === "averaged" ? `${sleepInput.toFixed(1)}hrs (7d avg)` : `${sleepInput}hrs`) : naLabel },
      soreness: { score: Math.round(sorenessScore), max: W_SORE,   label: "Soreness", value: soreAvail ? `${rawSore}/10` : naLabel },
      energy:   { score: Math.round(energyScore),   max: W_ENERGY, label: "Energy",   value: energyAvail ? `${rawEnergy}/10` : naLabel },
    },
    modifiers: modifiers.components,
    read: getRead(modifiedScore),
    color: getColor(modifiedScore),
  };
}

export function getRead(score) {
  if (score >= RECOVERY_BANDS.readyToPush) return "ready to push";
  if (score >= RECOVERY_BANDS.good)        return "good to train";
  if (score >= RECOVERY_BANDS.moderate)    return "train moderate";
  if (score >= RECOVERY_BANDS.takeEasy)    return "take it easy";
  if (score >= RECOVERY_BANDS.considerRest) return "consider rest";
  return "rest day recommended";
}

export function getColor(score) {
  // Returns a semantic key resolved to theme colors at render time
  if (score >= RECOVERY_COLOR.good) return "good";
  if (score >= RECOVERY_COLOR.warn) return "warn";
  return "low";
}

// Rolling personal baseline for the subjective recovery score: trailing-window
// mean and (sample) SD, so the decision layer can ask "is this low FOR YOU?"
// rather than only "is this low in absolute terms?".
export function computeRecoveryBaseline(data, refDateKey = null, days = PERSONALIZATION.windowDays) {
  if (!data) return { mean: 0, sd: 0, n: 0 };
  const end = refDateKey ? new Date(`${refDateKey}T12:00:00`) : new Date();
  const scores = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(end); d.setDate(end.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (!data[key]) continue;
    const r = calcRecoveryScore(data[key], data, key);
    if (r && Number.isFinite(r.score)) scores.push(r.score);
  }
  const n = scores.length;
  if (n === 0) return { mean: 0, sd: 0, n: 0 };
  const m = scores.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(scores.reduce((s, v) => s + (v - m) * (v - m), 0) / (n - 1)) : 0;
  return { mean: Math.round(m * 10) / 10, sd: Math.round(sd * 100) / 100, n };
}

// Single recovery entry point for the decision layer: prefer biometric (Oura)
// recovery when present, otherwise the subjective score. This is what unifies
// the two same-named scorers — callers no longer pick a source ad hoc.
export function resolveRecovery({ subjective = null, ouraScore = null } = {}) {
  if (Number.isFinite(ouraScore)) {
    const s = Math.max(0, Math.min(100, Math.round(ouraScore)));
    return { score: s, read: getRead(s), color: getColor(s), source: "oura", confidence: "high", components: subjective?.components || null };
  }
  if (subjective) return { ...subjective, source: subjective.source || "subjective" };
  return null;
}

// Calculate weekly review from a map of { dateKey: dayData }
export function calcWeeklyReview(data, goals) {
  const today = new Date();
  const weekKeys = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    weekKeys.push(`${y}-${m}-${day}`);
  }

  const weekData = weekKeys.map(k => data[k]).filter(Boolean);
  const daysLogged = weekData.length;

  // Workouts — count days with any exercises or cardio logged
  const workoutsDone = weekData.filter(d =>
    Object.keys(d.workout?.exercises || {}).length > 0 ||
    parseFloat(d.workout?.cardio?.miles) > 0
  ).length;

  // Miles
  const totalMiles = weekData.reduce((acc, d) =>
    acc + (parseFloat(d.workout?.cardio?.miles) || 0), 0);

  // Avg macros
  const nutritionDays = weekData.filter(d => parseFloat(d.nutrition?.calories) > 0);
  const avgCalories = nutritionDays.length
    ? Math.round(nutritionDays.reduce((a, d) => a + (parseFloat(d.nutrition?.calories) || 0), 0) / nutritionDays.length)
    : 0;
  const avgProtein = nutritionDays.length
    ? Math.round(nutritionDays.reduce((a, d) => a + (parseFloat(d.nutrition?.protein) || 0), 0) / nutritionDays.length)
    : 0;

  // Avg sleep
  const sleepDays = weekData.filter(d => parseFloat(d.body?.sleep) > 0);
  const avgSleep = sleepDays.length
    ? (sleepDays.reduce((a, d) => a + (parseFloat(d.body?.sleep) || 0), 0) / sleepDays.length).toFixed(1)
    : 0;

  // Avg weight
  const weightDays = weekData.filter(d => parseFloat(d.body?.weight) > 0);
  const avgWeight = weightDays.length
    ? (weightDays.reduce((a, d) => a + (parseFloat(d.body?.weight) || 0), 0) / weightDays.length).toFixed(1)
    : null;

  // Protein goal hit %
  const proteinDays = weekData.filter(d =>
    (parseFloat(d.nutrition?.protein) || 0) >= (goals?.protein || 200)
  ).length;

  // Total volume
  let totalVolume = 0;
  for (const d of weekData) {
    for (const ex of Object.values(d.workout?.exercises || {})) {
      for (const set of ex.sets || []) {
        const w = parseFloat(set.weight) || 0;
        const r = parseFloat(set.reps)   || 0;
        if (w > 0 && r > 0) totalVolume += w * r;
      }
    }
  }

  // Best lifts this week
  const prs = {};
  for (const d of weekData) {
    for (const [exName, ex] of Object.entries(d.workout?.exercises || {})) {
      for (const set of ex.sets || []) {
        const w = parseFloat(set.weight) || 0;
        if (w > 0 && (!prs[exName] || w > prs[exName])) prs[exName] = w;
      }
    }
  }
  const topLifts = Object.entries(prs)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  // Weekly score: proportional to how close each target was hit, using user's actual goals
  const workoutTarget  = goals?.workouts || 5;
  const milesTarget    = goals?.miles    || 15;
  const proteinTarget  = goals?.protein  || 200;
  const waterTarget    = goals?.water    || 128;

  const waterDays = weekData.filter(d =>
    (parseFloat(d.nutrition?.water) || 0) >= waterTarget
  ).length;

  // Score each dimension 0-1, allowing partial credit
  const workoutScore  = Math.min(1, workoutsDone / workoutTarget);
  const milesScore    = Math.min(1, totalMiles   / milesTarget);
  const proteinScore  = Math.min(1, proteinDays  / 5);
  const sleepScore    = Math.min(1, parseFloat(avgSleep) / 7);
  const waterScore    = Math.min(1, waterDays    / 5);

  const weekScore = Math.round(
    (workoutScore + milesScore + proteinScore + sleepScore + waterScore) / 5 * 100
  );

  // For the UI checklist — show actual numbers vs targets
  const targetChecks = [
    workoutsDone >= workoutTarget,
    totalMiles   >= milesTarget,
    proteinDays  >= 5,
    parseFloat(avgSleep) >= 7,
    waterDays    >= 5,
  ];

  const targetLabels = [
    `${workoutsDone}/${workoutTarget} workouts`,
    `${totalMiles}/${milesTarget} miles`,
    `${proteinDays}/5d protein ≥ ${proteinTarget}g`,
    `${avgSleep}/7h avg sleep`,
    `${waterDays}/5d water goal`,
  ];

  const roundedMiles = parseFloat(totalMiles.toFixed(1));
  const highlights = [];
  const watchouts = [];
  const nextActions = [];

  if (workoutsDone >= workoutTarget) highlights.push(`${workoutsDone}/${workoutTarget} workouts completed`);
  else watchouts.push(`${workoutsDone}/${workoutTarget} workouts completed`);
  if (roundedMiles >= milesTarget) highlights.push(`${roundedMiles} mi run volume`);
  else watchouts.push(`${roundedMiles}/${milesTarget} mi run volume`);
  if (proteinDays >= 5) highlights.push(`protein target hit ${proteinDays}/5 days`);
  else watchouts.push(`protein target hit ${proteinDays}/5 days`);
  if (parseFloat(avgSleep) >= 7) highlights.push(`${avgSleep}h average sleep`);
  else watchouts.push(`${avgSleep}h average sleep`);
  if (waterDays >= 5) highlights.push(`water target hit ${waterDays}/5 days`);
  else watchouts.push(`water target hit ${waterDays}/5 days`);

  if (proteinDays < 5) nextActions.push("Prioritize protein earlier in the day to close the fueling gap.");
  if (parseFloat(avgSleep) < 7) nextActions.push("Protect sleep/recovery before adding more training load.");
  if (waterDays < 5) nextActions.push("Bring water/electrolytes up earlier, not just at night.");
  if (workoutsDone < workoutTarget) nextActions.push("Keep the training week simple: hit the planned sessions before adding extras.");
  if (roundedMiles < milesTarget) nextActions.push("Build run volume gradually only if readiness stays stable.");
  if (nextActions.length === 0) nextActions.push("Maintain the current rhythm; progress one variable at a time next week.");

  const coachNote = weekScore >= 80
    ? "Consistency is strong. Keep the pattern, but avoid turning every green light into extra load."
    : weekScore >= 55
      ? "The week is productive but uneven. Tighten the lowest recovery or fueling lever before increasing load."
      : "Recovery and fueling signals are limiting the week. Stabilize basics before chasing progression.";

  return {
    weekKeys,
    daysLogged,
    workoutsDone,
    totalMiles: roundedMiles,
    avgCalories,
    avgProtein,
    avgSleep,
    avgWeight,
    proteinDays,
    waterDays,
    totalVolume: Math.round(totalVolume),
    topLifts,
    weekScore,
    targetChecks,
    targetLabels,
    highlights,
    watchouts,
    nextActions,
    coachNote,
  };
}
