// src/recovery/hrvRawDisplay.js
// Pure helper for the *raw* HRV value shown in the Recovery trust strip and
// component ledger.
//
// Trust background: the Oura app showed HRV 70ms while 0vertrained once showed
// 31ms. Two failure modes caused that class of mismatch:
//   1) averaging partial hrv.items[] instead of Oura's nightly `average_hrv`
//      (handled upstream in normalization.hrvRmssdWithSource, which now prefers
//      average_hrv), and
//   2) the latest *recovery* day being readiness-only (no sleep HRV yet), so
//      the UI printed the readiness HRV-balance index (0–100) with no signal
//      that it wasn't a real ms reading — or, worse, a stale ms value with no
//      date.
//
// This helper resolves the raw HRV *display* with explicit provenance so the UI
// never presents a stale or fallback number as "today's HRV" unlabeled:
//   - prefer the scored day's real sleep HRV (ms), else
//   - the most recent prior night's real sleep HRV (ms), clearly dated + stale,
//     else
//   - the readiness HRV-balance index (0–100), clearly labeled as a fallback.
// It re-derives nothing about scoring; it only decides what number to show and
// how to label it, anchored to the same latestRecoveryDay the scorer uses.

import {
  latestRecoveryDay,
  recoveryDates,
  getSleepDoc,
  hrvRmssdWithSource,
  readinessContributor,
} from "../oura/normalization";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function finiteNumber(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Format an Oura "YYYY-MM-DD" day as "Jun 30" without constructing a Date
// (avoids timezone drift that could shift the label to the wrong calendar day).
function formatShortDate(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ""));
  if (!m) return String(date || "");
  const monthIdx = Number(m[2]) - 1;
  const day = Number(m[3]);
  if (monthIdx < 0 || monthIdx > 11) return String(date);
  return `${MONTHS[monthIdx]} ${day}`;
}

/**
 * Resolve the raw HRV display for the Recovery dashboard.
 *
 * @param {object} ouraData - grouped Oura data ({ [date]: { sleep, readiness, ... } })
 * @returns {{
 *   value: number|null,      // numeric value backing the text (ms or 0–100 index)
 *   unit: "ms"|"balance"|null,
 *   date: string|null,       // the day the value came from
 *   scoredDay: string|null,  // the latest recovery day the scorer anchors to
 *   source: string|null,     // provenance label
 *   isFallback: boolean,     // true when using readiness hrv_balance (not a real ms reading)
 *   isStale: boolean,        // true when the ms value is from a night before the scored day
 *   text: string,            // ready-to-render string with any date/fallback qualifier
 * }}
 */
export function resolveHrvRawDisplay(ouraData) {
  const scoredDay = latestRecoveryDay(ouraData) || null;

  // 1) Real sleep HRV for the scored day — the ideal, matches the Oura app.
  const scoredSleep = getSleepDoc(ouraData?.[scoredDay]);
  const scored = hrvRmssdWithSource(scoredSleep);
  const scoredValue = finiteNumber(scored.value);
  if (scoredValue !== null) {
    const value = scoredValue;
    return {
      value,
      unit: "ms",
      date: scoredDay,
      scoredDay,
      source: scored.source,
      isFallback: false,
      isStale: false,
      text: `${Math.round(value)} ms`,
    };
  }

  // 2) Most recent *prior* night with a real sleep HRV. Show it — with its date
  //    and a "last recorded night" marker — rather than only the balance index,
  //    so a user whose last night simply hasn't synced still sees the real number
  //    the Oura app shows, never mistaken for today.
  const dates = recoveryDates(ouraData);
  for (const date of dates) {
    if (date === scoredDay) continue;
    const prior = hrvRmssdWithSource(getSleepDoc(ouraData?.[date]));
    const priorValue = finiteNumber(prior.value);
    if (priorValue !== null) {
      const value = priorValue;
      return {
        value,
        unit: "ms",
        date,
        scoredDay,
        source: prior.source,
        isFallback: false,
        isStale: true,
        text: `${Math.round(value)} ms · ${formatShortDate(date)} night (last recorded)`,
      };
    }
  }

  // 3) Readiness HRV-balance index (0–100) — explicitly a fallback, never ms.
  const balance = finiteNumber(readinessContributor(ouraData?.[scoredDay], "hrv_balance"));
  if (balance !== null) {
    const value = balance;
    return {
      value,
      unit: "balance",
      date: scoredDay,
      scoredDay,
      source: "readiness fallback",
      isFallback: true,
      isStale: false,
      text: `${Math.round(value)}/100 Oura HRV balance`,
    };
  }

  return {
    value: null,
    unit: null,
    date: scoredDay,
    scoredDay,
    source: null,
    isFallback: false,
    isStale: false,
    text: "not available",
  };
}

export { formatShortDate };
