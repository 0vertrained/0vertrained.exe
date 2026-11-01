// src/sundayEdition.js
// ─────────────────────────────────────────────────────────────────────────────
// V17.2 · The Sunday Edition — the weekly review model, pure and deterministic.
//
// Reflect → plan → return. The edition composes existing modules (nothing is
// re-derived with new math): the Morning Edition state machine per day, the
// V16.7 load currency via buildDailyLoads(asOf), the volume landmarks, the
// adaptive TDEE ledger, and the check-in divergence notes — into one Mon–Sun
// broadsheet with a single prescription at the end.
//
// Doctrine:
//   · One change. Not three tips — one, resolved by strict priority
//     (recovery state > sleep debt > volume exception > protein > run it
//     back), each with its method visible.
//   · Honest degradation. Thin weeks say "3 of 7 days logged" and sections
//     admit "not enough data this week" — never fake completeness.
//   · Plain language everywhere; the only numbers are ones a lifter can act
//     on. No z-scores, no acronym-first framing.
//   · Publish window: Sunday 17:00 local through Monday 23:59, covering the
//     Mon–Sun week that ends that Sunday. Pure of clock via injected `now`.
// ─────────────────────────────────────────────────────────────────────────────

import { classifyRecoveryState } from "./wearables/recoveryTrend";
import { calcRecoveryScore, calcSleepDebt } from "./wearables/recoveryEngine";
import { recoveryDates, mainSleepDurationSeconds, napSleepDurationSeconds } from "./oura/normalization";
import { buildDailyLoads, computeRollingLoads, getLoadZoneInfo } from "./loadModel";
import { buildVolumeReport } from "./muscleVolume";
import { computeAdaptiveTDEE } from "./adaptiveTDEE";
import { readCheckin, checkinSeverity, divergenceNote } from "./checkinMorning";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const keyOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const num = (v) => { if (v === null || v === undefined || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

// ── Publish window ───────────────────────────────────────────────────────────

/**
 * The edition window for a given moment. Always describes the most recently
 * COMPLETED Mon–Sun week; `available` gates the UI (Sun 17:00 → Mon 23:59).
 */
export function editionWindow(now = new Date()) {
  const n = new Date(now);
  const day = n.getDay(); // 0 = Sunday
  // The Sunday that closes the edition week:
  const sunday = new Date(n);
  if (day === 0) {
    // Today is Sunday. Before 17:00 the closing Sunday is LAST week's.
    if (n.getHours() < 17) sunday.setDate(n.getDate() - 7);
  } else {
    sunday.setDate(n.getDate() - day); // most recent past Sunday
  }
  sunday.setHours(12, 0, 0, 0);
  const monday = new Date(sunday);
  monday.setDate(sunday.getDate() - 6);
  const available =
    (day === 0 && n.getHours() >= 17) || // Sunday evening
    day === 1;                            // all of Monday
  return {
    available,
    weekStartKey: keyOf(monday),
    weekEndKey: keyOf(sunday),
    label: `${monday.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${sunday.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
  };
}

function weekKeys(weekStartKey) {
  const start = new Date(`${weekStartKey}T12:00:00`);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return { key: keyOf(d), dayName: DAY_NAMES[d.getDay()] };
  });
}

const truncateMap = (map, maxKey) => {
  const out = {};
  for (const [k, v] of Object.entries(map || {})) if (k <= maxKey) out[k] = v;
  return out;
};

// ── The builder ──────────────────────────────────────────────────────────────

export function buildSundayEdition({ data = {}, ouraData = {}, whoopData = {}, settings = {}, now = new Date() } = {}) {
  const win = editionWindow(now);
  const days = weekKeys(win.weekStartKey);
  const weekEnd = win.weekEndKey;

  // Edition № — weeks since the first logged day's Monday, 1-based.
  const firstKey = Object.keys(data).sort()[0] || win.weekStartKey;
  const first = new Date(`${firstKey}T12:00:00`);
  first.setDate(first.getDate() - ((first.getDay() + 6) % 7)); // its Monday
  const editionNumber = Math.max(1, Math.round((new Date(`${win.weekStartKey}T12:00:00`) - first) / (7 * 86400000)) + 1);

  // ── The week in recovery: per-day state + score (as-of that morning) ──────
  const timeline = [];
  const scoresByKey = {};
  for (const d of days) {
    const oura = truncateMap(ouraData, d.key);
    const whoop = truncateMap(whoopData, d.key);
    const hasSignal = recoveryDates(oura).length > 0 || Object.keys(whoop).length > 0;
    let stateKey = null, stateName = "—", score = null;
    if (hasSignal) {
      const rec = calcRecoveryScore(oura, {}, whoop);
      score = Number.isFinite(Number(rec?.score)) ? Math.round(rec.score) : null;
      const t = classifyRecoveryState({ ouraData: oura, whoopData: whoop, scoreToday: score });
      stateKey = t.state.key;
      stateName = t.state.name;
    }
    scoresByKey[d.key] = score;
    timeline.push({ date: d.key, dayName: d.dayName, stateKey, stateName, score });
  }
  const known = timeline.filter((t) => t.stateKey);
  const transitions = [];
  for (let i = 1; i < known.length; i++) {
    if (known[i].stateKey !== known[i - 1].stateKey) {
      transitions.push({ day: known[i].dayName, from: known[i - 1].stateName, to: known[i].stateName });
    }
  }
  const counts = known.reduce((m, t) => ((m[t.stateName] = (m[t.stateName] || 0) + 1), m), {});
  const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] || null;
  const recoverySummary = !known.length
    ? "No wearable mornings recorded this week."
    : transitions.length === 0
      ? `${dominant[0]} all week — ${dominant[1]} of 7 mornings recorded.`
      : `Mostly ${dominant[0].toLowerCase()}; ${transitions.map((t) => `${t.from} → ${t.to} on ${t.day}`).join(", ")}.`;
  const scorePoints = timeline.filter((t) => t.score !== null).map((t) => ({ date: t.date, value: t.score }));

  // Sleep debt as of Sunday (V16.9 reconciled inputs).
  const ouraAsOf = truncateMap(ouraData, weekEnd);
  const sleptByDay = recoveryDates(ouraAsOf)
    .map((date) => {
      const main = (mainSleepDurationSeconds(ouraAsOf[date]) ?? 0) / 3600;
      return main > 0 ? main + napSleepDurationSeconds(ouraAsOf[date]) / 3600 : 0;
    })
    .filter(Boolean);
  const baselines = Object.keys(whoopData)
    .map((d) => Number(whoopData?.[d]?.sleep?.score?.sleep_needed?.baseline_milli))
    .filter((ms) => Number.isFinite(ms) && ms > 0)
    .sort((a, b) => a - b);
  const needBase = baselines.length ? baselines[Math.floor(baselines.length / 2)] / 3.6e6 : null;
  const sleepDebt = sleptByDay.length ? calcSleepDebt(sleptByDay.slice(0, 7), { needHours: needBase, baselineSamples: sleptByDay }) : null;

  // ── Load ledger (deterministic via asOf) ──────────────────────────────────
  const dailyLoads = buildDailyLoads(data, 14, weekEnd); // newest-first
  const inWeek = new Set(days.map((d) => d.key));
  const loadDays = days.map((d) => {
    const row = dailyLoads.find((x) => x.date === d.key);
    return { date: d.key, dayName: d.dayName, load: Math.round(row?.load || 0) };
  });
  const weekTotal = loadDays.reduce((a, x) => a + x.load, 0);
  const priorTotal = Math.round(dailyLoads.filter((x) => !inWeek.has(x.date)).reduce((a, x) => a + (x.load || 0), 0));
  const rolling = computeRollingLoads(buildDailyLoads(data, 28, weekEnd));
  const zoneInfo = getLoadZoneInfo(rolling.zone);
  const loadDeltaPct = priorTotal > 0 ? Math.round(((weekTotal - priorTotal) / priorTotal) * 100) : null;

  // ── Volume digest — exceptions only ───────────────────────────────────────
  const volume = buildVolumeReport(data);
  let volumeDigest;
  if (!volume?.ready) {
    volumeDigest = { ready: false, line: "Not enough lifting logged this week for the volume audit." };
  } else {
    const exceptions = volume.rows
      // below_mev counts as an exception only when the muscle was TOUCHED
      // (sets ≥ 1): under-dosing something you train is a weekly slip; not
      // training it at all is a program-design choice that belongs to the
      // Progress audit, not the Sunday nag. above_mrv always qualifies.
      .filter((r) => (r.status === "below_mev" && r.sets >= 1) || r.status === "above_mrv")
      .map((r) => ({
        key: r.key, label: r.label, sets: r.sets, status: r.status,
        line: r.status === "below_mev"
          ? `${r.label}: ${r.sets} sets — under the ${r.landmarks.mev}-set growth minimum.`
          : `${r.label}: ${r.sets} sets — past the ~${r.landmarks.mrv}-set recovery ceiling; extra sets are subtracting now.`,
      }));
    const inRange = volume.rows.length - exceptions.length;
    volumeDigest = {
      ready: true, exceptions, inRangeCount: inRange, totalCount: volume.rows.length,
      line: exceptions.length === 0
        ? `All ${volume.rows.length} trained muscle groups inside productive ranges.`
        : `${inRange} of ${volume.rows.length} muscle groups in range.`,
    };
  }

  // ── Fuel week ─────────────────────────────────────────────────────────────
  const nutritionDays = days
    .map((d) => data[d.key]?.nutrition)
    .map((n) => ({ cal: num(n?.calories), pro: num(n?.protein) }))
    .filter((x) => x.cal !== null || x.pro !== null);
  const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null);
  const avgCalories = avg(nutritionDays.map((x) => x.cal).filter((v) => v !== null));
  const avgProtein = avg(nutritionDays.map((x) => x.pro).filter((v) => v !== null));
  // V19.4 · The targets Fuel shows (settings.goals, written by setup and
  // Settings → Macros). This read settings.macroTargets, which nothing writes,
  // so protein adherence never appeared.
  const proteinTarget = num(settings?.goals?.protein);
  const calorieTarget = num(settings?.goals?.calories);
  const proteinAdherencePct = avgProtein !== null && proteinTarget ? Math.round((avgProtein / proteinTarget) * 100) : null;
  const tdee = computeAdaptiveTDEE(data);
  const fuelWeek = {
    daysLogged: nutritionDays.length,
    avgCalories, avgProtein, proteinTarget, calorieTarget, proteinAdherencePct,
    tdee: tdee?.ready ? { value: tdee.tdee, trendDeltaLbs: tdee.trendDeltaLbs, spanDays: tdee.spanDays } : null,
    line: nutritionDays.length === 0
      ? "No nutrition logged this week."
      : `${nutritionDays.length} of 7 days logged${avgProtein !== null && proteinTarget ? ` · protein averaged ${avgProtein}g against a ${proteinTarget}g target (${proteinAdherencePct}%)` : ""}.`,
  };

  // ── Divergence diary — where feel and metrics disagreed, and who was right ─
  const diary = [];
  for (let i = 0; i < days.length; i++) {
    const d = days[i];
    const checkin = readCheckin(data[d.key]?.body || {});
    const score = scoresByKey[d.key];
    const note = divergenceNote(checkin, score);
    if (!note) continue;
    const nextScore = i < days.length - 1 ? scoresByKey[days[i + 1].key] : null;
    let resolution = null;
    if (score !== null && nextScore !== null) {
      const feltRough = checkinSeverity(checkin) >= 2;
      if (feltRough) resolution = nextScore <= score - 5 ? "Your body was right — the score followed it down the next day." : "The metrics held — the rough morning passed.";
      else resolution = nextScore >= score + 5 ? "You were right — the score caught up to how you felt." : "The metrics held — the suppressed signals collected their debt.";
    }
    diary.push({ date: d.key, dayName: d.dayName, note, resolution });
  }

  // ── THE ONE CHANGE — strict priority, method visible ──────────────────────
  // The recovery rung fires only when the week ENDS strained: the last known
  // morning in a fatigue state, or deload appearing twice in the final three.
  // A Fri–Sat dip that clears by Sunday is an absorbed weekend — run-it-back
  // territory, not a half-volume mandate (real-export calibration, №1).
  const lateKnown = timeline.filter((t) => t.stateKey);
  const lastState = lateKnown.length ? lateKnown[lateKnown.length - 1].stateKey : null;
  const lateStates = lateKnown.slice(-3).map((t) => t.stateKey);
  const strained =
    lastState === "deload" || lastState === "accumulating" ||
    lateStates.filter((k) => k === "deload").length >= 2;
  let oneChange;
  if (strained) {
    oneChange = {
      text: "Open next week at roughly half your planned volume for the first three days, keep intensity honest, and let the trend turn before you reload.",
      reason: "Recovery ended the week in a fatigue state.",
      rung: "recovery_state",
    };
  } else if (sleepDebt && /Moderate|Significant/.test(sleepDebt.band)) {
    oneChange = {
      text: `Add 45 minutes to your sleep window every night next week — you closed this one carrying ${sleepDebt.debtHours}h of debt against your ${sleepDebt.baselineHours}h need.`,
      reason: `Sleep debt band: ${sleepDebt.band}.`,
      rung: "sleep_debt",
    };
  } else if (volumeDigest.ready && volumeDigest.exceptions.length > 0) {
    const worst = volumeDigest.exceptions.find((e) => e.status === "above_mrv") || volumeDigest.exceptions[0];
    oneChange = {
      text: worst.status === "above_mrv"
        ? `Pull ${worst.label} back to ~${Math.max(1, worst.sets - 4)} sets next week — you're past the recovery ceiling and the extra sets are working against you.`
        : `Give ${worst.label} three more sets next week — ${worst.sets} is under the minimum that reliably grows.`,
      reason: worst.line,
      rung: "volume_exception",
    };
  } else if (proteinAdherencePct !== null && proteinAdherencePct < 85) {
    oneChange = {
      text: `Protein first: front-load ${proteinTarget ? Math.round(proteinTarget * 0.4) : 80}g before 1pm next week — you averaged ${proteinAdherencePct}% of target and the misses compound.`,
      reason: `Protein adherence ${proteinAdherencePct}% across ${fuelWeek.daysLogged} logged days.`,
      rung: "protein",
    };
  } else {
    oneChange = {
      text: "Run it back. The week worked — same plan, same effort, and let consistency do the compounding.",
      reason: "No fatigue state, no meaningful sleep debt, volume in range, protein on target.",
      rung: "run_it_back",
    };
  }
  oneChange.method = "one change only · resolved in strict order: recovery state, then sleep, then volume, then protein";

  // ── Completeness ──────────────────────────────────────────────────────────
  const daysWithEntries = days.filter((d) => data[d.key]).length;
  const wearableMornings = known.length;
  const caveat = daysWithEntries < 5 || wearableMornings < 5
    ? `Thin week on the record — ${daysWithEntries} of 7 days logged, ${wearableMornings} wearable mornings. Read the calls above with that in mind.`
    : null;

  return {
    edition: { number: editionNumber, weekStartKey: win.weekStartKey, weekEndKey: win.weekEndKey, label: win.label, available: win.available },
    recoveryWeek: { timeline, transitions, summary: recoverySummary, scorePoints, sleepDebt },
    loadLedger: { days: loadDays, weekTotal, priorTotal, deltaPct: loadDeltaPct, zoneLabel: zoneInfo?.label || null, zoneKey: rolling.zone },
    volumeDigest,
    fuelWeek,
    divergenceDiary: diary,
    oneChange,
    completeness: { daysWithEntries, wearableMornings, caveat },
  };
}

export default { buildSundayEdition, editionWindow };
