// src/recovery/verdictResolver.js
// V13 · Presentation-level action resolver for the Recovery verdict (audit
// Slice C). The dashboard previously rendered the raw training recommendation
// ("PR attempts are allowed…") in one block and a sleep-debt caution in
// another — two surfaces, opposite advice. This module resolves readiness +
// limiters into EXACTLY ONE top-level instruction before anything reaches the
// screen. It is pure and display-only: no scoring is changed, no data is
// mutated, raw values/sources/confidence stay visible in their own sections.
//
// Rules of the resolver:
//   · Limiters can only make the call MORE cautious, never less.
//   · The most severe limiter becomes the visible LimiterRule; the rest stay
//     in the alerts/interpretation sections below.
//   · When a call is demoted, the prescription is REPLACED (not appended to),
//     so no "PR attempts are allowed… but also cap intensity" sentences.

const CALL_ORDER = ["push", "train", "capped", "easy", "recover"];

const LABEL_TO_CALL = {
  push: "push",
  "normal load": "train",
  "moderate load": "capped",
  "pull back": "easy",
  "rest / recovery": "recover",
  "rest recommended": "recover",
};

const num = (v) => {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

// "2.18" hours -> "2h 11m"
export function formatDebtHours(hours) {
  const h = Math.max(0, num(hours));
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  if (mins === 60) return `${whole + 1}h 0m`;
  if (whole === 0) return `${mins}m`;
  return `${whole}h ${mins}m`;
}

function demote(call, floor) {
  // Lower a call to at least `floor` on the caution ladder (never raise it).
  const a = CALL_ORDER.indexOf(call);
  const b = CALL_ORDER.indexOf(floor);
  if (a === -1) return floor;
  return CALL_ORDER[Math.max(a, b)];
}

const COPY = {
  push: {
    stamp: "PUSH",
    headline: "Green light — load the bar.",
    deck: (s) => `Recovery ${s} with clear markers. High-intensity work and PR attempts are on the table if warm-ups move well.`,
  },
  train: {
    stamp: "TRAIN",
    headline: "Run the plan as written.",
    deck: (s) => `Recovery ${s}. Proceed with the planned session — no need to add volume just because the score is good.`,
  },
  capped: {
    stamp: "TRAIN — CAPPED",
    headline: "Train today. Don't chase the PR.",
    deck: () => `Readiness supports training, but a limiter lowers the ceiling — run the planned session as written and skip added volume.`,
  },
  easy: {
    stamp: "EASY",
    headline: "Back off — keep it technical.",
    deck: () => "Reduce top-end intensity or volume today. Favor technique work, easy cardio, and mobility.",
  },
  recover: {
    stamp: "RECOVER",
    headline: "Today is a recovery day.",
    deck: () => "Skip intensity. Sleep, food, hydration, and easy movement are the training.",
  },
};

const RESOLVED_PRESCRIPTION = {
  capped: "Complete the planned session as written — do not add volume or chase a PR today.",
  easy: "Reduce top-end intensity or volume by roughly 10–20%. Favor technical work and zone 2.",
  recover: "Skip maximal work. Use easy movement, mobility, food, and sleep; resume intensity when markers rebound.",
};

/**
 * Resolve readiness + limiters into one verdict for the Recovery hero.
 * @param {object} opts
 * @param {object|null} opts.recommendation - { label, prescription } from
 *   getTrainingRecommendation (post-blend when Whoop is connected).
 * @param {object|null} opts.recovery - { score, band }.
 * @param {object|null} opts.sleepDebt - { debtHours, band }.
 * @param {Array|null} opts.alerts - [{ type, severity }].
 * @param {object|null} opts.trainingLoad - { rolling: { zone } }.
 * @param {object|null} opts.confidence - { level }.
 * @returns {object} { call, stamp, headline, deck, limiter, prescription,
 *   recommendation } — `recommendation` is the input shallow-merged with the
 *   resolved label + prescription so downstream echoes stay consistent.
 */
export function buildRecoveryVerdict({
  recommendation = null,
  recovery = null,
  sleepDebt = null,
  alerts = null,
  trainingLoad = null,
  confidence = null,
  checkin = null, // V16.8 · { severity: 0–3, flags: [] } from checkinMorning
} = {}) {
  const score = recovery && Number.isFinite(Number(recovery.score)) ? Math.round(Number(recovery.score)) : null;
  const baseLabel = String(recommendation?.label || "").trim().toLowerCase();
  let call = LABEL_TO_CALL[baseLabel] || (score === null ? "train" : score >= 85 ? "push" : score >= 70 ? "train" : score >= 55 ? "capped" : score >= 40 ? "easy" : "recover");
  const baseCall = call;

  const alertList = Array.isArray(alerts) ? alerts : [];
  const hasType = (t) => alertList.some((a) => a?.type === t);
  const warningAlerts = alertList.filter((a) => a?.severity === "warning");
  const debt = num(sleepDebt?.debtHours);
  const zone = trainingLoad?.rolling?.zone || null;
  const lowConfidence = String(confidence?.level || "").toLowerCase() === "low";

  // Gather limiters most-severe-first. The first one wins the LimiterRule.
  const limiters = [];

  if (hasType("illness_warning")) {
    call = demote(call, "recover");
    limiters.push({
      key: "illness",
      label: "Limiter · illness markers",
      detail: "Several recovery markers are deviating together. Treat today as recovery regardless of the score.",
    });
  }
  // V16.8 · Morning check-in, caution-only (the doctrine at the top of this
  // file). Two independent rough answers — or an illness/injury flag — demote
  // the call one step. A great check-in never raises it: the subjective row
  // keeps the verdict honest, it doesn't hand out passes. The composite score
  // itself is never modified.
  const checkinSeverity = Math.min(3, Math.max(0, Number(checkin?.severity) || 0));
  if (checkinSeverity >= 2) {
    const flagged = (checkin?.flags || []).includes("illness_or_injury");
    call = demote(call, flagged ? "easy" : call === "push" ? "train" : call === "train" ? "capped" : call);
    limiters.push({
      key: "checkin",
      label: "Limiter · your check-in",
      detail: flagged
        ? "You flagged illness or injury this morning. The plan yields to the body — keep today easy at most."
        : "Two or more rough answers on this morning's check-in. How you feel is data too — the call steps down one notch.",
    });
  }
  if (warningAlerts.some((a) => a?.type !== "illness_warning")) {
    call = demote(call, "easy");
    limiters.push({
      key: "warning",
      label: "Limiter · recovery warning flagged",
      detail: "A warning-level recovery flag surfaced today — see Signals below. Keep intensity down until it clears.",
    });
  }
  if (zone === "high_risk") {
    call = demote(call, "capped");
    limiters.push({
      key: "load",
      label: "Ceiling · acute load high vs baseline",
      detail: "Acute training load is well above your chronic baseline. Hold volume flat; no new stress today.",
    });
  } else if (zone === "overreaching" && call === "push") {
    call = demote(call, "capped");
    limiters.push({
      key: "load",
      label: "Ceiling · training load overreaching",
      detail: "Load is running ahead of baseline — keep today at planned volume and intensity.",
    });
  }
  if (hasType("sleep_limited") || debt >= 2) {
    // A day the score alone would push stays capped, even when another limiter has already
    // stepped it down: one limiter must never switch another one off.
    if (call === "push" || (score !== null && score >= 85)) call = demote(call, "capped");
    limiters.push({
      key: "sleep",
      label: `Ceiling · sleep debt ${formatDebtHours(debt || 2)}`,
      detail:
        call === "train"
          ? "Meaningful sleep debt this week — complete the plan, add nothing on top, and protect sleep tonight."
          : "Sleep debt lowers today's ceiling. Complete the planned session; skip extra volume and max attempts.",
    });
  }
  if (lowConfidence && call === "push") {
    call = demote(call, "train");
    limiters.push({
      key: "confidence",
      label: "Limiter · low data confidence",
      detail: "Today's read is a cautious estimate — not enough raw signal to justify chasing numbers.",
    });
  }

  const limiter = limiters[0] || null;
  const copy = COPY[call] || COPY.train;
  const demoted = call !== baseCall;

  // One instruction only. If the call was demoted, the upstream prescription
  // (which may still say "PR attempts are allowed") must not survive.
  let prescription = demoted
    ? RESOLVED_PRESCRIPTION[call] || RESOLVED_PRESCRIPTION.capped
    : String(recommendation?.prescription || RESOLVED_PRESCRIPTION[call] || "Keep normal training constraints in place, and stop if subjective readiness disagrees.");
  if (lowConfidence && !/confidence/i.test(prescription)) {
    prescription += " Confidence is low, so treat this as a cautious estimate, not a command.";
  }

  const stampLabel = { push: "Push", train: "Normal Load", capped: "Moderate Load", easy: "Pull Back", recover: "Rest / Recovery" }[call];

  return {
    call,
    demoted,
    stamp: copy.stamp,
    headline: copy.headline,
    deck: copy.deck(score === null ? "—" : score),
    limiter,
    limiters,
    prescription,
    recommendation: recommendation
      ? { ...recommendation, label: stampLabel, prescription }
      : { label: stampLabel, prescription },
  };
}

export default { buildRecoveryVerdict, formatDebtHours };
