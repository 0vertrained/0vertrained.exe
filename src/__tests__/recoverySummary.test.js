import { describe, expect, it } from "vitest";
import {
  buildRecoveryChangeSummary,
  buildRecoveryCoachInterpretation,
  buildRecoveryHeroMeta,
} from "../recoverySummary";

describe("buildRecoveryChangeSummary", () => {
  it("surfaces no major stress flags on strong recovery", () => {
    const result = buildRecoveryChangeSummary({
      hrv: { score: 33, zScore: "0.80", confidence: "high" },
      rhr: { score: 24, delta: "-3.0" },
      sleep: { nightly: 23 },
      temp: { deviation: "0.10", consecutiveNights: 0 },
      sleepDebt: { debtHours: 0.5, band: "Well-rested" },
      trainingLoad: { rolling: { zone: "optimal", ratio: 1.05 } },
      alerts: [],
    });
    expect(result.hasFlags).toBe(false);
    const joined = result.rows.map((r) => r.value).join(" ");
    expect(joined).not.toMatch(/debt|elevated|limiting/i);
    // positive signals are allowed but must all be good-toned
    expect(result.rows.every((r) => r.tone === "good")).toBe(true);
  });

  it("returns the empty-state note when nothing is notable", () => {
    const result = buildRecoveryChangeSummary({});
    expect(result.hasFlags).toBe(false);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].value).toMatch(/no major stress flags/i);
    expect(result.rows[0].value).toMatch(/component ledger/i);
  });

  it("surfaces sleep debt and poor sleep in what changed", () => {
    const result = buildRecoveryChangeSummary({
      sleep: { nightly: 13 },
      sleepDebt: { debtHours: 4.2, band: "Moderate sleep debt" },
    });
    expect(result.hasFlags).toBe(true);
    const sleepRow = result.rows.find((r) => r.key === "sleep");
    const debtRow = result.rows.find((r) => r.key === "sleepDebt");
    expect(sleepRow.value).toMatch(/13\/25/);
    expect(sleepRow.value).toMatch(/limiting/);
    expect(debtRow.value).toMatch(/4\.2h/);
    expect(debtRow.value).toMatch(/moderate sleep debt/);
    expect(debtRow.tone).toBe("caution");
  });

  it("surfaces a load spike / high ACWR when present", () => {
    const result = buildRecoveryChangeSummary({
      trainingLoad: {
        rolling: { zone: "high_risk", ratio: 1.62 },
        zoneInfo: { label: "High Risk" },
      },
    });
    const loadRow = result.rows.find((r) => r.key === "load");
    expect(loadRow).toBeTruthy();
    expect(loadRow.value).toMatch(/ACWR 1\.62/);
    expect(loadRow.value).toMatch(/High Risk/);
    expect(loadRow.tone).toBe("warning");
  });

  it("surfaces alerts before generic notes", () => {
    const result = buildRecoveryChangeSummary({
      rhr: { score: 12, delta: "5.0" },
      alerts: [
        { type: "illness_warning", severity: "warning", markers: ["temp_elevated", "hrv_suppressed", "rhr_elevated"] },
      ],
    });
    expect(result.rows[0].key).toBe("alerts");
    expect(result.rows[0].tone).toBe("warning");
    expect(result.rows[0].value).toMatch(/illness warning/);
    expect(result.rows[0].value).toMatch(/3 markers/);
  });

  it("caps the flag list at five rows", () => {
    const result = buildRecoveryChangeSummary({
      hrv: { score: 12, zScore: "-1.5", confidence: "low" },
      rhr: { score: 6, delta: "8.0" },
      sleep: { nightly: 10 },
      temp: { deviation: "0.70", consecutiveNights: 3 },
      sleepDebt: { debtHours: 6.0, band: "Significant sleep debt" },
      trainingLoad: { rolling: { zone: "high_risk", ratio: 1.7 }, zoneInfo: { label: "High Risk" } },
      alerts: [{ type: "illness_warning", severity: "warning", markers: ["a", "b", "c"] }],
    });
    expect(result.rows.length).toBeLessThanOrEqual(5);
    expect(result.rows[0].key).toBe("alerts");
  });
});

describe("buildRecoveryCoachInterpretation", () => {
  it("reads biometrics as stable when nothing is deviating", () => {
    const interp = buildRecoveryCoachInterpretation({
      recommendation: { label: "Normal Load", prescription: "Train as planned." },
      insights: ["No major negative cluster detected."],
      confidence: { level: "high", reason: "raw Oura signals available across the window" },
      alerts: [],
      connected: true,
    });
    expect(interp.tone).toBe("good");
    expect(interp.cluster).toMatch(/stable/i);
    expect(interp.guidance).toMatch(/train as planned/i);
    expect(interp.confidenceNote).toMatch(/high data confidence/i);
  });

  it("names a sleep-load stress cluster and keeps guidance conservative", () => {
    const interp = buildRecoveryCoachInterpretation({
      recommendation: { label: "Moderate Load", prescription: "Cap top sets and avoid extra volume." },
      insights: ["Sleep contribution is limiting today's recovery score."],
      sleepDebt: { debtHours: 6 },
      alerts: [{ type: "sleep_limited", severity: "caution", markers: ["sleep_limited"] }],
      confidence: { level: "medium", reason: "partial Oura window" },
      connected: true,
    });
    expect(interp.cluster).toMatch(/sleep-limited/i);
    expect(interp.guidance).toMatch(/cap top sets/i);
    expect(interp.body).toMatch(/sleep contribution/i);
  });

  it("adds symptom-safety wording when a warning alert is present", () => {
    const interp = buildRecoveryCoachInterpretation({
      recommendation: { prescription: "Prioritize rest." },
      alerts: [{ type: "illness_warning", severity: "warning", markers: ["a", "b", "c"] }],
      connected: true,
    });
    expect(interp.tone).toBe("warning");
    expect(interp.cluster).toMatch(/multi-system stress cluster/i);
    expect(interp.guidance).toMatch(/illness or injury symptoms/i);
  });

  it("flags fallback mode as a confidence limiter", () => {
    const interp = buildRecoveryCoachInterpretation({
      recommendation: { prescription: "Train as planned." },
      confidence: { level: "low", reason: "partial Oura window" },
      quality: { fallbackMode: true },
      connected: true,
    });
    expect(interp.confidenceNote).toMatch(/fallback/i);
    expect(interp.confidenceNote).toMatch(/lowers confidence/i);
  });

  it("treats manual check-in as first-class and reports input depth/confidence", () => {
    const interp = buildRecoveryCoachInterpretation({
      connected: false,
      subjectiveRecovery: { score: 72, read: "good to train" },
      manualCompleteness: { filled: 4, total: 9 },
    });
    expect(interp.connected).toBe(false);
    expect(interp.cluster).toMatch(/primary readiness signal/i);
    expect(interp.body).toMatch(/first-class/i);
    expect(interp.guidance).toMatch(/good to train/i);
    expect(interp.confidenceNote).toMatch(/4\/9 recovery fields/i);
    expect(interp.confidenceNote).toMatch(/moderate data confidence/i);
    expect(interp.confidenceNote).toMatch(/not an Oura failure/i);
  });

  it("reports limited confidence when manual input depth is shallow", () => {
    const interp = buildRecoveryCoachInterpretation({
      connected: false,
      subjectiveRecovery: null,
      manualCompleteness: { filled: 1, total: 9 },
    });
    expect(interp.confidenceNote).toMatch(/1\/9 recovery fields/i);
    expect(interp.confidenceNote).toMatch(/limited data confidence/i);
    expect(interp.guidance).toMatch(/log/i);
  });
});

describe("buildRecoveryHeroMeta", () => {
  it("prefers the latest usable recovery day and labels the Oura source", () => {
    const meta = buildRecoveryHeroMeta({
      connected: true,
      confidence: { level: "high", reason: "raw Oura signals available" },
      quality: { latestRecoveryDate: "2026-06-30", latestDate: "2026-07-01", recoveryDayIsStale: true },
      tokenStatus: { syncStatus: "ok" },
    });
    expect(meta.source).toBe("Oura biometrics");
    expect(meta.confidenceLabel).toBe("high confidence");
    expect(meta.latestDay).toBe("2026-06-30");
    expect(meta.stale).toBe(true);
  });

  it("labels manual source and marks stale sync", () => {
    const meta = buildRecoveryHeroMeta({
      connected: false,
      confidence: null,
      quality: { latestDate: "2026-07-01" },
      tokenStatus: { syncStatus: "stale" },
    });
    expect(meta.source).toBe("Manual check-in");
    expect(meta.confidenceLabel).toBe("confidence pending");
    expect(meta.latestDay).toBe("2026-07-01");
    expect(meta.stale).toBe(true);
  });

  it("is defensive against empty input", () => {
    const meta = buildRecoveryHeroMeta();
    expect(meta.source).toBe("Oura biometrics");
    expect(meta.latestDay).toBeNull();
    expect(meta.stale).toBe(false);
  });
});
