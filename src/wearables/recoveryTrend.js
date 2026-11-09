// src/wearables/recoveryTrend.js
// Morning Edition — the trend layer over the daily recovery score.
//
// WHY THIS EXISTS. The daily composite is a single-morning z-score reading; on
// the reporting user's own export it ran 77 → 88 → 90 → 81 across four
// ordinary days. That volatility is physiologic noise, not signal, and a
// number that whipsaws teaches users to ignore it. The training-monitoring
// literature (Plews & Buchheit) is consistent: the 7-day rolling lnRMSSD
// tracked against a ~4-week personal baseline, with a smallest-worthwhile-
// change band (0.5 × SD), is the reliable signal; the daily value is context.
//
// This module adds exactly that second dimension — STATE (today's score) ×
// TRAJECTORY (where the week is heading) — and names the combination in plain
// language a user can act on. Everything here is pure, display-oriented, and
// changes NO scoring: the composite, the ledger, and the resolver's caution
// doctrine are untouched.
//
// USER-COMPREHENSION RULES (the point of the feature):
//   · Every state carries evidence[] in concrete plain sentences ("HRV has
//     averaged 6% below your normal range this week"), never z-scores.
//   · "Your normal range" is the user-facing name for the SWC band. The
//     technical term lives in the explainer, not the headline.
//   · Calibration is honest and specific: "N more mornings" — never a fake
//     verdict on thin data.
//   · Devices are never mixed in one series (baselines are device-relative,
//     Doctrine). Oura main-sleep HRV is the primary series; Whoop
//     recovery HRV is the fallback series when Oura is thin.

import { trimmedMean, trimmedStdDev, lnRMSSD, linearRegression } from "../oura/statistics";
import { getSleepDoc, recoveryDates } from "../oura/normalization";

export const TREND_MIN_DAYS = 7;      // rolling window — below this we calibrate
export const CHRONIC_WINDOW = 28;     // personal-baseline window (days)
export const SWC_FACTOR = 0.5;        // Plews/Buchheit smallest-worthwhile-change

// ── Series builders (one device per series, chronological oldest → newest) ──

export function ouraLnHrvSeries(ouraData, windowDays = CHRONIC_WINDOW + TREND_MIN_DAYS) {
  const dates = recoveryDates(ouraData || {}).slice(0, windowDays).reverse();
  const out = [];
  for (const date of dates) {
    const rmssd = Number(getSleepDoc(ouraData[date])?.average_hrv);
    if (Number.isFinite(rmssd) && rmssd > 0) out.push({ date, ln: lnRMSSD(rmssd) });
  }
  return out;
}

export function whoopLnHrvSeries(whoopData, windowDays = CHRONIC_WINDOW + TREND_MIN_DAYS) {
  const dates = Object.keys(whoopData || {}).sort().slice(-windowDays);
  const out = [];
  for (const date of dates) {
    const rmssd = Number(whoopData?.[date]?.recovery?.score?.hrv_rmssd_milli);
    if (Number.isFinite(rmssd) && rmssd > 0) out.push({ date, ln: lnRMSSD(rmssd) });
  }
  return out;
}

// RHR series (bpm) for the slope evidence, Oura main sleeps.
function ouraRhrSeries(ouraData, windowDays = TREND_MIN_DAYS) {
  const dates = recoveryDates(ouraData || {}).slice(0, windowDays).reverse();
  const out = [];
  for (const date of dates) {
    const rhr = Number(getSleepDoc(ouraData[date])?.lowest_heart_rate);
    if (Number.isFinite(rhr) && rhr > 0) out.push(rhr);
  }
  return out;
}

// ── Core trend math ──────────────────────────────────────────────────────────

/**
 * Rolling-vs-baseline read for one device series.
 * Returns null when the series can't support even a calibrating statement.
 */
export function computeHrvTrend(series) {
  if (!Array.isArray(series) || series.length === 0) return null;
  const lns = series.map((p) => p.ln);
  const n = lns.length;
  if (n < TREND_MIN_DAYS) {
    return { calibrating: true, daysHave: n, daysNeeded: TREND_MIN_DAYS - n };
  }
  const rollingLns = lns.slice(-TREND_MIN_DAYS);
  const rolling = rollingLns.reduce((a, b) => a + b, 0) / rollingLns.length;
  // Personal baseline: up to CHRONIC_WINDOW values. With a short history the
  // baseline overlaps the rolling week — expected during early weeks; the
  // `early` flag keeps the copy honest about it.
  const chronicLns = lns.slice(-CHRONIC_WINDOW);
  const chronic = trimmedMean(chronicLns, 0.1);
  const sd = trimmedStdDev(chronicLns, 0.1);
  const swc = SWC_FACTOR * sd;
  const position = swc > 0 ? (rolling - chronic) / swc : 0; // in band-widths
  const deviationPct = chronic > 0 ? (Math.exp(rolling - chronic) - 1) * 100 : 0;
  // Rolling slope over the last week (ln/day) — direction inside the window.
  const weekSlope = rollingLns.length >= 3 ? linearRegression(rollingLns) : 0;
  return {
    calibrating: false,
    early: n < 14, // baseline still forming; states allowed, copy hedges
    daysHave: n,
    rolling, chronic, swc,
    position,               // <−1 below band · −1..1 inside · >1 above
    deviationPct,           // rolling vs baseline, in % of raw HRV
    weekSlope,              // ln-units/day inside the rolling week
  };
}

// SWC-gated score delta: today's composite vs the mean of the prior 3 points.
// The gate is derived from the user's own score variability so ordinary noise
// reads as "steady" instead of manufacturing an arrow every morning.
export function gatedScoreDelta(scoreToday, recoveryHistory = []) {
  const values = (recoveryHistory || [])
    .map((p) => Number(p?.value))
    .filter((v) => Number.isFinite(v) && v > 0);
  if (!Number.isFinite(Number(scoreToday)) || values.length < 3) {
    return { arrow: "→", label: "steady", gated: true, delta: 0 };
  }
  const prior = values.slice(-4, -1).length >= 3 ? values.slice(-4, -1) : values.slice(0, 3);
  const priorMean = prior.reduce((a, b) => a + b, 0) / prior.length;
  const gate = Math.max(3, Math.round(trimmedStdDev(values, 0.1) * SWC_FACTOR));
  const delta = Math.round(Number(scoreToday) - priorMean);
  if (Math.abs(delta) < gate) return { arrow: "→", label: "steady", gated: true, delta };
  return delta > 0
    ? { arrow: "↗", label: `up ${Math.abs(delta)}`, gated: false, delta }
    : { arrow: "↘", label: `down ${Math.abs(delta)}`, gated: false, delta };
}

// ── The state machine ────────────────────────────────────────────────────────
//
// Six states, computed from multi-day windows only (no single-morning
// triggers — the windows are the anti-flap mechanism). Priority order runs
// most-protective first. `tone` drives typography only: steady | watch | act.

const STATES = {
  calibrating: { key: "calibrating", name: "Calibrating", tone: "steady" },
  fresh:       { key: "fresh",       name: "Fresh",              tone: "steady" },
  steady:      { key: "steady",      name: "Steady",             tone: "steady" },
  absorbing:   { key: "absorbing",   name: "Absorbing load",     tone: "steady" },
  accumulating:{ key: "accumulating",name: "Accumulating fatigue", tone: "watch" },
  deload:      { key: "deload",      name: "Deload advised",     tone: "act" },
};

const fmtPct = (x) => `${Math.abs(x) < 0.95 ? Math.abs(x).toFixed(1) : Math.round(Math.abs(x))}%`;
const fmtBpm = (x) => `${Math.abs(x).toFixed(1)} bpm`;

/**
 * Classify the multi-day recovery state.
 *
 * @param {object} args
 *   ouraData / whoopData — grouped day maps (35-day window recommended)
 *   sleepDebt            — { debtHours, band } from calcSleepDebt (optional)
 *   loadZone             — "low"|"moderate"|"high"|"peak" from the load model (optional)
 *   recoveryHistory      — [{date, value}] recent composite scores (optional)
 *   scoreToday           — today's composite (optional; delta gating)
 * @returns {{ state, evidence, meaning, hrv, delta, source, early }}
 */
export function classifyRecoveryState({
  ouraData = null,
  whoopData = null,
  sleepDebt = null,
  loadZone = null,
  recoveryHistory = [],
  scoreToday = null,
} = {}) {
  // Device-pure series: Oura primary, Whoop fallback when Oura is thin.
  const ouraSeries = ouraLnHrvSeries(ouraData);
  const whoopSeries = whoopLnHrvSeries(whoopData);
  const useWhoop = ouraSeries.length < TREND_MIN_DAYS && whoopSeries.length >= TREND_MIN_DAYS;
  const series = useWhoop ? whoopSeries : ouraSeries;
  const source = useWhoop ? "whoop" : "oura";
  const hrv = computeHrvTrend(series);
  const delta = gatedScoreDelta(scoreToday, recoveryHistory);

  // ── Calibrating: never fake a trend on thin data. Specific and honest. ──
  if (!hrv || hrv.calibrating) {
    const have = hrv?.daysHave ?? 0;
    const need = hrv?.daysNeeded ?? TREND_MIN_DAYS;
    return {
      state: STATES.calibrating,
      hrv, delta, source, early: true,
      evidence: [
        have === 0
          ? "No overnight HRV history yet — wear your device tonight to start the clock."
          : `${have} of ${TREND_MIN_DAYS} mornings recorded — ${need} more ${need === 1 ? "night" : "nights"} to unlock your trend.`,
        "Today's score still works day-to-day; the weekly trend needs a week of you first.",
      ],
      meaning: {
        what: "0VERTRAINED is learning your personal normal range.",
        why: "Recovery signals like HRV vary a lot between people — comparing you to a population average would be a guess. Comparing you to you takes about a week of overnight readings.",
        action: "Nothing to do except sleep with the device on. The trend line appears automatically.",
      },
    };
  }

  const rhrSeries = ouraRhrSeries(ouraData);
  const rhrSlope = rhrSeries.length >= 3 ? linearRegression(rhrSeries) : 0;
  const rhrRising = rhrSlope >= 0.4;      // bpm/day, sustained across the week
  const rhrFalling = rhrSlope <= -0.4;
  // The load model's zone vocabulary includes "high_risk"/"overreaching";
  // match on the family so the trend layer never depends on exact strings.
  const zoneStr = String(loadZone || "");
  const highLoad = /high|peak|overreach/i.test(zoneStr);
  const lowLoad = /low|detrain/i.test(zoneStr);
  const debtHours = Number(sleepDebt?.debtHours) || 0;
  const heavyDebt = debtHours >= 3;
  const scoreValues = (recoveryHistory || []).map((p) => Number(p?.value)).filter((v) => Number.isFinite(v) && v > 0);
  const scoreSlope = scoreValues.length >= 4 ? linearRegression(scoreValues.slice(-7)) : 0;

  const below = hrv.position <= -1;   // rolling week below your normal range
  const above = hrv.position >= 1;
  const inBand = !below && !above;

  const ev = [];
  const hedge = hrv.early ? " (baseline still forming — first two weeks read cautiously)" : "";

  let state;
  if (below && (rhrRising || heavyDebt)) {
    // ── Deload: suppressed HRV week + a corroborating stressor. ──
    state = STATES.deload;
    ev.push(`HRV has averaged ${fmtPct(hrv.deviationPct)} below your normal range this week${hedge}.`);
    if (rhrRising) ev.push(`Resting heart rate has climbed ~${fmtBpm(rhrSlope * 7)} across the week — the two together are the classic fatigue signature.`);
    if (heavyDebt) ev.push(`You're carrying ${debtHours.toFixed(1)}h of sleep debt on top of it.`);
    if (highLoad) ev.push("Training load is in the high zone, so this is earned — and it's time to bank it.");
  } else if (above && rhrRising && highLoad) {
    // ── Parasympathetic saturation: HRV *elevated* + RHR rising under high
    //    volume — a known overreaching signature a naive scorer grades as a
    //    great morning. Protective classification with its own explanation. ──
    state = STATES.deload;
    ev.push(`Unusual combination: HRV is ${fmtPct(hrv.deviationPct)} ABOVE your normal range while resting heart rate is climbing (~${fmtBpm(rhrSlope * 7)}/week) during a high-load block.`);
    ev.push("Elevated HRV under these conditions can be a saturation response to accumulated volume, not super-recovery.");
  } else if (below) {
    state = STATES.accumulating;
    ev.push(`HRV has averaged ${fmtPct(hrv.deviationPct)} below your normal range this week${hedge}.`);
    ev.push(rhrRising ? `Resting heart rate is drifting up (~${fmtBpm(rhrSlope * 7)}/week).` : "Resting heart rate is holding — one system is coping, one is complaining.");
    if (highLoad) ev.push("Training load is high, which explains the direction; watch that it turns before it deepens.");
  } else if (inBand && scoreSlope <= -1.5 && highLoad) {
    state = STATES.accumulating;
    ev.push("HRV is inside your normal range, but the daily score has slid for several days under high load.");
    ev.push("Trend before threshold: this is the early picture of fatigue building.");
  } else if (inBand && highLoad) {
    state = STATES.absorbing;
    ev.push("HRV is holding inside your normal range while training load runs high — you're absorbing the work.");
    if (debtHours >= 1.5) ev.push(`Sleep debt of ${debtHours.toFixed(1)}h is the one thing to clean up.`);
  } else if ((above || (inBand && hrv.position > 0)) && !rhrRising && !heavyDebt) {
    state = STATES.fresh;
    ev.push(above
      ? `HRV is running ${fmtPct(hrv.deviationPct)} above your normal range${hedge}.`
      : "HRV is in the upper half of your normal range.");
    ev.push(rhrFalling ? `Resting heart rate is trending down (~${fmtBpm(Math.abs(rhrSlope * 7))}/week) — full green.` : "Resting heart rate is steady.");
    if (lowLoad) ev.push("Load has been light — a good week to push.");
  } else {
    state = STATES.steady;
    ev.push("HRV is inside your normal range and nothing is drifting.");
    if (debtHours >= 1.5) ev.push(`Sleep debt of ${debtHours.toFixed(1)}h is worth paying down.`);
  }

  const MEANINGS = {
    fresh: {
      what: "Your body is fully caught up with recent training.",
      why: "The week's average HRV (heart-rate variability — your nervous system's recovery signal) sits at or above your personal normal, with no drift in resting heart rate.",
      action: "Good window for intensity, PRs, or adding volume. Fitness is built by loading a fresh system.",
    },
    steady: {
      what: "Normal operations — recovered and training in balance.",
      why: "The weekly HRV average is inside your normal range and nothing else is trending.",
      action: "Run the plan as written.",
    },
    absorbing: {
      what: "You're training hard and your body is keeping up.",
      why: "Load is high but the weekly HRV average is holding inside your normal range — stress is being applied and absorbed.",
      action: "Keep going, protect sleep. This is what a productive block looks like.",
    },
    accumulating: {
      what: "Fatigue is building faster than it's clearing.",
      why: "The weekly HRV average has slipped below your personal normal range. One suppressed morning is noise; a suppressed week is a message.",
      action: "Not an alarm — a lean-out signal. Favor the lower end of planned volume, keep intensity honest, get to bed. If it persists, Deload advised follows.",
    },
    deload: {
      what: "The signals say bank your gains and back off for a few days.",
      why: "A suppressed HRV week alongside a rising resting heart rate (or heavy sleep debt) is the most reliable fatigue signature in the training literature — and it responds quickly to rest.",
      action: "Cut volume roughly in half for 3–5 days, keep movement easy, prioritize sleep. Adaptation happens in the recovery, not the session.",
    },
  };

  return {
    state,
    evidence: ev.slice(0, 3),
    meaning: MEANINGS[state.key] || MEANINGS.steady,
    hrv, delta, source, early: !!hrv.early,
  };
}

export default { classifyRecoveryState, computeHrvTrend, gatedScoreDelta, ouraLnHrvSeries, whoopLnHrvSeries, TREND_MIN_DAYS, CHRONIC_WINDOW, SWC_FACTOR };
