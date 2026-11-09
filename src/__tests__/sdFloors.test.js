// @vitest-environment jsdom
// SD-floor contracts, pinned against the real-data report: a
// consistent athlete's routine morning read HRV 8/35 · RHR 3/25 because the
// leave-one-out pool's tiny SD turned normal wobble into |z| > 2.5. Floors
// restore robustness WITHOUT dulling genuine crashes — both directions pinned.
import { describe, expect, it } from "vitest";
import { calcHRVScore, calcRHRScore } from "../oura/algorithms";
import { buildDemoEntries, buildDemoOura } from "../demo/demoDataset";

const iso = (o) => { const d = new Date(); d.setDate(d.getDate() + o); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const skel = () => buildDemoOura(buildDemoEntries(40), 20);
const setHrv = (o, off, v) => { o[iso(off)].sleep.data[0].heart_rate_variability = { average: v, rmssd: v }; };
const setRhr = (o, off, v) => { o[iso(off)].sleep.data[0].lowest_heart_rate = v; };

describe("SD floors (V16.5.1)", () => {
  it("REPRO: a routine -6% HRV dip on a flat pool no longer floors the subscore", () => {
    const o = skel();
    for (let i = 1; i <= 14; i++) setHrv(o, -i, 63 + (i % 2)); // sd_ln ≈ 0.008
    setHrv(o, 0, 59); // ~ -6.5%
    const hrv = calcHRVScore(o, {});
    expect(parseFloat(hrv.zScore)).toBeGreaterThan(-1.8);
    expect(hrv.score).toBeGreaterThanOrEqual(16);
    expect(hrv.detail).toContain("sd floored");
  });

  it("a genuine HRV crash still saturates the anchors through the floor", () => {
    const o = skel();
    for (let i = 1; i <= 14; i++) setHrv(o, -i, 63 + (i % 2));
    setHrv(o, 0, 42);
    const hrv = calcHRVScore(o, {});
    expect(parseFloat(hrv.zScore)).toBeLessThan(-3);
    expect(hrv.score).toBeLessThanOrEqual(8);
  });

  it("REPRO: +3 bpm on a flat RHR pool scores mid-band, not the basement", () => {
    const o = skel();
    for (let i = 1; i <= 14; i++) setRhr(o, -i, 55 + (i % 2) * 0.5);
    setRhr(o, 0, 58);
    const rhr = calcRHRScore(o);
    expect(rhr.score).toBeGreaterThanOrEqual(9);
  });

  it("a genuinely spiked RHR (+8 bpm) still lands near the floor anchor", () => {
    const o = skel();
    for (let i = 1; i <= 14; i++) setRhr(o, -i, 55 + (i % 2) * 0.5);
    setRhr(o, 0, 63);
    const rhr = calcRHRScore(o);
    expect(rhr.score).toBeLessThanOrEqual(6);
  });
});
