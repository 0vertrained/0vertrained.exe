// @vitest-environment jsdom
// V16.0 · Arbitration-layer contracts (audit F4). The four principles, pinned:
// per-metric ladders, WITHIN-source baselines, fallback-not-average,
// top-rung-wins.
import { describe, expect, it } from "vitest";
import { calcHRVScore, calcRHRScore, calcRecoveryScore } from "../oura/algorithms";
import { buildDemoEntries, buildDemoOura, buildDemoWhoop } from "../demo/demoDataset";

const iso = (o) => { const d = new Date(); d.setDate(d.getDate() + o); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

function fixtures() {
  const entries = buildDemoEntries(40);
  return { oura: buildDemoOura(entries, 20), whoop: buildDemoWhoop(entries, 20) };
}
const setWhoopHrv = (w, o, v) => { w[iso(o)].recovery.score.hrv_rmssd_milli = v; };
const dropOuraHrvToday = (oura) => {
  delete oura[iso(0)].sleep.data[0].heart_rate_variability;
  if (oura[iso(0)].readiness?.data?.[0]?.contributors) delete oura[iso(0)].readiness.data[0].contributors.hrv_balance;
};

describe("arbitration ladder", () => {
  it("PIN · within-source baselines: whoop z ignores oura's pool entirely", () => {
    const { oura, whoop } = fixtures();
    dropOuraHrvToday(oura);
    // Oura history lives at ~30ms; whoop history at ~60ms; whoop today = 60.
    for (let i = 1; i <= 14; i++) oura[iso(-i)].sleep.data[0].heart_rate_variability = { average: 30, rmssd: 30 };
    const spread = [55, 58, 60, 62, 65, 57, 63, 59, 61, 64, 56, 60, 62, 58];
    for (let i = 1; i <= 14; i++) setWhoopHrv(whoop, -i, spread[i - 1]);
    setWhoopHrv(whoop, 0, 60);
    const hrv = calcHRVScore(oura, {}, whoop);
    expect(hrv.source).toBe("whoop recovery HRV (fallback)");
    // Against whoop's OWN pool 60 is dead-normal; against oura's 30s it would
    // read as a massive spike. Within-source means z stays near zero.
    expect(Math.abs(parseFloat(hrv.zScore))).toBeLessThan(0.6);
    expect(hrv.score).toBeGreaterThanOrEqual(28);
  });

  it("top rung wins outright when both devices report", () => {
    const { oura, whoop } = fixtures();
    setWhoopHrv(whoop, 0, 999); // absurd whoop value must be irrelevant
    const hrv = calcHRVScore(oura, {}, whoop);
    expect(hrv.source).toBe("raw sleep HRV");
  });

  it("RHR falls back to whoop's own trimmed baseline, not oura's", () => {
    const { oura, whoop } = fixtures();
    delete oura[iso(0)].sleep.data[0].lowest_heart_rate;
    delete oura[iso(0)].sleep.data[0].average_heart_rate;
    const rhr = calcRHRScore(oura, whoop);
    expect(rhr.source).toBe("whoop recovery RHR (fallback)");
    expect(rhr.sampleCount).toBeGreaterThanOrEqual(4);
  });

  it("whoop sleep performance rescues a missing oura night into a COUNTED signal", () => {
    const { oura, whoop } = fixtures();
    delete oura[iso(0)].sleep; // no staging doc at all
    whoop[iso(0)].sleep.score.sleep_performance_percentage = 88;
    const rec = calcRecoveryScore(oura, {}, whoop);
    expect(rec.detail.sleep.source).toBe("whoop sleep performance (fallback)");
    expect(rec.detail.sleep.nightly).toBe(22);
    expect(rec.ledger.find((l) => l.key === "sleep").counted).toBe(true);
  });

  it("backward compatible: two-argument calls behave as pure-oura", () => {
    const { oura } = fixtures();
    const a = calcRecoveryScore(oura, {});
    const b = calcRecoveryScore(oura, {}, null);
    expect(a.score).toBe(b.score);
    expect(a.scoringBasis).toBe(b.scoringBasis);
  });
});
