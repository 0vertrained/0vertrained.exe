// src/loadModel.js
// Training Load Model
//   • Session load via Foster session-RPE (sRPE = RPE × duration), with DURATION
//     as the common currency so lifting and running are comparable for a hybrid
//     athlete (a long run is no longer dwarfed by lifting tonnage).
//   • Acute:Chronic Workload Ratio via EWMA (Williams et al. 2017) — more
//     responsive to spikes and free of the window-exit artifacts of rolling means.
//   • Monotony & strain (Foster) as additional overtraining signals.

const MIN_PER_SET = 3;             // working set incl. rest, minutes (estimate)
const DEFAULT_PACE_SEC = 9 * 60;   // fallback running pace when none logged (sec/mi)

// Parse "mm:ss" (optionally "/mi") to seconds per mile.
function paceToSecPerMile(paceStr) {
  if (typeof paceStr !== "string") return null;
  const clean = paceStr.replace(/\/?mi.*$/i, "").replace(/min.*$/i, "").trim();
  const m = clean.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const sec = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  return sec > 0 ? sec : null;
}

// Session RPE: prefer a logged value (workout.rpe, 1–10); otherwise infer a
// moderate RPE from effort cues. Duration carries most of the load signal, so
// the estimate only needs to be roughly right.
function resolveSessionRpe(wo, hasLift) {
  const logged = parseFloat(wo?.rpe);
  if (Number.isFinite(logged) && logged >= 1 && logged <= 10) return { rpe: logged, estimated: false };
  const text = [wo?.cardio?.type, wo?.cardio?.effort, wo?.cardio?.notes, wo?.type, wo?.code]
    .map(v => String(v || "").toLowerCase()).join(" ");
  let rpe = 5.5;
  if (/interval|tempo|threshold|hard|race|hyrox|sprint|speed|station/.test(text)) rpe = 7;
  else if (/easy|zone\s*1|zone\s*2|recovery|shakeout|conversational|walk/.test(text)) rpe = 4;
  else if (hasLift) rpe = 6;
  return { rpe, estimated: true };
}

// Exported: the Strava running-volume figure reuses this exact
// definition of "manually logged cardio" so manual-vs-import dedupe can never
// drift from the load model's own reading of a day.
export function getLoggedCardioBlocks(wo) {
  const sessionBlocks = Object.values(wo?.cardioSessions || {})
    .filter((c) => c && ((parseFloat(c.miles) || 0) > 0 || String(c.time || "").trim() !== ""));
  if (sessionBlocks.length) return sessionBlocks;
  return wo?.cardio ? [wo.cardio] : [];
}

export function computeSessionLoad(dayData) {
  const empty = {
    volume: 0, rpe: 0, sessionRpe: 0, rpeEstimated: true,
    durationMin: 0, liftingMin: 0, cardioMin: 0,
    load: 0, exerciseCount: 0, cardioMiles: 0, hasWorkout: false,
  };
  if (!dayData || !dayData.workout) return empty;
  const wo = dayData.workout;

  let volume = 0, exerciseCount = 0, doneSets = 0;
  for (const exData of Object.values(wo.exercises || {})) {
    if (!exData || !exData.sets) continue;
    let exVolume = 0, setCount = 0;
    for (const set of exData.sets) {
      if (!set.done) continue;
      const weight = parseFloat(set.weight) || 0;
      const reps = parseFloat(set.reps) || 0;
      exVolume += weight * reps;
      setCount++;
    }
    if (setCount > 0) { volume += exVolume; exerciseCount++; doneSets += setCount; }
  }

  const cardioBlocks = getLoggedCardioBlocks(wo);
  const cardioMiles = cardioBlocks.reduce((sum, c) => sum + (parseFloat(c?.miles) || 0), 0);
  const hasLift = exerciseCount > 0;
  const hasWorkout = hasLift || cardioMiles > 0;
  if (!hasWorkout) return empty;

  // Duration = the common currency. Lifting time from set count; running time
  // from distance × pace. Summed, both modalities contribute on equal footing.
  const liftingMin = doneSets * MIN_PER_SET;
  const cardioMin = cardioBlocks.reduce((sum, c) => {
    const miles = parseFloat(c?.miles) || 0;
    if (miles <= 0) return sum;
    const paceSec = paceToSecPerMile(c?.pace) || DEFAULT_PACE_SEC;
    return sum + (miles * paceSec) / 60;
  }, 0);
  const durationMin = liftingMin + cardioMin;

  const { rpe: sessionRpe, estimated } = resolveSessionRpe(wo, hasLift);
  // Internal load in arbitrary units. ACWR is invariant to this scale, so there
  // are no magic normalization constants here — it is literally RPE × minutes.
  const load = Math.round(sessionRpe * durationMin);

  return {
    volume: Math.round(volume),
    rpe: sessionRpe,
    sessionRpe,
    rpeEstimated: estimated,
    durationMin: Math.round(durationMin),
    liftingMin: Math.round(liftingMin),
    cardioMin: Math.round(cardioMin),
    load,
    exerciseCount,
    cardioMiles,
    cardioSessionCount: cardioBlocks.length,
    hasWorkout,
  };
}

// Exponentially-weighted moving average over an oldest→newest series.
function ewma(seriesOldestFirst, N) {
  if (!seriesOldestFirst.length) return 0;
  const lambda = 2 / (N + 1);
  let e = seriesOldestFirst[0];
  for (let i = 1; i < seriesOldestFirst.length; i++) {
    e = seriesOldestFirst[i] * lambda + e * (1 - lambda);
  }
  return e;
}

// Sample standard deviation (Bessel's correction, N-1). Consistent with
// oura/statistics.js — the original popStdDev (N) slightly understated
// monotony for 7-day windows, making the >2.0 flag harder to trigger.
function sampleStdDev(vals) {
  if (!vals || vals.length < 2) return 0;
  const m = vals.reduce((a, b) => a + b, 0) / vals.length;
  return Math.sqrt(vals.reduce((s, v) => s + (v - m) * (v - m), 0) / (vals.length - 1));
}

// dailyLoads is expected most-recent-first (index 0 = today), dense over calendar
// days (rest days present as load 0). See buildDailyLoads.
export function computeRollingLoads(dailyLoads) {
  const insufficient = {
    acute: 0, chronic: 0, ratio: 0, zone: "insufficient_data",
    trend: "insufficient data", monotony: 0, strain: 0, model: "ewma", daysOfData: 0,
  };
  if (!dailyLoads || dailyLoads.length === 0) return insufficient;

  const loads = dailyLoads.map(d => d.load || 0); // most-recent-first
  const nonZero = loads.filter(l => l > 0).length;

  // ACWR needs a real training history. With a dense calendar series the array
  // length is always full, so the meaningful gate is the count of actual
  // sessions in the window, not the array length.
  if (loads.length < 14 || nonZero < 6) return { ...insufficient, daysOfData: loads.length };

  const oldestFirst = [...loads].reverse();
  const acute = ewma(oldestFirst, 7);
  const chronic = ewma(oldestFirst, 28);
  if (chronic <= 0) return { ...insufficient, daysOfData: loads.length };

  const ratio = acute / chronic;
  let zone;
  if (ratio < 0.8) zone = "undertraining";
  else if (ratio <= 1.3) zone = "optimal";
  else if (ratio <= 1.5) zone = "overreaching";
  else zone = "high_risk";

  // Monotony & strain over the most recent 7 days (Foster).
  const week = loads.slice(0, 7);
  const weekSum = week.reduce((a, b) => a + b, 0);
  const weekMean = weekSum / (week.length || 1);
  const weekSd = sampleStdDev(week);
  const monotony = weekSd > 0 ? weekMean / weekSd : 0;
  const strain = Math.round(weekSum * monotony);

  // Week-over-week trend (disjoint weeks).
  const wk2 = loads.slice(7, 14);
  const m1 = weekMean;
  const m2 = wk2.length ? wk2.reduce((a, b) => a + b, 0) / wk2.length : m1;
  const trend = m1 > m2 * 1.1 ? "increasing" : m1 < m2 * 0.9 ? "decreasing" : "stable";

  return {
    acute: Math.round(acute * 10) / 10,
    chronic: Math.round(chronic * 10) / 10,
    ratio: Math.round(ratio * 100) / 100,
    zone,
    trend,
    monotony: Math.round(monotony * 100) / 100,
    strain,
    model: "ewma",
    daysOfData: loads.length,
  };
}

export function getLoadZoneInfo(zone) {
  const map = {
    undertraining: { label: "Undertraining", description: "Load below chronic baseline. Fitness may be detraining.", recommendation: "Safe to increase volume or intensity if recovery allows." },
    optimal: { label: "Optimal Load", description: "Load in the sweet spot — stimulating adaptation without excessive risk.", recommendation: "Continue current programming. Monitor recovery markers." },
    overreaching: { label: "Overreaching", description: "Load elevated above chronic baseline. Risk of non-functional overreaching if sustained.", recommendation: "Reduce volume or intensity within 1-2 weeks. Prioritize recovery." },
    high_risk: { label: "High Risk", description: "Acute load significantly above chronic. Injury risk elevated.", recommendation: "Deload immediately. Focus on sleep, nutrition, and stress management." },
    insufficient_data: { label: "Insufficient Data", description: "Need ~2-3 weeks of logged sessions to model load.", recommendation: "Log workouts consistently to enable load tracking." },
  };
  return map[zone] || map.insufficient_data;
}

// Build a DENSE daily series over real calendar days ending at `asOf` (default
// today), most-recent-first. Unlogged days are included as load 0 (rest), which
// is required for a correct acute:chronic ratio — skipping rest days inflates it.
export function buildDailyLoads(data, maxDays = 28, asOf = null) {
  if (!data) return [];
  const end = asOf
    ? new Date(typeof asOf === "string" ? `${asOf}T12:00:00` : asOf)
    : new Date();
  const out = [];
  for (let i = 0; i < maxDays; i++) {
    const d = new Date(end);
    d.setDate(end.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    out.push({ date: key, ...computeSessionLoad(data[key]) });
  }
  return out;
}

export default { computeSessionLoad, computeRollingLoads, getLoadZoneInfo, buildDailyLoads };


// Unlogged-load sentinel
// A day with high Whoop strain and ZERO logged load is invisible to the ACWR
// — the chronic denominator quietly understates and the verdict can
// green-light onto hidden fatigue. This flags such days as a data-quality
// note; it deliberately does NOT inject synthetic sRPE (wearables suggest).
// Threshold is personal: the median Whoop strain of days the athlete DID log
// (≥5 samples), floored at 10 so easy days never flag; absolute fallback 14
// (a genuinely hard Whoop day) when history is thin.
export function findUnloggedLoadDays(dailyLoads, whoopGrouped, { window = 14, stravaByDate = null } = {}) {
  // Strava joins as a second evidence rung: on days Whoop has nothing
  // (device off), a synced run ≥ ~3mi with zero logged load still flags. One
  // flag per day; Whoop's strain detail wins when both report.
  if (!Array.isArray(dailyLoads) || (!whoopGrouped && !stravaByDate)) return [];
  const strainOf = (date) => {
    const v = whoopGrouped?.[date]?.cycle?.score?.strain;
    return Number.isFinite(v) ? v : null;
  };
  const loggedStrains = dailyLoads
    .filter((d) => (d.load || 0) > 0)
    .map((d) => strainOf(d.date))
    .filter((v) => v !== null);
  const median = (xs) => {
    const a = [...xs].sort((x, y) => x - y);
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  };
  const threshold = loggedStrains.length >= 5 ? Math.max(10, median(loggedStrains)) : 14;
  const flags = [];
  for (const d of dailyLoads.slice(0, window)) {
    if ((d.load || 0) > 0) continue;
    const strain = strainOf(d.date);
    if (strain !== null && strain >= threshold) {
      flags.push({ date: d.date, source: "whoop", strain: Number(strain.toFixed(1)), threshold: Number(threshold.toFixed(1)) });
      continue;
    }
    const acts = stravaByDate?.[d.date];
    if (Array.isArray(acts) && acts.length) {
      const meters = acts.reduce((a, x) => a + (Number(x.distance_m ?? x.distance) || 0), 0);
      if (meters >= 4800) flags.push({ date: d.date, source: "strava", miles: Number((meters / 1609.34).toFixed(1)) });
    }
  }
  return flags;
}
