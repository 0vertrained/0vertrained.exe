// src/todayDecision.js
// Pure helper that builds a decision card summary from readiness, recovery,
// load, program, fuel, and manual check-in. Turns the daily inputs into one
// clear, actionable call without side effects, network, or medical claims.
//
// Today Coach V2 (version: 2) adds do/avoid/watch guidance, a primary action,
// source transparency badges, and explicit risk while preserving every v1
// field (call, title, subtitle, trainingAction, fuelAction, reasons, risk,
// confidence, programLabel) so existing UI and tests keep working.
import { summarizeProgramDay } from "./programSummary";

// Call ranking, most-conservative first. Used to "cap" a call so a manual
// override (illness, high soreness) can only ever move the call toward rest,
// never toward more training.
const CALL_RANK = { recover: 0, modify: 1, maintain: 2, push: 3 };
const RANK_CALL = ["recover", "modify", "maintain", "push"];
const capCall = (call, maxCall) =>
  RANK_CALL[Math.min(CALL_RANK[call] ?? 2, CALL_RANK[maxCall] ?? 2)];

const RISK_RANK = { Low: 0, Medium: 1, High: 2 };
const RANK_RISK = ["Low", "Medium", "High"];
const raiseRisk = (risk, floor) =>
  RANK_RISK[Math.max(RISK_RANK[risk] ?? 0, RISK_RANK[floor] ?? 0)];

const num = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

// De-duplicate falsy-safe and cap list length so the mobile card stays compact.
const uniqCap = (arr, max = 4) => {
  const seen = new Set();
  const out = [];
  for (const s of arr) {
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
};

// Resolve a usable ACWR ratio from either the rolling-load model or nothing.
// Insufficient-data / non-positive ratios are treated as missing so the card
// never asserts a load number it does not really have.
function resolveAcwr(trainingLoad) {
  if (!trainingLoad) return null;
  if (trainingLoad.zone === "insufficient_data") return null;
  const ratio = num(trainingLoad.ratio ?? trainingLoad.acwr);
  return ratio !== null && ratio > 0 ? ratio : null;
}

const TITLE = {
  recover: "Rest & recover",
  modify: "Train modified",
  maintain: "Train as planned",
  push: "Push hard today",
};
const SUBTITLE = {
  recover: "Let recovery complete before the next hard session.",
  modify: "Keep intensity in check. Focus on quality over volume.",
  maintain: "Normal training load. Stay consistent.",
  push: "You're ready for a strong effort today.",
};
const PRIMARY = {
  recover: "Take a recovery day — rest, mobility, or an easy walk.",
  modify: "Train, but scale volume and intensity back.",
  maintain: "Run your planned session at controlled effort.",
  push: "Run your planned session and push the top sets.",
};

function isRestProgramDay(programSummary) {
  return !programSummary?.hasLifting && !programSummary?.hasCardio && /rest|mobility|off/i.test(programSummary?.label || "");
}

/**
 * Build a structured Today decision from component inputs.
 * @param {object} options - recommendation, recovery, nutrition, goals,
 *   todayProgram, fuelNeeds, trainingLoad, manualBody, adaptiveSuggestion.
 * @returns {object} Decision card (version 2) with call, guidance lists,
 *   confidence, risk, source badges, and reasoning.
 */
export function buildTodayDecision({
  recommendation = null,
  recovery = null,
  nutrition = null, // reserved for future fuel context; kept for signature stability
  goals = {},
  todayProgram = null,
  fuelNeeds = null,
  trainingLoad = null,
  manualBody = null,
  adaptiveSuggestion = null,
  conflicts = null,
  aggregatedConfidence = null,
} = {}) {
  const programSummary = summarizeProgramDay(todayProgram);
  const programLabel = todayProgram ? programSummary.label : null;
  const isRestDay = isRestProgramDay(programSummary);

  if (!recommendation) {
    return {
      version: 2,
      call: "maintain",
      title: "Plan ahead",
      subtitle: "Log recovery and fuel to sharpen today's call.",
      primaryAction: "Check in with sleep, soreness, and energy to get a real call.",
      trainingAction: null,
      fuelAction: null,
      doList: ["Log a quick check-in so tomorrow's call is grounded in your data."],
      avoidList: [],
      watchList: ["Limited data — treat today as a soft, conservative call."],
      reasons: ["Missing readiness data — check in to improve suggestions."],
      sourceBadges: ["Limited data"],
      confidence: "low",
      risk: "Low",
      programLabel,
      responsePrompt: "Did you follow today's call?",
    };
  }

  const readiness = recommendation.readiness || "normal";
  const recoveryScore = recovery?.score ?? null;
  const hasRecovery = recoveryScore !== null;
  const recoverySource = recovery?.source === "oura" ? "oura" : "subjective";
  const hasProgram = todayProgram !== null;
  const programName = programLabel || "your planned session";

  const acwr = resolveAcwr(trainingLoad);
  const monotony = num(trainingLoad?.monotony);
  const soreness = num(manualBody?.soreness);
  const illness = Boolean(manualBody?.illnessOrInjury);

  const highLoad = acwr !== null && acwr > 1.3;
  const veryHighLoad = acwr !== null && acwr > 1.5;
  const highMonotony = monotony !== null && monotony > 2;
  const suppressedRecovery = hasRecovery && recoveryScore < 55;
  const strongRecovery = hasRecovery && recoveryScore >= 70;

  // ── Base call from the readiness band ──────────────────────────────────────
  let call = "maintain";
  let trainingAction = null;
  let risk = "Low";

  if (readiness === "rest") {
    call = "recover";
    risk = "Medium";
    trainingAction = "Skip intense training today. Prioritize sleep, mobility, and stress management.";
  } else if (readiness === "pull_back") {
    call = "modify";
    risk = "Medium";
    trainingAction = "Reduce volume or intensity. Keep lifts light and avoid extra conditioning.";
  } else if (readiness === "moderate") {
    call = "maintain";
    trainingAction = "Train as planned but monitor fatigue. Avoid unnecessary volume additions.";
  } else if (readiness === "normal") {
    call = "maintain";
    trainingAction = hasProgram ? "Keep your planned session." : "Training as normal.";
  } else if (readiness === "push") {
    call = "push";
    trainingAction = hasProgram ? "Push intensity today — you're well-recovered." : "Good energy for a strong session.";
  }

  // High readiness on a programmed rest day means recovery is available, not
  // that the UI should contradict the plan and tell the athlete to push hard.
  let restDayNote = null;
  if (isRestDay && (call === "push" || call === "maintain")) {
    call = "maintain";
    trainingAction = "Keep the rest day. Bank recovery; add only easy mobility or a walk if you want movement.";
    restDayNote = "Programmed rest day — high readiness means recovery is available, not required extra intensity.";
  }

  // ── Manual overrides — a self-reported red flag conservatively caps the call
  //    regardless of biometric optimism. It can only pull toward rest. ────────
  let overrideNote = null;
  if (illness) {
    call = capCall(call, "modify");
    risk = raiseRisk(risk, "High");
    overrideNote = "Illness/injury flagged — readiness is capped regardless of biometrics.";
  }
  if (soreness !== null && soreness >= 8) {
    call = capCall(call, "modify");
    risk = raiseRisk(risk, "Medium");
    if (!overrideNote) overrideNote = `High soreness (${soreness}/10) — pulling the call back.`;
  } else if (soreness !== null && soreness >= 7) {
    call = capCall(call, "maintain");
    if (!overrideNote) overrideNote = `Elevated soreness (${soreness}/10) — no hard pushing today.`;
  }

  // ── Mixed-signal (wearable conflict) bias — when Oura and Whoop disagree
  //    on the same metric, bias the call toward caution. A major conflict caps at
  //    "modify"; a minor one only holds back a "push". Never pushes toward more
  //    training. Manual overrides above still take precedence in the subtitle. ──
  const conflictList = Array.isArray(conflicts) ? conflicts : [];
  const hasMajorConflict = conflictList.some((c) => c?.severity === "major");
  if (conflictList.length) {
    call = capCall(call, hasMajorConflict ? "modify" : "maintain");
    risk = raiseRisk(risk, "Medium");
    if (!overrideNote) {
      overrideNote = "Mixed signal day — wearables disagree, using a conservative recommendation.";
    }
  }

  // ── Load-driven risk floors ────────────────────────────────────────────────
  if (veryHighLoad) risk = raiseRisk(risk, "High");
  else if (highLoad) risk = raiseRisk(risk, "Medium");

  // ── Fuel — support both the planning shape (stillNeed*) and the live app
  //    helper shape from computeStillNeeded() (calories/protein). ─────────────
  let fuelAction = null;
  let fuelGap = false;
  if (fuelNeeds) {
    const calGap = typeof fuelNeeds.stillNeedCalories === "number" ? fuelNeeds.stillNeedCalories : fuelNeeds.calories;
    const proteinGap = typeof fuelNeeds.stillNeedProtein === "number" ? fuelNeeds.stillNeedProtein : (fuelNeeds.protein || 0);
    if (calGap > 300 || proteinGap > 30) {
      fuelGap = true;
      fuelAction = `Add ${Math.round(calGap)}kcal${proteinGap > 0 ? ` and ${Math.round(proteinGap)}g protein` : ""} before bed.`;
    }
  }

  // ── Do / Avoid / Watch guidance ────────────────────────────────────────────
  const doList = [];
  const avoidList = [];
  const watchList = [];

  if (call === "push") {
    doList.push(hasProgram ? `Run ${programName} and take top sets to a strong RPE 8–9.` : "Warm up well, then push a quality session.");
    avoidList.push("Don't add junk volume beyond the plan.");
  } else if (call === "maintain") {
    doList.push(isRestDay ? "Keep the rest day; use easy mobility, walking, or complete rest." : hasProgram ? `Run ${programName} at your planned effort.` : "Train as normal at a controlled effort.");
    avoidList.push(isRestDay ? "Avoid turning a recovery day into an extra workout just because readiness is high." : "Avoid adding unplanned volume or extra conditioning.");
  } else if (call === "modify") {
    doList.push("Cut volume ~25–40% and keep intensity moderate (cap top sets near RPE 7).");
    avoidList.push("Skip finishers, hard intervals, and max-effort sets.");
  } else if (call === "recover") {
    doList.push("Prioritize sleep, easy movement, and mobility.");
    avoidList.push("No intense training or heavy loading today.");
  }

  // Fuel guidance surfaces in both the dedicated field and the do-list.
  if (fuelGap && fuelAction) doList.push(`Close your fuel gap: ${fuelAction}`);

  // Load-specific caution regardless of call (unless already fully resting).
  if (highLoad && call !== "recover") {
    avoidList.push("Avoid hard intervals or max sets — acute load is already elevated.");
  }
  if (illness) avoidList.push("Don't train through illness or injury.");

  // Watch signals — the things to monitor mid-session.
  if (illness) watchList.push("Illness/injury flagged — keep effort easy and reassess.");
  if (soreness !== null && soreness >= 5) watchList.push(`Soreness ${soreness}/10 — stop if it worsens.`);
  if (suppressedRecovery && call !== "recover") watchList.push("Recovery is suppressed — cut it short if warm-ups feel flat.");
  if (highLoad && call !== "recover") watchList.push(`Acute load elevated (ACWR ${acwr.toFixed(2)}) — back off if fatigue spikes.`);
  if (highMonotony) watchList.push(`Training monotony is high (${monotony.toFixed(2)}) — vary hard and easy days.`);
  const lowConfidence = String(recommendation.confidence).toLowerCase() === "low";
  const missingData = Array.isArray(recommendation.missingData) ? recommendation.missingData : [];
  if (lowConfidence || missingData.length > 0) {
    watchList.push("Limited data — treat this as a soft call until you log more.");
  }
  if (conflictList.length) {
    watchList.push("Mixed signal day — conservative recommendation until wearables agree.");
  }

  // ── Reasons ────────────────────────────────────────────────────────────────
  const reasons = [];
  if (hasRecovery) {
    reasons.push(`Recovery ${recoveryScore}/100 via ${recoverySource === "oura" ? "Oura" : "check-in"}`);
  }
  // Name the limiting factor explicitly when recovery looks good but the call
  // was still held back by load — the "why isn't this a push?" answer.
  if (strongRecovery && highLoad && (call === "maintain" || call === "modify")) {
    reasons.push(`Load is the limiter: ACWR ${acwr.toFixed(2)} is above the productive range.`);
  }
  if (overrideNote) reasons.push(overrideNote);
  if (restDayNote) reasons.push(restDayNote);
  if (Array.isArray(recommendation.reasons)) {
    recommendation.reasons.slice(0, 3).forEach((r) => {
      if (r && r.label && r.detail) reasons.push(`${r.label}: ${r.detail}`);
    });
  }

  // ── Source transparency badges ─────────────────────────────────────────────
  const sourceBadges = [];
  if (hasRecovery) sourceBadges.push(recoverySource === "oura" ? "Oura" : "Check-in");
  if (acwr !== null) sourceBadges.push("Load");
  if (hasProgram) sourceBadges.push("Program");
  if (soreness !== null || illness) sourceBadges.push("Manual check-in");
  if (conflictList.length) sourceBadges.push("Mixed signal");
  if (missingData.length > 0) sourceBadges.push("Limited data");

  const confidence = [ "low", "medium", "high" ].includes(String(recommendation.confidence))
    ? recommendation.confidence
    : "medium";
  // Aggregated confidence from the wearable aggregation model. It is
  // only ever a floor (can lower, never raise). When conflicts/fallbacks/missing
  // metrics lower it, that floor wins over the decision engine's confidence.
  const AGG_ORDER = { low: 0, medium: 1, high: 2 };
  const aggConf = String(aggregatedConfidence).toLowerCase();
  const finalConfidence = (AGG_ORDER[aggConf] !== undefined && AGG_ORDER[aggConf] < AGG_ORDER[confidence])
    ? aggConf
    : confidence;

  // Subtitle: prefer the manual-override explanation so the limiting factor is
  // never hidden behind a rosy biometric line.
  const subtitle = overrideNote || (isRestDay && call === "maintain" ? "Recovery is available. Keep the planned rest day unless you intentionally choose easy movement." : SUBTITLE[call] || SUBTITLE.maintain);

  return {
    version: 2,
    call,
    title: isRestDay && call === "maintain" ? "Recovery day" : TITLE[call] || TITLE.maintain,
    subtitle,
    primaryAction: isRestDay && call === "maintain" ? "Keep the rest day — mobility, walking, or full rest." : PRIMARY[call] || PRIMARY.maintain,
    trainingAction,
    fuelAction,
    doList: uniqCap(doList),
    avoidList: uniqCap(avoidList),
    watchList: uniqCap(watchList),
    reasons: uniqCap(reasons, 4),
    sourceBadges: uniqCap(sourceBadges, 5),
    confidence: finalConfidence,
    risk,
    programLabel,
    responsePrompt: "Did you follow today's call?",
  };
}

/**
 * Validate a decision response ("followed", "modified", "ignored", "skipped").
 * @param {string} response - The user's response to the decision
 * @returns {boolean} True if valid
 */
export function isValidDecisionResponse(response) {
  return ["followed", "modified", "ignored", "skipped"].includes(response);
}

/**
 * Build a decision response entry for storage under todayData.intelligence.todayDecisionResponse.
 * @param {string} decisionCall - The decision's call ("recover", "modify", "maintain", "push")
 * @param {string} response - User response ("followed", "modified", "ignored", "skipped")
 * @returns {object} Record to store
 */
export function buildDecisionResponseEntry(decisionCall, response) {
  if (!isValidDecisionResponse(response)) {
    throw new Error(`Invalid decision response: ${response}`);
  }
  return {
    version: 1,
    decisionCall,
    response,
    recordedAt: new Date().toISOString(),
  };
}
