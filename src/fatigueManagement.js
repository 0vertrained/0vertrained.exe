// src/fatigueManagement.js
// Multi-signal fatigue and deload guidance.
// A single poor metric never triggers a deload. Safety flags bypass training
// optimization entirely and defer to the athlete's clinician-defined plan.

import { buildVolumeReport } from "./muscleVolume";
import { buildStrengthRetentionAlert } from "./progressionEngine";

const DAY_MS = 86400000;

function n(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mean(values) {
  const clean = values.filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null;
}

function daysBetween(a, b) {
  return Math.round((new Date(`${a}T12:00:00`) - new Date(`${b}T12:00:00`)) / DAY_MS);
}

function recentEntries(data, todayKey, days) {
  return Object.keys(data || {})
    .filter((key) => key <= todayKey && daysBetween(todayKey, key) < days)
    .sort()
    .map((key) => ({ date: key, ...(data[key] || {}) }));
}

function previousEntries(data, todayKey, minDaysAgo, maxDaysAgo) {
  return Object.keys(data || {})
    .filter((key) => {
      const days = daysBetween(todayKey, key);
      return days >= minDaysAgo && days <= maxDaysAgo;
    })
    .sort()
    .map((key) => ({ date: key, ...(data[key] || {}) }));
}

function safetyLanguage(body = {}, safetyFlag = false, workout = {}) {
  const note = `${body?.notes || ""} ${workout?.notes || ""}`.toLowerCase();
  const concerningText = /(chest pain|chest pressure|faint|fainted|syncope|unusual shortness of breath|palpitation)/i.test(note);
  return Boolean(safetyFlag || body?.illnessOrInjury || body?.illness || body?.injury || concerningText);
}

function setQualitySignal(entries) {
  let total = 0;
  let hard = 0;
  let fatigueSkips = 0;
  for (const entry of entries) {
    for (const exercise of Object.values(entry?.workout?.exercises || {})) {
      if (exercise?.skipped === "fatigue") fatigueSkips += 1;
      for (const set of exercise?.sets || []) {
        if (!set?.done) continue;
        total += 1;
        if (set.quality === "grind" || set.quality === "form_break" || Number(set.rir) === 0) hard += 1;
      }
    }
  }
  const hardRatio = total ? hard / total : 0;
  return { total, hard, hardRatio, fatigueSkips };
}

export function buildDeloadRecommendation({ data, todayKey, body = {}, workout = {}, safetyFlag = false } = {}) {
  if (!todayKey) return { status: "none", reasons: [], score: 0 };
  if (safetyLanguage(body, safetyFlag, workout)) {
    return {
      status: "safety",
      score: 100,
      reasons: ["An illness, injury, chest-symptom, faintness, or unusual-limitation flag is active."],
      headline: "Training optimization is paused",
      guidance: "Do not use an app-generated deload as medical clearance. Stop the session and follow your clinician-defined escalation plan.",
      prescription: null,
    };
  }

  const recent = recentEntries(data, todayKey, 7);
  const baseline = previousEntries(data, todayKey, 8, 28);
  const reasons = [];
  let score = 0;

  const sleep = mean(recent.map((entry) => n(entry?.body?.sleep)));
  if (sleep != null && recent.filter((entry) => n(entry?.body?.sleep) != null).length >= 3 && sleep < 6.5) {
    score += 1;
    reasons.push(`Average sleep is ${sleep.toFixed(1)} hours across the recent logged nights.`);
  }

  const soreness = mean(recent.map((entry) => n(entry?.body?.soreness)));
  if (soreness != null && recent.filter((entry) => n(entry?.body?.soreness) != null).length >= 3 && soreness >= 7) {
    score += 1;
    reasons.push(`Soreness is averaging ${soreness.toFixed(1)}/10.`);
  }

  const motivation = mean(recent.map((entry) => n(entry?.body?.motivation)));
  if (motivation != null && recent.filter((entry) => n(entry?.body?.motivation) != null).length >= 3 && motivation <= 4) {
    score += 1;
    reasons.push(`Motivation is averaging ${motivation.toFixed(1)}/10.`);
  }

  const recentRhr = mean(recent.map((entry) => n(entry?.body?.restingHeartRate)));
  const baseRhr = mean(baseline.map((entry) => n(entry?.body?.restingHeartRate)));
  if (recentRhr != null && baseRhr != null && recentRhr - baseRhr >= 7) {
    score += 1;
    reasons.push(`Resting heart rate is about ${Math.round(recentRhr - baseRhr)} bpm above the prior baseline.`);
  }

  const recentHrv = mean(recent.map((entry) => n(entry?.body?.hrv)));
  const baseHrv = mean(baseline.map((entry) => n(entry?.body?.hrv)));
  if (recentHrv != null && baseHrv != null && baseHrv > 0 && recentHrv <= baseHrv * 0.8) {
    score += 1;
    reasons.push(`HRV is roughly ${Math.round((1 - recentHrv / baseHrv) * 100)}% below the prior baseline.`);
  }

  const quality = setQualitySignal(recent);
  if ((quality.total >= 8 && quality.hardRatio >= 0.45) || quality.fatigueSkips >= 2) {
    score += 1;
    reasons.push(quality.fatigueSkips >= 2
      ? `${quality.fatigueSkips} exercises were skipped for fatigue this week.`
      : `${Math.round(quality.hardRatio * 100)}% of recent working sets were grinders, form breaks, or RIR 0.`);
  }

  const volume = buildVolumeReport(data);
  const aboveMrv = volume.ready ? volume.rows.filter((row) => row.status === "above_mrv") : [];
  if (aboveMrv.length > 0) {
    score += 1;
    reasons.push(`${aboveMrv.map((row) => row.label).slice(0, 3).join(", ")} exceeded the weekly recovery ceiling.`);
  }

  const retention = buildStrengthRetentionAlert({ data, todayKey });
  if (retention.status === "watch") {
    score += 1;
    reasons.push(retention.headline);
  } else if (retention.status === "action") {
    score += 2;
    reasons.push(retention.headline);
  }

  const status = score >= 4 && reasons.length >= 3 ? "deload" : score >= 2 ? "watch" : "none";
  if (status === "none") {
    return {
      status,
      score,
      reasons,
      headline: "No deload signal",
      guidance: reasons.length ? "A few fatigue markers are present, but the evidence is not broad enough to change the week." : "Recent data does not support changing the plan.",
      prescription: null,
      retention,
    };
  }

  if (status === "watch") {
    return {
      status,
      score,
      reasons,
      headline: "Fatigue is building — protect the next 48 hours",
      guidance: "Keep main work submaximal, remove optional finishers, and reassess after two normal nights of sleep.",
      prescription: { days: 2, volumeReductionPct: 20, loadPct: 90, targetRir: "3+" },
      retention,
    };
  }

  return {
    status,
    score,
    reasons,
    headline: "Deload recommended from multiple signals",
    guidance: "Reduce work for five days, then resume the prior plan instead of compensating for missed volume.",
    prescription: {
      days: 5,
      volumeReductionPct: 35,
      loadPct: 85,
      targetRir: "3–4",
      removeFinishers: true,
      cardio: "Zone 1–2 only",
    },
    retention,
  };
}

export default { buildDeloadRecommendation };
