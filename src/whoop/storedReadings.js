import { shiftDate } from "../coachWindows";
import { median } from "../oura/statistics";
import { MEASURE_MS, measureRrWindow } from "./morningCheck";

const MINUTE = 60_000;

// Interpret times on the athlete's calendar. Advancing by a calendar day also
// gives the correct elapsed coverage on a short or long daylight-saving night.
export function historyWindow(day, mode, startTime, endTime) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  let start = mode === "overnight" ? "20:00" : startTime;
  let end = mode === "overnight" ? "10:00" : endTime;
  let startDay = day;
  let endDay = day;
  if (mode === "day") {
    start = end = "00:00";
    endDay = shiftDate(day, 1);
  } else if (mode === "overnight") startDay = shiftDate(day, -1);
  else {
    const validTime = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
    if (!validTime.test(start) || !validTime.test(end) || start === end) return null;
    if (end < start) endDay = shiftDate(day, 1);
  }
  const from = new Date(`${startDay}T${start}:00`).getTime();
  const until = new Date(`${endDay}T${end}:00`).getTime();
  return Number.isFinite(from) && until > from ? { from, until } : null;
}

async function readRange(bridge, from, until, cancelled, onRow) {
  let after;
  do {
    const page = await bridge.readHistory({ from, to: until - 1, after, limit: 2000 });
    if (cancelled()) return false;
    if (!Array.isArray(page?.records)) throw new Error("The strap history could not be read.");
    for (const row of page.records) {
      if (Number.isFinite(row?.timestamp) && row.timestamp >= from && row.timestamp < until) onRow(row);
    }
    const next = page.nextAfter;
    if (next != null && (!Number.isSafeInteger(next) || next <= (after ?? 0))) {
      throw new Error("The strap history could not be paged. Try opening it again.");
    }
    after = next;
  } while (after != null);
  return true;
}

// History pages are in insertion order. Keep one on-wrist interval packet per
// strap second, then sort by the recording clock. Conflicting packets or a
// documented off-wrist interval exclude the block from HRV.
function collectIntervals(block, row) {
  if (row.onWrist === false) block.excluded = true;
  if (block.excluded || row.onWrist !== true || !Number.isInteger(row.bpm) || row.bpm < 20 || row.bpm > 250) return;
  const rrMs = Array.isArray(row.rrMs) ? row.rrMs : [];
  const timestamp = Math.floor(row.timestamp / 1000) * 1000;
  const existing = block.samples.get(timestamp);
  if (existing?.rrMs.length) {
    if (rrMs.length && (rrMs.length !== existing.rrMs.length || rrMs.some((ms, i) => ms !== existing.rrMs[i]))) block.excluded = true;
  } else block.samples.set(timestamp, { timestamp, rrMs });
}

// Use only seconds with an actual on-wrist pulse. Motion-only history and
// duplicate packets neither add coverage nor influence the heart-rate summary.
export async function readStoredPulse(bridge, from, until, cancelled = () => false, { overnight = false } = {}) {
  const minutes = Array.from({ length: Math.ceil((until - from) / MINUTE) },
    () => ({ seen: new Set(), hasMotion: false, total: 0, peak: 0, low: Infinity }));
  let records = 0;
  const measured = [];

  // Limit overnight RR memory to 30 minutes (15 nonoverlapping two-minute
  // blocks), independent of the length of the night or the number of retries.
  const rangeSize = overnight ? 30 * MINUTE : until - from;
  for (let rangeStart = from; rangeStart < until; rangeStart += rangeSize) {
    const rangeEnd = Math.min(rangeStart + rangeSize, until);
    const blocks = overnight ? Array.from({ length: Math.floor((rangeEnd - rangeStart) / MEASURE_MS) },
      () => ({ samples: new Map(), excluded: false })) : [];
    const read = await readRange(bridge, rangeStart, rangeEnd, cancelled, row => {
      records++;
      const block = blocks[Math.floor((row.timestamp - rangeStart) / MEASURE_MS)];
      if (block) collectIntervals(block, row);
      const offset = row.timestamp - from;
      const bin = minutes[Math.floor(offset / MINUTE)];
      if (Array.isArray(row.gravity) && row.gravity.length === 3 && row.gravity.every(Number.isFinite)) bin.hasMotion = true;
      if (row.onWrist === false || !Number.isInteger(row.bpm) || row.bpm < 1 || row.bpm > 300) return;
      const second = Math.floor(offset / 1000) % 60;
      if (bin.seen.has(second)) return;
      bin.seen.add(second);
      bin.total += row.bpm;
      bin.peak = Math.max(bin.peak, row.bpm);
      bin.low = Math.min(bin.low, row.bpm);
    });
    if (!read) return null;

    blocks.forEach((block, i) => {
      if (block.excluded || !block.samples.size) return;
      const start = rangeStart + i * MEASURE_MS;
      const ordered = [...block.samples.values()].sort((a, b) => a.timestamp - b.timestamp);
      const result = measureRrWindow(ordered, start);
      if (!result.error) measured.push({ start, rmssd: result.rmssd });
    });
  }
  let total = 0, samples = 0, peak = 0, lowestFive = null;
  let fiveMinuteTotal = 0, fiveMinuteCount = 0, wellCoveredMinutes = 0;
  minutes.forEach((minute, index) => {
    const count = minute.seen.size;
    total += minute.total;
    samples += count;
    peak = Math.max(peak, minute.peak);
    fiveMinuteTotal += minute.total;
    fiveMinuteCount += count;
    if (count >= 48) wellCoveredMinutes++;
    if (index >= 5) {
      const expired = minutes[index - 5];
      fiveMinuteTotal -= expired.total;
      fiveMinuteCount -= expired.seen.size;
      if (expired.seen.size >= 48) wellCoveredMinutes--;
    }
    if (wellCoveredMinutes === 5) lowestFive = Math.min(lowestFive ?? Infinity, fiveMinuteTotal / fiveMinuteCount);
  });
  const slots = Math.min(100, minutes.length);
  const bins = Array.from({ length: slots }, () => ({ low: Infinity, peak: 0 }));
  minutes.forEach((minute, i) => {
    const bin = bins[Math.floor(i * slots / minutes.length)];
    bin.low = Math.min(bin.low, minute.low);
    bin.peak = Math.max(bin.peak, minute.peak);
  });
  // A single short cluster of readings cannot represent the overnight window.
  const hasSpread = measured.length >= 3 && measured.at(-1).start - measured[0].start >= 60 * MINUTE;
  const overnightRmssd = hasSpread ? Math.round(median(measured.map(window => window.rmssd)) * 10) / 10 : null;
  return { records, samples, motionMinutes: minutes.filter(bin => bin.hasMotion).length,
    overnightRmssd, hrvWindowCount: measured.length, totalSeconds: Math.ceil((until - from) / 1000),
    average: samples ? Math.round(total / samples) : null, peak: samples ? peak : null,
    lowestFive: lowestFive !== null ? Math.round(lowestFive) : null, bins };
}
