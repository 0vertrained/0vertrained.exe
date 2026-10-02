// @vitest-environment jsdom
// V15.6 · Intelligence-correctness contracts (audit F1/F2/F5/F6). Each pins
// the failure mode it fixes, sleep-debt-style.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { calcHRVScore, calcRecoveryScore } from "../oura/algorithms";
import { buildDemoEntries, buildDemoOura } from "../demo/demoDataset";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(resolve(root, p), "utf8");

const iso = (offset) => {
  const d = new Date(); d.setDate(d.getDate() + offset);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

function ouraSkeleton() {
  return buildDemoOura(buildDemoEntries(40), 20);
}
const setRmssd = (oura, offset, rmssd) => {
  const doc = oura[iso(offset)].sleep.data[0];
  doc.heart_rate_variability = { average: rmssd, rmssd };
};

describe("F1 · leave-one-out HRV baseline", () => {
  it("REPRO: a genuine HRV crash registers strongly instead of being self-dampened", () => {
    const oura = ouraSkeleton();
    // 14 stable prior nights (63–67), then today collapses to 42.
    for (let i = 1; i <= 14; i++) setRmssd(oura, -i, 63 + (i % 5));
    setRmssd(oura, 0, 42);
    const hrv = calcHRVScore(oura, {});
    // Contaminated baseline diluted this; leave-one-out must read it as a
    // significant suppression with heavy point loss.
    expect(parseFloat(hrv.zScore)).toBeLessThan(-2);
    expect(hrv.score).toBeLessThanOrEqual(12);
  });

  it("stable HRV against its own prior norm scores near the top band", () => {
    const oura = ouraSkeleton();
    // Genuinely varied priors (sd matters — a flat pool makes ANY deviation
    // read as significant, which is correct, not a bug), today at the mean.
    const spread = [58, 61, 63, 64, 65, 66, 67, 69, 71, 60, 68, 62, 70, 64];
    for (let i = 1; i <= 14; i++) setRmssd(oura, -i, spread[i - 1]);
    setRmssd(oura, 0, 65);
    const hrv = calcHRVScore(oura, {});
    expect(parseFloat(hrv.zScore)).toBeGreaterThan(-0.75);
    expect(hrv.score).toBeGreaterThanOrEqual(26);
  });
});

describe("F2 · renormalized recovery score", () => {
  it("REPRO: a missing HRV night no longer caps the score at 65", () => {
    const oura = ouraSkeleton();
    // Strip HRV everywhere (raw + the readiness balance fallback).
    for (const day of Object.values(oura)) {
      delete day.sleep.data[0].heart_rate_variability;
      if (day.readiness?.data?.[0]?.contributors) delete day.readiness.data[0].contributors.hrv_balance;
    }
    const rec = calcRecoveryScore(oura, {});
    expect(rec.detail.hrv.source).toBe("missing");
    const hrvRow = rec.ledger.find((l) => l.key === "hrv");
    expect(hrvRow.counted).toBe(false);
    expect(rec.availableMax).toBe(65);
    // Good rhr/sleep/temp must be able to exceed the old missing-HRV ceiling.
    expect(rec.score).toBeGreaterThan(65);
    expect(rec.scoringBasis).toContain("3/4 signals");
    expect(rec.reconciles).toBe(true);
  });

  it("nothing reported → null score and an honest band, never worst-case", () => {
    const rec = calcRecoveryScore({}, {});
    expect(rec.score).toBeNull();
    expect(rec.band).toBe("insufficient_data");
    expect(rec.ledger.every((l) => l.counted === false)).toBe(true);
  });
});

describe("F5 · whoop day-boundary", () => {
  it("main sleep keys on the WAKE date; naps keep start-date (client + server rules match)", () => {
    const client = read("src/whoop/normalization.js");
    expect(client).toContain("r && r.nap === false && r.end");
    expect(client).toContain("wake date");
    const server = read("netlify/functions/whoop-auth.js");
    expect(server).toContain("rec && rec.nap === false && rec.end");
    expect(server).toContain("wake date");
  });
});

describe("F6 · legacy TDEE retired", () => {
  it("estimateTDEE is gone from the algorithms module and the facade", () => {
    expect(read("src/oura/algorithms.js")).not.toContain("estimateTDEE");
    expect(read("src/oura.js")).not.toContain("estimateTDEE");
  });
});
