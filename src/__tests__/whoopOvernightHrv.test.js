import { describe, expect, it, vi } from "vitest";
import { readStoredPulse } from "../whoop/storedReadings";

const from = new Date(2026, 9, 22, 20, 0).getTime();
const minute = 60_000;
const collect = (bridge, duration = 90 * minute) => readStoredPulse(bridge, from, from + duration, () => false, { overnight: true });
const block = (offset, variation = 20) => Array.from({ length: 119 }, (_, i) => ({
  timestamp: from + offset * minute + (i + 1) * 1000,
  rrMs: [1000 + (i % 2 ? variation : -variation)], bpm: 60, onWrist: true,
}));

// Return reverse chronological pages and overlapping rows as an interrupted,
// retried transfer might have inserted them into the local history archive.
function archive(rows, pageSize = 37) {
  const reversed = rows.slice().reverse();
  return { readHistory: vi.fn(async ({ from: start, to, after = 0 }) => {
    const found = reversed.filter(row => row.timestamp >= start && row.timestamp <= to);
    return { records: found.slice(after, after + pageSize), nextAfter: after + pageSize < found.length ? after + pageSize : null };
  }) };
}

describe("WHOOP overnight-window HRV", () => {
  it("replays eight hours with a 30-minute signal gap and a repeated packet at each page boundary", async () => {
    const seconds = 8 * 3600;
    const readHistory = async ({ from: start, to, after = 0, limit }) => {
      const first = (start - from) / 1000;
      const end = Math.floor((to - from) / 1000) + 1;
      const last = Math.min(first + after + Math.min(limit, 450), end);
      const records = [];
      for (let s = first + Math.max(0, after - 1); s < last; s++) {
        if (s >= 2 * 3600 && s < 2.5 * 3600) continue;
        records.push({ timestamp: from + 1000 * s, bpm: 60, rrMs: [s % 2 ? 990 : 1010], onWrist: true });
      }
      return { records, nextAfter: last < end ? last - first : null };
    };
    const summary = await collect({ readHistory }, seconds * 1000);
    expect(summary).toMatchObject({ samples: seconds - 1800, totalSeconds: seconds, average: 60,
      lowestFive: 60, overnightRmssd: 20, hrvWindowCount: 225 });
    expect(summary.bins.some(bin => bin.peak === 0)).toBe(true);
  });

  it("sorts by strap time across pages and uses the median from qualifying two-minute windows", async () => {
    const rows = [...block(0, 20), ...block(30, 30), ...block(60, 90)];
    const bridge = archive([...rows, ...rows]);
    const result = await collect(bridge);
    expect(result).toMatchObject({ overnightRmssd: 60, hrvWindowCount: 3, samples: rows.length });
    expect(bridge.readHistory.mock.calls.every(([page]) => page.to - page.from < 30 * minute)).toBe(true);
  });

  it("requires three blocks spanning an hour and never combines partial blocks across their boundaries", async () => {
    const clustered = await collect(archive([...block(0), ...block(2), ...block(4)]));
    expect(clustered).toMatchObject({ overnightRmssd: null, hrvWindowCount: 3 });
    const partial = [...block(32).slice(-58), ...block(34).slice(0, 59)];
    expect(await collect(archive([...block(0), ...partial, ...block(60)]))).toMatchObject({
      overnightRmssd: null, hrvWindowCount: 2,
    });
  });

  it("requires explicit wear and skips off-wrist, conflicting, unusable or incomplete windows", async () => {
    const conflicting = block(32);
    const offWrist = block(34);
    const rows = [
      ...block(0), ...block(30), ...block(60),
      ...conflicting, { ...conflicting[35], rrMs: [730] },
      ...offWrist, { ...offWrist[14], rrMs: [], onWrist: false },
      ...block(36).map(row => ({ ...row, onWrist: undefined })),
      ...block(38).map(row => ({ ...row, rrMs: [1000] })),
      ...block(62),
    ];
    expect(await collect(archive(rows), 63.9 * minute)).toMatchObject({ overnightRmssd: 40, hrvWindowCount: 3 });
    const daytime = await readStoredPulse(archive(rows), from, from + 90 * minute);
    expect(daytime).toMatchObject({ overnightRmssd: null, hrvWindowCount: 0 });
  });
});
