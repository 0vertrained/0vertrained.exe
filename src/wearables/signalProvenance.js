// src/wearables/signalProvenance.js
// V16.5 · One sentence, at the verdict, explaining what today's score stood
// on — the arbitration layer made fallback days CORRECT (V16.0); this makes
// them FELT. Cause attribution is deliberately conservative: "had no data"
// only when the day object is entirely absent; a day with docs but a missing
// field says "no <metric> reading" — inferring behavior from partial data
// would be overclaiming.
import { getAnySleepDoc, getSleepDoc, latestDay } from "../oura/normalization";

const METRIC_LABEL = { hrv: "HRV", rhr: "RHR", sleep: "sleep" };

export function buildSignalProvenance(rec, ouraData, whoopGrouped, scoredDay) {
  if (!rec) return null;
  const day = scoredDay || rec.scoredDay;

  // ── Insufficient: bridge to the manual check-in (a valid mode already). ──
  if (rec.band === "insufficient_data" || rec.score == null) {
    const pending = [];
    if (hasPriorButNotDay(ouraData, day, "oura")) pending.push("Oura");
    if (hasPriorButNotDay(whoopGrouped, day, "whoop")) pending.push("Whoop");
    const syncTail = pending.length
      ? ` ${pending.join(" and ")} ${pending.length > 1 ? "haven't" : "hasn't"} reported today yet — the score may update after the morning sync.`
      : "";
    return `No wearable signals for ${day}. Log this morning's check-in and the verdict runs on your subjective inputs until a device reports.${syncTail}`;
  }

  const parts = [];

  // ── V16.6/V16.7 · Nap-skip transparency. When a newer calendar day exists
  //    whose only sleep record is a nap (no main sleep, no readiness), the
  //    engine correctly scores the last real night — say so, or a user who
  //    napped this afternoon wonders why the masthead date is yesterday. ──
  const newest = latestDay(ouraData);
  if (newest && day && newest > day && !getSleepDoc(ouraData[newest])) {
    const nap = getAnySleepDoc(ouraData[newest]);
    if (nap && /nap/i.test(String(nap.type || ""))) {
      parts.push(`Oura's newest record (${newest}) is a nap — naps don't grade recovery, so this is last night's verdict. Tonight's sleep will update it.`);
    }
  }

  // ── Fallback rungs in use → name the substitution honestly. ──
  const fb = (rec.ledger || []).filter((l) => l.counted && /\(fallback\)/.test(l.source || ""));
  if (fb.length) {
    const metrics = fb.map((l) => METRIC_LABEL[l.key] || l.key).join(", ");
    const ouraDayAbsent = !ouraData?.[day];
    const cause = ouraDayAbsent
      ? "Oura had no data last night"
      : `Oura had no ${metrics} reading${fb.length > 1 ? "s" : ""} last night`;
    parts.push(`${cause} — ${metrics} scored on Whoop.`);
  }

  // ── Sync race: the connected-but-silent device, only worth saying when
  //    something else carried the day. ──
  if (hasPriorButNotDay(whoopGrouped, day, "whoop") && !fb.length) {
    parts.push("Whoop hasn't reported today yet — strain context and fallbacks arrive after its sync.");
  }
  if (hasPriorButNotDay(ouraData, day, "oura") && fb.length) {
    parts.push("Oura may still sync; the score updates if it reports.");
  }

  if (!parts.length) return null;
  const basis = rec.scoringBasis && !rec.scoringBasis.startsWith("4/4") ? ` (${rec.scoringBasis.split(" · ")[0]})` : "";
  return parts.join(" ") + basis;
}

function hasPriorButNotDay(grouped, day, kind) {
  if (!grouped || !day) return false;
  const keys = Object.keys(grouped);
  if (!keys.length) return false;
  if (kind === "oura") {
    if (grouped[day]) return false;
    return keys.some((k) => k < day);
  }
  const d = grouped[day];
  const present = d && (d.recovery || d.sleep || d.cycle);
  if (present) return false;
  return keys.some((k) => k < day);
}
