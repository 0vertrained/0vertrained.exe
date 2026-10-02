// src/checkinMorning.js
// ─────────────────────────────────────────────────────────────────────────────
// V16.8 · Morning check-in — the subjective row of the Morning Edition.
//
// DESIGN DECISIONS (why it works this way):
//   · WRITES TO THE EXISTING FIELDS. The taps store 1–10 values on the same
//     entry body fields TodayTab and manualRecovery already use
//     (sleepQuality / soreness / stress / energy) — one source of truth, and a
//     user who prefers typing numbers on Today sees the same data here.
//   · CAUTION-ONLY, per the V13 resolver doctrine ("limiters can only make the
//     call MORE cautious, never less"). A rough check-in can demote the
//     training call one step; a great check-in never raises it — the
//     subjective row keeps you honest, it doesn't hand out passes. The
//     composite SCORE is never modified: physiology stays physiology, so the
//     number keeps one meaning across history and the sparkline.
//   · READING ORDER BEATS ANCHORING. The UI shows the taps ABOVE the verdict
//     and labels the verdict "before check-in" until answered — you rate how
//     you feel before the number can tell you how to feel. Answering is never
//     required: the verdict resolves without it.
//   · DIVERGENCE IS SAID OUT LOUD. Feel-vs-metrics disagreement is the most
//     confusing morning a recovery app can produce; both directions get one
//     plain sentence (the Saw & Gastin finding — subjective measures often
//     lead objective ones — operationalized as transparency, not math).
// ─────────────────────────────────────────────────────────────────────────────

// Tap rows. Values land on the existing 1–10 scales; three levels is a
// deliberate ceiling (a 1–10 picker at 6:30 a.m. is friction, not fidelity).
export const CHECKIN_ROWS = [
  { field: "sleepQuality", label: "SLEPT", options: [
    { value: 3, text: "poorly" }, { value: 6, text: "fine" }, { value: 9, text: "well" },
  ]},
  { field: "soreness", label: "SORE", options: [
    { value: 2, text: "no" }, { value: 5, text: "some" }, { value: 8, text: "very" },
  ]},
  { field: "stress", label: "STRESS", options: [
    { value: 2, text: "low" }, { value: 5, text: "some" }, { value: 8, text: "high" },
  ]},
  { field: "energy", label: "ENERGY", options: [
    { value: 3, text: "low" }, { value: 6, text: "ok" }, { value: 9, text: "high" },
  ]},
];

const num = (v) => {
  // Number(null) and Number("") are 0 — and TodayTab stores cleared inputs as
  // empty strings. Those must read as UNANSWERED, not "answered with zero"
  // (which would false-flag "slept poorly" on an untouched morning).
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Which option a stored value maps to (numbers typed on Today snap to the
// nearest tap so the two surfaces always agree).
export function selectedOption(row, bodyValue) {
  const v = num(bodyValue);
  if (v === null) return null;
  let best = null;
  for (const opt of row.options) {
    if (best === null || Math.abs(opt.value - v) < Math.abs(best.value - v)) best = opt;
  }
  return best;
}

/**
 * Read the morning check-in off an entry body.
 * @returns {{answered, total, complete, flags, goodSigns, values}}
 */
export function readCheckin(body = {}) {
  const values = {};
  const flags = [];       // bad-side signals only
  let goodSigns = 0;
  let answered = 0;
  for (const row of CHECKIN_ROWS) {
    const v = num(body?.[row.field]);
    values[row.field] = v;
    if (v === null) continue;
    answered += 1;
    // "Bad side" thresholds match manualRecovery's 1–10 semantics:
    // soreness/stress high is bad; sleepQuality/energy low is bad.
    if (row.field === "soreness" && v >= 7) flags.push("very_sore");
    if (row.field === "stress" && v >= 7) flags.push("high_stress");
    if (row.field === "sleepQuality" && v <= 4) flags.push("slept_poorly");
    if (row.field === "energy" && v <= 4) flags.push("low_energy");
    if (row.field === "soreness" && v <= 3) goodSigns += 1;
    if (row.field === "stress" && v <= 3) goodSigns += 1;
    if (row.field === "sleepQuality" && v >= 8) goodSigns += 1;
    if (row.field === "energy" && v >= 8) goodSigns += 1;
  }
  if (body?.illnessOrInjury === true || body?.illnessOrInjury === "true") flags.push("illness_or_injury");
  return { answered, total: CHECKIN_ROWS.length, complete: answered === CHECKIN_ROWS.length, flags, goodSigns, values };
}

/**
 * Caution units for the resolver's limiter, 0–3.
 *   · illness/injury alone is decisive (2)
 *   · slept_poorly and very_sore weigh 1 each
 *   · high_stress + low_energy together weigh 1 (life-load pairing)
 * The resolver demotes one step at ≥2 — one rough answer nudges the copy,
 * two independent rough signals move the call.
 */
export function checkinSeverity(checkin) {
  if (!checkin) return 0;
  const f = new Set(checkin.flags || []);
  let units = 0;
  if (f.has("illness_or_injury")) units += 2;
  if (f.has("slept_poorly")) units += 1;
  if (f.has("very_sore")) units += 1;
  if (f.has("high_stress") && f.has("low_energy")) units += 1;
  return Math.min(3, units);
}

// Plain-language flag copy for evidence lines.
const FLAG_COPY = {
  slept_poorly: "you rated last night's sleep poor",
  very_sore: "you're very sore",
  high_stress: "stress is high",
  low_energy: "energy is low",
  illness_or_injury: "you flagged illness or injury",
};

export function checkinEvidenceLine(checkin) {
  if (!checkin || !checkin.flags?.length) return null;
  const parts = checkin.flags.map((f) => FLAG_COPY[f]).filter(Boolean);
  if (!parts.length) return null;
  const list = parts.length === 1 ? parts[0] : parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1];
  return `Check-in: ${list}.`;
}

/**
 * The divergence sentence — spoken only when feel and metrics genuinely
 * disagree, in either direction. Null otherwise (silence is the default).
 */
export function divergenceNote(checkin, score) {
  const s = Number(score);
  if (!checkin || !checkin.complete || !Number.isFinite(s)) return null;
  const severity = checkinSeverity(checkin);
  if (s >= 72 && severity >= 2) {
    return "You feel rougher than your metrics look. Subjective often leads objective by a day — ease into the first sets and let the warm-up cast the deciding vote.";
  }
  if (s < 55 && severity === 0 && checkin.goodSigns >= 3) {
    return "You feel better than your metrics look. Feeling good is real, but suppressed overnight signals usually collect their debt tomorrow — keep today honest.";
  }
  return null;
}

export default { CHECKIN_ROWS, readCheckin, checkinSeverity, checkinEvidenceLine, divergenceNote, selectedOption };
