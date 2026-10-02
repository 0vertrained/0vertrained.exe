// src/periodizationPlanner.js
// Suggest-only periodization planner. Pure module: no React, no network, no writes.

import { ACWR_ZONES, MONOTONY_FLAG } from "./intelligenceConfig";

const DAY_MS = 24 * 60 * 60 * 1000;
const n = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

function isoDate(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

function daysBetween(start, end) {
  const s = new Date(`${start}T12:00:00`);
  const e = new Date(`${end}T12:00:00`);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return 0;
  return Math.floor((e - s) / DAY_MS);
}

function inferStartDate(entries = {}) {
  const keys = Object.keys(entries || {}).sort();
  return keys[0] || isoDate(new Date());
}

function analyzeProgram(program = {}) {
  const days = Object.values(program || {});
  const liftingDays = days.filter(d => Array.isArray(d?.lifting) && d.lifting.length > 0).length;
  const runDays = days.filter(d => d?.cardio).length;
  const hardDays = days.filter(d => /interval|tempo|hyrox|high|speed/i.test([d?.type, d?.code, d?.cardio?.type, d?.cardio?.effort].join(" "))).length;
  const longRunDays = days.filter(d => n(d?.cardio?.miles) >= 6 || /long/i.test([d?.type, d?.cardio?.type].join(" "))).length;
  const weeklyMiles = days.reduce((acc, d) => acc + n(d?.cardio?.miles), 0);
  return { liftingDays, runDays, hardDays, longRunDays, weeklyMiles: Number(weeklyMiles.toFixed(1)) };
}

function entryHasTraining(entry) {
  return Object.keys(entry?.workout?.exercises || {}).length > 0 || n(entry?.workout?.cardio?.miles) > 0;
}

function recentTrainingDensity(entries = {}, todayKey = isoDate(new Date()), windowDays = 7) {
  let count = 0;
  let miles = 0;
  let lowSleep = 0;
  for (const [date, entry] of Object.entries(entries || {})) {
    const age = daysBetween(date, todayKey);
    if (age < 0 || age >= windowDays) continue;
    if (entryHasTraining(entry)) count += 1;
    miles += n(entry?.workout?.cardio?.miles);
    const sleep = n(entry?.body?.sleep);
    if (sleep > 0 && sleep < 6.5) lowSleep += 1;
  }
  return { trainingDays: count, miles: Number(miles.toFixed(1)), lowSleepDays: lowSleep };
}

function rollBlockStartForward(blockStart, todayKey, blockLengthWeeks) {
  if (!todayKey) return blockStart;
  const blockDays = blockLengthWeeks * 7;
  let start = blockStart;
  let guard = 0;
  while (daysBetween(start, todayKey) >= blockDays && guard < 50) {
    start = addDays(start, blockDays);
    guard += 1;
  }
  return start;
}

export function buildPeriodizationPlan({ startDate = null, todayKey = null, program = {}, entries = {}, blockLengthWeeks = 4, blockName = "Current Block", goal = "Build capacity while managing fatigue", deloadWeek = null, runEmphasis = "maintain", strengthEmphasis = "maintain" } = {}) {
  const safeLength = Math.max(4, Math.min(8, Math.round(n(blockLengthWeeks) || 4)));
  const safeDeloadWeek = Math.max(1, Math.min(safeLength, Math.round(n(deloadWeek) || safeLength)));
  const initialStart = startDate || inferStartDate(entries);
  const blockStart = rollBlockStartForward(initialStart, todayKey, safeLength);
  const resolvedToday = todayKey || isoDate(new Date());
  const programAnalysis = analyzeProgram(program);
  const template = [
    { focus: "base", intensity: "moderate", volumeMultiplier: 1.0, label: "Base / accumulation" },
    { focus: "build", intensity: "moderate-high", volumeMultiplier: 1.08, label: "Build volume" },
    { focus: "intensify", intensity: "high", volumeMultiplier: 1.03, label: "Intensify" },
    { focus: "deload", intensity: "low", volumeMultiplier: 0.65, label: "Deload / absorb" },
  ];
  const weeks = Array.from({ length: safeLength }, (_, idx) => {
    const weekNumber = idx + 1;
    const baseTemplate = template[Math.min(idx, template.length - 2)] || template[0];
    const t = weekNumber === safeDeloadWeek ? template[3] : baseTemplate;
    const weekStart = addDays(blockStart, idx * 7);
    const weekEnd = addDays(weekStart, 6);
    const status = weekEnd < resolvedToday
      ? "completed"
      : (resolvedToday >= weekStart && resolvedToday <= weekEnd ? "current" : "upcoming");
    return {
      weekNumber,
      startDate: weekStart,
      endDate: weekEnd,
      focus: t.focus,
      label: t.label,
      intensity: t.intensity,
      volumeMultiplier: t.volumeMultiplier,
      targetMiles: Number((programAnalysis.weeklyMiles * t.volumeMultiplier).toFixed(1)),
      status,
      guidance: t.focus === "deload"
        ? "Reduce volume 30–40%, keep movement quality, and avoid max-effort work."
        : t.focus === "intensify"
          ? "Keep volume controlled and make quality work count."
          : t.focus === "build"
            ? "Add small volume only if recovery stays stable."
            : "Establish repeatable training rhythm before chasing load.",
    };
  });

  const endDate = weeks[weeks.length - 1]?.endDate || blockStart;
  const currentWeek = weeks.find(w => resolvedToday >= w.startDate && resolvedToday <= w.endDate);
  const currentWeekNumber = currentWeek
    ? currentWeek.weekNumber
    : (resolvedToday < weeks[0].startDate ? 1 : safeLength);
  const completionPct = Math.max(0, Math.min(100, Math.round((currentWeekNumber / safeLength) * 100)));
  const emphasis = {
    run: ["reduce", "maintain", "build"].includes(runEmphasis) ? runEmphasis : "maintain",
    strength: ["deload", "maintain", "build"].includes(strengthEmphasis) ? strengthEmphasis : "maintain",
  };
  const labelForCurrent = (currentWeek || weeks[0])?.label || "base";
  const summary = `Week ${currentWeekNumber}/${safeLength} · ${labelForCurrent} · Deload W${safeDeloadWeek}`;

  return {
    name: blockName || "Current Block",
    goal: goal || "Build capacity while managing fatigue",
    deloadWeek: safeDeloadWeek,
    startDate: blockStart,
    endDate,
    blockLengthWeeks: safeLength,
    currentWeekNumber,
    completionPct,
    summary,
    emphasis,
    programAnalysis,
    weeks,
  };
}

export function getCurrentBlock(plan, todayKey = isoDate(new Date())) {
  const fallback = plan?.weeks?.[0] || null;
  if (!plan?.weeks?.length) return null;
  return plan.weeks.find(w => todayKey >= w.startDate && todayKey <= w.endDate) || fallback;
}

export function suggestPeriodizationAction({ plan, todayKey = isoDate(new Date()), recommendation = null, entries = {}, trainingLoad = null } = {}) {
  const current = getCurrentBlock(plan, todayKey) || buildPeriodizationPlan({ entries }).weeks[0];
  const density = recentTrainingDensity(entries, todayKey, 7);
  const readiness = recommendation?.readiness || "normal";

  // Autoregulation signals from the load model (when available). High load can
  // trigger a deload before the calendar says to; elevated load blocks progression.
  const acwr = (trainingLoad && trainingLoad.zone !== "insufficient_data") ? (trainingLoad.ratio ?? null) : null;
  const monotony = trainingLoad?.monotony ?? null;
  const highLoad = !!trainingLoad && (trainingLoad.zone === "high_risk" || (acwr !== null && acwr > ACWR_ZONES.overreachMax));
  const elevatedLoad = !!trainingLoad && (trainingLoad.zone === "overreaching" || (acwr !== null && acwr > ACWR_ZONES.optimalMax) || (monotony !== null && monotony > MONOTONY_FLAG));

  const suggestedChanges = [];
  let action = "hold";
  let risk = "low";
  let title = "Hold the block";
  let rationale = "Keep executing the current week and watch the recovery signal.";

  if ((readiness === "rest" || readiness === "pull_back") && (density.trainingDays >= 4 || density.lowSleepDays >= 2 || current.focus === "intensify")) {
    action = "deload_now";
    risk = "high";
    title = "Deload now";
    rationale = "Readiness is suppressed while recent training density is high. Absorb the work before adding more.";
    suggestedChanges.push({ type: "volume", label: "Reduce total work 30–40% for 3–7 days" });
    suggestedChanges.push({ type: "intensity", label: "Remove intervals, finishers, and max-effort sets" });
  } else if (highLoad) {
    action = "deload_now";
    risk = "high";
    title = "Autoregulated deload";
    rationale = `Acute load is well above your chronic baseline (ACWR ${acwr !== null ? acwr.toFixed(2) : "high"}). Pull back now rather than waiting for the scheduled deload.`;
    suggestedChanges.push({ type: "volume", label: "Reduce total work 30–40% for 3–7 days" });
    suggestedChanges.push({ type: "intensity", label: "Drop the hardest session this week to easy aerobic work" });
  } else if (current.focus === "deload") {
    action = "deload";
    risk = readiness === "push" ? "low" : "medium";
    title = "Respect the deload";
    rationale = "This week is already programmed as an absorption week.";
    suggestedChanges.push({ type: "volume", label: "Keep volume near 60–70% of normal" });
  } else if (readiness === "push" && !elevatedLoad && (current.focus === "build" || current.focus === "base")) {
    action = "progress";
    risk = "low";
    title = "Progress carefully";
    rationale = "Readiness supports a small progression inside the current block.";
    suggestedChanges.push({ type: "progression", label: "Add one small progression: +1 rep, +5 lb, or +0.25–0.5 mi — not all three" });
  } else if (readiness === "push" && elevatedLoad && (current.focus === "build" || current.focus === "base")) {
    action = "maintain";
    risk = "medium";
    title = "Hold, don't progress";
    rationale = "Readiness looks good, but acute load is already elevated — bank the fitness before adding more.";
    suggestedChanges.push({ type: "guardrail", label: "Keep planned work; skip new progressions until load settles" });
  } else if (readiness === "moderate") {
    action = "maintain";
    risk = "medium";
    title = "Maintain the block";
    rationale = "Training can continue, but this is not a good day to force progression.";
    suggestedChanges.push({ type: "guardrail", label: "Keep planned work but cap hard sets around RPE 7" });
  } else {
    suggestedChanges.push({ type: "execution", label: "Run the current week as written" });
  }

  return { action, risk, title, rationale, currentWeek: current, density, suggestedChanges };
}

export default { buildPeriodizationPlan, getCurrentBlock, suggestPeriodizationAction };
