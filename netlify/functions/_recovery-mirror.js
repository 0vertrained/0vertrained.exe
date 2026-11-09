// netlify/functions/_recovery-mirror.js
// The Courier's slim recovery mirror.
//
// House doctrine: Netlify functions MIRROR src logic
// rather than importing across the bundle boundary, and a parity test
// (src/__tests__/courierMirrorParity.test.js) is the drift alarm — it runs the
// src classifier and this mirror on identical fixtures and asserts equal
// states. If you change src/oura/normalization.js, src/oura/statistics.js, or
// src/wearables/recoveryTrend.js, that test tells you to update this file.
//
// Deliberate v1 limits (documented, tested): the courier classifies with
// loadZone = null and sleepDebt = null — load and debt context stay
// client-side, so the mirror parity contract is:
//     mirrorClassify(rows).stateKey
//       === classifyRecoveryState({ ouraData: group(rows) }).state.key
// Consequence: "Absorbing load" is unreachable server-side (it needs load
// context) and deload requires the RHR corroboration path. The morning push
// therefore speaks in {calibrating*, fresh, steady, accumulating, deload}.
// (*calibrating is computed but never pushed — see edition-courier.js.)

// ── normalization mirror (src/oura/normalization.js) ─────────────────────────
const MAIN_SLEEP_TYPE = /long|main/i;
const NON_MAIN_SLEEP_TYPE = /nap|rest|deleted/i;
const MAIN_SLEEP_MIN_SECONDS = 3 * 3600;

const finiteNum = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const hrvRmssd = (doc) => doc?.average_hrv ?? doc?.hrv?.rmssd ?? null;
const rhrValue = (doc) => doc?.lowest_heart_rate ?? doc?.resting_heart_rate ?? null;

function docsFromPayload(payload) {
  const arr = payload?.data;
  return Array.isArray(arr) ? arr.filter(Boolean) : [];
}

export function isMainSleepDoc(doc) {
  if (!doc || typeof doc !== "object") return false;
  const type = doc.type ?? doc.sleep_type ?? null;
  if (type != null && String(type).trim() !== "") {
    if (MAIN_SLEEP_TYPE.test(String(type))) return true;
    if (NON_MAIN_SLEEP_TYPE.test(String(type))) return false;
  }
  const duration = finiteNum(doc.total_sleep_duration ?? doc.total_sleep_time);
  if (duration === null) return true;
  return duration >= MAIN_SLEEP_MIN_SECONDS;
}

function sleepDocRank(doc) {
  if (!doc) return -Infinity;
  const duration = finiteNum(doc.total_sleep_duration ?? doc.total_sleep_time) || 0;
  const score = finiteNum(doc.score) || 0;
  const hasHrv = finiteNum(hrvRmssd(doc)) !== null ? 1 : 0;
  const hasRhr = finiteNum(rhrValue(doc)) !== null ? 1 : 0;
  const typeBonus = MAIN_SLEEP_TYPE.test(String(doc.type || doc.sleep_phase || "")) ? 50_000 : 0;
  return typeBonus + duration + score * 100 + hasHrv * 500 + hasRhr * 500;
}

export function getSleepDoc(day) {
  const docs = docsFromPayload(day?.sleep).filter(isMainSleepDoc);
  if (!docs.length) return null;
  return docs.slice().sort((a, b) => sleepDocRank(b) - sleepDocRank(a))[0] || null;
}

function getReadinessDoc(day) {
  return docsFromPayload(day?.readiness)[0] || null;
}

export function groupOuraRows(rows) {
  const out = {};
  for (const r of rows || []) {
    if (!r?.date || !r?.data_type) continue;
    (out[r.date] ||= {})[r.data_type] = r.payload;
  }
  return out;
}

export function recoveryDates(ouraData) {
  return Object.keys(ouraData || {})
    .filter((date) => getSleepDoc(ouraData[date]) || getReadinessDoc(ouraData[date]))
    .sort()
    .reverse();
}

// ── statistics mirror (src/oura/statistics.js) ───────────────────────────────
export const lnRMSSD = (rmssd) => Math.log(rmssd);

// Verbatim mirrors of src/oura/statistics.js — including the <5-sample
// untrimmed fallback and sample (n−1) stdDev. Parity depends on these quirks.
const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;
const stdDev = (values) => {
  if (!values || values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((s, v) => s + Math.pow(v - m, 2), 0) / (values.length - 1));
};

export function trimmedMean(values, trim = 0.1) {
  const nums = (values || []).filter(v => Number.isFinite(Number(v))).map(Number).sort((a, b) => a - b);
  if (nums.length === 0) return 0;
  if (nums.length < 5) return mean(nums);
  const k = Math.floor(nums.length * trim);
  const kept = k > 0 ? nums.slice(k, nums.length - k) : nums;
  return mean(kept.length ? kept : nums);
}

export function trimmedStdDev(values, trim = 0.1) {
  const nums = (values || []).filter(v => Number.isFinite(Number(v))).map(Number).sort((a, b) => a - b);
  if (nums.length < 2) return 0;
  if (nums.length < 5) return stdDev(nums);
  const k = Math.floor(nums.length * trim);
  const kept = k > 0 ? nums.slice(k, nums.length - k) : nums;
  return stdDev(kept.length >= 2 ? kept : nums);
}

export function linearRegression(points) {
  if (!points || points.length < 2) return 0;
  const n = points.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) { sumX += i; sumY += points[i]; sumXY += i * points[i]; sumX2 += i * i; }
  return (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
}

// ── trend mirror (src/wearables/recoveryTrend.js, loadZone/sleepDebt = null) ─
export const TREND_MIN_DAYS = 7;
export const CHRONIC_WINDOW = 28;
export const SWC_FACTOR = 0.5;

function lnHrvSeries(ouraData, windowDays = CHRONIC_WINDOW + TREND_MIN_DAYS) {
  const dates = recoveryDates(ouraData).slice(0, windowDays).reverse();
  const out = [];
  for (const date of dates) {
    const rmssd = Number(getSleepDoc(ouraData[date])?.average_hrv);
    if (Number.isFinite(rmssd) && rmssd > 0) out.push(lnRMSSD(rmssd));
  }
  return out;
}

function rhrSeries(ouraData, windowDays = TREND_MIN_DAYS) {
  const dates = recoveryDates(ouraData).slice(0, windowDays).reverse();
  const out = [];
  for (const date of dates) {
    const rhr = Number(getSleepDoc(ouraData[date])?.lowest_heart_rate);
    if (Number.isFinite(rhr) && rhr > 0) out.push(rhr);
  }
  return out;
}

const STATE_NAMES = {
  calibrating: "Calibrating",
  fresh: "Fresh",
  steady: "Steady",
  accumulating: "Accumulating fatigue",
  deload: "Deload advised",
};

/**
 * Classify from raw oura_data rows. Parity contract with the src classifier
 * under { loadZone: null, sleepDebt: null } — see the header note.
 */
export function mirrorClassify(rows) {
  const ouraData = groupOuraRows(rows);
  const lns = lnHrvSeries(ouraData);
  const n = lns.length;
  if (n < TREND_MIN_DAYS) return { stateKey: "calibrating", stateName: STATE_NAMES.calibrating, daysHave: n };

  const rollingLns = lns.slice(-TREND_MIN_DAYS);
  const rolling = rollingLns.reduce((a, b) => a + b, 0) / rollingLns.length;
  const chronicLns = lns.slice(-CHRONIC_WINDOW);
  const chronic = trimmedMean(chronicLns, 0.1);
  const sd = trimmedStdDev(chronicLns, 0.1);
  const swc = SWC_FACTOR * sd;
  const position = swc > 0 ? (rolling - chronic) / swc : 0;

  const rhr = rhrSeries(ouraData);
  const rhrSlope = rhr.length >= 3 ? linearRegression(rhr) : 0;
  const rhrRising = rhrSlope >= 0.4;
  const rhrFalling = rhrSlope <= -0.4;

  const below = position <= -1;
  const above = position >= 1;
  const inBand = !below && !above;

  // Same priority ladder as src with loadZone=null, sleepDebt=null:
  // (highLoad=false → saturation & absorbing branches unreachable;
  //  heavyDebt=false → deload needs rhrRising.)
  let stateKey;
  if (below && rhrRising) stateKey = "deload";
  else if (below) stateKey = "accumulating";
  else if ((above || (inBand && position > 0)) && !rhrRising) stateKey = "fresh";
  else stateKey = "steady";

  return { stateKey, stateName: STATE_NAMES[stateKey], position, rhrSlope, rhrFalling };
}

export default { mirrorClassify, groupOuraRows, recoveryDates, getSleepDoc, isMainSleepDoc, trimmedMean, trimmedStdDev, linearRegression };
