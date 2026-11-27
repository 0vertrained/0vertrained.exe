import { dateKey, shiftDate } from "../coachWindows";
import { median } from "../oura/statistics";

export const SETTLE_MS = 60_000;
export const MEASURE_MS = 120_000;
export const BASELINE_MORNINGS = 7;
const BASELINE_DAYS = 28;
const storageKey = owner => `ovt-whoop-morning-v1-${owner}`;

// Each packet carries its RR intervals in chronological order. Live timestamps
// are receipt times; stored timestamps have one-second precision. Never form
// a successive difference across a gap or outside this measurement window.
export function measureRrWindow(samples, start) {
  const end = start + MEASURE_MS;
  const segments = [];
  let lastPacketAt = start;
  let lastIntervalsAt = start;
  let segment;
  for (const sample of samples) {
    const at = sample?.timestamp;
    if (!Number.isFinite(at) || at <= lastPacketAt || at > end) continue;
    const elapsed = at - lastPacketAt;
    lastPacketAt = at;
    const intervals = sample.rrMs;
    if (!Array.isArray(intervals) || !intervals.length) continue;
    const duration = intervals.reduce((sum, ms) => sum + intervalDuration(ms), 0);
    if (!segment || elapsed > duration + 650 || at - lastIntervalsAt > duration + 1_250) {
      segment = { start: Math.max(start, at - duration), end: at, values: [] };
      segments.push(segment);
    }
    segment.end = at;
    let beatAt = at - duration;
    for (const ms of intervals) {
      if (beatAt >= start) segment.values.push(ms);
      beatAt += intervalDuration(ms);
    }
    lastIntervalsAt = at;
  }

  if (!segments.some(group => group.values.length)) return { error: "No beat intervals arrived. Check the strap fit and reconnect before trying again." };

  let total = 0, clean = 0, pairs = 0;
  let cleanMs = 0, coveredMs = 0, squaredDifferences = 0, longestRun = 0;
  for (const group of segments) {
    const values = group.values;
    let groupMs = 0;
    let run = 0;
    for (let i = 0; i < values.length; i++) {
      total++;
      const ms = values[i];
      const neighbors = values.slice(Math.max(0, i - 3), i + 4).filter(plausible);
      const typical = median(neighbors);
      if (!plausible(ms) || Math.abs(ms - typical) > typical * 0.25) {
        run = 0;
        continue;
      }
      if (run > 0) {
        squaredDifferences += (ms - values[i - 1]) ** 2;
        pairs++;
      }
      run++;
      longestRun = Math.max(longestRun, run);
      clean++;
      groupMs += ms;
    }
    cleanMs += groupMs;
    coveredMs += Math.min(groupMs, group.end - group.start);
  }
  // These are capture-quality gates for this two-minute protocol. A burst of
  // duplicated intervals can sum to much more time than the recording lasted.
  const rmssd = pairs ? Math.round(Math.sqrt(squaredDifferences / pairs) * 10) / 10 : 0;
  if (coveredMs < MEASURE_MS * 0.9 || cleanMs > MEASURE_MS * 1.08 || clean / total < 0.95 ||
      pairs < 40 || longestRun < 20 || !rmssd) {
    return { error: "Too few reliable consecutive beats. Adjust the strap, sit still and repeat the check." };
  }
  return {
    cleanBeats: clean,
    coverage: Math.min(100, Math.round(coveredMs * 100 / MEASURE_MS)),
    rmssd,
    pulse: Math.round(60_000 * clean / cleanMs),
  };
}

export function measureMorningCheck(samples, startedAt) {
  const result = measureRrWindow(samples, startedAt + SETTLE_MS);
  if (result.error) return result;
  const timestamp = startedAt + SETTLE_MS + MEASURE_MS;
  return { ...result, day: dateKey(new Date(timestamp)), timestamp };
}

function plausible(ms) { return Number.isFinite(ms) && ms >= 300 && ms <= 2_000; }
function intervalDuration(ms) { return Number.isFinite(ms) && ms > 0 && ms <= 3_000 ? ms : 1_000; }

function validRecord(record) {
  return /^\d{4}-\d{2}-\d{2}$/.test(record?.day) && Number.isFinite(record.timestamp) &&
    Number.isFinite(record.rmssd) && record.rmssd > 0 && Number.isFinite(record.pulse) && record.pulse > 0;
}

function storedChecks(owner) {
  const entries = JSON.parse(localStorage.getItem(storageKey(owner)) || "[]");
  return entries.filter(validRecord).sort((a, b) => b.day.localeCompare(a.day));
}

export function readMorningChecks(owner) {
  if (!owner) return [];
  try { return storedChecks(owner); } catch { return []; }
}

// Keep one seated result per local day. Re-reading on write preserves checks
// recorded since this screen opened; failed writes leave the result retryable.
export function saveMorningCheck(owner, record) {
  if (!owner || !validRecord(record)) return null;
  try {
    const entries = storedChecks(owner);
    const index = entries.findIndex(entry => entry.day === record.day);
    if (index < 0) entries.push(record);
    else if (record.timestamp >= entries[index].timestamp) entries[index] = record;
    entries.sort((a, b) => b.day.localeCompare(a.day));
    localStorage.setItem(storageKey(owner), JSON.stringify(entries));
    return entries;
  } catch { return null; }
}

export function morningBaseline(entries, day) {
  const earliestDay = shiftDate(day, -BASELINE_DAYS);
  const previous = entries.filter(entry => entry.day >= earliestDay && entry.day < day);
  if (previous.length < BASELINE_MORNINGS) return { count: previous.length };
  return {
    count: previous.length,
    rmssd: Math.round(median(previous.map(entry => entry.rmssd)) * 10) / 10,
    pulse: Math.round(median(previous.map(entry => entry.pulse))),
  };
}
